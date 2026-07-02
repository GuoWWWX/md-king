import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { cn } from "@/lib/utils";

function getAppWindow(): Window | undefined {
  try {
    return getCurrentWindow();
  } catch {
    return undefined;
  }
}

export function AppTitlebar() {
  const [isMaximized, setIsMaximized] = useState(false);

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

  function handleDoubleClick() {
    void getAppWindow()?.toggleMaximize().then(syncMaximizedState);
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
    <div className="mk-titlebar flex h-[72px] shrink-0 select-none items-center border-b border-white/70 bg-white/58 text-slate-700 backdrop-blur-xl">
      <div className="flex h-full w-[208px] items-center gap-3 px-5" data-tauri-drag-region onDoubleClick={handleDoubleClick}>
        <MdKingLogo className="size-10 shrink-0 rounded-[12px] shadow-[0_14px_28px_rgba(37,99,235,0.22)]" />
        <div className="min-w-0 leading-none" data-tauri-drag-region>
          <div className="text-lg font-black tracking-tight text-slate-950" data-tauri-drag-region>MD King</div>
          <div className="mt-1 text-[11px] font-semibold text-blue-900/42" data-tauri-drag-region>AI Markdown to Word</div>
        </div>
      </div>

      <div
        className="flex h-full min-w-0 flex-1 items-center justify-end gap-3 px-4 text-xs font-bold text-blue-900/55"
        data-tauri-drag-region
        onDoubleClick={handleDoubleClick}
      >
        <span className="rounded-full bg-blue-50/80 px-3 py-1.5 text-blue-700 shadow-sm" data-tauri-drag-region>专业版</span>
        <span className="hidden rounded-full bg-white/62 px-3 py-1.5 shadow-sm md:inline" data-tauri-drag-region>已同步</span>
        <span className="hidden rounded-full bg-white/62 px-3 py-1.5 shadow-sm xl:inline" data-tauri-drag-region>帮助</span>
      </div>

      <div className="flex h-full shrink-0 items-center">
        <TitlebarButton label="最小化" onClick={() => handleWindowAction("minimize")}>
          <Minus className="size-4" />
        </TitlebarButton>
        <TitlebarButton label={isMaximized ? "还原窗口" : "最大化"} onClick={() => handleWindowAction("toggleMaximize")}>
          {isMaximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
        </TitlebarButton>
        <TitlebarButton label="关闭" danger onClick={() => handleWindowAction("close")}>
          <X className="size-4" />
        </TitlebarButton>
      </div>
    </div>
  );
}

function TitlebarButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "mk-titlebar-button relative z-10 flex h-[72px] w-12 items-center justify-center text-slate-500 transition hover:bg-white/60 hover:text-slate-950",
        danger && "mk-titlebar-button-danger hover:bg-red-500 hover:text-white",
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
