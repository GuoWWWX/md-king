import { Columns2, Copy, Minus, PanelLeft, PanelRight, Search, Square, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { TooltipAnchor } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { handleTauriWindowDrag, handleTauriWindowDoubleClick } from "@/lib/tauri";
import { PAGE_ZOOM_MAX_PERCENT, PAGE_ZOOM_MIN_PERCENT, PAGE_ZOOM_STEP_PERCENT } from "@/lib/page-zoom";

function getAppWindow(): TauriWindow | undefined {
  if (!isTauriEnvironment()) return undefined;

  try {
    return getCurrentWindow();
  } catch {
    return undefined;
  }
}

function isTauriEnvironment() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

type AppTitlebarProps = {
  fileTreeVisible?: boolean;
  onToggleFileTree?: () => void;
  showDocumentDrawerControl?: boolean;
  documentDrawerOpen?: boolean;
  onToggleDocumentDrawer?: () => void;
  onOpenGlobalSearch?: () => void;
  pageZoomPercent?: number;
  onPageZoomChange?: (percent: number) => void;
  documentTabsOffset?: number;
  fileTreeWidth?: number;
};

export function AppTitlebar({ fileTreeVisible = false, onToggleFileTree, showDocumentDrawerControl = false, documentDrawerOpen = false, onToggleDocumentDrawer, onOpenGlobalSearch, pageZoomPercent = 100, onPageZoomChange, documentTabsOffset = 0, fileTreeWidth }: AppTitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const canControlWindow = isTauriEnvironment();

  async function syncMaximizedState() {
    const appWindow = getAppWindow();
    if (!appWindow) return;

    try {
      setIsMaximized(await appWindow.isMaximized());
    } catch {
      setIsMaximized(false);
    }
  }

  useEffect(() => {
    const appWindow = getAppWindow();
    if (!appWindow) return;

    void syncMaximizedState();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void appWindow.onResized(async () => {
      if (!disposed) await syncMaximizedState();
    }).then((cleanup) => {
      unlisten = cleanup;
      if (disposed) cleanup();
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function handleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    handleTauriWindowDoubleClick(event);
  }

  function handleWindowAction(action: "minimize" | "toggleMaximize" | "close") {
    const appWindow = getAppWindow();
    if (!appWindow) return;

    if (action === "minimize") {
      void appWindow.minimize();
      return;
    }

    if (action === "toggleMaximize") {
      void appWindow.toggleMaximize().then(syncMaximizedState);
      return;
    }

    void appWindow.close();
  }

  return (
    <div
      className="mk-titlebar flex h-9 shrink-0 select-none items-center text-slate-700 dark:text-zinc-300"
      onPointerDown={handleTauriWindowDrag}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="flex h-full shrink-0 items-center gap-1 px-2"
        style={{
          width: fileTreeVisible && fileTreeWidth ? `${fileTreeWidth + 53.5}px` : "224px",
        }}
        onPointerDown={handleTauriWindowDrag}
        onDoubleClick={handleDoubleClick}
      >
        {onToggleFileTree ? (
          <TitlebarButton
            label={fileTreeVisible ? "收起文件树" : "展开文件树"}
            onClick={onToggleFileTree}
          >
            {fileTreeVisible ? <PanelStateIcon side="left" /> : <PanelLeft className="size-4" />}
          </TitlebarButton>
        ) : null}
        {onPageZoomChange ? <PageZoomControls percent={pageZoomPercent} onChange={onPageZoomChange} /> : null}
        {onOpenGlobalSearch ? (
          <TitlebarButton label="全局搜索" onClick={onOpenGlobalSearch}>
            <Search className="size-4" />
          </TitlebarButton>
        ) : null}
      </div>

      {/* 竖向分割线：精准对齐左侧文件树与右侧 Markdown 编辑区缝隙的正中间铅垂线 */}
      <span className="h-4 w-px shrink-0 bg-slate-200 dark:bg-zinc-700" aria-hidden />

      <div
        id="mk-titlebar-document-tabs"
        className="flex h-full min-w-0 flex-1 items-stretch pl-1"
        style={{ marginLeft: documentTabsOffset }}
        onPointerDown={handleTauriWindowDrag}
        onDoubleClick={handleDoubleClick}
      />

      <div
        className="flex h-full shrink-0 items-center"
        onPointerDown={handleTauriWindowDrag}
        onDoubleClick={handleDoubleClick}
      >
        {showDocumentDrawerControl && onToggleDocumentDrawer ? (
          <>
            <TitlebarButton
              label={documentDrawerOpen ? "关闭文档侧栏" : "打开文档侧栏"}
              onClick={onToggleDocumentDrawer}
            >
              {documentDrawerOpen ? <PanelStateIcon side="right" /> : <PanelRight className="size-4" />}
            </TitlebarButton>
          </>
        ) : null}
        {showDocumentDrawerControl && onToggleDocumentDrawer ? (
          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
        ) : null}
        <TitlebarButton disabled={!canControlWindow} label="最小化" onClick={() => handleWindowAction("minimize")}>
          <Minus className="size-3.5" />
        </TitlebarButton>
        <TitlebarButton disabled={!canControlWindow} label={isMaximized ? "还原窗口" : "最大化"} onClick={() => handleWindowAction("toggleMaximize")}>
          {isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </TitlebarButton>
        <TitlebarButton disabled={!canControlWindow} label="关闭" danger onClick={() => handleWindowAction("close")}>
          <X className="size-3.5" />
        </TitlebarButton>
      </div>
    </div>
  );
}

function PageZoomControls({ percent, onChange }: { percent: number; onChange: (percent: number) => void }) {
  const [draft, setDraft] = useState(String(percent));

  useEffect(() => {
    setDraft(String(percent));
  }, [percent]);

  function commit() {
    const next = Number.parseInt(draft, 10);
    if (!Number.isFinite(next)) {
      setDraft(String(percent));
      return;
    }
    onChange(next);
  }

  return (
    <div className="flex h-9 items-center gap-0.5 px-0.5" aria-label="页面缩放">
      <ZoomButton label="缩小页面" disabled={percent <= PAGE_ZOOM_MIN_PERCENT} onClick={() => onChange(percent - PAGE_ZOOM_STEP_PERCENT)}>
        <ZoomOut className="size-3.5" />
      </ZoomButton>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        aria-label="页面缩放百分比"
        className="h-6 w-9 rounded-[4px] border border-transparent bg-transparent px-1 text-center tabular-nums text-slate-600 outline-none transition focus:border-transparent focus:ring-0 dark:border-transparent dark:bg-transparent dark:text-zinc-300"
        style={{ fontSize: "11px", lineHeight: 1 }}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span className="w-3 text-[10px] leading-none text-slate-400 dark:text-zinc-500">%</span>
      <ZoomButton label="放大页面" disabled={percent >= PAGE_ZOOM_MAX_PERCENT} onClick={() => onChange(percent + PAGE_ZOOM_STEP_PERCENT)}>
        <ZoomIn className="size-3.5" />
      </ZoomButton>
    </div>
  );
}

function ZoomButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <TooltipAnchor content={label} tooltipSide="bottom">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className="flex h-7 w-7 items-center justify-center rounded-[4px] text-slate-500 transition hover:bg-white/70 hover:text-slate-950 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) onClick();
        }}
      >
        {children}
      </button>
    </TooltipAnchor>
  );
}

function PanelStateIcon({ side }: { side: "left" | "right" }) {
  return (
    <span className="relative block size-4" aria-hidden="true">
      <span className={cn("absolute inset-y-0.5 bg-current", side === "left" ? "left-0.5 right-1/2" : "left-1/2 right-0.5")} />
      <Columns2 className="relative size-4" />
    </span>
  );
}

function TitlebarButton({ label, danger = false, disabled = false, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const title = disabled ? `${label}仅在桌面端可用` : label;

  return (
    <TooltipAnchor content={title} tooltipSide="bottom">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "mk-titlebar-button relative z-10 flex h-9 w-8 items-center justify-center text-slate-500 transition hover:bg-white/70 hover:text-slate-950 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-500",
          danger && !disabled && "mk-titlebar-button-danger hover:bg-red-500 hover:text-white",
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          onClick();
        }}
      >
        {children}
      </button>
    </TooltipAnchor>
  );
}
