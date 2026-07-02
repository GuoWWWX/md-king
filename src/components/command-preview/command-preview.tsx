import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CommandPreviewProps = {
  title: string;
  command: string;
};

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast.success("命令已复制到剪贴板");
  } catch (error) {
    toast.error(error instanceof Error ? `复制失败：${error.message}` : "复制失败，请手动复制命令");
  }
}

export function CommandPreview({ title, command }: CommandPreviewProps) {
  return (
    <Card className="mk-command-preview min-w-0 bg-card/80">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Terminal className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
        </CardTitle>
        <Button className="shrink-0" size="sm" variant="outline" onClick={() => copyCommand(command)}>
          <Copy className="size-4" />
          复制
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="mk-command-preview-code max-w-full overflow-x-auto rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
          <code>{command}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
