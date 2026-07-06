import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowLeft, ChevronDown, Code2, Heading, ListTree, Pilcrow, Quote, Search, SlidersHorizontal, Table2, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode, type WheelEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WordColorPicker } from "@/components/ui/word-color-picker";
import { WordFontSizeSelect } from "@/components/ui/word-font-size-select";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { borderStyleOptions, createDefaultStyleDraft, createDefaultTemplateStyleConfig, getDefaultNumberFormat, markdownMappings, mergeTemplateStyleConfig, numberFormatOptions, styleGroupLabels, styleNodes, tablePresets } from "@/lib/style-manager-data";
import { getTemplateStyleConfig, resetTemplateStyleConfig, saveTemplateStyleConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { HorizontalAlign, MarkdownFeatureSettings, PageSettingsDraft, StyleDraft, StyleGroupKey, StyleNode, Template, TemplateStyleConfig, VerticalAlign } from "@/types";

type TemplateStyleManagerProps = {
  open?: boolean;
  template?: Template;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onRequestClose?: () => void;
};

const editorTabs = [
  { id: "styles", label: "样式设计" },
  { id: "page", label: "页面设置" },
  { id: "mapping", label: "样式映射" },
];

const styleGroupIcons: Record<StyleGroupKey, LucideIcon> = {
  headings: Heading,
  blocks: Pilcrow,
  lists: ListTree,
  tables: Table2,
};

const fontWeightOptions = [
  { value: "300", label: "300 Light" },
  { value: "400", label: "400 常规" },
  { value: "500", label: "500 中等" },
  { value: "600", label: "600 半粗" },
  { value: "700", label: "700 加粗" },
  { value: "800", label: "800 特粗" },
];

const paperSizeOptions: Array<{ value: PageSettingsDraft["paperSize"]; label: string; description: string }> = [
  { value: "A3", label: "A3", description: "29.7 x 42 cm" },
  { value: "A4", label: "A4", description: "21 x 29.7 cm" },
  { value: "A5", label: "A5", description: "14.8 x 21 cm" },
  { value: "A6", label: "A6", description: "10.5 x 14.8 cm" },
  { value: "B4", label: "B4", description: "25 x 35.3 cm" },
  { value: "B5", label: "B5", description: "17.6 x 25 cm" },
  { value: "B6", label: "B6", description: "12.5 x 17.6 cm" },
  { value: "K16", label: "16K", description: "18.4 x 26 cm" },
  { value: "K32", label: "32K", description: "13 x 18.4 cm" },
  { value: "Letter", label: "Letter", description: "8.5 x 11 in" },
  { value: "Legal", label: "Legal", description: "8.5 x 14 in" },
  { value: "Executive", label: "Executive", description: "7.25 x 10.5 in" },
  { value: "Tabloid", label: "Tabloid", description: "11 x 17 in" },
];

const footerPageNumberFormats: Array<{ value: PageSettingsDraft["footerPageNumberFormat"]; label: string }> = [
  { value: "page", label: "第 1 页" },
  { value: "page-total", label: "第 1 / 12 页" },
  { value: "dash", label: "- 1 -" },
  { value: "none", label: "不显示页码" },
];

function getStyleNodeIcon(node: StyleNode) {
  if (node.id === "quote") return Quote;
  if (node.kind === "code") return Code2;
  if (node.kind === "heading") return Heading;
  if (node.kind === "list") return ListTree;
  if (node.kind === "table") return Table2;
  return Pilcrow;
}

export function TemplateStyleManager({ open = true, template, embedded = false, onDirtyChange, onOpenChange, onRequestClose }: TemplateStyleManagerProps) {
  const [activeTab, setActiveTab] = useState("styles");
  const [query, setQuery] = useState("");
  const [activeStyleId, setActiveStyleId] = useState("heading-2");
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(() => createDefaultTemplateStyleConfig(template?.id ?? "default-report"));
  const [savedConfig, setSavedConfig] = useState<TemplateStyleConfig>(() => createDefaultTemplateStyleConfig(template?.id ?? "default-report"));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(60);

  const selectedStyle = styleNodes.find((node) => node.id === activeStyleId) ?? styleNodes[1];
  const currentDraft = styleConfig.styles[activeStyleId] ?? createDefaultStyleDraft(activeStyleId);
  const hasChanges = JSON.stringify(styleConfig) !== JSON.stringify(savedConfig);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const filteredNodes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return styleNodes;
    return styleNodes.filter((node) => [node.name, node.displayName, node.markdown, node.description].join(" ").toLowerCase().includes(keyword));
  }, [query]);

  function groupedNodes(group: StyleGroupKey) {
    return filteredNodes.filter((node) => node.group === group);
  }

  useEffect(() => {
    if (!open) return;
    const templateId = template?.id ?? "default-report";
    let cancelled = false;
    setIsLoading(true);
    void getTemplateStyleConfig(templateId)
      .then((stored) => {
        if (cancelled) return;
        const nextConfig = mergeTemplateStyleConfig(templateId, stored ?? undefined);
        setStyleConfig(nextConfig);
        setSavedConfig(nextConfig);
      })
      .catch((error) => {
        const fallback = createDefaultTemplateStyleConfig(templateId);
        setStyleConfig(fallback);
        setSavedConfig(fallback);
        toast.error(error instanceof Error ? error.message : typeof error === "string" ? error : "加载模板样式失败，已使用默认样式");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, template?.id]);

  function updateDraft<K extends keyof StyleDraft>(key: K, value: StyleDraft[K]) {
    setStyleConfig((current) => ({
      ...current,
      styles: {
        ...current.styles,
        [activeStyleId]: { ...(current.styles[activeStyleId] ?? createDefaultStyleDraft(activeStyleId)), [key]: value, styleId: activeStyleId },
      },
      updatedAt: new Date().toISOString(),
    }));
  }

  function patchDraft(patch: Partial<StyleDraft>) {
    setStyleConfig((current) => ({
      ...current,
      styles: {
        ...current.styles,
        [activeStyleId]: { ...(current.styles[activeStyleId] ?? createDefaultStyleDraft(activeStyleId)), ...patch, styleId: activeStyleId },
      },
      updatedAt: new Date().toISOString(),
    }));
  }

  function patchPageSettings(patch: Partial<PageSettingsDraft>) {
    setStyleConfig((current) => ({
      ...current,
      pageSettings: { ...current.pageSettings, ...patch },
      updatedAt: new Date().toISOString(),
    }));
  }

  function patchMarkdownFeatures(patch: Partial<MarkdownFeatureSettings>) {
    setStyleConfig((current) => ({
      ...current,
      markdownFeatures: { ...current.markdownFeatures, ...patch },
      updatedAt: new Date().toISOString(),
    }));
  }

  function resetCurrentStyle() {
    setStyleConfig((current) => ({
      ...current,
      styles: { ...current.styles, [activeStyleId]: createDefaultStyleDraft(activeStyleId) },
      updatedAt: new Date().toISOString(),
    }));
    toast.info("已重置当前样式为默认值");
  }

  async function handleSaveStyleConfig() {
    setIsSaving(true);
    try {
      const saved = await saveTemplateStyleConfig({ ...styleConfig, updatedAt: new Date().toISOString() });
      const nextConfig = mergeTemplateStyleConfig(styleConfig.templateId, saved);
      setStyleConfig(nextConfig);
      setSavedConfig(nextConfig);
      toast.success("模板样式已保存，下次打开和导出时会使用当前配置。");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : typeof error === "string" ? error : "保存模板样式失败");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetTemplateStyleConfig() {
    const templateId = template?.id ?? styleConfig.templateId;
    setIsSaving(true);
    try {
      await resetTemplateStyleConfig(templateId);
      const nextConfig = createDefaultTemplateStyleConfig(templateId);
      setStyleConfig(nextConfig);
      setSavedConfig(nextConfig);
      toast.success(template?.isBuiltIn ? "系统模板已恢复为内置默认样式" : "模板样式已恢复为默认样式");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : typeof error === "string" ? error : "重置模板样式失败");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  function closeEditor() {
    onRequestClose?.();
    onOpenChange?.(false);
  }

  function requestCloseEditor() {
    if (hasChanges) {
      setConfirmCloseOpen(true);
      return;
    }

    closeEditor();
  }

  async function saveAndCloseEditor() {
    const saved = await handleSaveStyleConfig();
    if (!saved) return;
    setConfirmCloseOpen(false);
    closeEditor();
  }

  function discardAndCloseEditor() {
    setStyleConfig(savedConfig);
    setConfirmCloseOpen(false);
    closeEditor();
  }

  function renderEditorContent() {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-white">
        <header className="shrink-0 border-b border-slate-200 px-5 py-3 xl:px-7 xl:py-4">
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600">
                {embedded ? <ArrowLeft className="size-3.5" /> : null}
                模板样式管理
              </div>
              {embedded ? (
                <>
                  <h2 className="mt-1.5 truncate text-[22px] font-bold tracking-[-0.03em] text-slate-950 xl:text-2xl">样式编辑：{template?.name ?? "技术文档模板"}</h2>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    {template?.isBuiltIn ? "系统模板 · 可修改 · 可随时重置为内置默认" : "自定义模板 · 样式会保存到本机模板配置"}
                  </p>
                </>
              ) : (
                <>
                  <DialogTitle className="mt-1.5 truncate text-[22px] font-bold tracking-[-0.03em] text-slate-950 xl:text-2xl">样式编辑：{template?.name ?? "技术文档模板"}</DialogTitle>
                  <DialogDescription className="mt-1 text-sm leading-5 text-slate-500">
                    {template?.isBuiltIn ? "系统模板 · 可修改 · 可随时重置为内置默认" : "自定义模板 · 样式会保存到本机模板配置"}
                  </DialogDescription>
                </>
              )}
            </div>
            <SoftActionButton className="h-10 shrink-0 rounded-full border-slate-200 bg-white text-slate-500 hover:text-slate-800" onClick={requestCloseEditor}>
              {embedded ? <ArrowLeft className="size-4" /> : <X className="size-4" />}
              {embedded ? "返回模板中心" : "关闭"}
            </SoftActionButton>
          </div>
        </header>

        <nav className="flex h-12 shrink-0 items-end gap-6 overflow-x-auto border-b border-slate-200 px-5 xl:px-7">
          {editorTabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "relative flex h-full shrink-0 items-center gap-1.5 border-b-2 border-transparent text-sm font-semibold text-slate-500 transition hover:text-slate-950",
                activeTab === tab.id && "border-indigo-600 text-indigo-700",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50/50">
          {activeTab === "styles" ? (
            <div className="grid h-full min-h-0 w-full overflow-y-auto lg:grid-cols-[160px_minmax(300px,1fr)_minmax(300px,360px)] lg:overflow-x-hidden lg:overflow-y-hidden xl:grid-cols-[180px_minmax(360px,1fr)_minmax(320px,420px)] 2xl:grid-cols-[230px_minmax(620px,1fr)_minmax(460px,540px)]">
              <StyleNavigation query={query} setQuery={setQuery} groupedNodes={groupedNodes} activeStyleId={activeStyleId} setActiveStyleId={setActiveStyleId} />
              <StyleProperties selectedStyle={selectedStyle} draft={currentDraft} markdownFeatures={styleConfig.markdownFeatures} updateDraft={updateDraft} patchDraft={patchDraft} patchMarkdownFeatures={patchMarkdownFeatures} isLoading={isLoading} />
              <PreviewColumn selectedStyle={selectedStyle} styleConfig={styleConfig} zoom={zoom} setZoom={setZoom} />
            </div>
          ) : null}
          {activeTab === "page" ? <TabScrollArea><PageSettingsPanel pageSettings={styleConfig.pageSettings} patchPageSettings={patchPageSettings} /></TabScrollArea> : null}
          {activeTab === "mapping" ? <TabScrollArea><MappingPanel markdownFeatures={styleConfig.markdownFeatures} patchMarkdownFeatures={patchMarkdownFeatures} /></TabScrollArea> : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/96 px-5 py-2.5 xl:gap-4 xl:px-7">
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", hasChanges ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{hasChanges ? "有未保存更改" : "已保存"}</span>
          <Button variant="ghost" className="text-slate-500" onClick={resetCurrentStyle} disabled={isSaving || isLoading}>重置当前样式</Button>
          <SoftActionButton className="h-9 rounded-[10px]" onClick={handleResetTemplateStyleConfig} disabled={isSaving || isLoading}>重置模板</SoftActionButton>
          <PrimaryActionButton className="h-9 rounded-[10px] px-5 font-semibold" onClick={() => void handleSaveStyleConfig()} disabled={isSaving || isLoading || !hasChanges}>{isSaving ? "保存中..." : "保存模板样式"}</PrimaryActionButton>
        </footer>
      </div>
    );
  }

  function renderConfirmDialog() {
    return (
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>样式修改还没保存</DialogTitle>
            <DialogDescription>返回或关闭前，你可以先保存当前模板样式，也可以放弃这次修改。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmCloseOpen(false)}>继续编辑</Button>
            <SoftActionButton onClick={discardAndCloseEditor}>不保存</SoftActionButton>
            <PrimaryActionButton onClick={() => void saveAndCloseEditor()} disabled={isSaving}>{isSaving ? "保存中..." : "保存并返回"}</PrimaryActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (embedded) {
    return (
      <AppSurface className="flex h-full min-h-0 min-w-0 w-full overflow-hidden max-lg:h-auto max-lg:overflow-visible" padding="none" radius="md">
        {renderEditorContent()}
        {renderConfirmDialog()}
      </AppSurface>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange?.(true) : requestCloseEditor())}>
      <DialogContent
        className="left-auto right-0 top-0 bottom-0 flex h-dvh max-h-dvh w-[min(1240px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 overflow-hidden rounded-none border-l-2 border-indigo-500/70 bg-white p-0 shadow-2xl shadow-slate-900/25 sm:max-w-[min(1240px,calc(100vw-1rem))]"
        showCloseButton={false}
      >
        {renderEditorContent()}
      </DialogContent>
      {renderConfirmDialog()}
    </Dialog>
  );
}

function StyleNavigation({
  query,
  setQuery,
  groupedNodes,
  activeStyleId,
  setActiveStyleId,
}: {
  query: string;
  setQuery: (value: string) => void;
  groupedNodes: (group: StyleGroupKey) => StyleNode[];
  activeStyleId: string;
  setActiveStyleId: (id: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<StyleGroupKey[]>([]);

  function toggleGroup(group: StyleGroupKey) {
    setCollapsedGroups((current) => (current.includes(group) ? current.filter((item) => item !== group) : [...current, group]));
  }

  return (
    <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-white max-lg:order-2 max-lg:max-h-[220px] max-lg:border-b max-lg:border-r-0">
      <div className="border-b border-slate-200 p-3.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-10 rounded-lg border-slate-200 bg-slate-50 pl-10" placeholder="搜索样式..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      <div className="h-[calc(100%-69px)] overflow-auto px-3.5 py-3">
        {(Object.keys(styleGroupLabels) as StyleGroupKey[]).map((group) => {
          const nodes = groupedNodes(group);
          if (nodes.length === 0) return null;
          const collapsed = collapsedGroups.includes(group) && query.trim() === "";
          const groupActive = nodes.some((node) => node.id === activeStyleId);
          const GroupIcon = styleGroupIcons[group];
          return (
            <section key={group} className="mb-3">
              <button
                type="button"
                className={cn(
                  "mb-1.5 flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition",
                  groupActive
                    ? "border-slate-200 bg-slate-50 text-slate-950 shadow-sm"
                    : "border-transparent text-slate-950 hover:border-slate-200 hover:bg-slate-50",
                )}
                onClick={() => toggleGroup(group)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ChevronDown className={cn("size-3.5 shrink-0 text-slate-500 transition-transform", collapsed && "-rotate-90")} />
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border bg-white", groupActive ? "border-indigo-100 text-indigo-600" : "border-slate-200 text-slate-500")}>
                    <GroupIcon className="size-4" />
                  </span>
                  <span className="truncate text-sm font-bold">{styleGroupLabels[group]}</span>
                </span>
                <span className={cn("ml-2 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", groupActive ? "bg-white text-slate-700" : "bg-slate-100 text-slate-500")}>{nodes.length}</span>
              </button>
              {!collapsed ? (
                <div className="ml-4 space-y-1 border-l border-slate-200 pl-3">
                  {nodes.map((node) => (
                    <StyleNavigationItem key={node.id} node={node} active={activeStyleId === node.id} onSelect={() => setActiveStyleId(node.id)} />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function StyleNavigationItem({ node, active, onSelect }: { node: StyleNode; active: boolean; onSelect: () => void }) {
  const NodeIcon = getStyleNodeIcon(node);

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
        active ? "bg-indigo-50 font-semibold text-indigo-700 shadow-[inset_2px_0_0_rgb(79_70_229)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
      )}
      onClick={onSelect}
      title={`${node.displayName} · ${node.name} · ${node.markdown}`}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", node.kind === "heading" && "font-bold", node.kind === "code" && "font-mono", node.kind === "paragraph" && "font-normal")}>{node.displayName}</span>
        <span className="block truncate text-[11px] font-normal text-slate-400">{node.name}</span>
      </span>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border", active ? "border-indigo-100 bg-white text-indigo-600" : "border-slate-200 bg-white/70 text-slate-400")}>
        <NodeIcon className="size-3.5" />
      </span>
    </button>
  );
}

function StyleProperties({
  selectedStyle,
  draft,
  markdownFeatures,
  updateDraft,
  patchDraft,
  patchMarkdownFeatures,
  isLoading,
}: {
  selectedStyle: StyleNode;
  draft: StyleDraft;
  markdownFeatures: MarkdownFeatureSettings;
  updateDraft: <K extends keyof StyleDraft>(key: K, value: StyleDraft[K]) => void;
  patchDraft: (patch: Partial<StyleDraft>) => void;
  patchMarkdownFeatures: (patch: Partial<MarkdownFeatureSettings>) => void;
  isLoading: boolean;
}) {
  const isHeading = selectedStyle.kind === "heading";
  const isCode = selectedStyle.kind === "code";
  const isTableNode = selectedStyle.kind === "table";
  const isTableRoot = selectedStyle.id === "table";
  const isTableHeader = selectedStyle.id === "table-header";
  const isTableBody = selectedStyle.id === "table-body";
  const isTableCaption = selectedStyle.id === "table-caption";

  function handleAutoNumberingChange(checked: boolean) {
    if (isHeading) {
      patchDraft({ autoNumbering: checked, numberFormat: checked ? getDefaultNumberFormat(draft.styleId) : "无编号" });
      return;
    }

    updateDraft("autoNumbering", checked);
  }

  function handleNumberFormatChange(value: string) {
    patchDraft({ numberFormat: value, autoNumbering: value !== "无编号" });
  }

  function applyHeadingLevelNumbering() {
    patchDraft({ autoNumbering: true, numberFormat: getDefaultNumberFormat(draft.styleId) });
  }

  return (
    <section className="min-h-0 overflow-auto border-r border-slate-200 bg-white px-5 py-5 max-lg:order-3 max-lg:overflow-visible max-lg:border-b max-lg:border-r-0">
      <div className="mb-5">
        <p className="text-sm font-bold text-indigo-600">当前样式</p>
        <h3 className="mt-1.5 text-[26px] font-bold tracking-[-0.03em] text-slate-950">{selectedStyle.displayName}</h3>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">{selectedStyle.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">Word 样式：{selectedStyle.name}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">Markdown 标记：{selectedStyle.markdown}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">{isLoading ? "加载中" : "可编辑"}</span>
        </div>
      </div>

      <div className="space-y-4">
        <MarkdownFeatureStyleSwitch selectedStyleId={selectedStyle.id} markdownFeatures={markdownFeatures} patchMarkdownFeatures={patchMarkdownFeatures} />

        {!isTableRoot ? <PropertyCard title={isCode ? "代码块样式" : isTableNode ? "基础文本样式" : "文本属性"}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="中文字体"><Select value={draft.chineseFont} onValueChange={(value) => updateDraft("chineseFont", value)}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="微软雅黑">微软雅黑</SelectItem><SelectItem value="宋体">宋体</SelectItem><SelectItem value="思源黑体">思源黑体</SelectItem><SelectItem value="仿宋">仿宋</SelectItem></SelectContent></Select></Field>
            <Field label="英文字体"><Select value={isCode ? "JetBrains Mono" : draft.latinFont} onValueChange={(value) => updateDraft("latinFont", value)}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Times New Roman">Times New Roman</SelectItem><SelectItem value="Inter">Inter</SelectItem><SelectItem value="Arial">Arial</SelectItem><SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem></SelectContent></Select></Field>
            {(!isTableNode || isTableCaption) ? <Field label="字号"><WordFontSizeSelect value={draft.fontSize} onChange={(value) => updateDraft("fontSize", value)} /></Field> : null}
            <Field label="文字颜色"><WordColorPicker value={draft.color} onChange={(value) => updateDraft("color", value)} autoColor="#111827" /></Field>
          </div>
          {(!isTableNode || isTableCaption) ? <div className="mt-4 grid gap-3 md:grid-cols-[120px_minmax(0,1fr)]">
            <Button
              className={cn(
                "h-11 rounded-lg font-bold",
                Number(draft.fontWeight) >= 700 ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white",
              )}
              variant={Number(draft.fontWeight) >= 700 ? "ghost" : "outline"}
              aria-pressed={Number(draft.fontWeight) >= 700}
              onClick={() => updateDraft("fontWeight", Number(draft.fontWeight) >= 700 ? "400" : "700")}
            >
              B 加粗
            </Button>
            <Field label="字重">
              <Select value={draft.fontWeight} onValueChange={(value) => updateDraft("fontWeight", value)}>
                <SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fontWeightOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div> : null}
        </PropertyCard> : null}

        {(!isTableNode || isTableCaption) ? <PropertyCard title="段落与间距">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="行高"><Input className="h-11 rounded-lg bg-slate-50" value={draft.lineHeight} onChange={(event) => updateDraft("lineHeight", event.target.value)} /></Field>
            <Field label="首行缩进 (字符)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={4} step={0.5} value={draft.firstLineIndent} onChange={(event) => updateDraft("firstLineIndent", Number(event.target.value))} /></Field>
            <Field label="对齐方式"><AlignButtonGroup value={draft.align} onChange={(value) => updateDraft("align", value)} /></Field>
            <Field label="段前间距 (pt)"><Input className="h-11 rounded-lg bg-slate-50" type="number" value={draft.beforeSpacing} onChange={(event) => updateDraft("beforeSpacing", Number(event.target.value))} /></Field>
            <Field label="段后间距 (pt)"><Input className="h-11 rounded-lg bg-slate-50" type="number" value={draft.afterSpacing} onChange={(event) => updateDraft("afterSpacing", Number(event.target.value))} /></Field>
          </div>
        </PropertyCard> : null}

        {isTableNode ? (
          <>
            {isTableRoot ? (
            <>
            <PropertyCard title="表格预设">
              <div className="grid gap-3 md:grid-cols-2">
                {tablePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={cn(
                      "rounded-xl border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50",
                      draft.tablePreset === preset.key ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-slate-50",
                    )}
                    onClick={() => patchDraft(preset.patch)}
                  >
                    <div className="text-sm font-semibold text-slate-950">{preset.label}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{preset.description}</p>
                  </button>
                ))}
              </div>
            </PropertyCard>

            <PropertyCard title="表格布局">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="表格布局模式"><Select value={draft.tableLayout} onValueChange={(value) => updateDraft("tableLayout", value as StyleDraft["tableLayout"])}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">自动适配内容</SelectItem><SelectItem value="fixed">固定列宽</SelectItem></SelectContent></Select></Field>
                <Field label="整体水平对齐"><SimpleAlignSelect value={draft.tableHorizontalAlign} onChange={(value) => updateDraft("tableHorizontalAlign", value)} /></Field>
                <SettingSwitch label="根据窗口自动铺满表格" checked={draft.fitToPageWidth} onCheckedChange={(checked) => updateDraft("fitToPageWidth", checked)} />
                <SettingSwitch label="隔行底色" checked={draft.rowStripe} onCheckedChange={(checked) => updateDraft("rowStripe", checked)} />
                <Field label="表格宽度 (%)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={40} max={100} value={draft.tableWidthPercent} onChange={(event) => updateDraft("tableWidthPercent", Number(event.target.value))} /></Field>
                <Field label="单元格垂直对齐"><VerticalAlignSelect value={draft.cellVerticalAlign} onChange={(value) => updateDraft("cellVerticalAlign", value)} /></Field>
                <Field label="列宽模式"><Select value={draft.columnWidthMode} onValueChange={(value) => updateDraft("columnWidthMode", value as StyleDraft["columnWidthMode"])}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">自动分配</SelectItem><SelectItem value="custom">自定义百分比</SelectItem></SelectContent></Select></Field>
                <Field label="第一列宽度 (%)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.firstColumnWidth} onChange={(event) => updateDraft("firstColumnWidth", Number(event.target.value))} /></Field>
                <Field label="第二列宽度 (%)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.secondColumnWidth} onChange={(event) => updateDraft("secondColumnWidth", Number(event.target.value))} /></Field>
                <Field label="第三列宽度 (%)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.thirdColumnWidth} onChange={(event) => updateDraft("thirdColumnWidth", Number(event.target.value))} /></Field>
                <Field label="最小行高 (px)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={18} max={80} value={draft.minRowHeight} onChange={(event) => updateDraft("minRowHeight", Number(event.target.value))} /></Field>
                <SettingSwitch label="单元格自动换行" checked={draft.cellWrap} onCheckedChange={(checked) => updateDraft("cellWrap", checked)} />
                <Field label="单元格左右内边距"><Input className="h-11 rounded-lg bg-slate-50" type="number" value={draft.cellPaddingX} onChange={(event) => updateDraft("cellPaddingX", Number(event.target.value))} /></Field>
                <Field label="单元格上下内边距"><Input className="h-11 rounded-lg bg-slate-50" type="number" value={draft.cellPaddingY} onChange={(event) => updateDraft("cellPaddingY", Number(event.target.value))} /></Field>
              </div>
            </PropertyCard>

            <PropertyCard title="边框与网格线">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="边框线样式"><Select value={draft.borderStyle} onValueChange={(value) => updateDraft("borderStyle", value as StyleDraft["borderStyle"])}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent>{borderStyleOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="边框粗细 (px)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={6} step={0.5} value={draft.borderWidth} onChange={(event) => updateDraft("borderWidth", Number(event.target.value))} /></Field>
                <Field label="边框颜色"><WordColorPicker value={draft.borderColor} onChange={(value) => updateDraft("borderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="上边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.borderTopWidth} onChange={(event) => updateDraft("borderTopWidth", Number(event.target.value))} /></Field>
                <Field label="右边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.borderRightWidth} onChange={(event) => updateDraft("borderRightWidth", Number(event.target.value))} /></Field>
                <Field label="下边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.borderBottomWidth} onChange={(event) => updateDraft("borderBottomWidth", Number(event.target.value))} /></Field>
                <Field label="左边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.borderLeftWidth} onChange={(event) => updateDraft("borderLeftWidth", Number(event.target.value))} /></Field>
                <Field label="表头边框颜色"><WordColorPicker value={draft.headerBorderColor} onChange={(value) => updateDraft("headerBorderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="表头边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.headerBorderWidth} onChange={(event) => updateDraft("headerBorderWidth", Number(event.target.value))} /></Field>
                <Field label="表体边框颜色"><WordColorPicker value={draft.bodyBorderColor} onChange={(value) => updateDraft("bodyBorderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="表体边框粗细"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0} max={8} step={0.5} value={draft.bodyBorderWidth} onChange={(event) => updateDraft("bodyBorderWidth", Number(event.target.value))} /></Field>
                <SettingSwitch label="外边框加粗" checked={draft.outerBorderStrong} onCheckedChange={(checked) => updateDraft("outerBorderStrong", checked)} />
                <SettingSwitch label="显示内竖线" checked={draft.showInnerVerticalBorder} onCheckedChange={(checked) => updateDraft("showInnerVerticalBorder", checked)} />
                <SettingSwitch label="显示内横线" checked={draft.showInnerHorizontalBorder} onCheckedChange={(checked) => updateDraft("showInnerHorizontalBorder", checked)} />
              </div>
            </PropertyCard>
            </>
            ) : null}

            {isTableHeader ? (
              <PropertyCard title="表头样式">
                <div className="grid gap-4 md:grid-cols-2">
                  <SettingSwitch label="表头加粗" checked={draft.headerBold} onCheckedChange={(checked) => updateDraft("headerBold", checked)} />
                  <Field label="表头水平对齐"><SimpleAlignSelect value={draft.headerAlign} onChange={(value) => updateDraft("headerAlign", value)} /></Field>
                  <Field label="表头垂直对齐"><VerticalAlignSelect value={draft.headerVerticalAlign} onChange={(value) => updateDraft("headerVerticalAlign", value)} /></Field>
                  <Field label="表头字号"><WordFontSizeSelect value={draft.headerFontSize} onChange={(value) => updateDraft("headerFontSize", value)} /></Field>
                  <Field label="表头行高"><Input className="h-11 rounded-lg bg-slate-50" value={draft.headerLineHeight} onChange={(event) => updateDraft("headerLineHeight", event.target.value)} /></Field>
                  <Field label="表头背景色"><WordColorPicker value={draft.headerBackgroundColor} onChange={(value) => updateDraft("headerBackgroundColor", value)} autoColor="#EEF2FF" /></Field>
                </div>
              </PropertyCard>
            ) : null}

            {isTableBody ? (
              <PropertyCard title="表格体样式">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="表格体水平对齐"><SimpleAlignSelect value={draft.bodyAlign} onChange={(value) => updateDraft("bodyAlign", value)} /></Field>
                  <Field label="表格体垂直对齐"><VerticalAlignSelect value={draft.bodyVerticalAlign} onChange={(value) => updateDraft("bodyVerticalAlign", value)} /></Field>
                  <Field label="表格体字号"><WordFontSizeSelect value={draft.bodyFontSize} onChange={(value) => updateDraft("bodyFontSize", value)} /></Field>
                  <Field label="表格体行高"><Input className="h-11 rounded-lg bg-slate-50" value={draft.bodyLineHeight} onChange={(event) => updateDraft("bodyLineHeight", event.target.value)} /></Field>
                  <Field label="表格体底色"><WordColorPicker value={draft.bodyBackgroundColor} onChange={(value) => updateDraft("bodyBackgroundColor", value)} autoColor="#FFFFFF" /></Field>
                </div>
              </PropertyCard>
            ) : null}

            {isTableCaption ? (
              <PropertyCard title="表格题注样式">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="题注对齐"><SimpleAlignSelect value={draft.captionAlign} onChange={(value) => updateDraft("captionAlign", value)} /></Field>
                  <SettingSwitch label="题注自动编号" checked={draft.captionNumbering} onCheckedChange={(checked) => updateDraft("captionNumbering", checked)} />
                </div>
              </PropertyCard>
            ) : null}
          </>
        ) : null}

        {isHeading || selectedStyle.kind === "list" ? (
          <PropertyCard title="编号与层级">
            <SettingSwitch label="自动编号" checked={draft.autoNumbering} onCheckedChange={handleAutoNumberingChange} />
            <Field label="编号格式"><Select value={draft.numberFormat} onValueChange={handleNumberFormatChange}><SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger><SelectContent>{numberFormatOptions.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}</SelectContent></Select></Field>
            {isHeading ? (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">
                当前标题建议编号：<span className="font-semibold">{getDefaultNumberFormat(draft.styleId)}</span>
                {draft.numberFormat !== getDefaultNumberFormat(draft.styleId) ? <Button type="button" variant="link" className="ml-1 h-auto p-0 text-xs font-semibold text-indigo-700" onClick={applyHeadingLevelNumbering}>恢复层级编号</Button> : null}
              </div>
            ) : null}
          </PropertyCard>
        ) : null}
      </div>
    </section>
  );
}

function MarkdownFeatureStyleSwitch({
  selectedStyleId,
  markdownFeatures,
  patchMarkdownFeatures,
}: {
  selectedStyleId: string;
  markdownFeatures: MarkdownFeatureSettings;
  patchMarkdownFeatures: (patch: Partial<MarkdownFeatureSettings>) => void;
}) {
  if (selectedStyleId === "source-code") {
    return (
      <PropertyCard title="代码块映射">
        <SettingSwitch label="启用代码块样式" checked={markdownFeatures.codeBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ codeBlock: checked })} />
      </PropertyCard>
    );
  }

  if (selectedStyleId === "quote") {
    return (
      <PropertyCard title="引用块映射">
        <SettingSwitch label="启用引用块样式" checked={markdownFeatures.quoteBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ quoteBlock: checked })} />
      </PropertyCard>
    );
  }

  if (selectedStyleId === "inline-code") {
    return (
      <PropertyCard title="行内代码映射">
        <SettingSwitch label="启用行内代码样式" checked={markdownFeatures.inlineCode} onCheckedChange={(checked) => patchMarkdownFeatures({ inlineCode: checked })} />
      </PropertyCard>
    );
  }

  return null;
}

const previewZoomMin = 40;
const previewZoomMax = 200;
const previewZoomStep = 10;

function clampPreviewZoom(value: number) {
  return Math.min(previewZoomMax, Math.max(previewZoomMin, value));
}

function formatPaperPreviewLabel(pageSettings: PageSettingsDraft) {
  const paper = paperSizeOptions.find((option) => option.value === pageSettings.paperSize);
  const orientation = pageSettings.orientation === "landscape" ? "横向" : "纵向";
  return `${paper?.label ?? pageSettings.paperSize} · ${orientation}`;
}

function PreviewColumn({ selectedStyle, styleConfig, zoom, setZoom }: { selectedStyle: StyleNode; styleConfig: TemplateStyleConfig; zoom: number; setZoom: (value: number | ((current: number) => number)) => void }) {
  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((value) => clampPreviewZoom(value + direction * previewZoomStep));
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden bg-slate-50/80 px-4 py-4 max-lg:order-1 max-lg:min-h-[430px] max-lg:border-b max-lg:border-slate-200">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <p className="text-sm font-semibold text-slate-400">实时预览（{formatPaperPreviewLabel(styleConfig.pageSettings)}）</p>
        <div className="flex shrink-0 items-center gap-3 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
          <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value - previewZoomStep))} disabled={zoom <= previewZoomMin} title="缩小预览" aria-label="缩小预览"><ZoomOut className="size-4 text-slate-500" /></Button>
          <span className="w-10 text-center text-xs font-bold text-slate-500">{zoom}%</span>
          <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value + previewZoomStep))} disabled={zoom >= previewZoomMax} title="放大预览" aria-label="放大预览"><ZoomIn className="size-4 text-slate-500" /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1" onWheel={handlePreviewWheel}>
        <WordPreviewPage selectedStyle={selectedStyle} styleConfig={styleConfig} zoom={zoom} badgeText={`当前：${selectedStyle.displayName}`} interactiveViewport />
      </div>
    </aside>
  );
}

function AlignButtonGroup({ value, onChange }: { value: HorizontalAlign; onChange: (value: HorizontalAlign) => void }) {
  const options: Array<{ value: HorizontalAlign; label: string; icon: LucideIcon }> = [
    { value: "left", label: "左对齐", icon: AlignLeft },
    { value: "center", label: "居中对齐", icon: AlignCenter },
    { value: "right", label: "右对齐", icon: AlignRight },
    { value: "justify", label: "两端对齐", icon: AlignJustify },
  ];

  return (
    <div className="grid h-11 grid-cols-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          className={cn("flex items-center justify-center border-r border-slate-200 last:border-r-0", value === optionValue ? "bg-indigo-100 text-indigo-700" : "text-slate-400 hover:bg-white hover:text-slate-700")}
          onClick={() => onChange(optionValue)}
          title={label}
          aria-label={label}
          aria-pressed={value === optionValue}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

function SimpleAlignSelect({ value, onChange }: { value: Exclude<HorizontalAlign, "justify">; onChange: (value: Exclude<HorizontalAlign, "justify">) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Exclude<HorizontalAlign, "justify">)}>
      <SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="left">左对齐</SelectItem>
        <SelectItem value="center">居中</SelectItem>
        <SelectItem value="right">右对齐</SelectItem>
      </SelectContent>
    </Select>
  );
}

function VerticalAlignSelect({ value, onChange }: { value: VerticalAlign; onChange: (value: VerticalAlign) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as VerticalAlign)}>
      <SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="top">顶端对齐</SelectItem>
        <SelectItem value="middle">垂直居中</SelectItem>
        <SelectItem value="bottom">底端对齐</SelectItem>
      </SelectContent>
    </Select>
  );
}

function PropertyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-4">
      <h4 className="mb-3 flex items-center justify-between gap-2 text-[15px] font-bold text-slate-950"><span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-indigo-600" />{title}</span><ChevronDown className="size-4 text-slate-400" /></h4>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label className="text-sm text-slate-700">{label}</Label>{children}</div>;
}

function SettingSwitch({ label, checked, onCheckedChange, disabled = false }: { label: string; checked: boolean; onCheckedChange?: (checked: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 text-sm"><span>{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>;
}

function TabScrollArea({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-auto p-5 xl:p-6">{children}</div>;
}

function PageSettingsPanel({ pageSettings, patchPageSettings }: { pageSettings: PageSettingsDraft; patchPageSettings: (patch: Partial<PageSettingsDraft>) => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PanelCard title="纸张">
        <Field label="纸张大小">
          <Select value={pageSettings.paperSize} onValueChange={(value) => patchPageSettings({ paperSize: value as PageSettingsDraft["paperSize"] })}>
            <SelectTrigger className="h-11 w-full rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              {paperSizeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex w-full items-center justify-between gap-4">
                    <span>{option.label}</span>
                    <span className="text-xs text-slate-400">{option.description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="方向">
          <div className="grid h-11 grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {([
              ["portrait", "纵向"],
              ["landscape", "横向"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "flex items-center justify-center border-r border-slate-200 text-sm font-semibold last:border-r-0",
                  pageSettings.orientation === value ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-white hover:text-slate-800",
                )}
                onClick={() => patchPageSettings({ orientation: value })}
                aria-pressed={pageSettings.orientation === value}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      </PanelCard>

      <PanelCard title="页边距">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="上边距 (cm)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginTop} onChange={(event) => patchPageSettings({ marginTop: Number(event.target.value) })} /></Field>
          <Field label="下边距 (cm)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginBottom} onChange={(event) => patchPageSettings({ marginBottom: Number(event.target.value) })} /></Field>
          <Field label="左边距 (cm)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginLeft} onChange={(event) => patchPageSettings({ marginLeft: Number(event.target.value) })} /></Field>
          <Field label="右边距 (cm)"><Input className="h-11 rounded-lg bg-slate-50" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginRight} onChange={(event) => patchPageSettings({ marginRight: Number(event.target.value) })} /></Field>
        </div>
      </PanelCard>

      <PanelCard title="页眉页脚">
        <SettingSwitch label="启用页眉" checked={pageSettings.headerEnabled} onCheckedChange={(checked) => patchPageSettings({ headerEnabled: checked })} />
        {pageSettings.headerEnabled ? (
          <Field label="页眉内容">
            <Input
              className="h-11 rounded-lg bg-slate-50"
              placeholder="例如：项目报告 / 公司名称"
              value={pageSettings.headerText}
              onChange={(event) => patchPageSettings({ headerText: event.target.value })}
            />
          </Field>
        ) : null}
        <SettingSwitch label="启用页脚" checked={pageSettings.footerEnabled} onCheckedChange={(checked) => patchPageSettings({ footerEnabled: checked })} />
        {pageSettings.footerEnabled ? (
          <>
            <Field label="页脚文本">
              <Input
                className="h-11 rounded-lg bg-slate-50"
                placeholder="可留空，仅显示页码"
                value={pageSettings.footerText}
                onChange={(event) => patchPageSettings({ footerText: event.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px_130px]">
              <Field label="页码格式">
                <Select value={pageSettings.footerPageNumberFormat} onValueChange={(value) => patchPageSettings({ footerPageNumberFormat: value as PageSettingsDraft["footerPageNumberFormat"] })}>
                  <SelectTrigger className="h-11 w-full rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {footerPageNumberFormats.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="从第几页显示">
                <Input
                  className="h-11 rounded-lg bg-slate-50"
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={pageSettings.footerShowFromPage}
                  onChange={(event) => patchPageSettings({ footerShowFromPage: Number(event.target.value) })}
                />
              </Field>
              <Field label="起始页码">
                <Input
                  className="h-11 rounded-lg bg-slate-50"
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={pageSettings.footerStartPage}
                  onChange={(event) => patchPageSettings({ footerStartPage: Number(event.target.value) })}
                />
              </Field>
            </div>
          </>
        ) : null}
        <p className="text-xs leading-5 text-slate-500">页眉为空时不显示文字；页脚文本可和页码一起显示。</p>
      </PanelCard>

      <PanelCard title="目录">
        <SettingSwitch label="生成目录" checked={pageSettings.tocEnabled} onCheckedChange={(checked) => patchPageSettings({ tocEnabled: checked })} />
        <Field label="目录深度">
          <Select value={pageSettings.tocDepth} onValueChange={(value) => patchPageSettings({ tocDepth: value })}>
            <SelectTrigger className="h-11 rounded-lg bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1-2">1-2</SelectItem>
              <SelectItem value="1-3">1-3</SelectItem>
              <SelectItem value="1-4">1-4</SelectItem>
              <SelectItem value="1-6">1-6</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </PanelCard>

    </div>
  );
}

function MappingPanel({ markdownFeatures, patchMarkdownFeatures }: { markdownFeatures: MarkdownFeatureSettings; patchMarkdownFeatures: (patch: Partial<MarkdownFeatureSettings>) => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <AppSurface variant="plain" radius="sm" padding="none" className="p-5">
        <h3 className="text-xl font-bold">Markdown → Word 样式映射</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {markdownMappings.map(([from, to]) => (
            <div key={from} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <code className="text-indigo-700">{from}</code>
              <span className="text-slate-400">→</span>
              <span className="font-semibold">{to}</span>
            </div>
          ))}
        </div>
      </AppSurface>

      <PanelCard title="Markdown 特殊样式">
        <SettingSwitch label="启用行内代码样式" checked={markdownFeatures.inlineCode} onCheckedChange={(checked) => patchMarkdownFeatures({ inlineCode: checked })} />
        <SettingSwitch label="启用代码块样式" checked={markdownFeatures.codeBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ codeBlock: checked })} />
        <SettingSwitch label="启用引用块样式" checked={markdownFeatures.quoteBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ quoteBlock: checked })} />
        <SettingSwitch label="保留分割线" checked={markdownFeatures.horizontalRule} onCheckedChange={(checked) => patchMarkdownFeatures({ horizontalRule: checked })} />
        <p className="text-xs leading-5 text-slate-500">关闭后，导出 Word 时对应 Markdown 结构会按普通正文处理；分割线默认不保留。</p>
      </PanelCard>
    </div>
  );
}

function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return <AppSurface as="section" variant="plain" radius="sm" padding="none" className="space-y-4 p-5"><h3 className="font-bold text-slate-950">{title}</h3>{children}</AppSurface>;
}
