import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { ClipboardPaste, FileText, UploadCloud, Undo2, Redo2, Scissors, Copy, Clipboard, CheckSquare, Save, IndentIncrease, IndentDecrease } from "lucide-react";
import { forwardRef, type ChangeEvent, type DragEvent, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle, type TableDisplayContext, type TableWidthMode } from "@/components/editor/live-markdown-editor";
import { adjustCodeBlockIndent, getCodeBlockIndentContext } from "@/components/editor/cm/formatting-keymap";
import { markdownFileAccept, readMarkdownFile } from "@/lib/markdown-files";
import { markdownOutlineRevealEvent, type MarkdownOutlineRevealTarget } from "@/lib/document-outline";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";

const contextMenuItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

type ConversionInputCardProps = {
  markdown: string;
  /// 换文档时变化的 key：内容变化不触发编辑器重载，只有它变了才做全量替换。
  documentKey: string;
  documentTabId?: string;
  /// 一个标签都没打开时显示引导区，而不是一个空编辑器。
  hasDocument?: boolean;
  /// 编辑卡片顶部的文档上下文信息，不单独渲染成卡片。
  documentInfo?: ReactNode;
  disabled?: boolean;
  isDark?: boolean;
  onChange: (value: string) => void;
  onFileTextLoad: (text: string, file: File) => void;
  onNativeFileSelect?: () => void | Promise<void>;
  onBatchSelect?: () => void | Promise<void>;
  onReadClipboard: () => void | Promise<void>;
  /// 桌面端的窗口级拖放正在进行。浏览器下的 HTML5 drop 由本组件自己处理，
  /// 这个只负责把桌面端那条通道的高亮状态透进来。
  externalDragging?: boolean;
  onRequestSave?: () => void;
  readingMode?: boolean;
  compactMode?: boolean;
  onOpenLink?: (target: string) => void;
  tableDefaultWidthMode?: TableWidthMode;
  onTableContextChange?: (context: TableDisplayContext) => void;
};

export type ConversionInputCardHandle = {
  setTableWidthMode: (mode: TableWidthMode, tableFrom: number | null) => TableDisplayContext | null;
};

export const ConversionInputCard = forwardRef<ConversionInputCardHandle, ConversionInputCardProps>(function ConversionInputCard({
  markdown,
  documentKey,
  documentTabId,
  hasDocument = true,
  documentInfo,
  disabled = false,
  isDark = false,
  onChange,
  onFileTextLoad,
  onNativeFileSelect,
  onBatchSelect,
  onReadClipboard,
  externalDragging = false,
  onRequestSave,
  readingMode = false,
  compactMode = false,
  onOpenLink,
  tableDefaultWidthMode = "content",
  onTableContextChange,
}: ConversionInputCardProps, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<LiveMarkdownEditorHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [codeIndentContext, setCodeIndentContext] = useState<ReturnType<typeof getCodeBlockIndentContext>>(null);

  useImperativeHandle(ref, () => ({
    setTableWidthMode: (mode, tableFrom) => editorRef.current?.setTableWidthMode(mode, tableFrom) ?? null,
  }), []);

  // 字符数统计去掉空白，行数排除空行，给用户有意义的计数。
  const docStats = useMemo(() => {
    if (!hasDocument || !markdown) return null;
    const lines = markdown.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0).length;
    const chars = markdown.replace(/\s/g, "").length;
    return { chars, lines: nonEmptyLines };
  }, [hasDocument, markdown]);

  useEffect(() => {
    if (!documentTabId) return undefined;

    const handleHeadingReveal = (event: Event) => {
      const target = (event as CustomEvent<MarkdownOutlineRevealTarget>).detail;
      if (!target || target.tabId !== documentTabId) return;
      const view = editorRef.current?.getView();
      if (!view) return;
      const line = view.state.doc.line(Math.min(Math.max(1, target.line), view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      view.focus();
    };

    window.addEventListener(markdownOutlineRevealEvent, handleHeadingReveal);
    return () => window.removeEventListener(markdownOutlineRevealEvent, handleHeadingReveal);
  }, [documentTabId]);

  async function loadMarkdownFile(file: File) {
    try {
      const { text } = await readMarkdownFile(file);
      onFileTextLoad(text, file);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "读取文件失败"));
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadMarkdownFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      event.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      toast.error("多文件请使用批量导入按钮");
      return;
    }
    void loadMarkdownFile(files[0]);
  }

  function getEditorView() {
    return editorRef.current?.getView() ?? null;
  }

  async function copyEditorSelection() {
    const view = getEditorView();
    if (!view) return;
    const selection = view.state.selection.main;
    const text = view.state.sliceDoc(selection.from, selection.to);
    if (!text) {
      toast.info("请先选中要复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制选中内容");
    } catch {
      toast.error("复制失败");
    }
  }

  async function cutEditorSelection() {
    const view = getEditorView();
    if (!view || view.state.selection.main.empty) return copyEditorSelection();
    await copyEditorSelection();
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to } });
  }

  async function pasteIntoEditor() {
    const view = getEditorView();
    if (!view) return onReadClipboard();
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    } catch {
      toast.error("读取剪贴板失败");
    }
  }

  function selectAllEditorText() {
    const view = getEditorView();
    if (!view) return;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
  }

  function undoEditor() {
    const view = getEditorView();
    if (view) undo(view);
  }

  function redoEditor() {
    const view = getEditorView();
    if (view) redo(view);
  }

  function updateCodeIndentContext(open: boolean) {
    const view = getEditorView();
    setCodeIndentContext(open && view ? getCodeBlockIndentContext(view) : null);
  }

  function changeCodeBlockIndent(delta: number) {
    const view = getEditorView();
    if (!view) return;
    adjustCodeBlockIndent(view, delta);
    view.focus();
  }

  return (
    <ContextMenu.Root onOpenChange={updateCodeIndentContext}>
      <ContextMenu.Trigger asChild>
        <section data-mk-context-menu className="mk-card relative flex h-full min-h-[360px] min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[5px] max-[760px]:min-h-[300px]">
      {documentInfo}
      {/* 拖放提示要盖在编辑器上：已有文档时引导区不渲染，
          没有这层的话桌面端拖文件进来毫无视觉反馈。 */}
      {externalDragging && hasDocument ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[10px] border-2 border-dashed border-blue-500 bg-blue-50/85 dark:border-blue-400 dark:bg-blue-950/70">
          <span className="text-sm font-bold text-blue-700 dark:text-blue-200">松开以在新标签中打开</span>
        </div>
      ) : null}

      {hasDocument ? (
        <LiveMarkdownEditor
          ref={editorRef}
          documentKey={documentKey}
          initialContent={markdown}
          readOnly={disabled || readingMode}
          isDark={isDark}
          placeholder={undefined}
          onDocChanged={onChange}
          onRequestSave={onRequestSave}
          onOpenLink={onOpenLink}
          openLinksOnClick
          tableDefaultWidthMode={tableDefaultWidthMode}
          onTableContextChange={onTableContextChange}
          className={cn("h-full", compactMode && "mk-editor-compact")}
        />
      ) : (
        <div
          className={cn(
            "mk-drop-zone m-3 flex min-h-[300px] min-w-0 max-w-full flex-1 flex-col items-center justify-center overflow-hidden rounded-[12px] p-5 text-center transition-all",
            (isDragging || externalDragging) && "border-blue-500 bg-blue-50",
          )}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input ref={inputRef} type="file" accept={markdownFileAccept} className="hidden" onChange={handleInputChange} disabled={disabled} />
          <div className="mk-file-cube mb-5 flex size-20 items-center justify-center rounded-[16px] text-white">
            <FileText className="size-10" />
          </div>
          <h4 className="text-lg font-black text-blue-700">开始写点什么</h4>
          <p className="mt-2 max-w-[260px] text-xs leading-5 text-blue-900/55">从左侧文件树打开文档，或用上方的 + 新建；也可以把 Markdown / TXT 文件拖到这里。</p>
          <div className="mt-5 flex flex-col gap-2">
            <Button type="button" onClick={() => onNativeFileSelect ? void Promise.resolve(onNativeFileSelect()) : inputRef.current?.click()} disabled={disabled} className="rounded-[10px] bg-white px-4 text-blue-700 shadow-none hover:bg-blue-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
              <UploadCloud className="size-4" />
              选择文件
            </Button>
            {onBatchSelect ? (
              <Button type="button" variant="outline" className="rounded-[10px] border-white/70 bg-white/70 text-blue-700 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-100 dark:hover:bg-zinc-700" onClick={() => void Promise.resolve(onBatchSelect())} disabled={disabled}>
                <UploadCloud className="size-4" />
                批量导入
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="rounded-[10px] text-blue-700 hover:bg-white/70 dark:text-zinc-200 dark:hover:bg-zinc-800/80 dark:hover:text-white" onClick={() => void Promise.resolve(onReadClipboard())} disabled={disabled}>
              <ClipboardPaste className="size-4" />
              粘贴剪贴板
            </Button>
          </div>
        </div>
      )}
        {docStats ? (
          <div className="absolute bottom-2 right-3 select-none pointer-events-none text-[11px] text-slate-400 dark:text-zinc-500">
            {docStats.chars.toLocaleString()} 字 · {docStats.lines.toLocaleString()} 行
          </div>
        ) : null}
        </section>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 w-fit rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <ContextMenu.Item className={contextMenuItemClass} onSelect={undoEditor} disabled={!hasDocument}><Undo2 /><span className="flex-1">撤销</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+Z</span></ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={redoEditor} disabled={!hasDocument}><Redo2 /><span className="flex-1">重做</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+Y</span></ContextMenu.Item>
          <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => void cutEditorSelection()} disabled={!hasDocument}><Scissors /><span className="flex-1">剪切</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+X</span></ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => void copyEditorSelection()} disabled={!hasDocument}><Copy /><span className="flex-1">复制</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+C</span></ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => void pasteIntoEditor()}><Clipboard /><span className="flex-1">粘贴</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+V</span></ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={selectAllEditorText} disabled={!hasDocument}><CheckSquare /><span className="flex-1">全选</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+A</span></ContextMenu.Item>
          {codeIndentContext ? (
            <>
              <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
              <ContextMenu.Item className={contextMenuItemClass} onSelect={() => changeCodeBlockIndent(-24)} disabled={!codeIndentContext.canOutdent}><IndentDecrease /><span className="flex-1">减少代码块缩进</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+[</span></ContextMenu.Item>
              <ContextMenu.Item className={contextMenuItemClass} onSelect={() => changeCodeBlockIndent(24)} disabled={!codeIndentContext.canIndent}><IndentIncrease /><span className="flex-1">增加代码块缩进</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+]</span></ContextMenu.Item>
            </>
          ) : null}
          <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onRequestSave?.()} disabled={!hasDocument || !onRequestSave}><Save /><span className="flex-1">保存</span><span className="ml-4 text-xs text-slate-400 dark:text-zinc-500">Ctrl+S</span></ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});
