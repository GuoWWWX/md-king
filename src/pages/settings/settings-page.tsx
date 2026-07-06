import { Check, Database, FolderOpen, Globe2, HardDrive, Keyboard, MousePointer2, PanelTop, Palette, RefreshCcw, RotateCcw, Save, Settings2, ShieldCheck, Terminal, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SettingRow } from "@/components/settings/setting-row";
import { SettingsSection } from "@/components/settings/settings-section";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyAppearance } from "@/lib/appearance";
import { checkPandoc, clearHistoryRemote, saveAppConfig, selectDirectory } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import type { AccentColor, AppConfig } from "@/types";

const accentOptions: Array<{ value: AccentColor; label: string; description: string; color: string }> = [
  { value: "blue", label: "专业蓝", description: "更像桌面办公软件，稳重清爽", color: "#2563eb" },
  { value: "emerald", label: "效率绿", description: "本地优先与文档处理感更强", color: "#059669" },
  { value: "sky", label: "浅科技蓝", description: "轻量、现代，适合长期使用", color: "#0284c7" },
  { value: "slate", label: "商务灰", description: "低饱和，不抢文档内容焦点", color: "#334155" },
  { value: "indigo", label: "原紫色", description: "当前默认风格，偏产品感", color: "#4f46e5" },
  { value: "rose", label: "暖红", description: "更醒目，适合强调操作入口", color: "#e11d48" },
  { value: "amber", label: "琥珀", description: "温暖、轻商务风格", color: "#d97706" },
];

export function SettingsPage() {
  const { appConfig, pandocStatus, setAppConfig, setPandocStatus, history, clearHistory, setHistory } = useAppStore();
  const [draft, setDraft] = useState<AppConfig | undefined>(appConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => setDraft(appConfig), [appConfig]);

  function updateDraft<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "themeMode" || key === "accentColor") {
        applyAppearance(next.themeMode ?? "light", next.accentColor ?? "blue");
      }
      return next;
    });
  }

  const hasChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(appConfig), [appConfig, draft]);
  const pandocAvailable = pandocStatus?.available === true;
  const pandocSummaryLabel = pandocStatus ? (pandocAvailable ? "已检测可用" : "不可用") : "未检测";
  const pandocBadgeClass = pandocAvailable
    ? "rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
    : pandocStatus
      ? "rounded-full bg-red-50 text-red-700 hover:bg-red-50"
      : "rounded-full bg-slate-100 text-slate-600 hover:bg-slate-100";
  const pandocBadgeLabel = pandocAvailable ? "可用" : pandocStatus ? "不可用" : "未检测";

  function handleReset() {
    setDraft(appConfig);
    if (appConfig) {
      applyAppearance(appConfig.themeMode ?? "light", appConfig.accentColor ?? "blue");
    }
    toast.info("已重置为当前已保存设置");
  }

  async function handleSave() {
    if (!draft) return;
    setIsSaving(true);
    try {
      const saved = await saveAppConfig(draft);
      setAppConfig(saved);
      toast.success("设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSelectOutputDir() {
    try {
      const selected = await selectDirectory();
      if (!selected) return;
      updateDraft("defaultOutputDir", selected);
      toast.success("已选择默认输出目录，保存设置后生效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择目录失败");
    }
  }

  async function handleCheckPandoc() {
    setIsChecking(true);
    try {
      const status = await checkPandoc();
      setPandocStatus(status);
      toast[status.available ? "success" : "error"](status.message ?? (status.available ? "Pandoc 可用" : "Pandoc 不可用"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "检测 Pandoc 失败");
    } finally {
      setIsChecking(false);
    }
  }

  async function handleClearHistory() {
    if (history.length === 0) {
      toast.info("当前没有可清空的转换历史");
      return;
    }

    try {
      const nextHistory = await clearHistoryRemote();
      setHistory(nextHistory);
      toast.success("转换历史已清空");
    } catch (error) {
      clearHistory();
      toast.error(error instanceof Error ? error.message : "远程清空失败，已清空本地视图");
    }
  }

  if (!draft) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在加载设置...</div>;
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1440px] min-w-0 flex-col gap-4 overflow-hidden">
      <AppSurface as="section" radius="lg" padding="lg" className="shrink-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <Save className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-950">设置总览</p>
                  <Badge className={hasChanges ? "rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50" : "rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50"}>{hasChanges ? "有未保存更改" : "已保存"}</Badge>
                </div>
                <p className="mt-1 text-sm leading-5 text-slate-500">修改配置后可在这里统一保存或重置。</p>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 text-sm text-slate-600 lg:flex-row lg:flex-wrap">
              <div className="rounded-full border border-white/70 bg-white/58 px-3 py-1.5">历史记录：{history.length} 条</div>
              <div className="rounded-full border border-white/70 bg-white/58 px-3 py-1.5">Pandoc：{pandocSummaryLabel}</div>
              <div className="rounded-full border border-white/70 bg-white/58 px-3 py-1.5">系统集成：{[draft.enableContextMenu, draft.enableFloatingBall, draft.enableTray].filter(Boolean).length}/3 已启用</div>
              <div className="max-w-full truncate rounded-full border border-white/70 bg-white/58 px-3 py-1.5" title={draft.defaultOutputDir?.trim() || "文档/MD King"}>默认目录：{draft.defaultOutputDir?.trim() || "文档/MD King"}</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">
            <SoftActionButton className="h-11 rounded-xl" onClick={handleReset} disabled={!hasChanges || isSaving}>
              <RotateCcw className="size-4" />
              重置
            </SoftActionButton>
            <PrimaryActionButton className="h-11 min-w-36 rounded-xl px-5" onClick={handleSave} disabled={!hasChanges || isSaving}>
              <Save className="size-4" />
              {isSaving ? "正在保存..." : "保存设置"}
            </PrimaryActionButton>
          </div>
        </div>
      </AppSurface>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 lg:grid-cols-2">
        <SettingsSection title="基础设置" description="默认目录、语言、外观和主题色。" icon={Settings2}>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">默认输出目录</Label>
            <div className="flex gap-2">
              <Input value={draft.defaultOutputDir ?? ""} onChange={(event) => updateDraft("defaultOutputDir", event.target.value || undefined)} placeholder="文档/MD King" />
              <Button variant="outline" size="sm" onClick={handleSelectOutputDir}>
                <FolderOpen className="size-4" />
                更改
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">语言</Label>
              <Select value={draft.language ?? "zh"} onValueChange={(value) => updateDraft("language", value as AppConfig["language"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="zh">简体中文</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">外观主题</Label>
              <Select value={draft.themeMode ?? "light"} onValueChange={(value) => updateDraft("themeMode", value as AppConfig["themeMode"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="system">跟随系统</SelectItem><SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-slate-500">主题色</Label>
              <span className="text-xs text-slate-400">推荐：专业蓝 / 效率绿 / 商务灰</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {accentOptions.map((option) => {
                const active = (draft.accentColor ?? "blue") === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${active ? "border-[var(--app-primary)] bg-[var(--app-primary-soft)] text-[var(--app-primary-text)] shadow-sm" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
                    title={option.description}
                    onClick={() => updateDraft("accentColor", option.value)}
                  >
                    <span className="size-3.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: option.color }} />
                    <span>{option.label}</span>
                    {active ? <Check className="size-3" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="Pandoc 引擎" description="默认优先使用应用内置的 Pandoc，无需用户单独安装。" icon={Terminal}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-900">引擎状态</span>
              <Badge className={pandocBadgeClass}>{pandocBadgeLabel}</Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{pandocStatus?.message ?? "尚未检测 Pandoc。"}</p>
            {pandocStatus?.version ? <p className="mt-2 truncate font-mono text-xs text-slate-500">{pandocStatus.version}</p> : null}
          </div>
          <SettingRow
            label="优先使用内置 Pandoc"
            description="打包后的桌面应用会自带 Pandoc。填写自定义路径会优先使用该路径；留空时使用内置 Pandoc。"
            checked={draft.useBundledPandoc}
            badge="推荐"
            onCheckedChange={(checked) => updateDraft("useBundledPandoc", checked)}
          />
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">自定义执行路径（可选覆盖）</Label>
            <Input
              value={draft.pandocPath ?? ""}
              onChange={(event) => updateDraft("pandocPath", event.target.value || undefined)}
              placeholder={draft.useBundledPandoc ? "留空则使用内置 Pandoc" : "例如：C:/Tools/pandoc/pandoc.exe"}
            />
            <p className="text-xs leading-5 text-slate-500">
              {draft.useBundledPandoc ? "当前启用内置 Pandoc。只有你想强制改用其他版本时，才需要填写这里。" : "当前已关闭内置 Pandoc，将优先使用这里填写的路径；留空时回退系统 pandoc。"}
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={handleCheckPandoc} disabled={isChecking}>
            <RefreshCcw className="size-4" />
            {isChecking ? "检测中..." : "重新检测 Pandoc"}
          </Button>
        </SettingsSection>

        <SettingsSection title="转换设置" description="默认转换行为。" icon={HardDrive}>
          <SettingRow label="完成后自动打开文件" description="转换成功后使用默认应用打开生成的 DOCX。" checked={draft.openAfterConvert} onCheckedChange={(checked) => updateDraft("openAfterConvert", checked)} />
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">同名文件处理</Label>
            <Select value={draft.defaultConflictStrategy ?? "overwrite"} onValueChange={(value) => updateDraft("defaultConflictStrategy", value as AppConfig["defaultConflictStrategy"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="overwrite">直接覆盖（当前默认）</SelectItem>
                <SelectItem value="rename">自动重命名</SelectItem>
                <SelectItem value="ask">每次询问</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-slate-500">单次转换会读取这里的默认策略；批量转换接入后会沿用该策略作为默认值。</p>
          </div>
          <SettingRow label="保留转换日志" description="保存转换过程和 Pandoc 摘要，便于排查失败原因。" checked={draft.keepConversionLog ?? true} onCheckedChange={(checked) => updateDraft("keepConversionLog", checked)} />
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">日志级别</Label>
            <Select value={draft.logLevel ?? "info"} onValueChange={(value) => updateDraft("logLevel", value as AppConfig["logLevel"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="warn">warn</SelectItem>
                <SelectItem value="info">info</SelectItem>
                <SelectItem value="debug">debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </SettingsSection>

        <SettingsSection title="系统集成" description="悬浮球、Windows 右键菜单和系统托盘已可用。" icon={MousePointer2}>
          <SettingRow label="添加到右键菜单" description="开启并保存后，.md/.markdown 文件右键可直接转换为 Word，桌面空白处右键可打开 MD King。" checked={draft.enableContextMenu} badge="已接入" onCheckedChange={(checked) => updateDraft("enableContextMenu", checked)} />
          <SettingRow label="启用悬浮球快捷转换" description="开启并保存后，应用右下角会显示悬浮球，可拖入多个 Markdown 文件或文本批量转换。" checked={draft.enableFloatingBall} badge="已接入" onCheckedChange={(checked) => updateDraft("enableFloatingBall", checked)} />
          <SettingRow label="系统托盘" description="开启并保存后显示托盘图标；关闭主窗口时隐藏到托盘，托盘菜单可显示或退出。" checked={draft.enableTray} badge="已接入" onCheckedChange={(checked) => updateDraft("enableTray", checked)} />
          <div className="grid gap-2 text-sm text-slate-500">
            <InfoLine icon={MousePointer2} text={`右键菜单：${draft.enableContextMenu ? "保存后写入当前用户 Windows 右键菜单" : "未开启"}`} />
            <InfoLine icon={PanelTop} text={`悬浮球：${draft.enableFloatingBall ? "保存后显示在右下角" : "未显示"}`} />
            <InfoLine icon={PanelTop} text={`系统托盘：${draft.enableTray ? "保存后显示托盘图标" : "未开启"}`} />
          </div>
        </SettingsSection>

        <SettingsSection title="隐私与数据" description="本地优先的数据策略。" icon={ShieldCheck}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-zinc-700/70 dark:bg-zinc-800/60 dark:text-zinc-200">Markdown 和 DOCX 默认只在本机处理，不上传云端。</div>
          <div className="grid gap-2 text-sm text-slate-500">
            <InfoLine icon={Database} text={`历史记录：${history.length} 条`} />
            <InfoLine icon={Globe2} text="运行模式：本地桌面 / 浏览器预览兼容" />
            <InfoLine icon={Palette} text={`主题色：${accentOptions.find((option) => option.value === draft.accentColor)?.label ?? "专业蓝"}`} />
            <InfoLine icon={Keyboard} text={`CLI JSON 默认输出：${draft.cliDefaultJson ? "开启" : "关闭"}`} />
          </div>
          <SettingRow label="CLI 默认 JSON 输出" description="面向 Agent 和自动化脚本时，默认输出结构化 JSON。" checked={draft.cliDefaultJson} onCheckedChange={(checked) => updateDraft("cliDefaultJson", checked)} />
          <Button variant="outline" className="w-full" onClick={handleClearHistory}>清空转换历史</Button>
        </SettingsSection>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <Icon className="size-4 shrink-0 text-slate-400" />
      <span className="truncate">{text}</span>
    </div>
  );
}
