import { useState, type ReactNode } from "react";
import { useAppStore } from "@/stores/app-store";
import { SidebarNav, type NavigationItem } from "./sidebar-nav";
import { AppTitlebar } from "./app-titlebar";
import type { PageMeta } from "./page-header";

type AppShellProps = {
  navigation: NavigationItem[];
  pageMeta: PageMeta;
  children: ReactNode;
};

export function AppShell({ navigation, pageMeta, children }: AppShellProps) {
  const { activePage, setActivePage, appStatus, templates, currentTemplateId, appConfig } = useAppStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentTemplate = templates.find((template) => template.id === currentTemplateId) ?? templates.find((template) => template.id === appConfig?.defaultTemplateId) ?? templates.find((template) => template.isDefault);

  function handleNavigate(page: string) {
    setActivePage(page);
  }

  return (
    <div className="mk-app-bg flex h-screen overflow-hidden p-3 text-slate-950">
      <div className="mk-app-window flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
        <AppTitlebar />
        <div className="flex min-h-0 min-w-0 flex-1 gap-4 px-4 pb-4">
          <SidebarNav
            activePage={activePage}
            appStatus={appStatus}
            currentTemplate={currentTemplate}
            collapsed={sidebarCollapsed}
            navigation={navigation}
            onNavigate={handleNavigate}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          />

          <main aria-label={pageMeta.title} className="mk-workspace-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px]">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-[1540px] flex-col overflow-y-auto overflow-x-hidden p-4">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
