import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { ArrowRight, Loader2, Maximize2, Minimize2, MousePointer2, Plus, Trash2, UploadCloud } from "lucide-react";
import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { buildDocxOutputName, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem } from "@/lib/conversion-history";
import { readMarkdownFile } from "@/lib/markdown-files";
import { convertMarkdown, saveHistory } from "@/lib/tauri";
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
};

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

const positionStorageKey = "md-king:floating-ball-position";
const floatingWindowClosedWidth = 74;
const floatingWindowClosedHeight = 104;
const floatingWindowDragWidth = 132;
const floatingWindowDragHeight = 148;
const expandedWidth = 360;
const expandedHeight = 520;

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
  const { appConfig, templates, history, currentTemplateId, setHistory, setCurrentTemplateId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(loadInitialPosition);
  const [dragging, setDragging] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  const [tasks, setTasks] = useState<FloatingTask[]>([]);
  const [textDraft, setTextDraft] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [edgeDocked, setEdgeDocked] = useState(false);
  const [isIdleCollapsed, setIsIdleCollapsed] = useState(false);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const dragStateRef = useRef<{ startX: number; startY: number; startWindowX: number; startWindowY: number; moved: boolean } | null>(null);
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const defaultTemplate = templateOptions.find((template) => template.id === currentTemplateId)
    ?? templateOptions.find((template) => template.id === appConfig?.defaultTemplateId)
    ?? templateOptions.find((template) => template.isDefault)
    ?? templateOptions[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const activeTemplateId = selectedTemplateId || defaultTemplate?.id || fallbackTemplate.id;

  const enabled = systemWindow ? true : (appConfig?.enableFloatingBall ?? true);

  useEffect(() => {
    if (!systemWindow) return;
    const width = open ? expandedWidth : panelDragging ? floatingWindowDragWidth : floatingWindowClosedWidth;
    const height = open ? expandedHeight : panelDragging ? floatingWindowDragHeight : floatingWindowClosedHeight;
    void getCurrentWindow().setSize(new LogicalSize(width, height));
  }, [open, panelDragging, systemWindow]);

  async function startSystemWindowDrag(startScreenX: number, startScreenY: number) {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalPosition = position.toLogical(scaleFactor);
    dragStateRef.current = {
      startX: startScreenX,
      startY: startScreenY,
      startWindowX: logicalPosition.x,
      startWindowY: logicalPosition.y,
      moved: false,
    };
    setDragging(true);
    setEdgeDocked(false);
    setIsIdleCollapsed(false);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const state = dragStateRef.current;
      if (!state) return;
      const deltaX = moveEvent.screenX - state.startX;
      const deltaY = moveEvent.screenY - state.startY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) state.moved = true;
      void appWindow.setPosition(new LogicalPosition(state.startWindowX + deltaX, state.startWindowY + deltaY));
    }

    function handlePointerUp() {
      const state = dragStateRef.current;
      dragStateRef.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resetIdleCollapseTimer();
      if (state && !state.moved) {
        return;
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function resetIdleCollapseTimer() {
    if (!systemWindow || open) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    setIsIdleCollapsed(false);
    idleTimerRef.current = window.setTimeout(() => {
      setIsIdleCollapsed(true);
    }, 2200);
  }

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!systemWindow || open) return;
    resetIdleCollapseTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [open, systemWindow, tasks.length]);

  function handlePointerOpenPanel() {
    if (!systemWindow) return;
    setOpen(true);
    setEdgeDocked(false);
    setIsIdleCollapsed(false);
  }

  useEffect(() => {
    if (!systemWindow) return;
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
      const markdownPaths = payload.paths.filter((path) => /\.(md|markdown)$/i.test(path));
      if (markdownPaths.length === 0) {
        showFloatingToast(systemWindow, "error", "请拖入 .md 或 .markdown 文件");
        return;
      }

      setTasks((current) => [...markdownPaths.map(makePathTask), ...current]);
      showFloatingToast(systemWindow, "success", `已加入 ${markdownPaths.length} 个 Markdown 任务`);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, [systemWindow, templates.length, currentTemplateId, appConfig?.defaultOutputDir]);

  useEffect(() => {
    if (!systemWindow) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        setOpen(false);
        resetIdleCollapseTimer();
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, [systemWindow]);

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
      void startSystemWindowDrag(event.screenX, event.screenY);
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

  function addTextTask() {
    const text = textDraft.trim();
    if (!text) {
      showFloatingToast(systemWindow, "error", "请先粘贴要转换的 Markdown 文本");
      return;
    }
    setTasks((current) => [makeTask("粘贴文本", text), ...current]);
    setTextDraft("");
  }

  async function addFiles(files: File[]) {
    const nextTasks: FloatingTask[] = [];
    resetIdleCollapseTimer();
    for (const file of files) {
      try {
        const item = await readMarkdownFile(file);
        nextTasks.push(makeTask(item.name, item.text));
      } catch (error) {
        showFloatingToast(systemWindow, "error", error instanceof Error ? error.message : `读取 ${file.name} 失败`);
      }
    }

    if (nextTasks.length > 0) {
      setTasks((current) => [...nextTasks, ...current]);
      showFloatingToast(systemWindow, "success", `已加入 ${nextTasks.length} 个转换任务`);
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
    const plainText = event.dataTransfer.getData("text/plain").trim();

    if (files.length > 0) {
      void addFiles(files);
      return;
    }

    if (plainText) {
      setTasks((current) => [makeTask("拖入文本", plainText), ...current]);
      toast.success("已加入拖入文本");
      return;
    }

    toast.error("没有识别到可转换的 Markdown 文件或文本");
  }

  async function persistHistory(nextItems: HistoryItem[]) {
    setHistory(nextItems);
    try {
      await saveHistory(nextItems);
    } catch {
      // 浏览器预览或文件写入失败时，本地状态仍保留。
    }
  }

  async function convertTask(task: FloatingTask) {
    updateTask(task.id, { status: "running", message: "转换中..." });
    const outputName = buildDocxOutputName(task.text);
    const input = task.inputPath?.trim() ? task.inputPath : task.text;
    const output = task.inputPath?.trim() ? task.inputPath.replace(/\.(md|markdown)$/i, ".docx") : buildOutputPath(appConfig?.defaultOutputDir, outputName);
    const result = await convertMarkdown({
      input,
      output,
      templateId: activeTemplateId,
      openAfterConvert: appConfig?.openAfterConvert ?? true,
      overwrite: appConfig?.defaultConflictStrategy !== "ask",
    });
    updateTask(task.id, {
      status: result.ok && !result.simulated ? "success" : result.simulated ? "success" : "failed",
      message: result.message ?? (result.ok ? "转换完成" : "转换失败"),
    });
    return result;
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
    try {
      for (const task of pendingTasks) {
        try {
          results.push(await convertTask(task));
        } catch (error) {
          updateTask(task.id, { status: "failed", message: error instanceof Error ? error.message : "转换失败" });
        }
      }
      const nextHistory = [...results.map(buildHistoryItem), ...history].slice(0, 20);
      await persistHistory(nextHistory);
      const failedCount = results.filter((result) => !result.ok).length;
      showFloatingToast(systemWindow, failedCount > 0 ? "error" : "success", failedCount > 0 ? `批量转换完成，${failedCount} 个失败` : `已完成 ${results.length} 个转换任务`);
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div
      className={cn(
        systemWindow
          ? open
            ? "fixed left-0 top-0 z-40 h-[520px] w-[360px] overflow-hidden bg-transparent"
            : "fixed left-0 top-0 z-40 flex h-[104px] w-[74px] flex-col items-center justify-start gap-1 bg-transparent pt-1"
          : "fixed z-40",
        systemWindow && edgeDocked && !open && "opacity-65 hover:opacity-100",
      )}
      style={systemWindow ? undefined : { right: position.x, bottom: position.y }}
    >
      {open ? (
        <div className="h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/60">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-950 dark:text-slate-50">悬浮球批量转换</p>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">拖入 Markdown 文件或文本，选择模板后转换。</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(event) => {
                event.stopPropagation();
                void startSystemWindowDrag(event.screenX, event.screenY);
              }}
              onPointerUp={() => undefined}
              onPointerLeave={() => undefined}
              onClick={() => setOpen(false)}
              aria-label="收起悬浮球面板"
            >
              <Minimize2 className="size-4" />
            </Button>
          </div>

          <div className="space-y-3 p-3">
            <div
              className={cn(
                "rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-center transition dark:border-slate-700 dark:bg-slate-950/50",
                panelDragging && "border-[var(--app-primary)] bg-[var(--app-primary-soft)]",
              )}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <UploadCloud className="mx-auto size-6 text-[var(--app-primary)]" />
              <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">拖入多个 .md 文件，或拖入 Markdown 文本</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">目标模板</Label>
              <Select value={activeTemplateId} onValueChange={(value) => { setSelectedTemplateId(value); setCurrentTemplateId(value); }}>
                <SelectTrigger className="h-9 rounded-lg border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                  <SelectValue placeholder="使用上次模板" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Textarea
                className="min-h-20 resize-none rounded-lg border-slate-200 bg-slate-50 text-xs dark:border-slate-700 dark:bg-slate-950"
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                placeholder="# 标题\n\n也可以把一段 Markdown 文本粘贴到这里..."
                disabled={isConverting}
              />
              <Button variant="outline" size="sm" className="w-full" onClick={addTextTask} disabled={isConverting}>
                <Plus className="size-4" />
                加入文本任务
              </Button>
            </div>

            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60">暂无任务，拖入文件或文本后会显示在这里。</p>
              ) : tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950/60">
                  <span className={cn("size-2 shrink-0 rounded-full", task.status === "success" ? "bg-emerald-500" : task.status === "failed" ? "bg-red-500" : task.status === "running" ? "bg-amber-500" : "bg-slate-300")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-100">{task.name}</p>
                    <p className="truncate text-slate-400">{task.message ?? `${task.text.length} 字符`}</p>
                  </div>
                  <Button variant="ghost" size="icon-xs" onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))} disabled={isConverting} aria-label="移除任务">
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>

            <Button className="h-10 w-full rounded-xl bg-[var(--app-primary)] font-semibold hover:bg-[var(--app-primary-hover)]" onClick={runBatchConvert} disabled={isConverting || tasks.length === 0}>
              {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {isConverting ? "正在批量转换..." : `开始转换 ${tasks.length} 项`}
            </Button>
          </div>
        </div>
      ) : null}

      {!open ? (
        <div
          className={cn(
            "flex flex-col items-center gap-1 transition",
            edgeDocked && "translate-x-1",
            isIdleCollapsed && "scale-90 opacity-55",
            panelDragging && "scale-105 opacity-100",
          )}
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
            const plainText = event.dataTransfer.getData("text/plain").trim();
            if (plainText) {
              setTasks((current) => [makeTask("拖入文本", plainText), ...current]);
              toast.success("已加入拖入文本");
            }
          }}
        >
          <button
            type="button"
            className={cn(
              "flex items-center justify-center bg-[var(--app-primary)] text-white shadow-2xl shadow-slate-900/25 transition hover:scale-105 hover:bg-[var(--app-primary-hover)] cursor-grab active:cursor-grabbing",
              systemWindow ? "size-[52px] rounded-xl" : "size-14 rounded-xl",
              systemWindow && edgeDocked && "bg-white/80 text-[var(--app-primary)] shadow-lg",
              panelDragging && "scale-110 bg-[var(--app-primary-soft)] text-[var(--app-primary)] ring-2 ring-[var(--app-primary)] ring-offset-2 ring-offset-white shadow-xl",
              !enabled && "opacity-80 ring-2 ring-white/80",
              dragging && "scale-105",
            )}
            onPointerDown={(event) => {
              if (systemWindow) {
                resetIdleCollapseTimer();
                void startSystemWindowDrag(event.screenX, event.screenY);
                return;
              }
              handleBallPointerDown(event);
            }}
            onClick={() => resetIdleCollapseTimer()}
            title={systemWindow ? "长按拖动悬浮球；拖入文件后点下方按钮" : "拖动悬浮球；点击打开批量转换"}
            aria-label="悬浮球批量转换"
          >
            <MousePointer2 className="size-6" />
          </button>
          {systemWindow && tasks.length > 0 ? (
            <div className="flex items-center gap-1 rounded-full bg-white/85 p-1 shadow-lg shadow-slate-900/10 backdrop-blur dark:bg-slate-900/85">
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full bg-[var(--app-primary)] text-white disabled:opacity-40"
                title="开始转换"
                aria-label="开始转换"
                onClick={() => void runBatchConvert()}
                disabled={isConverting || tasks.length === 0}
              >
                {isConverting ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
              </button>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full text-[var(--app-primary)] hover:bg-[var(--app-primary-soft)]"
                title="展开设置"
                aria-label="展开设置"
                onClick={handlePointerOpenPanel}
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
