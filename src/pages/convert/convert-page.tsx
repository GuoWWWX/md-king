import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ClipboardPaste, FileText, FolderOpen, Loader2, Maximize2, PanelsTopLeft, Settings2, Trash2, UploadCloud, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { toast } from "sonner";
import { ConversionInputCard } from "@/components/convert/conversion-input-card";
import { TemplateStyleManager } from "@/components/templates/template-style-manager";
import { WordPreviewPage, type PreviewOutlineItem } from "@/components/templates/word-preview-page";
import { AppSurface, PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipAnchor, TooltipButton } from "@/components/ui/tooltip";
import { clipboardReadErrorMessage } from "@/lib/clipboard-errors";
import { actionableConversionWarnings, buildDocxOutputName, buildDocxOutputNameFromPath, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem, limitHistory } from "@/lib/conversion-history";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { saveAppConfig, appendHistory, convertMarkdown, getTemplateStyleConfig, isTauriEnvironment, readMarkdownFileFromPath, revealOutputPath, selectDirectory, selectMarkdownFile, selectMarkdownFiles } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { registerVaultContentSink } from "@/hooks/use-open-vault-file";
import type { ConvertResult, HistoryItem, Template, TemplateStyleConfig } from "@/types";

type ConvertMode = "markdown" | "file";
type PreviewSidebarView = "pages" | "outline";
const previewZoomMin = 20;
const previewZoomMax = 200;
const previewZoomStep = 10;

function clampPreviewZoom(value: number) {
  return Math.min(previewZoomMax, Math.max(previewZoomMin, value));
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
  const { appConfig, templates, currentTemplateId, pendingImportPaths, setAppConfig, setHistory, setCurrentTemplateId, clearPendingImportPaths } = useAppStore();
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
  const [batchImportPaths, setBatchImportPaths] = useState<string[]>([]);
  const [selectedBatchImportPaths, setSelectedBatchImportPaths] = useState<string[]>([]);
  const [batchImportDialogOpen, setBatchImportDialogOpen] = useState(false);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(templateId));
  const [previewWidth, setPreviewWidth] = useState(520);
  const [previewZoom, setPreviewZoom] = useState(40);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [expandedStyleEditorOpen, setExpandedStyleEditorOpen] = useState(false);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewSidebarView, setPreviewSidebarView] = useState<PreviewSidebarView>("pages");
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState(208);
  const [previewOutline, setPreviewOutline] = useState<PreviewOutlineItem[]>([]);
  const [previewThumbnailContainer, setPreviewThumbnailContainer] = useState<HTMLDivElement | null>(null);
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const expandedPreviewRef = useRef<HTMLDivElement>(null);
  const conversionVersionRef = useRef(0);
  // 预览样式的读取是异步的，切模板与关闭样式编辑器都会触发。用递增版本号
  // 而不是 effect 局部的 cancelled 标志：后者管不到 closeExpandedStyleEditor
  // 这种在 effect 之外发起的读取，晚回来的旧结果会把新模板的样式覆盖掉。
  const previewStyleVersionRef = useRef(0);
  const selectedTemplate = useMemo(() => templateOptions.find((template) => template.id === templateId) ?? templateOptions[0], [templateId, templateOptions]);

  useEffect(() => {
    if (isConverting || pendingImportPaths.length === 0) return undefined;

    const paths = pendingImportPaths;
    setConvertResult(null);

    if (paths.length > 1) {
      clearPendingImportPaths();
      setBatchImportPaths(paths);
      setSelectedBatchImportPaths(paths);
      setBatchImportDialogOpen(true);
      setMode("file");
      return undefined;
    }

    // 刻意等读完再清队列：读到一半用户切走页面时，本组件被卸载、setMarkdown 落空，
    // 路径留在队列里，切回来会自动重试，不至于凭空丢文件。
    // 反过来若在这里就清空，effect 自己的依赖 pendingImportPaths 会立刻变化，
    // 从而触发 cleanup —— 那时再排队回去就成了死循环。
    let cancelled = false;
    const path = paths[0];
    void readMarkdownFileFromPath(path)
      .then((text) => {
        if (cancelled) return;
        clearPendingImportPaths();
        setMarkdown(text);
        setMarkdownSourcePath(path);
        setMode("markdown");
        toast.success(`已载入文件：${path.split(/[\\/]/).pop() ?? path}`);
      })
      .catch((error) => {
        if (cancelled) return;
        // 读失败也要清掉，否则每次切回本页都会重试并重复弹同一个错误。
        clearPendingImportPaths();
        toast.error(userFacingErrorMessage(error, "读取启动文件失败"));
      });

    return () => {
      cancelled = true;
    };
  }, [clearPendingImportPaths, isConverting, pendingImportPaths]);

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

  // 文件树点开某个文件时，正文由 AppShell 那条链路送进来。
  // 一并把输出名的「已手改」标记清掉：否则用户改过一次文件名后，
  // 后面在树里点开的每个文件都会沿用那个名字，导出时互相覆盖。
  useEffect(() => {
    registerVaultContentSink(({ absolutePath, content }) => {
      setMarkdown(content);
      setMarkdownSourcePath(absolutePath);
      setMode("markdown");
      setOutputNameEdited(false);
    });
    return () => registerVaultContentSink(undefined);
  }, []);

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
    const version = ++previewStyleVersionRef.current;
    setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
    void getTemplateStyleConfig(templateId)
      .then((storedConfig) => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(templateId, storedConfig ?? undefined));
      })
      .catch(() => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
      });
  }, [templateId]);

  /// 只上传本次新增的记录：后端会重新读盘再合并回写，
  /// 避免悬浮球窗口、右键菜单进程在转换期间写入的记录被本窗口的旧快照覆盖。
  async function persistHistory(newItems: HistoryItem[]) {
    if (newItems.length === 0) return;
    // 先按当前最新的 store 值乐观更新，保证 UI 立即可见；getState 而非渲染期快照，
    // 使连续两次转换不会互相覆盖。
    setHistory(limitHistory([...newItems, ...useAppStore.getState().history]));
    try {
      setHistory(await appendHistory(newItems));
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
        inputKind: "text",
        sourcePath: markdownSourcePath,
        output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
        templateId,
        openAfterConvert: appConfig?.openAfterConvert ?? true,
        conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
      });
      if (conversionVersion !== conversionVersionRef.current) return;
      setConvertResult(result);
      await persistHistory([buildHistoryItem(result)]);
      toast[result.ok && !result.simulated ? "success" : result.simulated ? "info" : "error"](result.message ?? (result.ok ? "转换完成" : "转换失败"));
      const actionableWarnings = actionableConversionWarnings(result.warnings);
      if (result.ok && actionableWarnings.length > 0) {
        toast.warning("转换完成，但有需要检查的提示", { description: actionableWarnings.join("\n") });
      }
    } catch (error) {
      if (conversionVersion !== conversionVersionRef.current) return;
      const message = userFacingErrorMessage(error, "转换调用失败");
      const result: ConvertResult = { ok: false, input, templateId, durationMs: 0, warnings: [], errorCode: "INVOKE_FAILED", message };
      setConvertResult(result);
      await persistHistory([buildHistoryItem(result)]);
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

    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) return;

    setBatchImportPaths(uniquePaths);
    setSelectedBatchImportPaths(uniquePaths);
    setBatchImportDialogOpen(true);
  }

  function closeBatchImportDialog() {
    setBatchImportDialogOpen(false);
    setBatchImportPaths([]);
    setSelectedBatchImportPaths([]);
  }

  function toggleBatchImportPath(path: string) {
    setSelectedBatchImportPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  }

  function removeBatchImportPath(path: string) {
    setBatchImportPaths((current) => current.filter((item) => item !== path));
    setSelectedBatchImportPaths((current) => current.filter((item) => item !== path));
  }

  async function runSelectedBatchImport() {
    const paths = batchImportPaths.filter((path) => selectedBatchImportPaths.includes(path));
    if (paths.length === 0) {
      toast.error("请至少选择一个 Markdown/TXT 文件");
      return;
    }

    closeBatchImportDialog();
    setMode("file");
    setIsConverting(true);
    setConvertResult(null);

    const results: ConvertResult[] = [];
    try {
      for (const path of paths) {
        const outputName = buildDocxOutputNameFromPath(path);
        const result = await convertMarkdown({
          input: path,
          inputKind: "path",
          output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
          templateId,
          openAfterConvert: false,
          conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
        });
        results.push(result);
      }

      await persistHistory(results.map(buildHistoryItem));
      const successCount = results.filter((result) => result.ok && !result.simulated).length;
      const failedCount = results.length - successCount;
      const warningCount = results.reduce((total, result) => total + actionableConversionWarnings(result.warnings).length, 0);
      setConvertResult(results.length > 0 ? results[results.length - 1] : null);
      toast[failedCount > 0 ? "error" : warningCount > 0 ? "warning" : "success"](`批量转换完成：成功 ${successCount} 个，失败 ${failedCount} 个${warningCount > 0 ? `，提示 ${warningCount} 条` : ""}`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "批量转换失败"));
      if (results.length > 0) {
        await persistHistory(results.map(buildHistoryItem));
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

  async function handleRevealOutput() {
    const path = convertResult?.output;
    if (!path) return;

    try {
      await revealOutputPath(path);
      toast.success("已在资源管理器中定位文件");
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "打开资源管理器失败"));
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

  function handleExpandedSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const container = expandedPreviewRef.current;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const minWidth = 172;
      const maxWidth = Math.min(400, Math.max(248, rect.width * 0.42));
      setPreviewSidebarWidth(Math.min(maxWidth, Math.max(minWidth, moveEvent.clientX - rect.left)));
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

  function scrollToPreviewHeading(id: string) {
    const target = document.querySelector(`[data-preview-heading-id="${id}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function scrollToPreviewPage(page: number) {
    const target = document.querySelector(`[data-preview-page-index="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openPreviewSidebarView(view: PreviewSidebarView) {
    setPreviewSidebarView(view);
  }

  function closeExpandedStyleEditor() {
    setExpandedStyleEditorOpen(false);
    // 关编辑器时重新拉一次配置，把编辑器里的保存结果同步到预览。
    // 这次读取要和切模板的读取抢同一个 state，所以共用版本号：
    // 用户关掉编辑器后马上切模板，这条晚回来的结果必须被丢弃。
    const version = ++previewStyleVersionRef.current;
    const currentTemplate = templateId;
    void getTemplateStyleConfig(currentTemplate)
      .then((storedConfig) => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(currentTemplate, storedConfig ?? undefined));
      })
      .catch(() => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(currentTemplate));
      });
  }

  function renderConvertFooter(className?: string) {
    const canRevealOutput = Boolean(convertResult?.ok && !convertResult.simulated && convertResult.output);

    return (
      <section className={cn("flex min-h-0 flex-col justify-center gap-2 rounded-[12px] border-t border-slate-200 bg-white px-4 py-3 max-[1100px]:border max-[1100px]:border-slate-200 dark:max-[1100px]:border-zinc-700/70 dark:max-[1100px]:bg-zinc-900/92", className)}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-blue-900/58 dark:text-zinc-300/80">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white">
            <CheckCircle2 className="size-3.5" />
          </div>
          <span className="shrink-0 text-blue-950 dark:text-zinc-100">{convertResult?.simulated ? "预览完成" : convertResult?.ok ? "已生成" : "当前输入"}</span>
          <span className="shrink-0">{words} 字符</span>
          <span className="shrink-0">{lines} 行</span>
          <TooltipAnchor content={convertResult?.output ?? outputPath}>
            <span className="min-w-0 truncate">{convertResult?.output ?? outputPath}</span>
          </TooltipAnchor>
          {canRevealOutput ? (
            <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0 text-blue-700 hover:bg-blue-50 hover:text-blue-900 dark:text-blue-200 dark:hover:bg-blue-500/12 dark:hover:text-blue-100" onClick={() => void handleRevealOutput()} title="在资源管理器中显示" aria-label="在资源管理器中显示生成的 DOCX">
              <FolderOpen className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-[180px_minmax(150px,0.8fr)_minmax(180px,1fr)_150px] items-center gap-2 max-[1100px]:grid-cols-[minmax(126px,0.72fr)_minmax(150px,0.8fr)_minmax(180px,1fr)_minmax(116px,auto)] max-[760px]:grid-cols-1">
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
          <TooltipButton
            type="button"
            className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-left text-xs font-bold text-blue-800 shadow-none transition hover:bg-slate-50 dark:border-zinc-700/70 dark:bg-zinc-800/72 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
            onClick={() => void handleSelectOutputDir()}
            tooltip={outputDirLabel}
          >
            <FolderOpen className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{outputDirLabel}</span>
          </TooltipButton>
          <TooltipAnchor content={outputPath}>
            <div className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-blue-700 shadow-none dark:border-zinc-700/70 dark:bg-zinc-800/72 dark:text-zinc-100">
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
          </TooltipAnchor>
          <PrimaryActionButton className="h-10 rounded-[10px] text-sm font-black max-[760px]:min-w-[116px] max-[640px]:min-w-[104px]" onClick={() => void runConvert()} disabled={isConverting || !markdown.trim()}>
            {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {isConverting ? "转换中" : "开始转换"}
          </PrimaryActionButton>
        </div>
      </section>
    );
  }

  if (expandedStyleEditorOpen) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        <TemplateStyleManager
          embedded
          template={selectedTemplate}
          initialTab="styles"
          previewMarkdown={markdown}
          previewMarkdownSourcePath={markdownSourcePath}
          closeLabel="返回放大预览"
          onRequestClose={closeExpandedStyleEditor}
        />
      </div>
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
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 rounded-[10px]" onClick={() => setPreviewExpanded(false)}>
              <ArrowLeft className="size-4" />
              返回转换页
            </Button>
          </div>
        </header>
        <div
          ref={expandedPreviewRef}
          className="grid min-h-0 flex-1 grid-cols-[minmax(172px,var(--preview-sidebar-width))_10px_minmax(0,1fr)] gap-0 bg-slate-50/80 p-4 dark:bg-zinc-900/70 max-[900px]:!grid-cols-1"
          style={{ "--preview-sidebar-width": `${previewSidebarWidth}px` } as CSSProperties}
        >
          <WordPreviewSidebar
            activeView={previewSidebarView}
            headings={previewOutline}
            pageCount={previewPageCount}
            onViewChange={openPreviewSidebarView}
            onHeadingJump={scrollToPreviewHeading}
            onThumbnailContainerChange={setPreviewThumbnailContainer}
          />
          <div
            className="group flex cursor-col-resize items-center justify-center max-[900px]:hidden"
            onPointerDown={handleExpandedSidebarResizeStart}
            role="separator"
            aria-label="调整预览导航宽度"
            aria-orientation="vertical"
          >
            <span className="h-10 w-1 rounded-full bg-slate-300/75 transition group-hover:h-16 group-hover:bg-blue-400 dark:bg-zinc-700 dark:group-hover:bg-blue-500" />
          </div>
          <ConvertPreviewPanel
            markdown={markdown}
            markdownSourcePath={markdownSourcePath}
            outputName={outputName}
            styleConfig={previewStyleConfig}
            zoom={previewZoom}
            setZoom={setPreviewZoom}
            onExpand={() => undefined}
            onOpenAdvancedStyle={() => setExpandedStyleEditorOpen(true)}
            expanded
            showTocPage
            thumbnailContainer={previewThumbnailContainer}
            onThumbnailPageSelect={scrollToPreviewPage}
            onPreviewOutlineChange={setPreviewOutline}
            className="h-full rounded-[12px]"
            previewClassName="h-full"
          />
        </div>
        {renderConvertFooter("shrink-0 rounded-none border-x-0 border-b-0")}
      </div>
    );
  }

  return (
    <>
      <Dialog open={batchImportDialogOpen} onOpenChange={(open) => { if (!open) closeBatchImportDialog(); }}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
            <DialogTitle className="text-lg font-semibold text-slate-950 dark:text-zinc-50">选择要转换的文档</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-5">已导入 {batchImportPaths.length} 个 Markdown/TXT 文件。勾选后才会转换为 DOCX，未选文件不会处理。</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-zinc-800/80">
            <span className="text-sm font-medium text-slate-700 dark:text-zinc-200">已选 {selectedBatchImportPaths.length} / {batchImportPaths.length}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelectedBatchImportPaths(batchImportPaths)} disabled={batchImportPaths.length === 0 || selectedBatchImportPaths.length === batchImportPaths.length}>全选</Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelectedBatchImportPaths([])} disabled={selectedBatchImportPaths.length === 0}>取消全选</Button>
            </div>
          </div>

          <div className="max-h-[min(52vh,420px)] divide-y divide-slate-100 overflow-y-auto dark:divide-zinc-800">
            {batchImportPaths.map((path) => {
              const checked = selectedBatchImportPaths.includes(path);
              const name = path.split(/[\\/]/).pop() ?? path;
              return (
                <div key={path} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-zinc-900/70">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBatchImportPath(path)}
                    className="size-4 shrink-0 accent-blue-600"
                    aria-label={`选择 ${name}`}
                  />
                  <FileText className="size-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">{name}</p>
                    <TooltipAnchor content={path}>
                      <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{path}</p>
                    </TooltipAnchor>
                  </div>
                  <Button variant="ghost" size="icon-xs" className="shrink-0 text-slate-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-300" onClick={() => removeBatchImportPath(path)} aria-label={`移除 ${name}`} title="移除">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
            {batchImportPaths.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-zinc-400">没有待转换的文件</p> : null}
          </div>

          <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
            <Button variant="outline" onClick={closeBatchImportDialog}>取消</Button>
            <PrimaryActionButton onClick={() => void runSelectedBatchImport()} disabled={selectedBatchImportPaths.length === 0}>
              <ArrowRight className="size-4" />
              转换选中 {selectedBatchImportPaths.length} 项
            </PrimaryActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
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
  onOpenAdvancedStyle,
  expanded = false,
  showTocPage = false,
  thumbnailContainer,
  onThumbnailPageSelect,
  onPreviewOutlineChange,
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
  onOpenAdvancedStyle?: () => void;
  expanded?: boolean;
  showTocPage?: boolean;
  thumbnailContainer?: HTMLDivElement | null;
  onThumbnailPageSelect?: (page: number) => void;
  onPreviewOutlineChange?: (items: PreviewOutlineItem[]) => void;
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
          {onOpenAdvancedStyle ? (
            <>
              <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={onOpenAdvancedStyle} title="高级样式" aria-label="高级样式">
                <Settings2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
              </Button>
              <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" />
            </>
          ) : null}
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
          showTocPage={showTocPage}
          thumbnailContainer={thumbnailContainer}
          onThumbnailPageSelect={onThumbnailPageSelect}
          onPreviewOutlineChange={onPreviewOutlineChange}
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
  activeView,
  headings,
  pageCount,
  onViewChange,
  onHeadingJump,
  onThumbnailContainerChange,
}: {
  activeView: PreviewSidebarView;
  headings: PreviewOutlineItem[];
  pageCount: number;
  onViewChange: (view: PreviewSidebarView) => void;
  onHeadingJump: (id: string) => void;
  onThumbnailContainerChange: (element: HTMLDivElement | null) => void;
}) {
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(() => new Set());
  const collapsibleHeadingIds = useMemo(() => new Set(
    headings.flatMap((heading, index) => headings[index + 1]?.level > heading.level ? [heading.id] : []),
  ), [headings]);

  function isHeadingVisible(index: number) {
    let parentLevel = headings[index].level;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = headings[candidateIndex];
      if (candidate.level < parentLevel) {
        if (collapsedHeadingIds.has(candidate.id)) return false;
        parentLevel = candidate.level;
      }
    }
    return true;
  }

  function toggleHeading(id: string) {
    setCollapsedHeadingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[12px] border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 max-[900px]:max-h-[220px]">
      <div className="mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-[8px] bg-slate-100 p-1 dark:bg-zinc-900">
        <button
          type="button"
          className={cn("flex h-8 items-center justify-center gap-1.5 rounded-[6px] text-xs font-bold transition", activeView === "pages" ? "bg-white text-blue-700 shadow-sm dark:bg-zinc-800 dark:text-blue-200" : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-100")}
          onClick={() => onViewChange("pages")}
        >
          <PanelsTopLeft className="size-3.5" />
          缩略图
        </button>
        <button
          type="button"
          className={cn("flex h-8 items-center justify-center gap-1.5 rounded-[6px] text-xs font-bold transition", activeView === "outline" ? "bg-white text-blue-700 shadow-sm dark:bg-zinc-800 dark:text-blue-200" : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-100")}
          onClick={() => onViewChange("outline")}
        >
          <FileText className="size-3.5" />
          目录
        </button>
      </div>

      {activeView === "pages" ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-500 dark:text-zinc-400">页面缩略图</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{pageCount} 页</span>
          </div>
          <div ref={onThumbnailContainerChange} className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(104px,1fr))] content-start gap-2 overflow-x-hidden overflow-y-auto pr-1 max-[900px]:max-h-[120px]" />
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-500 dark:text-zinc-400">文档目录</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{headings.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            {headings.length > 0 ? (
              <div className="space-y-0.5">
                {headings.map((heading, index) => {
                  if (!isHeadingVisible(index)) return null;
                  const canCollapse = collapsibleHeadingIds.has(heading.id);
                  const isCollapsed = collapsedHeadingIds.has(heading.id);
                  return (
                    <div key={heading.id} className="flex min-w-0 items-center gap-0.5" style={{ paddingLeft: Math.min(5, heading.level - 1) * 10 }}>
                      {canCollapse ? (
                        <button
                          type="button"
                          className="flex size-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          onClick={() => toggleHeading(heading.id)}
                          aria-label={`${isCollapsed ? "展开" : "折叠"}${heading.text}`}
                        >
                          {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                      ) : <span className="size-5 shrink-0" />}
                      <TooltipButton
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-[7px] py-1.5 pr-1 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 dark:text-zinc-300 dark:hover:bg-blue-500/12 dark:hover:text-blue-200"
                        onClick={() => onHeadingJump(heading.id)}
                        tooltip={heading.text}
                        tooltipSide="right"
                      >
                        {heading.number ? <span className="shrink-0 text-[10px] font-black text-slate-400 dark:text-zinc-500">{heading.number}</span> : null}
                        <span className="min-w-0 flex-1 truncate">{heading.text}</span>
                        <span className="shrink-0 tabular-nums text-[10px] font-bold text-slate-400 dark:text-zinc-500">{heading.page}</span>
                      </TooltipButton>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-semibold leading-5 text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
                当前 Markdown 没有标题，目录会在识别到 # 标题后显示。
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
