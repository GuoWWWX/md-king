import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";

const floatingWindowLabel = "floating-converter";
const systemPositionStorageKey = "md-king:system-floating-window-position";
const floatingWindowClosedWidth = 48;
const floatingWindowClosedHeight = 48;
const dockVisibleWidth = 12;

function isTauriEnvironment() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

function loadSystemFloatingWindowPosition() {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const screenLeft = screen.availLeft ?? 0;
  const screenTop = screen.availTop ?? 0;
  const defaultPosition = {
    x: Math.max(screenLeft + 24, screenLeft + screen.availWidth - floatingWindowClosedWidth - 24),
    y: Math.max(screenTop + 24, screenTop + screen.availHeight - floatingWindowClosedHeight - 72),
  };

  try {
    const stored = window.localStorage.getItem(systemPositionStorageKey);
    if (!stored) return defaultPosition;
    const parsed = JSON.parse(stored) as { x?: number; y?: number };
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return defaultPosition;
    return {
      x: Math.max(screenLeft - floatingWindowClosedWidth + dockVisibleWidth, Math.min(parsed.x, screenLeft + screen.availWidth - dockVisibleWidth)),
      y: Math.max(screenTop + 8, Math.min(parsed.y, screenTop + screen.availHeight - floatingWindowClosedHeight - 8)),
    };
  } catch {
    return defaultPosition;
  }
}

export function SystemFloatingWindowManager() {
  const appConfig = useAppStore((state) => state.appConfig);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;

    async function syncFloatingWindow() {
      const existing = await WebviewWindow.getByLabel(floatingWindowLabel);

      if (!appConfig?.enableFloatingBall) {
        await existing?.close();
        return;
      }

      if (existing) {
        await existing.show();
        await existing.setSize(new LogicalSize(floatingWindowClosedWidth, floatingWindowClosedHeight));
        await existing.setAlwaysOnTop(true);
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("floating", "1");
      const position = loadSystemFloatingWindowPosition();

      const floatingWindow = new WebviewWindow(floatingWindowLabel, {
        url: `${url.pathname}${url.search}${url.hash}`,
        title: "md-king 悬浮球",
        width: floatingWindowClosedWidth,
        height: floatingWindowClosedHeight,
        minWidth: floatingWindowClosedWidth,
        minHeight: floatingWindowClosedHeight,
        x: position.x,
        y: position.y,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focus: false,
        shadow: false,
      });

      floatingWindow.once("tauri://created", async () => {
        if (cancelled) {
          await floatingWindow.close();
          return;
        }
        await floatingWindow.setSize(new LogicalSize(floatingWindowClosedWidth, floatingWindowClosedHeight));
        await floatingWindow.setPosition(new LogicalPosition(position.x, position.y));
        await floatingWindow.setAlwaysOnTop(true);
        await floatingWindow.setSkipTaskbar(true);
      });
    }

    void syncFloatingWindow();

    return () => {
      cancelled = true;
    };
  }, [appConfig?.enableFloatingBall]);

  return null;
}
