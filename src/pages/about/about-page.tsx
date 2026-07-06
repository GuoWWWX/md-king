import { Bot, ClipboardPaste, Cpu, FileText, Layers3, ShieldCheck, type LucideIcon } from "lucide-react";
import { AppSurface } from "@/components/ui/app-surface";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/app-store";

const stack = ["Tauri 2", "React", "TypeScript", "shadcn/ui", "Rust", "Pandoc"];

export function AboutPage() {
  const { appStatus } = useAppStore();
  const appVersion = appStatus?.version ?? "0.1.8";
  const platformLabel = getPlatformLabel(appStatus?.platform);

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
            <p>桌面端使用本地 Pandoc 转换 Markdown，支持粘贴内容、文件导入、模板样式和历史记录，生成的 DOCX 可继续在 Word/WPS 中编辑。</p>
          </div>
        </AppSurface>

        <div className="grid gap-4 md:grid-cols-2">
          <Capability icon={ClipboardPaste} title="粘贴转换" text="复制 AI 对话内容后快速生成 DOCX。" />
          <Capability icon={Layers3} title="模板样式" text="复用参考 DOCX 控制 Word 样式。" />
          <Capability icon={Bot} title="Agent/CLI" text="提供稳定命令和 JSON 输出，方便自动化调用。" />
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
              <span>{appVersion}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">平台</span>
              <span>{platformLabel}</span>
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
            <Status label="Pandoc 引擎" value="检测可用" />
            <Status label="本地隐私" value="默认本机处理" />
            <Status label="右键菜单" value="可用" />
            <Status label="CLI" value="可用" />
          </div>
        </AppSurface>
      </aside>
    </div>
  );
}

function getPlatformLabel(platform?: string) {
  const labels: Record<string, string> = {
    windows: "Windows 桌面端",
    macos: "macOS 桌面端",
    linux: "Linux 桌面端",
    "browser-preview": "浏览器预览",
  };

  return platform ? labels[platform] ?? platform : "桌面端";
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
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-white/70 bg-white/58 px-4 py-3">
      <span className="font-semibold text-slate-700">{label}</span>
      <span className="text-xs font-bold text-blue-700">{value}</span>
    </div>
  );
}
