import { History, Info, LayoutTemplate, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { applyAppearance } from "@/lib/appearance";
import { SystemFloatingWindowManager } from "@/components/floating/system-floating-window-manager";
import { FloatingConverter } from "@/components/floating/floating-converter";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { appPageMeta } from "@/components/layout/page-meta";
import { AboutPage } from "@/pages/about/about-page";
import { ConvertPage } from "@/pages/convert/convert-page";
import { HistoryPage } from "@/pages/history/history-page";
import { SettingsPage } from "@/pages/settings/settings-page";
import { TemplatesPage } from "@/pages/templates/templates-page";
import { getAppConfig, getAppStatus, listHistory, listTemplates, takeOpenFiles } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";

const navigation = [
  { id: "templates", label: "模板中心", icon: LayoutTemplate },
  { id: "history", label: "转换历史", icon: History },
  { id: "settings", label: "设置", icon: Settings },
  { id: "about", label: "关于", icon: Info },
];

type QuickPasteStatusEvent = {
  level: "info" | "success" | "error";
  message: string;
};

const BOOT_SCREEN_MAX_WAIT_MS = 350;

function App() {
  const { activePage, appConfig, setActivePage, setAppStatus, setAppConfig, setTemplates, setHistory, queueImportPaths } = useAppStore();
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    const previousBodyMinWidth = document.body.style.minWidth;
    const previousHtmlMinWidth = document.documentElement.style.minWidth;
    document.body.style.minWidth = "0";
    document.documentElement.style.minWidth = "0";

    return () => {
      document.body.style.minWidth = previousBodyMinWidth;
      document.documentElement.style.minWidth = previousHtmlMinWidth;
    };
  }, []);

  useEffect(() => {
    // 防锁死自愈机制 (Self-Healing Guardian)：
    // Radix UI 等模态库在打开弹窗/菜单时会将 document.body.style.pointerEvents 设为 none。
    // 若在关闭时因外部失焦、快捷键或卸载竞态遗留了 pointer-events: none，整页将无法点击。
    // 此守护在没有可见弹窗或活动菜单时，自动重置 body 的 pointerEvents。
    const hasActiveModalOrMenu = () => {
      return Boolean(
        document.querySelector(
          '[data-slot="dialog-content"], [data-slot="dialog-overlay"], [role="dialog"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
        )
      );
    };

    const healBodyPointerEvents = () => {
      if (document.body.style.pointerEvents === "none" && !hasActiveModalOrMenu()) {
        document.body.style.pointerEvents = "";
      }
    };

    const observer = new MutationObserver(() => {
      healBodyPointerEvents();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    const handleWindowFocusOrKey = () => {
      healBodyPointerEvents();
    };

    window.addEventListener("focus", handleWindowFocusOrKey);
    window.addEventListener("keydown", handleWindowFocusOrKey, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("focus", handleWindowFocusOrKey);
      window.removeEventListener("keydown", handleWindowFocusOrKey, true);
    };
  }, []);

  useEffect(() => {
    // 自定义 ContextMenu 仍会收到事件；这里只负责兜底屏蔽 WebView/浏览器原生菜单。
    const preventNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-mk-context-menu]")) event.preventDefault();
    };
    document.addEventListener("contextmenu", preventNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", preventNativeContextMenu, true);
  }, []);

  useEffect(() => {
    // 桌面端不应把 WebView 当浏览器使用：刷新、缩放、打印、历史导航和开发者工具
    // 都可能中断正在编辑或转换的任务。CodeMirror 内已实现的保存和查找/替换要保留。
    const preventNativeWebViewShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isCodeMirror = Boolean(target?.closest(".cm-editor"));
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const isDeveloperShortcut = modifier && event.shiftKey && ["i", "j", "c", "k"].includes(key);
      const isBrowserShortcut = modifier && ["d", "h", "l", "n", "o", "p", "r", "s", "t", "u", "w", "0", "=", "+", "-"].includes(key);
      const isBrowserFindOutsideEditor = modifier && key === "f" && !isCodeMirror;
      const isHistoryNavigation = event.altKey && !modifier && ["arrowleft", "arrowright"].includes(key);
      const isFunctionShortcut = event.key === "F5" || event.key === "F12" || (event.key === "F3" && !isCodeMirror);
      const isBackspaceNavigation = event.key === "Backspace" && !modifier && !event.altKey && !isCodeMirror && !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !target?.isContentEditable;

      if (!isDeveloperShortcut && !isBrowserShortcut && !isBrowserFindOutsideEditor && !isHistoryNavigation && !isFunctionShortcut && !isBackspaceNavigation) return;

      // 编辑器内的保存、查找/替换及文本编辑组合键不应被浏览器快捷键拦截。
      if (isCodeMirror && modifier && ["d", "f", "g", "l", "r", "s"].includes(key)) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", preventNativeWebViewShortcut, true);
    return () => window.removeEventListener("keydown", preventNativeWebViewShortcut, true);
  }, []);

  useEffect(() => {
    // 首屏前不发起任何 Tauri IPC：某些 Windows/WebView2 环境首次 IPC 可能被系统拦截，
    // 此时至少要先把可操作的工作台显示出来，而不是无限停留在启动页。
    const bootTimer = window.setTimeout(() => setBootReady(true), BOOT_SCREEN_MAX_WAIT_MS);
    return () => window.clearTimeout(bootTimer);
  }, []);

  useEffect(() => {
    if (!bootReady) return;

    let cancelled = false;
    const updateWhenResolved = <T,>(request: Promise<T>, update: (value: T) => void) => {
      void request.then((value) => {
        if (!cancelled) update(value);
      }).catch(() => undefined);
    };

    // 首屏展示后再独立读取数据，单个请求异常或缓慢都不会阻塞其他状态更新。
    updateWhenResolved(getAppStatus(), setAppStatus);
    updateWhenResolved(getAppConfig(), setAppConfig);
    updateWhenResolved(listTemplates(), setTemplates);
    updateWhenResolved(listHistory(), setHistory);

    return () => {
      cancelled = true;
    };
  }, [bootReady, setAppConfig, setAppStatus, setHistory, setTemplates]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<QuickPasteStatusEvent>("quick-paste://status", (event) => {
      const level = event.payload.level ?? "info";
      toast[level](event.payload.message);
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const importPendingFiles = async () => {
      try {
        const paths = await takeOpenFiles();
        if (paths.length === 0) return;
        queueImportPaths(paths);
        setActivePage("convert");
      } catch {
        // 文件入口失败不影响应用正常启动。
      }
    };

    listen("open-files://available", () => {
      void importPendingFiles();
    })
      .then((dispose) => {
        unlisten = dispose;
        void importPendingFiles();
      })
      .catch(() => undefined);

    return () => unlisten?.();
  }, [queueImportPaths, setActivePage]);

  useEffect(() => {
    if (!appConfig) return undefined;

    const themeMode = appConfig.themeMode ?? "light";
    const accentColor = appConfig.accentColor ?? "blue";
    applyAppearance(themeMode, accentColor);

    if (themeMode !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => applyAppearance(themeMode, accentColor);
    mediaQuery.addEventListener("change", handleThemeChange);
    return () => mediaQuery.removeEventListener("change", handleThemeChange);
  }, [appConfig?.accentColor, appConfig?.themeMode]);

  const isFloatingWindow = new URLSearchParams(window.location.search).get("floating") === "1";

  useEffect(() => {
    document.documentElement.dataset.floatingWindow = isFloatingWindow ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.floatingWindow;
    };
  }, [isFloatingWindow]);

  useEffect(() => {
    // convert 是承载 Markdown/图片标签的默认工作区，不再作为左侧导航项展示。
    if (activePage !== "convert" && !navigation.some((item) => item.id === activePage)) {
      setActivePage("convert");
    }
  }, [activePage, setActivePage]);

  // 非文档页面只替换 Markdown 编辑卡片的内容；转换工作台本身常驻，
  // 所以文件树、文档标签、光标与预览布局都不会因切页而重置。
  const workspaceContent = activePage === "templates"
    ? <TemplatesPage />
    : activePage === "history"
      ? <HistoryPage />
      : activePage === "settings"
        ? <SettingsPage />
        : activePage === "about"
          ? <AboutPage />
          : undefined;

  if (isFloatingWindow) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <FloatingConverter systemWindow />
      </div>
    );
  }

  if (!bootReady) {
    return <AppBootScreen />;
  }

  return (
    <>
      {appConfig ? <SystemFloatingWindowManager /> : null}
      <AppShell navigation={navigation} pageMeta={appPageMeta[activePage] ?? appPageMeta.convert}>
        <ConvertPage workspaceContent={workspaceContent} />
      </AppShell>
      <Toaster position="top-center" closeButton visibleToasts={3} />
    </>
  );
}

function AppBootScreen() {
  return (
    <div className="app-boot-screen" aria-label="MD King 正在启动">
      <div className="app-boot-card">
        <div className="app-boot-logo-wrap">
          <MdKingLogo className="app-boot-logo" />
        </div>
        <div>
          <div className="app-boot-title">MD King</div>
          <div className="app-boot-subtitle">正在准备转换工作台</div>
          <div className="app-boot-caption">本地优先的 Markdown 转 Word/WPS 工具</div>
        </div>
      </div>
    </div>
  );
}

export default App;
