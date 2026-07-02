import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";

const floatingWindowLabel = "floating-converter";

function isTauriEnvironment() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
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
        await existing.setAlwaysOnTop(true);
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("floating", "1");

      const floatingWindow = new WebviewWindow(floatingWindowLabel, {
        url: `${url.pathname}${url.search}${url.hash}`,
        title: "md-king 悬浮球",
        width: 132,
        height: 148,
        minWidth: 74,
        minHeight: 104,
        x: 1280,
        y: 720,
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
