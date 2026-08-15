import { Braces, ClipboardPaste, Code2, Cpu, HardDrive, Heading, History, Image, Layers3, Link2, List, Quote, ShieldCheck, Table2, Workflow, type LucideIcon } from "lucide-react";
import { WorkspacePageHeader } from "@/components/layout/page-header";
import { appPageMeta } from "@/components/layout/page-meta";
import { AppSurface } from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

type MarkdownGuideItem = {
  icon: LucideIcon;
  title: string;
  syntax: string;
  description: string;
};

const markdownGuideItems: MarkdownGuideItem[] = [
  { icon: Heading, title: "标题结构", syntax: "# 一级标题", description: "一级到六级标题会映射为 Word 标题层级，便于继续整理目录。" },
  { icon: Braces, title: "段落与分隔", syntax: "空行 / ---", description: "空行分隔段落，三个或更多连字符生成文档分隔线。" },
  { icon: List, title: "列表", syntax: "- 项目 / 1. 项目", description: "支持无序、有序和多级缩进列表，保留原始编号或字母标记。" },
  { icon: Table2, title: "表格", syntax: "| 字段 | 值 |", description: "支持标准 Markdown 表格、对齐方式和单元格内的常用行内格式。" },
  { icon: Code2, title: "代码与流程图", syntax: "`行内代码` / ```mermaid", description: "支持行内代码、围栏代码块和 Mermaid 图表的预览与导出。" },
  { icon: Quote, title: "引用", syntax: "> 引用内容", description: "标准引用块和常用提示型引用可保留为清晰的文档层次。" },
  { icon: Link2, title: "链接与文档引用", syntax: "[说明](链接) / [[笔记.md]]", description: "网页链接、相对 Markdown 路径和 Obsidian 文档引用都可识别。" },
  { icon: Image, title: "图片", syntax: "![说明](图片.png)", description: "使用相对路径引用仓库内图片，预览与导出会按文档位置解析。" },
];

export function AboutPage() {
  const { appConfig, appStatus, pandocStatus } = useAppStore();
  const appVersion = appStatus?.version ?? "0.1.8";
  const platformLabel = getPlatformLabel(appStatus?.platform);
  const isBrowserPreview = appStatus?.platform === "browser-preview";
  const pandocValue = isBrowserPreview
    ? "桌面端检测"
    : pandocStatus
      ? pandocStatus.available ? "可用" : "不可用"
      : "未检测";
  const pandocTone = isBrowserPreview || !pandocStatus ? "muted" : pandocStatus.available ? "success" : "danger";
  const contextMenuValue = isBrowserPreview ? "桌面端功能" : appConfig ? appConfig.enableContextMenu ? "已启用" : "未启用" : "加载中";
  const floatingBallValue = isBrowserPreview ? "桌面端功能" : appConfig ? appConfig.enableFloatingBall ? "已启用" : "未启用" : "加载中";
  const trayValue = isBrowserPreview ? "桌面端功能" : appConfig ? appConfig.enableTray ? "已启用" : "未启用" : "加载中";

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
      <WorkspacePageHeader meta={appPageMeta.about} />
      <div className="mk-about-workspace flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="mk-about-summary-grid grid shrink-0 grid-cols-[minmax(0,1fr)_320px] gap-1">
          <section className="min-w-0 space-y-1">
            <AppSurface as="section" className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-zinc-50">
                  <Workflow className="size-4" />
                  Markdown 到 Word/WPS 的本地工作台
                </h3>
              </div>
              <div className="space-y-3 text-sm leading-7 text-muted-foreground">
                <p>
                  md-king 面向 AI 生成 Markdown 文档的后处理场景，把标题、正文、列表、表格、代码块、图片和引用等结构稳定映射到 Word/WPS 可编辑 DOCX。
                </p>
                <p>从仓库中的 Markdown 文件或剪贴板内容开始，选择样式模板后本地生成 DOCX；导出结果仍可继续在 Word/WPS 中编辑。</p>
              </div>
              <div className="grid border-y border-slate-100 text-sm dark:border-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-slate-100 dark:sm:divide-zinc-800">
                <AboutFlowStep label="输入" text="标准 Markdown 或 AI 生成内容" />
                <AboutFlowStep label="编排" text="参考 DOCX 模板统一样式" />
                <AboutFlowStep label="输出" text="可编辑的 Word/WPS 文档" />
              </div>
            </AppSurface>

            <div className="grid gap-1 md:grid-cols-2">
              <Capability icon={ClipboardPaste} title="粘贴转换" text="复制 AI 对话内容后快速生成 DOCX。" />
              <Capability icon={Layers3} title="模板样式" text="复用参考 DOCX 控制 Word 样式。" />
              <Capability icon={History} title="转换历史" text="保留最近结果，方便回看和定位输出。" />
              <Capability icon={HardDrive} title="本地处理" text="文档内容在本机完成转换，不上传到远程服务。" />
            </div>
          </section>

          <aside className="flex min-w-0 flex-col gap-1">
            <AppSurface as="section" className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-zinc-50">
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

            <AppSurface as="section" className="flex-1 space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-zinc-50">
                  <ShieldCheck className="size-4" />
                  系统状态
                </h3>
              </div>
              <div className="space-y-3 text-sm">
                <Status label="Pandoc 引擎" value={pandocValue} tone={pandocTone} />
                <Status label="本地处理" value={isBrowserPreview ? "预览模式" : "本机转换"} tone={isBrowserPreview ? "muted" : "success"} />
                <Status label="右键菜单" value={contextMenuValue} tone={appConfig?.enableContextMenu ? "success" : "muted"} />
                <Status label="悬浮球" value={floatingBallValue} tone={appConfig?.enableFloatingBall ? "success" : "muted"} />
                <Status label="系统托盘" value={trayValue} tone={appConfig?.enableTray ? "success" : "muted"} />
              </div>
            </AppSurface>
          </aside>
        </div>

        <AppSurface as="section" padding="none" className="mk-about-guide flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-zinc-50">
              <Braces className="size-4" />
              Markdown 写法速览
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">优先使用标准 Markdown；表格、代码、链接、图片和 Mermaid 可直接在编辑器中预览。</p>
          </div>
          <div className="mk-about-guide-grid grid min-h-0 flex-1 auto-rows-fr grid-cols-1 sm:grid-cols-2">
            {markdownGuideItems.map((item) => (
              <MarkdownGuideRow key={item.title} {...item} />
            ))}
          </div>
        </AppSurface>
      </div>
    </div>
  );
}

function AboutFlowStep({ label, text }: { label: string; text: string }) {
  return (
    <div className="px-3 py-2.5 first:pl-0 last:pr-0 max-sm:border-b max-sm:border-slate-100 max-sm:last:border-b-0 dark:max-sm:border-zinc-800 sm:px-4 sm:first:pl-0 sm:last:pr-0">
      <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">{label}</p>
      <p className="mt-0.5 text-xs leading-5 text-slate-600 dark:text-zinc-300">{text}</p>
    </div>
  );
}

function MarkdownGuideRow({ icon: Icon, title, syntax, description }: MarkdownGuideItem) {
  return (
    <article className="mk-about-guide-row flex min-h-0 min-w-0 gap-3 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-300" />
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</h4>
        <code className="mt-1 block break-words font-mono text-[11px] leading-5 text-blue-700 dark:text-blue-300">{syntax}</code>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">{description}</p>
      </div>
    </article>
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
    <AppSurface as="article">
      <div className="flex size-10 items-center justify-center rounded-[8px] bg-blue-100 text-blue-700 dark:bg-blue-500/16 dark:text-blue-200">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-3 font-black text-slate-950 dark:text-zinc-50">{title}</h3>
      <p className="mt-1.5 text-sm leading-5 text-slate-500 dark:text-zinc-400">{text}</p>
    </AppSurface>
  );
}

function Status({ label, value, tone = "muted" }: { label: string; value: string; tone?: "success" | "danger" | "muted" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] border border-white/70 bg-white/58 px-3 py-2.5 dark:border-zinc-700/70 dark:bg-zinc-900/72">
      <span className="font-semibold text-slate-700 dark:text-zinc-300">{label}</span>
      <span
        className={cn(
          "text-xs font-bold",
          tone === "success" && "text-emerald-600 dark:text-emerald-300",
          tone === "danger" && "text-red-600 dark:text-red-300",
          tone === "muted" && "text-blue-700 dark:text-zinc-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}
