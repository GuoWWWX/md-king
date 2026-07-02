import { FileText } from "lucide-react";
import { AppSurface } from "@/components/ui/app-surface";
import { Textarea } from "@/components/ui/textarea";

type MarkdownInputPanelProps = {
  markdown: string;
  onChange: (value: string) => void;
};

function extractTitle(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
}

export function MarkdownInputPanel({ markdown, onChange }: MarkdownInputPanelProps) {
  const title = extractTitle(markdown) ?? "未识别标题";
  const words = markdown.trim() ? markdown.trim().length : 0;
  const lines = markdown ? markdown.split(/\r?\n/).length : 0;
  const outputName = `${title === "未识别标题" ? "ai-document" : title.replace(/[\\/:*?\"<>|]/g, "-")}.docx`;

  return (
    <AppSurface as="section" variant="plain" radius="sm" padding="none" className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-indigo-600" />
            <h3 className="font-semibold text-slate-950">粘贴 AI 生成的 Markdown</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">支持标题、列表、表格、代码块、引用和图片链接。</p>
        </div>
        <div className="hidden rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500 sm:block">
          <p className="font-medium text-slate-700">预计输出</p>
          <p className="mt-0.5 max-w-48 truncate">{outputName}</p>
        </div>
      </div>
      <Textarea
        className="min-h-[240px] resize-y rounded-lg border-slate-200 bg-slate-50/60 font-mono text-sm leading-6 focus-visible:ring-indigo-200 xl:min-h-[360px]"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
        placeholder="# 文档标题\n\n把需要转换的 Markdown 粘贴到这里..."
      />
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">文档标题</p>
          <p className="mt-1 truncate font-medium text-slate-900">{title}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">内容统计</p>
          <p className="mt-1 font-medium text-slate-900">{words} 字符 · {lines} 行</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Markdown 结构</p>
          <p className="mt-1 font-medium text-slate-900">标题 / 正文 / 块级元素</p>
        </div>
      </div>
    </AppSurface>
  );
}
