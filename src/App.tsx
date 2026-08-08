import { FileText, History, Info, LayoutTemplate, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { applyAppearance } from "@/lib/appearance";
import { SystemFloatingWindowManager } from "@/components/floating/system-floating-window-manager";
import { FloatingConverter } from "@/components/floating/floating-converter";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import type { PageMeta } from "@/components/layout/page-header";
import { AboutPage } from "@/pages/about/about-page";
import { ConvertPage } from "@/pages/convert/convert-page";
import { HistoryPage } from "@/pages/history/history-page";
import { SettingsPage } from "@/pages/settings/settings-page";
import { TemplatesPage } from "@/pages/templates/templates-page";
import { checkPandoc, getAppConfig, getAppStatus, listHistory, listTemplates, takeOpenFiles } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";

const navigation = [
  { id: "convert", label: "转换", icon: FileText },
  { id: "templates", label: "模板中心", icon: LayoutTemplate },
  { id: "history", label: "转换历史", icon: History },
  { id: "settings", label: "设置", icon: Settings },
  { id: "about", label: "关于", icon: Info },
];

const pageMeta: Record<string, PageMeta> = {
  convert: {
    eyebrow: "AI Markdown 文档格式化工作台",
    title: "转换 Markdown 为 Word",
    description: "拖入 Markdown 文件，或粘贴 AI 生成内容，一键生成样式统一、可继续编辑的 DOCX 文档。",
    tags: ["本地转换", "Word/WPS", "模板样式可复用"],
  },
  templates: {
    eyebrow: "Word/WPS 模板中心",
    title: "模板中心",
    description: "管理 Word/WPS 样式模板，让同一份 Markdown 按不同模板生成稳定统一的文档效果。",
    tags: ["参考 DOCX", "样式诊断", "样式管理器"],
  },
  history: {
    eyebrow: "转换记录",
    title: "转换历史",
    description: "查看最近生成的 DOCX，快速复制输出路径、定位失败原因，或重新触发转换流程。",
    tags: ["成功 / 失败", "模板追踪", "错误详情"],
  },
  settings: {
    eyebrow: "偏好与系统集成",
    title: "设置中心",
    description: "配置默认输出目录、Pandoc 路径、转换行为和系统集成能力。",
    tags: ["Pandoc", "右键菜单", "悬浮球"],
  },
  about: {
    eyebrow: "关于 md-king",
    title: "关于 md-king",
    description: "面向 AI 时代的 Markdown 转 Word/WPS 本地效率工具。",
    tags: ["隐私优先", "本地运行", "Pandoc 引擎"],
  },
};

type QuickPasteStatusEvent = {
  level: "info" | "success" | "error";
  message: string;
};

function App() {
  const { activePage, appConfig, setActivePage, setAppStatus, setAppConfig, setTemplates, setHistory, setPandocStatus, queueImportPaths } = useAppStore();
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
    Promise.allSettled([getAppStatus(), getAppConfig(), listTemplates(), listHistory(), checkPandoc()]).then((results) => {
      const [statusResult, configResult, templatesResult, historyResult, pandocResult] = results;

      if (statusResult.status === "fulfilled") setAppStatus(statusResult.value);
      if (configResult.status === "fulfilled") setAppConfig(configResult.value);
      if (templatesResult.status === "fulfilled") setTemplates(templatesResult.value);
      if (historyResult.status === "fulfilled") setHistory(historyResult.value);
      if (pandocResult.status === "fulfilled") setPandocStatus(pandocResult.value);
      setBootReady(true);
    });
  }, [setAppConfig, setAppStatus, setHistory, setPandocStatus, setTemplates]);

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
    if (!navigation.some((item) => item.id === activePage)) {
      setActivePage("convert");
    }
  }, [activePage, setActivePage]);

  // 转换页常驻挂载、非激活时藏起来：里面有编辑器的正文、光标和撤销历史，
  // 切去设置页再回来不该丢。其余页面按需挂载，没有需要保留的状态。
  //
  // 激活时用 contents 让转换页自己的 flex 布局直接作用在 main 的子级上，
  // 隐藏时必须换成真正生成盒子的 hidden —— contents 不生成盒子，
  // display:none 会被它压掉，页面根本藏不住。
  const renderPage = () => (
    <>
      <div className={activePage === "convert" ? "contents" : "hidden"} aria-hidden={activePage !== "convert"}>
        <ConvertPage />
      </div>
      {activePage === "templates" ? <TemplatesPage /> : null}
      {activePage === "history" ? <HistoryPage /> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
      {activePage === "about" ? <AboutPage /> : null}
    </>
  );

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
      <SystemFloatingWindowManager />
      <AppShell navigation={navigation} pageMeta={pageMeta[activePage] ?? pageMeta.convert}>
        {renderPage()}
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
