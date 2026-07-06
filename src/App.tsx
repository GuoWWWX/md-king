import { FileText, History, Info, LayoutTemplate, Settings, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { applyAppearance } from "@/lib/appearance";
import { SystemFloatingWindowManager } from "@/components/floating/system-floating-window-manager";
import { FloatingConverter } from "@/components/floating/floating-converter";
import { MdKingLogo } from "@/components/brand/md-king-logo";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import type { PageMeta } from "@/components/layout/page-header";
import { AboutPage } from "@/pages/about/about-page";
import { CliPage } from "@/pages/cli/cli-page";
import { ConvertPage } from "@/pages/convert/convert-page";
import { HistoryPage } from "@/pages/history/history-page";
import { SettingsPage } from "@/pages/settings/settings-page";
import { TemplatesPage } from "@/pages/templates/templates-page";
import { checkPandoc, getAppConfig, getAppStatus, listHistory, listTemplates } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";

const navigation = [
  { id: "convert", label: "转换", icon: FileText },
  { id: "templates", label: "模板中心", icon: LayoutTemplate },
  { id: "history", label: "转换历史", icon: History },
  { id: "cli", label: "CLI / Agent", icon: Terminal },
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
    eyebrow: "Reference DOCX Template Center",
    title: "模板中心",
    description: "管理 Word/WPS 样式模板，让同一份 Markdown 生成报告、公文、技术文档等不同视觉风格。",
    tags: ["reference.docx", "样式诊断", "样式管理器"],
  },
  history: {
    eyebrow: "Conversion Records",
    title: "转换历史",
    description: "查看最近生成的 DOCX，快速复制输出路径、定位失败原因，或重新触发转换流程。",
    tags: ["成功 / 失败", "模板追踪", "错误详情"],
  },
  cli: {
    eyebrow: "CLI / Agent Interface",
    title: "CLI / Agent",
    description: "面向高级用户和 AI Agent 的命令行入口，提供稳定退出码、JSON 输出和模板查询能力。",
    tags: ["--json", "稳定退出码", "模板查询"],
  },
  settings: {
    eyebrow: "Preferences & Integrations",
    title: "设置中心",
    description: "配置默认输出目录、Pandoc 路径、转换行为和系统集成能力。",
    tags: ["Pandoc", "右键菜单", "悬浮球"],
  },
  about: {
    eyebrow: "About md-king",
    title: "关于 md-king",
    description: "面向 AI 时代的 Markdown 转 Word/WPS 本地效率工具。",
    tags: ["隐私优先", "本地运行", "Pandoc 引擎"],
  },
};

function App() {
  const { activePage, appConfig, setActivePage, setAppStatus, setAppConfig, setTemplates, setHistory, setPandocStatus } = useAppStore();
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

  const renderPage = () => {
    switch (activePage) {
      case "templates":
        return <TemplatesPage />;
      case "history":
        return <HistoryPage />;
      case "cli":
        return <CliPage />;
      case "settings":
        return <SettingsPage />;
      case "about":
        return <AboutPage />;
      case "convert":
      default:
        return <ConvertPage />;
    }
  };

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
