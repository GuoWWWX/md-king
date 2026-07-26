import { FileText, History, Info, LayoutTemplate, Monitor, Moon, PanelLeftOpen, Settings, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipAnchor } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/types";

export type ActivityBarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

/// 默认导航从原 App.tsx 搬来；允许外部覆盖，方便接线方决定页面集合。
export const defaultActivityNavigation: ActivityBarItem[] = [
  { id: "convert", label: "转换", icon: FileText },
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
  fileTreeVisible?: boolean;
  onShowFileTree?: () => void;
};

export function ActivityBar({
  activePage,
  navigation = defaultActivityNavigation,
  themeMode = "light",
  onNavigate,
  onToggleThemeMode,
  fileTreeVisible = true,
  onShowFileTree,
}: ActivityBarProps) {
  const activeTheme = themeModes.find((item) => item.mode === themeMode) ?? themeModes[0];
  const ThemeIcon = activeTheme.icon;
  // 折叠交互单一职责：只有转换页在用文件树，其他页面出现「展开」按钮纯属噪音。
  const showExpandFileTree = !fileTreeVisible && activePage === "convert" && Boolean(onShowFileTree);

  return (
    <aside
      data-collapsed="true"
      aria-label="主导航"
      className="mk-activity-bar mk-sidebar-panel flex h-full w-12 shrink-0 flex-col items-center overflow-hidden rounded-[8px] px-1 py-2"
    >
      <nav className="flex flex-col items-center gap-1.5" aria-label="页面导航">
        {navigation.map((item) => {
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

      <div className="min-h-0 flex-1" />

      <div className="mk-activity-bar-footer flex w-full shrink-0 flex-col items-center gap-2 border-t border-slate-200/80 pt-2 dark:border-zinc-700">
        {showExpandFileTree ? (
          <Button
            variant="outline"
            className="mk-sidebar-icon-button size-9 shrink-0 justify-center rounded-[8px] px-0"
            onClick={onShowFileTree}
            title="展开文件树"
            tooltipSide="right"
            aria-label="展开文件树"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}

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

        <TooltipAnchor content="本地运行，数据不出本机" tooltipSide="right">
          <div className="flex size-9 shrink-0 items-center justify-center" aria-label="本地运行">
            <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />
          </div>
        </TooltipAnchor>
      </div>
    </aside>
  );
}
