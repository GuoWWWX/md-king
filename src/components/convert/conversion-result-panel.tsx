import { AlertCircle, CheckCircle2, ChevronDown, Clock, Copy, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AppSurface } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConvertResult } from "@/types";

type ConversionResultPanelProps = {
  result: ConvertResult | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

async function copyText(text?: string) {
  if (!text) {
    toast.info("暂无可复制内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "复制失败");
  }
}

export function ConversionResultPanel({ result, collapsed = false, onToggleCollapsed }: ConversionResultPanelProps) {
  return (
    <AppSurface as="section" className={cn("flex min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden", collapsed && "min-h-[58px]")}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold text-slate-950">转换结果</h3>
        <div className="flex shrink-0 items-center gap-2">
          {result ? (
            <Badge className={result.ok && !result.simulated ? "rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : result.simulated ? "rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50" : "rounded-full bg-red-50 text-red-700 hover:bg-red-50"}>
              {result.ok && !result.simulated ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
              {result.ok && !result.simulated ? "成功" : result.simulated ? "浏览器预览" : "失败"}
            </Badge>
          ) : (
            <Badge variant="secondary" className="rounded-full text-xs">等待转换</Badge>
          )}
          {onToggleCollapsed ? (
            <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-full" onClick={onToggleCollapsed} aria-label={collapsed ? "展开转换结果" : "收起转换结果"} title={collapsed ? "展开" : "收起"}>
              <ChevronDown className={cn("size-4 transition-transform", !collapsed && "rotate-180")} />
            </Button>
          ) : null}
        </div>
      </div>

      {collapsed ? null : result ? (
        <div className="mt-3 min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Metric label="消息" value={result.message ?? "无返回消息"} />
            <Metric label="耗时" value={`${result.durationMs} ms`} />
            <Metric label="模板" value={result.templateId ?? "未指定"} />
            <Metric label="输出" value={result.output ?? "未返回输出路径"} />
          </div>

          {result.errorCode ? (
            <div className="min-w-0 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <AlertCircle className="size-4 shrink-0" />
                <span className="min-w-0 break-all">错误码：{result.errorCode}</span>
              </div>
              <p className="mt-2 line-clamp-3 break-all text-red-700/80">{result.message}</p>
              <Button className="mt-2 h-7 text-xs" size="sm" variant="outline" onClick={() => copyText(`${result.errorCode}: ${result.message}`)}>
                <Copy className="size-3.5" />
                复制错误
              </Button>
            </div>
          ) : null}

          {result.warnings.length > 0 ? (
            <div className="min-w-0 overflow-hidden rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <FileWarning className="size-4 shrink-0" />
                <span>转换警告</span>
              </div>
              <ul className="mt-2 min-w-0 list-disc space-y-1 pl-5">
                {result.warnings.slice(0, 3).map((warning) => (
                  <li className="min-w-0 break-all leading-5" key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-white/70 bg-white/60 p-4 text-xs leading-5 text-slate-500">
          <Clock className="mt-0.5 size-4 shrink-0" />
          粘贴或导入 Markdown 后点击开始转换，这里会展示 DOCX 生成结果。
        </div>
      )}
    </AppSurface>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-white/70 bg-white/60 px-3 py-2 shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 min-w-0 truncate text-xs font-medium text-slate-900" title={value}>{value}</p>
    </div>
  );
}
