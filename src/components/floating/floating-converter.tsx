import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { ArrowRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheck, ExternalLink, FileText, FolderOpen, GripHorizontal, Loader2, Maximize2, Minimize2, Trash2, UploadCloud } from "lucide-react";
import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipButton } from "@/components/ui/tooltip";
import { actionableConversionWarnings, buildDocxOutputName, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem, limitHistory } from "@/lib/conversion-history";
import { readMarkdownFile } from "@/lib/markdown-files";
import { appendHistory, convertMarkdown, openOutputPath, revealOutputPath, selectMarkdownFiles } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { ConvertResult, HistoryItem, Template } from "@/types";

type FloatingTaskStatus = "pending" | "running" | "success" | "failed";

type FloatingTask = {
  id: string;
  name: string;
  text: string;
  inputPath?: string;
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
const floatingWindowDragWidth = 78;
const floatingWindowDragHeight = 78;
const expandedWidth = 380;
const expandedHeight = 500;
const dockActivationDistance = 4;

type DockSide = "left" | "right";

function makeTask(name: string, text: string, inputPath?: string): FloatingTask {
  return {
    id: `floating-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    text,
    inputPath,
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
  const [isIdleCollapsed, setIsIdleCollapsed] = useState(false);
  const [isIdleDimmed, setIsIdleDimmed] = useState(false);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const defaultTemplate = templateOptions.find((template) => template.id === currentTemplateId)
    ?? templateOptions.find((template) => template.id === appConfig?.defaultTemplateId)
    ?? templateOptions.find((template) => template.isDefault)
    ?? templateOptions[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const activeTemplateId = selectedTemplateId || defaultTemplate?.id || fallbackTemplate.id;
  const canUseSystemWindow = systemWindow && isTauriEnvironment();
  const edgeDocked = dockSide !== null;

  const enabled = systemWindow ? true : (appConfig?.enableFloatingBall ?? true);

  useEffect(() => {
    if (!canUseSystemWindow) return;
    const width = open ? expandedWidth : panelDragging ? floatingWindowDragWidth : floatingWindowClosedWidth;
    const height = open ? expandedHeight : panelDragging ? floatingWindowDragHeight : floatingWindowClosedHeight;
    void getCurrentWindow().setSize(new LogicalSize(width, height));
  }, [canUseSystemWindow, open, panelDragging]);

  useEffect(() => {
    if (!canUseSystemWindow || open || !edgeDocked) return;
    scheduleDockCollapse(1600);
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [canUseSystemWindow, edgeDocked, open]);

  useEffect(() => {
    if (!canUseSystemWindow || open) return;
    void getCurrentWindow().outerPosition().then(async (position) => {
      const scaleFactor = await getCurrentWindow().scaleFactor();
      const logicalPosition = position.toLogical(scaleFactor);
      const bounds = getScreenBounds();
      const collapsedLeft = logicalPosition.x < bounds.left;
      const collapsedRight = logicalPosition.x + floatingWindowClosedWidth > bounds.left + bounds.width;
      const nearLeft = logicalPosition.x <= bounds.left + dockActivationDistance;
      const nearRight = logicalPosition.x + floatingWindowClosedWidth >= bounds.left + bounds.width - dockActivationDistance;
      setDockSide(nearLeft ? "left" : nearRight ? "right" : null);
      setIsIdleCollapsed(collapsedLeft || collapsedRight);
    }).catch(() => undefined);
  }, [canUseSystemWindow, open]);

  async function settleSystemWindowPosition() {
    if (!canUseSystemWindow) return;
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
    setDockSide(nextDockSide);
    setIsIdleCollapsed(false);
    setIsIdleDimmed(false);
    window.localStorage.setItem(systemPositionStorageKey, JSON.stringify({ x, y }));
  }

  async function revealDockedSystemWindow() {
    if (!canUseSystemWindow || open || !edgeDocked) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalPosition = position.toLogical(scaleFactor);
    const bounds = getScreenBounds();
    const side = dockSide ?? resolveDockSide(logicalPosition.x, floatingWindowClosedWidth, bounds);
    const x = side === "left" ? bounds.left : bounds.left + bounds.width - floatingWindowClosedWidth;
    await appWindow.setPosition(new LogicalPosition(x, logicalPosition.y));
    setIsIdleCollapsed(false);
    setIsIdleDimmed(false);
  }

  function scheduleDockCollapse(delay = 900) {
    if (!canUseSystemWindow || open) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setIsIdleCollapsed(edgeDocked);
      setIsIdleDimmed(!edgeDocked);
    }, delay);
  }

  async function openSystemPanelFromBall() {
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
    setDockSide(null);
    setIsIdleCollapsed(false);
    setIsIdleDimmed(false);
  }

  async function startSystemWindowDrag() {
    if (!canUseSystemWindow) return;
    const appWindow = getCurrentWindow();
    setDragging(true);
    setDockSide(null);
    setIsIdleCollapsed(false);
    setIsIdleDimmed(false);
    try {
      // 使用 Tauri 的原生拖动，窗口移动后指针离开 Webview 时仍能持续拖动。
      await appWindow.startDragging();
    } finally {
      setDragging(false);
      resetIdleCollapseTimer();
      await settleSystemWindowPosition().catch(() => undefined);
    }
  }

  function handleSystemBallPointerDown(event: PointerEvent<HTMLButtonElement>) {
    resetIdleCollapseTimer();
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
      setDockSide(null);
      setIsIdleCollapsed(false);
      setIsIdleDimmed(false);
      if (positionReady) {
        void appWindow.setPosition(new LogicalPosition(startWindowX + deltaX, startWindowY + deltaY));
      }
    }

    function handlePointerUp() {
      setDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (moved) {
        resetIdleCollapseTimer();
        void settleSystemWindowPosition().catch(() => undefined);
        return;
      }
      void openSystemPanelFromBall();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function resetIdleCollapseTimer() {
    if (!systemWindow || open) return;
    setIsIdleCollapsed(false);
    setIsIdleDimmed(false);
    scheduleDockCollapse(2200);
  }

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!canUseSystemWindow || open) return;
    resetIdleCollapseTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [canUseSystemWindow, open, tasks.length]);

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
        resetIdleCollapseTimer();
        return;
      }

      if (payload.type === "leave") {
        setPanelDragging(false);
        return;
      }

      setPanelDragging(false);
      resetIdleCollapseTimer();
      const markdownPaths = payload.paths.filter((path) => /\.(md|markdown|txt)$/i.test(path));
      if (markdownPaths.length === 0) {
        showFloatingToast(systemWindow, "error", "请拖入 .md、.markdown 或 .txt 文件");
        return;
      }

      setTasks((current) => [...markdownPaths.map(makePathTask), ...current]);
      showFloatingToast(systemWindow, "success", `已加入 ${markdownPaths.length} 个文本任务`);
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
      resetIdleCollapseTimer();
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
      resetIdleCollapseTimer();
      if (!moved) setOpen((current) => !current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function updateTask(id: string, patch: Partial<FloatingTask>) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  async function addFiles(files: File[]) {
    const nextTasks: FloatingTask[] = [];
    resetIdleCollapseTimer();
    for (const file of files) {
      try {
        const item = await readMarkdownFile(file);
        nextTasks.push(makeTask(item.name, item.text));
      } catch (error) {
        showFloatingToast(systemWindow, "error", userFacingErrorMessage(error, `读取 ${file.name} 失败`));
      }
    }

    if (nextTasks.length > 0) {
      setTasks((current) => [...nextTasks, ...current]);
      showFloatingToast(systemWindow, "success", `已加入 ${nextTasks.length} 个转换任务`);
    }
  }

  async function chooseMarkdownFiles() {
    try {
      const paths = await selectMarkdownFiles();
      if (paths.length === 0) return;
      setTasks((current) => [...paths.map(makePathTask), ...current]);
      showFloatingToast(systemWindow, "success", `已加入 ${paths.length} 个转换任务`);
    } catch (error) {
      showFloatingToast(systemWindow, "error", userFacingErrorMessage(error, "选择文件失败"));
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
    resetIdleCollapseTimer();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void addFiles(files);
      return;
    }

    showFloatingToast(systemWindow, "error", "请拖入 .md、.markdown 或 .txt 文件");
  }

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
    const outputName = buildDocxOutputName(task.text);
    const input = task.inputPath?.trim() ? task.inputPath : task.text;
    const output = task.inputPath?.trim() ? task.inputPath.replace(/\.(md|markdown|txt)$/i, ".docx") : buildOutputPath(appConfig?.defaultOutputDir, outputName);
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

  async function runBatchConvert() {
    const pendingTasks = tasks.filter((task) => task.status === "pending" || task.status === "failed");
    if (pendingTasks.length === 0) {
      showFloatingToast(systemWindow, "info", "当前没有待转换任务");
      return;
    }

    setIsConverting(true);
    setCurrentTemplateId(activeTemplateId);
    const results: ConvertResult[] = [];
    let unexpectedFailureCount = 0;
    try {
      for (const task of pendingTasks) {
        try {
          results.push(await convertTask(task));
        } catch (error) {
          unexpectedFailureCount += 1;
          updateTask(task.id, { status: "failed", message: userFacingErrorMessage(error, "转换失败") });
        }
      }
      await persistHistory(results.map(buildHistoryItem));
      const failedCount = results.filter((result) => !result.ok).length + unexpectedFailureCount;
      const warningCount = results.reduce((total, result) => total + actionableConversionWarnings(result.warnings).length, 0);
      showFloatingToast(systemWindow, failedCount > 0 ? "error" : warningCount > 0 ? "info" : "success", failedCount > 0 ? `批量转换完成，${failedCount} 个失败` : `已完成 ${results.length} 个转换任务${warningCount > 0 ? `，${warningCount} 条提示待检查` : ""}`);
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
        systemWindow && isIdleDimmed && !open && "opacity-55 hover:opacity-100",
      )}
      style={systemWindow
        ? { alignItems: dockSide === "left" ? "flex-start" : dockSide === "right" ? "flex-end" : "center" }
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
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{tasks.length > 0 ? `${tasks.length} 个文件待转换` : "暂无任务"}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <GripHorizontal className="size-4 text-slate-400 dark:text-slate-500" aria-hidden="true" />
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
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">.md · .markdown · .txt</p>
              {canUseSystemWindow ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-zinc-900 dark:text-slate-100 dark:hover:bg-zinc-800"
                  onClick={() => void chooseMarkdownFiles()}
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

            <Button className="h-9 w-full shrink-0 bg-sky-600 font-semibold text-white shadow-none hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 dark:bg-sky-500 dark:hover:bg-sky-400" onClick={runBatchConvert} disabled={isConverting || tasks.length === 0}>
              {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {isConverting ? "正在转换..." : `开始转换${tasks.length > 0 ? `（${tasks.length}）` : ""}`}
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
          onPointerLeave={() => scheduleDockCollapse(650)}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setPanelDragging(true);
            resetIdleCollapseTimer();
          }}
          onDragLeave={() => setPanelDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setPanelDragging(false);
            resetIdleCollapseTimer();
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) {
              void addFiles(files);
              return;
            }
            showFloatingToast(systemWindow, "error", "请拖入 .md、.markdown 或 .txt 文件");
          }}
        >
          <TooltipButton
            type="button"
            className={cn(
              "relative flex h-11 items-center justify-center overflow-hidden rounded-[13px] transition-[width,opacity,transform,background-color,border-color] duration-200 ease-out hover:scale-[1.03] cursor-grab active:scale-[0.98] active:cursor-grabbing",
              !systemWindow && "mk-floating-ball",
              systemWindow && isIdleCollapsed ? "w-3.5" : "w-11",
              systemWindow && edgeDocked && !isIdleCollapsed && "opacity-85",
              systemWindow && isIdleCollapsed && dockSide === "left" && "rounded-l-none border border-l-0 border-slate-300/80 bg-white/92 text-slate-600 shadow-md dark:border-zinc-700 dark:bg-zinc-900/92 dark:text-zinc-200",
              systemWindow && isIdleCollapsed && dockSide === "right" && "rounded-r-none border border-r-0 border-slate-300/80 bg-white/92 text-slate-600 shadow-md dark:border-zinc-700 dark:bg-zinc-900/92 dark:text-zinc-200",
              panelDragging && "scale-105 ring-2 ring-[var(--app-primary)]",
              !enabled && "opacity-80 ring-2 ring-white/80",
              dragging && "scale-105",
            )}
            data-dragging={panelDragging ? "true" : "false"}
            onPointerEnter={() => {
              if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
              setIsIdleCollapsed(false);
              setIsIdleDimmed(false);
              void revealDockedSystemWindow();
            }}
            onPointerDown={(event) => {
              if (systemWindow) {
                handleSystemBallPointerDown(event);
                return;
              }
              handleBallPointerDown(event);
            }}
            onClick={() => {
              if (systemWindow) return;
              resetIdleCollapseTimer();
            }}
            tooltip={systemWindow ? "点击展开；拖动移动；可拖入 Markdown/TXT 文件" : "拖动悬浮球；点击打开批量转换"}
            aria-label="悬浮球批量转换"
          >
            {systemWindow && isIdleCollapsed && dockSide ? (
              dockSide === "right" ? <ChevronsLeft className="size-3.5 shrink-0" /> : <ChevronsRight className="size-3.5 shrink-0" />
            ) : (
              <MdKingLogo className="relative z-10 size-11" />
            )}
            {tasks.length > 0 && !isIdleCollapsed ? (
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
                onClick={() => void runBatchConvert()}
                disabled={isConverting || tasks.length === 0}
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
