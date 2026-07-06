import { Bold, ClipboardPaste, Code2, FileText, Heading2, Image, Italic, Link, List, Maximize2, Quote, RotateCcw, Table2, UploadCloud, type LucideIcon } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { markdownFileAccept, readMarkdownFile } from "@/lib/markdown-files";
import { cn } from "@/lib/utils";

type ConversionInputCardProps = {
  markdown: string;
  mode?: "markdown" | "file";
  disabled?: boolean;
  onChange: (value: string) => void;
  onFileTextLoad: (text: string, file: File) => void;
  onBatchSelect?: () => void | Promise<void>;
  onReadClipboard: () => void | Promise<void>;
};

type ToolbarAction = "clear" | "bold" | "italic" | "code" | "heading" | "list" | "quote" | "link" | "image" | "table";

const toolbarGroups: Array<{ label: string; items: Array<{ action: ToolbarAction; label: string; icon: LucideIcon }> }> = [
  {
    label: "编辑",
    items: [{ action: "clear", label: "清空内容", icon: RotateCcw }],
  },
  {
    label: "格式",
    items: [
      { action: "bold", label: "加粗", icon: Bold },
      { action: "italic", label: "斜体", icon: Italic },
      { action: "code", label: "行内代码", icon: Code2 },
    ],
  },
  {
    label: "结构",
    items: [
      { action: "heading", label: "二级标题", icon: Heading2 },
      { action: "list", label: "无序列表", icon: List },
      { action: "quote", label: "引用块", icon: Quote },
    ],
  },
  {
    label: "插入",
    items: [
      { action: "link", label: "链接", icon: Link },
      { action: "image", label: "图片", icon: Image },
      { action: "table", label: "表格", icon: Table2 },
    ],
  },
];

export function ConversionInputCard({ markdown, mode = "markdown", disabled = false, onChange, onFileTextLoad, onBatchSelect, onReadClipboard }: ConversionInputCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  async function loadMarkdownFile(file: File) {
    try {
      const { text } = await readMarkdownFile(file);
      onFileTextLoad(text, file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取文件失败");
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

  function replaceSelection(nextText: string, cursorOffset = nextText.length) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${markdown.slice(0, start)}${nextText}${markdown.slice(end)}`;
    onChange(nextValue);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + cursorOffset;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function wrapSelection(before: string, after = before, placeholder = "文本") {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdown.slice(start, end) || placeholder;
    const nextText = `${before}${selected}${after}`;
    replaceSelection(nextText, before.length + selected.length);
  }

  function handleToolbarAction(action: ToolbarAction) {
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (action === "clear") {
      onChange("");
      window.requestAnimationFrame(() => textarea.focus());
      return;
    }

    const lineStart = markdown.lastIndexOf("\n", Math.max(0, textarea.selectionStart - 1)) + 1;
    const atLineStart = textarea.selectionStart === lineStart;
    const prefix = atLineStart ? "" : "\n";

    if (action === "bold") wrapSelection("**");
    if (action === "italic") wrapSelection("*");
    if (action === "code") wrapSelection("`");
    if (action === "heading") replaceSelection(`${prefix}## 标题\n`, prefix.length + 3);
    if (action === "list") replaceSelection(`${prefix}- 列表项\n`, prefix.length + 2);
    if (action === "quote") replaceSelection(`${prefix}> 引用内容\n`, prefix.length + 2);
    if (action === "link") replaceSelection("[链接文本](https://)", 6);
    if (action === "image") replaceSelection("![图片说明](图片地址)", 7);
    if (action === "table") replaceSelection(`${prefix}| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n`);
  }

  const showMarkdownEditor = mode === "markdown";
  const showDropZone = mode === "file";
  const singlePane = showMarkdownEditor !== showDropZone;

  return (
    <section className={cn("mk-card flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] max-[760px]:min-h-[300px]", isExpanded ? "fixed inset-6 z-50 h-auto bg-white/95 shadow-2xl dark:bg-slate-950" : "h-full max-[1100px]:h-auto")}>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-700/70 dark:bg-slate-950/35">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto py-1 text-slate-700 [scrollbar-width:none] dark:text-slate-300 [&::-webkit-scrollbar]:hidden">
          {showMarkdownEditor ? (
            <>
              {toolbarGroups.map((group, groupIndex) => (
                <div key={group.label} className="flex shrink-0 items-center gap-1" aria-label={group.label}>
                  {groupIndex > 0 ? <span className="mx-1 h-5 w-px shrink-0 bg-blue-100/80 dark:bg-slate-700/70" aria-hidden="true" /> : null}
                  {group.items.map(({ action, label, icon: Icon }) => (
                    <button
                      key={action}
                      type="button"
                      className="mk-editor-tool-button flex size-8 items-center justify-center rounded-[8px] border border-transparent text-slate-700 transition hover:-translate-y-px hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-white"
                      disabled={disabled || !showMarkdownEditor}
                      title={label}
                      aria-label={label}
                      onClick={() => handleToolbarAction(action)}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              ))}
            </>
          ) : <div className="h-8" />}
        </div>
        <button type="button" className="mk-editor-tool-button flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-700 transition hover:-translate-y-px hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:translate-y-0 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white" disabled={disabled} aria-label={isExpanded ? "退出放大编辑区" : "放大编辑区"} title={isExpanded ? "退出放大" : "放大编辑区"} onClick={() => setIsExpanded((value) => !value)}>
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      <div className={cn("grid min-h-0 flex-1 gap-3", singlePane ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_280px] max-[1180px]:grid-cols-1")}>
        {showMarkdownEditor ? (
        <div className="min-h-0 max-[1100px]:min-h-[360px] max-[760px]:min-h-[256px]">
          <Textarea
            ref={textareaRef}
            id="conversion-markdown-editor"
            name="markdown"
            aria-label="Markdown 输入内容"
            className="h-full min-h-[300px] resize-none rounded-none border-0 bg-transparent p-5 font-mono text-xs leading-6 text-slate-800 shadow-none focus-visible:ring-0 max-[760px]:min-h-[240px] dark:text-slate-200 dark:placeholder:text-slate-500"
            value={markdown}
            onChange={(event) => onChange(event.target.value)}
            placeholder={"# 文档标题\n\n把需要转换的 Markdown 粘贴到这里..."}
            disabled={disabled}
          />
        </div>
        ) : null}

        {showDropZone ? (
        <div
          className={cn(
            "mk-drop-zone flex min-h-[300px] flex-col items-center justify-center rounded-[12px] p-5 text-center transition-all",
            !singlePane && "max-[1180px]:hidden",
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
          <h4 className="text-lg font-black text-blue-700">导入 Markdown</h4>
          <p className="mt-2 max-w-[250px] text-xs leading-5 text-blue-900/55">选择单个文件可载入编辑区；批量导入会直接逐个生成 DOCX。</p>
          <div className="mt-5 flex flex-col gap-2">
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="rounded-[10px] bg-white px-4 text-blue-700 shadow-none hover:bg-blue-50">
              <UploadCloud className="size-4" />
              选择文件
            </Button>
            {onBatchSelect ? (
              <Button type="button" variant="outline" className="rounded-[10px] border-white/70 bg-white/70 text-blue-700 hover:bg-white" onClick={() => void Promise.resolve(onBatchSelect())} disabled={disabled}>
                <UploadCloud className="size-4" />
                批量导入
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="rounded-[10px] text-blue-700 hover:bg-white/70" onClick={() => void Promise.resolve(onReadClipboard())} disabled={disabled}>
              <ClipboardPaste className="size-4" />
              粘贴剪贴板
            </Button>
          </div>
        </div>
        ) : null}
      </div>
    </section>
  );
}
