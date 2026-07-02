import { ArrowRight, CheckCircle2, ClipboardPaste, ExternalLink, FileText, Loader2, Replace, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConversionInputCard } from "@/components/convert/conversion-input-card";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildDocxOutputName, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem } from "@/lib/conversion-history";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { saveHistory, convertMarkdown, getTemplateStyleConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { ConvertResult, HistoryItem, Template, TemplateStyleConfig } from "@/types";

type ConvertMode = "markdown" | "file";

const fallbackTemplate: Template = {
  id: "default-report",
  name: "默认报告模板",
  description: "适合 AI 生成的通用报告、方案和说明文档。",
  referenceDocxPath: "",
  tags: ["报告", "通用", "内置"],
  isBuiltIn: true,
  isDefault: true,
  createdAt: "",
  updatedAt: "",
};

export function ConvertPage() {
  const { appConfig, templates, history, currentTemplateId, setHistory, setCurrentTemplateId } = useAppStore();
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const [templateId, setTemplateId] = useState(currentTemplateId || appConfig?.defaultTemplateId || fallbackTemplate.id);
  const [markdown, setMarkdown] = useState("");
  const [mode, setMode] = useState<ConvertMode>("markdown");
  const [isConverting, setIsConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(templateId));
  const [openAfterConvert, setOpenAfterConvert] = useState(appConfig?.openAfterConvert ?? true);
  const [overwriteOutput, setOverwriteOutput] = useState(true);
  const conversionVersionRef = useRef(0);

  useEffect(() => {
    if (!currentTemplateId || currentTemplateId === templateId) return;
    if (templateOptions.some((template) => template.id === currentTemplateId)) {
      setTemplateId(currentTemplateId);
      return;
    }
    setCurrentTemplateId(undefined);
  }, [currentTemplateId, setCurrentTemplateId, templateId, templateOptions]);

  useEffect(() => {
    if (templateOptions.some((template) => template.id === templateId)) return;
    const nextTemplate = templateOptions.find((template) => template.id === appConfig?.defaultTemplateId) ?? templateOptions.find((template) => template.isDefault) ?? templateOptions[0];
    setTemplateId(nextTemplate.id);
  }, [appConfig?.defaultTemplateId, templateId, templateOptions]);

  useEffect(() => {
    conversionVersionRef.current += 1;
    setConvertResult(null);
  }, [markdown, mode]);

  useEffect(() => {
    let cancelled = false;
    setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
    void getTemplateStyleConfig(templateId)
      .then((storedConfig) => {
        if (!cancelled) setPreviewStyleConfig(mergeTemplateStyleConfig(templateId, storedConfig ?? undefined));
      })
      .catch(() => {
        if (!cancelled) setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
      });

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  useEffect(() => {
    setOpenAfterConvert(appConfig?.openAfterConvert ?? true);
    setOverwriteOutput((appConfig?.defaultConflictStrategy ?? "overwrite") === "overwrite");
  }, [appConfig?.defaultConflictStrategy, appConfig?.openAfterConvert]);

  async function persistHistory(nextHistory: HistoryItem[]) {
    setHistory(nextHistory);
    try {
      await saveHistory(nextHistory);
    } catch {
      // 浏览器预览或文件系统失败时，内存历史仍可用。
    }
  }

  async function runConvert() {
    const input = markdown;
    if (!input.trim()) {
      setConvertResult(null);
      toast.error("请先粘贴 Markdown 内容");
      return;
    }

    const conversionVersion = conversionVersionRef.current;
    setIsConverting(true);
    try {
      const result = await convertMarkdown({
        input,
        output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
        templateId,
        openAfterConvert,
        overwrite: overwriteOutput,
      });
      if (conversionVersion !== conversionVersionRef.current) return;
      setConvertResult(result);
      const nextHistory = [buildHistoryItem(result), ...history].slice(0, 20);
      await persistHistory(nextHistory);
      toast[result.ok && !result.simulated ? "success" : result.simulated ? "info" : "error"](result.message ?? (result.ok ? "转换完成" : "转换失败"));
    } catch (error) {
      if (conversionVersion !== conversionVersionRef.current) return;
      const message = error instanceof Error ? error.message : "转换调用失败";
      const result: ConvertResult = { ok: false, input, templateId, durationMs: 0, warnings: [], errorCode: "INVOKE_FAILED", message };
      setConvertResult(result);
      await persistHistory([buildHistoryItem(result), ...history].slice(0, 20));
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  }

  function handleFileTextLoad(text: string, file: File) {
    setMarkdown(text);
    setMode("markdown");
    toast.success(`已载入文件：${file.name}`);
  }

  async function handleReadClipboard() {
    if (!navigator.clipboard?.readText) {
      toast.error("当前环境不支持读取剪贴板，请手动粘贴 Markdown 内容");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setMarkdown(text);
      setMode("markdown");
      toast.success(text.trim() ? "已从剪贴板读取到编辑区" : "剪贴板为空，已清空编辑区");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取剪贴板失败，请检查权限");
    }
  }

  const words = markdown.trim() ? markdown.trim().length : 0;
  const lines = markdown ? markdown.split(/\r?\n/).length : 0;
  const outputName = buildDocxOutputName(markdown);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[54px_minmax(0,1fr)_88px] gap-3 overflow-hidden max-[1100px]:h-auto max-[1100px]:min-h-full max-[1100px]:grid-rows-[auto_auto_auto] max-[1100px]:overflow-visible">
      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-white/60 bg-white/28 p-1 max-[760px]:grid-cols-1">
        <ModeTile active={mode === "markdown"} icon={FileText} title="Markdown 输入" onClick={() => setMode("markdown")} />
        <ModeTile active={mode === "file"} icon={UploadCloud} title="导入文件" onClick={() => setMode("file")} />
        <ModeTile icon={ClipboardPaste} title="粘贴内容" onClick={() => void handleReadClipboard()} disabled={isConverting} />
      </div>

      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_360px] gap-3 overflow-hidden max-[1100px]:grid-cols-1 max-[1100px]:overflow-visible">
        <div className="min-h-0 min-w-0 overflow-hidden max-[1100px]:overflow-visible">
          <ConversionInputCard mode={mode} markdown={markdown} onChange={setMarkdown} onFileTextLoad={handleFileTextLoad} onReadClipboard={handleReadClipboard} disabled={isConverting} />
        </div>

        <AppSurface as="aside" padding="none" radius="md" className="min-h-0 min-w-0 overflow-hidden p-3 max-[1100px]:hidden">
          <WordPreviewPage
            markdown={markdown}
            styleConfig={previewStyleConfig}
            zoom={70}
            paginate
            headerTitle="Word 预览"
            headerSubtitle={markdown.trim() ? outputName : "等待 Markdown 内容"}
            badgeText="DOCX"
            className="max-h-none min-h-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
            viewportClassName="bg-transparent p-2"
          />
        </AppSurface>

        <AppSurface as="aside" padding="none" radius="md" className="hidden min-h-[460px] min-w-0 overflow-hidden p-3 max-[1100px]:block">
          <WordPreviewPage
            markdown={markdown}
            styleConfig={previewStyleConfig}
            zoom={76}
            paginate
            headerTitle="Word 预览"
            headerSubtitle={markdown.trim() ? outputName : "等待 Markdown 内容"}
            badgeText="DOCX"
            className="h-[460px] max-h-none min-h-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
            viewportClassName="bg-transparent p-2"
          />
        </AppSurface>
      </div>

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(520px,auto)] items-center gap-4 rounded-[12px] border-t border-blue-100/70 bg-white/24 px-4 max-[1100px]:grid-cols-1 max-[1100px]:py-3">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)]">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-sm font-black text-blue-950">{convertResult?.simulated ? "浏览器预览完成" : convertResult?.ok ? "DOCX 已生成" : "当前输入"}</p>
            <p className="mt-0.5 truncate text-xs text-blue-900/55">
              {convertResult?.output ?? `${words} 字符 · ${lines} 行 · ${outputName}`}
            </p>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-[180px_minmax(180px,1fr)_40px_40px_150px] items-center gap-2 max-[760px]:grid-cols-1">
          <Select value={templateId} onValueChange={(value) => {
            setTemplateId(value);
            setCurrentTemplateId(value);
          }}>
            <SelectTrigger className="h-10 min-w-0 rounded-[10px] border-white/80 bg-white/78 text-xs font-bold text-blue-800 shadow-sm">
              <SelectValue placeholder="选择模板" />
            </SelectTrigger>
            <SelectContent>
              {templateOptions.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SoftActionButton className="min-w-0 justify-start rounded-[10px] border-white/80 bg-white/70 text-blue-700" title={outputName}>
            <FileText className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{outputName}</span>
          </SoftActionButton>
          <StripToggleButton active={openAfterConvert} icon={ExternalLink} title={openAfterConvert ? "转换后自动打开：开" : "转换后自动打开：关"} onClick={() => setOpenAfterConvert((value) => !value)} />
          <StripToggleButton active={overwriteOutput} icon={Replace} title={overwriteOutput ? "同名文件直接覆盖：开" : "同名文件直接覆盖：关"} onClick={() => setOverwriteOutput((value) => !value)} />
          <PrimaryActionButton className="h-10 rounded-[10px] text-sm font-black" onClick={() => void runConvert()} disabled={isConverting || !markdown.trim()}>
            {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {isConverting ? "转换中" : "开始转换"}
          </PrimaryActionButton>
        </div>
      </section>

    </div>
  );
}

function StripToggleButton({ active, icon: Icon, title, onClick }: { active: boolean; icon: typeof FileText; title: string; onClick: () => void }) {
  return (
    <SoftActionButton
      className={active ? "h-10 rounded-[10px] border-blue-200 bg-blue-50 px-0 text-blue-700" : "h-10 rounded-[10px] border-white/80 bg-white/70 px-0 text-blue-400"}
      title={title}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </SoftActionButton>
  );
}

function ModeTile({ active = false, disabled = false, icon: Icon, title, onClick }: { active?: boolean; disabled?: boolean; icon: typeof FileText; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50",
        active ? "bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)]" : "text-blue-800 hover:bg-white/58 hover:text-blue-700",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
      <span>{title}</span>
    </button>
  );
}
