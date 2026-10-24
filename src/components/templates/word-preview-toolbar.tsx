import { t } from "@/lib/i18n";
import { Maximize2, Minimize2, Moon, Settings2, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { TooltipButton } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PreviewPaperTheme = "light" | "dark";

type WordPreviewToolbarProps = {
  zoom: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  paperTheme?: PreviewPaperTheme;
  onTogglePaperTheme?: () => void;
  onOpenAdvancedStyle?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  className?: string;
};

export function WordPreviewToolbar({
  zoom,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  paperTheme,
  onTogglePaperTheme,
  onOpenAdvancedStyle,
  expanded = false,
  onToggleExpanded,
  className,
}: WordPreviewToolbarProps) {
  const hasLeadingActions = Boolean(onOpenAdvancedStyle || (paperTheme && onTogglePaperTheme));

  return (
    <div className={cn("flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-none", className)}>
      {onOpenAdvancedStyle ? (
        <TooltipButton variant="ghost" size="icon" className="size-7 rounded-full" onClick={onOpenAdvancedStyle} tooltip={t("高级样式")} aria-label={t("高级样式")}>
          <Settings2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
        </TooltipButton>
      ) : null}
      {paperTheme && onTogglePaperTheme ? (
        <TooltipButton
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={onTogglePaperTheme}
          tooltip={paperTheme === "dark" ? t("切换为浅色纸张") : t("切换为深色纸张")}
          aria-label={paperTheme === "dark" ? t("切换为浅色纸张") : t("切换为深色纸张")}
        >
          {paperTheme === "dark"
            ? <Sun className="size-3.5 text-slate-500 dark:text-zinc-400" />
            : <Moon className="size-3.5 text-slate-500 dark:text-zinc-400" />}
        </TooltipButton>
      ) : null}
      {hasLeadingActions ? <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" /> : null}
      <TooltipButton variant="ghost" size="icon" className="size-7 rounded-full" onClick={onZoomOut} disabled={!canZoomOut} tooltip={t("缩小预览")} aria-label={t("缩小预览")}>
        <ZoomOut className="size-3.5 text-slate-500 dark:text-zinc-400" />
      </TooltipButton>
      <span className="w-10 text-center text-xs font-bold text-slate-500 dark:text-zinc-400">{zoom}%</span>
      <TooltipButton variant="ghost" size="icon" className="size-7 rounded-full" onClick={onZoomIn} disabled={!canZoomIn} tooltip={t("放大预览")} aria-label={t("放大预览")}>
        <ZoomIn className="size-3.5 text-slate-500 dark:text-zinc-400" />
      </TooltipButton>
      {onToggleExpanded ? (
        <TooltipButton variant="ghost" size="icon" className="size-7 rounded-full" onClick={onToggleExpanded} tooltip={expanded ? t("缩小还原") : t("放大查看")} aria-label={expanded ? t("缩小还原") : t("放大查看")}>
          {expanded
            ? <Minimize2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
            : <Maximize2 className="size-3.5 text-slate-500 dark:text-zinc-400" />}
        </TooltipButton>
      ) : null}
    </div>
  );
}
