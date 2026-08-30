import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Copy, FileSearch, FileText, FolderOpen, History, Info, LayoutTemplate, Loader2, MoreHorizontal, PanelsTopLeft, PenLine, Save, Settings, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { basename, dirname } from "@tauri-apps/api/path";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import { ConversionInputCard, type ConversionInputCardHandle, type EditorContentWidthMode } from "@/components/convert/conversion-input-card";
import { ImageDocumentViewer, MediaPreviewDialogHost } from "@/components/media/image-viewer";
import type { TableDisplayContext, TableWidthMode } from "@/components/editor/live-markdown-editor";
import { TableWidthModeIcon } from "@/components/editor/table-width-mode-icon";
import { RESIZABLE_PANEL_COLLAPSE_THRESHOLD } from "@/components/layout/resizable-divider";
import { TemplateStyleManager } from "@/components/templates/template-style-manager";
import { WordPreviewPage, type PreviewOutlineItem } from "@/components/templates/word-preview-page";
import { WordPreviewToolbar } from "@/components/templates/word-preview-toolbar";
import { AppSurface, PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipAnchor, TooltipButton } from "@/components/ui/tooltip";
import { clipboardReadErrorMessage } from "@/lib/clipboard-errors";
import { actionableConversionWarnings, buildDocxOutputName, buildDocxOutputNameFromPath, buildOutputPath } from "@/lib/convert-utils";
import { buildHistoryItem, limitHistory } from "@/lib/conversion-history";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { saveAppConfig, appendHistory, convertMarkdown, getTemplateStyleConfig, isTauriEnvironment, readMarkdownFileFromPath, revealOutputPath, selectDirectory, selectMarkdownFile, selectMarkdownFiles, selectMarkdownSavePath } from "@/lib/tauri";
import { parseVaultError, userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { registerVaultContentSink } from "@/hooks/use-open-vault-file";
import { useMediaQuery } from "@/hooks/use-media-query";
import { isImageDropPath, useTauriFileDrop } from "@/hooks/use-tauri-file-drop";
import { imageFileExtension, markdownImageReference } from "@/lib/image-files";
import { markdownFileAccept, preserveSupportedTextExtension, readMarkdownFile, stripSupportedTextExtension } from "@/lib/markdown-files";
import { inlineMermaidImages } from "@/lib/mermaid-export";
import { clampPageZoomPercent, PAGE_ZOOM_DEFAULT_PERCENT } from "@/lib/page-zoom";
import { vaultAbsolutePath } from "@/lib/vault-clipboard";
import { useVaultStore } from "@/stores/vault-store";
import { importVaultImageData, importVaultImageFromPath, readVaultFile, renameVaultEntry, resolveVaultImageSource, showInExplorer, writeVaultFile } from "@/lib/vault";
import { DocumentTabBar, type DocumentPageTab } from "@/components/editor/document-tab-bar";
import { deriveScratchTitle, useDocumentTabsStore, type DocumentTab } from "@/stores/document-tabs-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { documentLinkFragment, findMarkdownHeadingLine, isExternalDocumentLink, resolveVaultDocumentLink } from "@/lib/document-links";
import { markdownOutlineRevealEvent } from "@/lib/document-outline";
import type { ConvertResult, HistoryItem, Template, TemplateStyleConfig } from "@/types";
import type { VaultEol } from "@/types/vault";

type PreviewSidebarView = "pages" | "outline";
type PreviewPaperTheme = "light" | "dark";
const previewZoomMin = 20;
const previewZoomMax = 200;
const previewZoomStep = 10;
const previewWheelZoomStep = 5;
const previewMinWidth = 460;
const editorMinWidth = 360;
const inlinePreviewSidebarDividerWidth = 5;
// 预览页低于这个宽度时，底部操作区会被挤压；此时收起缩略图栏，
// 把空间留给 Word 页面和上下排列的转换控件。
const inlinePreviewPageMinWidth = 760;
// Word 预览会把整篇文档分页后全部挂进 DOM。超过该体量时保留编辑与导出，
// 避免长文档在每次内容变化后占满渲染线程。
const inlinePreviewCharacterLimit = 250_000;
const editorContentWidthModeStorageKey = "md-king.editor.compact-mode";
const previewContextMenuItemClass = "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800";
const editorContentWidthModes: EditorContentWidthMode[] = ["wide", "medium", "compact"];
const editorContentWidthModeLabels: Record<EditorContentWidthMode, string> = {
  wide: "展开排版",
  medium: "中等排版",
  compact: "紧凑排版",
};
const editorContentWidthIconBars: Record<EditorContentWidthMode, readonly string[]> = {
  wide: ["100%", "100%", "100%"],
  medium: ["100%", "64%", "100%"],
  compact: ["100%", "78%", "58%"],
};

/** Keep exported code badges consistent with the preview's uppercase labels. */
function normalizeCodeFenceLabels(markdown: string) {
  return markdown.replace(/^(\s*)(`{3,}|~{3,})([^\r\n]*)$/gm, (_line, indent: string, marker: string, info: string) => {
    const trimmed = info.trim();
    if (!trimmed) return `${indent}${marker}${info}`;
    const leading = info.slice(0, info.length - info.trimStart().length);
    const tokens = trimmed.split(/(\s+)/);
    const first = tokens.findIndex((token) => token.trim().length > 0);
    if (first < 0) return `${indent}${marker}${info}`;
    tokens[first] = tokens[first].toUpperCase();
    return `${indent}${marker}${leading}${tokens.join("")}`;
  });
}

function nextEditorContentWidthMode(mode: EditorContentWidthMode) {
  return editorContentWidthModes[(editorContentWidthModes.indexOf(mode) + 1) % editorContentWidthModes.length];
}

function EditorContentWidthIcon({ mode }: { mode: EditorContentWidthMode }) {
  return (
    <span aria-hidden="true" className="flex h-3 w-3.5 flex-col items-center justify-between">
      {editorContentWidthIconBars[mode].map((width, index) => (
        <span key={index} className="block h-0.5 rounded-full bg-current" style={{ width }} />
      ))}
    </span>
  );
}
const workspacePageTabs: DocumentPageTab[] = [
  { id: "templates", label: "模板中心", icon: LayoutTemplate },
  { id: "history", label: "转换历史", icon: History },
  { id: "settings", label: "设置", icon: Settings },
  { id: "about", label: "关于", icon: Info },
];

function clampPreviewZoom(value: number) {
  return Math.min(previewZoomMax, Math.max(previewZoomMin, value));
}

function stripMarkdownExtension(value: string) {
  return stripSupportedTextExtension(value);
}

function isAbsoluteFilePath(path: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

type SaveableVaultTab = DocumentTab & {
  kind: "vault";
  path: string;
  eol: VaultEol;
  hasBom: boolean;
  modifiedMs: number;
};

type SaveableExternalTab = DocumentTab & {
  kind: "vault";
  absolutePath: string;
};

function canSaveVaultTab(tab: DocumentTab | undefined, vaultRoot: string | undefined): tab is SaveableVaultTab {
  return Boolean(
    tab?.kind === "vault"
    && vaultRoot
    && tab.path
    && !isAbsoluteFilePath(tab.path)
    && tab.eol
    && tab.hasBom !== undefined
    && tab.modifiedMs !== undefined,
  );
}

function canSaveExternalTab(tab: DocumentTab | undefined): tab is SaveableExternalTab {
  // 外部路径打开的文件没有文件树读取时的编码元数据；写回函数会使用
  // LF/无 BOM 默认值，并在后续保存后记录新的修改时间。
  return Boolean(
    tab?.kind === "vault"
    && tab.absolutePath,
  );
}

type DocumentInfoBarProps = {
  tab?: DocumentTab;
  previewVisible: boolean;
  previewPaused: boolean;
  onTogglePreview: () => void;
  canSave: boolean;
  onSave: () => void;
  onCopyRelativePath: () => void;
  onCopyAbsolutePath: () => void;
  onRevealPath: () => void;
  onLocatePath: (path: string) => void;
  readingMode: boolean;
  onToggleReadingMode: () => void;
  contentWidthMode: EditorContentWidthMode;
  onCycleContentWidthMode: () => void;
  tableDisplayContext: TableDisplayContext;
  onTableWidthModeChange: (mode: TableWidthMode) => void;
};

function DocumentInfoBar({ tab, previewVisible, previewPaused, onTogglePreview, canSave, onSave, onCopyRelativePath, onCopyAbsolutePath, onRevealPath, onLocatePath, readingMode, onToggleReadingMode, contentWidthMode, onCycleContentWidthMode, tableDisplayContext, onTableWidthModeChange }: DocumentInfoBarProps) {
  const pathParts = (tab?.path ?? "").split(/[\\/]/).filter(Boolean);
  const relativePath = tab?.path && !isAbsoluteFilePath(tab.path) ? tab.path : undefined;
  const absolutePath = tab?.absolutePath ?? (tab?.path && isAbsoluteFilePath(tab.path) ? tab.path : undefined);
  const crumbs = pathParts.length > 0
    ? pathParts.map((part, index) => ({
        label: index === pathParts.length - 1 ? stripMarkdownExtension(part) : part,
        path: pathParts.slice(0, index + 1).join("/"),
      }))
    : tab
      ? [{ label: stripMarkdownExtension(tab.title), path: "" }]
      : [];
  const canLocate = tab?.kind === "vault" && Boolean(tab.path);
  const tableWidthScope = tableDisplayContext.tableFrom === null ? "全部表格" : "当前表格";
  const currentTableWidthModeLabel = tableDisplayContext.widthMode === "window" ? "根据窗口调整布局" : "根据内容调整布局";
  const nextTableWidthMode: TableWidthMode = tableDisplayContext.widthMode === "content" ? "window" : "content";
  const nextTableWidthModeLabel = nextTableWidthMode === "window" ? "根据窗口调整布局" : "根据内容调整布局";
  const tableWidthTooltip = `当前：${currentTableWidthModeLabel}；点击切换为${nextTableWidthModeLabel}（${tableWidthScope}）`;
  const tableWidthButtonClass = "size-7 rounded-[4px] border-0 bg-transparent p-0 text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900 active:bg-transparent dark:text-zinc-400 dark:hover:bg-transparent dark:hover:text-zinc-100";
  const previewToggleLabel = previewPaused
    ? `文档超过 ${inlinePreviewCharacterLimit.toLocaleString()} 字符，已暂停 Word 预览`
    : previewVisible ? "隐藏 Word 预览" : "显示 Word 预览";

  return (
    <div className="flex h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-slate-200 pl-3 pr-1.5 text-xs dark:border-zinc-800">
      <FileText className="size-3.5 shrink-0 text-slate-400 dark:text-zinc-500" />
      {crumbs.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.path}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3 shrink-0 text-slate-300 dark:text-zinc-600" /> : null}
              {canLocate ? (
                <TooltipAnchor content={`在文件树中定位：${crumb.label}`} tooltipSide="bottom">
                  <button
                    type="button"
                    className={cn("min-w-0 truncate rounded-[4px] px-0.5 py-0.5 text-left transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100", index === crumbs.length - 1 ? "font-semibold text-slate-700 dark:text-zinc-200" : "text-slate-500 dark:text-zinc-400")}
                    onClick={() => onLocatePath(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </TooltipAnchor>
              ) : (
                <span className={cn("truncate", index === crumbs.length - 1 ? "font-semibold text-slate-700 dark:text-zinc-200" : "text-slate-500 dark:text-zinc-400")}>{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      ) : (
        <span className="truncate text-slate-400 dark:text-zinc-500">选择或导入 Markdown 文档</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {tab ? (
          <div data-mk-table-width-controls className="mr-1 flex items-center gap-0.5 border-r border-slate-200 pr-1.5 dark:border-zinc-800">
            <TooltipButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className={tableWidthButtonClass}
              aria-label={tableWidthTooltip}
              tooltip={tableWidthTooltip}
              onClick={() => onTableWidthModeChange(nextTableWidthMode)}
            >
              <TableWidthModeIcon mode={tableDisplayContext.widthMode} className="size-[18px]" />
            </TooltipButton>
          </div>
        ) : null}
        <Button type="button" variant="ghost" size="icon-xs" className="size-7 rounded-[4px] border-0 bg-transparent p-0 shadow-none text-slate-500 hover:bg-transparent hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-transparent dark:hover:text-zinc-100" title={readingMode ? "编辑模式" : "阅读模式"} aria-label={readingMode ? "编辑模式" : "阅读模式"} aria-pressed={readingMode} onClick={onToggleReadingMode}>
          {readingMode ? <PenLine className="size-3.5" /> : <BookOpen className="size-3.5" />}
        </Button>
        <TooltipButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 rounded-[4px] border-0 bg-transparent p-0 text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900 active:bg-transparent dark:text-zinc-400 dark:hover:bg-transparent dark:hover:text-zinc-100"
          tooltip={`当前：${editorContentWidthModeLabels[contentWidthMode]}；点击切换为${editorContentWidthModeLabels[nextEditorContentWidthMode(contentWidthMode)]}`}
          aria-label={`当前：${editorContentWidthModeLabels[contentWidthMode]}；点击切换为${editorContentWidthModeLabels[nextEditorContentWidthMode(contentWidthMode)]}`}
          onClick={onCycleContentWidthMode}
        >
          <EditorContentWidthIcon mode={contentWidthMode} />
        </TooltipButton>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "mk-preview-toggle size-7 rounded-[4px] border-0 p-0 shadow-none",
            previewVisible
              ? "bg-slate-200 text-slate-700 hover:bg-slate-300 hover:text-slate-900 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600 dark:hover:text-white"
              : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          )}
          title={previewToggleLabel}
          aria-label={previewToggleLabel}
          aria-pressed={previewVisible}
          onClick={onTogglePreview}
        >
          <FileSearch className="size-4" strokeWidth={previewVisible ? 2.5 : 1.75} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7 rounded-[4px] border-0 bg-transparent p-0 shadow-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="更多文档操作"
              aria-label="更多文档操作"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={onSave} disabled={!canSave || !tab?.dirty}>
              <Save className="size-3.5 text-slate-500 dark:text-zinc-400" />
              保存文档
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!relativePath && !absolutePath}>
                <Copy className="size-3.5 text-slate-500 dark:text-zinc-400" />
                复制路径
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="min-w-40">
                  <DropdownMenuItem onSelect={onCopyRelativePath} disabled={!relativePath}>复制相对路径</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onCopyAbsolutePath} disabled={!absolutePath}>复制绝对路径</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onRevealPath} disabled={!tab?.absolutePath}>
              <FolderOpen className="size-3.5 text-slate-500 dark:text-zinc-400" />
              资源管理器中打开
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const fallbackTemplate: Template = {
  id: "default-report",
  name: "默认报告模板",
  description: "适合 AI 生成的通用报告、方案和说明文档。",
  referenceDocxPath: "",
  tags: ["系统", "内置"],
  isBuiltIn: true,
  isDefault: true,
  createdAt: "",
  updatedAt: "",
};

type ConvertPageProps = {
  workspaceContent?: ReactNode;
};

export function ConvertPage({ workspaceContent }: ConvertPageProps) {
  const { activePage, pageTabs, appConfig, templates, currentTemplateId, pendingImportPaths, setActivePage, closePageTab, closeOtherPageTabs, closeAllPageTabs, setAppConfig, setHistory, setCurrentTemplateId, clearPendingImportPaths } = useAppStore();
  const templateOptions = useMemo(() => (templates.length > 0 ? templates : [fallbackTemplate]), [templates]);
  const [templateId, setTemplateId] = useState(currentTemplateId || appConfig?.defaultTemplateId || fallbackTemplate.id);
  const tabs = useDocumentTabsStore((state) => state.tabs);
  const activeTabId = useDocumentTabsStore((state) => state.activeTabId);
  const openScratchTab = useDocumentTabsStore((state) => state.openScratchTab);
  const updateTabContent = useDocumentTabsStore((state) => state.updateTabContent);
  const markTabClean = useDocumentTabsStore((state) => state.markTabClean);
  const markTabSavedAs = useDocumentTabsStore((state) => state.markTabSavedAs);
  const openVaultTab = useDocumentTabsStore((state) => state.openVaultTab);
  const previewVisible = useVaultStore((state) => state.previewVisible);
  const setPreviewVisible = useVaultStore((state) => state.setPreviewVisible);
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const setActiveFileModifiedMs = useVaultStore((state) => state.setActiveFileModifiedMs);
  const setSaveState = useVaultStore((state) => state.setSaveState);
  // 窄屏下三栏挤不开，直接不渲染预览——不是藏起来而是不跑那条解析+分页管线。
  const isNarrow = useMediaQuery("(max-width: 1100px)");
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const [splitPaneWidth, setSplitPaneWidth] = useState(0);
  const pageZoomScale = clampPageZoomPercent(appConfig?.pageZoomPercent ?? PAGE_ZOOM_DEFAULT_PERCENT) / 100;
  const splitPaneTooNarrow = splitPaneWidth / pageZoomScale < editorMinWidth + previewMinWidth + 5;
  const layoutTooNarrow = isNarrow || splitPaneTooNarrow;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const isImageTab = activeTab?.kind === "image";
  const openWorkspaceTabs = workspacePageTabs.filter((tab) => pageTabs.includes(tab.id));
  const isDocumentWorkspace = activePage === "convert";
  const isWorkspacePage = activePage !== "convert" && workspaceContent !== undefined;
  // 正文的唯一来源是活动标签。revision 只在外部灌入内容时递增，
  // 用户逐字输入不动它——每次内容变化都让编辑器全量替换会打断输入、丢光标。
  const markdown = isImageTab ? "" : activeTab?.content ?? "";
  const documentTitle = isImageTab ? undefined : activeTab?.title;
  // 预览会完整解析并分页，长文档输入时允许它在编辑器更新后追赶；
  // 保存、导出、文件名推导仍必须使用 markdown，不能因此拿到旧内容。
  const deferredPreviewMarkdown = useDeferredValue(markdown);
  const previewPausedForLongDocument = markdown.length > inlinePreviewCharacterLimit;
  const showPreviewPanel = isDocumentWorkspace && !isImageTab && previewVisible && !layoutTooNarrow && !previewPausedForLongDocument;
  const markdownSourcePath = isImageTab ? undefined : activeTab?.absolutePath;
  const documentKey = activeTab ? `${activeTab.id}#${activeTab.revision}` : "empty";
  const canSaveActiveDocument = Boolean(activeTab && activeTab.kind !== "image");
  const canAutoSaveActiveDocument = canSaveVaultTab(activeTab, vaultRoot) || canSaveExternalTab(activeTab);
  const [activeImageSource, setActiveImageSource] = useState<string>();
  const [readingMode, setReadingMode] = useState(false);
  const [contentWidthMode, setContentWidthMode] = useState<EditorContentWidthMode>(() => {
    try {
      const savedMode = window.localStorage.getItem(editorContentWidthModeStorageKey);
      if (savedMode === "compact") return "compact";
      // 旧版只保存 true/false：原紧凑模式就是现在的中等宽度。
      if (savedMode === "medium" || savedMode === "true") return "medium";
      if (savedMode === "wide" || savedMode === "false") return "wide";
      return "compact";
    } catch {
      return "compact";
    }
  });
  const conversionInputRef = useRef<ConversionInputCardHandle>(null);
  const browserFileInputRef = useRef<HTMLInputElement>(null);
  const browserBatchInputRef = useRef<HTMLInputElement>(null);
  const [globalTableWidthMode, setGlobalTableWidthMode] = useState<TableWidthMode>("content");
  const [tableDisplayContext, setTableDisplayContext] = useState<TableDisplayContext>({
    tableFrom: null,
    widthMode: "content",
    scope: "global",
  });

  useEffect(() => {
    if (!isImageTab || !vaultRoot || !activeTab?.path) {
      setActiveImageSource(undefined);
      return undefined;
    }
    let cancelled = false;
    setActiveImageSource(undefined);
    void resolveVaultImageSource(vaultRoot, activeTab.path)
      .then((source) => { if (!cancelled) setActiveImageSource(source); })
      .catch(() => { if (!cancelled) setActiveImageSource(undefined); });
    return () => { cancelled = true; };
  }, [activeTab?.path, isImageTab, vaultRoot]);

  function cycleContentWidthMode() {
    setContentWidthMode((current) => {
      const next = nextEditorContentWidthMode(current);
      try {
        window.localStorage.setItem(editorContentWidthModeStorageKey, next);
      } catch {
        // 本地偏好不可写时仍允许本次会话正常切换。
      }
      return next;
    });
  }

  function handleTableWidthModeChange(mode: TableWidthMode) {
    const tableFrom = tableDisplayContext.tableFrom;
    if (tableFrom === null) setGlobalTableWidthMode(mode);
    const nextContext = conversionInputRef.current?.setTableWidthMode(mode, tableFrom);
    if (nextContext) setTableDisplayContext(nextContext);
  }

  function handleTogglePreview() {
    if (previewPausedForLongDocument) {
      toast.info(`文档超过 ${inlinePreviewCharacterLimit.toLocaleString()} 字符，已暂停 Word 预览`);
      return;
    }
    if (layoutTooNarrow) {
      previewExpandedFromNarrowRef.current = true;
      setPreviewExpanded(true);
      return;
    }
    setPreviewVisible(!previewVisible);
  }

  async function handleOpenLink(target: string) {
    const value = target.trim();
    if (!value) return;
    if (value.startsWith("#")) {
      const line = findMarkdownHeadingLine(markdown, value);
      if (line && activeTabId) window.dispatchEvent(new CustomEvent(markdownOutlineRevealEvent, { detail: { tabId: activeTabId, line } }));
      return;
    }
    if (isExternalDocumentLink(value)) {
      if (isTauriEnvironment()) await openUrl(value);
      else window.open(value, "_blank", "noopener,noreferrer");
      return;
    }
    const currentPath = activeTab?.path ?? "";
    const available = useVaultStore.getState().entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
    const path = resolveVaultDocumentLink(value, currentPath, available);
    if (!path) { toast.error("未找到链接文档"); return; }
    if (!vaultRoot) { toast.error("尚未打开文档目录"); return; }
    try {
      const file = await readVaultFile(vaultRoot, path);
      const absolutePath = `${vaultRoot.replace(/[\\/]$/, "")}/${file.path}`;
      const tabId = openVaultTab({
        path: file.path,
        absolutePath,
        title: file.path.split("/").pop() ?? file.path,
        content: file.content,
        eol: file.eol,
        hasBom: file.hasBom,
        modifiedMs: file.modifiedMs,
      });
      const fragment = documentLinkFragment(value);
      const line = fragment ? findMarkdownHeadingLine(file.content, fragment) : undefined;
      if (line) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(markdownOutlineRevealEvent, { detail: { tabId, line } })));
    } catch {
      toast.error("打开链接文档失败");
    }
  }

  function setMarkdown(next: string) {
    if (!activeTabId) {
      // 没有任何标签时直接开一个临时文档，用户不必先点「新建」。
      openScratchTab({ title: deriveScratchTitle(next), content: next, dirty: true });
      return;
    }
    if (!activeTab || activeTab.content === next) return;
    updateTabContent(activeTabId, next);
    if (activeTab.kind === "vault") setSaveState("dirty");
  }

  function imageImportTarget() {
    if (!vaultRoot || !canSaveVaultTab(activeTab, vaultRoot)) {
      toast.error("请先打开并保存到当前目录中的 Markdown 文档，再导入图片");
      return undefined;
    }
    return { root: vaultRoot, tab: activeTab };
  }

  function finishImageImport(tab: SaveableVaultTab, imported: Awaited<ReturnType<typeof importVaultImageData>>) {
    const vault = useVaultStore.getState();
    const imageParent = imported.imageDir.path.split("/").slice(0, -1).join("/");
    const parentEntry = imageParent
      ? {
          path: imageParent,
          name: imageParent.split("/").slice(-1)[0] ?? imageParent,
          isDir: true,
          size: 0,
          modifiedMs: imported.imageDir.modifiedMs,
          hasChildren: true,
        }
      : undefined;
    vault.mergeEntries([parentEntry, imported.imageDir, imported.entry].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
    vault.expandDirs([imageParent, imported.imageDir.path].filter(Boolean));
    return markdownImageReference(tab.path, imported.entry.path);
  }

  async function importImageFile(file: File) {
    const target = imageImportTarget();
    if (!target) return undefined;
    try {
      const data = await readFileAsDataUrl(file);
      const imported = await importVaultImageData(target.root, target.tab.path, data, imageFileExtension(file));
      const markdownReference = finishImageImport(target.tab, imported);
      toast.success(`已导入图片：${imported.entry.name}`);
      return markdownReference;
    } catch (error) {
      toast.error(parseVaultError(error, "导入图片失败").message);
      return undefined;
    }
  }

  async function importImagePaths(paths: string[]) {
    const target = imageImportTarget();
    if (!target) return;
    for (const path of paths) {
      try {
        const imported = await importVaultImageFromPath(target.root, target.tab.path, path);
        const markdownReference = finishImageImport(target.tab, imported);
        if (useDocumentTabsStore.getState().activeTabId === target.tab.id) {
          conversionInputRef.current?.insertText(markdownReference);
        }
        toast.success(`已导入图片：${imported.entry.name}`);
      } catch (error) {
        toast.error(parseVaultError(error, "导入图片失败").message);
      }
    }
  }

  async function saveVaultTab(tab: DocumentTab, silent = false) {
    const root = vaultRoot;
    if (saveInFlightRef.current || !root || !canSaveVaultTab(tab, root)) return false;
    saveInFlightRef.current = true;
    const isCurrentTab = () => useDocumentTabsStore.getState().activeTabId === tab.id;
    if (isCurrentTab()) setSaveState("saving");
    try {
      const saved = await writeVaultFile({
        root,
        path: tab.path,
        content: tab.content,
        eol: tab.eol,
        hasBom: tab.hasBom,
        expectedModifiedMs: tab.modifiedMs,
        allowEmpty: true,
      });
      markTabClean(tab.id, saved.modifiedMs);
      if (isCurrentTab()) {
        setActiveFileModifiedMs(saved.modifiedMs);
        setSaveState("saved");
      }
      if (!silent) toast.success("文档已保存");
      return true;
    } catch (error) {
      const { code, message } = parseVaultError(error, "保存文档失败");
      if (isCurrentTab()) setSaveState(code === "CONFLICT" ? "conflict" : "error", message);
      toast.error(message);
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function writeTabToAbsolutePath(tab: DocumentTab, absolutePath: string, saveAs: boolean, silent = false) {
    if (saveInFlightRef.current) return false;
    saveInFlightRef.current = true;
    const isCurrentTab = () => useDocumentTabsStore.getState().activeTabId === tab.id;
    if (isCurrentTab()) setSaveState("saving");
    try {
      const root = await dirname(absolutePath);
      const fileName = await basename(absolutePath);
      const eol = tab.eol ?? "lf";
      const hasBom = tab.hasBom ?? false;
      const saved = await writeVaultFile({
        root,
        path: fileName,
        content: tab.content,
        eol,
        hasBom,
        expectedModifiedMs: saveAs ? undefined : tab.modifiedMs,
        allowEmpty: true,
      });
      if (saveAs) {
        markTabSavedAs(tab.id, {
          path: absolutePath,
          absolutePath,
          title: fileName,
          eol,
          hasBom,
          modifiedMs: saved.modifiedMs,
        });
        setOutputNameEdited(false);
      } else {
        markTabClean(tab.id, saved.modifiedMs);
      }
      if (isCurrentTab()) setSaveState("saved");
      if (!silent) toast.success(`文档已保存：${fileName}`);
      return true;
    } catch (error) {
      const { code, message } = parseVaultError(error, "保存文档失败");
      if (isCurrentTab()) setSaveState(code === "CONFLICT" ? "conflict" : "error", message);
      toast.error(message);
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function saveDocumentTab(tab: DocumentTab, silent = false) {
    if (canSaveVaultTab(tab, vaultRoot)) return saveVaultTab(tab, silent);
    if (canSaveExternalTab(tab)) {
      return writeTabToAbsolutePath(tab, tab.absolutePath, false, silent);
    }

    try {
      const selectedPath = await selectMarkdownSavePath(tab.title);
      if (!selectedPath) return false;
      return writeTabToAbsolutePath(tab, selectedPath, true, silent);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "选择保存路径失败"));
      return false;
    }
  }

  async function saveActiveDocument(silent = false) {
    return activeTab ? saveDocumentTab(activeTab, silent) : false;
  }

  async function renameActiveDocument(nextTitle: string) {
    const root = useVaultStore.getState().vaultRoot;
    const currentTabId = useDocumentTabsStore.getState().activeTabId;
    const tab = useDocumentTabsStore.getState().tabs.find((item) => item.id === currentTabId);
    if (!tab || tab.kind === "image") return false;

    const nextBaseName = stripSupportedTextExtension(nextTitle.trim());
    if (!nextBaseName) return false;
    if (nextBaseName === stripSupportedTextExtension(tab.title)) return true;
    const nextName = preserveSupportedTextExtension(tab.title, nextBaseName);
    if (tab.kind === "scratch") {
      useDocumentTabsStore.getState().renameTab(tab.id, { title: nextName });
      setOutputNameEdited(false);
      return true;
    }
    if (!root || !tab.path) return false;
    if (saveInFlightRef.current) {
      toast.info("文档正在保存，请稍后再重命名");
      return false;
    }

    saveInFlightRef.current = true;
    try {
      const previousPath = tab.path;
      const renamed = await renameVaultEntry(root, previousPath, nextName);
      const absolutePath = vaultAbsolutePath(root, renamed.path);
      useDocumentTabsStore.getState().renameTab(tab.id, {
        path: renamed.path,
        absolutePath,
        title: renamed.name,
      });
      useVaultStore.setState((state) => state.vaultRoot === root ? {
        entries: state.entries.map((entry) => entry.path === previousPath ? renamed : entry),
        activeFilePath: state.activeFilePath === previousPath ? renamed.path : state.activeFilePath,
      } : {});
      toast.success(`已重命名为 ${renamed.name}`);
      return true;
    } catch (error) {
      toast.error(parseVaultError(error, "重命名失败").message);
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!appConfig?.autoSave || !activeTab?.dirty || !canAutoSaveActiveDocument) return undefined;
    const delay = Math.min(10_000, Math.max(300, appConfig.autoSaveDelayMs || 1000));
    const timer = window.setTimeout(() => void saveActiveDocument(true), delay);
    return () => window.clearTimeout(timer);
  }, [activeTab?.dirty, activeTab?.id, activeTab?.path, appConfig?.autoSave, appConfig?.autoSaveDelayMs, canAutoSaveActiveDocument, markdown]);

  async function copyActiveDocumentPath(path: string | undefined) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      toast.error("复制路径失败");
    }
  }

  async function revealActiveDocument() {
    const path = activeTab?.path && !isAbsoluteFilePath(activeTab.path) && vaultRoot
      ? vaultAbsolutePath(vaultRoot, activeTab.path)
      : activeTab?.absolutePath;
    if (!path) return;
    try {
      await showInExplorer(path);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "无法通过资源管理器打开文档"));
    }
  }
  const isDark = (appConfig?.themeMode ?? "light") === "dark"
    || ((appConfig?.themeMode ?? "light") === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [previewPaperThemeOverride, setPreviewPaperThemeOverride] = useState<PreviewPaperTheme | undefined>(undefined);
  const previewPaperTheme = previewPaperThemeOverride ?? (isDark ? "dark" : "light");

  function togglePreviewPaperTheme() {
    setPreviewPaperThemeOverride(previewPaperTheme === "dark" ? "light" : "dark");
  }

  const autoOutputName = useMemo(
    () => activeTab
      ? buildDocxOutputNameFromPath(activeTab.path ?? activeTab.title)
      : buildDocxOutputName(markdown),
    [activeTab, markdown],
  );
  const [outputNameDraft, setOutputNameDraft] = useState(() => buildDocxOutputName(""));
  const [outputNameEdited, setOutputNameEdited] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [batchImportPaths, setBatchImportPaths] = useState<string[]>([]);
  const [selectedBatchImportPaths, setSelectedBatchImportPaths] = useState<string[]>([]);
  const [batchImportDialogOpen, setBatchImportDialogOpen] = useState(false);
  // 关闭有未保存改动的文档时用 ref 存 resolve，
  // 是为了把「弹窗 + 按钮点击」这套异步交互包成一个可 await 的 Promise。
  const [closingDocumentTab, setClosingDocumentTab] = useState<DocumentTab>();
  const closeDocumentResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const saveInFlightRef = useRef(false);
  const [previewStyleConfig, setPreviewStyleConfig] = useState<TemplateStyleConfig>(() => mergeTemplateStyleConfig(templateId));
  const [previewWidth, setPreviewWidth] = useState(520);
  const [previewZoom, setPreviewZoom] = useState(40);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const previewExpandedFromNarrowRef = useRef(false);
  const [expandedStyleEditorOpen, setExpandedStyleEditorOpen] = useState(false);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewSidebarView, setPreviewSidebarView] = useState<PreviewSidebarView>("pages");
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState(208);
  // 缩略图栏若把 Word 页面压得过窄，就直接不渲染。底部控件沿用同一紧凑
  // 布局，避免左边还在、下方却横向溢出的临界状态。
  const useCompactInlinePreviewLayout = previewWidth <= previewSidebarWidth + inlinePreviewSidebarDividerWidth + inlinePreviewPageMinWidth;
  const showInlinePreviewSidebar = showPreviewPanel && !useCompactInlinePreviewLayout;
  const [previewOutline, setPreviewOutline] = useState<PreviewOutlineItem[]>([]);
  const [previewThumbnailContainer, setPreviewThumbnailContainer] = useState<HTMLDivElement | null>(null);
  const [titlebarTabHost, setTitlebarTabHost] = useState<HTMLElement | null>(null);
  const expandedPreviewRef = useRef<HTMLDivElement>(null);
  const conversionVersionRef = useRef(0);
  // 预览样式的读取是异步的，切模板与关闭样式编辑器都会触发。用递增版本号
  // 而不是 effect 局部的 cancelled 标志：后者管不到 closeExpandedStyleEditor
  // 这种在 effect 之外发起的读取，晚回来的旧结果会把新模板的样式覆盖掉。
  const previewStyleVersionRef = useRef(0);

  useEffect(() => {
    const element = splitPaneRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;

    const updateWidth = () => setSplitPaneWidth(element.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activePage, expandedStyleEditorOpen, previewExpanded]);

  useEffect(() => {
    setTitlebarTabHost(document.getElementById("mk-titlebar-document-tabs"));
  }, []);
  const selectedTemplate = useMemo(() => templateOptions.find((template) => template.id === templateId) ?? templateOptions[0], [templateId, templateOptions]);
  // 桌面端整窗接收拖放：拖进来的文件不必在已打开的目录里，各自开一个标签。
  const { isDragging: isWindowDragging, isDraggingImage: isWindowDraggingImage } = useTauriFileDrop(({ paths, position }) => {
    const documentPaths = paths.filter((path) => !isImageDropPath(path));
    const imagePaths = paths.filter(isImageDropPath);
    if (documentPaths.length > 0) {
      setActivePage("convert");
      void openDroppedPaths(documentPaths);
    }
    if (imagePaths.length === 0) return;

    const scale = window.devicePixelRatio || 1;
    const x = position.x / scale;
    const y = position.y / scale;
    const editor = document.querySelector<HTMLElement>("[data-mk-editor-drop-target]");
    const bounds = editor?.getBoundingClientRect();
    if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      toast.info("请将图片拖到 Markdown 编辑区中");
      return;
    }
    void importImagePaths(imagePaths);
  });

  useEffect(() => {
    if (isConverting || pendingImportPaths.length === 0) return undefined;

    const paths = pendingImportPaths;
    setConvertResult(null);

    if (paths.length > 1) {
      clearPendingImportPaths();
      setBatchImportPaths(paths);
      setSelectedBatchImportPaths(paths);
      setBatchImportDialogOpen(true);
      return undefined;
    }

    // 刻意等读完再清队列：读到一半用户切走页面时，本组件被卸载、setMarkdown 落空，
    // 路径留在队列里，切回来会自动重试，不至于凭空丢文件。
    // 反过来若在这里就清空，effect 自己的依赖 pendingImportPaths 会立刻变化，
    // 从而触发 cleanup —— 那时再排队回去就成了死循环。
    let cancelled = false;
    const path = paths[0];
    void readMarkdownFileFromPath(path)
      .then((text) => {
        if (cancelled) return;
        clearPendingImportPaths();
        openExternalDocument(path, text);
        toast.success(`已载入文件：${path.split(/[\\/]/).pop() ?? path}`);
      })
      .catch((error) => {
        if (cancelled) return;
        // 读失败也要清掉，否则每次切回本页都会重试并重复弹同一个错误。
        clearPendingImportPaths();
        toast.error(userFacingErrorMessage(error, "读取启动文件失败"));
      });

    return () => {
      cancelled = true;
    };
  }, [clearPendingImportPaths, isConverting, pendingImportPaths]);

  useEffect(() => {
    if (!currentTemplateId || currentTemplateId === templateId) return;
    if (templateOptions.some((template) => template.id === currentTemplateId)) {
      setTemplateId(currentTemplateId);
      return;
    }
    setCurrentTemplateId(undefined);
  }, [currentTemplateId, setCurrentTemplateId, templateId, templateOptions]);

  useEffect(() => {
    if (templateOptions.some((template) => template.id === templateId)) return;
    const nextTemplate = templateOptions.find((template) => template.id === appConfig?.defaultTemplateId) ?? templateOptions.find((template) => template.isDefault) ?? templateOptions[0];
    setTemplateId(nextTemplate.id);
  }, [appConfig?.defaultTemplateId, templateId, templateOptions]);

  useEffect(() => {
    conversionVersionRef.current += 1;
    setConvertResult(null);
  }, [markdown, activeTabId]);

  // 文件树点开某个文件时，正文由 AppShell 那条链路送进来。
  // 一并把输出名的「已手改」标记清掉：否则用户改过一次文件名后，
  // 后面在树里点开的每个文件都会沿用那个名字，导出时互相覆盖。
  useEffect(() => {
    registerVaultContentSink(({ path, absolutePath, content, eol, hasBom, modifiedMs }) => {
      const id = openVaultTab({ path, absolutePath, title: path.split("/").pop() ?? path, content, eol, hasBom, modifiedMs });
      if (useDocumentTabsStore.getState().tabs.find((tab) => tab.id === id)?.dirty) setSaveState("dirty");
      setOutputNameEdited(false);
      return id;
    });
    return () => registerVaultContentSink(undefined);
  }, [openVaultTab, setSaveState]);

  useEffect(() => {
    if (!outputNameEdited) setOutputNameDraft(autoOutputName);
  }, [autoOutputName, outputNameEdited]);

  useEffect(() => {
    setOutputNameEdited(false);
  }, [activeTabId]);

  useEffect(() => {
    if (!layoutTooNarrow && previewExpanded && previewExpandedFromNarrowRef.current) {
      previewExpandedFromNarrowRef.current = false;
      setPreviewVisible(true);
      setPreviewExpanded(false);
    }
  }, [layoutTooNarrow, previewExpanded, setPreviewVisible]);

  useEffect(() => {
    if (!previewExpanded && !showInlinePreviewSidebar) return undefined;
    let frame = 0;
    const updatePageCount = () => {
      setPreviewPageCount(Math.max(1, document.querySelectorAll("[data-preview-page-index]").length));
    };
    frame = window.requestAnimationFrame(updatePageCount);
    const observer = new MutationObserver(updatePageCount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [previewExpanded, markdown, previewStyleConfig, previewZoom, showInlinePreviewSidebar]);

  useEffect(() => {
    const version = ++previewStyleVersionRef.current;
    setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
    void getTemplateStyleConfig(templateId)
      .then((storedConfig) => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(templateId, storedConfig ?? undefined));
      })
      .catch(() => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(templateId));
      });
  }, [templateId]);

  /// 从窗口拖入的文件。刻意不经过 vault 命令——那套会拒绝目录外的路径，
  /// 而拖进来的文件本来就多半不在当前打开的目录里。read_markdown_file
  /// 可以读任意路径，后续编辑仍通过绝对路径自动写回原文件。
  async function openDroppedPaths(paths: string[]) {
    let lastId: string | undefined;
    let failed = 0;

    for (const path of paths) {
      try {
        const text = await readMarkdownFileFromPath(path);
        lastId = openExternalDocument(path, text);
      } catch {
        failed += 1;
      }
    }

    if (lastId) {
      const opened = paths.length - failed;
      toast.success(opened > 1 ? `已打开 ${opened} 个文档` : `已打开：${paths[paths.length - 1].split(/[\/]/).pop()}`);
    }
    if (failed > 0) toast.error(`${failed} 个文件读取失败`);
  }

  function confirmCloseDocument(tab: DocumentTab) {
    setClosingDocumentTab(tab);
    return new Promise<boolean>((resolve) => {
      closeDocumentResolveRef.current = resolve;
    });
  }

  function resolveCloseDocument(confirmed: boolean) {
    closeDocumentResolveRef.current?.(confirmed);
    closeDocumentResolveRef.current = null;
    setClosingDocumentTab(undefined);
  }

  async function prepareCloseDocument(tab: DocumentTab) {
    if (!tab.dirty) return true;
    if (appConfig?.autoSave && (canSaveVaultTab(tab, vaultRoot) || canSaveExternalTab(tab))) {
      return saveDocumentTab(tab, true);
    }
    return confirmCloseDocument(tab);
  }

  async function saveAndCloseDocument() {
    if (!closingDocumentTab) return;
    if (await saveDocumentTab(closingDocumentTab)) resolveCloseDocument(true);
  }

  /// 从磁盘路径载入的文档。若这个路径已经在某个标签里开着就复用它，
  /// 否则新开一个——和文件树点击走同一套去重逻辑，避免同一个文件开出两个标签。
  function openExternalDocument(path: string, content: string) {
    const normalized = path.replace(/\\/g, "/");
    const id = openVaultTab({
      path: normalized,
      absolutePath: path,
      title: normalized.split("/").pop() ?? normalized,
      content,
    });
    setOutputNameEdited(false);
    return id;
  }

  /// 只上传本次新增的记录：后端会重新读盘再合并回写，
  /// 避免悬浮球窗口、右键菜单进程在转换期间写入的记录被本窗口的旧快照覆盖。
  async function persistHistory(newItems: HistoryItem[]) {
    if (newItems.length === 0) return;
    // 先按当前最新的 store 值乐观更新，保证 UI 立即可见；getState 而非渲染期快照，
    // 使连续两次转换不会互相覆盖。
    setHistory(limitHistory([...newItems, ...useAppStore.getState().history]));
    try {
      setHistory(await appendHistory(newItems));
    } catch {
      // 浏览器预览或文件系统失败时，内存历史仍可用。
    }
  }

  async function runConvert() {
    const input = markdown;
    if (!input.trim()) {
      setConvertResult(null);
      toast.error("请先粘贴 Markdown 内容");
      return;
    }

    const conversionVersion = conversionVersionRef.current;
    setIsConverting(true);
    try {
      // mermaid 块要先栅格化成 PNG 落盘再引用：DOCX 不支持 SVG，
      // Pandoc 遇到 SVG 会把那张图整个跳过。
      const exportInput = normalizeCodeFenceLabels(input);
      const { markdown: preparedInput, failed: mermaidFailed, errors: mermaidErrors } = await inlineMermaidImages(exportInput);
      if (mermaidFailed > 0) {
        toast.warning(`${mermaidFailed} 张图表未能导出，已保留原始代码块`, {
          description: mermaidErrors[0],
        });
      }

      const result = await convertMarkdown({
        input: preparedInput,
        inputKind: "text",
        sourcePath: markdownSourcePath,
        output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
        templateId,
        openAfterConvert: appConfig?.openAfterConvert ?? true,
        conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
        tocPageNumbers: previewOutline.map(({ id, page }) => ({ anchorId: id, page })),
      });
      const isCurrentConversion = conversionVersion === conversionVersionRef.current;
      if (isCurrentConversion) setConvertResult(result);
      await persistHistory([buildHistoryItem(result)]);
      toast[result.ok && !result.simulated ? "success" : result.simulated ? "info" : "error"](result.message ?? (result.ok ? "转换完成" : "转换失败"));
      const actionableWarnings = actionableConversionWarnings(result.warnings);
      if (result.ok && actionableWarnings.length > 0) {
        toast.warning("转换完成，但有需要检查的提示", { description: actionableWarnings.join("\n") });
      }
    } catch (error) {
      const message = userFacingErrorMessage(error, "转换调用失败");
      const result: ConvertResult = { ok: false, input, templateId, durationMs: 0, warnings: [], diagnostics: [], statistics: { mermaidBlocks: 0, mermaidRendered: 0, mermaidFailed: 0, imageCount: 0, tableCount: 0, multiPageTableCandidateCount: 0, tableWidthRiskIndices: [], imageDetails: [] }, errorCode: "INVOKE_FAILED", message };
      if (conversionVersion === conversionVersionRef.current) setConvertResult(result);
      await persistHistory([buildHistoryItem(result)]);
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  }

  async function runBatchImport() {
    if (isConverting) return;

    let paths: string[];
    try {
      paths = await selectMarkdownFiles();
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "选择文件失败"));
      return;
    }

    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) return;

    setBatchImportPaths(uniquePaths);
    setSelectedBatchImportPaths(uniquePaths);
    setBatchImportDialogOpen(true);
  }

  function closeBatchImportDialog() {
    setBatchImportDialogOpen(false);
    setBatchImportPaths([]);
    setSelectedBatchImportPaths([]);
  }

  function toggleBatchImportPath(path: string) {
    setSelectedBatchImportPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  }

  function removeBatchImportPath(path: string) {
    setBatchImportPaths((current) => current.filter((item) => item !== path));
    setSelectedBatchImportPaths((current) => current.filter((item) => item !== path));
  }

  async function runSelectedBatchImport() {
    const paths = batchImportPaths.filter((path) => selectedBatchImportPaths.includes(path));
    if (paths.length === 0) {
      toast.error("请至少选择一个 Markdown/TXT 文件");
      return;
    }

    closeBatchImportDialog();
    setIsConverting(true);
    setConvertResult(null);

    const results: ConvertResult[] = [];
    try {
      for (const path of paths) {
        const outputName = buildDocxOutputNameFromPath(path);
        const result = await convertMarkdown({
          input: path,
          inputKind: "path",
          output: buildOutputPath(appConfig?.defaultOutputDir, outputName),
          templateId,
          openAfterConvert: false,
          conflictStrategy: appConfig?.defaultConflictStrategy ?? "overwrite",
        });
        results.push(result);
      }

      await persistHistory(results.map(buildHistoryItem));
      const successCount = results.filter((result) => result.ok && !result.simulated).length;
      const failedCount = results.length - successCount;
      const warningCount = results.reduce((total, result) => total + actionableConversionWarnings(result.warnings).length, 0);
      setConvertResult(results.length > 0 ? results[results.length - 1] : null);
      toast[failedCount > 0 ? "error" : warningCount > 0 ? "warning" : "success"](`批量转换完成：成功 ${successCount} 个，失败 ${failedCount} 个${warningCount > 0 ? `，提示 ${warningCount} 条` : ""}`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "批量转换失败"));
      if (results.length > 0) {
        await persistHistory(results.map(buildHistoryItem));
      }
    } finally {
      setIsConverting(false);
    }
  }

  function handleFileTextLoad(text: string, file: File) {
    // 浏览器的 File 对象拿不到真实磁盘路径，只能作为临时文档打开。
    openScratchTab({ title: file.name, content: text });
    setOutputNameEdited(false);
    toast.success(`已载入文件：${file.name}`);
  }

  async function handleNativeMarkdownFileLoad() {
    try {
      const path = await selectMarkdownFile();
      if (!path) return;
      const text = await readMarkdownFileFromPath(path);
      openExternalDocument(path, text);
      toast.success(`已载入文件：${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "读取文件失败"));
    }
  }

  async function handleBrowserFileLoad(files: File[]) {
    const importedNames: string[] = [];
    for (const file of files) {
      try {
        const { text } = await readMarkdownFile(file);
        openScratchTab({ title: file.name, content: text });
        importedNames.push(file.name);
      } catch (error) {
        toast.error(userFacingErrorMessage(error, `无法读取 ${file.name}`));
      }
    }
    if (importedNames.length === 0) return;
    setOutputNameEdited(false);
    toast.success(importedNames.length === 1 ? `已载入文件：${importedNames[0]}` : `已载入 ${importedNames.length} 个文件`);
  }

  function handleImportFileRequest() {
    if (isTauriEnvironment()) return handleNativeMarkdownFileLoad();
    browserFileInputRef.current?.click();
  }

  function handleBatchImportRequest() {
    if (isTauriEnvironment()) return runBatchImport();
    browserBatchInputRef.current?.click();
  }

  async function handleReadClipboard() {
    if (!navigator.clipboard?.readText) {
      toast.error("当前环境不支持读取剪贴板，请手动粘贴 Markdown 内容");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      // 浏览器的 File 对象拿不到真实磁盘路径，只能作为临时文档打开。
      openScratchTab({ title: deriveScratchTitle(text, "导入内容"), content: text, dirty: true });
      setOutputNameEdited(false);
    } catch (error) {
      toast.error(clipboardReadErrorMessage(error));
    }
  }

  async function handleSelectOutputDir() {
    if (!appConfig) {
      toast.error("设置正在加载，稍后再选择输出目录");
      return;
    }

    try {
      const selected = await selectDirectory();
      if (!selected) return;
      const saved = await saveAppConfig({ ...appConfig, defaultOutputDir: selected });
      setAppConfig(saved);
      toast.success("已更新输出目录");
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "选择输出目录失败"));
    }
  }

  async function handleRevealOutput() {
    const path = convertResult?.output;
    if (!path) return;

    try {
      await revealOutputPath(path);
      toast.success("已在资源管理器中定位文件");
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "打开资源管理器失败"));
    }
  }

  function handlePreviewResizeStart(event: ReactPointerEvent<HTMLDivElement>, collapsed: boolean) {
    const container = splitPaneRef.current;
    if (!container || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    // CSS zoom 会让 getBoundingClientRect 与受控 grid 宽度处于不同坐标系，
    // 统一换算到未缩放的布局坐标，拖动时才不会出现移动但宽度不变。
    const layoutScale = rect.width / Math.max(container.offsetWidth, 1);
    let origin = event.clientX;
    let baseWidth = collapsed ? previewMinWidth : previewWidth;
    let collapsedDuringDrag = collapsed;
    const move = (moveEvent: PointerEvent) => {
      const nextWidth = baseWidth - (moveEvent.clientX - origin) / layoutScale;

      if (!collapsedDuringDrag && nextWidth >= rect.width - editorMinWidth) {
        previewExpandedFromNarrowRef.current = false;
        setPreviewExpanded(true);
        stop();
        return;
      }

      if (!collapsedDuringDrag && nextWidth <= previewMinWidth - RESIZABLE_PANEL_COLLAPSE_THRESHOLD) {
        setPreviewWidth(previewMinWidth);
        collapsedDuringDrag = true;
        setPreviewVisible(false);
        return;
      }

      if (collapsedDuringDrag && nextWidth >= previewMinWidth + RESIZABLE_PANEL_COLLAPSE_THRESHOLD) {
        setPreviewWidth(previewMinWidth);
        collapsedDuringDrag = false;
        origin = moveEvent.clientX;
        baseWidth = previewMinWidth;
        setPreviewVisible(true);
        return;
      }

      if (collapsedDuringDrag) return;

      const maxWidth = Math.max(previewMinWidth, rect.width / layoutScale - editorMinWidth - 5);
      setPreviewWidth(Math.min(maxWidth, Math.max(previewMinWidth, Math.round(nextWidth))));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function handlePreviewSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>, container: HTMLDivElement | null) {
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const minWidth = 172;
      const maxWidth = Math.min(400, Math.max(248, rect.width * 0.42));
      setPreviewSidebarWidth(Math.min(maxWidth, Math.max(minWidth, moveEvent.clientX - rect.left)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  const words = markdown.trim() ? markdown.trim().length : 0;
  const lines = markdown ? markdown.split(/\r?\n/).length : 0;
  const outputName = normalizeOutputName(outputNameDraft);
  const outputDirLabel = appConfig?.defaultOutputDir?.trim() || "与源 Markdown 同目录";
  const outputPath = buildOutputPath(appConfig?.defaultOutputDir, outputName);

  function scrollToPreviewHeading(id: string) {
    const target = document.querySelector(`[data-preview-heading-id="${id}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function scrollToPreviewPage(page: number) {
    const target = document.querySelector(`[data-preview-page-index="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openPreviewSidebarView(view: PreviewSidebarView) {
    setPreviewSidebarView(view);
  }

  function closeExpandedStyleEditor() {
    setExpandedStyleEditorOpen(false);
    // 关编辑器时重新拉一次配置，把编辑器里的保存结果同步到预览。
    // 这次读取要和切模板的读取抢同一个 state，所以共用版本号：
    // 用户关掉编辑器后马上切模板，这条晚回来的结果必须被丢弃。
    const version = ++previewStyleVersionRef.current;
    const currentTemplate = templateId;
    void getTemplateStyleConfig(currentTemplate)
      .then((storedConfig) => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(currentTemplate, storedConfig ?? undefined));
      })
      .catch(() => {
        if (version !== previewStyleVersionRef.current) return;
        setPreviewStyleConfig(mergeTemplateStyleConfig(currentTemplate));
      });
  }

  type ConvertFooterLayout = "wide" | "responsive" | "expanded" | "two-column" | "one-column";

  function renderConvertFooter(className?: string, layout: ConvertFooterLayout = "wide") {
    const canRevealOutput = Boolean(convertResult?.ok && !convertResult.simulated && convertResult.output);
    const stacked = layout !== "wide";
    const conversionState = isConverting
      ? "running"
      : convertResult?.simulated
        ? "preview"
        : convertResult?.ok
          ? "success"
          : convertResult
            ? "failed"
            : "idle";
    const statusLabel = conversionState === "running"
      ? "转换中"
      : conversionState === "success"
        ? "转换成功"
        : conversionState === "preview"
          ? "仅预览"
          : conversionState === "failed"
            ? "转换失败"
            : "待转换";
    const statusIcon = conversionState === "running"
      ? <Loader2 className="size-3.5 animate-spin" />
      : conversionState === "failed"
        ? <AlertCircle className="size-3.5" />
        : <CheckCircle2 className="size-3.5" />;
    const statusIconClass = conversionState === "failed"
      ? "bg-red-600 text-white"
      : conversionState === "success"
        ? "bg-emerald-600 text-white"
        : conversionState === "running"
          ? "bg-blue-600 text-white"
          : "bg-slate-500 text-white";
    const controlsClass = layout === "responsive" || layout === "expanded"
      ? "grid-cols-3"
      : layout === "two-column"
      ? "grid-cols-2"
      : layout === "one-column"
        ? "grid-cols-1"
        : "grid-cols-[180px_minmax(150px,0.8fr)_minmax(180px,1fr)_150px] max-[1100px]:grid-cols-[minmax(126px,0.72fr)_minmax(150px,0.8fr)_minmax(180px,1fr)_minmax(116px,auto)] max-[760px]:grid-cols-1";

    return (
      <section className={cn("mk-preview-footer mk-convert-footer flex min-h-0 min-w-0 flex-col justify-center gap-2 rounded-[5px] border-t border-slate-200 bg-white px-4 py-3 max-[1100px]:border max-[1100px]:border-slate-200 dark:max-[1100px]:border-zinc-700/70 dark:max-[1100px]:bg-zinc-900/92", `mk-convert-footer-${layout}`, className)}>
        <div className={cn("relative flex min-w-0 gap-2 pr-9 text-xs font-bold text-blue-900/58 dark:text-zinc-300/80", stacked ? "flex-wrap items-center" : "items-center")}>
          <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", statusIconClass)}>
            {statusIcon}
          </div>
          <span className="shrink-0 text-blue-950 dark:text-zinc-100">{statusLabel}</span>
          <span className="shrink-0">{words} 字符</span>
          <span className="shrink-0">{lines} 行</span>
          <TooltipAnchor content={convertResult?.output ?? outputPath}>
            <span className="min-w-0 truncate">{convertResult?.output ?? outputPath}</span>
          </TooltipAnchor>
          {canRevealOutput ? (
            <TooltipButton variant="ghost" size="icon-xs" className="absolute top-0 right-0 shrink-0 text-blue-700 hover:bg-blue-50 hover:text-blue-900 dark:text-blue-200 dark:hover:bg-blue-500/12 dark:hover:text-blue-100" onClick={() => void handleRevealOutput()} tooltip="资源管理器中打开" aria-label="资源管理器中打开生成的 DOCX">
              <FolderOpen className="size-3.5" />
            </TooltipButton>
          ) : null}
        </div>

        <div className={cn("mk-convert-controls grid min-w-0 items-center gap-2", controlsClass)}>
          <Select value={templateId} onValueChange={(value) => {
            setTemplateId(value);
            setCurrentTemplateId(value);
          }}>
            <SelectTrigger className="mk-convert-control h-10 w-full min-w-0 rounded-[10px] border-slate-200 bg-white text-xs font-bold text-blue-800 shadow-none data-[size=default]:h-10">
              <SelectValue placeholder="选择模板" />
            </SelectTrigger>
            <SelectContent>
              {templateOptions.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TooltipAnchor content={outputDirLabel}>
            <button
              type="button"
              className="mk-convert-control flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-left text-xs font-bold text-blue-800 shadow-none transition hover:bg-slate-50 dark:border-zinc-700/70 dark:bg-zinc-800/72 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
              onClick={() => void handleSelectOutputDir()}
            >
              <FolderOpen className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{outputDirLabel}</span>
            </button>
          </TooltipAnchor>
          <TooltipAnchor content={outputPath}>
            <div className="mk-convert-control flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-blue-700 shadow-none dark:border-zinc-700/70 dark:bg-zinc-800/72 dark:text-zinc-100">
              <FileText className="size-4 shrink-0" />
              <Input
                value={outputNameDraft}
                onChange={(event) => {
                  setOutputNameEdited(true);
                  setOutputNameDraft(event.target.value);
                }}
                onBlur={(event) => setOutputNameDraft(normalizeOutputName(event.target.value))}
                aria-label="输出文件名"
                className="h-8 min-w-0 border-0 bg-transparent p-0 text-sm font-bold text-blue-800 shadow-none outline-none placeholder:text-blue-900/35 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:text-zinc-50 dark:placeholder:text-zinc-500"
              />
            </div>
          </TooltipAnchor>
          <PrimaryActionButton className="mk-convert-submit h-10 text-sm font-black max-[760px]:min-w-[116px] max-[640px]:min-w-[104px]" onClick={() => void runConvert()} disabled={isConverting || !markdown.trim()}>
            {isConverting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {isConverting ? "转换中" : "开始转换"}
          </PrimaryActionButton>
        </div>
      </section>
    );
  }

  const documentTabs = (
    <>
      <input
        ref={browserFileInputRef}
        type="file"
        accept={markdownFileAccept}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void handleBrowserFileLoad(files);
        }}
      />
      <input
        ref={browserBatchInputRef}
        type="file"
        accept={markdownFileAccept}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void handleBrowserFileLoad(files);
        }}
      />
      <DocumentTabBar
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 dark:border-zinc-700/60 dark:bg-zinc-800/78"
        onNewDocument={() => { openScratchTab({ title: "未命名", content: "" }); setOutputNameEdited(false); }}
        onImportFile={handleImportFileRequest}
        onBatchImport={handleBatchImportRequest}
        onPasteClipboard={handleReadClipboard}
        onBeforeClose={prepareCloseDocument}
        showDirtyIndicator={appConfig?.autoSave === false}
        pageTabs={openWorkspaceTabs}
        activePage={activePage}
        onSelectDocument={() => setActivePage("convert")}
        onSelectPage={setActivePage}
        onClosePage={closePageTab}
        onCloseOtherPageTabs={closeOtherPageTabs}
        onCloseAllPageTabs={closeAllPageTabs}
      />
    </>
  );
  const documentTabsPortal = titlebarTabHost ? createPortal(documentTabs, titlebarTabHost) : null;

  if (activePage === "convert" && expandedStyleEditorOpen) {
    return (
      <>
        {documentTabsPortal}
        <div className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
          <TemplateStyleManager
            embedded
            template={selectedTemplate}
            initialTab="styles"
            previewMarkdown={markdown}
            previewMarkdownSourcePath={markdownSourcePath}
            closeLabel="返回放大预览"
            onRequestClose={closeExpandedStyleEditor}
          />
        </div>
      </>
    );
  }

  if (activePage === "convert" && previewExpanded && !previewPausedForLongDocument && !isImageTab) {
    return (
      <>
        {documentTabsPortal}
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div
            ref={expandedPreviewRef}
            className="mk-preview-layout grid min-h-0 flex-1 grid-cols-[minmax(172px,var(--preview-sidebar-width))_5px_minmax(0,1fr)] gap-0 max-[900px]:!grid-cols-1"
            style={{ "--preview-sidebar-width": `${previewSidebarWidth}px` } as CSSProperties}
          >
            <WordPreviewSidebar
              activeView={previewSidebarView}
              headings={previewOutline}
              pageCount={previewPageCount}
              onViewChange={openPreviewSidebarView}
              onHeadingJump={scrollToPreviewHeading}
              onThumbnailContainerChange={setPreviewThumbnailContainer}
            />
            <div
              className="group flex cursor-col-resize items-center justify-center max-[900px]:hidden"
              onPointerDown={(event) => handlePreviewSidebarResizeStart(event, expandedPreviewRef.current)}
              role="separator"
              aria-label="调整预览导航宽度"
              aria-orientation="vertical"
            >
              <span className="h-10 w-1 rounded-full bg-slate-300/75 transition group-hover:h-16 group-hover:bg-blue-400 dark:bg-zinc-700 dark:group-hover:bg-blue-500" />
            </div>
            <ConvertPreviewPanel
              markdown={deferredPreviewMarkdown}
              markdownSourcePath={markdownSourcePath}
              outputName={outputName}
              styleConfig={previewStyleConfig}
              zoom={previewZoom}
              setZoom={setPreviewZoom}
              onToggleExpanded={() => { previewExpandedFromNarrowRef.current = false; setPreviewExpanded(false); }}
              paperTheme={previewPaperTheme}
              onTogglePaperTheme={togglePreviewPaperTheme}
              onOpenAdvancedStyle={() => setExpandedStyleEditorOpen(true)}
              expanded
              showTocPage
              thumbnailContainer={previewThumbnailContainer}
              onThumbnailPageSelect={scrollToPreviewPage}
              onPreviewOutlineChange={setPreviewOutline}
              onOpenLink={(target) => void handleOpenLink(target)}
              className="h-full rounded-[5px]"
              previewClassName="h-full"
            />
          </div>
          {renderConvertFooter("mt-1 shrink-0", "responsive")}
        </div>
      </>
    );
  }

  return (
    <>
      {documentTabsPortal}
      <MediaPreviewDialogHost />
      <Dialog open={batchImportDialogOpen} onOpenChange={(open) => { if (!open) closeBatchImportDialog(); }}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
            <DialogTitle className="text-lg font-semibold text-slate-950 dark:text-zinc-50">选择要转换的文档</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-5">已导入 {batchImportPaths.length} 个 Markdown/TXT 文件。勾选后才会转换为 DOCX，未选文件不会处理。</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-zinc-800/80">
            <span className="text-sm font-medium text-slate-700 dark:text-zinc-200">已选 {selectedBatchImportPaths.length} / {batchImportPaths.length}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelectedBatchImportPaths(batchImportPaths)} disabled={batchImportPaths.length === 0 || selectedBatchImportPaths.length === batchImportPaths.length}>全选</Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelectedBatchImportPaths([])} disabled={selectedBatchImportPaths.length === 0}>取消全选</Button>
            </div>
          </div>

          <div className="max-h-[min(52vh,420px)] divide-y divide-slate-100 overflow-y-auto dark:divide-zinc-800">
            {batchImportPaths.map((path) => {
              const checked = selectedBatchImportPaths.includes(path);
              const name = path.split(/[\\/]/).pop() ?? path;
              return (
                <div key={path} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-zinc-900/70">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBatchImportPath(path)}
                    className="size-4 shrink-0 accent-blue-600"
                    aria-label={`选择 ${name}`}
                  />
                  <FileText className="size-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">{name}</p>
                    <TooltipAnchor content={path}>
                      <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{path}</p>
                    </TooltipAnchor>
                  </div>
                  <TooltipButton variant="ghost" size="icon-xs" className="shrink-0 text-slate-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-300" onClick={() => removeBatchImportPath(path)} aria-label={`移除 ${name}`} tooltip="移除">
                    <Trash2 className="size-3.5" />
                  </TooltipButton>
                </div>
              );
            })}
            {batchImportPaths.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-zinc-400">没有待转换的文件</p> : null}
          </div>

          <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
            <Button variant="outline" onClick={closeBatchImportDialog}>取消</Button>
            <PrimaryActionButton onClick={() => void runSelectedBatchImport()} disabled={selectedBatchImportPaths.length === 0}>
              <ArrowRight className="size-4" />
              转换选中 {selectedBatchImportPaths.length} 项
            </PrimaryActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closingDocumentTab)} onOpenChange={(open) => { if (!open) resolveCloseDocument(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>关闭未保存的文档</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-5">
              {canSaveVaultTab(closingDocumentTab, vaultRoot) || canSaveExternalTab(closingDocumentTab)
                ? `「${closingDocumentTab?.title}」有未保存的改动，是否在关闭前保存？`
                : `「${closingDocumentTab?.title}」还没有保存到磁盘，关闭后内容会丢失。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {closingDocumentTab?.kind === "scratch" ? (
              <Button variant="outline" onClick={() => void saveAndCloseDocument()}>
                <Save className="size-4" />保存
              </Button>
            ) : (
              <Button variant="outline" onClick={() => resolveCloseDocument(false)}>取消</Button>
            )}
            <Button variant="destructive" onClick={() => resolveCloseDocument(true)}>不保存并关闭</Button>
            {canSaveVaultTab(closingDocumentTab, vaultRoot) || canSaveExternalTab(closingDocumentTab) ? (
              <PrimaryActionButton onClick={() => void saveAndCloseDocument()}>
                <Save className="size-4" />保存并关闭
              </PrimaryActionButton>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    <div className="grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-1 overflow-hidden">
      <div
        ref={splitPaneRef}
        className="grid min-h-0 min-w-0 gap-0 overflow-hidden"
        style={{ gridTemplateColumns: layoutTooNarrow || !isDocumentWorkspace ? "minmax(0,1fr)" : showPreviewPanel ? `minmax(${editorMinWidth}px,1fr) 5px minmax(${previewMinWidth}px,${previewWidth}px)` : "minmax(0,1fr) 5px" }}
        >
          <div className="min-h-0 min-w-0 overflow-hidden">
            {isWorkspacePage ? (
              <WorkspacePageSlot>{workspaceContent}</WorkspacePageSlot>
            ) : isImageTab ? (
              <ImageDocumentViewer src={activeImageSource} alt={activeTab?.title ?? "图片"} path={activeTab?.path} />
            ) : (
              <ConversionInputCard
                ref={conversionInputRef}
                documentInfo={<DocumentInfoBar tab={activeTab} previewVisible={showPreviewPanel} previewPaused={previewPausedForLongDocument} onTogglePreview={handleTogglePreview} canSave={canSaveActiveDocument} onSave={() => void saveActiveDocument(false)} onCopyRelativePath={() => void copyActiveDocumentPath(activeTab?.path && !isAbsoluteFilePath(activeTab.path) ? activeTab.path : undefined)} onCopyAbsolutePath={() => void copyActiveDocumentPath(activeTab?.absolutePath ?? (activeTab?.path && isAbsoluteFilePath(activeTab.path) ? activeTab.path : undefined))} onRevealPath={() => void revealActiveDocument()} onLocatePath={(path) => useVaultStore.getState().requestLocatePath(path)} readingMode={readingMode} onToggleReadingMode={() => setReadingMode((value) => !value)} contentWidthMode={contentWidthMode} onCycleContentWidthMode={cycleContentWidthMode} tableDisplayContext={tableDisplayContext} onTableWidthModeChange={handleTableWidthModeChange} />}
                hasDocument={Boolean(activeTab)}
                markdown={markdown}
                documentTitle={documentTitle}
                onDocumentTitleChange={activeTab && activeTab.kind !== "image" ? renameActiveDocument : undefined}
                documentKey={documentKey}
                documentTabId={activeTabId}
                markdownSourcePath={markdownSourcePath}
                isDark={isDark}
                onChange={setMarkdown}
                onFileTextLoad={handleFileTextLoad}
                onNativeFileSelect={isTauriEnvironment() ? handleNativeMarkdownFileLoad : undefined}
                onBatchSelect={runBatchImport}
                onReadClipboard={handleReadClipboard}
                onRequestSave={canSaveActiveDocument ? () => void saveActiveDocument(false) : undefined}
                onImportImage={importImageFile}
                disabled={isConverting}
                externalDragging={isWindowDragging}
                externalDraggingImage={isWindowDraggingImage}
                readingMode={readingMode}
                contentWidthMode={contentWidthMode}
                onOpenLink={(target) => void handleOpenLink(target)}
                tableDefaultWidthMode={globalTableWidthMode}
                onTableContextChange={setTableDisplayContext}
              />
            )}
          </div>

        {showPreviewPanel ? (
          <>
            <div className="relative z-20 min-h-0 w-0">
              <div
                className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
                onPointerDown={(event) => handlePreviewResizeStart(event, false)}
                style={{ touchAction: "none" }}
                role="separator"
                aria-label="调整 Word 预览宽度"
              >
                <span className="pointer-events-none h-16 w-1 rounded-full bg-transparent transition group-hover:bg-slate-300/70 dark:group-hover:bg-zinc-700" />
              </div>
            </div>

            <div
              className={cn("mk-preview-layout grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-x-0 gap-y-1 overflow-hidden", showInlinePreviewSidebar ? "grid-cols-[minmax(172px,var(--preview-sidebar-width))_5px_minmax(0,1fr)]" : "grid-cols-1")}
              style={{ "--preview-sidebar-width": `${previewSidebarWidth}px` } as CSSProperties}
            >
              {showInlinePreviewSidebar ? (
                <>
                  <WordPreviewSidebar
                    activeView={previewSidebarView}
                    headings={previewOutline}
                    pageCount={previewPageCount}
                    onViewChange={openPreviewSidebarView}
                    onHeadingJump={scrollToPreviewHeading}
                    onThumbnailContainerChange={setPreviewThumbnailContainer}
                  />
                  <div
                    className="group flex min-h-0 cursor-col-resize items-center justify-center"
                    onPointerDown={(event) => handlePreviewSidebarResizeStart(event, event.currentTarget.parentElement as HTMLDivElement | null)}
                    role="separator"
                    aria-label="调整预览导航宽度"
                    aria-orientation="vertical"
                  >
                    <span className="h-10 w-1 rounded-full bg-slate-300/75 transition group-hover:h-16 group-hover:bg-blue-400 dark:bg-zinc-700 dark:group-hover:bg-blue-500" />
                  </div>
                </>
              ) : null}
              <ConvertPreviewPanel
                markdown={deferredPreviewMarkdown}
                markdownSourcePath={markdownSourcePath}
                outputName={outputName}
                styleConfig={previewStyleConfig}
                zoom={previewZoom}
                setZoom={setPreviewZoom}
                onToggleExpanded={() => { previewExpandedFromNarrowRef.current = false; setPreviewExpanded(true); }}
                paperTheme={previewPaperTheme}
                onTogglePaperTheme={togglePreviewPaperTheme}
                onOpenAdvancedStyle={() => setExpandedStyleEditorOpen(true)}
                thumbnailContainer={showInlinePreviewSidebar ? previewThumbnailContainer : null}
                onThumbnailPageSelect={showInlinePreviewSidebar ? scrollToPreviewPage : undefined}
                onPreviewOutlineChange={setPreviewOutline}
                onOpenLink={(target) => void handleOpenLink(target)}
                className="min-h-0 min-w-0"
              />
              {renderConvertFooter("col-span-full shrink-0", "responsive")}
            </div>
          </>
        ) : isDocumentWorkspace && !layoutTooNarrow ? (
          <div className="relative z-20 min-h-0 w-0">
            <div
              className="group absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize touch-none"
              onPointerDown={(event) => handlePreviewResizeStart(event, true)}
              style={{ touchAction: "none" }}
              role="separator"
              aria-label="拖动展开 Word 预览"
            />
          </div>
        ) : null}
      </div>

    </div>
    </>
  );
}

function WorkspacePageSlot({ children }: { children: ReactNode }) {
  return (
    <section data-mk-workspace-page className="flex h-full min-h-[360px] min-w-0 flex-col overflow-hidden max-[760px]:min-h-[300px]">
      <div className="min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </section>
  );
}

function normalizeOutputName(value: string) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "-") || "untitled.docx";
  return cleaned.toLowerCase().endsWith(".docx") ? cleaned : `${cleaned}.docx`;
}

function ConvertPreviewPanel({
  markdown,
  markdownSourcePath,
  outputName,
  styleConfig,
  zoom,
  setZoom,
  onToggleExpanded,
  paperTheme,
  onTogglePaperTheme,
  footer,
  onOpenAdvancedStyle,
  expanded = false,
  showTocPage = false,
  thumbnailContainer,
  onThumbnailPageSelect,
  onPreviewOutlineChange,
  onOpenLink,
  className,
  previewClassName,
}: {
  markdown: string;
  markdownSourcePath?: string;
  outputName: string;
  styleConfig: TemplateStyleConfig;
  zoom: number;
  setZoom: (value: number | ((current: number) => number)) => void;
  onToggleExpanded: () => void;
  paperTheme: PreviewPaperTheme;
  onTogglePaperTheme: () => void;
  /// 导出区：模板、输出目录、文件名、转换按钮。挂在面板底部而不是页面底部，
  /// 编辑区因此能拿到完整高度。
  footer?: ReactNode;
  onOpenAdvancedStyle?: () => void;
  expanded?: boolean;
  showTocPage?: boolean;
  thumbnailContainer?: HTMLDivElement | null;
  onThumbnailPageSelect?: (page: number) => void;
  onPreviewOutlineChange?: (items: PreviewOutlineItem[]) => void;
  onOpenLink?: (target: string) => void;
  className?: string;
  previewClassName?: string;
}) {
  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((value) => clampPreviewZoom(value + direction * previewWheelZoomStep));
  }

  async function copyPreviewMarkdown() {
    if (!markdown.trim()) return;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <AppSurface as="aside" padding="none" radius="md" data-mk-context-menu className={cn("mk-preview-panel flex min-h-0 flex-col overflow-hidden p-3", className)}>
      <div className="mk-preview-header mb-2.5 flex min-w-0 shrink-0 items-center justify-between gap-2">
        <div className="mk-preview-title min-w-0 flex-1">
          <p className="truncate text-sm font-black text-slate-950 dark:text-zinc-50">Word 预览</p>
          <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{markdown.trim() ? outputName : "等待 Markdown 内容"}</p>
        </div>
        <WordPreviewToolbar
          className="mk-preview-toolbar"
          zoom={zoom}
          canZoomOut={zoom > previewZoomMin}
          canZoomIn={zoom < previewZoomMax}
          onZoomOut={() => setZoom((value) => clampPreviewZoom(value - previewZoomStep))}
          onZoomIn={() => setZoom((value) => clampPreviewZoom(value + previewZoomStep))}
          paperTheme={paperTheme}
          onTogglePaperTheme={onTogglePaperTheme}
          onOpenAdvancedStyle={onOpenAdvancedStyle}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
        />
      </div>
      <div className="min-h-0 flex-1" onWheel={handlePreviewWheel}>
        <WordPreviewPage
          markdown={markdown}
          markdownSourcePath={markdownSourcePath}
          styleConfig={styleConfig}
          zoom={zoom}
          paginate
          showTocPage={showTocPage}
          thumbnailContainer={thumbnailContainer}
          onThumbnailPageSelect={onThumbnailPageSelect}
          onPreviewOutlineChange={onPreviewOutlineChange}
          onOpenLink={onOpenLink}
          showHeader={false}
          interactiveViewport
          paperTheme={paperTheme}
          className={cn("max-h-none min-h-0 overflow-hidden border-0 bg-transparent p-0 shadow-none", previewClassName)}
          viewportClassName="bg-transparent p-2 dark:bg-zinc-950/95 dark:ring-1 dark:ring-zinc-800/80"
        />
      </div>
      {footer ? <div className="mt-2.5 shrink-0 border-t border-slate-200 pt-2.5 dark:border-zinc-700/70">{footer}</div> : null}
        </AppSurface>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <ContextMenu.Item className={previewContextMenuItemClass} onSelect={() => void copyPreviewMarkdown()} disabled={!markdown.trim()}>复制 Markdown</ContextMenu.Item>
          <ContextMenu.Item className={previewContextMenuItemClass} onSelect={() => setZoom(40)} disabled={zoom === 40}>重置预览缩放</ContextMenu.Item>
          {onOpenAdvancedStyle ? <ContextMenu.Item className={previewContextMenuItemClass} onSelect={onOpenAdvancedStyle}>打开高级样式</ContextMenu.Item> : null}
          <ContextMenu.Item className={previewContextMenuItemClass} onSelect={onToggleExpanded}>{expanded ? "缩小还原预览" : "放大查看预览"}</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function WordPreviewSidebar({
  activeView,
  headings,
  pageCount,
  onViewChange,
  onHeadingJump,
  onThumbnailContainerChange,
}: {
  activeView: PreviewSidebarView;
  headings: PreviewOutlineItem[];
  pageCount: number;
  onViewChange: (view: PreviewSidebarView) => void;
  onHeadingJump: (id: string) => void;
  onThumbnailContainerChange: (element: HTMLDivElement | null) => void;
}) {
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(() => new Set());
  const collapsibleHeadingIds = useMemo(() => new Set(
    headings.flatMap((heading, index) => headings[index + 1]?.level > heading.level ? [heading.id] : []),
  ), [headings]);

  function isHeadingVisible(index: number) {
    let parentLevel = headings[index].level;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = headings[candidateIndex];
      if (candidate.level < parentLevel) {
        if (collapsedHeadingIds.has(candidate.id)) return false;
        parentLevel = candidate.level;
      }
    }
    return true;
  }

  function toggleHeading(id: string) {
    setCollapsedHeadingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 max-[900px]:hidden">
      <div className="mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-[8px] bg-slate-100 p-0.5 dark:bg-zinc-900">
        <button
          type="button"
          className={cn("flex h-7 items-center justify-center gap-1 rounded-[6px] font-semibold transition", activeView === "pages" ? "bg-white text-blue-700 shadow-sm dark:bg-zinc-800 dark:text-blue-200" : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-100")}
          style={{ fontSize: "11px" }}
          onClick={() => onViewChange("pages")}
        >
          <PanelsTopLeft className="size-3" />
          缩略图
        </button>
        <button
          type="button"
          className={cn("flex h-7 items-center justify-center gap-1 rounded-[6px] font-semibold transition", activeView === "outline" ? "bg-white text-blue-700 shadow-sm dark:bg-zinc-800 dark:text-blue-200" : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-100")}
          style={{ fontSize: "11px" }}
          onClick={() => onViewChange("outline")}
        >
          <FileText className="size-3" />
          目录
        </button>
      </div>

      {activeView === "pages" ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-500 dark:text-zinc-400">页面缩略图</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{pageCount} 页</span>
          </div>
            <div ref={onThumbnailContainerChange} className="grid min-h-0 flex-1 auto-rows-max items-start content-start grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2 overflow-x-hidden overflow-y-auto pr-1 max-[900px]:max-h-[120px]" />
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-500 dark:text-zinc-400">文档目录</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-900 dark:text-zinc-400">{headings.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            {headings.length > 0 ? (
              <div>
                {headings.map((heading, index) => {
                  if (!isHeadingVisible(index)) return null;
                  const canCollapse = collapsibleHeadingIds.has(heading.id);
                  const isCollapsed = collapsedHeadingIds.has(heading.id);
                  return (
                    <div key={heading.id} className="flex h-6 min-w-0 items-center gap-0.5" style={{ paddingLeft: Math.min(5, heading.level - 1) * 8 }}>
                      {canCollapse ? (
                        <button
                          type="button"
                          className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          onClick={() => toggleHeading(heading.id)}
                          aria-label={`${isCollapsed ? "展开" : "折叠"}${heading.text}`}
                        >
                          {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                        </button>
                      ) : <span className="size-4 shrink-0" />}
                      <TooltipAnchor content={heading.text} tooltipSide="right">
                        <button
                          type="button"
                          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-[5px] pr-1 text-left leading-6 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 dark:text-zinc-300 dark:hover:bg-blue-500/12 dark:hover:text-blue-200"
                          onClick={() => onHeadingJump(heading.id)}
                        >
                          {heading.number ? <span className="shrink-0 text-slate-400 dark:text-zinc-500" style={{ fontSize: "10px", fontWeight: 600 }}>{heading.number}</span> : null}
                          <span className="min-w-0 flex-1 truncate" style={{ fontSize: "12px", fontFamily: "sans-serif", fontWeight: 500 }}>{heading.text}</span>
                          <span className="shrink-0 tabular-nums text-slate-400 dark:text-zinc-500" style={{ fontSize: "10px", fontWeight: 600 }}>{heading.page}</span>
                        </button>
                      </TooltipAnchor>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-semibold leading-5 text-slate-400 dark:border-zinc-800 dark:text-zinc-500">
                当前 Markdown 没有标题，目录会在识别到 # 标题后显示。
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
