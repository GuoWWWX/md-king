import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardPaste, FileText, FolderOpen, Loader2, Maximize2, UploadCloud, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { toast } from "sonner";
import { ConversionInputCard } from "@/components/convert/conversion-input-card";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { AppSurface, PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clipboardReadErrorMessage } from "@/lib/clipboard-errors";
import { buildDocxOutputName, buildDocxOutputNameFromPath, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem } from "@/lib/conversion-history";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { saveAppConfig, saveHistory, convertMarkdown, getTemplateStyleConfig, isTauriEnvironment, readMarkdownFileFromPath, selectDirectory, selectMarkdownFile, selectMarkdownFiles } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { ConvertResult, HistoryItem, Template, TemplateStyleConfig } from "@/types";

type ConvertMode = "markdown" | "file";
type PreviewHeading = { id: string; level: number; text: string };
const previewZoomMin = 40;
const previewZoomMax = 200;
const previewZoomStep = 10;

function clampPreviewZoom(value: number) {
  return Math.min(previewZoomMax, Math.max(previewZoomMin, value));
}

function extractPreviewHeadings(markdown: string): PreviewHeading[] {
  const headings: PreviewHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({
        id: `heading-${headings.length + 1}`,
        level: match[1].length,
        text: match[2].replace(/\s+#+\s*$/, "").replace(/[#*_`~\[\]()]/g, "").trim(),
      });
      return;
    }

    const previous = lines[index - 1]?.trim();
    if (!previous) return;
    if (/^=+\s*$/.test(line)) {
      headings.push({ id: `heading-${headings.length + 1}`, level: 1, text: previous.replace(/[#*_`~\[\]()]/g, "").trim() });
    } else if (/^-+\s*$/.test(line)) {
      headings.push({ id: `heading-${headings.length + 1}`, level: 2, text: previous.replace(/[#*_`~\[\]()]/g, "").trim() });
    }
  });
  return headings;
}

const fallbackTemplate: Template = {
  id: "default-report",
  name: "默认报告模板",
  description: "适合 AI 生成的通用报告、方案和说明文档。",
  referenceDocxPath: "",
  tags: ["系统", "内置"],
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
  const [markdownSourcePath, setMarkdownSourcePath] = useState<string>();
  const autoOutputName = useMemo(() => buildDocxOutputName(markdown), [markdown]);
  const [outputNameDraft, setOutputNameDraft] = useState(() => buildDocxOutputName(""));
  const [outputNameEdited, setOutputNameEdited] = useState(false);
  const [mode, setMode] = useState<ConvertMode>("markdown");
  const [isConverting, setIsConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(templateId));
  const [previewWidth, setPreviewWidth] = useState(520);
  const [previewZoom, setPreviewZoom] = useState(40);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const splitPaneRef = useRef<HTMLDivElement>(null);
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
    if (previewExpanded) setPreviewZoom((value) => Math.max(value, 92));
  }, [previewExpanded]);

  useEffect(() => {
    if (!previewExpanded) return undefined;
    let frame = 0;
    const updatePageCount = () => {
      setPreviewPageCount(Math.max(1, document.querySelectorAll("[data-preview-page-index]").length));
    };
    frame = window.requestAnimationFrame(updatePageCount);
    const observer = new MutationObserver(updatePageCount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [previewExpanded, markdown, previewStyleConfig, previewZoom]);

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
        sourcePath: markdownSourcePath,
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
      const message = userFacingErrorMessage(error, "转换调用失败");
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
      toast.error(userFacingErrorMessage(error, "选择文件失败"));
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
      toast.error(userFacingErrorMessage(error, "批量转换失败"));
      if (results.length > 0) {
        await persistHistory([...results.map(buildHistoryItem), ...history].slice(0, 20));
      }
    } finally {
      setIsConverting(false);
    }
  }

  function handleFileTextLoad(text: string, file: File) {
    setMarkdown(text);
    setMarkdownSourcePath(undefined);
    setMode("markdown");
    toast.success(`已载入文件：${file.name}`);
  }

  async function handleNativeMarkdownFileLoad() {
    try {
      const path = await selectMarkdownFile();
      if (!path) return;
      const text = await readMarkdownFileFromPath(path);
      setMarkdown(text);
      setMarkdownSourcePath(path);
      setMode("markdown");
      toast.success(`已载入文件：${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "读取文件失败"));
    }
  }

  async function handleReadClipboard() {
    if (!navigator.clipboard?.readText) {
      toast.error("当前环境不支持读取剪贴板，请手动粘贴 Markdown 内容");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setMarkdown(text);
      setMarkdownSourcePath(undefined);
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
      toast.error(userFacingErrorMessage(error, "选择输出目录失败"));
    }
  }

  function handlePreviewResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const container = splitPaneRef.current;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const nextWidth = rect.right - moveEvent.clientX - 12;
      const maxWidth = Math.max(460, rect.width * 0.68);
      setPreviewWidth(Math.min(maxWidth, Math.max(460, nextWidth)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  const words = markdown.trim() ? markdown.trim().length : 0;
  const lines = markdown ? markdown.split(/\r?\n/).length : 0;
  const outputName = normalizeOutputName(outputNameDraft);
  const outputDirLabel = appConfig?.defaultOutputDir?.trim() || "与源 Markdown 同目录";
  const outputPath = buildOutputPath(appConfig?.defaultOutputDir, outputName);
  const previewHeadings = useMemo(() => extractPreviewHeadings(markdown), [markdown]);

  function scrollToPreviewHeading(id: string) {
    const target = document.querySelector(`[data-preview-heading-id="${id}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function scrollToPreviewPage(page: number) {
    const target = document.querySelector(`[data-preview-page-index="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderConvertFooter(className?: string) {
    return (
      <section className={cn("flex min-h-0 flex-col justify-center gap-2 rounded-[12px] border-t border-slate-200 bg-white px-4 py-3 max-[1100px]:border max-[1100px]:border-slate-200 dark:max-[1100px]:border-zinc-700/70 dark:max-[1100px]:bg-zinc-900/92", className)}>
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
    );
  }

  if (previewExpanded) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black tracking-[-0.02em] text-slate-950 dark:text-zinc-50">Word 预览</h2>
            <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{markdown.trim() ? outputName : "等待 Markdown 内容"}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 rounded-[10px]" onClick={() => setPreviewExpanded(false)}>
            <ArrowLeft className="size-4" />
            返回转换页
          </Button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4 bg-slate-50/80 p-4 dark:bg-zinc-900/70 max-[900px]:grid-cols-1">
          <WordPreviewSidebar
            headings={previewHeadings}
            pageCount={previewPageCount}
            onPageJump={scrollToPreviewPage}
            onHeadingJump={scrollToPreviewHeading}
          />
          <ConvertPreviewPanel
            markdown={markdown}
            markdownSourcePath={markdownSourcePath}
            outputName={outputName}
            styleConfig={previewStyleConfig}
            zoom={previewZoom}
            setZoom={setPreviewZoom}
            onExpand={() => undefined}
            expanded
            className="h-full rounded-[12px]"
            previewClassName="h-full"
          />
        </div>
        {renderConvertFooter("shrink-0 rounded-none border-x-0 border-b-0")}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[54px_minmax(0,1fr)_96px] gap-3 overflow-hidden max-[1100px]:grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-slate-200 bg-white p-1 max-[760px]:grid-cols-1 dark:border-zinc-700/70 dark:bg-zinc-900/80">
        <ModeTile active={mode === "markdown"} icon={FileText} title="Markdown 输入" onClick={() => setMode("markdown")} />
        <ModeTile active={mode === "file"} icon={UploadCloud} title="导入文件" onClick={() => setMode("file")} />
        <ModeTile icon={ClipboardPaste} title="粘贴内容" onClick={() => void handleReadClipboard()} disabled={isConverting} />
      </div>

      <div
        ref={splitPaneRef}
        className="grid min-h-0 min-w-0 gap-0 overflow-hidden max-[1100px]:flex max-[1100px]:min-h-0 max-[1100px]:flex-col max-[1100px]:overflow-y-auto max-[1100px]:overflow-x-hidden max-[1100px]:pb-3"
        style={{ gridTemplateColumns: `minmax(0,1fr) 12px minmax(460px,${previewWidth}px)` }}
      >
        <div className="min-h-0 min-w-0 overflow-hidden max-[1100px]:min-h-[420px] max-[1100px]:shrink-0 max-[760px]:min-h-[320px]">
          <ConversionInputCard mode={mode} markdown={markdown} onChange={setMarkdown} onFileTextLoad={handleFileTextLoad} onNativeFileSelect={isTauriEnvironment() ? handleNativeMarkdownFileLoad : undefined} onBatchSelect={runBatchImport} onReadClipboard={handleReadClipboard} disabled={isConverting} />
        </div>

        <div
          className="group flex min-h-0 cursor-col-resize items-center justify-center px-1 max-[1100px]:hidden"
          onPointerDown={handlePreviewResizeStart}
          role="separator"
          aria-label="调整 Word 预览宽度"
        >
          <span className="h-16 w-1 rounded-full bg-slate-200 transition group-hover:bg-blue-400 dark:bg-zinc-700 dark:group-hover:bg-blue-500" />
        </div>

        <ConvertPreviewPanel
          markdown={markdown}
          markdownSourcePath={markdownSourcePath}
          outputName={outputName}
          styleConfig={previewStyleConfig}
          zoom={previewZoom}
          setZoom={setPreviewZoom}
          onExpand={() => setPreviewExpanded(true)}
          className="min-h-0 min-w-0 max-[1100px]:hidden"
        />

        <ConvertPreviewPanel
          markdown={markdown}
          markdownSourcePath={markdownSourcePath}
          outputName={outputName}
          styleConfig={previewStyleConfig}
          zoom={previewZoom}
          setZoom={setPreviewZoom}
          onExpand={() => setPreviewExpanded(true)}
          className="hidden min-h-[460px] min-w-0 max-[1100px]:block max-[1100px]:shrink-0"
          previewClassName="h-[460px]"
        />
      </div>

      {renderConvertFooter()}

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

function ConvertPreviewPanel({
  markdown,
  markdownSourcePath,
  outputName,
  styleConfig,
  zoom,
  setZoom,
  onExpand,
  expanded = false,
  className,
  previewClassName,
}: {
  markdown: string;
  markdownSourcePath?: string;
  outputName: string;
  styleConfig: TemplateStyleConfig;
  zoom: number;
  setZoom: (value: number | ((current: number) => number)) => void;
  onExpand: () => void;
  expanded?: boolean;
  className?: string;
  previewClassName?: string;
}) {
  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((value) => clampPreviewZoom(value + direction * previewZoomStep));
  }

  return (
    <AppSurface as="aside" padding="none" radius="md" className={cn("flex min-h-0 flex-col overflow-hidden p-3", className)}>
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-950 dark:text-zinc-50">Word 预览</p>
          <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{markdown.trim() ? outputName : "等待 Markdown 内容"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-none">
          <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value - previewZoomStep))} disabled={zoom <= previewZoomMin} title="缩小预览" aria-label="缩小预览">
            <ZoomOut className="size-3.5 text-slate-500 dark:text-zinc-400" />
          </Button>
          <span className="w-10 text-center text-xs font-bold text-slate-500 dark:text-zinc-400">{zoom}%</span>
          <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value + previewZoomStep))} disabled={zoom >= previewZoomMax} title="放大预览" aria-label="放大预览">
            <ZoomIn className="size-3.5 text-slate-500 dark:text-zinc-400" />
          </Button>
          {!expanded ? (
            <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={onExpand} title="放大查看" aria-label="放大查看">
              <Maximize2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1" onWheel={handlePreviewWheel}>
        <WordPreviewPage
          markdown={markdown}
          markdownSourcePath={markdownSourcePath}
          styleConfig={styleConfig}
          zoom={zoom}
          paginate
          showHeader={false}
          interactiveViewport
          className={cn("max-h-none min-h-0 overflow-hidden border-0 bg-transparent p-0 shadow-none", previewClassName)}
          viewportClassName="bg-transparent p-2 dark:bg-zinc-950/95 dark:ring-1 dark:ring-zinc-800/80"
        />
      </div>
    </AppSurface>
  );
}

function WordPreviewSidebar({
  headings,
  pageCount,
  onPageJump,
  onHeadingJump,
}: {
  headings: PreviewHeading[];
  pageCount: number;
  onPageJump: (page: number) => void;
  onHeadingJump: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 max-[900px]:max-h-[220px]">
      <section className="min-h-0 shrink-[0.6] overflow-hidden">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-500 dark:text-zinc-400">页面缩略图</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{pageCount} 页</span>
        </div>
        <div className="grid max-h-[240px] grid-cols-2 gap-2 overflow-auto pr-1 max-[900px]:max-h-[120px]">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              className="group rounded-[10px] border border-slate-200 bg-slate-50 p-1.5 transition hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-500/60 dark:hover:bg-blue-500/12"
              onClick={() => onPageJump(page)}
              title={`跳到第 ${page} 页`}
            >
              <span className="mx-auto block aspect-[3/4] w-full rounded-[6px] border border-slate-200 bg-white p-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
                <span className="mb-1 block h-1 w-2/3 rounded bg-slate-200 dark:bg-zinc-700" />
                <span className="mb-1 block h-1 w-full rounded bg-slate-100 dark:bg-zinc-800" />
                <span className="mb-1 block h-1 w-5/6 rounded bg-slate-100 dark:bg-zinc-800" />
                <span className="mt-2 block h-4 rounded border border-dashed border-slate-200 bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900" />
              </span>
              <span className="mt-1 block text-center text-[10px] font-black text-slate-500 group-hover:text-blue-700 dark:text-zinc-400 dark:group-hover:text-blue-200">{page}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 min-h-0 flex-1 overflow-hidden border-t border-slate-200 pt-3 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-500 dark:text-zinc-400">文档目录</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{headings.length}</span>
        </div>
        <div className="h-full overflow-auto pr-1">
          {headings.length > 0 ? (
            <div className="space-y-1">
              {headings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  className="block w-full truncate rounded-[8px] px-2 py-1.5 text-left text-xs font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 dark:text-zinc-300 dark:hover:bg-blue-500/12 dark:hover:text-blue-200"
                  style={{ paddingLeft: 8 + Math.min(5, heading.level - 1) * 10 }}
                  onClick={() => onHeadingJump(heading.id)}
                  title={heading.text}
                >
                  <span className="mr-1 text-[10px] font-black text-slate-400 dark:text-zinc-500">H{heading.level}</span>
                  {heading.text}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-semibold leading-5 text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
              当前 Markdown 没有标题，目录会在识别到 # 标题后显示。
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
