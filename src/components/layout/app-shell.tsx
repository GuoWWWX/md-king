import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/stores/app-store";
import { SidebarNav, type NavigationItem } from "./sidebar-nav";
import { AppTitlebar } from "./app-titlebar";
import type { PageMeta } from "./page-header";
import { applyAppearance } from "@/lib/appearance";
import { saveAppConfig } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import type { ThemeMode } from "@/types";

type AppShellProps = {
  navigation: NavigationItem[];
  pageMeta: PageMeta;
  children: ReactNode;
};

export function AppShell({ navigation, pageMeta, children }: AppShellProps) {
  const { activePage, setActivePage, appStatus, templates, currentTemplateId, appConfig, setAppConfig } = useAppStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentTemplate = templates.find((template) => template.id === currentTemplateId) ?? templates.find((template) => template.id === appConfig?.defaultTemplateId) ?? templates.find((template) => template.isDefault);

  function handleNavigate(page: string) {
    setActivePage(page);
  }

  async function handleSetThemeMode(nextThemeMode: ThemeMode) {
    if (!appConfig) return;
    if ((appConfig.themeMode ?? "light") === nextThemeMode) return;
    const previousConfig = appConfig;
    const nextConfig = { ...appConfig, themeMode: nextThemeMode };

    setAppConfig(nextConfig);
    applyAppearance(nextThemeMode, nextConfig.accentColor ?? "blue");

    try {
      const savedConfig = await saveAppConfig(nextConfig);
      setAppConfig(savedConfig);
    } catch (error) {
      setAppConfig(previousConfig);
      applyAppearance(previousConfig.themeMode ?? "light", previousConfig.accentColor ?? "blue");
      toast.error(userFacingErrorMessage(error, "切换外观失败"));
    }
  }

  async function handleToggleThemeMode() {
    if (!appConfig) return;
    const order: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = Math.max(0, order.indexOf(appConfig.themeMode ?? "light"));
    await handleSetThemeMode(order[(currentIndex + 1) % order.length]);
  }

  return (
    <div className="mk-app-bg flex h-screen overflow-hidden text-slate-950">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppTitlebar />
        <div className="flex min-h-0 min-w-0 flex-1 gap-3 p-3">
          <SidebarNav
            activePage={activePage}
            appStatus={appStatus}
            currentTemplate={currentTemplate}
            collapsed={sidebarCollapsed}
            navigation={navigation}
            themeMode={appConfig?.themeMode ?? "light"}
            onNavigate={handleNavigate}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onToggleThemeMode={appConfig ? () => void handleToggleThemeMode() : undefined}
            onThemeModeChange={appConfig ? (mode) => void handleSetThemeMode(mode) : undefined}
          />

          <main aria-label={pageMeta.title} className="mk-workspace-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px]">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-[1540px] flex-col overflow-y-auto overflow-x-hidden p-4">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
