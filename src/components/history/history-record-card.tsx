import { AlertCircle, CheckCircle2, CheckSquare, Clock, Copy, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AppSurface, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { clipboardWriteErrorMessage } from "@/lib/clipboard-errors";
import { openOutputPath } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import type { HistoryItem, Template } from "@/types";

type HistoryRecordCardProps = {
  item: HistoryItem;
  templates?: Template[];
  compact?: boolean;
  selected?: boolean;
  checked?: boolean;
  onSelect?: (item: HistoryItem) => void;
  onToggleChecked?: (item: HistoryItem) => void;
  onDelete?: (item: HistoryItem) => void;
};

async function copyText(text?: string, message = "已复制") {
  if (!text) {
    toast.info("暂无可复制内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch (error) {
    toast.error(clipboardWriteErrorMessage(error));
  }
}

async function openFile(path?: string) {
  if (!path) {
    toast.info("暂无可打开文件");
    return;
  }

  try {
    await openOutputPath(path);
    toast.success("已请求系统打开文件");
  } catch (error) {
    toast.error(userFacingErrorMessage(error, "打开文件失败"));
  }
}

export function HistoryRecordCard({ item, templates = [], compact = false, selected = false, checked = false, onSelect, onToggleChecked, onDelete }: HistoryRecordCardProps) {
  const templateName = templates.find((template) => template.id === item.templateId)?.name ?? item.templateId ?? "未指定模板";
  const isSuccess = item.status === "success";
  const isFailed = item.status === "failed";
  const canOpenOutput = isSuccess && !item.simulated && Boolean(item.outputPath);

  return (
    <AppSurface
      as="article"
      variant="solid"
      radius="sm"
      className={cn("min-w-0 overflow-hidden", selected && "ring-2 ring-blue-500/40", checked && "bg-white/88 dark:bg-zinc-900/88")}
      interactive={Boolean(onSelect)}
      onClick={() => onSelect?.(item)}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        {onToggleChecked ? (
          <button
            type="button"
            className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-lg border text-white", checked ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500" : "border-blue-200 bg-white/70 dark:border-zinc-600 dark:bg-zinc-900/70")}
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked(item);
            }}
            aria-label={`选择 ${item.inputPath}`}
            aria-pressed={checked}
          >
            {checked ? <CheckSquare className="size-4" /> : null}
          </button>
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2">
            {isSuccess ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : isFailed ? <AlertCircle className="size-4 shrink-0 text-red-600" /> : <Clock className="size-4 shrink-0 text-indigo-600" />}
            <h4 className="min-w-0 truncate text-sm font-semibold text-slate-950 dark:text-zinc-50">{item.inputPath}</h4>
          </div>
          <p className="mt-1 min-w-0 truncate text-sm text-slate-500 dark:text-zinc-400" title={item.outputPath ?? item.errorMessage ?? "等待输出"}>→ {item.outputPath ?? item.errorMessage ?? "等待输出"}</p>
        </div>
        <Badge className={item.simulated ? "shrink-0 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-500/16 dark:text-amber-200 dark:hover:bg-amber-500/16" : isSuccess ? "shrink-0 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/16 dark:text-emerald-200 dark:hover:bg-emerald-500/16" : isFailed ? "shrink-0 rounded-full bg-red-50 text-red-700 hover:bg-red-50 dark:bg-red-500/16 dark:text-red-200 dark:hover:bg-red-500/16" : "shrink-0 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-50 dark:bg-indigo-500/16 dark:text-indigo-200 dark:hover:bg-indigo-500/16"}>
          {item.simulated ? "预览" : isSuccess ? "成功" : isFailed ? "失败" : "处理中"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-zinc-400">
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-500/16 dark:text-blue-200">{templateName}</span>
        <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-zinc-800/70">{new Date(item.createdAt).toLocaleString()}</span>
        {item.durationMs !== undefined ? <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-zinc-800/70">{item.durationMs} ms</span> : null}
      </div>

      {isFailed && item.errorMessage ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/12 dark:text-red-200">{item.errorMessage}</p> : null}

      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <SoftActionButton size="sm" className="rounded-lg" onClick={(event) => { event.stopPropagation(); void copyText(item.outputPath, "输出路径已复制"); }}>
            <Copy className="size-4" />
            复制路径
          </SoftActionButton>
          <SoftActionButton size="sm" className="rounded-lg" onClick={(event) => { event.stopPropagation(); void openFile(item.outputPath); }} disabled={!canOpenOutput} title={item.simulated ? "浏览器预览没有实际 DOCX 文件" : undefined}>
            <ExternalLink className="size-4" />
            打开文件
          </SoftActionButton>
          {onDelete ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/12 dark:hover:text-red-200"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(item);
              }}
              title="删除记录"
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : null}
        </div>
      ) : null}
    </AppSurface>
  );
}
