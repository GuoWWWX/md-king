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
    // 自定义 ContextMenu 仍会收到事件；这里只负责兜底屏蔽 WebView/浏览器原生菜单。
    const preventNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-mk-context-menu]")) event.preventDefault();
    };
    document.addEventListener("contextmenu", preventNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", preventNativeContextMenu, true);
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
