import { AlertCircle, CheckCircle2, Clock, Copy, ExternalLink, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AppSurface, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { openOutputPath } from "@/lib/tauri";
import type { HistoryItem, Template } from "@/types";

type HistoryRecordCardProps = {
  item: HistoryItem;
  templates?: Template[];
  compact?: boolean;
  selected?: boolean;
  onSelect?: (item: HistoryItem) => void;
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
    toast.error(error instanceof Error ? error.message : "复制失败");
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
    toast.error(error instanceof Error ? error.message : "打开文件失败");
  }
}

export function HistoryRecordCard({ item, templates = [], compact = false, selected = false, onSelect }: HistoryRecordCardProps) {
  const templateName = templates.find((template) => template.id === item.templateId)?.name ?? item.templateId ?? "未指定模板";
  const isSuccess = item.status === "success";
  const isFailed = item.status === "failed";
  const canOpenOutput = isSuccess && !item.simulated && Boolean(item.outputPath);

  return (
    <AppSurface
      as="article"
      variant="solid"
      radius="sm"
      className={selected ? "min-w-0 overflow-hidden ring-2 ring-blue-500/40" : "min-w-0 overflow-hidden"}
      interactive={Boolean(onSelect)}
      onClick={() => onSelect?.(item)}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2">
            {isSuccess ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : isFailed ? <AlertCircle className="size-4 shrink-0 text-red-600" /> : <Clock className="size-4 shrink-0 text-indigo-600" />}
            <h4 className="min-w-0 truncate text-sm font-semibold text-slate-950">{item.inputPath}</h4>
          </div>
          <p className="mt-1 min-w-0 truncate text-sm text-slate-500" title={item.outputPath ?? item.errorMessage ?? "等待输出"}>→ {item.outputPath ?? item.errorMessage ?? "等待输出"}</p>
        </div>
        <Badge className={item.simulated ? "shrink-0 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50" : isSuccess ? "shrink-0 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : isFailed ? "shrink-0 rounded-full bg-red-50 text-red-700 hover:bg-red-50" : "shrink-0 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-50"}>
          {item.simulated ? "预览" : isSuccess ? "成功" : isFailed ? "失败" : "处理中"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{templateName}</span>
        <span className="rounded-full bg-white/70 px-2.5 py-1">{new Date(item.createdAt).toLocaleString()}</span>
        {item.durationMs !== undefined ? <span className="rounded-full bg-white/70 px-2.5 py-1">{item.durationMs} ms</span> : null}
      </div>

      {isFailed && item.errorMessage ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{item.errorMessage}</p> : null}

      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <SoftActionButton size="sm" className="rounded-lg" onClick={() => copyText(item.outputPath, "输出路径已复制")}>
            <Copy className="size-4" />
            复制路径
          </SoftActionButton>
          <SoftActionButton size="sm" className="rounded-lg" onClick={() => openFile(item.outputPath)} disabled={!canOpenOutput} title={item.simulated ? "浏览器预览没有实际 DOCX 文件" : undefined}>
            <ExternalLink className="size-4" />
            打开文件
          </SoftActionButton>
          <Button size="sm" variant="ghost" disabled title="批量队列接入后启用">
            <RefreshCcw className="size-4" />
            重新转换
          </Button>
        </div>
      ) : null}
    </AppSurface>
  );
}
