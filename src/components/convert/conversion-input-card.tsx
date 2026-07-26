import { ClipboardPaste, FileText, Maximize2, UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle } from "@/components/editor/live-markdown-editor";
import { TooltipButton } from "@/components/ui/tooltip";
import { markdownFileAccept, readMarkdownFile } from "@/lib/markdown-files";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";

type ConversionInputCardProps = {
  markdown: string;
  /// 换文档时变化的 key：内容变化不触发编辑器重载，只有它变了才做全量替换。
  documentKey: string;
  mode?: "markdown" | "file";
  disabled?: boolean;
  isDark?: boolean;
  onChange: (value: string) => void;
  onFileTextLoad: (text: string, file: File) => void;
  onNativeFileSelect?: () => void | Promise<void>;
  onBatchSelect?: () => void | Promise<void>;
  onReadClipboard: () => void | Promise<void>;
  onRequestSave?: () => void;
};

export function ConversionInputCard({
  markdown,
  documentKey,
  mode = "markdown",
  disabled = false,
  isDark = false,
  onChange,
  onFileTextLoad,
  onNativeFileSelect,
  onBatchSelect,
  onReadClipboard,
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

  const showMarkdownEditor = mode === "markdown";

  return (
    <section className={cn("mk-card flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] max-[760px]:min-h-[300px]", isExpanded ? "fixed inset-6 z-50 h-auto bg-white/95 shadow-2xl dark:bg-slate-950" : "h-full max-[1100px]:h-auto")}>
      <EditorToolbar
        getView={() => editorRef.current?.getView() ?? null}
        disabled={disabled || !showMarkdownEditor}
        className={showMarkdownEditor ? undefined : "justify-end"}
        trailing={
          <TooltipButton
            type="button"
            className="mk-editor-tool-button flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-700 transition hover:-translate-y-px hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:translate-y-0 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            disabled={disabled}
            aria-label={isExpanded ? "退出放大编辑区" : "放大编辑区"}
            tooltip={isExpanded ? "退出放大" : "放大编辑区"}
            tooltipSide="bottom"
            onClick={() => setIsExpanded((value) => !value)}
          >
            <Maximize2 className="size-3.5" />
          </TooltipButton>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3">
        {showMarkdownEditor ? (
          <div className="min-h-0 max-[1100px]:min-h-[360px] max-[760px]:min-h-[256px]">
            <LiveMarkdownEditor
              ref={editorRef}
              documentKey={documentKey}
              initialContent={markdown}
              readOnly={disabled}
              isDark={isDark}
              placeholder={"# 文档标题\n\n把需要转换的 Markdown 粘贴到这里..."}
              onDocChanged={onChange}
              onRequestSave={onRequestSave}
              className="h-full"
            />
          </div>
        ) : (
          <div
            className={cn(
              "mk-drop-zone flex min-h-[300px] flex-col items-center justify-center rounded-[12px] p-5 text-center transition-all",
              isDragging && "border-blue-500 bg-blue-50",
            )}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input ref={inputRef} type="file" accept={markdownFileAccept} className="hidden" onChange={handleInputChange} disabled={disabled} />
            <div className="mk-file-cube mb-5 flex size-20 items-center justify-center rounded-[16px] text-white">
              <FileText className="size-10" />
            </div>
            <h4 className="text-lg font-black text-blue-700">导入 Markdown / TXT</h4>
            <p className="mt-2 max-w-[250px] text-xs leading-5 text-blue-900/55">选择单个文本文件可载入编辑区；批量导入后可勾选需要转换的文件。</p>
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
      </div>
    </section>
  );
}
