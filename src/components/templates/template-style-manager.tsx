import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowLeft, ChevronDown, Code2, FileText, Heading, ImageIcon, ListTree, Palette, Pilcrow, Quote, Search, SlidersHorizontal, Table2, Upload, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WordColorPicker } from "@/components/ui/word-color-picker";
import { WordFontSizeSelect } from "@/components/ui/word-font-size-select";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { borderStyleOptions, captionNumberFormatOptions, captionPositionOptions, codeBlockPresets, createDefaultStyleDraft, createDefaultTemplateStyleConfig, getDefaultNumberFormat, imageWidthModeOptions, listLevelTypeOptions, listMarkerOptions, listNumberFormatOptions, listNumberingModeOptions, listWrapModeOptions, markdownMappings, mergeTemplateStyleConfig, numberFormatOptions, styleGroupLabels, styleNodes, tablePresets } from "@/lib/style-manager-data";
import { getTemplateStyleConfig, resetTemplateStyleConfig, saveTemplateStyleConfig, selectDocxFile } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import type { HorizontalAlign, MarkdownFeatureSettings, PageSettingsDraft, StyleDraft, StyleGroupKey, StyleNode, Template, TemplateStyleConfig, VerticalAlign } from "@/types";

type TemplateStyleManagerProps = {
  open?: boolean;
  template?: Template;
  embedded?: boolean;
  groups?: string[];
  onDirtyChange?: (dirty: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onRequestClose?: () => void;
  onSaveTemplate?: (template: Template) => Promise<void>;
};

const editorTabs = [
  { id: "info", label: "基础信息" },
  { id: "styles", label: "样式设计" },
  { id: "page", label: "页面设置" },
  { id: "mapping", label: "Markdown 规则" },
];

const markdownMappingStyleIds: Record<string, string> = {
  "Heading 1": "heading-1",
  "Heading 2": "heading-2",
  "Heading 3": "heading-3",
  "Heading 4": "heading-4",
  "Heading 5": "heading-5",
  "Heading 6": "heading-6",
  Normal: "normal",
  Quote: "quote",
  "Source Code": "source-code",
  "Inline Code": "inline-code",
  Table: "table",
  "Table Header": "table-header",
  "Table Body": "table-body",
  "Table Caption": "table-caption",
  Caption: "caption",
};

const styleGroupIcons: Record<StyleGroupKey, LucideIcon> = {
  basic: Pilcrow,
  images: ImageIcon,
  blocks: Code2,
  tables: Table2,
};

const headingStyleIds = ["heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6"];
const headingNavigationNode: StyleNode = {
  id: "heading-2",
  name: "Heading Styles",
  displayName: "标题样式",
  group: "basic",
  kind: "heading",
  markdown: "# / ## / ###",
  description: "统一配置 1-6 级标题，每一级独立保存字体、间距和编号。",
};
const headingLevelOptions = [1, 2, 3, 4, 5, 6] as const;
const listStyleIds = ["bullet-list", "numbered-list", "nested-list"];
const listNavigationNode: StyleNode = {
  id: "nested-list",
  name: "List Styles",
  displayName: "列表样式",
  group: "basic",
  kind: "list",
  markdown: "- / 1. / 缩进",
  description: "统一配置无序列表、有序列表和多级列表。",
};
const basicStyleItemIds = ["normal", "body-text"];

const listLevelOptions = [1, 2, 3, 4] as const;
const listLevelTypeKeys = {
  1: "listLevel1Type",
  2: "listLevel2Type",
  3: "listLevel3Type",
  4: "listLevel4Type",
} as const;
const listLevelMarkerKeys = {
  1: "listLevel1MarkerStyle",
  2: "listLevel2MarkerStyle",
  3: "listLevel3MarkerStyle",
  4: "listLevel4MarkerStyle",
} as const;
const listLevelNumberKeys = {
  1: "listLevel1NumberFormat",
  2: "listLevel2NumberFormat",
  3: "listLevel3NumberFormat",
  4: "listLevel4NumberFormat",
} as const;
const listLevelChineseFontKeys = {
  1: "listLevel1ChineseFont",
  2: "listLevel2ChineseFont",
  3: "listLevel3ChineseFont",
  4: "listLevel4ChineseFont",
} as const;
const listLevelLatinFontKeys = {
  1: "listLevel1LatinFont",
  2: "listLevel2LatinFont",
  3: "listLevel3LatinFont",
  4: "listLevel4LatinFont",
} as const;
const listLevelFontSizeKeys = {
  1: "listLevel1FontSize",
  2: "listLevel2FontSize",
  3: "listLevel3FontSize",
  4: "listLevel4FontSize",
} as const;
const listLevelFontWeightKeys = {
  1: "listLevel1FontWeight",
  2: "listLevel2FontWeight",
  3: "listLevel3FontWeight",
  4: "listLevel4FontWeight",
} as const;
const listLevelColorKeys = {
  1: "listLevel1Color",
  2: "listLevel2Color",
  3: "listLevel3Color",
  4: "listLevel4Color",
} as const;
const listLevelLineHeightKeys = {
  1: "listLevel1LineHeight",
  2: "listLevel2LineHeight",
  3: "listLevel3LineHeight",
  4: "listLevel4LineHeight",
} as const;
const listLevelBeforeSpacingKeys = {
  1: "listLevel1BeforeSpacing",
  2: "listLevel2BeforeSpacing",
  3: "listLevel3BeforeSpacing",
  4: "listLevel4BeforeSpacing",
} as const;
const listLevelAfterSpacingKeys = {
  1: "listLevel1AfterSpacing",
  2: "listLevel2AfterSpacing",
  3: "listLevel3AfterSpacing",
  4: "listLevel4AfterSpacing",
} as const;
const listLevelAlignKeys = {
  1: "listLevel1Align",
  2: "listLevel2Align",
  3: "listLevel3Align",
  4: "listLevel4Align",
} as const;
const listLevelIndentKeys = {
  1: "listLevel1Indent",
  2: "listLevel2Indent",
  3: "listLevel3Indent",
  4: "listLevel4Indent",
} as const;
const listLevelTextIndentKeys = {
  1: "listLevel1TextIndent",
  2: "listLevel2TextIndent",
  3: "listLevel3TextIndent",
  4: "listLevel4TextIndent",
} as const;
const listLevelWrapModeKeys = {
  1: "listLevel1WrapMode",
  2: "listLevel2WrapMode",
  3: "listLevel3WrapMode",
  4: "listLevel4WrapMode",
} as const;
const listLevelNumberingModeKeys = {
  1: "listLevel1NumberingMode",
  2: "listLevel2NumberingMode",
  3: "listLevel3NumberingMode",
  4: "listLevel4NumberingMode",
} as const;

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
  { value: "plain", label: "1" },
  { value: "none", label: "不显示页码" },
];

const tocLeaderOptions: Array<{ value: PageSettingsDraft["tocLeader"]; label: string }> = [
  { value: "dot", label: "点线引导符" },
  { value: "space", label: "空白间隔" },
];

function getStyleNodeIcon(node: StyleNode) {
  if (node.id === "quote") return Quote;
  if (node.kind === "code") return Code2;
  if (node.kind === "image") return ImageIcon;
  if (node.kind === "heading") return Heading;
  if (node.kind === "list") return ListTree;
  if (node.kind === "table") return Table2;
  return Pilcrow;
}

function headingLevelFromStyleId(styleId: string) {
  return Number(styleId.replace("heading-", "")) || 2;
}

export function TemplateStyleManager({ open = true, template, embedded = false, groups = [], onDirtyChange, onOpenChange, onRequestClose, onSaveTemplate }: TemplateStyleManagerProps) {
  const [activeTab, setActiveTab] = useState("info");
  const [query, setQuery] = useState("");
  const [activeStyleId, setActiveStyleId] = useState("heading-2");
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(() => createDefaultTemplateStyleConfig(template?.id ?? "default-report"));
  const [savedConfig, setSavedConfig] = useState<TemplateStyleConfig>(() => createDefaultTemplateStyleConfig(template?.id ?? "default-report"));
  const [templateName, setTemplateName] = useState(template?.name ?? "");
  const [templateCategory, setTemplateCategory] = useState(template?.tags[0] ?? "未分组");
  const [templateTagsText, setTemplateTagsText] = useState((template?.tags ?? []).slice(1).join(" / "));
  const [templateDescription, setTemplateDescription] = useState(template?.description ?? "");
  const [referenceDocxPath, setReferenceDocxPath] = useState(template?.referenceDocxPath ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(60);
  const [activeListLevel, setActiveListLevel] = useState<(typeof listLevelOptions)[number]>(1);
  const tabsNavRef = useRef<HTMLElement | null>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ left: 0, width: 0 });

  const selectedStyle = styleNodes.find((node) => node.id === activeStyleId) ?? styleNodes[1];
  const currentDraft = styleConfig.styles[activeStyleId] ?? createDefaultStyleDraft(activeStyleId);
  const styleHasChanges = JSON.stringify(styleConfig) !== JSON.stringify(savedConfig);
  const canEditTemplateInfo = Boolean(template && !template.isBuiltIn && onSaveTemplate);
  const metadataHasChanges = Boolean(template && (
    templateName.trim() !== template.name ||
    templateDescription.trim() !== (template.description ?? "") ||
    referenceDocxPath.trim() !== template.referenceDocxPath ||
    normalizeTemplateTags(templateCategory, templateTagsText).join("\n") !== template.tags.join("\n")
  ));
  const hasChanges = styleHasChanges || metadataHasChanges;
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const filteredNodes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return styleNodes;
    return styleNodes.filter((node) => [node.name, node.displayName, node.markdown, node.description].join(" ").toLowerCase().includes(keyword));
  }, [query]);

  function groupedNodes(group: StyleGroupKey) {
    return filteredNodes.filter((node) => node.group === group);
  }

  useLayoutEffect(() => {
    const button = tabButtonRefs.current[activeTab];
    if (!button) return;
    setTabIndicatorStyle({ left: button.offsetLeft, width: button.offsetWidth });
  }, [activeTab, open]);

  useEffect(() => {
    const nav = tabsNavRef.current;
    const button = tabButtonRefs.current[activeTab];
    if (!nav || !button) return;

    const updateIndicator = () => {
      setTabIndicatorStyle({ left: button.offsetLeft, width: button.offsetWidth });
    };

    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(nav);
    observer.observe(button);
    window.addEventListener("resize", updateIndicator);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [activeTab]);

  useEffect(() => {
    if (!open) return;
    const templateId = template?.id ?? "default-report";
    setActiveTab("info");
    setTemplateName(template?.name ?? "");
    setTemplateCategory(template?.tags[0] ?? (template?.isBuiltIn ? "系统" : "未分组"));
    setTemplateTagsText((template?.tags ?? []).slice(1).join(" / "));
    setTemplateDescription(template?.description ?? "");
    setReferenceDocxPath(template?.referenceDocxPath ?? "");
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
        toast.error(userFacingErrorMessage(error, "加载模板样式失败，已使用默认样式"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, template?.id, template?.updatedAt]);

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

  async function handleSelectReferenceDocx() {
    try {
      const selected = await selectDocxFile();
      if (!selected) return;
      setReferenceDocxPath(selected);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "选择参考 DOCX 失败"));
    }
  }

  async function handleSaveTemplateInfo(showToast = true) {
    if (!template || !canEditTemplateInfo || !onSaveTemplate) return true;
    const nextName = templateName.trim();
    if (!nextName) {
      toast.error("请填写模板名称");
      return false;
    }
    const nextReferenceDocxPath = referenceDocxPath.trim();
    if (nextReferenceDocxPath && !nextReferenceDocxPath.toLowerCase().endsWith(".docx")) {
      toast.error("参考 DOCX 路径必须指向 .docx 文件");
      return false;
    }

    const nextTemplate: Template = {
      ...template,
      name: nextName,
      description: templateDescription.trim() || undefined,
      referenceDocxPath: nextReferenceDocxPath,
      tags: normalizeTemplateTags(templateCategory, templateTagsText),
      updatedAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      await onSaveTemplate(nextTemplate);
      if (showToast) toast.success("模板基础信息已保存");
      return true;
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "保存模板基础信息失败"));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveStyleConfig(showToast = true) {
    setIsSaving(true);
    try {
      const saved = await saveTemplateStyleConfig({ ...styleConfig, updatedAt: new Date().toISOString() });
      const nextConfig = mergeTemplateStyleConfig(styleConfig.templateId, saved);
      setStyleConfig(nextConfig);
      setSavedConfig(nextConfig);
      if (showToast) toast.success("模板样式已保存，下次打开和导出时会使用当前配置。");
      return true;
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "保存模板样式失败"));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveEditor() {
    if (!metadataHasChanges && !styleHasChanges) return true;
    const saveBoth = metadataHasChanges && styleHasChanges;
    if (metadataHasChanges) {
      const saved = await handleSaveTemplateInfo(!saveBoth);
      if (!saved) return false;
    }
    if (styleHasChanges) {
      const saved = await handleSaveStyleConfig(!saveBoth);
      if (!saved) return false;
    }
    if (saveBoth) toast.success("模板基础信息和样式已保存");
    return true;
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
      toast.error(userFacingErrorMessage(error, "重置模板样式失败"));
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
    const saved = await handleSaveEditor();
    if (!saved) return;
    setConfirmCloseOpen(false);
    closeEditor();
  }

  function discardAndCloseEditor() {
    setStyleConfig(savedConfig);
    setTemplateName(template?.name ?? "");
    setTemplateCategory(template?.tags[0] ?? (template?.isBuiltIn ? "系统" : "未分组"));
    setTemplateTagsText((template?.tags ?? []).slice(1).join(" / "));
    setTemplateDescription(template?.description ?? "");
    setReferenceDocxPath(template?.referenceDocxPath ?? "");
    setConfirmCloseOpen(false);
    closeEditor();
  }

  function renderEditorContent() {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-white dark:bg-zinc-950">
        <header className="shrink-0 border-b border-slate-200 px-5 py-3 dark:border-zinc-800 xl:px-7 xl:py-4">
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                {embedded ? <ArrowLeft className="size-3.5" /> : null}
                模板样式管理
              </div>
              {embedded ? (
                <>
                  <h2 className="mt-1.5 truncate text-[22px] font-bold tracking-[-0.03em] text-slate-950 dark:text-zinc-50 xl:text-2xl">样式编辑：{template?.name ?? "技术文档模板"}</h2>
                  <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-zinc-400">
                    {template?.isBuiltIn ? "系统模板 · 可修改 · 可随时重置为内置默认" : "自定义模板 · 样式会保存到本机模板配置"}
                  </p>
                </>
              ) : (
                <>
                  <DialogTitle className="mt-1.5 truncate text-[22px] font-bold tracking-[-0.03em] text-slate-950 dark:text-zinc-50 xl:text-2xl">样式编辑：{template?.name ?? "技术文档模板"}</DialogTitle>
                  <DialogDescription className="mt-1 text-sm leading-5 text-slate-500 dark:text-zinc-400">
                    {template?.isBuiltIn ? "系统模板 · 可修改 · 可随时重置为内置默认" : "自定义模板 · 样式会保存到本机模板配置"}
                  </DialogDescription>
                </>
              )}
            </div>
            <SoftActionButton className="h-10 shrink-0 rounded-full border-slate-200 bg-white text-slate-500 hover:text-slate-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50" onClick={requestCloseEditor}>
              {embedded ? <ArrowLeft className="size-4" /> : <X className="size-4" />}
              {embedded ? "返回模板中心" : "关闭"}
            </SoftActionButton>
          </div>
        </header>

        <nav ref={tabsNavRef} className="relative flex h-12 shrink-0 items-end gap-8 overflow-x-auto border-b border-slate-200 px-5 dark:border-zinc-800 xl:px-7">
          {editorTabs.map((tab) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabButtonRefs.current[tab.id] = node;
              }}
              className={cn(
                "relative z-10 flex h-full shrink-0 items-center text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950 dark:text-zinc-400 dark:hover:text-zinc-50",
                activeTab === tab.id && "text-[var(--app-primary)]",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <span
            className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-[var(--app-primary)] transition-[left,width] duration-300 ease-out"
            style={{ left: tabIndicatorStyle.left, width: tabIndicatorStyle.width }}
          />
        </nav>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50/50 dark:bg-zinc-950">
          {activeTab === "info" ? (
            <TabScrollArea>
              <TemplateInfoPanel
                template={template}
                groups={groups}
                canEdit={canEditTemplateInfo}
                name={templateName}
                setName={setTemplateName}
                category={templateCategory}
                setCategory={setTemplateCategory}
                tagsText={templateTagsText}
                setTagsText={setTemplateTagsText}
                description={templateDescription}
                setDescription={setTemplateDescription}
                referenceDocxPath={referenceDocxPath}
                setReferenceDocxPath={setReferenceDocxPath}
                onSelectReferenceDocx={handleSelectReferenceDocx}
                onUseDefaultStyle={() => void handleResetTemplateStyleConfig()}
                onGoStyles={() => setActiveTab("styles")}
                disabled={isSaving || isLoading}
              />
            </TabScrollArea>
          ) : null}
          {activeTab === "styles" ? (
            <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto md:grid md:grid-cols-[300px_minmax(0,1fr)] md:max-lg:grid-rows-[minmax(560px,58vh)_minmax(520px,1fr)] lg:grid-cols-[220px_minmax(300px,1fr)_minmax(280px,340px)] lg:overflow-x-hidden lg:overflow-y-hidden xl:grid-cols-[240px_minmax(420px,1fr)_minmax(320px,420px)] 2xl:grid-cols-[270px_minmax(620px,1fr)_minmax(460px,540px)]">
              <StyleNavigation query={query} setQuery={setQuery} groupedNodes={groupedNodes} activeStyleId={activeStyleId} setActiveStyleId={setActiveStyleId} />
              <StyleProperties selectedStyle={selectedStyle} setActiveStyleId={setActiveStyleId} draft={currentDraft} bodyDraft={styleConfig.styles.normal ?? createDefaultStyleDraft("normal")} markdownFeatures={styleConfig.markdownFeatures} activeListLevel={activeListLevel} setActiveListLevel={setActiveListLevel} updateDraft={updateDraft} patchDraft={patchDraft} patchMarkdownFeatures={patchMarkdownFeatures} isLoading={isLoading} />
              <PreviewColumn selectedStyle={selectedStyle} styleConfig={styleConfig} zoom={zoom} setZoom={setZoom} />
            </div>
          ) : null}
          {activeTab === "page" ? <TabScrollArea><PageSettingsPanel pageSettings={styleConfig.pageSettings} patchPageSettings={patchPageSettings} /></TabScrollArea> : null}
          {activeTab === "mapping" ? (
            <TabScrollArea>
              <MappingPanel
                markdownFeatures={styleConfig.markdownFeatures}
                patchMarkdownFeatures={patchMarkdownFeatures}
                onEditStyle={(styleId) => {
                  setActiveStyleId(styleId);
                  setActiveTab("styles");
                }}
              />
            </TabScrollArea>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/96 px-5 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/96 xl:gap-4 xl:px-7">
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", hasChanges ? "bg-amber-50 text-amber-700 dark:bg-amber-500/16 dark:text-amber-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/16 dark:text-emerald-200")}>{hasChanges ? "有未保存更改" : "已保存"}</span>
          {activeTab === "styles" ? <Button variant="ghost" className="text-slate-500 dark:text-zinc-400 dark:hover:text-zinc-100" onClick={resetCurrentStyle} disabled={isSaving || isLoading}>重置当前样式</Button> : null}
          <SoftActionButton className="h-9 rounded-[10px]" onClick={handleResetTemplateStyleConfig} disabled={isSaving || isLoading}>恢复默认样式</SoftActionButton>
          <PrimaryActionButton className="h-9 rounded-[10px] px-5 font-semibold" onClick={() => void handleSaveEditor()} disabled={isSaving || isLoading || !hasChanges}>{isSaving ? "保存中..." : "保存更改"}</PrimaryActionButton>
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
        className="left-auto right-0 top-0 bottom-0 flex h-dvh max-h-dvh w-[min(1240px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 overflow-hidden rounded-none border-l-2 border-indigo-500/70 bg-white p-0 shadow-2xl shadow-slate-900/25 dark:bg-zinc-950 dark:shadow-black/40 sm:max-w-[min(1240px,calc(100vw-1rem))]"
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
    <aside className="min-h-0 overflow-hidden border-r border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 max-md:max-h-[340px] max-md:shrink-0 max-md:border-b max-md:border-r-0 md:max-lg:h-full md:max-lg:min-h-[560px] md:max-lg:border-b">
      <div className="border-b border-slate-200 p-3.5 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <Input className="h-10 rounded-lg border-slate-200 bg-slate-50 pl-10 dark:border-zinc-700 dark:bg-zinc-900/72" placeholder="搜索样式..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      <div className="h-[calc(100%-69px)] overflow-auto px-3.5 py-3">
        {(Object.keys(styleGroupLabels) as StyleGroupKey[]).map((group) => {
          const nodes = groupedNodes(group);
          if (nodes.length === 0) return null;
          const collapsed = collapsedGroups.includes(group) && query.trim() === "";
          const groupActive = nodes.some((node) => node.id === activeStyleId);
          const GroupIcon = styleGroupIcons[group];
          const basicNavigationCount =
            (nodes.some((node) => headingStyleIds.includes(node.id)) ? 1 : 0) +
            basicStyleItemIds.filter((styleId) => nodes.some((node) => node.id === styleId)).length +
            (nodes.some((node) => listStyleIds.includes(node.id)) ? 1 : 0);
          const groupCount = group === "basic" ? basicNavigationCount : nodes.length;
          return (
            <section key={group} className="mb-3">
              <button
                type="button"
                className={cn(
                  "mb-1.5 flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition",
                  groupActive
                    ? "border-slate-200 bg-slate-50 text-slate-950 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    : "border-transparent text-slate-950 hover:border-slate-200 hover:bg-slate-50 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
                )}
                onClick={() => toggleGroup(group)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ChevronDown className={cn("size-3.5 shrink-0 text-slate-500 transition-transform dark:text-zinc-500", collapsed && "-rotate-90")} />
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border bg-white dark:bg-zinc-950", groupActive ? "border-indigo-100 text-indigo-600 dark:border-indigo-500/40 dark:text-indigo-300" : "border-slate-200 text-slate-500 dark:border-zinc-700 dark:text-zinc-400")}>
                    <GroupIcon className="size-4" />
                  </span>
                  <span className="truncate text-sm font-bold">{styleGroupLabels[group]}</span>
                </span>
                <span className={cn("ml-2 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", groupActive ? "bg-white text-slate-700 dark:bg-zinc-800 dark:text-zinc-200" : "bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400")}>{groupCount}</span>
              </button>
              {!collapsed ? (
                <div className="ml-4 space-y-1 border-l border-slate-200 pl-3 dark:border-zinc-800">
                  {group === "basic" ? (
                    <>
                      {nodes.some((node) => headingStyleIds.includes(node.id)) ? (
                        <StyleNavigationItem
                          node={headingNavigationNode}
                          active={headingStyleIds.includes(activeStyleId)}
                          onSelect={() => setActiveStyleId(headingStyleIds.includes(activeStyleId) ? activeStyleId : "heading-2")}
                        />
                      ) : null}
                      {basicStyleItemIds.map((styleId) => {
                        const node = nodes.find((item) => item.id === styleId);
                        if (!node) return null;
                        return <StyleNavigationItem key={node.id} node={node} active={activeStyleId === node.id} onSelect={() => setActiveStyleId(node.id)} />;
                      })}
                      {nodes.some((node) => listStyleIds.includes(node.id)) ? (
                        <StyleNavigationItem
                          node={listNavigationNode}
                          active={listStyleIds.includes(activeStyleId)}
                          onSelect={() => setActiveStyleId(listStyleIds.includes(activeStyleId) ? activeStyleId : "nested-list")}
                        />
                      ) : null}
                    </>
                  ) : (
                    nodes.map((node) => (
                      <StyleNavigationItem key={node.id} node={node} active={activeStyleId === node.id} onSelect={() => setActiveStyleId(node.id)} />
                    ))
                  )}
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
        "flex min-h-10 w-full items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
        active ? "bg-indigo-50 font-semibold text-indigo-700 shadow-[inset_2px_0_0_rgb(79_70_229)] dark:bg-indigo-500/16 dark:text-indigo-200 dark:shadow-[inset_2px_0_0_rgb(129_140_248)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
      )}
      onClick={onSelect}
      title={`${node.displayName} · ${node.name} · ${node.markdown}`}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", node.kind === "heading" && "font-bold", node.kind === "code" && "font-mono", node.kind === "paragraph" && "font-normal")}>{node.displayName}</span>
      </span>
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border", active ? "border-indigo-100 bg-white text-indigo-600 dark:border-indigo-500/40 dark:bg-zinc-900 dark:text-indigo-300" : "border-slate-200 bg-white/70 text-slate-400 dark:border-zinc-700 dark:bg-zinc-900/72 dark:text-zinc-500")}>
        <NodeIcon className="size-3" />
      </span>
    </button>
  );
}

function createListInheritancePatch(bodyDraft: StyleDraft): Partial<StyleDraft> {
  return {
    chineseFont: bodyDraft.chineseFont,
    latinFont: bodyDraft.latinFont,
    fontSize: bodyDraft.fontSize,
    fontWeight: bodyDraft.fontWeight,
    color: bodyDraft.color,
    lineHeight: bodyDraft.lineHeight,
    beforeSpacing: bodyDraft.beforeSpacing,
    afterSpacing: bodyDraft.afterSpacing,
    listLevel1ChineseFont: bodyDraft.chineseFont,
    listLevel2ChineseFont: bodyDraft.chineseFont,
    listLevel3ChineseFont: bodyDraft.chineseFont,
    listLevel4ChineseFont: bodyDraft.chineseFont,
    listLevel1LatinFont: bodyDraft.latinFont,
    listLevel2LatinFont: bodyDraft.latinFont,
    listLevel3LatinFont: bodyDraft.latinFont,
    listLevel4LatinFont: bodyDraft.latinFont,
    listLevel1FontSize: bodyDraft.fontSize,
    listLevel2FontSize: bodyDraft.fontSize,
    listLevel3FontSize: bodyDraft.fontSize,
    listLevel4FontSize: bodyDraft.fontSize,
    listLevel1FontWeight: bodyDraft.fontWeight,
    listLevel2FontWeight: bodyDraft.fontWeight,
    listLevel3FontWeight: bodyDraft.fontWeight,
    listLevel4FontWeight: bodyDraft.fontWeight,
    listLevel1Color: bodyDraft.color,
    listLevel2Color: bodyDraft.color,
    listLevel3Color: bodyDraft.color,
    listLevel4Color: bodyDraft.color,
    listLevel1LineHeight: bodyDraft.lineHeight,
    listLevel2LineHeight: bodyDraft.lineHeight,
    listLevel3LineHeight: bodyDraft.lineHeight,
    listLevel4LineHeight: bodyDraft.lineHeight,
    listLevel1BeforeSpacing: bodyDraft.beforeSpacing,
    listLevel2BeforeSpacing: bodyDraft.beforeSpacing,
    listLevel3BeforeSpacing: bodyDraft.beforeSpacing,
    listLevel4BeforeSpacing: bodyDraft.beforeSpacing,
    listLevel1AfterSpacing: bodyDraft.afterSpacing,
    listLevel2AfterSpacing: bodyDraft.afterSpacing,
    listLevel3AfterSpacing: bodyDraft.afterSpacing,
    listLevel4AfterSpacing: bodyDraft.afterSpacing,
  };
}

function StyleProperties({
  selectedStyle,
  setActiveStyleId,
  draft,
  bodyDraft,
  markdownFeatures,
  activeListLevel,
  setActiveListLevel,
  updateDraft,
  patchDraft,
  patchMarkdownFeatures,
  isLoading,
}: {
  selectedStyle: StyleNode;
  setActiveStyleId: (id: string) => void;
  draft: StyleDraft;
  bodyDraft: StyleDraft;
  markdownFeatures: MarkdownFeatureSettings;
  activeListLevel: (typeof listLevelOptions)[number];
  setActiveListLevel: (level: (typeof listLevelOptions)[number]) => void;
  updateDraft: <K extends keyof StyleDraft>(key: K, value: StyleDraft[K]) => void;
  patchDraft: (patch: Partial<StyleDraft>) => void;
  patchMarkdownFeatures: (patch: Partial<MarkdownFeatureSettings>) => void;
  isLoading: boolean;
}) {
  const isHeading = selectedStyle.kind === "heading";
  const isCode = selectedStyle.kind === "code";
  const isCodeBlock = selectedStyle.id === "source-code";
  const isInlineCode = selectedStyle.id === "inline-code";
  const isQuote = selectedStyle.id === "quote";
  const isList = selectedStyle.kind === "list";
  const isImage = selectedStyle.id === "image";
  const usesBlockSpacing = isCodeBlock || isQuote;
  const isTableNode = selectedStyle.kind === "table";
  const isTableRoot = selectedStyle.id === "table";
  const isTableHeader = selectedStyle.id === "table-header";
  const isTableBody = selectedStyle.id === "table-body";
  const isTableCaption = selectedStyle.id === "table-caption";
  const isCaption = selectedStyle.id === "caption" || isTableCaption;
  const activeHeadingLevel = headingLevelFromStyleId(selectedStyle.id);
  const activeListLevelTypeKey = listLevelTypeKeys[activeListLevel];
  const activeListLevelMarkerKey = listLevelMarkerKeys[activeListLevel];
  const activeListLevelNumberKey = listLevelNumberKeys[activeListLevel];
  const activeListLevelChineseFontKey = listLevelChineseFontKeys[activeListLevel];
  const activeListLevelLatinFontKey = listLevelLatinFontKeys[activeListLevel];
  const activeListLevelFontSizeKey = listLevelFontSizeKeys[activeListLevel];
  const activeListLevelFontWeightKey = listLevelFontWeightKeys[activeListLevel];
  const activeListLevelColorKey = listLevelColorKeys[activeListLevel];
  const activeListLevelLineHeightKey = listLevelLineHeightKeys[activeListLevel];
  const activeListLevelBeforeSpacingKey = listLevelBeforeSpacingKeys[activeListLevel];
  const activeListLevelAfterSpacingKey = listLevelAfterSpacingKeys[activeListLevel];
  const activeListLevelAlignKey = listLevelAlignKeys[activeListLevel];
  const activeListLevelIndentKey = listLevelIndentKeys[activeListLevel];
  const activeListLevelTextIndentKey = listLevelTextIndentKeys[activeListLevel];
  const activeListLevelWrapModeKey = listLevelWrapModeKeys[activeListLevel];
  const activeListLevelNumberingModeKey = listLevelNumberingModeKeys[activeListLevel];
  const activeListLevelType = draft[activeListLevelTypeKey];
  const chineseFontKey = isList ? activeListLevelChineseFontKey : "chineseFont";
  const latinFontKey = isList ? activeListLevelLatinFontKey : "latinFont";
  const fontSizeKey = isList ? activeListLevelFontSizeKey : "fontSize";
  const fontWeightKey = isList ? activeListLevelFontWeightKey : "fontWeight";
  const colorKey = isList ? activeListLevelColorKey : "color";
  const lineHeightKey = isList ? activeListLevelLineHeightKey : "lineHeight";
  const beforeSpacingKey = isList ? activeListLevelBeforeSpacingKey : "beforeSpacing";
  const afterSpacingKey = isList ? activeListLevelAfterSpacingKey : "afterSpacing";
  const alignKey = isList ? activeListLevelAlignKey : "align";

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

  function syncListLevelsFromBody() {
    patchDraft(createListInheritancePatch(bodyDraft));
    toast.success("已同步正文文字样式到列表全部级别");
  }

  return (
    <section className="min-h-0 overflow-auto border-r border-slate-200 bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-950 max-md:shrink-0 max-md:overflow-visible max-md:border-b max-md:border-r-0 md:max-lg:min-h-[560px] md:max-lg:border-b md:max-lg:border-r-0">
      <div className="mb-5">
        <h3 className="text-[26px] font-bold tracking-[-0.03em] text-slate-950 dark:text-zinc-50">{isHeading ? headingNavigationNode.displayName : isList ? listNavigationNode.displayName : selectedStyle.displayName}</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-900/72 dark:text-zinc-300">Word 样式：{isHeading ? selectedStyle.name : isList ? listNavigationNode.name : selectedStyle.name}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-900/72 dark:text-zinc-300">Markdown 标记：{isHeading ? selectedStyle.markdown : isList ? listNavigationNode.markdown : selectedStyle.markdown}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-900/72 dark:text-zinc-300">{isLoading ? "加载中" : "可编辑"}</span>
        </div>
      </div>

      <div className="space-y-4">
        <MarkdownFeatureStyleSwitch selectedStyleId={selectedStyle.id} markdownFeatures={markdownFeatures} patchMarkdownFeatures={patchMarkdownFeatures} />

        {isQuote ? (
          <PropertyCard title="引用块专属样式">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="竖条颜色"><WordColorPicker value={draft.quoteBorderColor} onChange={(value) => updateDraft("quoteBorderColor", value)} autoColor="#94A3B8" /></Field>
              <Field label="竖条粗细 (px)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={1} max={12} step={1} value={draft.quoteBorderWidth} onChange={(event) => updateDraft("quoteBorderWidth", Number(event.target.value))} /></Field>
              <Field label="引用底色"><WordColorPicker value={draft.backgroundColor} onChange={(value) => updateDraft("backgroundColor", value)} autoColor="#F8FAFC" /></Field>
            </div>
          </PropertyCard>
        ) : null}

        {isCodeBlock ? (
          <>
            <PropertyCard title="推荐代码块样式">
              <div className="grid gap-3 md:grid-cols-2">
                {codeBlockPresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={cn(
                      "rounded-xl border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-500/12",
                      draft.codeBlockPreset === preset.key ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100 dark:border-indigo-400/70 dark:bg-indigo-500/16 dark:ring-indigo-500/24" : "border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72",
                    )}
                    onClick={() => patchDraft(preset.patch)}
                  >
                    <div className="text-sm font-semibold text-slate-950 dark:text-zinc-50">{preset.label}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">{preset.description}</p>
                  </button>
                ))}
              </div>
            </PropertyCard>

            <PropertyCard title="代码块外观">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="代码底色"><WordColorPicker value={draft.backgroundColor} onChange={(value) => updateDraft("backgroundColor", value)} autoColor="#F8FAFC" /></Field>
                <Field label="边框颜色"><WordColorPicker value={draft.codeBorderColor} onChange={(value) => updateDraft("codeBorderColor", value)} autoColor="#E2E8F0" /></Field>
                <Field label="左右内边距"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={48} value={draft.codePaddingX} onChange={(event) => updateDraft("codePaddingX", Number(event.target.value))} /></Field>
                <Field label="上下内边距"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={48} value={draft.codePaddingY} onChange={(event) => updateDraft("codePaddingY", Number(event.target.value))} /></Field>
              </div>
            </PropertyCard>
          </>
        ) : null}

        {isInlineCode ? (
          <PropertyCard title="行内代码外观">
            <Field label="行内底色"><WordColorPicker value={draft.backgroundColor} onChange={(value) => updateDraft("backgroundColor", value)} autoColor="#F1F5F9" /></Field>
          </PropertyCard>
        ) : null}

        {isHeading ? (
          <PropertyCard title="标题级别">
            <div className="grid grid-cols-6 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 dark:border-zinc-700 dark:bg-zinc-900/72">
              {headingLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={cn(
                    "h-10 rounded-md text-sm font-semibold transition",
                    activeHeadingLevel === level
                      ? "bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100 dark:bg-zinc-950 dark:text-indigo-200 dark:ring-indigo-500/30"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-950 dark:text-zinc-400 dark:hover:bg-zinc-950/70 dark:hover:text-zinc-100",
                  )}
                  onClick={() => setActiveStyleId(`heading-${level}`)}
                >
                  {level} 级
                </button>
              ))}
            </div>
          </PropertyCard>
        ) : null}

        {isList ? (
          <PropertyCard title="列表级别">
            <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 dark:border-zinc-700 dark:bg-zinc-900/72">
              {listLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={cn(
                    "h-10 rounded-md text-sm font-semibold transition",
                    activeListLevel === level
                      ? "bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100 dark:bg-zinc-950 dark:text-indigo-200 dark:ring-indigo-500/30"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-950 dark:text-zinc-400 dark:hover:bg-zinc-950/70 dark:hover:text-zinc-100",
                  )}
                  onClick={() => setActiveListLevel(level)}
                >
                  {level} 级
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <SoftActionButton className="h-9 rounded-[10px]" onClick={syncListLevelsFromBody}>同步正文文字样式</SoftActionButton>
            </div>
          </PropertyCard>
        ) : null}

        {!isTableRoot && !isImage ? <PropertyCard title={isHeading ? `文本属性（当前 ${activeHeadingLevel} 级）` : isList ? `文本属性（当前 ${activeListLevel} 级）` : isInlineCode ? "行内代码样式" : isCode ? "代码块样式" : isTableNode ? "基础文本样式" : "文本属性"}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="中文字体"><Select value={draft[chineseFontKey] as string} onValueChange={(value) => updateDraft(chineseFontKey, value)}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="微软雅黑">微软雅黑</SelectItem><SelectItem value="Microsoft YaHei UI">Microsoft YaHei UI</SelectItem><SelectItem value="宋体">宋体</SelectItem><SelectItem value="思源黑体">思源黑体</SelectItem><SelectItem value="仿宋">仿宋</SelectItem></SelectContent></Select></Field>
            <Field label="英文字体"><Select value={draft[latinFontKey] as string} onValueChange={(value) => updateDraft(latinFontKey, value)}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Times New Roman">Times New Roman</SelectItem><SelectItem value="Inter">Inter</SelectItem><SelectItem value="Arial">Arial</SelectItem><SelectItem value="Consolas">Consolas</SelectItem><SelectItem value="Cascadia Mono">Cascadia Mono</SelectItem><SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem></SelectContent></Select></Field>
            {(!isTableNode || isTableCaption) ? <Field label="字号"><WordFontSizeSelect value={draft[fontSizeKey] as number} onChange={(value) => updateDraft(fontSizeKey, value)} /></Field> : null}
            <Field label="文字颜色"><WordColorPicker value={draft[colorKey] as string} onChange={(value) => updateDraft(colorKey, value)} autoColor="#111827" /></Field>
            {(!isTableNode || isTableCaption) ? (
              <Field label="字重">
                <div className="grid h-10 grid-cols-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72">
                  <button
                    type="button"
                    className={cn(
                      "flex items-center justify-center border-r border-slate-200 text-base font-black transition dark:border-zinc-700",
                      Number(draft[fontWeightKey]) >= 700 ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-200" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                    )}
                    aria-label="加粗"
                    aria-pressed={Number(draft[fontWeightKey]) >= 700}
                    title="加粗"
                    onClick={() => updateDraft(fontWeightKey, Number(draft[fontWeightKey]) >= 700 ? "400" : "700")}
                  >
                    B
                  </button>
                  <Select value={draft[fontWeightKey] as string} onValueChange={(value) => updateDraft(fontWeightKey, value)}>
                    <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-none border-0 bg-transparent shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fontWeightOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            ) : null}
          </div>
        </PropertyCard> : null}

        {isImage ? (
          <PropertyCard title="图片样式">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="图片对齐"><SimpleAlignSelect value={draft.imageAlign} onChange={(value) => updateDraft("imageAlign", value)} /></Field>
              <Field label="宽度模式">
                <Select value={draft.imageWidthMode} onValueChange={(value) => updateDraft("imageWidthMode", value as typeof draft.imageWidthMode)}>
                  <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                  <SelectContent>{imageWidthModeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {draft.imageWidthMode === "custom" ? (
                <Field label="宽度比例 (%)">
                  <Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={20} max={100} value={draft.imageWidthPercent} onChange={(event) => updateDraft("imageWidthPercent", Number(event.target.value))} />
                </Field>
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-zinc-400">
              默认“铺满正文宽度”会按纸张去掉页边距后的内容宽度导出；题注文字在“图片题注”里单独配置。
            </p>
          </PropertyCard>
        ) : null}

        {isList ? (
          <PropertyCard title={`${activeListLevel} 级列表格式`}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={`${activeListLevel} 级类型`}>
                <div className="grid h-10 grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72">
                  {listLevelTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "flex items-center justify-center border-r border-slate-200 text-sm font-semibold last:border-r-0 dark:border-zinc-700",
                        activeListLevelType === option.value ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-200" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                      )}
                      onClick={() => updateDraft(activeListLevelTypeKey, option.value)}
                      aria-pressed={activeListLevelType === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              {activeListLevelType === "bullet" ? (
                <Field label={`${activeListLevel} 级项目符号`}>
                  <Select value={draft[activeListLevelMarkerKey]} onValueChange={(value) => updateDraft(activeListLevelMarkerKey, value as StyleDraft[typeof activeListLevelMarkerKey])}>
                    <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {listMarkerOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.marker} {option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label={`${activeListLevel} 级编号格式`}>
                  <Select value={listNumberFormatOptions.includes(draft[activeListLevelNumberKey] as (typeof listNumberFormatOptions)[number]) ? draft[activeListLevelNumberKey] : "1."} onValueChange={(value) => updateDraft(activeListLevelNumberKey, value)}>
                    <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {listNumberFormatOptions.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {activeListLevelType === "number" ? (
                <Field label="编号连续性">
                  <Select value={draft[activeListLevelNumberingModeKey]} onValueChange={(value) => updateDraft(activeListLevelNumberingModeKey, value as StyleDraft[typeof activeListLevelNumberingModeKey])}>
                    <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {listNumberingModeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={`${activeListLevel} 级缩进 (中文字符)`}><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={12} step={0.5} value={draft[activeListLevelIndentKey]} onChange={(event) => updateDraft(activeListLevelIndentKey, Number(event.target.value))} /></Field>
              <Field label="符号到文字 (中文字符)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0.5} max={4} step={0.25} value={draft[activeListLevelTextIndentKey]} onChange={(event) => updateDraft(activeListLevelTextIndentKey, Number(event.target.value))} /></Field>
              <Field label="换行对齐">
                <Select value={draft[activeListLevelWrapModeKey]} onValueChange={(value) => updateDraft(activeListLevelWrapModeKey, value as StyleDraft[typeof activeListLevelWrapModeKey])}>
                  <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {listWrapModeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </PropertyCard>
        ) : null}

        {(!isTableNode || isTableCaption) && !isInlineCode ? (
          <PropertyCard title={isHeading ? `段落与间距（当前 ${activeHeadingLevel} 级）` : isList ? `段落与间距（当前 ${activeListLevel} 级）` : usesBlockSpacing ? "块级间距" : "段落与间距"}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="行高"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={draft[lineHeightKey] as string} onChange={(event) => updateDraft(lineHeightKey, event.target.value)} /></Field>
              {!usesBlockSpacing && !isList ? <Field label="首行缩进 (字符)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={4} step={0.5} value={draft.firstLineIndent} onChange={(event) => updateDraft("firstLineIndent", Number(event.target.value))} /></Field> : null}
              {!usesBlockSpacing && !isCaption ? <Field label="对齐方式"><AlignButtonGroup value={draft[alignKey] as HorizontalAlign} onChange={(value) => updateDraft(alignKey, value)} /></Field> : null}
              <Field label="段前间距 (pt)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" value={draft[beforeSpacingKey] as number} onChange={(event) => updateDraft(beforeSpacingKey, Number(event.target.value))} /></Field>
              <Field label="段后间距 (pt)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" value={draft[afterSpacingKey] as number} onChange={(event) => updateDraft(afterSpacingKey, Number(event.target.value))} /></Field>
            </div>
          </PropertyCard>
        ) : null}

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
                      "rounded-xl border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-500/12",
                      draft.tablePreset === preset.key ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100 dark:border-indigo-400/70 dark:bg-indigo-500/16 dark:ring-indigo-500/24" : "border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72",
                    )}
                    onClick={() => patchDraft(preset.patch)}
                  >
                    <div className="text-sm font-semibold text-slate-950 dark:text-zinc-50">{preset.label}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">{preset.description}</p>
                  </button>
                ))}
              </div>
            </PropertyCard>

            <PropertyCard title="表格布局">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="表格布局模式"><Select value={draft.tableLayout} onValueChange={(value) => updateDraft("tableLayout", value as StyleDraft["tableLayout"])}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">自动适配内容</SelectItem><SelectItem value="fixed">固定列宽</SelectItem></SelectContent></Select></Field>
                <Field label="整体水平对齐"><SimpleAlignSelect value={draft.tableHorizontalAlign} onChange={(value) => updateDraft("tableHorizontalAlign", value)} /></Field>
                <SettingSwitch label="根据窗口自动铺满表格" checked={draft.fitToPageWidth} onCheckedChange={(checked) => updateDraft("fitToPageWidth", checked)} />
                <SettingSwitch label="隔行底色" checked={draft.rowStripe} onCheckedChange={(checked) => updateDraft("rowStripe", checked)} />
                <Field label="表格宽度 (%)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={40} max={100} value={draft.tableWidthPercent} onChange={(event) => updateDraft("tableWidthPercent", Number(event.target.value))} /></Field>
                <Field label="列宽模式"><Select value={draft.columnWidthMode} onValueChange={(value) => updateDraft("columnWidthMode", value as StyleDraft["columnWidthMode"])}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">自动分配</SelectItem><SelectItem value="custom">自定义百分比</SelectItem></SelectContent></Select></Field>
                <Field label="第一列宽度 (%)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.firstColumnWidth} onChange={(event) => updateDraft("firstColumnWidth", Number(event.target.value))} /></Field>
                <Field label="第二列宽度 (%)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.secondColumnWidth} onChange={(event) => updateDraft("secondColumnWidth", Number(event.target.value))} /></Field>
                <Field label="第三列宽度 (%)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={10} max={80} disabled={draft.columnWidthMode === "auto"} value={draft.thirdColumnWidth} onChange={(event) => updateDraft("thirdColumnWidth", Number(event.target.value))} /></Field>
                <Field label="最小行高 (px)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={18} max={80} value={draft.minRowHeight} onChange={(event) => updateDraft("minRowHeight", Number(event.target.value))} /></Field>
                <SettingSwitch label="单元格自动换行" checked={draft.cellWrap} onCheckedChange={(checked) => updateDraft("cellWrap", checked)} />
                <Field label="单元格左右内边距"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" value={draft.cellPaddingX} onChange={(event) => updateDraft("cellPaddingX", Number(event.target.value))} /></Field>
                <Field label="单元格上下内边距"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" value={draft.cellPaddingY} onChange={(event) => updateDraft("cellPaddingY", Number(event.target.value))} /></Field>
              </div>
            </PropertyCard>

            <PropertyCard title="边框与网格线">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="边框线样式"><Select value={draft.borderStyle} onValueChange={(value) => updateDraft("borderStyle", value as StyleDraft["borderStyle"])}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent>{borderStyleOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="边框粗细 (px)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={6} step={0.5} value={draft.borderWidth} onChange={(event) => updateDraft("borderWidth", Number(event.target.value))} /></Field>
                <Field label="边框颜色"><WordColorPicker value={draft.borderColor} onChange={(value) => updateDraft("borderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="上边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.borderTopWidth} onChange={(event) => updateDraft("borderTopWidth", Number(event.target.value))} /></Field>
                <Field label="右边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.borderRightWidth} onChange={(event) => updateDraft("borderRightWidth", Number(event.target.value))} /></Field>
                <Field label="下边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.borderBottomWidth} onChange={(event) => updateDraft("borderBottomWidth", Number(event.target.value))} /></Field>
                <Field label="左边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.borderLeftWidth} onChange={(event) => updateDraft("borderLeftWidth", Number(event.target.value))} /></Field>
                <Field label="表头边框颜色"><WordColorPicker value={draft.headerBorderColor} onChange={(value) => updateDraft("headerBorderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="表头边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.headerBorderWidth} onChange={(event) => updateDraft("headerBorderWidth", Number(event.target.value))} /></Field>
                <Field label="表体边框颜色"><WordColorPicker value={draft.bodyBorderColor} onChange={(value) => updateDraft("bodyBorderColor", value)} autoColor="#CBD5E1" /></Field>
                <Field label="表体边框粗细"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0} max={8} step={0.5} value={draft.bodyBorderWidth} onChange={(event) => updateDraft("bodyBorderWidth", Number(event.target.value))} /></Field>
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
                  <Field label="表头行高"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={draft.headerLineHeight} onChange={(event) => updateDraft("headerLineHeight", event.target.value)} /></Field>
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
                  <Field label="表格体行高"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={draft.bodyLineHeight} onChange={(event) => updateDraft("bodyLineHeight", event.target.value)} /></Field>
                  <Field label="表格体底色"><WordColorPicker value={draft.bodyBackgroundColor} onChange={(value) => updateDraft("bodyBackgroundColor", value)} autoColor="#FFFFFF" /></Field>
                </div>
              </PropertyCard>
            ) : null}

          </>
        ) : null}

        {isCaption ? (
          <PropertyCard title={isTableCaption ? "表格题注规则" : "图片题注规则"}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="题注位置">
                <Select value={draft.captionPosition} onValueChange={(value) => updateDraft("captionPosition", value as typeof draft.captionPosition)}>
                  <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                  <SelectContent>{captionPositionOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="题注对齐"><SimpleAlignSelect value={draft.captionAlign} onChange={(value) => updateDraft("captionAlign", value)} /></Field>
              <SettingSwitch label="题注自动编号" checked={draft.captionNumbering} onCheckedChange={(checked) => updateDraft("captionNumbering", checked)} />
              <Field label="编号格式">
                <Select value={draft.captionNumberFormat} onValueChange={(value) => updateDraft("captionNumberFormat", value)}>
                  <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                  <SelectContent>{captionNumberFormatOptions.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
          </PropertyCard>
        ) : null}

        {isHeading ? (
          <PropertyCard title={`编号与层级（当前 ${activeHeadingLevel} 级）`}>
            <SettingSwitch label="自动编号" checked={draft.autoNumbering} onCheckedChange={handleAutoNumberingChange} />
            <Field label="编号格式"><Select value={draft.numberFormat} onValueChange={handleNumberFormatChange}><SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger><SelectContent>{numberFormatOptions.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}</SelectContent></Select></Field>
            {isHeading ? (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/12 dark:text-indigo-200">
                当前标题建议编号：<span className="font-semibold">{getDefaultNumberFormat(draft.styleId)}</span>
                {draft.numberFormat !== getDefaultNumberFormat(draft.styleId) ? <Button type="button" variant="link" className="ml-1 h-auto p-0 text-xs font-semibold text-indigo-700 dark:text-indigo-200" onClick={applyHeadingLevelNumbering}>恢复层级编号</Button> : null}
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
    <aside className="flex min-h-0 flex-col overflow-hidden bg-slate-50/80 px-4 py-4 dark:bg-zinc-900/70 max-lg:min-h-[430px] max-lg:shrink-0 max-lg:border-t max-lg:border-slate-200 md:max-lg:col-span-2 dark:max-lg:border-zinc-800">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <p className="text-sm font-semibold text-slate-400 dark:text-zinc-500">实时预览（{formatPaperPreviewLabel(styleConfig.pageSettings)}）</p>
        <div className="flex shrink-0 items-center gap-3 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-none">
          <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value - previewZoomStep))} disabled={zoom <= previewZoomMin} title="缩小预览" aria-label="缩小预览"><ZoomOut className="size-4 text-slate-500 dark:text-zinc-400" /></Button>
          <span className="w-10 text-center text-xs font-bold text-slate-500 dark:text-zinc-400">{zoom}%</span>
          <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setZoom((value) => clampPreviewZoom(value + previewZoomStep))} disabled={zoom >= previewZoomMax} title="放大预览" aria-label="放大预览"><ZoomIn className="size-4 text-slate-500 dark:text-zinc-400" /></Button>
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
    <div className="grid h-10 grid-cols-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          className={cn("flex items-center justify-center border-r border-slate-200 last:border-r-0 dark:border-zinc-700", value === optionValue ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-200" : "text-slate-400 hover:bg-white hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200")}
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
      <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
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
      <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
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
    <section className="border-t border-slate-200 pt-4 dark:border-zinc-800">
      <h4 className="mb-3 flex items-center justify-between gap-2 text-[15px] font-bold text-slate-950 dark:text-zinc-50"><span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-indigo-600 dark:text-indigo-300" />{title}</span><ChevronDown className="size-4 text-slate-400 dark:text-zinc-500" /></h4>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1.5"><Label className="block text-sm leading-5 text-slate-700 dark:text-zinc-300">{label}</Label>{children}</div>;
}

function SettingSwitch({ label, checked, onCheckedChange, disabled = false }: { label: string; checked: boolean; onCheckedChange?: (checked: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 text-sm text-slate-700 dark:text-zinc-300"><span>{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>;
}

function TabScrollArea({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-auto p-5 xl:p-6">{children}</div>;
}

function TemplateInfoPanel({
  template,
  groups,
  canEdit,
  name,
  setName,
  category,
  setCategory,
  tagsText,
  setTagsText,
  description,
  setDescription,
  referenceDocxPath,
  setReferenceDocxPath,
  onSelectReferenceDocx,
  onUseDefaultStyle,
  onGoStyles,
  disabled,
}: {
  template?: Template;
  groups: string[];
  canEdit: boolean;
  name: string;
  setName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  tagsText: string;
  setTagsText: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  referenceDocxPath: string;
  setReferenceDocxPath: (value: string) => void;
  onSelectReferenceDocx: () => void;
  onUseDefaultStyle: () => void;
  onGoStyles: () => void;
  disabled: boolean;
}) {
  const categoryOptions = groups.filter((group) => group !== "全部" && group !== "系统");
  const locked = !canEdit || disabled;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <PanelCard title="模板信息">
          {template?.isBuiltIn ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200">
              系统模板的名称和 Word 底稿已锁定，可在其他页面继续调整样式。
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="模板名称">
              <Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={name} onChange={(event) => setName(event.target.value)} disabled={locked} placeholder="例如：课程论文模板" />
            </Field>
            <Field label="分组">
              <Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={category} list="template-style-groups" onChange={(event) => setCategory(event.target.value)} disabled={locked} placeholder="未分组" />
              <datalist id="template-style-groups">
                {categoryOptions.map((group) => <option key={group} value={group} />)}
              </datalist>
            </Field>
          </div>
          <Field label="标签">
            <Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={tagsText} onChange={(event) => setTagsText(event.target.value)} disabled={locked} placeholder="多个标签用 / 或逗号分隔" />
          </Field>
          <Field label="简介">
            <Textarea className="min-h-24 resize-none rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={description} onChange={(event) => setDescription(event.target.value)} disabled={locked} placeholder="说明这个模板适合什么文档、来源和使用场景" />
          </Field>
        </PanelCard>

        <PanelCard title="Word/WPS 底稿">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm leading-5 text-slate-700 dark:text-zinc-300">
              <FileText className="size-4 text-indigo-600 dark:text-indigo-300" />
              reference.docx
            </Label>
            <div className="flex gap-2 max-sm:flex-col">
              <Input className="h-10 min-w-0 rounded-lg bg-slate-50 dark:bg-zinc-900/72" value={referenceDocxPath} onChange={(event) => setReferenceDocxPath(event.target.value)} disabled={locked} placeholder="选择或填写 .docx 文件路径" />
              <SoftActionButton className="h-10 shrink-0 rounded-lg" disabled={locked} onClick={onSelectReferenceDocx}>
                <Upload className="size-4" />
                选择文件
              </SoftActionButton>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-500 dark:text-zinc-400">
            这里的 DOCX 会作为导出时的 Word 参考底稿。用户导入老师或单位给的 Word 模板后，可以继续在后面的样式页微调标题、正文、列表、代码块和页面设置。
          </p>
        </PanelCard>
      </div>

      <div className="space-y-5">
        <PanelCard title="样式来源">
          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/72 dark:hover:bg-zinc-900"
              onClick={onGoStyles}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-white text-indigo-600 dark:border-indigo-500/40 dark:bg-zinc-950 dark:text-indigo-300">
                <Palette className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950 dark:text-zinc-50">继续手动编辑样式</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-zinc-400">进入标题、正文、列表、表格和代码块的详细设置。</span>
              </span>
            </button>
            <button
              type="button"
              className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/72 dark:hover:bg-zinc-900"
              onClick={onUseDefaultStyle}
              disabled={disabled}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                <SlidersHorizontal className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950 dark:text-zinc-50">使用默认样式</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-zinc-400">恢复为内置默认样式，再按需要继续调整。</span>
              </span>
            </button>
          </div>
        </PanelCard>

        <PanelCard title="当前状态">
          <div className="space-y-2 text-sm">
            <InfoRow label="类型" value={template?.isBuiltIn ? "系统模板" : "自定义模板"} />
            <InfoRow label="底稿" value={referenceDocxPath.trim() ? "已设置 Word 底稿" : "未设置 Word 底稿"} />
            <InfoRow label="默认" value={template?.isDefault ? "当前默认模板" : "非默认模板"} />
          </div>
        </PanelCard>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-zinc-900/72">
      <span className="text-slate-500 dark:text-zinc-400">{label}</span>
      <span className="truncate font-medium text-slate-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}

function PageSettingsPanel({ pageSettings, patchPageSettings }: { pageSettings: PageSettingsDraft; patchPageSettings: (patch: Partial<PageSettingsDraft>) => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PanelCard title="纸张">
        <Field label="纸张大小">
          <Select value={pageSettings.paperSize} onValueChange={(value) => patchPageSettings({ paperSize: value as PageSettingsDraft["paperSize"] })}>
          <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {paperSizeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex w-full items-center justify-between gap-4">
                    <span>{option.label}</span>
                    <span className="text-xs text-slate-400 dark:text-zinc-500">{option.description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="方向">
          <div className="grid h-10 grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900/72">
            {([
              ["portrait", "纵向"],
              ["landscape", "横向"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "flex items-center justify-center border-r border-slate-200 text-sm font-semibold last:border-r-0 dark:border-zinc-700",
                  pageSettings.orientation === value ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-200" : "text-slate-500 hover:bg-white hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
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
          <Field label="上边距 (cm)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginTop} onChange={(event) => patchPageSettings({ marginTop: Number(event.target.value) })} /></Field>
          <Field label="下边距 (cm)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginBottom} onChange={(event) => patchPageSettings({ marginBottom: Number(event.target.value) })} /></Field>
          <Field label="左边距 (cm)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginLeft} onChange={(event) => patchPageSettings({ marginLeft: Number(event.target.value) })} /></Field>
          <Field label="右边距 (cm)"><Input className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72" type="number" min={0.5} max={8} step={0.1} value={pageSettings.marginRight} onChange={(event) => patchPageSettings({ marginRight: Number(event.target.value) })} /></Field>
        </div>
      </PanelCard>

      <PanelCard title="页眉页脚">
        <SettingSwitch label="启用页眉" checked={pageSettings.headerEnabled} onCheckedChange={(checked) => patchPageSettings({ headerEnabled: checked })} />
        <Field label="自定义页眉文本">
          <Input
            className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"
            placeholder="例如：项目报告 / 公司名称"
            value={pageSettings.headerText}
            disabled={!pageSettings.headerEnabled}
            onChange={(event) => patchPageSettings({ headerText: event.target.value })}
          />
        </Field>
        <SettingSwitch label="启用页脚" checked={pageSettings.footerEnabled} onCheckedChange={(checked) => patchPageSettings({ footerEnabled: checked })} />
        {pageSettings.footerEnabled ? (
          <>
            <Field label="页脚文本">
              <Input
                className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"
                placeholder="可留空，仅显示页码"
                value={pageSettings.footerText}
                onChange={(event) => patchPageSettings({ footerText: event.target.value })}
              />
            </Field>
            <Field label="页码格式">
              <Select value={pageSettings.footerPageNumberFormat} onValueChange={(value) => patchPageSettings({ footerPageNumberFormat: value as PageSettingsDraft["footerPageNumberFormat"] })}>
                <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {footerPageNumberFormats.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : null}
        <Field label="起始页码（目录/页脚）">
          <Input
            className="h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"
            type="number"
            min={1}
            max={999}
            step={1}
            value={pageSettings.footerStartPage}
            onChange={(event) => patchPageSettings({ footerStartPage: Number(event.target.value) })}
          />
        </Field>
        <p className="text-xs leading-5 text-slate-500 dark:text-zinc-400">目录页码和页脚页码共用这个起始值；页脚文本可和页码一起显示。</p>
      </PanelCard>

      <PanelCard title="目录">
        <SettingSwitch label="生成目录" checked={pageSettings.tocEnabled} onCheckedChange={(checked) => patchPageSettings({ tocEnabled: checked })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="目录深度">
            <Select value={pageSettings.tocDepth} onValueChange={(value) => patchPageSettings({ tocDepth: value })} disabled={!pageSettings.tocEnabled}>
              <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1-2">1-2 级标题</SelectItem>
                <SelectItem value="1-3">1-3 级标题</SelectItem>
                <SelectItem value="1-4">1-4 级标题</SelectItem>
                <SelectItem value="1-6">1-6 级标题</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="目录引导符">
            <Select value={pageSettings.tocLeader} onValueChange={(value) => patchPageSettings({ tocLeader: value as PageSettingsDraft["tocLeader"] })} disabled={!pageSettings.tocEnabled || !pageSettings.tocShowPageNumbers}>
              <SelectTrigger className="h-10 w-full data-[size=default]:h-10 rounded-lg bg-slate-50 dark:bg-zinc-900/72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tocLeaderOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <SettingSwitch label="显示目录页码" checked={pageSettings.tocShowPageNumbers} disabled={!pageSettings.tocEnabled} onCheckedChange={(checked) => patchPageSettings({ tocShowPageNumbers: checked })} />
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500 dark:border-zinc-700/70 dark:bg-zinc-900/72 dark:text-zinc-400">
          目录会插入在正文开头；目录中的页码由 Word 字段计算，起始页码跟随“起始页码（目录/页脚）”：第 {Math.max(1, Math.trunc(pageSettings.footerStartPage || 1))} 页。
        </div>
      </PanelCard>

    </div>
  );
}

function MappingPanel({
  markdownFeatures,
  patchMarkdownFeatures,
  onEditStyle,
}: {
  markdownFeatures: MarkdownFeatureSettings;
  patchMarkdownFeatures: (patch: Partial<MarkdownFeatureSettings>) => void;
  onEditStyle: (styleId: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <AppSurface variant="plain" radius="sm" padding="none" className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold">Markdown 识别规则</h3>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-zinc-700 dark:bg-zinc-900/72 dark:text-zinc-400">固定识别 · 样式可改</span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {markdownMappings.map(([from, to]) => {
            const styleId = markdownMappingStyleIds[to];
            return (
              <div key={from} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-zinc-700/70 dark:bg-zinc-900/72">
                <div className="flex items-center justify-between gap-3">
                  <code className="text-[var(--app-primary)]">{from}</code>
                  <span className="text-slate-400 dark:text-zinc-500">-&gt;</span>
                  <span className="font-semibold">{to}</span>
                </div>
                {styleId ? (
                  <button
                    type="button"
                    className="h-8 justify-self-end rounded-md px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-[var(--app-primary)] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-[var(--app-primary)]"
                    onClick={() => onEditStyle(styleId)}
                  >
                    编辑样式
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </AppSurface>

      <PanelCard title="可编辑规则">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700/70 dark:bg-zinc-900/72">
          <div className="space-y-3">
            <SettingSwitch label="启用行内代码样式" checked={markdownFeatures.inlineCode} onCheckedChange={(checked) => patchMarkdownFeatures({ inlineCode: checked })} />
            <SettingSwitch label="启用代码块样式" checked={markdownFeatures.codeBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ codeBlock: checked })} />
            <SettingSwitch label="启用引用块样式" checked={markdownFeatures.quoteBlock} onCheckedChange={(checked) => patchMarkdownFeatures({ quoteBlock: checked })} />
            <SettingSwitch label="保留分割线" checked={markdownFeatures.horizontalRule} onCheckedChange={(checked) => patchMarkdownFeatures({ horizontalRule: checked })} />
          </div>
        </div>
        <div className="grid gap-2 text-xs text-slate-500 dark:text-zinc-400">
          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-zinc-900/72">关闭行内代码、代码块或引用块后，导出时会按普通正文处理。</div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-zinc-900/72">标题、正文、列表、表格这些 Markdown 语义本身不改；要改外观，点左侧规则里的“编辑样式”。</div>
        </div>
      </PanelCard>
    </div>
  );
}

function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return <AppSurface as="section" variant="plain" radius="sm" padding="none" className="space-y-4 p-5"><h3 className="font-bold text-slate-950 dark:text-zinc-50">{title}</h3>{children}</AppSurface>;
}

function normalizeTemplateTags(category: string, tagsText: string) {
  const group = category.trim() || "未分组";
  const tags = tagsText
    .split(/[\/,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => tag !== group);
  return Array.from(new Set([group, ...tags]));
}
