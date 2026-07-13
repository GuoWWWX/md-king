import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import type { AppStatus, Template, ThemeMode } from "@/types";
import { PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { TooltipAnchor, TooltipButton } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type NavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type SidebarNavProps = {
  navigation: NavigationItem[];
  activePage: string;
  currentTemplate?: Template;
  appStatus?: AppStatus;
  collapsed?: boolean;
  themeMode?: ThemeMode;
  onNavigate: (page: string) => void;
  onToggleCollapsed?: () => void;
  onToggleThemeMode?: () => void;
  onThemeModeChange?: (mode: ThemeMode) => void;
};

export function SidebarNav({
  navigation,
  activePage,
  currentTemplate,
  appStatus,
  collapsed = false,
  themeMode,
  onNavigate,
  onToggleCollapsed,
  onToggleThemeMode,
  onThemeModeChange,
}: SidebarNavProps) {
  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "mk-sidebar-panel flex h-full shrink-0 flex-col overflow-hidden rounded-[8px] p-3 transition-[width,padding] duration-200 max-[980px]:w-[72px] max-[980px]:px-2.5",
        collapsed ? "w-[72px] px-2.5" : "w-[212px]",
      )}
    >
      <SidebarContent
        navigation={navigation}
        activePage={activePage}
        appStatus={appStatus}
        collapsed={collapsed}
        currentTemplate={currentTemplate}
        themeMode={themeMode}
        onNavigate={onNavigate}
        onToggleCollapsed={onToggleCollapsed}
        onToggleThemeMode={onToggleThemeMode}
        onThemeModeChange={onThemeModeChange}
      />
    </aside>
  );
}

function SidebarContent({ navigation, activePage, currentTemplate, appStatus, collapsed = false, themeMode, onNavigate, onToggleCollapsed, onToggleThemeMode, onThemeModeChange }: SidebarNavProps) {
  const sidebarLabelClass = cn("mk-sidebar-label min-w-0 truncate whitespace-nowrap", collapsed && "hidden");
  const centeredWhenCollapsed = collapsed ? "mx-auto size-10 justify-center rounded-[8px] px-0" : "justify-start gap-2.5 px-3 max-[980px]:mx-auto max-[980px]:size-10 max-[980px]:justify-center max-[980px]:rounded-[8px] max-[980px]:px-0";
  const navRailLayout = collapsed
    ? "mx-auto mt-4 flex w-10 flex-col items-center gap-1.5 p-0.5"
    : "mt-5 p-0.5 max-[980px]:mx-auto max-[980px]:mt-4 max-[980px]:flex max-[980px]:w-10 max-[980px]:flex-col max-[980px]:items-center max-[980px]:gap-1.5";
  const navButtonBase = collapsed ? "mk-nav-collapsed size-10 rounded-[8px] p-0" : "h-10 w-full rounded-[8px] max-[980px]:size-10 max-[980px]:rounded-[8px] max-[980px]:p-0";
  const navButtonLayout = collapsed ? "justify-center" : "justify-start gap-2.5 px-3 max-[980px]:justify-center max-[980px]:px-0";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PrimaryActionButton className={cn("h-10 overflow-hidden text-sm font-bold whitespace-nowrap", centeredWhenCollapsed)} onClick={() => onNavigate("convert")} title="新建转换" tooltipSide="right" aria-label="新建转换">
        <Plus className="size-4" />
        <span className={sidebarLabelClass}>新建转换</span>
      </PrimaryActionButton>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <div className={navRailLayout}>
          <nav className={collapsed ? "flex flex-col items-center gap-2" : "space-y-1"}>
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <Button
                  key={item.id}
                  className={cn(
                    "mk-nav-auto-collapsed overflow-hidden text-sm font-bold whitespace-nowrap transition",
                    navButtonBase,
                    navButtonLayout,
                    isActive ? "mk-nav-active text-white" : "mk-nav-idle",
                  )}
                  variant="ghost"
                  title={item.label}
                  tooltipSide="right"
                  aria-label={item.label}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="size-4" />
                  <span className={sidebarLabelClass}>{item.label}</span>
                </Button>
              );
            })}
          </nav>
        </div>

      </div>

      <div className={cn("mk-sidebar-footer shrink-0 space-y-3 border-t border-slate-200/80 pt-3 dark:border-zinc-700", collapsed && "items-center")}>
        <ThemeModeButton collapsed={collapsed} themeMode={themeMode} onToggleThemeMode={onToggleThemeMode} onThemeModeChange={onThemeModeChange} />
        <Button
          variant="outline"
          className={cn(
            "mk-sidebar-icon-button h-9 justify-center overflow-hidden rounded-[8px] border-slate-200 bg-slate-50 text-xs font-bold whitespace-nowrap text-slate-600 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
            collapsed ? "mx-auto w-9 px-0" : "w-full gap-2 px-2 max-[980px]:mx-auto max-[980px]:w-9 max-[980px]:px-0",
          )}
          onClick={onToggleCollapsed}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          tooltipSide="right"
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className={sidebarLabelClass}>{collapsed ? "展开侧栏" : "收起侧栏"}</span>
        </Button>
        <div className={cn("flex items-center overflow-hidden text-xs text-slate-400", collapsed ? "justify-center px-0" : "justify-between px-2 max-[980px]:justify-center")}>
          <span className={sidebarLabelClass}>{appStatus ? `${appStatus.name} v${appStatus.version}` : currentTemplate?.name ?? "md-king"}</span>
          <TooltipAnchor content="本地运行" tooltipSide="right">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-blue-600" />
              <span className={cn("text-[11px] font-semibold text-slate-400", sidebarLabelClass)}>本地</span>
            </div>
          </TooltipAnchor>
        </div>
      </div>
    </div>
  );
}

function ThemeModeButton({
  collapsed,
  themeMode = "light",
  onToggleThemeMode,
  onThemeModeChange,
}: {
  collapsed?: boolean;
  themeMode?: ThemeMode;
  onToggleThemeMode?: () => void;
  onThemeModeChange?: (mode: ThemeMode) => void;
}) {
  const modes: Array<{ mode: ThemeMode; label: string; shortLabel: string; icon: LucideIcon }> = [
    { mode: "light", label: "浅色模式", shortLabel: "浅色", icon: Sun },
    { mode: "dark", label: "深色模式", shortLabel: "深色", icon: Moon },
    { mode: "system", label: "跟随系统", shortLabel: "系统", icon: Monitor },
  ];
  const activeIndex = Math.max(0, modes.findIndex((item) => item.mode === themeMode));
  const activeMode = modes[activeIndex] ?? modes[0];
  const ActiveIcon = activeMode.icon;

  if (collapsed) {
    return (
      <Button
        variant="outline"
        className="mk-theme-cycle-button mk-sidebar-icon-button mx-auto h-9 w-9 justify-center rounded-[8px] px-0"
        onClick={onToggleThemeMode}
        title={activeMode.label}
        tooltipSide="right"
        aria-label={`切换外观主题，当前：${activeMode.label}`}
        disabled={!onToggleThemeMode}
      >
        <ActiveIcon className="size-4" />
      </Button>
    );
  }

  return (
    <>
      <div
        className={cn("mk-theme-cycle-button flex h-9 w-full items-center justify-center rounded-[8px] px-3 text-sm font-bold max-[980px]:hidden", !onThemeModeChange && "pointer-events-none opacity-50")}
        role="group"
        aria-label={`外观主题，当前：${activeMode.label}`}
      >
        <span className="mk-theme-cycle-track">
          <span className="mk-theme-cycle-thumb" style={{ transform: `translateX(${activeIndex * 28}px)` }} />
          {modes.map(({ mode, icon: Icon, label }) => (
            <TooltipButton
              key={mode}
              type="button"
              className={cn("mk-theme-cycle-icon", themeMode === mode && "is-active")}
              tooltip={label}
              aria-label={label}
              aria-pressed={themeMode === mode}
              onClick={() => onThemeModeChange?.(mode)}
            >
              <Icon className="size-4" />
            </TooltipButton>
          ))}
        </span>
      </div>
      <Button
        variant="outline"
        className="mk-theme-cycle-button mk-sidebar-icon-button mx-auto hidden h-9 w-9 justify-center rounded-[8px] px-0 max-[980px]:inline-flex"
        onClick={onToggleThemeMode}
        title={activeMode.label}
        tooltipSide="right"
        aria-label={`切换外观主题，当前：${activeMode.label}`}
        disabled={!onToggleThemeMode}
      >
        <ActiveIcon className="size-4" />
      </Button>
    </>
  );
}
