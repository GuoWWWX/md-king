import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/stores/app-store";
import { useVaultStore } from "@/stores/vault-store";
import { ActivityBar } from "./activity-bar";
import { ResizableDivider } from "./resizable-divider";
import { FileTreePanel } from "@/components/vault/file-tree-panel";
import { DocumentSideDrawer, type DocumentDrawerView } from "@/components/editor/document-side-drawer";
import { AppTitlebar } from "./app-titlebar";
import type { NavigationItem } from "./sidebar-nav";
import type { PageMeta } from "./page-header";
import { applyAppearance } from "@/lib/appearance";
import { saveAppConfig } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { useOpenVaultFile } from "@/hooks/use-open-vault-file";
import { FILE_TREE_WIDTH_RANGE } from "@/stores/vault-store";
import type { ThemeMode } from "@/types";

type AppShellProps = {
  navigation: NavigationItem[];
  pageMeta: PageMeta;
  children: ReactNode;
};

export function AppShell({ navigation, pageMeta, children }: AppShellProps) {
  const { activePage, setActivePage, appConfig, setAppConfig } = useAppStore();
  const fileTreeVisible = useVaultStore((state) => state.fileTreeVisible);
  const fileTreeWidth = useVaultStore((state) => state.fileTreeWidth);
  const previewVisible = useVaultStore((state) => state.previewVisible);
  const setFileTreeVisible = useVaultStore((state) => state.setFileTreeVisible);
  const setFileTreeWidth = useVaultStore((state) => state.setFileTreeWidth);
  const openVaultFile = useOpenVaultFile();
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [documentDrawerView, setDocumentDrawerView] = useState<DocumentDrawerView>("outline");

  // 文件树只服务转换页：模板中心/历史/设置/关于跟 vault 无关，
  // 在那些页面留一条空侧栏既是噪音，也白占两百多像素。
  const showFileTree = activePage === "convert" && fileTreeVisible;
  const showFileTreeResizeEdge = activePage === "convert";

  function handleNavigate(page: string) {
    // 文件树是转换工作台的一部分，进入转换页就直接恢复，避免左侧再放一个重复开关。
    if (page === "convert") setFileTreeVisible(true);
    else setDocumentDrawerOpen(false);
    setActivePage(page);
  }

  function handleDocumentDrawerViewChange(view: DocumentDrawerView) {
    if (documentDrawerOpen && documentDrawerView === view) {
      setDocumentDrawerOpen(false);
      return;
    }
    setDocumentDrawerView(view);
    setDocumentDrawerOpen(true);
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
        <AppTitlebar
          fileTreeVisible={fileTreeVisible}
          onToggleFileTree={activePage === "convert" ? () => setFileTreeVisible(!fileTreeVisible) : undefined}
          showDocumentDrawerControl={activePage === "convert"}
          documentDrawerOpen={documentDrawerOpen}
          onToggleDocumentDrawer={() => setDocumentDrawerOpen((open) => !open)}
          documentTabsOffset={fileTreeVisible ? Math.max(0, fileTreeWidth - 110) : 0}
        />
        <div className="flex min-h-0 min-w-0 flex-1 gap-[5px] p-[5px]">
          <ActivityBar
            activePage={activePage}
            navigation={navigation}
            themeMode={appConfig?.themeMode ?? "light"}
            onNavigate={handleNavigate}
            onToggleThemeMode={appConfig ? () => void handleToggleThemeMode() : undefined}
          />

          {showFileTreeResizeEdge ? (
            <>
              {showFileTree ? (
                <FileTreePanel
                  width={fileTreeWidth}
                  onOpenFile={(entry) => void openVaultFile(entry.path)}
                />
              ) : null}
              <ResizableDivider
                orientation="vertical"
                size={fileTreeWidth}
                min={FILE_TREE_WIDTH_RANGE.min}
                max={FILE_TREE_WIDTH_RANGE.max}
                onResize={setFileTreeWidth}
                collapsed={!showFileTree}
                onCollapsedChange={setFileTreeVisible}
                ariaLabel="调整文件树宽度"
                // 容器本身零宽，但仍会占掉一份 flex gap。负 margin 抵消掉，
                // 让这道缝和图标栏那边一样宽。
                className="-ml-[5px]"
              />
            </>
          ) : null}

          <main
            aria-label={pageMeta.title}
            className={`flex min-w-0 flex-1 flex-col overflow-hidden ${activePage === "convert" ? "" : "mk-workspace-panel rounded-[8px]"}`}
          >
            {/* 转换页要铺满：三栏布局下再套一层最大宽度会在宽屏上留出诡异的空白。 */}
            <div className={activePage === "convert"
              ? "flex h-full min-h-0 w-full flex-col overflow-hidden"
              : "mx-auto flex h-full min-h-0 w-full max-w-[1540px] flex-col overflow-y-auto overflow-x-hidden p-[5px]"}>
              {children}
            </div>
          </main>
          {activePage === "convert" ? <DocumentSideDrawer open={documentDrawerOpen} onOpenChange={setDocumentDrawerOpen} view={documentDrawerView} onViewChange={handleDocumentDrawerViewChange} className={!previewVisible ? "-ml-[5px]" : undefined} /> : null}
        </div>
      </div>
    </div>
  );
}
