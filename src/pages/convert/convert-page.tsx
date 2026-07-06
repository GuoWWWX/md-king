import { ArrowRight, CheckCircle2, ClipboardPaste, FileText, FolderOpen, Loader2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConversionInputCard } from "@/components/convert/conversion-input-card";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { AppSurface, PrimaryActionButton } from "@/components/ui/app-surface";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clipboardReadErrorMessage } from "@/lib/clipboard-errors";
import { buildDocxOutputName, buildDocxOutputNameFromPath, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem } from "@/lib/conversion-history";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { saveAppConfig, saveHistory, convertMarkdown, getTemplateStyleConfig, selectDirectory, selectMarkdownFiles } from "@/lib/tauri";
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
  const { appConfig, templates, history, currentTemplateId, setAppConfig, setHistory, setCurrentTemplateId } = useAppStore();
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const [templateId, setTemplateId] = useState(currentTemplateId || appConfig?.defaultTemplateId || fallbackTemplate.id);
  const [markdown, setMarkdown] = useState("");
  const autoOutputName = useMemo(() => buildDocxOutputName(markdown), [markdown]);
  const [outputNameDraft, setOutputNameDraft] = useState(() => buildDocxOutputName(""));
  const [outputNameEdited, setOutputNameEdited] = useState(false);
  const [mode, setMode] = useState<ConvertMode>("markdown");
  const [isConverting, setIsConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(templateId));
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
    if (!outputNameEdited) setOutputNameDraft(autoOutputName);
  }, [autoOutputName, outputNameEdited]);

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
        openAfterConvert: appConfig?.openAfterConvert ?? true,
        conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
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

  async function runBatchImport() {
    if (isConverting) return;

    let paths: string[];
    try {
      paths = await selectMarkdownFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择文件失败");
      return;
    }

    if (paths.length === 0) return;

    setMode("file");
    setIsConverting(true);
    setConvertResult(null);

    const results: ConvertResult[] = [];
    try {
      for (const path of paths) {
        const outputName = buildDocxOutputNameFromPath(path);
        const result = await convertMarkdown({
          input: path,
          output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
          templateId,
          openAfterConvert: false,
          conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
        });
        results.push(result);
      }

      const nextHistory = [...results.map(buildHistoryItem), ...history].slice(0, 20);
      await persistHistory(nextHistory);
      const successCount = results.filter((result) => result.ok && !result.simulated).length;
      const failedCount = results.length - successCount;
      setConvertResult(results.length > 0 ? results[results.length - 1] : null);
      toast[failedCount > 0 ? "error" : "success"](`批量转换完成：成功 ${successCount} 个，失败 ${failedCount} 个`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量转换失败");
      if (results.length > 0) {
        await persistHistory([...results.map(buildHistoryItem), ...history].slice(0, 20));
      }
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
      toast.error(clipboardReadErrorMessage(error));
    }
  }

  async function handleSelectOutputDir() {
    if (!appConfig) {
      toast.error("设置正在加载，稍后再选择输出目录");
      return;
    }

    try {
      const selected = await selectDirectory();
      if (!selected) return;
      const saved = await saveAppConfig({ ...appConfig, defaultOutputDir: selected });
      setAppConfig(saved);
      toast.success("已更新输出目录");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择输出目录失败");
    }
  }

  const words = markdown.trim() ? markdown.trim().length : 0;
  const lines = markdown ? markdown.split(/\r?\n/).length : 0;
  const outputName = normalizeOutputName(outputNameDraft);
  const outputDirLabel = appConfig?.defaultOutputDir?.trim() || "与源 Markdown 同目录";
  const outputPath = buildOutputPath(appConfig?.defaultOutputDir, outputName);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[54px_minmax(0,1fr)_96px] gap-3 overflow-hidden max-[1100px]:grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-slate-200 bg-white p-1 max-[760px]:grid-cols-1 dark:border-zinc-700/70 dark:bg-zinc-900/80">
        <ModeTile active={mode === "markdown"} icon={FileText} title="Markdown 输入" onClick={() => setMode("markdown")} />
        <ModeTile active={mode === "file"} icon={UploadCloud} title="导入文件" onClick={() => setMode("file")} />
        <ModeTile icon={ClipboardPaste} title="粘贴内容" onClick={() => void handleReadClipboard()} disabled={isConverting} />
      </div>

      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_360px] gap-3 overflow-hidden max-[1100px]:flex max-[1100px]:min-h-0 max-[1100px]:flex-col max-[1100px]:overflow-y-auto max-[1100px]:overflow-x-hidden max-[1100px]:pb-3">
        <div className="min-h-0 min-w-0 overflow-hidden max-[1100px]:min-h-[420px] max-[1100px]:shrink-0 max-[760px]:min-h-[320px]">
          <ConversionInputCard mode={mode} markdown={markdown} onChange={setMarkdown} onFileTextLoad={handleFileTextLoad} onBatchSelect={runBatchImport} onReadClipboard={handleReadClipboard} disabled={isConverting} />
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

        <AppSurface as="aside" padding="none" radius="md" className="hidden min-h-[460px] min-w-0 overflow-hidden p-3 max-[1100px]:block max-[1100px]:shrink-0">
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

      <section className="flex min-h-0 flex-col justify-center gap-2 rounded-[12px] border-t border-slate-200 bg-white px-4 py-3 max-[1100px]:border max-[1100px]:border-slate-200 dark:max-[1100px]:border-zinc-700/70 dark:max-[1100px]:bg-zinc-900/92">
        <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-blue-900/58 dark:text-zinc-300/80">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white">
            <CheckCircle2 className="size-3.5" />
          </div>
          <span className="shrink-0 text-blue-950 dark:text-zinc-100">{convertResult?.simulated ? "预览完成" : convertResult?.ok ? "已生成" : "当前输入"}</span>
          <span className="shrink-0">{words} 字符</span>
          <span className="shrink-0">{lines} 行</span>
          <span className="min-w-0 truncate" title={convertResult?.output ?? outputPath}>{convertResult?.output ?? outputPath}</span>
        </div>

        <div className="grid min-w-0 grid-cols-[180px_minmax(320px,1fr)_150px] items-center gap-2 max-[1100px]:grid-cols-[minmax(126px,0.72fr)_minmax(220px,1fr)_minmax(116px,auto)] max-[760px]:grid-cols-1">
          <Select value={templateId} onValueChange={(value) => {
            setTemplateId(value);
            setCurrentTemplateId(value);
          }}>
            <SelectTrigger className="h-10 w-full min-w-0 rounded-[10px] border-slate-200 bg-white text-xs font-bold text-blue-800 shadow-none data-[size=default]:h-10">
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
          <div className="grid min-w-0 grid-cols-[minmax(132px,0.9fr)_minmax(150px,1fr)] overflow-hidden rounded-[10px] border border-slate-200 bg-white text-blue-700 shadow-none dark:border-zinc-700/70 dark:bg-zinc-800/72 dark:text-zinc-100">
            <button
              type="button"
              className="flex h-10 min-w-0 items-center gap-2 border-r border-slate-200 px-3 text-left text-xs font-bold text-blue-800 transition hover:bg-slate-50 dark:border-zinc-700/70 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
              onClick={() => void handleSelectOutputDir()}
              title={outputDirLabel}
            >
              <FolderOpen className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{outputDirLabel}</span>
            </button>
            <div className="flex h-10 min-w-0 items-center gap-2 px-3" title={outputPath}>
              <FileText className="size-4 shrink-0" />
              <Input
                value={outputNameDraft}
                onChange={(event) => {
                  setOutputNameEdited(true);
                  setOutputNameDraft(event.target.value);
                }}
                onBlur={(event) => setOutputNameDraft(normalizeOutputName(event.target.value))}
                aria-label="输出文件名"
                className="h-8 min-w-0 border-0 bg-transparent p-0 text-sm font-bold text-blue-800 shadow-none outline-none placeholder:text-blue-900/35 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:text-zinc-50 dark:placeholder:text-zinc-500"
              />
            </div>
          </div>
          <PrimaryActionButton className="h-10 rounded-[10px] text-sm font-black max-[760px]:min-w-[116px] max-[640px]:min-w-[104px]" onClick={() => void runConvert()} disabled={isConverting || !markdown.trim()}>
            {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {isConverting ? "转换中" : "开始转换"}
          </PrimaryActionButton>
        </div>
      </section>

    </div>
  );
}

function normalizeOutputName(value: string) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "-") || "untitled.docx";
  return cleaned.toLowerCase().endsWith(".docx") ? cleaned : `${cleaned}.docx`;
}

function ModeTile({ active = false, disabled = false, icon: Icon, title, onClick }: { active?: boolean; disabled?: boolean; icon: typeof FileText; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50",
        active ? "bg-blue-600 text-white shadow-none" : "text-blue-800 hover:bg-slate-50 hover:text-blue-700 dark:text-zinc-200 dark:hover:bg-zinc-800/85 dark:hover:text-white",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
      <span>{title}</span>
    </button>
  );
}
