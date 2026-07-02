import { Clipboard, FileStack, Keyboard, MousePointer2, PanelTop, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AppSurface, PrimaryActionButton } from "@/components/ui/app-surface";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/app-store";

const entryCards = [
  {
    title: "悬浮球拖拽",
    description: "把 Markdown 文件拖到桌面悬浮球，按默认模板生成 Word。",
    icon: MousePointer2,
    status: "已接入偏好",
    enabled: true,
  },
  {
    title: "剪贴板快捷转换",
    description: "复制 AI 对话里的 Markdown 后，用快捷键唤起快速转换面板。",
    icon: Clipboard,
    status: "规划中",
    enabled: false,
  },
  {
    title: "Windows 右键菜单",
    description: "在资源管理器选中 .md 文件，右键直接转换为 DOCX。",
    icon: FileStack,
    status: "待安装器注册",
    enabled: false,
  },
  {
    title: "系统托盘小窗",
    description: "查看最近输出、切换默认模板、打开转换工作台。",
    icon: PanelTop,
    status: "待托盘接入",
    enabled: false,
  },
];

export function QuickEntryPage() {
  const { appConfig, templates, setActivePage } = useAppStore();
  const defaultTemplate = templates.find((template) => template.id === appConfig?.defaultTemplateId) ?? templates.find((template) => template.isDefault);

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <AppSurface as="section" className="overflow-hidden" padding="lg">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <Badge className="rounded-full bg-blue-600 px-3 py-1 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] hover:bg-blue-600">低摩擦入口</Badge>
            <h3 className="mt-4 text-2xl font-black tracking-[-0.04em] text-slate-950">复制、拖拽、右键，一步生成 Word</h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              面向每天和网页 AI 对话的场景：用户不需要先打开复杂工作台，只要复制 Markdown 或拖入文件，就能按默认模板输出 DOCX。
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {entryCards.map((entry) => {
                const Icon = entry.icon;
                return (
                  <article key={entry.title} className="rounded-[14px] border border-white/70 bg-white/62 p-4 shadow-[0_18px_42px_rgba(37,99,235,0.1)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="mk-entry-icon flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        <Icon className="size-5" />
                      </div>
                      <Switch checked={entry.enabled} disabled />
                    </div>
                    <h4 className="mt-4 font-black text-slate-950">{entry.title}</h4>
                    <p className="mt-2 text-sm leading-5 text-slate-500">{entry.description}</p>
                    <Badge variant="secondary" className="mt-4 rounded-full bg-slate-100 text-slate-700">
                      {entry.status}
                    </Badge>
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="mk-quick-window relative min-h-[420px] rounded-[18px] border border-white/75 bg-gradient-to-br from-white/78 to-blue-100/62 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.95),0_28px_70px_rgba(37,99,235,.18)]">
            <div className="absolute right-8 top-8 flex size-24 items-center justify-center rounded-[18px] bg-gradient-to-br from-blue-400 to-blue-700 text-2xl font-black text-white shadow-[0_26px_60px_rgba(37,99,235,.34)]">
              M
            </div>
            <div className="pt-36">
              <h4 className="text-xl font-black tracking-[-0.04em] text-slate-950">快速转换小窗</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">拖入 Markdown 文件或粘贴剪贴板内容，使用默认模板生成 DOCX。</p>
              <div className="mk-quick-drop mt-5 rounded-[14px] border border-dashed border-slate-300 bg-white/58 p-5 text-center">
                <FileStack className="mx-auto size-9 text-slate-500" />
                <p className="mt-3 font-bold text-slate-900">拖入 Markdown 文件</p>
                <p className="mt-1 text-xs text-slate-500">模板：{defaultTemplate?.name ?? "通用报告模板"}</p>
              </div>
              <PrimaryActionButton className="mt-5 h-12 w-full rounded-xl font-black" onClick={() => setActivePage("convert")}>
                打开转换工作台
              </PrimaryActionButton>
            </div>
          </aside>
        </div>
      </AppSurface>

      <aside className="space-y-5">
        <AppSurface as="section" padding="lg">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-950">当前默认策略</h3>
              <p className="text-sm text-slate-500">快速入口统一读取这里</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <InfoLine label="默认模板" value={defaultTemplate?.name ?? "通用报告模板"} />
            <InfoLine label="输出位置" value={appConfig?.defaultOutputDir || "与源文件同目录"} />
            <InfoLine label="打开文件" value={appConfig?.openAfterConvert ? "转换后自动打开" : "仅保存文件"} />
          </div>
        </AppSurface>

        <AppSurface as="section" padding="lg">
          <h3 className="font-black text-slate-950">快捷键方案</h3>
          <div className="mt-4 space-y-3">
            <Shortcut label="打开快速转换" value="Ctrl + Alt + M" />
            <Shortcut label="剪贴板转 Word" value="Ctrl + Shift + V" />
            <Shortcut label="显示/隐藏悬浮球" value="Ctrl + Alt + Space" />
          </div>
        </AppSurface>
      </aside>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/62 px-4 py-3">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 truncate font-bold text-slate-900">{value}</span>
    </div>
  );
}

function Shortcut({ label, value }: { label: string; value: string }) {
  return (
    <div className="mk-shortcut-row flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/62 px-4 py-3">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="rounded-xl bg-slate-100 px-3 py-1 font-mono text-xs font-black text-slate-700 shadow-sm">
        <Keyboard className="mr-1 inline size-3.5" />
        {value}
      </span>
    </div>
  );
}
