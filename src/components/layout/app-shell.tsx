import { useEffect, useState, type ReactNode } from "react";
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
import { useDocumentTabsStore } from "@/stores/document-tabs-store";
import type { ThemeMode } from "@/types";
import type { VaultSearchMatch } from "@/types/vault";
import { GlobalSearchDialog } from "@/components/search/global-search-dialog";
import { markdownOutlineRevealEvent } from "@/lib/document-outline";
import { clampPageZoomPercent, PAGE_ZOOM_DEFAULT_PERCENT, pageZoomViewportPercent } from "@/lib/page-zoom";

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
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const setFileTreeVisible = useVaultStore((state) => state.setFileTreeVisible);
  const setFileTreeWidth = useVaultStore((state) => state.setFileTreeWidth);
  const openVaultFile = useOpenVaultFile();
  const openImageTab = useDocumentTabsStore((state) => state.openImageTab);
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [documentDrawerView, setDocumentDrawerView] = useState<DocumentDrawerView>("outline");
  const [documentDrawerWidth, setDocumentDrawerWidth] = useState(340);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const pageZoomPercent = clampPageZoomPercent(appConfig?.pageZoomPercent ?? PAGE_ZOOM_DEFAULT_PERCENT);
  const viewportPercent = pageZoomViewportPercent(pageZoomPercent);

  useEffect(() => {
    const openGlobalSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      event.stopPropagation();
      setGlobalSearchOpen(true);
    };
    window.addEventListener("keydown", openGlobalSearch, true);
    return () => window.removeEventListener("keydown", openGlobalSearch, true);
  }, []);

  // 页面标签和 Markdown 文档共用同一个工作台，文件树始终保持原位置。
  const showFileTree = fileTreeVisible;
  const showFileTreeResizeEdge = true;

  function handleNavigate(page: string) {
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

  async function handlePageZoomChange(value: number) {
    if (!appConfig) return;
    const nextPercent = clampPageZoomPercent(value);
    if (nextPercent === pageZoomPercent) return;
    const previousConfig = appConfig;
    const nextConfig = { ...appConfig, pageZoomPercent: nextPercent };
    setAppConfig(nextConfig);
    try {
      const savedConfig = await saveAppConfig(nextConfig);
      setAppConfig(savedConfig);
    } catch (error) {
      setAppConfig(previousConfig);
      toast.error(userFacingErrorMessage(error, "保存页面缩放失败"));
    }
  }

  async function handleGlobalSearchSelect(result: VaultSearchMatch) {
    setGlobalSearchOpen(false);
    setActivePage("convert");
    const tabId = await openVaultFile(result.path);
    if (!tabId) return;

    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(markdownOutlineRevealEvent, {
        detail: {
          tabId,
          line: result.line ?? 1,
          matchStart: result.kind === "content" ? result.matchStart ?? undefined : undefined,
          matchEnd: result.kind === "content" ? result.matchEnd ?? undefined : undefined,
        },
      }));
    });
  }

  return (
    <div className="mk-app-bg h-screen w-screen overflow-hidden">
      <div
        className="flex overflow-hidden text-slate-950"
        style={{
          zoom: `${pageZoomPercent}%`,
          width: `${viewportPercent}vw`,
          height: `${viewportPercent}vh`,
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppTitlebar
          fileTreeVisible={fileTreeVisible}
          onToggleFileTree={() => setFileTreeVisible(!fileTreeVisible)}
          showDocumentDrawerControl
          documentDrawerOpen={documentDrawerOpen}
          onToggleDocumentDrawer={() => setDocumentDrawerOpen((open) => !open)}
          onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
          pageZoomPercent={pageZoomPercent}
          onPageZoomChange={handlePageZoomChange}
          documentTabsOffset={fileTreeVisible ? Math.max(0, fileTreeWidth - 126) : 0}
        />
        <GlobalSearchDialog
          open={globalSearchOpen}
          root={vaultRoot}
          onOpenChange={setGlobalSearchOpen}
          onSelect={handleGlobalSearchSelect}
        />
        <div className="flex min-h-0 min-w-0 flex-1 gap-1 p-1">
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
                  onOpenFile={(entry) => {
                    setActivePage("convert");
                    void openVaultFile(entry.path);
                  }}
                  onOpenImage={(entry) => {
                    const root = useVaultStore.getState().vaultRoot;
                    if (!root) return;
                    setActivePage("convert");
                    openImageTab({
                      path: entry.path,
                      absolutePath: `${root.replace(/[\\/]+$/, "")}/${entry.path}`,
                      title: entry.name,
                    });
                  }}
                />
              ) : null}
              <ResizableDivider
                orientation="vertical"
                size={fileTreeWidth}
                min={FILE_TREE_WIDTH_RANGE.min}
                max={FILE_TREE_WIDTH_RANGE.max}
                onResize={setFileTreeWidth}
                collapsed={!showFileTree}
                // onCollapsedChange 传的是「是否已收起」，和 visible 语义相反，必须取反。
                onCollapsedChange={(collapsed) => setFileTreeVisible(!collapsed)}
                ariaLabel="调整文件树宽度"
                // 容器本身零宽，但仍会占掉一份 flex gap。抵消一份 4px 间距，
                // 让文件树右侧与图标栏、上下外边距保持一致。
                className="-ml-1"
              />
            </>
          ) : null}

          <main
            aria-label={pageMeta.title}
            className="flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
              {children}
            </div>
          </main>
          <>
            <ResizableDivider
              orientation="vertical"
              size={documentDrawerWidth}
              min={160}
              max={520}
              from="end"
              onResize={setDocumentDrawerWidth}
              collapsed={!documentDrawerOpen}
              allowCollapsedDrag={false}
              // 同上：collapsed=true 表示刚收起，对应 open=false。
              onCollapsedChange={(collapsed) => setDocumentDrawerOpen(!collapsed)}
              ariaLabel={documentDrawerOpen ? "调整文档侧栏宽度" : "拖动展开文档侧栏"}
              className={previewVisible ? "-ml-[5px]" : "-ml-[10px]"}
            />
            {documentDrawerOpen ? (
              <DocumentSideDrawer
                open
                width={documentDrawerWidth}
                view={documentDrawerView}
                onViewChange={handleDocumentDrawerViewChange}
              />
            ) : null}
          </>
        </div>
        </div>
      </div>
    </div>
  );
}
