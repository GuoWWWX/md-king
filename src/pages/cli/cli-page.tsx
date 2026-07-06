import { Bot, CheckCircle2, Copy, FileCode2, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { CommandPreview } from "@/components/command-preview/command-preview";
import { AppSurface, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";

const commandSpec = `md-king CLI 使用说明

1. 自动化命令默认支持 --json，并输出稳定 JSON 结构。
2. 当前可用转换命令：md-king-cli convert <input.md> -o <output.docx> --template <template-id> --json。
3. 当前可用模板命令：md-king-cli templates list --json。
4. 转换失败时返回 errorCode，便于 Agent 判断重试、降级或提示用户。`;

async function copyCommandSpec() {
  try {
    await navigator.clipboard.writeText(commandSpec);
    toast.success("CLI 使用说明已复制到剪贴板");
  } catch (error) {
    toast.error(error instanceof Error ? `复制失败：${error.message}` : "复制失败，请手动复制 CLI 使用说明");
  }
}

export function CliPage() {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_150px] gap-3 overflow-hidden">
      <section className="shrink-0">
        <h2 className="text-2xl font-black tracking-[-0.04em] text-blue-950">Agent 与命令行</h2>
        <p className="mt-1 text-sm text-blue-900/58">通过 CLI 让脚本和 AI Agent 把 Markdown 稳定交给 MD King。</p>
      </section>

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_310px] gap-3 overflow-hidden max-[1080px]:grid-cols-1">
        <div className="mk-cli-terminal overflow-hidden rounded-[18px] border border-slate-900/10 bg-gradient-to-br from-slate-950 via-slate-900 to-neutral-950 p-7 font-mono text-xs leading-7 text-slate-100 shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
          <div className="mb-4 flex items-center justify-between text-white">
            <span className="flex items-center gap-2 font-sans text-sm font-black">
              <Terminal className="size-4" />
              终端
            </span>
            <Button size="icon-sm" variant="ghost" className="rounded-lg border border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/10 hover:text-white" onClick={copyCommandSpec} aria-label="复制 CLI 使用说明">
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-slate-400"># 基本转换</p>
          <p><span className="text-slate-200">md-king-cli</span> convert input.md -o output.docx</p>
          <p className="mt-4 text-slate-400"># 使用模板</p>
          <p><span className="text-slate-200">md-king-cli</span> convert input.md -o output.docx --template default-report</p>
          <p className="mt-4 text-slate-400"># 返回 JSON 输出</p>
          <p><span className="text-slate-200">md-king-cli</span> convert input.md -o output.docx --json</p>
          <p className="mt-4 text-slate-400"># 查看模板列表</p>
          <p><span className="text-slate-200">md-king-cli</span> templates list --json</p>
        </div>

        <aside className="grid min-h-0 grid-rows-[1fr_auto] gap-3 overflow-hidden max-[1080px]:hidden">
          <div className="grid min-h-0 gap-3">
            <CommandPreview title="模板列表" command="md-king-cli templates list --json" />
            <CommandPreview title="JSON 输出示例" command={`{\n  "ok": true,\n  "output": "<实际输出路径>",\n  "durationMs": "<转换耗时>"\n}`} />
          </div>

          <AppSurface as="section" className="space-y-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Bot className="size-4" />
                CLI 自动化
              </h3>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <StatusLine icon={CheckCircle2} label="CLI 命令" value="可用" />
              <StatusLine icon={FileCode2} label="JSON 输出" value="稳定格式" />
              <SoftActionButton className="w-full" onClick={copyCommandSpec}>
                <Copy className="size-4" />
                复制说明
              </SoftActionButton>
            </div>
          </AppSurface>
        </aside>
      </section>

      <AppSurface as="section" className="grid shrink-0 grid-cols-3 items-center gap-3">
        {["AI 生成 Markdown", "CLI 转换", "DOCX 路径返回"].map((step, index) => (
          <div key={step} className="rounded-[10px] border border-white/70 bg-white/58 p-4 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-[9px] bg-blue-600 font-black text-white shadow-[0_10px_22px_rgba(37,99,235,0.18)]">{index + 1}</div>
            <p className="mt-2 text-sm font-black text-blue-950">{step}</p>
          </div>
        ))}
      </AppSurface>
    </div>
  );
}

function StatusLine({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-white/70 bg-white/58 px-4 py-3">
      <span className="flex items-center gap-2 font-semibold text-slate-700">
        <Icon className="size-4 text-blue-600" />
        {label}
      </span>
      <span className="text-xs font-bold text-blue-700">{value}</span>
    </div>
  );
}
