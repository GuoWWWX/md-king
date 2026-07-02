import { HelpCircle, Library, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import type { AppStatus, Template } from "@/types";
import { PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  onNavigate: (page: string) => void;
  onToggleCollapsed?: () => void;
};

export function SidebarNav({
  navigation,
  activePage,
  currentTemplate,
  appStatus,
  collapsed = false,
  onNavigate,
  onToggleCollapsed,
}: SidebarNavProps) {
  return (
    <aside
      className={cn(
        "mk-sidebar-panel flex h-full shrink-0 flex-col overflow-hidden rounded-[16px] p-4 transition-[width,padding] duration-200 max-[980px]:w-[76px] max-[980px]:px-3",
        collapsed ? "w-[76px] px-3" : "w-[220px]",
      )}
    >
      <SidebarContent
        navigation={navigation}
        activePage={activePage}
        appStatus={appStatus}
        collapsed={collapsed}
        currentTemplate={currentTemplate}
        onNavigate={onNavigate}
        onToggleCollapsed={onToggleCollapsed}
      />
    </aside>
  );
}

function SidebarContent({ navigation, activePage, currentTemplate, appStatus, collapsed = false, onNavigate, onToggleCollapsed }: SidebarNavProps) {
  const textHiddenClass = collapsed ? "hidden" : "max-[980px]:hidden";
  const centeredWhenCollapsed = collapsed ? "justify-center px-0" : "justify-start gap-3 px-4 max-[980px]:justify-center max-[980px]:px-0";
  const navButtonLayout = collapsed ? "justify-center px-0" : "justify-start gap-3 px-3 max-[980px]:justify-center max-[980px]:px-0";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PrimaryActionButton className={cn("h-11 rounded-[12px] text-sm font-bold shadow-blue-500/25", centeredWhenCollapsed)} onClick={() => onNavigate("convert")} title="新建转换" aria-label="新建转换">
        <Plus className="size-4" />
        <span className={textHiddenClass}>新建转换</span>
      </PrimaryActionButton>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <div className="mt-6 rounded-[14px] bg-white/36 p-2 shadow-inner shadow-blue-100/50">
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <Button
                  key={item.id}
                  className={cn(
                    "h-11 w-full rounded-[12px] text-sm font-bold transition",
                    navButtonLayout,
                    isActive ? "mk-nav-active text-white" : "mk-nav-idle",
                  )}
                  variant="ghost"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="size-4" />
                  <span className={textHiddenClass}>{item.label}</span>
                </Button>
              );
            })}
          </nav>
        </div>

        <div className={cn("mt-5 space-y-1 rounded-[14px] bg-white/28 p-2", collapsed ? "hidden" : "max-[980px]:hidden")}>
          <p className="px-3 text-[11px] font-black uppercase tracking-[0.18em] text-blue-900/42">工作区</p>
          <Button className="h-10 w-full justify-start gap-3 rounded-[10px] px-3 text-slate-400" variant="ghost" disabled aria-label="控制台（规划中）">
            <Sparkles className="size-4" />
            控制台
            <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-500">规划中</span>
          </Button>
          <Button className="h-10 w-full justify-start gap-3 rounded-[10px] px-3 text-slate-400" variant="ghost" disabled aria-label="工作流（规划中）">
            <Library className="size-4" />
            工作流
            <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-500">规划中</span>
          </Button>
        </div>

        <div className={cn("mk-sidebar-promo mt-10 rounded-[14px] p-4", collapsed ? "hidden" : "max-[980px]:hidden")}>
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-[12px] bg-gradient-to-br from-blue-300 to-blue-600 text-white shadow-[0_18px_42px_rgba(37,99,235,0.35)]">
            <ShieldCheck className="size-7" />
          </div>
          <div className="text-sm font-black text-blue-950">AI Markdown</div>
          <p className="mt-1 text-xs leading-5 text-blue-900/68">一键转换专业 Word 文档</p>
          <div className="mt-3 text-xs font-bold text-blue-600">了解更多</div>
        </div>
      </div>

      <div className="shrink-0 space-y-4 border-t border-blue-100/50 pt-3">
        <Button
          variant="outline"
          className={cn("h-9 w-full rounded-[12px] border-white/70 bg-white/62 text-xs font-bold text-blue-900/70 hover:bg-white/82", collapsed && "px-0")}
          onClick={onToggleCollapsed}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className={textHiddenClass}>{collapsed ? "展开侧栏" : "收起侧栏"}</span>
        </Button>
        <div className="flex items-center justify-between px-2 text-xs text-slate-400 max-[980px]:justify-center">
          <span className={textHiddenClass}>{appStatus ? `${appStatus.name} v${appStatus.version}` : currentTemplate?.name ?? "md-king"}</span>
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-blue-600" />
            <Separator orientation="vertical" className={cn("h-4 bg-blue-200", collapsed ? "hidden" : "max-[980px]:hidden")} />
            <HelpCircle className="size-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
