import { useEffect, useState } from "react";
import { Check, Info, Moon, Palette, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { renderMermaid } from "@/lib/mermaid";
import { MERMAID_DIAGRAM_TYPES, MERMAID_THEMES, normalizeMermaidThemes, resolveMermaidTheme, type MermaidThemeId, type MermaidThemeSettings } from "@/lib/mermaid-config.js";
import { svgDataUrl } from "@/lib/svg-image";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { mermaidThemeSamples } from "./mermaid-theme-samples";

const presets: Array<{ name: string; light: MermaidThemeId; dark: MermaidThemeId; colors: string[] }> = [
  { name: "原生多色", light: "redux-color", dark: "redux-dark-color", colors: ["#c4dcff", "#f9c967", "#aa80d8", "#7053c7"] },
  { name: "简洁灰阶", light: "redux", dark: "redux-dark", colors: ["#d8dce4", "#b5bac5", "#7c8494", "#4b5260"] },
  { name: "柔和渐变", light: "neo", dark: "neo-dark", colors: ["#d7efff", "#ded7ff", "#c8a3e8", "#adb8f3"] },
  { name: "传统主题", light: "default", dark: "dark", colors: ["#dcd6ed", "#e8edc2", "#b6d3d6", "#e6c1c6"] },
];

const themePairs = [...presets,
  { name: "森林", light: "forest" as const, dark: "forest" as const },
  { name: "中性", light: "neutral" as const, dark: "neutral" as const },
  { name: "基础", light: "base" as const, dark: "base" as const },
];
const selectClass = "w-full min-w-0 rounded-md border-slate-200 bg-white text-xs text-slate-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate";
const contentClass = "mk-mermaid-theme-select w-[var(--radix-select-trigger-width)] min-w-0 rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-xl shadow-slate-900/12 ring-0 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-black/30";
const itemClass = "min-h-9 cursor-pointer rounded-md px-2 pr-8 text-xs";

function ThemeSelect({ label, mode, value, inherit, disabled, onChange }: { label: string; mode: "light" | "dark"; value: string; inherit?: string; disabled?: boolean; onChange: (value: string) => void }) {
  const Icon = mode === "dark" ? Moon : Sun;
  return <Select value={value} disabled={disabled} onValueChange={onChange}>
    <SelectTrigger aria-label={label} data-value={value} className={selectClass}><SelectValue /></SelectTrigger>
    <SelectContent className={`${contentClass} w-64 max-h-[min(16rem,var(--radix-select-content-available-height))] [&_[data-radix-select-viewport]]:min-w-0!`}>
      {inherit && <><SelectItem className={itemClass} value="inherit" data-value="inherit">{inherit}</SelectItem><SelectSeparator className="mx-0 my-1 bg-slate-100 dark:bg-zinc-800" /></>}
      <SelectGroup>
        <SelectLabel className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-slate-500 dark:text-zinc-400"><Icon className="size-3.5" />{mode === "dark" ? "深色模式" : "浅色模式"} · 全部 {MERMAID_THEMES.length} 款</SelectLabel>
        {MERMAID_THEMES.map((theme) => <SelectItem key={theme.id} className={itemClass} value={theme.id} data-value={theme.id}>{theme.label}</SelectItem>)}
      </SelectGroup>
    </SelectContent>
  </Select>;
}

function ThemePreview({ type, dark, settings }: { type: string; dark: boolean; settings: MermaidThemeSettings }) {
  const [result, setResult] = useState<{ image?: string; error?: string }>({});
  const source = mermaidThemeSamples[type];
  const theme = resolveMermaidTheme(source, dark, settings);
  useEffect(() => {
    let cancelled = false;
    setResult({});
    void renderMermaid(source, dark, settings).then(({ svg }) => {
      if (!cancelled) setResult({ image: svgDataUrl(svg) });
    }).catch((error: unknown) => {
      if (!cancelled) setResult({ error: userFacingErrorMessage(error, "图表预览失败") });
    });
    return () => { cancelled = true; };
  // Only the effective theme affects this preview, not unrelated overrides.
  }, [source, dark, theme]);
  return <div className="min-w-0 rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">{dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}{dark ? "深色预览" : "浅色预览"}</div>
    <div className="flex h-[300px] items-center justify-center overflow-auto rounded-md p-2 sm:h-[340px]" style={{ background: dark ? "#202124" : "#fff", color: dark ? "#e4e4e7" : "#334155" }} aria-live="polite" aria-busy={!result.image && !result.error}>
      {result.image ? <img className="max-h-full max-w-full object-contain" src={result.image} alt={`${MERMAID_DIAGRAM_TYPES.find((item) => item.id === type)?.label} · ${theme}`} /> : <p className="text-center text-xs">{result.error ?? "正在渲染…"}</p>}
    </div>
    <p className="mt-2 truncate text-center text-xs text-slate-500 dark:text-zinc-400">{MERMAID_THEMES.find((item) => item.id === theme)?.label}</p>
  </div>;
}

export function MermaidThemeDialog({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; value?: MermaidThemeSettings; onSave: (settings: MermaidThemeSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(() => normalizeMermaidThemes(value));
  const [presetName, setPresetName] = useState("");
  const [previewType, setPreviewType] = useState("flowchart");
  const [saving, setSaving] = useState(false);
  const selectedPair = themePairs.find((pair) => pair.light === draft.light && pair.dark === draft.dark);
  useEffect(() => { if (open) { setDraft(normalizeMermaidThemes(value)); setPresetName(""); } }, [open, value]);

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const preset = { name, light: draft.light, dark: draft.dark, diagrams: draft.diagrams };
    const saved = draft.presets ?? [];
    const presets = saved.some((item) => item.name === name)
      ? saved.map((item) => item.name === name ? preset : item) : [...saved, preset];
    setDraft(normalizeMermaidThemes({ ...draft, presets }));
    setPresetName(name);
    toast.success("组合已加入待保存配置");
  }

  function setOverride(type: string, mode: "light" | "dark", theme: string) {
    setDraft((current) => normalizeMermaidThemes({ ...current, diagrams: { ...current.diagrams, [type]: { ...current.diagrams[type], [mode]: theme === "inherit" ? undefined : theme as MermaidThemeId } } }));
    setPreviewType(type);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "保存 Mermaid 主题失败"));
    } finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
    <DialogContent aria-describedby={undefined} className="flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]">
      <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-3 pr-12 dark:border-zinc-700">
        <DialogTitle className="flex items-center gap-2"><Palette className="size-5" />Mermaid 图表主题</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid lg:grid-cols-[1.08fr_1fr]">
          <div className="min-w-0 space-y-5 p-5 lg:border-r lg:border-slate-200 lg:dark:border-zinc-700">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">整体配色方案</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {presets.map((preset) => {
                  const selected = draft.light === preset.light && draft.dark === preset.dark;
                  return <button key={preset.name} type="button" aria-pressed={selected} disabled={saving} onClick={() => setDraft({ ...draft, light: preset.light, dark: preset.dark })} className={`relative rounded-lg border p-3 text-center transition ${selected ? "border-[var(--app-primary)] bg-[var(--app-primary-soft)] ring-1 ring-[var(--app-primary)]" : "border-slate-200 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>
                    <span className="mb-2 flex justify-center gap-1">{preset.colors.map((color) => <span key={color} className="h-5 w-4 rounded-sm" style={{ background: color }} />)}</span>
                    <span className="text-xs font-medium">{preset.name}</span>{selected && <Check className="absolute right-1 top-1 size-3.5 text-[var(--app-primary)]" />}
                  </button>;
                })}
              </div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                <span className="text-xs text-slate-500 dark:text-zinc-400">整体选择</span>
                <Select value={selectedPair?.light ?? "custom"} disabled={saving} onValueChange={(theme) => {
                  const pair = themePairs.find((item) => item.light === theme);
                  if (pair) setDraft({ ...draft, light: pair.light, dark: pair.dark });
                }}>
                  <SelectTrigger className={selectClass} aria-label="整体选择主题"><SelectValue>{selectedPair?.name ?? "自定义深浅搭配"}</SelectValue></SelectTrigger>
                  <SelectContent className={contentClass}>
                    <SelectItem className={itemClass} value="custom" disabled>自定义深浅搭配</SelectItem>
                    <SelectSeparator className="mx-0 my-1 bg-slate-100 dark:bg-zinc-800" />
                    <SelectGroup><SelectLabel className="px-2 py-2 text-[11px] text-slate-500 dark:text-zinc-400">自动搭配浅色 / 深色主题</SelectLabel>
                      {themePairs.map((pair) => <SelectItem key={pair.light} className={`${itemClass} py-2`} value={pair.light} data-value={pair.light}><span className="flex flex-col items-start gap-0.5"><span>{pair.name}</span><span className="text-[11px] opacity-65">{MERMAID_THEMES.find((theme) => theme.id === pair.light)?.label} / {MERMAID_THEMES.find((theme) => theme.id === pair.dark)?.label}</span></span></SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">我的组合</h3>
              <p className="text-xs leading-5 text-slate-500 dark:text-zinc-400">保存深浅默认主题及各图表的单独设置，之后一键复用。</p>
              <div className="flex gap-2">
                <Input aria-label="组合名称" placeholder="输入组合名称" maxLength={40} value={presetName} disabled={saving} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); savePreset(); } }} className="min-w-0 flex-1 text-xs" />
                <Button variant="outline" disabled={saving || !presetName.trim()} onClick={savePreset}>{draft.presets?.some((preset) => preset.name === presetName.trim()) ? "更新同名组合" : "保存为组合"}</Button>
              </div>
              {!!draft.presets?.length && <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-zinc-700">
                {draft.presets.map((preset) => <div key={preset.name} className="flex min-w-0 items-center gap-1">
                  <button type="button" disabled={saving} aria-label={`应用组合：${preset.name}`} className="min-w-0 flex-1 rounded-md px-2 py-2 text-left text-xs hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-zinc-800" onClick={() => { setDraft(normalizeMermaidThemes({ ...draft, light: preset.light, dark: preset.dark, diagrams: preset.diagrams })); setPresetName(preset.name); }}><span className="block truncate font-medium">{preset.name}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-zinc-400">{MERMAID_THEMES.find((theme) => theme.id === preset.light)?.label} / {MERMAID_THEMES.find((theme) => theme.id === preset.dark)?.label} · {Object.keys(preset.diagrams).length} 种单独设置</span></button>
                  <Button size="icon" variant="ghost" disabled={saving} aria-label={`删除组合：${preset.name}`} onClick={() => { setDraft(normalizeMermaidThemes({ ...draft, presets: draft.presets?.filter((item) => item.name !== preset.name) })); if (presetName === preset.name) setPresetName(""); }}><Trash2 className="size-3.5" /></Button>
                </div>)}
              </div>}
              <p className="text-[11px] leading-5 text-slate-500 dark:text-zinc-400">组合的新增、更新和删除会随底部“保存配置”一起保存。</p>
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">默认主题</h3>
              <div className="grid grid-cols-2 gap-3">{(["light", "dark"] as const).map((mode) => <label key={mode} className="min-w-0 space-y-2">
                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400">{mode === "light" ? <Sun className="size-4 text-amber-500" /> : <Moon className="size-4 text-blue-400" />}{mode === "light" ? "浅色模式" : "深色模式"}</span>
                <ThemeSelect label={`${mode === "light" ? "浅色" : "深色"}默认主题`} mode={mode} value={draft[mode]} disabled={saving} onChange={(theme) => setDraft({ ...draft, [mode]: theme as MermaidThemeId })} />
              </label>)}</div>
            </section>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">按图表类型设置</h3><button className="text-xs text-[var(--app-primary)] disabled:opacity-40" type="button" disabled={saving || !Object.keys(draft.diagrams).length} onClick={() => setDraft({ ...draft, diagrams: {} })}>清除单独设置</button></div>
              <div className="max-h-[340px] overflow-auto rounded-lg border border-slate-200 dark:border-zinc-700">
                <table className="w-full table-fixed text-xs"><thead className="sticky top-0 z-10 bg-slate-100 text-left text-slate-500 dark:bg-zinc-800 dark:text-zinc-400"><tr><th className="w-[26%] p-2 font-medium">图表类型</th><th className="w-[37%] p-2 font-medium">浅色主题</th><th className="p-2 font-medium">深色主题</th></tr></thead>
                  <tbody>{MERMAID_DIAGRAM_TYPES.map((type) => <tr key={type.id} className="border-t border-slate-200 dark:border-zinc-700">
                    <th className="p-2 text-left font-normal"><button type="button" className="text-left hover:underline" onClick={() => setPreviewType(type.id)}>{type.label}{draft.diagrams[type.id] && <span className="ml-1 text-blue-500" aria-label="已单独设置">●</span>}</button></th>
                    {(["light", "dark"] as const).map((mode) => <td key={mode} className="p-1.5"><ThemeSelect label={`${type.label}${mode === "light" ? "浅色" : "深色"}主题`} mode={mode} value={draft.diagrams[type.id]?.[mode] ?? "inherit"} inherit="跟随全局" disabled={saving} onChange={(theme) => setOverride(type.id, mode, theme)} /></td>)}
                  </tr>)}</tbody>
                </table>
              </div>
            </section>
          </div>
          <div className="min-w-0 space-y-3 border-t border-slate-200 p-5 dark:border-zinc-700 lg:border-t-0">
            <div className="flex items-center justify-between gap-3"><h3 className="shrink-0 text-sm font-semibold">实时预览</h3><Select value={previewType} onValueChange={setPreviewType}><SelectTrigger className={`${selectClass} max-w-40`} aria-label="预览图表类型" data-value={previewType}><SelectValue /></SelectTrigger><SelectContent className={contentClass}><SelectGroup><SelectLabel className="px-2 py-2 text-[11px] text-slate-500 dark:text-zinc-400">选择预览图表</SelectLabel>{MERMAID_DIAGRAM_TYPES.map((type) => <SelectItem className={itemClass} key={type.id} value={type.id} data-value={type.id}>{type.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">修改配置后即时更新，预览使用 Mermaid 实际渲染。</p>
            {open && <div className="grid grid-cols-2 gap-2"><ThemePreview type={previewType} dark={false} settings={draft} /><ThemePreview type={previewType} dark settings={draft} /></div>}
            <p className="text-xs text-slate-500 dark:text-zinc-400">当前{MERMAID_DIAGRAM_TYPES.find((type) => type.id === previewType)?.label}：{draft.diagrams[previewType] ? "已单独设置主题" : "跟随全局默认主题"}</p>
            <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400"><Info className="mt-1 size-4 shrink-0" /><p>Word 预览和导出均使用对应的浅色主题。<br />源码内的主题及手动配色优先保留；低对比文字和连线仍会进行可读性修正。</p></div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 dark:border-zinc-700">
        <span className="text-xs text-slate-500 dark:text-zinc-400">仅影响 Mermaid 图表</span><div className="flex gap-2"><Button variant="ghost" disabled={saving} onClick={() => setDraft(normalizeMermaidThemes({ presets: draft.presets }))}>恢复默认</Button><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存配置"}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
