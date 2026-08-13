import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { languages } from "@codemirror/language-data";
import { closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, rectangularSelection } from "@codemirror/view";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
import { livePreviewPlugin, mermaidBlockExtension, tableBlockExtension } from "./cm/live-preview";
import { markdownFormattingKeymap, markdownIndentUnit } from "./cm/formatting-keymap";
import { markdownLinkInteractionExtension } from "./cm/link-interactions";
import { livePreviewMarkdownLanguage } from "./cm/markdown-language";
import { markdownEditorTheme } from "./cm/theme";

export type LiveMarkdownEditorProps = {
  /** 受控换文件的判据：只有它变了才做全量替换，内容变化不触发（否则每次自己的输入都会把光标打回去）。 */
  documentKey: string;
  initialContent: string;
  /** 预留给后续阶段的图片相对路径解析，本阶段不消费。 */
  markdownSourcePath?: string;
  readOnly?: boolean;
  isDark: boolean;
  placeholder?: string;
  /** 内部按文档体量 debounce 后调用——Word 预览那条管线很重，不能每个按键跑一遍。 */
  onDocChanged: (text: string) => void;
  /** 每次真实用户输入立即调用，不 debounce。给「未保存」状态用，脏标记必须是即时的。 */
  onDirty?: () => void;
  onRequestSave?: () => void;
  onOpenLink?: (target: string) => void;
  openLinksOnClick?: boolean;
  className?: string;
};

export type LiveMarkdownEditorHandle = {
  /** 容器 display:none 后重新显示时 CM 测不到高度，需要外部触发重测。 */
  requestMeasure: () => void;
  focus: () => void;
  getValue: () => string;
  /** 供工具栏之类的外部逻辑直接 dispatch，拿不到时说明 view 还没挂载。 */
  getView: () => EditorView | null;
};

/** 标记「这次改动来自外部载入而非用户输入」，避免把程序化替换误报成脏数据。 */
const externalUpdate = Annotation.define<boolean>();
const linkInteractionVersion = "strict-hitbox-v4";

function docChangeDebounceMs(length: number): number {
  if (length >= 300_000) return 700;
  if (length >= 80_000) return 400;
  return 200;
}

export const LiveMarkdownEditor = forwardRef<LiveMarkdownEditorHandle, LiveMarkdownEditorProps>(function LiveMarkdownEditor(
  { documentKey, initialContent, readOnly = false, isDark, placeholder, onDocChanged, onDirty, onRequestSave, onOpenLink, openLinksOnClick = false, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const livePreviewCompartment = useRef(new Compartment()).current;
  const linkInteractionCompartment = useRef(new Compartment()).current;
  // mermaid 的块级装饰带着深浅色：主题变了图要重画，
  // 否则深色模式下拿到的还是缓存里的浅色版本。
  const mermaidCompartment = useRef(new Compartment()).current;

  // 回调放 ref 里读：EditorView 只创建一次，闭包捕获的是首次渲染的函数，
  // 直接用会一直调到过期的 props。
  const onDocChangedRef = useRef(onDocChanged);
  const onDirtyRef = useRef(onDirty);
  const onRequestSaveRef = useRef(onRequestSave);
  const onOpenLinkRef = useRef(onOpenLink);
  const openLinksOnClickRef = useRef(openLinksOnClick);
  onDocChangedRef.current = onDocChanged;
  onDirtyRef.current = onDirty;
  onRequestSaveRef.current = onRequestSave;
  onOpenLinkRef.current = onOpenLink;
  openLinksOnClickRef.current = openLinksOnClick;

  const debounceRef = useRef<number | null>(null);
  // 首个 documentKey 已经由 initialContent 建进 state，不能在 mount 后再替换一次。
  const lastDocumentKeyRef = useRef(documentKey);
  // 初始内容同理只在创建时读一次，之后的 props 变化不该反向覆盖用户正在编辑的内容。
  const initialContentRef = useRef(initialContent);
  initialContentRef.current = initialContent;

  const createLinkInteractionExtension = useCallback(() => markdownLinkInteractionExtension({
    openLinksOnClick: () => openLinksOnClickRef.current,
    onOpenLink: (target) => onOpenLinkRef.current?.(target),
  }), [linkInteractionVersion]);

  useImperativeHandle(
    ref,
    () => ({
      requestMeasure: () => viewRef.current?.requestMeasure(),
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? "",
      getView: () => viewRef.current,
    }),
    [],
  );

  // 空依赖是硬约束：任何 props 变化导致的重建都会丢光标、丢 undo 历史。
  // 会变的部分全部通过 Compartment 或 ref 热替换。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function flushDocChange(text: string) {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        onDocChangedRef.current(text);
      }, docChangeDebounceMs(text.length));
    }

    const extensions: Extension[] = [
      history(),
      markdownIndentUnit,
      // drawSelection() 去掉：它把每行选区背景填满整行宽度直到容器右边缘，
      // 导致选区右侧无边距而文字右侧有 24px 边距，视觉上左右不对称。
      // 改用浏览器原生 ::selection，选区只包裹被选中的字符宽度，和文字边距一致。
      rectangularSelection(),
      EditorView.lineWrapping,
      linkInteractionCompartment.of(createLinkInteractionExtension()),
      // Prec 顺序即数组顺序：Mod-s 必须排在 defaultKeymap 之前，
      // 否则会被更靠前的绑定截胡（默认没绑 Mod-s，但保持这个顺序更稳）。
      // 面板挂到顶部，配合 theme 里的绝对定位浮在右上角，不挤压正文布局。
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onRequestSaveRef.current?.();
            // 恒定返回 true，让 WebView 的「保存网页」不再有机会接手。
            return true;
          },
        },
        // Ctrl+F / Ctrl+R 都开同一个面板（面板本身自带替换输入框）。
        // 必须 preventDefault：Ctrl+R 在 WebView 里是刷新页面，一旦漏下去当前编辑内容就没了。
        {
          key: "Mod-f",
          preventDefault: true,
          run: (view) => {
            openSearchPanel(view);
            return true;
          },
        },
        {
          key: "Mod-r",
          preventDefault: true,
          run: (view) => {
            openSearchPanel(view);
            // 面板是下一帧才插进 DOM 的，同步 querySelector 拿不到替换框。
            requestAnimationFrame(() => {
              const replaceInput = view.dom.querySelector<HTMLInputElement>('.cm-panel.cm-search input[name="replace"]');
              replaceInput?.select();
            });
            return true;
          },
        },
        {
          key: "Escape",
          run: (view) => {
            // 没开面板时返回 false，把 Esc 让给其他绑定（比如退出多光标）。
            return closeSearchPanel(view);
          },
        },
        // 剩下的面板内快捷键（Enter 下一个、Shift-Enter 上一个、Mod-Alt-g 跳转等）
        // 直接复用官方绑定；它自带的 Mod-f/Mod-r/Escape 因为排在上面几条之后，不会抢先。
        ...searchKeymap,
        // 这两条来自 lang-markdown，是列表续行和退格删标记的手感关键，
        // 必须排在 defaultKeymap 的 Enter/Backspace 之前。
        { key: "Enter", run: insertNewlineContinueMarkup },
        { key: "Backspace", run: deleteMarkupBackward },
        // 加粗/斜体这类快捷键排在 defaultKeymap 之前：Mod-i 在默认绑定里
        // 是缩进相关的，不抢先会被它接走。
        ...markdownFormattingKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      // GFM 显式带上：删除线/表格/任务列表都在里面，
      // markdownLanguage 作为 base 已含 GFM，但显式声明能保证换 base 时不悄悄丢功能。
      // codeLanguages 是代码块高亮的开关：不传的话 lang-markdown 只把围栏内
      // 认成一整块 monospace，语言级 token 无从区分，编辑器和 Word 预览的
      // 配色就永远对不上。languages 是按需懒加载的，不会全进主 chunk。
      markdown({ base: livePreviewMarkdownLanguage, extensions: GFM, codeLanguages: languages, addKeymap: false }),
      livePreviewCompartment.of(livePreviewPlugin),
      mermaidCompartment.of(mermaidBlockExtension(isDark)),
      tableBlockExtension,
      // 换掉原来的 textarea 后无障碍名会丢：contenteditable 自己不带 label，
      // 屏幕阅读器只会读出「编辑框」而不知道这是什么编辑框。
      EditorView.contentAttributes.of({ "aria-label": "Markdown 输入内容" }),
      themeCompartment.of(markdownEditorTheme(isDark)),
      readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const isExternal = update.transactions.some((tr) => tr.annotation(externalUpdate));
        const text = update.state.doc.toString();
        if (!isExternal) onDirtyRef.current?.();
        flushDocChange(text);
      }),
    ];

    if (placeholder) extensions.push(cmPlaceholder(placeholder));

    const view = new EditorView({
      state: EditorState.create({ doc: initialContentRef.current, extensions }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 事件处理器由 HMR 更新时，不重建编辑器和 undo 历史，只替换当前实例的命中规则。
  useEffect(() => {
    viewRef.current?.dispatch({ effects: linkInteractionCompartment.reconfigure(createLinkInteractionExtension()) });
  }, [createLinkInteractionExtension, linkInteractionCompartment]);

  // 主题热替换：只换 compartment 内容，view 保持不变，所以光标和 undo 历史都在。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        themeCompartment.reconfigure(markdownEditorTheme(isDark)),
        mermaidCompartment.reconfigure(mermaidBlockExtension(isDark)),
      ],
    });
  }, [isDark, mermaidCompartment, themeCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: livePreviewCompartment.reconfigure(livePreviewPlugin),
    });
  }, [livePreviewCompartment, livePreviewPlugin]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly, readOnlyCompartment]);

  // 换文件：只认 documentKey 变化。用 initialContent 变化做判据的话，
  // 用户每敲一个字父组件回传新内容都会触发一次全量替换，光标直接跳到文首。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (lastDocumentKeyRef.current === documentKey) return;
    lastDocumentKeyRef.current = documentKey;

    const next = initialContentRef.current;
    if (view.state.doc.toString() === next) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: 0 },
      annotations: externalUpdate.of(true),
      // 换文件后旧文档的 undo 历史没有意义，撤回过去只会撤出上一个文件的内容。
      // 这里不清历史是刻意的：CM 的 history 会把整段替换当成一步，Ctrl+Z 能整体回退，
      // 由上层的自动保存/冲突流程决定是否需要更强的隔离。
      scrollIntoView: true,
    });
  }, [documentKey]);

  return <div ref={hostRef} className={cn("mk-cm-host min-h-0 flex-1 overflow-hidden", className)} />;
});
