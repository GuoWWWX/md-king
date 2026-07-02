import { CheckCircle2, Clock, Copy, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HistoryItem } from "@/types";

type TaskListProps = {
  items: HistoryItem[];
  onClear?: () => void;
};

const statusMeta = {
  pending: { label: "等待中", icon: Clock, variant: "secondary" as const },
  running: { label: "转换中", icon: Clock, variant: "secondary" as const },
  success: { label: "成功", icon: CheckCircle2, variant: "default" as const },
  failed: { label: "失败", icon: XCircle, variant: "destructive" as const },
};

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (error) {
    toast.error(error instanceof Error ? `复制失败：${error.message}` : "复制失败，请手动复制内容");
  }
}

function buildErrorDetail(item: HistoryItem) {
  return [`输入：${item.inputPath}`, item.errorCode ? `错误码：${item.errorCode}` : undefined, `错误详情：${item.errorMessage ?? "未返回错误详情"}`]
    .filter(Boolean)
    .join("\n");
}

export function TaskList({ items, onClear }: TaskListProps) {
  return (
    <Card className="bg-card/80">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="text-base">最近任务</CardTitle>
        {onClear ? (
          <Button size="sm" variant="outline" onClick={onClear} disabled={items.length === 0}>
            <Trash2 className="size-4" />
            清空历史
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            暂无转换历史。完成第一份 Markdown 转换后会显示在这里。
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const meta = statusMeta[item.status];
              const Icon = meta.icon;
              const canCopyOutput = Boolean(item.outputPath);
              const canCopyError = Boolean(item.errorMessage || item.errorCode);

              return (
                <div key={item.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background/70 p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{item.inputPath}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.outputPath ?? item.errorMessage ?? (item.status === "success" ? "已完成，未返回输出文件" : "等待输出")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge className="w-fit shrink-0" variant={meta.variant}>
                      <Icon className="size-3.5" />
                      {meta.label}
                    </Badge>
                    {canCopyOutput ? (
                      <Button size="sm" variant="outline" onClick={() => copyText(item.outputPath!, "输出路径已复制到剪贴板")}>
                        <Copy className="size-4" />
                        复制输出路径
                      </Button>
                    ) : null}
                    {canCopyError ? (
                      <Button size="sm" variant="outline" onClick={() => copyText(buildErrorDetail(item), "错误详情已复制到剪贴板")}>
                        <Copy className="size-4" />
                        复制错误详情
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
