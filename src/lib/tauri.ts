import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { resolveBrowserPreviewImage } from "./browser-preview-images.ts";
import { downloadDir, join } from "@tauri-apps/api/path";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { limitHistory } from "./conversion-history.ts";
import type { AppConfig, AppStatus, ConvertRequest, ConvertResult, HistoryItem, ImportTemplateRequest, PandocStatus, Template, TemplateStyleConfig } from "@/types";

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

const PREVIEW_WARNING = "浏览器预览未调用 Rust/Tauri/Pandoc";
const PANDOC_BROWSER_MESSAGE = "浏览器预览无法验证内置 Pandoc，请在 Tauri 桌面端验证";
// 浏览器预览无法读取本机用户目录；使用绝对路径形式，避免把相对目录误认为实际导出位置。
const browserPreviewOutputDir = "C:\\Users\\<当前用户>\\Documents\\MD King";

const browserAppStatus: AppStatus = {
  name: "md-king",
  version: "1.1.9",
  description: "Markdown 转 Word 桌面工具",
  tauriVersion: "browser-preview",
  platform: "browser-preview",
};

const browserAppConfig: AppConfig = {
  pandocPath: undefined,
  useBundledPandoc: true,
  defaultTemplateId: "default-report",
  defaultOutputDir: browserPreviewOutputDir,
  openAfterConvert: false,
  enableContextMenu: false,
  enableFloatingBall: false,
  enableTray: false,
  enableQuickPaste: false,
  quickPasteShortcut: "Ctrl+Alt+V",
  quickPasteTemplateId: undefined,
  cliDefaultJson: true,
  logLevel: "info",
  language: "zh",
  themeMode: "light",
  accentColor: "blue",
  defaultConflictStrategy: "overwrite",
  keepConversionLog: true,
  vaultRoot: undefined,
  recentVaults: [],
  autoSave: true,
  autoSaveDelayMs: 1000,
  pageZoomPercent: 100,
  fileTreeWidth: undefined,
  lastOpenedFile: undefined,
};

const builtInTemplates: Template[] = [
  {
    id: "default-report",
    name: "默认报告模板",
    description: "适合 AI 生成的通用报告、方案和说明文档。",
    referenceDocxPath: "",
    previewImagePath: undefined,
    tags: ["系统", "内置"],
    isBuiltIn: true,
    isDefault: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "official-document",
    name: "正式公文模板",
    description: "适合正式材料的标题层级、正文缩进和页边距样式。",
    referenceDocxPath: "",
    previewImagePath: undefined,
    tags: ["系统", "内置"],
    isBuiltIn: true,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "technical-spec",
    name: "技术文档模板",
    description: "强化代码块、表格、列表和引用样式，适合技术方案。",
    referenceDocxPath: "",
    previewImagePath: undefined,
    tags: ["系统", "内置"],
    isBuiltIn: true,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  },
];

let browserConfig = browserAppConfig;
let browserTemplates = builtInTemplates;
let browserHistory: HistoryItem[] = [];
let browserTemplateStyleConfigs: Record<string, TemplateStyleConfig> = {};

function normalizeBrowserTemplateDefaults(templates: Template[]) {
  if (templates.some((template) => template.id === browserConfig.defaultTemplateId)) {
    return templates.map((template) => ({ ...template, isDefault: template.id === browserConfig.defaultTemplateId }));
  }

  let foundDefault = false;
  const normalized = templates.map((template) => {
    if (template.isDefault && !foundDefault) {
      foundDefault = true;
      return { ...template, isDefault: true };
    }
    return { ...template, isDefault: false };
  });

  if (!foundDefault && normalized[0]) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }

  return normalized;
}

export function isTauriEnvironment() {
  if (typeof window === "undefined") {
    return false;
  }

  const tauriWindow = window as TauriWindow;
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

function normalizeDialogSelection(selected: string | string[] | null) {
  if (Array.isArray(selected)) {
    return selected[0];
  }
  return selected ?? undefined;
}

function normalizeDialogSelections(selected: string | string[] | null) {
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

function markdownSaveFileName(title: string) {
  const baseName = title
    .trim()
    .replace(/\.(?:md|markdown|txt)$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[ .]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${baseName || "未命名"}.md`;
}

function ensureMarkdownSaveExtension(path: string) {
  if (/\.md$/i.test(path)) return path;
  return path.replace(/\.(?:markdown|txt)$/i, "") + ".md";
}

export async function selectDirectory(title = "选择默认输出目录") {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开目录选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelection(await open({ directory: true, multiple: false, title }));
}

export async function selectMarkdownSavePath(title: string) {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法保存到本机路径，请在 Tauri 桌面端使用");
  }

  const fileName = markdownSaveFileName(title);
  let defaultPath = fileName;
  try {
    defaultPath = await join(await downloadDir(), fileName);
  } catch {
    // 系统下载目录不可用时，仍让原生保存框使用建议文件名。
  }

  const selected = normalizeDialogSelection(await saveDialog({
    title: "保存 Markdown 文档",
    defaultPath,
    filters: [{ name: "Markdown 文档", extensions: ["md"] }],
  }));
  return selected ? ensureMarkdownSaveExtension(selected) : undefined;
}

export async function selectDocxFile() {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开文件选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelection(await open({
    directory: false,
    multiple: false,
    title: "选择 reference.docx 模板文件",
    filters: [{ name: "Word 文档", extensions: ["docx"] }],
  }));
}

export async function selectMarkdownFiles() {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开文件选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelections(await open({
    directory: false,
    multiple: true,
    title: "选择 Markdown / TXT 文件",
    filters: [{ name: "Markdown / TXT 文档", extensions: ["md", "markdown", "txt"] }],
  }));
}

export async function selectMdFile() {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开文件选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelection(await open({
    directory: false,
    multiple: false,
    title: "选择 Markdown 文件",
    filters: [{ name: "Markdown 文档", extensions: ["md"] }],
  }));
}

export async function selectMarkdownFile() {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开文件选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelection(await open({
    directory: false,
    multiple: false,
    title: "选择 Markdown / TXT 文件",
    filters: [{ name: "Markdown / TXT 文档", extensions: ["md", "markdown", "txt"] }],
  }));
}

export function readMarkdownFileFromPath(path: string) {
  if (!isTauriEnvironment()) {
    return Promise.reject(new Error("浏览器预览无法读取本机 Markdown/TXT 文件，请在桌面端使用"));
  }

  return invoke<string>("read_markdown_file", { path });
}

export function takeOpenFiles() {
  if (!isTauriEnvironment()) {
    return Promise.resolve<string[]>([]);
  }

  return invoke<string[]>("take_open_files");
}

export function resolvePreviewImageSource(path: string, sourcePath?: string) {
  if (/^(?:https?:|data:|blob:)/i.test(path)) {
    return Promise.resolve(path);
  }
  if (!isTauriEnvironment()) {
    return Promise.resolve(resolveBrowserPreviewImage(path, sourcePath));
  }

  return invoke<string>("load_preview_image", { path, sourcePath });
}

export function getAppStatus() {
  if (isTauriEnvironment()) {
    return invoke<AppStatus>("get_app_status");
  }

  return Promise.resolve(browserAppStatus);
}

export function getAppConfig() {
  if (isTauriEnvironment()) {
    return invoke<AppConfig>("get_app_config");
  }

  return Promise.resolve(browserConfig);
}

export function saveAppConfig(config: AppConfig) {
  if (isTauriEnvironment()) {
    return invoke<AppConfig>("save_app_config", { config });
  }

  browserConfig = config;
  return Promise.resolve(browserConfig);
}

export function checkPandoc() {
  if (isTauriEnvironment()) {
    return invoke<PandocStatus>("check_pandoc");
  }

  return Promise.resolve<PandocStatus>({
    available: false,
    errorCode: "BROWSER_PREVIEW_PANDOC_UNAVAILABLE",
    message: PANDOC_BROWSER_MESSAGE,
  });
}

export function listTemplates() {
  if (isTauriEnvironment()) {
    return invoke<Template[]>("list_templates");
  }

  browserTemplates = normalizeBrowserTemplateDefaults(browserTemplates);
  return Promise.resolve(browserTemplates);
}

export function importTemplate(request: ImportTemplateRequest) {
  if (isTauriEnvironment()) {
    return invoke<Template>("import_template", { request });
  }

  const template: Template = {
    id: `browser-${Date.now()}`,
    name: request.name,
    description: request.description,
    referenceDocxPath: request.referenceDocxPath,
    previewImagePath: undefined,
    tags: request.tags,
    isBuiltIn: false,
    isDefault: request.isDefault ?? false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (request.isDefault) {
    browserConfig = { ...browserConfig, defaultTemplateId: template.id };
  }
  browserTemplates = normalizeBrowserTemplateDefaults(browserTemplates.concat(template));
  return Promise.resolve(template);
}

export function saveTemplates(templates: Template[]) {
  if (isTauriEnvironment()) {
    return invoke<Template[]>("save_templates", { templates });
  }

  const builtIns = browserTemplates.filter((template) => template.isBuiltIn);
  browserTemplates = normalizeBrowserTemplateDefaults(builtIns.concat(templates.filter((template) => !template.isBuiltIn)));
  return Promise.resolve(browserTemplates);
}

export function getTemplateStyleConfig(templateId: string) {
  if (isTauriEnvironment()) {
    return invoke<TemplateStyleConfig | null>("get_template_style_config", { templateId });
  }

  return Promise.resolve(browserTemplateStyleConfigs[templateId] ?? null);
}

export function getTemplateStyleConfigs(templateIds: string[]) {
  if (isTauriEnvironment()) {
    return invoke<Record<string, TemplateStyleConfig>>("get_template_style_configs", { templateIds });
  }

  return Promise.resolve(Object.fromEntries(
    templateIds.flatMap((templateId) => browserTemplateStyleConfigs[templateId]
      ? [[templateId, browserTemplateStyleConfigs[templateId]]]
      : []),
  ));
}

export function saveTemplateStyleConfig(config: TemplateStyleConfig) {
  if (isTauriEnvironment()) {
    return invoke<TemplateStyleConfig>("save_template_style_config", { config });
  }

  browserTemplateStyleConfigs = { ...browserTemplateStyleConfigs, [config.templateId]: config };
  return Promise.resolve(config);
}

export function resetTemplateStyleConfig(templateId: string) {
  if (isTauriEnvironment()) {
    return invoke<void>("reset_template_style_config", { templateId });
  }

  const { [templateId]: _removed, ...rest } = browserTemplateStyleConfigs;
  browserTemplateStyleConfigs = rest;
  return Promise.resolve();
}

export function listHistory() {
  if (isTauriEnvironment()) {
    return invoke<HistoryItem[]>("list_history");
  }

  return Promise.resolve(browserHistory);
}

export function saveHistory(history: HistoryItem[]) {
  if (isTauriEnvironment()) {
    return invoke<HistoryItem[]>("save_history", { history });
  }

  browserHistory = history;
  return Promise.resolve(browserHistory);
}

/// 追加而非覆盖：后端会重新读盘再插入，避免另一个窗口/进程的写入被本窗口的旧快照抹掉。
export function appendHistory(items: HistoryItem[]) {
  if (isTauriEnvironment()) {
    return invoke<HistoryItem[]>("append_history", { items });
  }

  const newIds = new Set(items.map((item) => item.id));
  browserHistory = limitHistory([...items, ...browserHistory.filter((item) => !newIds.has(item.id))]);
  return Promise.resolve(browserHistory);
}

export function clearHistoryRemote() {
  if (isTauriEnvironment()) {
    return invoke<HistoryItem[]>("clear_history");
  }

  browserHistory = [];
  return Promise.resolve(browserHistory);
}

export function openOutputPath(path: string) {
  if (isTauriEnvironment()) {
    return invoke<void>("open_output_path", { path });
  }

  return Promise.reject(new Error("浏览器预览无法打开本机文件，请在 Tauri 桌面端使用"));
}

export function revealOutputPath(path: string) {
  if (isTauriEnvironment()) {
    return invoke<void>("reveal_output_path", { path });
  }

  return Promise.reject(new Error("浏览器预览无法打开资源管理器，请在 Tauri 桌面端使用"));
}

export function convertMarkdown(request: ConvertRequest) {
  if (isTauriEnvironment()) {
    return invoke<ConvertResult>("convert_markdown", { request });
  }

  return Promise.resolve<ConvertResult>({
    ok: true,
    simulated: true,
    input: request.input,
    output: "浏览器预览：未生成实际 DOCX 文件",
    templateId: request.templateId,
    durationMs: 0,
    warnings: [PREVIEW_WARNING],
    diagnostics: [],
    statistics: { mermaidBlocks: 0, mermaidRendered: 0, mermaidFailed: 0, imageCount: 0, tableCount: 0, multiPageTableCandidateCount: 0, tableWidthRiskIndices: [], imageDetails: [] },
    message: "浏览器预览完成，未生成实际 DOCX 文件。",
  });
}

let lastToggleMaximizeTime = 0;
let lastPointerDownTime = 0;
let lastPointerDownX = 0;
let lastPointerDownY = 0;
let activeDragCleanup: (() => void) | null = null;

export const TAURI_MAXIMIZED_CHANGED_EVENT = "mk-window-maximized-changed";

export type WindowDragTarget = {
  startDragging: () => Promise<unknown>;
  toggleMaximize: () => Promise<unknown>;
};

/**
 * 节流触发窗口最大化/还原，防止短时间内重复触发导致窗口状态震荡。
 */
export function triggerTauriWindowToggleMaximize(windowGetter: () => WindowDragTarget = getCurrentWindow) {
  if (!isTauriEnvironment()) return;
  const now = Date.now();
  if (now - lastToggleMaximizeTime < 250) return;
  lastToggleMaximizeTime = now;

  try {
    void windowGetter()
      .toggleMaximize()
      .then(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(TAURI_MAXIMIZED_CHANGED_EVENT));
        }
      })
      .catch(() => undefined);
  } catch {
    // 忽略异常
  }
}

/**
 * 在顶部栏、侧边栏等空白区域按下鼠标左键时处理窗口拖拽与双击最大化/还原。
 * - 核心机制：轻微移动阈值判定拖拽（移动超过 4px 才启动原生拖拽），彻底杜绝原生拖拽吞噬双击事件；
 * - 采用时间戳 + 坐标容差与 event.detail 双保险识别双击，在最大化与窗口化双向切换时均 100% 灵敏响应；
 * - 自动忽略按钮、输入框、标签、菜单项等可交互控件。
 */
export function handleTauriWindowDrag(
  event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  windowGetter: () => WindowDragTarget = getCurrentWindow,
) {
  if (event.button !== 0) return;
  if (!isTauriEnvironment()) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  // 如果点击的是按钮、输入框、下拉菜单、标签等可交互控件，不处理
  if (target.closest("button, input, select, textarea, a, [role='button'], [role='tab'], [role='menuitem'], [data-mk-context-menu], [data-no-drag]")) {
    return;
  }

  if (activeDragCleanup) {
    activeDragCleanup();
    activeDragCleanup = null;
  }

  const now = Date.now();
  const timeDiff = now - lastPointerDownTime;
  const clientX = event.clientX ?? 0;
  const clientY = event.clientY ?? 0;
  const dist = Math.hypot(clientX - lastPointerDownX, clientY - lastPointerDownY);

  // 双击判定：
  // 1. 原生 event.detail === 2
  // 2. 或两次按下间隔在 40ms ~ 450ms 之间且位移 <= 12px
  const isDoubleClick = event.detail === 2 || (timeDiff >= 40 && timeDiff <= 450 && dist <= 12);

  if (isDoubleClick) {
    lastPointerDownTime = 0;
    triggerTauriWindowToggleMaximize(windowGetter);
    return;
  }

  lastPointerDownTime = now;
  lastPointerDownX = clientX;
  lastPointerDownY = clientY;

  const startX = clientX;
  const startY = clientY;

  // 在没有 DOM 移动事件的纯测试环境（Node.js）中，如果 window 不存在或不支持 addEventListener，直接按单次拖拽处理
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    try {
      void windowGetter().startDragging().catch(() => undefined);
    } catch {
      // 忽略异常
    }
    return;
  }

  const onPointerMove = (moveEvent: PointerEvent | MouseEvent) => {
    const delta = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (delta >= 4) {
      cleanup();
      try {
        void windowGetter().startDragging().catch(() => undefined);
      } catch {
        // 忽略异常
      }
    }
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("mouseup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("blur", cleanup);
    if (activeDragCleanup === cleanup) {
      activeDragCleanup = null;
    }
  };

  activeDragCleanup = cleanup;

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("mousemove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("mouseup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
  window.addEventListener("blur", cleanup, { once: true });
}

/**
 * 在顶部栏、侧边栏等空白区域双击时切换窗口最大化与还原。
 */
export function handleTauriWindowDoubleClick(
  event: ReactMouseEvent<HTMLElement>,
  windowGetter: () => WindowDragTarget = getCurrentWindow,
) {
  if (event.button !== 0) return;
  if (!isTauriEnvironment()) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (target.closest("button, input, select, textarea, a, [role='button'], [role='tab'], [role='menuitem'], [data-mk-context-menu], [data-no-drag]")) {
    return;
  }

  triggerTauriWindowToggleMaximize(windowGetter);
}

export type DownloadProgressPayload = {
  percent: number;
  transferred: number;
  total: number;
  speed_bytes_per_sec: number;
};

export async function fetchLatestRelease(repo?: string): Promise<string> {
  if (!isTauriEnvironment()) {
    const repoName = repo ?? "GuoWWWX/md-king";
    const resp = await fetch(`https://api.github.com/repos/${repoName}/releases/latest`);
    if (resp.status === 404) return "null";
    if (!resp.ok) {
      throw new Error(`获取 Release 失败: HTTP ${resp.status}`);
    }
    return resp.text();
  }
  return invoke<string>("fetch_latest_release", { repo });
}

export async function downloadUpdateInstaller(downloadUrl: string, version: string): Promise<string> {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览模式不支持直接下载安装更新包");
  }
  return invoke<string>("download_update_installer", { downloadUrl, version });
}

export async function launchUpdateInstaller(installerPath: string, silent = false): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览模式不支持启动安装程序");
  }
  return invoke<void>("launch_update_installer", { installerPath, silent });
}

export async function cancelUpdateDownload(): Promise<void> {
  if (!isTauriEnvironment()) return;
  return invoke<void>("cancel_update_download");
}
