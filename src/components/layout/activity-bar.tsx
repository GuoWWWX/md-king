import { History, Info, LayoutTemplate, Monitor, Moon, Settings, Sun, Sparkles, Download, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { handleTauriWindowDrag, handleTauriWindowDoubleClick } from "@/lib/tauri";
import { useUpdaterStore } from "@/stores/updater-store";
import type { ThemeMode } from "@/types";

export type ActivityBarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

/// 默认导航从原 App.tsx 搬来；允许外部覆盖，方便接线方决定页面集合。
export const defaultActivityNavigation: ActivityBarItem[] = [
  { id: "templates", label: "模板中心", icon: LayoutTemplate },
  { id: "history", label: "转换历史", icon: History },
  { id: "settings", label: "设置", icon: Settings },
  { id: "about", label: "关于", icon: Info },
];

const themeModes: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: "light", label: "浅色模式", icon: Sun },
  { mode: "dark", label: "深色模式", icon: Moon },
  { mode: "system", label: "跟随系统", icon: Monitor },
];

type ActivityBarProps = {
  activePage: string;
  navigation?: ActivityBarItem[];
  themeMode?: ThemeMode;
  onNavigate: (page: string) => void;
  onToggleThemeMode?: () => void;
};

export function ActivityBar({
  activePage,
  navigation = defaultActivityNavigation,
  themeMode = "light",
  onNavigate,
  onToggleThemeMode,
}: ActivityBarProps) {
  const activeTheme = themeModes.find((item) => item.mode === themeMode) ?? themeModes[0];
  const ThemeIcon = activeTheme.icon;
  const primaryNavigation = navigation.filter((item) => item.id !== "settings");

  const hasUpdate = useUpdaterStore((state) => state.hasUpdate);
  const status = useUpdaterStore((state) => state.status);
  const latestRelease = useUpdaterStore((state) => state.latestRelease);
  const downloadProgress = useUpdaterStore((state) => state.downloadProgress);
  const setDialogOpen = useUpdaterStore((state) => state.setDialogOpen);

  return (
    <aside
      data-collapsed="true"
      aria-label="主导航"
      className="mk-activity-bar flex h-full w-12 shrink-0 select-none flex-col items-center px-1 py-2"
      onPointerDown={handleTauriWindowDrag}
      onDoubleClick={handleTauriWindowDoubleClick}
    >
      <nav className="flex flex-col items-center gap-1.5" aria-label="页面导航">
        {primaryNavigation.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <Button
              key={item.id}
              variant="ghost"
              className={cn(
                "mk-nav-collapsed size-10 shrink-0 justify-center rounded-[8px] p-0 transition",
                isActive ? "mk-nav-active text-white" : "mk-nav-idle",
              )}
              title={item.label}
              tooltipSide="right"
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
      </nav>

      <div
        className="min-h-0 flex-1 w-full"
      />

      <div className="mk-activity-bar-footer flex w-full shrink-0 flex-col items-center gap-2 border-t border-slate-200/80 pt-2 dark:border-zinc-700">
        {hasUpdate && (
          <Button
            variant="ghost"
            className="relative size-10 shrink-0 justify-center rounded-[8px] p-0 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 hover:text-amber-700 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30 transition animate-in fade-in"
            onClick={() => setDialogOpen(true)}
            title={status === "downloading" ? `正在下载更新: ${downloadProgress.percent.toFixed(0)}%` : `发现新版本 ${latestRelease?.tag_name} (点击更新)`}
            tooltipSide="right"
            aria-label="软件更新"
          >
            {status === "downloading" ? (
              <Download className="size-4 animate-bounce" />
            ) : (
              <Sparkles className="size-4" />
            )}
            <span className="absolute top-1.5 right-1.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
            </span>
          </Button>
        )}

        <Button
          variant="outline"
          className="mk-theme-cycle-button mk-sidebar-icon-button size-9 shrink-0 justify-center rounded-[8px] px-0"
          onClick={onToggleThemeMode}
          title={activeTheme.label}
          tooltipSide="right"
          aria-label={`切换外观主题，当前：${activeTheme.label}`}
          disabled={!onToggleThemeMode}
        >
          <ThemeIcon className="size-4" />
        </Button>

        <Button
          variant="ghost"
          className={cn(
            "mk-nav-collapsed size-10 shrink-0 justify-center rounded-[8px] p-0 transition",
            activePage === "settings" ? "mk-nav-active text-white" : "mk-nav-idle",
          )}
          title="设置"
          tooltipSide="right"
          aria-label="设置"
          aria-current={activePage === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
