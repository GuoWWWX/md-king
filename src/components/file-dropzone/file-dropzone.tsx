import { type DragEvent, type ChangeEvent, useRef, useState } from "react";
import { ClipboardPaste, FileText, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const markdownFileAccept = ".md,.markdown,text/markdown";

function isMarkdownFile(file: File) {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith(".md") || fileName.endsWith(".markdown");
}

type FileDropzoneProps = {
  onFileTextLoad?: (text: string, file: File) => void;
  onReadClipboard?: () => void;
  onConvertCurrent?: () => void;
  disabled?: boolean;
};

export function FileDropzone({ onFileTextLoad, onReadClipboard, onConvertCurrent, disabled = false }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function loadMarkdownFile(file: File) {
    if (!isMarkdownFile(file)) {
      toast.error("仅支持拖入 .md 或 .markdown 文件");
      return;
    }

    try {
      const text = await file.text();
      onFileTextLoad?.(text, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取文件失败";
      toast.error(message);
    }
  }

  function handleChooseFile() {
    inputRef.current?.click();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    void loadMarkdownFile(file);
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

    if (disabled) {
      return;
    }

    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      toast.error("请一次拖入单个 Markdown 文件");
      return;
    }

    void loadMarkdownFile(files[0]);
  }

  return (
    <Card
      className={`border-dashed bg-card/75 transition-colors ${isDragging ? "border-primary bg-primary/5" : ""}`}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <CardContent className="flex min-h-40 flex-col gap-4 p-4 text-left sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <input ref={inputRef} type="file" accept={markdownFileAccept} className="hidden" onChange={handleInputChange} disabled={disabled} />
        <div className="flex min-w-0 items-start gap-4">
          <div className="rounded-lg border bg-background p-3 shadow-sm">
            <UploadCloud className="size-7 text-muted-foreground" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Markdown 文件转换</h2>
              <Badge variant="secondary">支持文件与剪贴板</Badge>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              选择或拖入单个 .md/.markdown 文件即可读取到下方编辑区；也可以先读取剪贴板文本，再转换当前内容。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:w-44">
          <Button type="button" variant="outline" onClick={handleChooseFile} disabled={disabled}>
            <FileText className="size-4" />
            选择文件
          </Button>
          <Button type="button" variant="outline" onClick={onReadClipboard} disabled={disabled}>
            <ClipboardPaste className="size-4" />
            从剪贴板读取
          </Button>
          <Button type="button" onClick={onConvertCurrent} disabled={disabled}>
            转换当前内容
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
