import { create } from "zustand";
import type { VaultEntry, VaultEol, VaultSaveState } from "@/types/vault";

/// 独立于 app-store：vault 状态（尤其 saveState / expandedDirs）更新频率远高于 appConfig，
/// 合并进去会让所有订阅 appConfig 的组件跟着重渲染。
/// 编辑器文本也刻意不进这里 —— CodeMirror 的 EditorState 才是文档唯一真相源。

const TREE_STATE_KEY_PREFIX = "md-king-vault-tree:";
const FILE_TREE_MIN_WIDTH = 180;
const FILE_TREE_MAX_WIDTH = 520;
const DEFAULT_FILE_TREE_WIDTH = 260;
const MAX_RECENT_VAULTS = 10;

/// 用 root 全路径直接做 key 会把盘符/中文/斜杠塞进 localStorage 键名，
/// 换成一个短哈希，既稳定又不会撞上 storage 的键名限制。
function hashRoot(root: string) {
  let hash = 0;
  for (let index = 0; index < root.length; index += 1) {
    hash = (hash * 31 + root.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function treeStateKey(root: string) {
  return `${TREE_STATE_KEY_PREFIX}${hashRoot(root)}`;
}

function loadExpandedDirs(root: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(treeStateKey(root));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    // localStorage 被禁用或内容损坏时退化为「全部折叠」，不影响主流程。
    return new Set();
  }
}

function persistExpandedDirs(root: string | undefined, expandedDirs: Set<string>) {
  if (!root) return;
  try {
    window.localStorage.setItem(treeStateKey(root), JSON.stringify([...expandedDirs]));
  } catch {
    // 持久化失败只影响下次启动的展开态，静默忽略。
  }
}

export function clampFileTreeWidth(width: number) {
  return Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)));
}

export const FILE_TREE_WIDTH_RANGE = { min: FILE_TREE_MIN_WIDTH, max: FILE_TREE_MAX_WIDTH } as const;

type VaultState = {
  vaultRoot?: string;
  recentVaults: string[];
  entries: VaultEntry[];
  truncated: boolean;
  expandedDirs: Set<string>;
  treeQuery: string;
  isLoadingTree: boolean;

  activeFilePath?: string;
  activeFileEol: VaultEol;
  activeFileHasBom: boolean;
  activeFileModifiedMs?: number;

  saveState: VaultSaveState;
  saveError?: string;

  fileTreeVisible: boolean;
  fileTreeWidth: number;
  previewVisible: boolean;
  locateRequest?: { path: string; id: number };
  copiedEntryPath?: string;

  setVaultRoot: (root: string | undefined) => void;
  setRecentVaults: (recentVaults: string[]) => void;
  pushRecentVault: (root: string) => void;
  removeRecentVault: (root: string) => void;
  setEntries: (entries: VaultEntry[], truncated?: boolean) => void;
  mergeEntries: (entries: VaultEntry[]) => void;
  setIsLoadingTree: (isLoadingTree: boolean) => void;
  setTreeQuery: (treeQuery: string) => void;
  toggleDir: (path: string) => void;
  expandDirs: (paths: string[]) => void;
  collapseAllDirs: () => void;

  setActiveFile: (file?: { path: string; eol: VaultEol; hasBom: boolean; modifiedMs: number }) => void;
  setActiveFileModifiedMs: (modifiedMs: number) => void;
  setSaveState: (saveState: VaultSaveState, saveError?: string) => void;

  setFileTreeVisible: (fileTreeVisible: boolean) => void;
  setFileTreeWidth: (fileTreeWidth: number) => void;
  setPreviewVisible: (previewVisible: boolean) => void;
  requestLocatePath: (path: string) => void;
  setCopiedEntryPath: (path: string | undefined) => void;
};

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: undefined,
  recentVaults: [],
  entries: [],
  truncated: false,
  expandedDirs: new Set<string>(),
  treeQuery: "",
  isLoadingTree: false,

  activeFilePath: undefined,
  activeFileEol: "lf",
  activeFileHasBom: false,
  activeFileModifiedMs: undefined,

  saveState: "clean",
  saveError: undefined,

  fileTreeVisible: true,
  fileTreeWidth: DEFAULT_FILE_TREE_WIDTH,
  previewVisible: true,
  locateRequest: undefined,
  copiedEntryPath: undefined,

  setVaultRoot: (vaultRoot) => set({
    vaultRoot,
    // 换 vault 时旧树/旧选中必须一并清掉，否则会短暂渲染出上一个 vault 的节点。
    entries: [],
    truncated: false,
    treeQuery: "",
    expandedDirs: vaultRoot ? loadExpandedDirs(vaultRoot) : new Set<string>(),
    activeFilePath: undefined,
    activeFileModifiedMs: undefined,
    saveState: "clean",
    saveError: undefined,
    locateRequest: undefined,
  }),

  setRecentVaults: (recentVaults) => set({ recentVaults: recentVaults.slice(0, MAX_RECENT_VAULTS) }),

  pushRecentVault: (root) => set((state) => ({
    recentVaults: [root, ...state.recentVaults.filter((item) => item !== root)].slice(0, MAX_RECENT_VAULTS),
  })),

  removeRecentVault: (root) => set((state) => ({
    recentVaults: state.recentVaults.filter((item) => item !== root),
  })),

  setEntries: (entries, truncated = false) => set({ entries, truncated }),

  /// truncated 降级路径专用：按需拉到的子目录条目要并进已有列表，而不是整棵树替换。
  mergeEntries: (entries) => set((state) => {
    const merged = new Map(state.entries.map((entry) => [entry.path, entry]));
    for (const entry of entries) merged.set(entry.path, entry);
    return { entries: [...merged.values()] };
  }),

  setIsLoadingTree: (isLoadingTree) => set({ isLoadingTree }),
  setTreeQuery: (treeQuery) => set({ treeQuery }),

  toggleDir: (path) => {
    const { expandedDirs, vaultRoot } = get();
    const next = new Set(expandedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    persistExpandedDirs(vaultRoot, next);
    set({ expandedDirs: next });
  },

  expandDirs: (paths) => {
    if (paths.length === 0) return;
    const { expandedDirs, vaultRoot } = get();
    const next = new Set(expandedDirs);
    let changed = false;
    for (const path of paths) {
      if (!next.has(path)) {
        next.add(path);
        changed = true;
      }
    }
    if (!changed) return;
    persistExpandedDirs(vaultRoot, next);
    set({ expandedDirs: next });
  },

  collapseAllDirs: () => {
    const next = new Set<string>();
    persistExpandedDirs(get().vaultRoot, next);
    set({ expandedDirs: next });
  },

  setActiveFile: (file) => set({
    activeFilePath: file?.path,
    activeFileEol: file?.eol ?? "lf",
    activeFileHasBom: file?.hasBom ?? false,
    activeFileModifiedMs: file?.modifiedMs,
    saveState: "clean",
    saveError: undefined,
  }),

  setActiveFileModifiedMs: (activeFileModifiedMs) => set({ activeFileModifiedMs }),

  setSaveState: (saveState, saveError) => set({ saveState, saveError: saveState === "error" || saveState === "conflict" ? saveError : undefined }),

  setFileTreeVisible: (fileTreeVisible) => set({ fileTreeVisible }),
  setFileTreeWidth: (fileTreeWidth) => set({ fileTreeWidth: clampFileTreeWidth(fileTreeWidth) }),
  setPreviewVisible: (previewVisible) => set({ previewVisible }),
  requestLocatePath: (path) => set((state) => ({
    fileTreeVisible: true,
    locateRequest: { path, id: (state.locateRequest?.id ?? 0) + 1 },
  })),
  setCopiedEntryPath: (copiedEntryPath) => set({ copiedEntryPath }),
}));
