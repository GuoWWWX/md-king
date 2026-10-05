import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { languages } from "@codemirror/language-data";
import { closeSearchPanel, getSearchQuery, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, rectangularSelection } from "@codemirror/view";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import "katex/dist/katex.min.css";
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isSupportedImagePath } from "@/lib/image-files";
import { parseYamlFrontmatter } from "@/lib/markdown-frontmatter";
import { cn } from "@/lib/utils";
import {
  markdownVisibleLineChangeEvent,
  markdownVisibleLineQueryEvent,
  parseMarkdownOutline,
  resolveActiveHeadingFromReadingLine,
  type MarkdownOutlineItem,
  type MarkdownVisibleLineChangeDetail,
} from "@/lib/document-outline";
import { frontmatterBlockExtension, getTableDisplayContext, livePreviewPlugin, markdownImageBlockExtension, markdownMathBlockExtension, mermaidBlockExtension, renderFrontmatterEffect, resetCalloutCollapsedEffect, tableBlockExtension, tableSyntaxRefreshPlugin, type TableDisplayContext } from "./cm/live-preview";
import { documentTitleExtension } from "./cm/document-title";
import { markdownCursorExtension } from "./cm/cursor";
import { markdownFormattingKeymap, markdownIndentUnit } from "./cm/formatting-keymap";
import { markdownLinkInteractionExtension } from "./cm/link-interactions";
import { livePreviewMarkdownLanguage } from "./cm/markdown-language";
import { revealHighlightExtension } from "./cm/reveal-highlight";
import { resetTableDisplaySettingsEffect, setTableWidthModeEffect, tableContextChangeEvent, type TableWidthMode } from "./cm/table-display-settings";
import { tableBlockPasteExtension } from "./cm/table-block-paste";
import { markdownEditorTheme } from "./cm/theme";
import { refreshLiveMermaidTheme } from "./cm/widgets";

export type { TableDisplayContext } from "./cm/live-preview";
export type { TableWidthMode } from "./cm/table-display-settings";

export type LiveMarkdownEditorProps = {
  /** 受控换文件的判据：只有它变了才做全量替换，内容变化不触发（否则每次自己的输入都会把光标打回去）。 */
  documentKey: string;
  /** 标签的稳定 id；revision 变化时 documentKey 会变，但视图位置仍属于同一个标签。 */
  documentId?: string;
  initialContent: string;
  viewState?: LiveMarkdownViewState;
  onViewStateChange?: (documentId: string, viewState: LiveMarkdownViewState) => void;
  /** 只读显示在文档属性之前，不写入 Markdown 源码。 */
  documentTitle?: string;
  /** 确认标题编辑后重命名磁盘文件；返回 false 时恢复原文件名。 */
  onDocumentTitleChange?: (nextTitle: string) => Promise<boolean>;
  /** 用于解析 Markdown 图片的相对路径。 */
  markdownSourcePath?: string;
  readOnly?: boolean;
  isDark: boolean;
  placeholder?: string;
  /** 内部按文档体量 debounce 后调用——Word 预览那条管线很重，不能每个按键跑一遍。 */
  onDocChanged: (text: string) => void;
  /** 每次真实用户输入立即调用，不 debounce。给「未保存」状态用，脏标记必须是即时的。 */
  onDirty?: () => void;
  onRequestSave?: () => void;
  /** 返回可直接插入编辑器的 Markdown 图片语法；落盘逻辑由页面层持有。 */
  onImportImage?: (file: File) => Promise<string | undefined>;
  onOpenLink?: (target: string) => void;
  openLinksOnClick?: boolean;
  /** 未选中表格时使用的编辑器表格宽度默认值。 */
  tableDefaultWidthMode?: TableWidthMode;
  onTableContextChange?: (context: TableDisplayContext) => void;
  className?: string;
};

export type LiveMarkdownViewState = {
  scrollTop: number;
  anchor: number;
  head: number;
  scrollAnchor?: number;
  scrollAnchorOffset?: number;
};

export type LiveMarkdownEditorHandle = {
  /** 容器 display:none 后重新显示时 CM 测不到高度，需要外部触发重测。 */
  requestMeasure: () => void;
  focus: () => void;
  getValue: () => string;
  /** 供工具栏之类的外部逻辑直接 dispatch，拿不到时说明 view 还没挂载。 */
  getView: () => EditorView | null;
  insertText: (text: string) => boolean;
  importImage: (file: File) => Promise<boolean>;
  /** 未选中表格时更新全部表格；传入表格位置时只改当前表格。 */
  setTableWidthMode: (mode: TableWidthMode, tableFrom: number | null) => TableDisplayContext | null;
};

/** 标记「这次改动来自外部载入而非用户输入」，避免把程序化替换误报成脏数据。 */
const externalUpdate = Annotation.define<boolean>();
const linkInteractionVersion = "strict-hitbox-v6";

const searchPhrases = {
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全选",
  "match case": "大小写",
  regexp: "正则",
  "by word": "全词",
  replace: "替换",
  "replace all": "全替换",
  close: "关闭查找",
};

type SearchPanelMode = "find" | "replace";

function updateSearchResultStatus(view: EditorView, panel: HTMLElement) {
  const output = panel.querySelector<HTMLElement>("[data-mk-search-result-count]");
  if (!output) return;

  const query = getSearchQuery(view.state);
  let count = 0;
  let current = 0;
  let truncated = false;
  if (query.valid) {
    const selection = view.state.selection.main;
    const cursor = query.getCursor(view.state);
    while (true) {
      const next = cursor.next();
      if (next.done) break;
      count += 1;
      if (selection.from === next.value.from && selection.to === next.value.to) current = count;
      if (count >= 9999) {
        truncated = true;
        break;
      }
    }
  }

  output.textContent = count === 0
    ? "0 个结果"
    : current > 0
      ? `${current}/${truncated ? "9999+" : count}`
      : `${truncated ? "9999+" : count} 个结果`;

  panel.querySelectorAll<HTMLButtonElement>("button[name='prev'], button[name='next'], button[name='replace'], button[name='replaceAll']")
    .forEach((button) => {
      button.disabled = count === 0;
    });
}

function setSearchReplaceExpanded(panel: HTMLElement, expanded: boolean, focusReplace = false) {
  panel.dataset.searchMode = expanded ? "replace" : "find";
  const toggle = panel.querySelector<HTMLButtonElement>("[data-mk-search-replace-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "收起替换" : "展开替换");
    toggle.dataset.tooltip = expanded ? "收起替换" : "展开替换";
    toggle.removeAttribute("title");
    toggle.innerHTML = renderToStaticMarkup(createElement(expanded ? ChevronDown : ChevronRight, { size: 15, strokeWidth: 2 }));
  }
  if (focusReplace) {
    const replaceInput = panel.querySelector<HTMLInputElement>('input[name="replace"]');
    replaceInput?.focus();
    replaceInput?.select();
  }
}

function prepareSearchPanel(view: EditorView, panel: HTMLElement) {
  if (panel.querySelector("[data-mk-search-replace-toggle]")) return;

  const searchInput = panel.querySelector<HTMLInputElement>("input[name='search']");
  const replaceInput = panel.querySelector<HTMLInputElement>("input[name='replace']");
  const closeButton = panel.querySelector<HTMLButtonElement>("button[name='close']");
  if (!searchInput || !replaceInput || !closeButton) return;

  const iconMarkup = (icon: typeof Search) => renderToStaticMarkup(createElement(icon, { size: 15, strokeWidth: 2 }));
  const setIconButton = (button: HTMLButtonElement | null, icon: typeof Search, label: string) => {
    if (!button) return;
    button.dataset.mkSearchIconButton = "";
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    button.removeAttribute("title");
    button.innerHTML = iconMarkup(icon);
  };

  const findRow = document.createElement("div");
  findRow.dataset.mkSearchFindRow = "";

  const replaceRow = document.createElement("div");
  replaceRow.dataset.mkSearchReplaceRow = "";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.dataset.mkSearchReplaceToggle = "";
  toggle.addEventListener("click", () => {
    setSearchReplaceExpanded(panel, panel.dataset.searchMode !== "replace");
  });

  const findField = document.createElement("div");
  findField.dataset.mkSearchFindField = "";
  const searchIcon = document.createElement("span");
  searchIcon.dataset.mkSearchFieldIcon = "";
  searchIcon.setAttribute("aria-hidden", "true");
  searchIcon.innerHTML = iconMarkup(Search);
  findField.append(searchIcon, searchInput);

  const optionLabels: Array<{ inputName: string; key: string; label: string; text: string }> = [
    { inputName: "case", key: "case", label: "大小写", text: "Aa" },
    { inputName: "word", key: "word", label: "全词匹配", text: "词" },
    { inputName: "re", key: "regexp", label: "正则表达式", text: ".*" },
  ];
  optionLabels.forEach(({ inputName, key, label, text }) => {
    const input = panel.querySelector<HTMLInputElement>(`input[name='${inputName}']`);
    const option = input?.closest<HTMLLabelElement>("label");
    if (!input || !option) return;
    option.dataset.mkSearchOption = key;
    option.setAttribute("aria-label", label);
    option.dataset.tooltip = label;
    option.removeAttribute("title");
    const optionText = document.createElement("span");
    optionText.dataset.mkSearchOptionText = "";
    optionText.textContent = text;
    option.replaceChildren(input, optionText);
    findField.append(option);
  });

  const previousButton = panel.querySelector<HTMLButtonElement>("button[name='prev']");
  const nextButton = panel.querySelector<HTMLButtonElement>("button[name='next']");
  setIconButton(previousButton, ArrowUp, "上一个");
  setIconButton(nextButton, ArrowDown, "下一个");
  closeButton.dataset.mkSearchIconButton = "";
  closeButton.setAttribute("aria-label", "关闭查找");
  closeButton.dataset.tooltip = "关闭查找";
  closeButton.removeAttribute("title");
  closeButton.innerHTML = iconMarkup(X);

  findRow.append(toggle, findField);
  const resultCount = document.createElement("span");
  resultCount.dataset.mkSearchResultCount = "";
  resultCount.setAttribute("aria-live", "polite");
  findRow.append(resultCount);
  if (previousButton) findRow.append(previousButton);
  if (nextButton) findRow.append(nextButton);
  findRow.append(closeButton);

  const replaceIndent = document.createElement("span");
  replaceIndent.dataset.mkSearchReplaceIndent = "";
  replaceIndent.setAttribute("aria-hidden", "true");
  const replaceField = document.createElement("div");
  replaceField.dataset.mkSearchReplaceField = "";
  const replaceIcon = searchIcon.cloneNode(true) as HTMLElement;
  replaceField.append(replaceIcon, replaceInput);
  replaceRow.append(replaceIndent, replaceField);
  ["replace", "replaceAll"].forEach((name) => {
    const button = panel.querySelector<HTMLButtonElement>(`button[name='${name}']`);
    if (button) replaceRow.append(button);
  });

  panel.replaceChildren(findRow, replaceRow);
  const scheduleStatusUpdate = () => requestAnimationFrame(() => updateSearchResultStatus(view, panel));
  searchInput.addEventListener("input", scheduleStatusUpdate);
  panel.querySelectorAll<HTMLInputElement>("[data-mk-search-option] input").forEach((input) => input.addEventListener("change", scheduleStatusUpdate));
  panel.querySelectorAll<HTMLButtonElement>("button[name='prev'], button[name='next'], button[name='replace'], button[name='replaceAll']")
    .forEach((button) => button.addEventListener("click", scheduleStatusUpdate));
  updateSearchResultStatus(view, panel);
}

function showSearchPanel(view: EditorView, mode: SearchPanelMode) {
  openSearchPanel(view);
  // CodeMirror 会在 dispatch 后更新浮层 DOM，下一帧再切换模式并聚焦对应输入框。
  requestAnimationFrame(() => {
    const panel = view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
    if (!panel) return;
    prepareSearchPanel(view, panel);
    setSearchReplaceExpanded(panel, mode === "replace", mode === "replace");
    if (mode === "find") {
      const searchInput = panel.querySelector<HTMLInputElement>('input[name="search"]');
      searchInput?.focus();
      searchInput?.select();
    }
  });
}

function docChangeDebounceMs(length: number): number {
  if (length >= 300_000) return 700;
  if (length >= 80_000) return 400;
  return 200;
}

function initialEditorSelection(content: string, viewState?: LiveMarkdownViewState) {
  if (viewState) {
    return {
      anchor: Math.min(Math.max(0, viewState.anchor), content.length),
      head: Math.min(Math.max(0, viewState.head), content.length),
    };
  }
  return { anchor: parseYamlFrontmatter(content)?.to ?? 0 };
}

/**
 * 基于第一性原理与用户交互体验：
 * 检测当前窗口第一行（视口顶部）呈现的是哪一行内容，并精确映射到所属的大纲章节。
 * 
 * 核心优化（略微扩展首行标题感应区）：
 * 只要当前窗口第一行区域已经显现了某个章节的标题（视口顶部偏下 0~36px 内），
 * 右侧目录立即高亮该章节，绝不需要等用户把标题完全或部分覆盖后才切换。
 */
export function detectViewportReadingLine(
  view: EditorView,
  outline: MarkdownOutlineItem[],
): { line: number; activeHeadingLine: number | undefined } {
  const doc = view.state.doc;
  const totalLines = doc.lines;
  if (outline.length === 0 || totalLines <= 0) {
    return { line: 1, activeHeadingLine: undefined };
  }

  const scrollDOM = view.scrollDOM;
  const scrollTop = scrollDOM.scrollTop;

  // 文首保护：极小滚动量时直接激活首个章节
  if (scrollTop <= 15) {
    return { line: 1, activeHeadingLine: outline[0].line };
  }

  const scrollRect = scrollDOM.getBoundingClientRect();
  if (scrollRect.height <= 0 || scrollRect.width <= 0) {
    const targetHeight = Math.max(0, scrollTop + 20);
    const scrollBlock = view.lineBlockAtHeight(targetHeight);
    const line = doc.lineAt(scrollBlock.from).number;
    return { line, activeHeadingLine: resolveActiveHeadingFromReadingLine(outline, line) };
  }

  const viewportTop = scrollRect.top;
  const viewportBottom = scrollRect.bottom;

  // 首行标题感应带（视口顶部 0~36px，约 1~1.5 行高）：
  // 当新章节标题刚刚出现在视口首行时立即高亮，消除等待覆盖的滞后感
  const headingTopZone = viewportTop + 36;

  let firstVisibleLine: number | null = null;
  let topZoneHeadingLine: number | null = null;

  // 遍历 contentDOM 真实渲染的子节点，寻找当前窗口第一行露出展示的实质内容
  const children = view.contentDOM.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (!child || child.nodeType !== Node.ELEMENT_NODE) continue;
    if (
      child.classList.contains("cm-gap") ||
      child.classList.contains("mk-doc-title-input") ||
      child.hasAttribute("data-mk-doc-title-host")
    ) {
      continue;
    }

    const rect = child.getBoundingClientRect();
    // 已经完全滚出视口上方
    if (rect.bottom <= viewportTop + 2) continue;
    // 超出视口底部，停止
    if (rect.top >= viewportBottom) break;

    let childLine: number | null = null;
    try {
      const pos = view.posAtDOM(child);
      if (typeof pos === "number" && pos >= 0 && pos <= doc.length) {
        childLine = doc.lineAt(pos).number;
      }
    } catch {
      // 容错：个别复合节点跳过尝试下一个
    }

    if (childLine === null) continue;

    // 记录视口第一行露出的内容行号
    if (firstVisibleLine === null) {
      firstVisibleLine = childLine;
    }

    // 只要窗口第一行区域已经显现了某个章节的标题，立即捕获该标题
    if (rect.top <= headingTopZone && topZoneHeadingLine === null) {
      const isHeading =
        child.classList.contains("mk-cm-heading") ||
        Boolean(child.querySelector(".mk-cm-heading")) ||
        outline.some((h) => h.line === childLine);
      if (isHeading) {
        const matching = outline.find((h) => h.line === childLine);
        if (matching) {
          topZoneHeadingLine = matching.line;
        }
      }
    }
  }

  // 双重保底：如果遍历未获取到，使用视口顶部物理坐标采样
  if (firstVisibleLine === null) {
    try {
      const probeX = scrollRect.left + Math.min(60, scrollRect.width * 0.2);
      const probeY = viewportTop + 10;
      const probePos = view.posAtCoords({ x: probeX, y: probeY });
      if (probePos !== null) {
        firstVisibleLine = doc.lineAt(probePos).number;
      }
    } catch {
      // ignore
    }
  }

  const readingLine = firstVisibleLine ?? 1;

  // 判定当前章节：
  // 1) 当前第一行显示的已经是某个章节的标题了，右侧目录立即高亮该章节；
  // 2) 否则按视口第一行正文所属区域，归属到大纲中最后一个 <= readingLine 的标题。
  let activeHeadingLine: number;
  if (topZoneHeadingLine !== null) {
    activeHeadingLine = topZoneHeadingLine;
  } else {
    activeHeadingLine = resolveActiveHeadingFromReadingLine(outline, readingLine) ?? outline[0].line;
  }

  return { line: readingLine, activeHeadingLine };
}

export const LiveMarkdownEditor = forwardRef<LiveMarkdownEditorHandle, LiveMarkdownEditorProps>(function LiveMarkdownEditor(
  { documentKey, documentId, initialContent, viewState, onViewStateChange, documentTitle, onDocumentTitleChange, markdownSourcePath, readOnly = false, isDark, placeholder, onDocChanged, onDirty, onRequestSave, onImportImage, onOpenLink, openLinksOnClick = false, tableDefaultWidthMode = "content", onTableContextChange, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment()).current;
  const cursorCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const documentTitleCompartment = useRef(new Compartment()).current;
  const livePreviewCompartment = useRef(new Compartment()).current;
  const linkInteractionCompartment = useRef(new Compartment()).current;
  // mermaid 的块级装饰带着深浅色：主题变了图要重画，
  // 否则深色模式下拿到的还是缓存里的浅色版本。
  const mermaidCompartment = useRef(new Compartment()).current;
  const imageBlockCompartment = useRef(new Compartment()).current;
  const frontmatterCompartment = useRef(new Compartment()).current;

  // 回调放 ref 里读：EditorView 只创建一次，闭包捕获的是首次渲染的函数，
  // 直接用会一直调到过期的 props。
  const onDocChangedRef = useRef(onDocChanged);
  const onDirtyRef = useRef(onDirty);
  const onRequestSaveRef = useRef(onRequestSave);
  const onImportImageRef = useRef(onImportImage);
  const onOpenLinkRef = useRef(onOpenLink);
  const onDocumentTitleChangeRef = useRef(onDocumentTitleChange);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const openLinksOnClickRef = useRef(openLinksOnClick);
  const onTableContextChangeRef = useRef(onTableContextChange);
  const tableDefaultWidthModeRef = useRef(tableDefaultWidthMode);
  const appliedTableDefaultWidthModeRef = useRef(tableDefaultWidthMode);
  const activeTableFromRef = useRef<number | null>(null);
  onDocChangedRef.current = onDocChanged;
  onDirtyRef.current = onDirty;
  onRequestSaveRef.current = onRequestSave;
  onImportImageRef.current = onImportImage;
  onOpenLinkRef.current = onOpenLink;
  onDocumentTitleChangeRef.current = onDocumentTitleChange;
  onViewStateChangeRef.current = onViewStateChange;
  openLinksOnClickRef.current = openLinksOnClick;
  onTableContextChangeRef.current = onTableContextChange;
  tableDefaultWidthModeRef.current = tableDefaultWidthMode;
  const documentTitleEditable = !readOnly && Boolean(onDocumentTitleChange);

  const debounceRef = useRef<number | null>(null);
  // 首个 documentKey 已经由 initialContent 建进 state，不能在 mount 后再替换一次。
  const lastDocumentKeyRef = useRef(documentKey);
  const activeDocumentIdRef = useRef(documentId);
  const reportVisibleLineRef = useRef<(() => void) | undefined>(undefined);
  const incomingViewStateRef = useRef(viewState);
  incomingViewStateRef.current = viewState;
  const viewStateTimerRef = useRef<number | undefined>(undefined);
  const restoreScrollFrameRef = useRef<number | undefined>(undefined);
  const restoreScrollReleaseTimerRef = useRef<number | undefined>(undefined);
  const restoringDocumentIdRef = useRef<string | undefined>(undefined);
  // 初始内容同理只在创建时读一次，之后的 props 变化不该反向覆盖用户正在编辑的内容。
  const initialContentRef = useRef(initialContent);
  initialContentRef.current = initialContent;
  const outlineRef = useRef<MarkdownOutlineItem[]>(parseMarkdownOutline(initialContent));

  function reportViewState(view: EditorView, targetDocumentId = activeDocumentIdRef.current) {
    if (!targetDocumentId || restoringDocumentIdRef.current === targetDocumentId) return;
    const selection = view.state.selection.main;
    const scrollTop = view.scrollDOM.scrollTop;
    const scrollBlock = view.lineBlockAtHeight(scrollTop);
    onViewStateChangeRef.current?.(targetDocumentId, {
      scrollTop,
      anchor: selection.anchor,
      head: selection.head,
      scrollAnchor: scrollBlock.from,
      scrollAnchorOffset: scrollBlock.top - scrollTop,
    });
  }

  function scheduleViewStateReport(view: EditorView) {
    if (viewStateTimerRef.current !== undefined) return;
    viewStateTimerRef.current = window.setTimeout(() => {
      viewStateTimerRef.current = undefined;
      if (viewRef.current === view) reportViewState(view);
    }, 120);
  }

  function restoreScrollPosition(view: EditorView, state: LiveMarkdownViewState | undefined, targetDocumentId = activeDocumentIdRef.current) {
    if (restoreScrollFrameRef.current !== undefined) window.cancelAnimationFrame(restoreScrollFrameRef.current);
    if (restoreScrollReleaseTimerRef.current !== undefined) window.clearTimeout(restoreScrollReleaseTimerRef.current);
    restoringDocumentIdRef.current = targetDocumentId;
    if (viewStateTimerRef.current !== undefined) {
      window.clearTimeout(viewStateTimerRef.current);
      viewStateTimerRef.current = undefined;
    }
    // 当未传入有效目标视口状态（新打开的文档）时，必须从头开始，立即将视口归零回到第一行
    if (!state && view.scrollDOM.scrollTop > 0) {
      view.scrollDOM.scrollTop = 0;
    }
    const scrollTop = Math.max(0, state?.scrollTop ?? 0);
    const scrollAnchor = state?.scrollAnchor === undefined
      ? undefined
      : Math.min(Math.max(0, state.scrollAnchor), view.state.doc.length);
    const scrollAnchorOffset = Number.isFinite(state?.scrollAnchorOffset)
      ? state!.scrollAnchorOffset!
      : 0;
    const apply = () => {
      if (viewRef.current !== view) return;
      view.requestMeasure({
        read(currentView) {
          const anchoredTop = scrollAnchor === undefined
            ? scrollTop
            : currentView.lineBlockAt(scrollAnchor).top - scrollAnchorOffset;
          return Math.min(
            Math.max(0, anchoredTop),
            Math.max(0, currentView.scrollDOM.scrollHeight - currentView.scrollDOM.clientHeight),
          );
        },
        write(nextScrollTop, currentView) {
          if (viewRef.current === currentView) currentView.scrollDOM.scrollTop = nextScrollTop;
        },
      });
    };
    restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
      apply();
      restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
        restoreScrollFrameRef.current = undefined;
        apply();
        restoreScrollReleaseTimerRef.current = window.setTimeout(() => {
          restoreScrollReleaseTimerRef.current = undefined;
          if (restoringDocumentIdRef.current === targetDocumentId) restoringDocumentIdRef.current = undefined;
        }, 160);
      });
    });
  }

  function insertTextIntoView(view: EditorView, text: string) {
    if (!text || view.state.facet(EditorState.readOnly)) return false;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    });
    view.focus();
    return true;
  }

  async function importImageFiles(view: EditorView, files: File[]) {
    if (view.state.facet(EditorState.readOnly) || !onImportImageRef.current) return false;
    let inserted = false;
    for (const file of files) {
      const markdown = await onImportImageRef.current(file);
      // 组件已卸载或文档已切换时，不能把慢回来的图片插入新标签。
      if (viewRef.current !== view || !markdown) continue;
      inserted = insertTextIntoView(view, markdown) || inserted;
    }
    return inserted;
  }

  const createLinkInteractionExtension = useCallback(() => markdownLinkInteractionExtension({
    openLinksOnClick: () => openLinksOnClickRef.current,
    onOpenLink: (target) => onOpenLinkRef.current?.(target),
  }), [linkInteractionVersion]);

  const reportTableContext = (tableFrom: number | null) => {
    const view = viewRef.current;
    if (!view) return null;
    const context = getTableDisplayContext(view.state, tableFrom);
    onTableContextChangeRef.current?.(context);
    return context;
  };

  useImperativeHandle(
    ref,
    () => ({
      requestMeasure: () => viewRef.current?.requestMeasure(),
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? "",
      getView: () => viewRef.current,
      insertText: (text) => {
        const view = viewRef.current;
        return view ? insertTextIntoView(view, text) : false;
      },
      importImage: async (file) => {
        const view = viewRef.current;
        return view ? importImageFiles(view, [file]) : false;
      },
      setTableWidthMode: (mode, tableFrom) => {
        const view = viewRef.current;
        if (!view) return null;
        if (tableFrom === null) appliedTableDefaultWidthModeRef.current = mode;
        view.dispatch({
          effects: setTableWidthModeEffect.of(
            tableFrom === null
              ? { scope: "global", mode }
              : { scope: "table", tableFrom, mode },
          ),
        });
        return reportTableContext(tableFrom);
      },
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
      cursorCompartment.of(markdownCursorExtension(isDark)),
      rectangularSelection(),
      EditorView.lineWrapping,
      linkInteractionCompartment.of(createLinkInteractionExtension()),
      // Prec 顺序即数组顺序：Mod-s 必须排在 defaultKeymap 之前，
      // 否则会被更靠前的绑定截胡（默认没绑 Mod-s，但保持这个顺序更稳）。
      // 面板挂到顶部，配合 theme 里的绝对定位浮在右上角，不挤压正文布局。
      search({ top: true }),
      highlightSelectionMatches(),
      revealHighlightExtension,
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
      // Ctrl+F 只显示查找，Ctrl+R 显示查找和替换。
      // 必须 preventDefault：Ctrl+R 在 WebView 里是刷新页面，一旦漏下去当前编辑内容就没了。
        {
          key: "Mod-f",
          preventDefault: true,
          run: (view) => {
            showSearchPanel(view, "find");
            return true;
          },
        },
        {
          key: "Mod-r",
          preventDefault: true,
          run: (view) => {
            showSearchPanel(view, "replace");
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
      documentTitleCompartment.of(documentTitleExtension(
        documentTitle,
        documentTitleEditable,
        (nextTitle) => onDocumentTitleChangeRef.current?.(nextTitle) ?? Promise.resolve(false),
        () => viewRef.current?.dispatch({ effects: renderFrontmatterEffect.of() }),
      )),
      frontmatterCompartment.of(frontmatterBlockExtension(!readOnly)),
      markdownMathBlockExtension,
      mermaidCompartment.of(mermaidBlockExtension(!readOnly)),
      imageBlockCompartment.of(markdownImageBlockExtension(markdownSourcePath, !readOnly)),
      tableBlockExtension,
      tableSyntaxRefreshPlugin,
      tableBlockPasteExtension,
      EditorView.domEventHandlers({
        drop: (event, view) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/") || isSupportedImagePath(file.name));
          if (files.length === 0 || !onImportImageRef.current) return false;
          event.preventDefault();
          void importImageFiles(view, files);
          return true;
        },
        paste: (event, view) => {
          const files = Array.from(event.clipboardData?.items ?? [])
            .filter((item) => item.kind === "file" && (item.type.startsWith("image/") || isSupportedImagePath(item.getAsFile()?.name ?? "")))
            .flatMap((item) => {
              const file = item.getAsFile();
              return file ? [file] : [];
            });
          if (files.length === 0 || !onImportImageRef.current) return false;
          event.preventDefault();
          void importImageFiles(view, files);
          return true;
        },
      }),
      // 换掉原来的 textarea 后无障碍名会丢：contenteditable 自己不带 label，
      // 屏幕阅读器只会读出「编辑框」而不知道这是什么编辑框。
      EditorView.contentAttributes.of({ "aria-label": "Markdown 输入内容" }),
      // CodeMirror 搜索面板使用 state phrase 注入文案，避免用 CSS 伪元素伪造中文按钮文字。
      EditorState.phrases.of(searchPhrases),
      themeCompartment.of(markdownEditorTheme(isDark)),
      readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) {
          const searchPanel = update.view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
          if (searchPanel) updateSearchResultStatus(update.view, searchPanel);
        }
        if (update.docChanged && activeTableFromRef.current !== null) {
          const previousTableFrom = activeTableFromRef.current;
          let tableFrom = previousTableFrom;
          update.transactions.forEach((transaction) => {
            if (transaction.docChanged) tableFrom = transaction.changes.mapPos(tableFrom);
          });
          activeTableFromRef.current = tableFrom;
          if (tableFrom !== previousTableFrom) reportTableContext(tableFrom);
        }
        if (update.selectionSet) scheduleViewStateReport(update.view);
        if (!update.docChanged) return;
        const isExternal = update.transactions.some((tr) => tr.annotation(externalUpdate));
        const text = update.state.doc.toString();
        outlineRef.current = parseMarkdownOutline(text);
        if (!isExternal) onDirtyRef.current?.();
        flushDocChange(text);
      }),
    ];

    if (placeholder) extensions.push(cmPlaceholder(placeholder));

    const view = new EditorView({
      state: EditorState.create({
        doc: initialContentRef.current,
        selection: initialEditorSelection(initialContentRef.current, incomingViewStateRef.current),
        extensions,
      }),
      parent: host,
    });
    viewRef.current = view;
    (window as any).__mk_editor_view = view;
    let visibleLineRafId: number | undefined;
    const reportVisibleLine = () => {
      if (visibleLineRafId !== undefined) return;
      visibleLineRafId = window.requestAnimationFrame(() => {
        visibleLineRafId = undefined;
        if (viewRef.current !== view) return;
        const currentDocId = activeDocumentIdRef.current;
        if (!currentDocId) return;
        try {
          const { line, activeHeadingLine } = detectViewportReadingLine(view, outlineRef.current);
          window.dispatchEvent(
            new CustomEvent<MarkdownVisibleLineChangeDetail>(markdownVisibleLineChangeEvent, {
              detail: { tabId: currentDocId, line, activeHeadingLine },
            }),
          );
        } catch {
          // 测量异常防御
        }
      });
    };
    reportVisibleLineRef.current = reportVisibleLine;
    const handleEditorScroll = () => {
      scheduleViewStateReport(view);
      reportVisibleLine();
    };
    view.scrollDOM.addEventListener("scroll", handleEditorScroll, { passive: true });
    restoreScrollPosition(view, incomingViewStateRef.current);
    reportVisibleLine();
    if (tableDefaultWidthModeRef.current !== "content") {
      view.dispatch({
        effects: setTableWidthModeEffect.of({ scope: "global", mode: tableDefaultWidthModeRef.current }),
      });
    }

    const handleTableContextChange = (event: Event) => {
      const tableFrom = (event as CustomEvent<{ tableFrom?: unknown }>).detail?.tableFrom;
      if (typeof tableFrom !== "number" || !Number.isInteger(tableFrom)) return;
      activeTableFromRef.current = tableFrom;
      reportTableContext(tableFrom);
    };
    const clearTableContextOnOutsidePointer = (event: PointerEvent) => {
      if (activeTableFromRef.current === null || !(event.target instanceof Element)) return;
      if (event.target.closest(".mk-cm-table-wrapper, [data-mk-table-width-controls]")) return;
      activeTableFromRef.current = null;
      reportTableContext(null);
    };
    host.addEventListener(tableContextChangeEvent, handleTableContextChange);
    document.addEventListener("pointerdown", clearTableContextOnOutsidePointer, true);

    const handleVisibleLineQuery = (event: Event) => {
      const targetTabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId;
      if (!targetTabId || targetTabId === activeDocumentIdRef.current) {
        reportVisibleLine();
      }
    };
    window.addEventListener(markdownVisibleLineQueryEvent, handleVisibleLineQuery);

    return () => {
      reportVisibleLineRef.current = undefined;
      reportViewState(view);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      if (viewStateTimerRef.current !== undefined) window.clearTimeout(viewStateTimerRef.current);
      if (visibleLineRafId !== undefined) window.cancelAnimationFrame(visibleLineRafId);
      if (restoreScrollFrameRef.current !== undefined) window.cancelAnimationFrame(restoreScrollFrameRef.current);
      if (restoreScrollReleaseTimerRef.current !== undefined) window.clearTimeout(restoreScrollReleaseTimerRef.current);
      view.scrollDOM.removeEventListener("scroll", handleEditorScroll);
      window.removeEventListener(markdownVisibleLineQueryEvent, handleVisibleLineQuery);
      host.removeEventListener(tableContextChangeEvent, handleTableContextChange);
      document.removeEventListener("pointerdown", clearTableContextOnOutsidePointer, true);
      view.destroy();
      viewRef.current = null;
      if (typeof window !== "undefined" && (window as any).__mk_editor_view === view) {
        delete (window as any).__mk_editor_view;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 事件处理器由 HMR 更新时，不重建编辑器和 undo 历史，只替换当前实例的命中规则。
  useEffect(() => {
    viewRef.current?.dispatch({ effects: linkInteractionCompartment.reconfigure(createLinkInteractionExtension()) });
  }, [createLinkInteractionExtension, linkInteractionCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: documentTitleCompartment.reconfigure(documentTitleExtension(
        documentTitle,
        documentTitleEditable,
        (nextTitle) => onDocumentTitleChangeRef.current?.(nextTitle) ?? Promise.resolve(false),
        () => viewRef.current?.dispatch({ effects: renderFrontmatterEffect.of() }),
      )),
    });
  }, [documentTitle, documentTitleCompartment, documentTitleEditable]);

  // 主题热替换：只换 theme 和 cursor 纯样式层，绝对不碰任何块级 StateField！
  // 杜绝因 StateField 重建导致视口外图表高度丢失、虚拟化 HeightMap 塌陷或阅读位置跳动。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const pinnedScrollTop = view.scrollDOM.scrollTop;

    view.dispatch({
      effects: [
        themeCompartment.reconfigure(markdownEditorTheme(isDark)),
        cursorCompartment.reconfigure(markdownCursorExtension(isDark)),
      ],
    });

    // 页面内可见的 Mermaid 图表就地更新深浅色，物理尺寸完全一致，零排版干扰
    refreshLiveMermaidTheme(view.dom, isDark);

    // 锁定视口滚动位置，杜绝主题切换引发的任何微小布局扰动
    if (view.scrollDOM.scrollTop !== pinnedScrollTop) {
      view.scrollDOM.scrollTop = pinnedScrollTop;
    }
  }, [cursorCompartment, isDark, themeCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: imageBlockCompartment.reconfigure(markdownImageBlockExtension(markdownSourcePath, !readOnly)),
    });
  }, [imageBlockCompartment, markdownSourcePath, readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: livePreviewCompartment.reconfigure(livePreviewPlugin),
    });
  }, [livePreviewCompartment, livePreviewPlugin]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        readOnlyCompartment.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        frontmatterCompartment.reconfigure(frontmatterBlockExtension(!readOnly)),
        mermaidCompartment.reconfigure(mermaidBlockExtension(!readOnly)),
      ],
    });
    if (readOnly) {
      activeTableFromRef.current = null;
      reportTableContext(null);
    }
  }, [frontmatterCompartment, mermaidCompartment, readOnly, readOnlyCompartment]);

  useEffect(() => {
    if (appliedTableDefaultWidthModeRef.current === tableDefaultWidthMode) return;
    appliedTableDefaultWidthModeRef.current = tableDefaultWidthMode;
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setTableWidthModeEffect.of({ scope: "global", mode: tableDefaultWidthMode }) });
    reportTableContext(activeTableFromRef.current);
  }, [tableDefaultWidthMode]);

  // 换文件：只认 documentKey 变化。用 initialContent 变化做判据的话，
  // 用户每敲一个字父组件回传新内容都会触发一次全量替换，光标直接跳到文首。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (lastDocumentKeyRef.current === documentKey) return;
    const previousDocId = activeDocumentIdRef.current;
    if (previousDocId && previousDocId !== documentId) {
      reportViewState(view, previousDocId);
    }
    lastDocumentKeyRef.current = documentKey;
    activeDocumentIdRef.current = documentId;

    const next = initialContentRef.current;
    const nextViewState = incomingViewStateRef.current;
    const selection = initialEditorSelection(next, nextViewState);
    outlineRef.current = parseMarkdownOutline(next);
    activeTableFromRef.current = null;
    if (view.state.doc.toString() === next) {
      view.dispatch({
        selection,
        effects: [
          resetTableDisplaySettingsEffect.of(tableDefaultWidthModeRef.current),
          resetCalloutCollapsedEffect.of(undefined),
        ],
      });
      restoreScrollPosition(view, nextViewState, documentId);
      reportTableContext(null);
      reportVisibleLineRef.current?.();
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection,
      effects: [
        resetTableDisplaySettingsEffect.of(tableDefaultWidthModeRef.current),
        resetCalloutCollapsedEffect.of(undefined),
      ],
      annotations: externalUpdate.of(true),
      // 换文件后旧文档的 undo 历史没有意义，撤回过去只会撤出上一个文件的内容。
      // 这里不清历史是刻意的：CM 的 history 会把整段替换当成一步，Ctrl+Z 能整体回退，
      // 由上层的自动保存/冲突流程决定是否需要更强的隔离。
    });
    restoreScrollPosition(view, nextViewState, documentId);
    reportTableContext(null);
    reportVisibleLineRef.current?.();
  }, [documentId, documentKey]);

  return <div ref={hostRef} className={cn("mk-cm-host min-h-0 flex-1 overflow-hidden", className)} />;
});
