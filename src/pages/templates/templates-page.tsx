import { useEffect, useMemo, useState, type CSSProperties, type WheelEvent } from "react";
import { CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FilePlus, FolderCog, Palette, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { WorkspacePageHeader } from "@/components/layout/page-header";
import { appPageMeta } from "@/components/layout/page-meta";
import { TemplateGalleryCard } from "@/components/templates/template-gallery-card";
import { TemplateEditDrawer } from "@/components/templates/template-edit-drawer";
import { TemplateImportDialog } from "@/components/templates/template-import-dialog";
import { TemplateStyleManager } from "@/components/templates/template-style-manager";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { WordPreviewToolbar } from "@/components/templates/word-preview-toolbar";
import { ResizableDivider } from "@/components/layout/resizable-divider";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { getTemplateStyleConfig, getTemplateStyleConfigs, importTemplate, listTemplates, saveAppConfig, saveTemplates } from "@/lib/tauri";
import { getTemplateCategory, getTemplateGroups, isFixedTemplateGroup, loadCustomTemplateGroups, saveCustomTemplateGroups, toTemplateGroupName } from "@/lib/template-categories";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { ImportTemplateRequest, Template, TemplateStyleConfig } from "@/types";

type PreviewPaperTheme = "light" | "dark";

const templatePreviewZoomMin = 20;
const templatePreviewZoomMax = 200;
const templatePreviewZoomStep = 10;
const templatePreviewMinWidth = 320;
const templatePreviewMaxWidth = 560;

function clampTemplatePreviewZoom(value: number) {
  return Math.min(templatePreviewZoomMax, Math.max(templatePreviewZoomMin, value));
}

function removeGroupTag(tags: string[], group: string) {
  return tags.filter((tag) => tag !== group);
}

function applyGroupToTemplate(template: Template, group: string) {
  const category = getTemplateCategory(template.tags, template.isBuiltIn);
  const nextTags = removeGroupTag(template.tags, category);
  return {
    ...template,
    tags: [group, ...nextTags],
    updatedAt: new Date().toISOString(),
  };
}

function GroupManageDialog({
  open,
  groups,
  onOpenChange,
  onCreate,
  onDelete,
}: {
  open: boolean;
  groups: string[];
  onOpenChange: (open: boolean) => void;
  onCreate: (group: string) => void;
  onDelete: (group: string) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) {
      setDraft("");
    }
  }, [open]);

  function handleCreate() {
    const group = toTemplateGroupName(draft);
    if (!group) {
      toast.error("请先填写分组名称");
      return;
    }
    onCreate(group);
    setDraft("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">分组管理</DialogTitle>
          <DialogDescription>统一管理模板分组。系统分组不可删除，自定义分组会排在已有分组后面。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-template-group">新增分组</Label>
            <div className="flex gap-2">
              <Input id="new-template-group" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：客户方案 / 内部周报" />
              <PrimaryActionButton onClick={handleCreate}>
                <Plus className="size-4" />
                添加
              </PrimaryActionButton>
            </div>
          </div>

          <div className="space-y-2">
            <Label>现有分组</Label>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700/70 dark:bg-zinc-900/72">
              {groups.map((group) => {
                const fixed = isFixedTemplateGroup(group);
                return (
                  <div key={group} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-zinc-700/70 dark:bg-zinc-800/70">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-zinc-50">{group}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400">{fixed ? "系统分组，固定保留" : "自定义分组，可删除"}</p>
                    </div>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200" disabled={fixed} onClick={() => onDelete(group)}>
                      <Trash2 className="size-4" />
                      删除
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesPage() {
  const { templates, currentTemplateId, appConfig, setActivePage, setCurrentTemplateId, setTemplates, setAppConfig } = useAppStore();
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [dialogMode, setDialogMode] = useState<"import" | "create">("import");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | undefined>();
  const [styleTemplate, setStyleTemplate] = useState<Template | undefined>();
  // 从「编辑样式」这类明确指向样式的入口进来时，直接落在样式 tab；
  // 通用入口（工具栏、卡片菜单的「样式管理器」）仍从模板信息开始。
  const [styleTemplateTab, setStyleTemplateTab] = useState<"info" | "styles">("info");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [templatePage, setTemplatePage] = useState(1);
  const [templatePageSize, setTemplatePageSize] = useState(12);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | undefined>(currentTemplateId ?? appConfig?.defaultTemplateId);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(currentTemplateId ?? appConfig?.defaultTemplateId ?? "default-report"));
  const [cardPreviewStyleConfigs, setCardPreviewStyleConfigs] = useState<Record<string, TemplateStyleConfig>>({});
  const [templatePreviewWidth, setTemplatePreviewWidth] = useState(templatePreviewMaxWidth);
  const [templatePreviewZoom, setTemplatePreviewZoom] = useState(60);
  const [templatePreviewPaperThemeOverride, setTemplatePreviewPaperThemeOverride] = useState<PreviewPaperTheme | undefined>(undefined);
  const isDark = (appConfig?.themeMode ?? "light") === "dark"
    || ((appConfig?.themeMode ?? "light") === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const templatePreviewPaperTheme = templatePreviewPaperThemeOverride ?? (isDark ? "dark" : "light");

  useEffect(() => {
    setCustomGroups(loadCustomTemplateGroups());
  }, []);

  const groups = useMemo(() => getTemplateGroups(templates, customGroups), [customGroups, templates]);

  useEffect(() => {
    // filter 总会返回新数组，无条件 set 会让 selectedGroups 每次换引用，
    // 进而连锁把分页重置到第 1 页 —— 内容没变时必须保持原引用。
    setSelectedGroups((current) => {
      const next = current.filter((group) => groups.includes(group));
      return next.length === current.length ? current : next;
    });
  }, [groups]);

  const filterGroups = useMemo(() => groups.filter((group) => group !== "全部"), [groups]);
  const selectedGroupSet = useMemo(() => new Set(selectedGroups), [selectedGroups]);

  const filteredTemplates = useMemo(() => {
    if (selectedGroups.length === 0) return templates;
    return templates.filter((template) => selectedGroupSet.has(getTemplateCategory(template.tags, template.isBuiltIn)));
  }, [selectedGroupSet, selectedGroups.length, templates]);

  const templatePageCount = Math.max(1, Math.ceil(filteredTemplates.length / templatePageSize));
  const currentTemplatePage = Math.min(templatePage, templatePageCount);
  const templatePageStart = (currentTemplatePage - 1) * templatePageSize;
  const pagedTemplates = useMemo(
    () => filteredTemplates.slice(templatePageStart, templatePageStart + templatePageSize),
    [filteredTemplates, templatePageSize, templatePageStart],
  );
  const pagedTemplateIds = useMemo(() => pagedTemplates.map((template) => template.id), [pagedTemplates]);

  const filteredTemplateIds = useMemo(() => filteredTemplates.map((template) => template.id), [filteredTemplates]);
  const filteredTemplateIdSet = useMemo(() => new Set(filteredTemplateIds), [filteredTemplateIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedFilteredCount = selectedIds.filter((id) => filteredTemplateIdSet.has(id)).length;
  const isCurrentGroupAllSelected = filteredTemplateIds.length > 0 && filteredTemplateIds.every((id) => selectedIdSet.has(id));
  // 预览面板跟随的是用户选中的模板本身，不能只在当前页里找 ——
  // 否则翻页后选中项不在本页，预览会静默跳到别的模板。
  const highlightedTemplate = filteredTemplates.find((item) => item.id === previewTemplateId)
    ?? filteredTemplates.find((item) => item.id === currentTemplateId)
    ?? filteredTemplates.find((item) => item.isDefault)
    ?? pagedTemplates[0];

  useEffect(() => {
    setTemplatePage(1);
  }, [selectedGroups]);

  useEffect(() => {
    if (templatePage > templatePageCount) setTemplatePage(templatePageCount);
  }, [templatePage, templatePageCount]);

  useEffect(() => {
    if (highlightedTemplate || templates.length === 0) return;
    setPreviewTemplateId(currentTemplateId ?? appConfig?.defaultTemplateId ?? templates[0]?.id);
  }, [appConfig?.defaultTemplateId, currentTemplateId, highlightedTemplate, templates]);

  useEffect(() => {
    if (!highlightedTemplate) return;
    let cancelled = false;
    setPreviewStyleConfig(mergeTemplateStyleConfig(highlightedTemplate.id));
    void getTemplateStyleConfig(highlightedTemplate.id)
      .then((storedConfig) => {
        if (!cancelled) setPreviewStyleConfig(mergeTemplateStyleConfig(highlightedTemplate.id, storedConfig ?? undefined));
      })
      .catch(() => {
        if (!cancelled) setPreviewStyleConfig(mergeTemplateStyleConfig(highlightedTemplate.id));
      });

    return () => {
      cancelled = true;
    };
  }, [highlightedTemplate]);

  useEffect(() => {
    if (pagedTemplateIds.length === 0) {
      setCardPreviewStyleConfigs({});
      return;
    }

    let cancelled = false;
    setCardPreviewStyleConfigs((current) => {
      const next: Record<string, TemplateStyleConfig> = {};
      for (const id of pagedTemplateIds) {
        next[id] = current[id] ?? mergeTemplateStyleConfig(id);
      }
      return next;
    });

    void getTemplateStyleConfigs(pagedTemplateIds)
      .then((storedConfigs) => {
        if (cancelled) return;
        setCardPreviewStyleConfigs(Object.fromEntries(
          pagedTemplateIds.map((id) => [id, mergeTemplateStyleConfig(id, storedConfigs[id])]),
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setCardPreviewStyleConfigs(Object.fromEntries(
          pagedTemplateIds.map((id) => [id, mergeTemplateStyleConfig(id)]),
        ));
      });

    return () => {
      cancelled = true;
    };
  }, [pagedTemplateIds, styleTemplate?.id]);

  function syncCustomGroups(nextGroups: string[]) {
    setCustomGroups(nextGroups);
    saveCustomTemplateGroups(nextGroups);
  }

  function openDialog(mode: "import" | "create") {
    setDialogMode(mode);
    setDialogOpen(true);
  }

  function useTemplate(template: Template) {
    setPreviewTemplateId(template.id);
    setCurrentTemplateId(template.id);
    setActivePage("convert");
    toast.success(`已选择「${template.name}」作为本次转换模板`);
  }

  async function persistTemplates(nextTemplates: Template[]) {
    const saved = await saveTemplates(nextTemplates);
    setTemplates(saved);
    return saved;
  }

  async function setDefaultTemplate(template: Template) {
    if (!appConfig) {
      toast.error("配置正在加载，请稍后再试");
      return;
    }
    const nextConfig = { ...appConfig, defaultTemplateId: template.id };
    try {
      const savedConfig = await saveAppConfig(nextConfig);
      setAppConfig(savedConfig);
      setPreviewTemplateId(template.id);
      await persistTemplates(templates.map((item) => ({ ...item, isDefault: item.id === template.id })));
      toast.success(`已将「${template.name}」设为默认模板`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "保存默认模板失败"));
    }
  }

  async function saveTemplateEdit(template: Template) {
    const nextTemplates = template.isDefault
      ? templates.map((item) => ({ ...item, ...(item.id === template.id ? template : {}), isDefault: item.id === template.id }))
      : templates.map((item) => item.id === template.id ? template : item);

    if (template.isDefault && appConfig) {
      const savedConfig = await saveAppConfig({ ...appConfig, defaultTemplateId: template.id });
      setAppConfig(savedConfig);
    }

    await persistTemplates(nextTemplates);
    setPreviewTemplateId(template.id);
    setEditingTemplate(undefined);
  }

  async function saveTemplateFromStyleManager(template: Template) {
    await saveTemplateEdit(template);
    setStyleTemplate(template);
  }

  function openStyleManager(template: Template | undefined, tab: "info" | "styles") {
    if (!template) return;
    setStyleTemplateTab(tab);
    setStyleTemplate(template);
  }

  function toggleTemplatePreviewPaperTheme() {
    setTemplatePreviewPaperThemeOverride(templatePreviewPaperTheme === "dark" ? "light" : "dark");
  }

  function handleTemplatePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setTemplatePreviewZoom((value) => clampTemplatePreviewZoom(value + direction * templatePreviewZoomStep));
  }

  async function handleImport(request: ImportTemplateRequest) {
    const template = await importTemplate(request);
    if (request.isDefault && appConfig) {
      setAppConfig({ ...appConfig, defaultTemplateId: template.id });
    }
    try {
      const nextTemplates = await listTemplates();
      setTemplates(nextTemplates);
    } catch {
      setTemplates([...templates, template]);
    }
    setPreviewTemplateId(template.id);
    return template;
  }

  async function handleCreate(request: Omit<ImportTemplateRequest, "referenceDocxPath">) {
    const now = new Date().toISOString();
    const template: Template = {
      id: `user-${Date.now()}`,
      name: request.name,
      description: request.description,
      referenceDocxPath: "",
      previewImagePath: undefined,
      tags: request.tags,
      isBuiltIn: false,
      isDefault: request.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const nextTemplates = request.isDefault ? templates.map((item) => ({ ...item, isDefault: false })).concat(template) : templates.concat(template);
    const savedTemplates = await persistTemplates(nextTemplates);
    if (request.isDefault && appConfig) {
      const savedConfig = await saveAppConfig({ ...appConfig, defaultTemplateId: template.id });
      setAppConfig(savedConfig);
      setTemplates(savedTemplates.map((item) => ({ ...item, isDefault: item.id === template.id })));
    }
    setPreviewTemplateId(template.id);
    return template;
  }

  async function deleteTemplates(ids: string[]) {
    const targetIdSet = new Set(ids);
    const targets = templates.filter((template) => targetIdSet.has(template.id));
    const protectedTargets = targets.filter((template) => template.isBuiltIn);
    if (protectedTargets.length > 0) {
      toast.error("系统模板不能删除，可以只删除用户创建或导入的模板");
      return;
    }
    if (targets.length === 0) return;
    const nextTemplates = templates.filter((template) => !targetIdSet.has(template.id));
    const fallbackTemplate = nextTemplates.find((template) => template.isDefault) ?? nextTemplates[0];
    const deletedDefault = appConfig ? targetIdSet.has(appConfig.defaultTemplateId) : false;
    const deletedCurrent = currentTemplateId ? targetIdSet.has(currentTemplateId) : false;

    try {
      await persistTemplates(nextTemplates);
      if (deletedDefault && appConfig && fallbackTemplate) {
        const savedConfig = await saveAppConfig({ ...appConfig, defaultTemplateId: fallbackTemplate.id });
        setAppConfig(savedConfig);
      }
      if (deletedCurrent) {
        setCurrentTemplateId(fallbackTemplate?.id);
      }
      setSelectedIds((current) => current.filter((id) => !targetIdSet.has(id)));
      if (previewTemplateId && targetIdSet.has(previewTemplateId)) setPreviewTemplateId(fallbackTemplate?.id);
      toast.success(`已删除 ${targets.length} 个模板`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "删除模板失败"));
    }
  }

  function toggleSelect(template: Template) {
    setSelectedIds((current) => current.includes(template.id) ? current.filter((id) => id !== template.id) : [...current, template.id]);
  }

  function selectCurrentGroup() {
    if (filteredTemplateIds.length === 0) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...filteredTemplateIds])));
  }

  function unselectCurrentGroup() {
    setSelectedIds((current) => current.filter((id) => !filteredTemplateIdSet.has(id)));
  }

  function toggleCurrentGroupSelection() {
    if (isCurrentGroupAllSelected) {
      unselectCurrentGroup();
    } else {
      selectCurrentGroup();
    }
  }

  function toggleGroupFilter(group: string) {
    setSelectedGroups((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group]);
  }

  function clearGroupFilter() {
    setSelectedGroups([]);
  }

  function handleCreateGroup(group: string) {
    if (groups.includes(group)) {
      toast.info(`分组「${group}」已存在`);
      return;
    }
    const nextGroups = [...customGroups, group];
    syncCustomGroups(nextGroups);
    setSelectedGroups([group]);
    toast.success(`已添加分组「${group}」`);
  }

  async function handleDeleteGroup(group: string) {
    if (isFixedTemplateGroup(group)) {
      toast.error("系统分组不可删除");
      return;
    }

    const targets = templates.filter((template) => getTemplateCategory(template.tags, template.isBuiltIn) === group);
    const nextTemplates = targets.length > 0
      ? templates.map((template) => getTemplateCategory(template.tags, template.isBuiltIn) === group ? applyGroupToTemplate(template, "未分组") : template)
      : templates;

    try {
      if (targets.length > 0) {
        await persistTemplates(nextTemplates);
      }

      const nextGroups = customGroups.filter((item) => item !== group);
      syncCustomGroups(nextGroups);
      setSelectedGroups((current) => current.filter((item) => item !== group));
      toast.success(targets.length > 0 ? `已删除分组「${group}」，相关模板已移到未分组` : `已删除分组「${group}」`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "删除模板分组失败"));
    }
  }

  if (styleTemplate) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        <TemplateStyleManager embedded template={styleTemplate} initialTab={styleTemplateTab} groups={groups} onSaveTemplate={saveTemplateFromStyleManager} onRequestClose={() => setStyleTemplate(undefined)} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
      <WorkspacePageHeader
        meta={appPageMeta.templates}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PrimaryActionButton>
                <Plus className="size-4" />
                新建模板
                <ChevronDown className="size-4" />
              </PrimaryActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => openDialog("create")}>
                <FilePlus className="size-4" />
                从空白创建
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog("import")}>
                <Upload className="size-4" />
                从 DOCX 导入
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <div
        className="mk-templates-workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_0px_minmax(320px,var(--template-preview-width))] gap-0 overflow-hidden"
        style={{ "--template-preview-width": `${templatePreviewWidth}px` } as CSSProperties}
      >
      <section className="mr-[5px] flex min-h-0 flex-col gap-1 overflow-hidden">

        <div className="mk-template-filter-panel flex shrink-0 flex-wrap items-center gap-2 rounded-[8px] border border-blue-100/60 bg-white p-2.5 dark:border-zinc-700/70 dark:bg-zinc-900/60">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="group h-9 w-[190px] justify-between border-white/70 bg-white/68 px-3 dark:border-zinc-700 dark:bg-zinc-900 max-[640px]:w-full">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {selectedGroups.length === 0 ? (
                    <span className="truncate px-1 text-slate-500 dark:text-zinc-400">全部分组</span>
                  ) : (
                    selectedGroups.slice(0, 2).map((group) => (
                      <span key={group} className="max-w-[70px] truncate rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-200">
                        {group}
                      </span>
                    ))
                  )}
                  {selectedGroups.length > 2 ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">+{selectedGroups.length - 2}</span> : null}
                </span>
                {selectedGroups.length > 0 ? (
                  <span
                    className="hidden size-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 group-hover:flex"
                    role="button"
                    tabIndex={-1}
                    aria-label="清空分组筛选"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      clearGroupFilter();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <X className="size-3.5" />
                  </span>
                ) : null}
                <ChevronDown className="size-4 shrink-0 text-slate-400 dark:text-zinc-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="p-2" align="start">
              <DropdownMenuItem className="justify-between text-slate-600 dark:text-zinc-300" onSelect={(event) => { event.preventDefault(); clearGroupFilter(); }}>
                显示全部分组
                {selectedGroups.length === 0 ? <span className="text-xs text-indigo-600 dark:text-indigo-300">当前</span> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {filterGroups.map((group) => (
                <DropdownMenuCheckboxItem
                  key={group}
                  checked={selectedGroupSet.has(group)}
                  onCheckedChange={() => toggleGroupFilter(group)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {group}
                </DropdownMenuCheckboxItem>
              ))}
              {selectedGroups.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-slate-500 dark:text-zinc-400" onSelect={(event) => { event.preventDefault(); clearGroupFilter(); }}>
                    <X className="size-4" />
                    清空选择
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setGroupDialogOpen(true)}>
                <FolderCog className="size-4" />
                分组管理
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex min-w-0 items-center max-[640px]:ml-0 max-[640px]:w-full">
            <Button variant="outline" className="h-9 min-w-0 border-white/70 bg-white/68 dark:border-zinc-700 dark:bg-zinc-900 max-[640px]:w-full" onClick={() => openStyleManager(highlightedTemplate, "info")} disabled={!highlightedTemplate}>
              <Palette className="size-4" />
              样式管理器
            </Button>
          </div>
        </div>

        <section className="mk-template-list-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-none dark:border-zinc-700/70 dark:bg-zinc-900/60">
          <div className="mk-template-list-toolbar flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-blue-100/70 px-3 py-2.5 dark:border-zinc-700/70">
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-300">
              <button
                type="button"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-lg border text-white transition",
                  isCurrentGroupAllSelected
                    ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                    : "border-blue-200 bg-white/70 hover:border-blue-300 hover:bg-white dark:border-zinc-600 dark:bg-zinc-900/70 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
                  filteredTemplateIds.length === 0 && "cursor-not-allowed opacity-45 hover:border-blue-200 hover:bg-white/70 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/70",
                )}
                disabled={filteredTemplateIds.length === 0}
                onClick={toggleCurrentGroupSelection}
                aria-label="全选当前筛选"
                aria-pressed={isCurrentGroupAllSelected}
              >
                {isCurrentGroupAllSelected ? <CheckSquare className="size-4" /> : null}
              </button>
              <span>全选当前筛选</span>
              <span className="text-slate-400 dark:text-zinc-500">{selectedFilteredCount}/{filteredTemplates.length}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "mk-template-batch-delete",
                selectedIds.length > 0 ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200" : "text-slate-600 dark:text-zinc-400",
              )}
              onClick={() => deleteTemplates(selectedIds)}
              disabled={selectedIds.length === 0}
            >
              <Trash2 className="size-4" />
              批量删除
            </Button>
          </div>

          {filteredTemplates.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-10 text-center text-sm text-slate-500 dark:text-zinc-400">
              <Plus className="mb-3 size-8 text-indigo-500 dark:text-indigo-300" />
              当前筛选下暂无模板。你可以创建一个自定义模板，或导入已有 DOCX 模板。
              <div className="mt-4 flex gap-2">
                <SoftActionButton onClick={() => openDialog("create")}>创建模板</SoftActionButton>
                <PrimaryActionButton onClick={() => openDialog("import")}>导入模板</PrimaryActionButton>
              </div>
          </div>
          ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1">
            {pagedTemplates.map((template) => (
              <TemplateGalleryCard
                key={template.id}
                template={template}
                previewStyleConfig={cardPreviewStyleConfigs[template.id]}
                isCurrent={currentTemplateId === template.id}
                isPreviewed={highlightedTemplate?.id === template.id}
                isSelected={selectedIdSet.has(template.id)}
                onPreview={(target) => setPreviewTemplateId(target.id)}
                onToggleSelect={toggleSelect}
                onUse={useTemplate}
                onSetDefault={setDefaultTemplate}
                onEdit={setEditingTemplate}
                onStyleManager={(target) => openStyleManager(target, "info")}
                onDelete={(target) => deleteTemplates([target.id])}
              />
            ))}
            </div>
          </div>
          )}

          <div className="mk-template-list-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-blue-100/70 px-3 py-2 text-xs text-slate-500 dark:border-zinc-700/70 dark:text-zinc-400">
            <span>
              {filteredTemplates.length === 0 ? "共 0 条" : `显示 ${templatePageStart + 1}-${Math.min(templatePageStart + templatePageSize, filteredTemplates.length)}，共 ${filteredTemplates.length} 条`}
            </span>
            <div className="ml-auto flex items-center justify-end gap-2">
              <Select
                value={String(templatePageSize)}
                onValueChange={(value) => {
                  setTemplatePageSize(Number(value));
                  setTemplatePage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[104px] rounded-[9px] border-slate-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-8" aria-label="每页显示模板数量">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[12, 24, 48, 96].map((size) => <SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <TooltipButton variant="ghost" size="icon-xs" onClick={() => setTemplatePage(1)} disabled={currentTemplatePage === 1} tooltip="第一页" aria-label="第一页">
                  <ChevronsLeft className="size-3.5" />
                </TooltipButton>
                <TooltipButton variant="ghost" size="icon-xs" onClick={() => setTemplatePage((page) => Math.max(1, page - 1))} disabled={currentTemplatePage === 1} tooltip="上一页" aria-label="上一页">
                  <ChevronLeft className="size-3.5" />
                </TooltipButton>
                <span className="min-w-[76px] text-center font-semibold text-slate-700 dark:text-zinc-200">第 {currentTemplatePage} / {templatePageCount} 页</span>
                <TooltipButton variant="ghost" size="icon-xs" onClick={() => setTemplatePage((page) => Math.min(templatePageCount, page + 1))} disabled={currentTemplatePage === templatePageCount} tooltip="下一页" aria-label="下一页">
                  <ChevronRight className="size-3.5" />
                </TooltipButton>
                <TooltipButton variant="ghost" size="icon-xs" onClick={() => setTemplatePage(templatePageCount)} disabled={currentTemplatePage === templatePageCount} tooltip="最后一页" aria-label="最后一页">
                  <ChevronsRight className="size-3.5" />
                </TooltipButton>
              </div>
            </div>
          </div>
        </section>
      </section>

      <ResizableDivider
        orientation="vertical"
        from="end"
        size={templatePreviewWidth}
        min={templatePreviewMinWidth}
        max={templatePreviewMaxWidth}
        onResize={setTemplatePreviewWidth}
        ariaLabel="调整模板 Word 预览宽度"
        className="mk-template-side-resizer"
      />

      <aside className="mk-template-side-panel flex min-h-0 flex-col overflow-hidden">
        <AppSurface as="section" padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950 dark:text-zinc-50">Word 预览</p>
              <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{highlightedTemplate?.name ?? "未选择模板"}</p>
            </div>
            <WordPreviewToolbar
              zoom={templatePreviewZoom}
              canZoomOut={templatePreviewZoom > templatePreviewZoomMin}
              canZoomIn={templatePreviewZoom < templatePreviewZoomMax}
              onZoomOut={() => setTemplatePreviewZoom((value) => clampTemplatePreviewZoom(value - templatePreviewZoomStep))}
              onZoomIn={() => setTemplatePreviewZoom((value) => clampTemplatePreviewZoom(value + templatePreviewZoomStep))}
              paperTheme={templatePreviewPaperTheme}
              onTogglePaperTheme={toggleTemplatePreviewPaperTheme}
              onOpenAdvancedStyle={() => openStyleManager(highlightedTemplate, "styles")}
            />
          </div>
          <div className="min-h-0 flex-1" onWheel={handleTemplatePreviewWheel}>
            <WordPreviewPage
              styleConfig={previewStyleConfig}
              zoom={templatePreviewZoom}
              paginate
              showHeader={false}
              interactiveViewport
              paperTheme={templatePreviewPaperTheme}
              className="mk-template-side-preview-card max-h-none min-h-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
              viewportClassName="mk-template-side-preview bg-transparent p-2 dark:bg-zinc-950/95 dark:ring-1 dark:ring-zinc-800/80"
            />
          </div>
        </AppSurface>
      </aside>

      <TemplateImportDialog
        open={dialogOpen}
        mode={dialogMode}
        groups={groups}
        onOpenChange={setDialogOpen}
        onImport={handleImport}
        onCreate={handleCreate}
        onComplete={(template) => {
          setPreviewTemplateId(template.id);
          openStyleManager(template, "info");
        }}
      />
      <TemplateEditDrawer
        open={Boolean(editingTemplate)}
        template={editingTemplate}
        groups={groups}
        onOpenChange={(open) => !open && setEditingTemplate(undefined)}
        onSave={saveTemplateEdit}
        onSetDefault={setDefaultTemplate}
        onOpenStyleManager={(template) => {
          setEditingTemplate(undefined);
          openStyleManager(template, "styles");
        }}
      />
      <GroupManageDialog open={groupDialogOpen} groups={groups.filter((group) => group !== "全部")} onOpenChange={setGroupDialogOpen} onCreate={handleCreateGroup} onDelete={(group) => void handleDeleteGroup(group)} />
      </div>
    </div>
  );
}
