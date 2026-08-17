import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { ArrowRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheck, ExternalLink, FileText, FolderOpen, Loader2, Maximize2, Minimize2, Trash2, UploadCloud } from "lucide-react";
import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipButton } from "@/components/ui/tooltip";
import { actionableConversionWarnings, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem, limitHistory } from "@/lib/conversion-history";
import { readMarkdownFile } from "@/lib/markdown-files";
import { appendHistory, convertMarkdown, openOutputPath, revealOutputPath, selectDirectory, selectMdFile } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { HistoryItem, Template } from "@/types";
import { floatingOutputName, isFloatingMarkdownFile, normalizeFloatingOutputName, parentDirectory } from "./floating-converter-utils";
import { collapsedDockedX, revealedDockedX, type FloatingDockSide } from "./floating-window-geometry";

type FloatingTaskStatus = "pending" | "running" | "success" | "failed";

type FloatingTask = {
  id: string;
  name: string;
  text: string;
  inputPath?: string;
  outputName: string;
  status: FloatingTaskStatus;
  message?: string;
  outputPath?: string;
};

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

const positionStorageKey = "md-king:floating-ball-position";
const systemPositionStorageKey = "md-king:system-floating-window-position";
const floatingWindowClosedWidth = 48;
const floatingWindowClosedHeight = 48;
const expandedWidth = 380;
const expandedHeight = 500;
const dockActivationDistance = 4;
const floatingWindowVisibleWidth = 14;
const dockCollapseDelay = 1600;

type DockSide = FloatingDockSide;

function makeTask(name: string, text: string, inputPath?: string): FloatingTask {
  return {
    id: `floating-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    text,
    inputPath,
    outputName: floatingOutputName(inputPath, text),
    status: "pending",
  };
}

function showFloatingToast(systemWindow: boolean, type: "success" | "error" | "info", message: string) {
  if (systemWindow) {
    console[type === "error" ? "error" : "log"](message);
    return;
  }

  toast[type](message);
}

function isTauriEnvironment() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

function getScreenBounds() {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    left: screen.availLeft ?? 0,
    top: screen.availTop ?? 0,
    width: screen.availWidth,
    height: screen.availHeight,
  };
}

function resolveDockSide(x: number, width: number, bounds: ReturnType<typeof getScreenBounds>) {
  const right = bounds.left + bounds.width;
  const leftDistance = Math.abs(x - bounds.left);
  const rightDistance = Math.abs(x + width - right);

  if (leftDistance <= 28) return "left";
  if (rightDistance <= 28) return "right";
  return x + width / 2 < bounds.left + bounds.width / 2 ? "left" : "right";
}

function makePathTask(inputPath: string): FloatingTask {
  const normalized = inputPath.replace(/\\/g, "/");
  const name = normalized.split("/").pop() || inputPath;
  return makeTask(name, "", inputPath);
}

function loadInitialPosition() {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  try {
    const stored = window.localStorage.getItem(positionStorageKey);
    if (!stored) return { x: 24, y: 24 };
    const parsed = JSON.parse(stored) as { x?: number; y?: number };
    return { x: Math.max(8, parsed.x ?? 24), y: Math.max(8, parsed.y ?? 24) };
  } catch {
    return { x: 24, y: 24 };
  }
}

type FloatingConverterProps = {
  systemWindow?: boolean;
};

export function FloatingConverter({ systemWindow = false }: FloatingConverterProps) {
  const { appConfig, templates, currentTemplateId, setHistory, setCurrentTemplateId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(loadInitialPosition);
  const [dragging, setDragging] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  const [tasks, setTasks] = useState<FloatingTask[]>([]);
  const [isConverting, setIsConverting] = useState(false);
  const [dockSide, setDockSide] = useState<DockSide | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [outputDirectory, setOutputDirectory] = useState(appConfig?.defaultOutputDir ?? "");
  const dockCollapsedRef = useRef(false);
  const dockHoveredRef = useRef(false);
  const dockTimerRef = useRef<number | undefined>(undefined);
  const outputDirectoryTouchedRef = useRef(false);
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const defaultTemplate = templateOptions.find((template) => template.id === currentTemplateId)
    ?? templateOptions.find((template) => template.id === appConfig?.defaultTemplateId)
    ?? templateOptions.find((template) => template.isDefault)
    ?? templateOptions[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const activeTemplateId = selectedTemplateId || defaultTemplate?.id || fallbackTemplate.id;
  const canUseSystemWindow = systemWindow && isTauriEnvironment();
  const currentTask = tasks[0];

  const enabled = systemWindow ? true : (appConfig?.enableFloatingBall ?? true);

  function clearDockTimer() {
    if (dockTimerRef.current === undefined) return;
    window.clearTimeout(dockTimerRef.current);
    dockTimerRef.current = undefined;
  }

  async function collapseDockedSystemWindow() {
    if (!canUseSystemWindow || open || !dockSide || dockHoveredRef.current || dockCollapsedRef.current) return;

    const appWindow = getCurrentWindow();
    const currentPosition = await appWindow.outerPosition();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalPosition = currentPosition.toLogical(scaleFactor);
    const bounds = getScreenBounds();

    await appWindow.setPosition(new LogicalPosition(
      collapsedDockedX(dockSide, bounds.left, bounds.width, floatingWindowClosedWidth, floatingWindowVisibleWidth),
      logicalPosition.y,
    ));
    dockCollapsedRef.current = true;
    setDockCollapsed(true);
  }

  function scheduleDockCollapse(delay = dockCollapseDelay) {
    clearDockTimer();
    if (!canUseSystemWindow || open || !dockSide || dockHoveredRef.current || dockCollapsedRef.current) return;
    dockTimerRef.current = window.setTimeout(() => {
      dockTimerRef.current = undefined;
      void collapseDockedSystemWindow().catch(() => undefined);
    }, delay);
  }

  async function revealDockedSystemWindow() {
    clearDockTimer();
    if (!canUseSystemWindow || open || !dockSide) return;

    const appWindow = getCurrentWindow();
    const currentPosition = await appWindow.outerPosition();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalPosition = currentPosition.toLogical(scaleFactor);
    const bounds = getScreenBounds();

    await appWindow.setPosition(new LogicalPosition(
      revealedDockedX(dockSide, bounds.left, bounds.width, floatingWindowClosedWidth),
      logicalPosition.y,
    ));
    dockCollapsedRef.current = false;
    setDockCollapsed(false);
  }

  useEffect(() => {
    if (!canUseSystemWindow) return;
    const width = open ? expandedWidth : floatingWindowClosedWidth;
    const height = open ? expandedHeight : floatingWindowClosedHeight;
    void getCurrentWindow().setSize(new LogicalSize(width, height));
  }, [canUseSystemWindow, open]);

  useEffect(() => {
    if (!canUseSystemWindow || open) return;
    let cancelled = false;
    const appWindow = getCurrentWindow();

    void appWindow.outerPosition().then(async (currentPosition) => {
      const scaleFactor = await appWindow.scaleFactor();
      const logicalPosition = currentPosition.toLogical(scaleFactor);
      const bounds = getScreenBounds();
      const nearLeft = logicalPosition.x <= bounds.left + dockActivationDistance;
      const nearRight = logicalPosition.x + floatingWindowClosedWidth >= bounds.left + bounds.width - dockActivationDistance;
      if (cancelled) return;

      const nextDockSide: DockSide | null = nearLeft ? "left" : nearRight ? "right" : null;
      const isCollapsed = Boolean(nextDockSide) && (
        logicalPosition.x < bounds.left
        || logicalPosition.x > bounds.left + bounds.width - floatingWindowClosedWidth
      );
      dockCollapsedRef.current = isCollapsed;
      setDockCollapsed(isCollapsed);
      setDockSide(nextDockSide);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [canUseSystemWindow, open]);

  useEffect(() => {
    if (!canUseSystemWindow || open || !dockSide) {
      clearDockTimer();
      return;
    }

    scheduleDockCollapse();
    return clearDockTimer;
  }, [canUseSystemWindow, open, dockSide]);

  useEffect(() => clearDockTimer, []);

  useEffect(() => {
    if (outputDirectoryTouchedRef.current || !appConfig?.defaultOutputDir) return;
    setOutputDirectory(appConfig.defaultOutputDir);
  }, [appConfig?.defaultOutputDir]);

  async function settleSystemWindowPosition() {
    if (!canUseSystemWindow) return;
    clearDockTimer();
    const appWindow = getCurrentWindow();
    const currentPosition = await appWindow.outerPosition();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalPosition = currentPosition.toLogical(scaleFactor);
    const bounds = getScreenBounds();
    const width = open ? expandedWidth : floatingWindowClosedWidth;
    const height = open ? expandedHeight : floatingWindowClosedHeight;
    const nearLeft = logicalPosition.x <= bounds.left + dockActivationDistance;
    const nearRight = logicalPosition.x + width >= bounds.left + bounds.width - dockActivationDistance;
    const nextDockSide: DockSide | null = !open && nearLeft ? "left" : !open && nearRight ? "right" : null;
    const x = nextDockSide
      ? nextDockSide === "left"
        ? bounds.left
        : bounds.left + bounds.width - width
      : Math.min(Math.max(logicalPosition.x, bounds.left + 8), bounds.left + bounds.width - width - 8);
    const y = Math.min(Math.max(logicalPosition.y, bounds.top + 8), bounds.top + bounds.height - height - 8);

    await appWindow.setPosition(new LogicalPosition(x, y));
    dockCollapsedRef.current = false;
    setDockCollapsed(false);
    setDockSide(nextDockSide);
    window.localStorage.setItem(systemPositionStorageKey, JSON.stringify({ x, y }));
  }

  async function openSystemPanelFromBall() {
    clearDockTimer();
    if (!canUseSystemWindow) {
      setOpen(true);
      return;
    }

    const appWindow = getCurrentWindow();
    try {
      const currentPosition = await appWindow.outerPosition();
      const scaleFactor = await appWindow.scaleFactor();
      const logicalPosition = currentPosition.toLogical(scaleFactor);
      const bounds = getScreenBounds();
      const dockSide = resolveDockSide(logicalPosition.x, floatingWindowClosedWidth, bounds);
      const x = dockSide === "left"
        ? bounds.left + 8
        : Math.min(logicalPosition.x, bounds.left + bounds.width - expandedWidth - 8);
      const y = Math.min(Math.max(logicalPosition.y, bounds.top + 8), bounds.top + bounds.height - expandedHeight - 8);
      await appWindow.setPosition(new LogicalPosition(x, y));
      window.localStorage.setItem(systemPositionStorageKey, JSON.stringify({ x, y }));
    } catch {
      // 展开失败时仍然尝试打开面板。
    }

    setOpen(true);
    dockCollapsedRef.current = false;
    setDockCollapsed(false);
    setDockSide(null);
  }

  async function startSystemWindowDrag() {
    if (!canUseSystemWindow) return;
    clearDockTimer();
    const appWindow = getCurrentWindow();
    setDragging(true);
    setDockSide(null);
    try {
      // 使用 Tauri 的原生拖动，窗口移动后指针离开 Webview 时仍能持续拖动。
      await appWindow.startDragging();
    } finally {
      setDragging(false);
      await settleSystemWindowPosition().catch(() => undefined);
    }
  }

  function handleSystemBallPointerDown(event: PointerEvent<HTMLButtonElement>) {
    clearDockTimer();
    if (!canUseSystemWindow) {
      setOpen((current) => !current);
      return;
    }

    const appWindow = getCurrentWindow();
    const startScreenX = event.screenX;
    const startScreenY = event.screenY;
    let startWindowX = 0;
    let startWindowY = 0;
    let positionReady = false;
    let moved = false;
    let lastDeltaX = 0;
    let lastDeltaY = 0;

    void appWindow.outerPosition().then(async (currentPosition) => {
      const scaleFactor = await appWindow.scaleFactor();
      const logicalPosition = currentPosition.toLogical(scaleFactor);
      startWindowX = logicalPosition.x;
      startWindowY = logicalPosition.y;
      positionReady = true;
      if (moved) {
        void appWindow.setPosition(new LogicalPosition(startWindowX + lastDeltaX, startWindowY + lastDeltaY));
      }
    }).catch(() => undefined);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const deltaX = moveEvent.screenX - startScreenX;
      const deltaY = moveEvent.screenY - startScreenY;
      lastDeltaX = deltaX;
      lastDeltaY = deltaY;
      if (!moved && Math.hypot(deltaX, deltaY) < 6) return;
      moved = true;
      setDragging(true);
      setDockCollapsed(false);
      setDockSide(null);
      if (positionReady) {
        void appWindow.setPosition(new LogicalPosition(startWindowX + deltaX, startWindowY + deltaY));
      }
    }

    function handlePointerUp() {
      setDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (moved) {
        void settleSystemWindowPosition().catch(() => undefined);
        return;
      }
      void openSystemPanelFromBall();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handlePointerOpenPanel() {
    if (!systemWindow) return;
    void openSystemPanelFromBall();
  }

  useEffect(() => {
    if (!canUseSystemWindow) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent(async ({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") {
        setPanelDragging(true);
        await revealDockedSystemWindow().catch(() => undefined);
        return;
      }

      if (payload.type === "leave") {
        setPanelDragging(false);
        return;
      }

      setPanelDragging(false);
      const markdownPaths = payload.paths.filter(isFloatingMarkdownFile);
      if (markdownPaths.length === 0) {
        showFloatingToast(systemWindow, "error", "仅支持 .md 文件");
        return;
      }

      setCurrentTask(makePathTask(markdownPaths[0]), parentDirectory(markdownPaths[0]));
      showFloatingToast(systemWindow, "success", markdownPaths.length > 1 ? "一次处理一个文件，已载入第一个 .md 文件" : "已载入 Markdown 文件");
      await openSystemPanelFromBall();
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, [canUseSystemWindow, templates.length, currentTemplateId, appConfig?.defaultOutputDir]);

  function persistPosition(nextPosition: { x: number; y: number }) {
    setPosition(nextPosition);
    try {
      window.localStorage.setItem(positionStorageKey, JSON.stringify(nextPosition));
    } catch {
      // 位置保存失败不影响悬浮球使用。
    }
  }

  function handleBallPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (systemWindow) {
      void startSystemWindowDrag();
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = position;
    let moved = false;
    setDragging(true);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const deltaX = startX - moveEvent.clientX;
      const deltaY = startY - moveEvent.clientY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 4) moved = true;
      persistPosition({
        x: Math.max(8, startPosition.x + deltaX),
        y: Math.max(8, startPosition.y + deltaY),
      });
    }

    function handlePointerUp() {
      setDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (!moved) setOpen((current) => !current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function updateTask(id: string, patch: Partial<FloatingTask>) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  function setCurrentTask(task: FloatingTask, suggestedDirectory?: string) {
    setTasks((current) => [task, ...current.filter((item) => item.status === "success" || item.status === "failed")]);
    if (!outputDirectoryTouchedRef.current) {
      setOutputDirectory(appConfig?.defaultOutputDir || suggestedDirectory || "");
    }
  }

  async function addFiles(files: File[]) {
    const markdownFiles = files.filter((file) => isFloatingMarkdownFile(file.name));
    if (markdownFiles.length === 0) {
      showFloatingToast(systemWindow, "error", "仅支持 .md 文件");
      return;
    }

    const file = markdownFiles[0];
    try {
      const item = await readMarkdownFile(file);
      setCurrentTask(makeTask(item.name, item.text));
      showFloatingToast(systemWindow, "success", markdownFiles.length > 1 ? "一次处理一个文件，已载入第一个 .md 文件" : "已载入 Markdown 文件");
      if (systemWindow && !open) await openSystemPanelFromBall();
    } catch (error) {
      showFloatingToast(systemWindow, "error", userFacingErrorMessage(error, `读取 ${file.name} 失败`));
    }
  }

  async function chooseMarkdownFile() {
    try {
      const path = await selectMdFile();
      if (!path) return;
      setCurrentTask(makePathTask(path), parentDirectory(path));
      showFloatingToast(systemWindow, "success", "已载入 Markdown 文件");
    } catch (error) {
      showFloatingToast(systemWindow, "error", userFacingErrorMessage(error, "选择文件失败"));
    }
  }

  async function chooseOutputDirectory() {
    try {
      const path = await selectDirectory("选择导出目录");
      if (!path) return;
      outputDirectoryTouchedRef.current = true;
      setOutputDirectory(path);
    } catch (error) {
      showFloatingToast(systemWindow, "error", userFacingErrorMessage(error, "选择导出目录失败"));
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setPanelDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setPanelDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setPanelDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void addFiles(files);
      return;
    }

    showFloatingToast(systemWindow, "error", "仅支持 .md 文件");
  }

  useEffect(() => {
    if (!open) return;

    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      event.preventDefault();
      setCurrentTask(makeTask("剪贴板内容.md", text));
      showFloatingToast(systemWindow, "success", "已载入剪贴板中的 Markdown 内容");
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, systemWindow, appConfig?.defaultOutputDir]);

  /// 悬浮球运行在独立 WebviewWindow，自带一份 store 快照。只上传新增项，
  /// 由后端读盘合并，避免把主窗口同期写入的记录整体覆盖掉。
  async function persistHistory(newItems: HistoryItem[]) {
    if (newItems.length === 0) return;
    setHistory(limitHistory([...newItems, ...useAppStore.getState().history]));
    try {
      setHistory(await appendHistory(newItems));
    } catch {
      // 浏览器预览或文件写入失败时，本地状态仍保留。
    }
  }

  async function convertTask(task: FloatingTask) {
    updateTask(task.id, { status: "running", message: "转换中..." });
    const outputName = normalizeFloatingOutputName(task.outputName, floatingOutputName(task.inputPath, task.text));
    const input = task.inputPath?.trim() ? task.inputPath : task.text;
    const output = buildOutputPath(outputDirectory, outputName);
    updateTask(task.id, { outputName });
    const result = await convertMarkdown({
      input,
      inputKind: task.inputPath?.trim() ? "path" : "text",
      output,
      templateId: activeTemplateId,
      openAfterConvert: appConfig?.openAfterConvert ?? true,
      conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
    });
    updateTask(task.id, {
      status: result.ok ? "success" : "failed",
      message: `${result.message ?? (result.ok ? "转换完成" : "转换失败")}${actionableConversionWarnings(result.warnings).length > 0 ? "（有提示）" : ""}`,
      outputPath: result.ok && !result.simulated ? result.output ?? output : undefined,
    });
    return result;
  }

  async function runOutputAction(task: FloatingTask, action: (path: string) => Promise<void>, fallbackMessage: string) {
    if (!task.outputPath) return;
    try {
      await action(task.outputPath);
    } catch (error) {
      updateTask(task.id, {
        message: `${task.message ?? "转换完成"}；${userFacingErrorMessage(error, fallbackMessage)}`,
      });
    }
  }

  async function runConvert() {
    if (!currentTask || (currentTask.status !== "pending" && currentTask.status !== "failed")) {
      showFloatingToast(systemWindow, "info", "当前没有待转换任务");
      return;
    }
    if (!outputDirectory.trim()) {
      updateTask(currentTask.id, { status: "failed", message: "请选择导出目录" });
      return;
    }

    setIsConverting(true);
    setCurrentTemplateId(activeTemplateId);
    try {
      const result = await convertTask(currentTask);
      await persistHistory([buildHistoryItem(result)]);
      const warningCount = actionableConversionWarnings(result.warnings).length;
      showFloatingToast(systemWindow, !result.ok ? "error" : warningCount > 0 ? "info" : "success", !result.ok ? "转换失败" : warningCount > 0 ? `转换完成，${warningCount} 条提示待检查` : "转换完成");
    } catch (error) {
      updateTask(currentTask.id, { status: "failed", message: userFacingErrorMessage(error, "转换失败") });
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div
      className={cn(
        systemWindow
          ? open
            ? "fixed left-0 top-0 z-40 h-[500px] w-[380px] overflow-hidden bg-transparent"
            : "fixed left-0 top-0 z-40 flex h-[48px] w-[48px] flex-col items-center justify-center bg-transparent"
          : "fixed z-40",
      )}
      style={systemWindow
        ? { alignItems: dockCollapsed
          ? dockSide === "left" ? "flex-end" : dockSide === "right" ? "flex-start" : "center"
          : dockSide === "left" ? "flex-start" : dockSide === "right" ? "flex-end" : "center" }
        : { right: position.x, bottom: position.y }}
    >
      {open ? (
        <div className="mk-floating-panel flex h-full w-full flex-col rounded-[8px] text-slate-900 dark:text-slate-50">
          <div
            className="mk-floating-dragbar flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-slate-200/80 px-3 py-2.5 active:cursor-grabbing dark:border-white/10"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              event.preventDefault();
              void startSystemWindowDrag();
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <MdKingLogo className="size-8 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-950 dark:text-slate-50">转换任务</p>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{tasks.length > 0 ? `${tasks.length} 个转换任务` : "暂无任务"}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <TooltipButton
                tooltip="收起"
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-white/10"
                onClick={() => setOpen(false)}
                aria-label="收起悬浮球面板"
              >
                <Minimize2 className="size-4" />
              </TooltipButton>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div
              className={cn("mk-floating-drop shrink-0 rounded-[8px] px-3 py-4 text-center transition")}
              data-active={panelDragging ? "true" : "false"}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <UploadCloud className="mx-auto size-6 text-[var(--app-primary)]" />
              <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">拖入文件</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">.md 文件或粘贴 Markdown 内容</p>
              {canUseSystemWindow ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-zinc-900 dark:text-slate-100 dark:hover:bg-zinc-800"
                  onClick={() => void chooseMarkdownFile()}
                  disabled={isConverting}
                >
                  <FolderOpen className="size-3.5" />
                  选择文件
                </Button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Label className="shrink-0 text-xs text-slate-500 dark:text-slate-400">模板</Label>
              <Select value={activeTemplateId} onValueChange={(value) => { setSelectedTemplateId(value); setCurrentTemplateId(value); }}>
                <SelectTrigger className="mk-floating-soft h-8 min-w-0 flex-1 rounded-[6px] bg-white dark:border-slate-700 dark:bg-zinc-900">
                  <SelectValue placeholder="使用上次模板" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
              {tasks.length === 0 ? (
                <div className="mk-floating-empty flex h-full min-h-28 items-center justify-center rounded-[8px] px-5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">暂无转换任务</div>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="mk-floating-task rounded-[8px] px-2.5 py-2 text-xs">
                      <div className="flex items-start gap-2">
                        <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center", task.status === "success" ? "text-emerald-600 dark:text-emerald-400" : task.status === "failed" ? "text-red-600 dark:text-red-400" : task.status === "running" ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>{task.status === "success" ? <CircleCheck className="size-4" /> : task.status === "failed" ? <CircleAlert className="size-4" /> : task.status === "running" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100" title={task.name}>{task.name}</p>
                            <span className={cn("shrink-0 text-[11px]", task.status === "success" ? "text-emerald-600 dark:text-emerald-400" : task.status === "failed" ? "text-red-600 dark:text-red-400" : task.status === "running" ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>{task.status === "success" ? "已生成" : task.status === "failed" ? "失败" : task.status === "running" ? "转换中" : "待转换"}</span>
                          </div>
                          <p className="mt-0.5 break-all leading-4 text-slate-500 dark:text-slate-400">{task.message ?? task.inputPath ?? "等待转换"}</p>
                          {task.outputPath ? (
                            <div className="mt-2 border-t border-slate-200/80 pt-2 dark:border-zinc-700/80">
                              <p className="break-all leading-4 text-slate-600 dark:text-slate-300" title={task.outputPath}>{task.outputPath}</p>
                              <div className="mt-1.5 flex items-center gap-1">
                                <TooltipButton
                                  tooltip="打开生成的 Word 文件"
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="rounded-[5px] text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10"
                                  onClick={() => void runOutputAction(task, openOutputPath, "打开文件失败")}
                                  aria-label="打开生成的 Word 文件"
                                >
                                  <ExternalLink className="size-3.5" />
                                </TooltipButton>
                                <TooltipButton
                                  tooltip="资源管理器中打开"
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="rounded-[5px] text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10"
                                  onClick={() => void runOutputAction(task, revealOutputPath, "打开资源管理器失败")}
                                  aria-label="资源管理器中打开"
                                >
                                  <FolderOpen className="size-3.5" />
                                </TooltipButton>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <TooltipButton
                          tooltip="移除任务"
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="rounded-[5px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-100"
                          onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))}
                          disabled={isConverting}
                          aria-label="移除任务"
                        >
                          <Trash2 className="size-3.5" />
                        </TooltipButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid shrink-0 gap-2">
              <div className="flex items-center gap-2">
                <Label className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">导出位置</Label>
                <div className="relative min-w-0 flex-1">
                  <Input
                    className="h-8 cursor-pointer rounded-[6px] bg-white pr-8 text-xs dark:border-slate-700 dark:bg-zinc-900"
                    value={outputDirectory}
                    placeholder="选择导出目录"
                    readOnly
                    title={outputDirectory || "选择导出目录"}
                    onClick={() => void chooseOutputDirectory()}
                  />
                  <TooltipButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute right-1 top-1 size-6 rounded-[5px] text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                    tooltip="选择导出目录"
                    aria-label="选择导出目录"
                    onClick={() => void chooseOutputDirectory()}
                  >
                    <FolderOpen className="size-3.5" />
                  </TooltipButton>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="floating-output-name" className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">文件名</Label>
                <Input
                  id="floating-output-name"
                  className="h-8 rounded-[6px] bg-white text-xs dark:border-slate-700 dark:bg-zinc-900"
                  value={currentTask?.outputName ?? ""}
                  placeholder="输出文件名.docx"
                  disabled={!currentTask || isConverting || currentTask.status === "success"}
                  onChange={(event) => currentTask && updateTask(currentTask.id, { outputName: event.target.value })}
                  onBlur={() => currentTask && updateTask(currentTask.id, { outputName: normalizeFloatingOutputName(currentTask.outputName, floatingOutputName(currentTask.inputPath, currentTask.text)) })}
                />
              </div>
            </div>

            <Button className="h-9 w-full shrink-0 bg-sky-600 font-semibold text-white shadow-none hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 dark:bg-sky-500 dark:hover:bg-sky-400" onClick={runConvert} disabled={isConverting || !currentTask || currentTask.status === "success" || !outputDirectory.trim() || !currentTask.outputName.trim()}>
              {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {isConverting ? "正在转换..." : "开始转换"}
            </Button>
          </div>
        </div>
      ) : null}

      {!open ? (
        <div
          className={cn(
            "flex flex-col items-center gap-1 transition",
            panelDragging && "scale-105 opacity-100",
          )}
          onPointerEnter={() => {
            dockHoveredRef.current = true;
            void revealDockedSystemWindow().catch(() => undefined);
          }}
          onPointerLeave={() => {
            dockHoveredRef.current = false;
            scheduleDockCollapse(650);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            clearDockTimer();
            event.dataTransfer.dropEffect = "copy";
            setPanelDragging(true);
          }}
          onDragLeave={() => setPanelDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setPanelDragging(false);
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) {
              void addFiles(files);
              return;
            }
            showFloatingToast(systemWindow, "error", "仅支持 .md 文件");
          }}
        >
          <TooltipButton
            type="button"
            className={cn(
              "relative flex h-11 items-center justify-center overflow-hidden p-0 transition-[width,opacity,transform,background-color,border-color] duration-200 ease-out hover:scale-[1.03] cursor-grab active:scale-[0.98] active:cursor-grabbing",
              systemWindow && dockCollapsed && dockSide
                ? "mk-system-floating-dock-handle w-3.5"
                : "w-11 rounded-[13px] hover:bg-transparent",
              systemWindow && !dockCollapsed && "mk-system-floating-ball",
              !systemWindow && "mk-floating-ball",
              panelDragging && "scale-105 ring-2 ring-[var(--app-primary)]",
              !enabled && "opacity-80 ring-2 ring-white/80",
              dragging && "scale-105",
            )}
            data-dragging={panelDragging ? "true" : "false"}
            data-dock-side={systemWindow && dockCollapsed ? dockSide ?? undefined : undefined}
            onPointerDown={(event) => {
              if (systemWindow) {
                handleSystemBallPointerDown(event);
                return;
              }
              handleBallPointerDown(event);
            }}
            tooltip={systemWindow ? "点击展开；拖动移动；可拖入 .md 文件" : "拖动悬浮球；点击打开转换面板"}
            aria-label="悬浮球转换"
          >
            {systemWindow && dockCollapsed && dockSide ? (
              dockSide === "right" ? <ChevronsLeft className="size-3.5 shrink-0" /> : <ChevronsRight className="size-3.5 shrink-0" />
            ) : (
              <MdKingLogo className="relative z-10 size-11" />
            )}
            {tasks.length > 0 && !dockCollapsed ? (
              <span className="absolute -right-1 -top-1 z-20 flex min-w-5 items-center justify-center rounded-full border border-white/90 bg-white px-1.5 py-0.5 text-[10px] font-black leading-none text-slate-950 shadow-lg">
                {tasks.length > 9 ? "9+" : tasks.length}
              </span>
            ) : null}
          </TooltipButton>
          {!systemWindow && tasks.length > 0 ? (
            <div className="mk-floating-soft flex items-center gap-1 rounded-[12px] bg-white/72 p-1 backdrop-blur dark:bg-slate-900/85">
              <TooltipButton
                type="button"
                className="flex size-6 items-center justify-center rounded-[8px] bg-slate-950 text-white shadow-sm disabled:opacity-40 dark:bg-white dark:text-slate-950"
                tooltip="开始转换"
                aria-label="开始转换"
                onClick={() => void runConvert()}
                disabled={isConverting || !currentTask || currentTask.status === "success" || !outputDirectory.trim() || !currentTask.outputName.trim()}
              >
                {isConverting ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
              </TooltipButton>
              <TooltipButton
                type="button"
                className="flex size-6 items-center justify-center rounded-full text-[var(--app-primary)] hover:bg-[var(--app-primary-soft)]"
                tooltip="展开设置"
                aria-label="展开设置"
                onClick={handlePointerOpenPanel}
              >
                <Maximize2 className="size-3.5" />
              </TooltipButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
