import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, AppStatus, ConvertRequest, ConvertResult, HistoryItem, ImportTemplateRequest, PandocStatus, Template, TemplateStyleConfig } from "@/types";

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

const PREVIEW_WARNING = "浏览器预览未调用 Rust/Tauri/Pandoc";
const PANDOC_BROWSER_MESSAGE = "浏览器预览无法验证内置 Pandoc，请在 Tauri 桌面端验证";

const browserAppStatus: AppStatus = {
  name: "md-king",
  version: "1.1.8",
  description: "Markdown 转 Word 桌面工具",
  tauriVersion: "browser-preview",
  platform: "browser-preview",
};

const browserAppConfig: AppConfig = {
  pandocPath: undefined,
  useBundledPandoc: true,
  defaultTemplateId: "default-report",
  defaultOutputDir: "Documents/MD King",
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

export async function selectDirectory() {
  if (!isTauriEnvironment()) {
    throw new Error("浏览器预览无法打开目录选择器，请在 Tauri 桌面端使用");
  }

  return normalizeDialogSelection(await open({ directory: true, multiple: false, title: "选择默认输出目录" }));
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
    return Promise.resolve<string | undefined>(undefined);
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
    message: "浏览器预览完成，未生成实际 DOCX 文件。",
  });
}
