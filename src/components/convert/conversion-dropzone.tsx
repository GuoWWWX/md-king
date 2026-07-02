import { ClipboardPaste, FileText, Lock, UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";

const markdownFileAccept = ".md,.markdown,text/markdown";

function isMarkdownFile(file: File) {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith(".md") || fileName.endsWith(".markdown");
}

type ConversionDropzoneProps = {
  onFileTextLoad: (text: string, file: File) => void;
  onReadClipboard: () => void;
  disabled?: boolean;
};

export function ConversionDropzone({ onFileTextLoad, onReadClipboard, disabled = false }: ConversionDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function loadMarkdownFile(file: File) {
    if (!isMarkdownFile(file)) {
      toast.error("不支持的文件类型，请选择 .md 或 .markdown 文件");
      return;
    }

    try {
      const text = await file.text();
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
      toast.error("请一次拖入单个 Markdown 文件");
      return;
    }
    void loadMarkdownFile(files[0]);
  }

  return (
    <AppSurface
      padding="none"
      radius="sm"
      className={cn(
        "border-dashed border-slate-300 p-6 transition-all",
        "hover:border-indigo-300 hover:bg-indigo-50/30",
        isDragging && "border-indigo-500 bg-indigo-50 shadow-lg shadow-indigo-100",
      )}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept={markdownFileAccept} className="hidden" onChange={handleInputChange} disabled={disabled} />
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-8 ring-indigo-50/50">
          <UploadCloud className="size-8" />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h3 className="text-lg font-semibold text-slate-950">把 Markdown 文件拖到这里</h3>
          <Badge className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
            <Lock className="size-3" />
            本地转换
          </Badge>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">支持 .md / .markdown 文件，也可以直接读取剪贴板里的 AI Markdown 内容。</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <PrimaryActionButton type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>
            <FileText className="size-4" />
            选择 Markdown 文件
          </PrimaryActionButton>
          <SoftActionButton type="button" onClick={onReadClipboard} disabled={disabled}>
            <ClipboardPaste className="size-4" />
            从剪贴板读取
          </SoftActionButton>
        </div>
      </div>
    </AppSurface>
  );
}
