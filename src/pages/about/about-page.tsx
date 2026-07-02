import { Bot, ClipboardPaste, Cpu, FileText, Layers3, MousePointer2, ShieldCheck, type LucideIcon } from "lucide-react";
import { AppSurface } from "@/components/ui/app-surface";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/app-store";

const stack = ["Tauri 2", "React", "TypeScript", "shadcn/ui", "Rust", "Pandoc"];

export function AboutPage() {
  const { appStatus } = useAppStore();

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 space-y-5">
        <AppSurface as="section" radius="lg" className="space-y-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <FileText className="size-4" />
              把 AI Markdown 变成可交付 Word 文档
            </h3>
          </div>
          <div className="space-y-4 text-sm leading-7 text-muted-foreground">
            <p>
              md-king 面向 AI 生成 Markdown 文档的后处理场景，目标是把标题、正文、列表、表格、代码块等结构稳定映射到 Word/WPS 可编辑 DOCX。
            </p>
            <p>当前桌面后端已支持 .md 文件路径转换；浏览器预览只展示前端流程，不生成实际 DOCX。</p>
          </div>
        </AppSurface>

        <div className="grid gap-4 md:grid-cols-2">
          <Capability icon={ClipboardPaste} title="粘贴转换" text="复制 AI 对话内容后快速生成 DOCX。" />
          <Capability icon={Layers3} title="模板样式" text="复用 reference.docx 控制 Word 样式。" />
          <Capability icon={MousePointer2} title="快速入口" text="悬浮球、右键菜单、快捷键逐步接入。" />
          <Capability icon={Bot} title="Agent/CLI" text="为自动化和智能体保留稳定契约。" />
        </div>

        <AppSurface as="section" className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Layers3 className="size-4" />
              技术栈
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {stack.map((item) => (
              <Badge key={item} variant="secondary">
                {item}
              </Badge>
            ))}
          </div>
        </AppSurface>
      </section>

      <aside className="min-w-0 space-y-5">
        <AppSurface as="section" className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Cpu className="size-4" />
              应用信息
            </h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">名称</span>
              <span>{appStatus?.name ?? "md-king"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">版本</span>
              <span>{appStatus?.version ?? "0.1.0"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">平台</span>
              <span>{appStatus?.platform ?? "desktop/browser"}</span>
            </div>
          </div>
        </AppSurface>

        <AppSurface as="section" className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <ShieldCheck className="size-4" />
              系统状态
            </h3>
          </div>
          <div className="space-y-3 text-sm">
            <Status label="Pandoc 引擎" value="已接入检测" />
            <Status label="本地隐私" value="默认本机处理" />
            <Status label="右键菜单" value="规划中" />
            <Status label="CLI / MCP" value="规划中" />
          </div>
        </AppSurface>
      </aside>
    </div>
  );
}

function Capability({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <AppSurface as="article" padding="lg">
      <div className="flex size-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-5 text-slate-500">{text}</p>
    </AppSurface>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/58 px-4 py-3">
      <span className="font-semibold text-slate-700">{label}</span>
      <span className="text-xs font-bold text-blue-700">{value}</span>
    </div>
  );
}
