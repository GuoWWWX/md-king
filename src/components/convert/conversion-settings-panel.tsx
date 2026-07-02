import { ArrowRight, FileText, FolderOpen, Loader2, Settings2 } from "lucide-react";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AppConfig, Template } from "@/types";

type ConversionSettingsPanelProps = {
  templates: Template[];
  templateId: string;
  appConfig?: AppConfig;
  disabled?: boolean;
  canConvert: boolean;
  onTemplateChange: (templateId: string) => void;
  onConvert?: () => void;
  showConvert?: boolean;
  outputName?: string;
  className?: string;
};

export function ConversionSettingsPanel({ templates, templateId, appConfig, disabled = false, canConvert, onTemplateChange, onConvert, showConvert = true, outputName = "未命名文档.docx", className }: ConversionSettingsPanelProps) {
  return (
    <AppSurface as="aside" className={cn("min-w-0 overflow-hidden space-y-2.5", className)} padding="sm">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-black text-blue-800">
          <Settings2 className="size-4" />
          转换设置
        </p>
        <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">DOCX</span>
      </div>

      <div className="min-w-0 space-y-1">
        <Label className="text-xs font-bold text-blue-900/62">模板选择</Label>
        <Select value={templateId} onValueChange={onTemplateChange}>
          <SelectTrigger className="h-9 w-full min-w-0 rounded-[10px] border-white/80 bg-white/78 text-xs shadow-sm">
            <SelectValue placeholder="选择 Word 模板" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 space-y-1">
        <Label className="text-xs font-bold text-blue-900/62">输出文件名</Label>
        <div className="flex h-9 min-w-0 items-center gap-2 overflow-hidden rounded-[10px] border border-white/80 bg-white/78 px-3 text-sm shadow-sm">
          <FileText className="size-4 shrink-0 text-blue-600" />
          <span className="block min-w-0 flex-1 truncate text-xs font-semibold text-slate-700" title={outputName}>{outputName}</span>
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <Label className="text-xs font-bold text-blue-900/62">页面设置</Label>
        <div className="flex h-9 min-w-0 items-center justify-between gap-2 overflow-hidden rounded-[10px] border border-white/80 bg-white/78 px-3 text-sm shadow-sm">
          <span className="min-w-0 truncate text-xs font-semibold text-slate-700">A4 210 x 297 mm</span>
          <span className="shrink-0 text-blue-500">⌄</span>
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <Label className="text-xs font-bold text-blue-900/62">输出位置</Label>
        <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-[10px] border border-white/80 bg-white/70 p-2 text-sm">
          <p className="min-w-0 truncate text-xs text-slate-600">{appConfig?.defaultOutputDir ?? "与源 Markdown 同目录"}</p>
          <SoftActionButton className="h-7 rounded-[8px] border-white/80 bg-white/76 text-xs" size="sm" disabled title="目录选择器接入后启用">
            <FolderOpen className="size-3.5" />
          </SoftActionButton>
        </div>
      </div>

      {showConvert ? (
        <PrimaryActionButton className="h-11 w-full rounded-[10px] text-sm font-black" onClick={onConvert} disabled={disabled || !canConvert}>
          {disabled ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {disabled ? "正在转换..." : "生成 Word"}
        </PrimaryActionButton>
      ) : null}
    </AppSurface>
  );
}
