import { ClipboardPaste, FileText, Maximize2, UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle } from "@/components/editor/live-markdown-editor";
import { TooltipButton } from "@/components/ui/tooltip";
import { markdownFileAccept, readMarkdownFile } from "@/lib/markdown-files";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";

type ConversionInputCardProps = {
  markdown: string;
  /// 换文档时变化的 key：内容变化不触发编辑器重载，只有它变了才做全量替换。
  documentKey: string;
  /// 一个标签都没打开时显示引导区，而不是一个空编辑器。
  hasDocument?: boolean;
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
};

export function ConversionInputCard({
  markdown,
  documentKey,
  hasDocument = true,
  disabled = false,
  isDark = false,
  onChange,
  onFileTextLoad,
  onNativeFileSelect,
  onBatchSelect,
  onReadClipboard,
  externalDragging = false,
  onRequestSave,
}: ConversionInputCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<LiveMarkdownEditorHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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

  return (
    <section className={cn("mk-card relative flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] max-[760px]:min-h-[300px]", isExpanded ? "fixed inset-6 z-50 h-auto bg-white/95 shadow-2xl dark:bg-slate-950" : "h-full max-[1100px]:h-auto")}>
      {/* 实时渲染下用户直接敲 Markdown 语法即可，格式工具栏是多余的一层；
          加粗/斜体这类快捷键保留在编辑器的 keymap 里。放大按钮浮在右上角，
          不为它单独占一条工具栏的高度。 */}
      <TooltipButton
        type="button"
        className="mk-editor-tool-button absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-[8px] border border-slate-200 bg-white/90 text-slate-600 backdrop-blur transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        disabled={disabled}
        aria-label={isExpanded ? "退出放大编辑区" : "放大编辑区"}
        tooltip={isExpanded ? "退出放大" : "放大编辑区"}
        tooltipSide="left"
        onClick={() => setIsExpanded((value) => !value)}
      >
        <Maximize2 className="size-3.5" />
      </TooltipButton>

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
          readOnly={disabled}
          isDark={isDark}
          placeholder={"# 文档标题\n\n直接书写 Markdown，编辑器会实时渲染。"}
          onDocChanged={onChange}
          onRequestSave={onRequestSave}
          className="h-full"
        />
      ) : (
        <div
          className={cn(
            "mk-drop-zone m-3 flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-[12px] p-5 text-center transition-all",
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
    </section>
  );
}
