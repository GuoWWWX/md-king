import type { DocumentTab, DocumentTabKind, DocumentViewState } from "@/stores/document-tabs-store";
import type { VaultEol } from "@/types/vault";

const documentSessionStoragePrefix = "md-king.document-session.v1:";
const maximumPersistedTabs = 50;
const maximumPathLength = 2_048;
const maximumTitleLength = 256;

export type PersistedDocumentTab = {
  kind: DocumentTabKind;
  path?: string;
  absolutePath?: string;
  title: string;
  titleEdited?: boolean;
  dirty: boolean;
  /** 干净的磁盘文件启动时重新读取；只有临时文档或未保存内容需要写入会话。 */
  content?: string;
  eol?: VaultEol;
  hasBom?: boolean;
  modifiedMs?: number;
  viewState?: DocumentViewState;
};

export type PersistedDocumentSession = {
  version: 1;
  vaultRoot?: string;
  tabs: PersistedDocumentTab[];
  activeIndex: number;
  activePage: string;
  pageTabs: string[];
};

const restorablePages = new Set(["convert", "templates", "history", "settings", "about"]);

function normalizedRoot(root: string | undefined) {
  const value = root?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return value || undefined;
}

export function documentSessionStorageKey(root: string | undefined) {
  return `${documentSessionStoragePrefix}${encodeURIComponent(normalizedRoot(root)?.toLowerCase() ?? "default")}`;
}

function finiteNonNegative(value: unknown, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const normalized = Math.max(0, value);
  return integer ? Math.floor(normalized) : normalized;
}

function normalizeViewState(value: unknown): DocumentViewState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const viewState = value as Partial<DocumentViewState>;
  return {
    scrollTop: finiteNonNegative(viewState.scrollTop),
    anchor: finiteNonNegative(viewState.anchor, true),
    head: finiteNonNegative(viewState.head, true),
  };
}

function optionalString(value: unknown, maximumLength = maximumPathLength) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : undefined;
}

function parsePersistedTab(value: unknown): PersistedDocumentTab | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tab = value as Partial<PersistedDocumentTab>;
  if (tab.kind !== "vault" && tab.kind !== "scratch" && tab.kind !== "image") return undefined;

  const path = optionalString(tab.path);
  const absolutePath = optionalString(tab.absolutePath);
  const title = optionalString(tab.title, maximumTitleLength) ?? "未命名";
  const content = typeof tab.content === "string" ? tab.content : undefined;
  if (tab.kind === "scratch" && content === undefined) return undefined;
  if (tab.kind !== "scratch" && !path && !absolutePath) return undefined;

  return {
    kind: tab.kind,
    path,
    absolutePath,
    title,
    titleEdited: tab.titleEdited === true || undefined,
    dirty: tab.dirty === true,
    content,
    eol: tab.eol === "crlf" ? "crlf" : tab.eol === "lf" ? "lf" : undefined,
    hasBom: typeof tab.hasBom === "boolean" ? tab.hasBom : undefined,
    modifiedMs: typeof tab.modifiedMs === "number" && Number.isFinite(tab.modifiedMs)
      ? Math.max(0, tab.modifiedMs)
      : undefined,
    viewState: normalizeViewState(tab.viewState),
  };
}

export function createDocumentSession(
  tabs: DocumentTab[],
  activeTabId: string | undefined,
  vaultRoot: string | undefined,
  activePage: string,
  pageTabs: string[],
): PersistedDocumentSession {
  const persistedTabs = tabs.slice(0, maximumPersistedTabs).map<PersistedDocumentTab>((tab) => ({
    kind: tab.kind,
    path: tab.path,
    absolutePath: tab.absolutePath,
    title: tab.title,
    titleEdited: tab.titleEdited,
    dirty: tab.dirty,
    content: tab.kind === "scratch" || tab.dirty ? tab.content : undefined,
    eol: tab.eol,
    hasBom: tab.hasBom,
    modifiedMs: tab.modifiedMs,
    viewState: tab.viewState,
  }));
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
  return {
    version: 1,
    vaultRoot: normalizedRoot(vaultRoot),
    tabs: persistedTabs,
    activeIndex: Math.min(activeIndex, Math.max(0, persistedTabs.length - 1)),
    activePage: restorablePages.has(activePage) ? activePage : "convert",
    pageTabs: Array.from(new Set(pageTabs.filter((page) => page !== "convert" && restorablePages.has(page)))),
  };
}

export function parseDocumentSession(raw: string | null, expectedRoot?: string): PersistedDocumentSession | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<PersistedDocumentSession>;
    if (value.version !== 1 || !Array.isArray(value.tabs)) return undefined;
    const root = normalizedRoot(value.vaultRoot);
    const expected = normalizedRoot(expectedRoot);
    if ((root ?? "").toLowerCase() !== (expected ?? "").toLowerCase()) return undefined;
    const tabs = value.tabs.slice(0, maximumPersistedTabs).flatMap((tab) => {
      const parsed = parsePersistedTab(tab);
      return parsed ? [parsed] : [];
    });
    const activeIndex = Math.min(
      finiteNonNegative(value.activeIndex, true),
      Math.max(0, tabs.length - 1),
    );
    const activePage = typeof value.activePage === "string" && restorablePages.has(value.activePage)
      ? value.activePage
      : "convert";
    const pageTabs = Array.isArray(value.pageTabs)
      ? Array.from(new Set(value.pageTabs.filter((page): page is string => typeof page === "string" && page !== "convert" && restorablePages.has(page))))
      : [];
    return { version: 1, vaultRoot: root, tabs, activeIndex, activePage, pageTabs };
  } catch {
    return undefined;
  }
}

export function loadDocumentSession(root: string | undefined) {
  try {
    return parseDocumentSession(window.localStorage.getItem(documentSessionStorageKey(root)), root);
  } catch {
    return undefined;
  }
}

export function saveDocumentSession(session: PersistedDocumentSession) {
  try {
    window.localStorage.setItem(documentSessionStorageKey(session.vaultRoot), JSON.stringify(session));
  } catch {
    // WebView 存储不可写或未保存正文超过配额时不阻断编辑、保存和退出流程。
  }
}
