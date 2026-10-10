import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, ArrowUpDown, ChevronsDownUp, ChevronsUpDown, ClipboardPaste, ClockArrowDown, ClockArrowUp, FilePlus2, FolderOpen, FolderPlus, GripVertical, Loader2, LocateFixed, RefreshCw, Search, X } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ResizableDivider } from "@/components/layout/resizable-divider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreateEntryDialog, DeleteEntryDialog, OpenVaultLocationDialog, RemoveRecentVaultDialog } from "@/components/vault/vault-dialogs";
import { canDropFileTreeEntry, fileTreeDropPlacement, type FileTreeDropPlacement } from "@/components/vault/file-tree-drag";
import { FileTreeNode, VAULT_ENTRY_DRAG_TYPE, vaultEntryDragSourcePath, vaultTreeNodeId, type FileTreeNodeAction } from "@/components/vault/file-tree-node";
import { VaultSwitcher } from "@/components/vault/vault-switcher";
import { clipboardContainsVaultEntry, topLevelVaultEntries, vaultPasteTarget, type VaultClipboardEntry, type VaultClipboardItem } from "@/lib/vault-clipboard";
import { isTauriEnvironment } from "@/lib/tauri";
import { openVaultProjectWindow, restorableVaultRoot, vaultProjectWindowRoot } from "@/lib/vault-window";
import { copyExternalVaultFile, copyTextToClipboard, copyVaultEntry, createVaultEntry, deleteVaultEntry, listVaultEntries, moveVaultEntry, openVault, pasteClipboardImage, readPathsFromClipboard, removeRecentVault as removeRecentVaultRecord, renameVaultEntry, selectVaultDirectory, setVaultEntryClipboard, showInExplorer } from "@/lib/vault";
import { parseVaultError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { FILE_TREE_WIDTH_RANGE, useVaultStore } from "@/stores/vault-store";
import { useDocumentTabsStore } from "@/stores/document-tabs-store";
import type { VaultEntry } from "@/types/vault";

type FileTreePanelProps = {
  width: number;
  /// 传了才渲染右侧拖拽条；由 AppShell 自行插入分隔条时不要传，否则会出现两条。
  onWidthChange?: (width: number) => void;
  onOpenFile: (entry: VaultEntry) => void;
  onOpenImage: (entry: VaultEntry) => void;
  className?: string;
};

function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

type VisibleRow = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
};

type DropPlacement = FileTreeDropPlacement;

type ManualOrder = Record<string, string[]>;

type FileTreeSortMode = "manual" | "name-asc" | "name-desc" | "modified-desc" | "modified-asc";

type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MarqueeCandidate = {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  didSelect: boolean;
  timer: number;
};

type PointerFileDragCandidate = {
  pointerId: number;
  sourcePath: string;
  startX: number;
  startY: number;
  active: boolean;
};

type PointerFileDragState = {
  sourcePath: string;
  targetPath?: string;
  placement?: DropPlacement;
};

const FILE_TREE_ORDER_KEY_PREFIX = "md-king-vault-order:";
const FILE_TREE_SORT_KEY_PREFIX = "md-king-vault-sort:";
const MARQUEE_HOLD_DELAY_MS = 180;
const MARQUEE_MOVE_THRESHOLD_PX = 4;
const FILE_TREE_SORT_OPTIONS: ReadonlyArray<{ value: FileTreeSortMode; label: string }> = [
  { value: "manual", label: "自定义顺序" },
  { value: "name-asc", label: "名称 A-Z" },
  { value: "name-desc", label: "名称 Z-A" },
  { value: "modified-desc", label: "修改时间：最新优先" },
  { value: "modified-asc", label: "修改时间：最早优先" },
];

function parentOf(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function ancestorsOf(path: string) {
  const result: string[] = [];
  let current = parentOf(path);
  while (current) {
    result.push(current);
    current = parentOf(current);
  }
  return result;
}

/// 自定义顺序沿用用户的拖拽结果；其他模式固定目录在前，并按指定字段排序。
function compareEntries(left: VaultEntry, right: VaultEntry, manualRanks?: ReadonlyMap<string, number>, sortMode: FileTreeSortMode = "manual") {
  if (sortMode === "manual") {
    const leftOrder = manualRanks?.get(left.name) ?? -1;
    const rightOrder = manualRanks?.get(right.name) ?? -1;
    if (leftOrder >= 0 || rightOrder >= 0) {
      if (leftOrder < 0) return 1;
      if (rightOrder < 0) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
  }
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
  if (sortMode === "modified-desc") {
    const byModified = right.modifiedMs - left.modifiedMs;
    if (byModified !== 0) return byModified;
  }
  if (sortMode === "modified-asc") {
    const byModified = left.modifiedMs - right.modifiedMs;
    if (byModified !== 0) return byModified;
  }
  const byName = left.name.localeCompare(right.name, "zh-CN");
  return sortMode === "name-desc" ? -byName : byName;
}

function loadManualOrder(root?: string): ManualOrder {
  if (!root) return {};
  try {
    const value = window.localStorage.getItem(`${FILE_TREE_ORDER_KEY_PREFIX}${encodeURIComponent(root)}`);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((name) => typeof name === "string")),
    );
  } catch {
    return {};
  }
}

function persistManualOrder(root: string | undefined, order: ManualOrder) {
  if (!root) return;
  try {
    window.localStorage.setItem(`${FILE_TREE_ORDER_KEY_PREFIX}${encodeURIComponent(root)}`, JSON.stringify(order));
  } catch {
    // 无法持久化时仍保留当前会话的排序，不影响文件移动。
  }
}

function isFileTreeSortMode(value: string | null): value is FileTreeSortMode {
  return FILE_TREE_SORT_OPTIONS.some((option) => option.value === value);
}

function loadFileTreeSortMode(root?: string): FileTreeSortMode {
  if (!root) return "manual";
  try {
    const value = window.localStorage.getItem(`${FILE_TREE_SORT_KEY_PREFIX}${encodeURIComponent(root)}`);
    return isFileTreeSortMode(value) ? value : "manual";
  } catch {
    return "manual";
  }
}

function persistFileTreeSortMode(root: string | undefined, mode: FileTreeSortMode) {
  if (!root) return;
  try {
    window.localStorage.setItem(`${FILE_TREE_SORT_KEY_PREFIX}${encodeURIComponent(root)}`, mode);
  } catch {
    // 无法持久化时仍保留当前会话的排序。
  }
}

export function FileTreePanel({ width, onWidthChange, onOpenFile, onOpenImage, className }: FileTreePanelProps) {
  const appConfig = useAppStore((state) => state.appConfig);
  const activeEntryPath = useDocumentTabsStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return activeTab?.kind === "vault" || activeTab?.kind === "image" ? activeTab.path : undefined;
  });
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const recentVaults = useVaultStore((state) => state.recentVaults);
  const entries = useVaultStore((state) => state.entries);
  const truncated = useVaultStore((state) => state.truncated);
  const expandedDirs = useVaultStore((state) => state.expandedDirs);
  const treeQuery = useVaultStore((state) => state.treeQuery);
  const isLoadingTree = useVaultStore((state) => state.isLoadingTree);
  const locateRequest = useVaultStore((state) => state.locateRequest);
  const setVaultRoot = useVaultStore((state) => state.setVaultRoot);
  const pushRecentVault = useVaultStore((state) => state.pushRecentVault);
  const removeRecentVault = useVaultStore((state) => state.removeRecentVault);
  const setRecentVaults = useVaultStore((state) => state.setRecentVaults);
  const setEntries = useVaultStore((state) => state.setEntries);
  const mergeEntries = useVaultStore((state) => state.mergeEntries);
  const setIsLoadingTree = useVaultStore((state) => state.setIsLoadingTree);
  const setTreeQuery = useVaultStore((state) => state.setTreeQuery);
  const toggleDir = useVaultStore((state) => state.toggleDir);
  const expandDirs = useVaultStore((state) => state.expandDirs);
  const collapseAllDirs = useVaultStore((state) => state.collapseAllDirs);
  const clipboardEntry = useVaultStore((state) => state.clipboardEntry);
  const setClipboardEntry = useVaultStore((state) => state.setClipboardEntry);

  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(() => new Set());
  const [renamingPath, setRenamingPath] = useState<string>();
  const [createTarget, setCreateTarget] = useState<{ parentDir: string; isDir: boolean }>();
  const [deleteTargets, setDeleteTargets] = useState<VaultEntry[]>();
  const [pendingVaultRoot, setPendingVaultRoot] = useState<string>();
  const [recentVaultToRemove, setRecentVaultToRemove] = useState<string>();
  const [manualOrder, setManualOrder] = useState<ManualOrder>({});
  const [sortMode, setSortMode] = useState<FileTreeSortMode>("manual");
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect>();
  const [rootDropActive, setRootDropActive] = useState(false);
  const [pointerFileDrag, setPointerFileDrag] = useState<PointerFileDragState>();
  /// truncated 降级下已按需拉过的目录，避免同一目录被反复请求。
  const loadedDirsRef = useRef(new Set<string>());
  const locateFrameRef = useRef<number | undefined>(undefined);
  const locateTimerRef = useRef<number | undefined>(undefined);
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedEntryPathsRef = useRef(new Set<string>());
  const marqueeCandidateRef = useRef<MarqueeCandidate | undefined>(undefined);
  const pointerFileDragCandidateRef = useRef<PointerFileDragCandidate | undefined>(undefined);
  const pointerFileDragRef = useRef<PointerFileDragState | undefined>(undefined);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const ignoreNextEntryClickRef = useRef(false);
  const openedProjectVaultRef = useRef<string | undefined>(undefined);
  const restoredVaultRef = useRef(false);
  const usePointerFileDrag = isTauriEnvironment();
  const directoryPaths = useMemo(
    () => entries.filter((entry) => entry.isDir && entry.hasChildren).map((entry) => entry.path),
    [entries],
  );
  const allDirectoriesExpanded = directoryPaths.length > 0 && directoryPaths.every((path) => expandedDirs.has(path));
  const sortModeLabel = FILE_TREE_SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? "自定义顺序";

  function replaceSelectedEntries(paths: Iterable<string>) {
    const next = new Set(paths);
    selectedEntryPathsRef.current = next;
    setSelectedEntryPaths(next);
  }

  function selectOnly(entry: VaultEntry) {
    replaceSelectedEntries([entry.path]);
  }

  function selectedEntriesFor(entry?: VaultEntry) {
    const current = selectedEntryPathsRef.current;
    const paths = entry && !current.has(entry.path) ? [entry.path] : [...current];
    return topLevelVaultEntries(entries.filter((candidate) => paths.includes(candidate.path)));
  }

  function remapSelectedEntryPaths(sourcePath: string, targetPath: string, sourceIsDir: boolean) {
    replaceSelectedEntries([...selectedEntryPathsRef.current].map((path) => {
      if (path === sourcePath) return targetPath;
      if (sourceIsDir && path.startsWith(`${sourcePath}/`)) return `${targetPath}${path.slice(sourcePath.length)}`;
      return path;
    }));
  }

  function removeSelectedEntryPaths(targets: VaultEntry[]) {
    const next = [...selectedEntryPathsRef.current].filter((path) => !targets.some((target) => (
      path === target.path || (target.isDir && path.startsWith(`${target.path}/`))
    )));
    replaceSelectedEntries(next);
  }

  useEffect(() => {
    loadedDirsRef.current = new Set();
    setManualOrder(loadManualOrder(vaultRoot));
    setSortMode(loadFileTreeSortMode(vaultRoot));
    replaceSelectedEntries([]);
  }, [vaultRoot]);

  useEffect(() => {
    if (appConfig) setRecentVaults(appConfig.recentVaults);
  }, [appConfig?.recentVaults, setRecentVaults]);

  useEffect(() => {
    if (!vaultRoot || clipboardEntry?.operation !== "cut" || !isTauriEnvironment()) return;
    const validateCutClipboard = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const paths = await readPathsFromClipboard();
        if (!clipboardEntry.entries.every((entry) => clipboardContainsVaultEntry(vaultRoot, entry.path, paths))) {
          setClipboardEntry(undefined);
        }
      } catch {
        // 系统剪贴板暂时被占用时保留剪切状态，下次聚焦再验证。
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void validateCutClipboard(); };
    window.addEventListener("focus", validateCutClipboard);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", validateCutClipboard);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [clipboardEntry, setClipboardEntry, vaultRoot]);

  useEffect(() => {
    if (clipboardEntry?.operation !== "cut") return;
    const clearCutForOtherClipboardWrite = (event: ClipboardEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-mk-file-tree-node-context]")) return;
      setClipboardEntry(undefined);
    };
    document.addEventListener("copy", clearCutForOtherClipboardWrite);
    document.addEventListener("cut", clearCutForOtherClipboardWrite);
    return () => {
      document.removeEventListener("copy", clearCutForOtherClipboardWrite);
      document.removeEventListener("cut", clearCutForOtherClipboardWrite);
    };
  }, [clipboardEntry?.operation, setClipboardEntry]);

  const loadVault = useCallback(async (path: string) => {
    setIsLoadingTree(true);
    try {
      const listing = await openVault(path);
      const previousRoot = useVaultStore.getState().vaultRoot;
      if (previousRoot && previousRoot !== listing.root) {
        useDocumentTabsStore.getState().closeAllTabs();
      }
      setVaultRoot(listing.root);
      setEntries(listing.entries, listing.truncated);
      pushRecentVault(listing.root);
      const recent = useVaultStore.getState().recentVaults;
      const app = useAppStore.getState();
      if (app.appConfig) {
        app.setAppConfig({ ...app.appConfig, vaultRoot: listing.root, recentVaults: recent });
      }
    } finally {
      setIsLoadingTree(false);
    }
  }, [pushRecentVault, setEntries, setIsLoadingTree, setVaultRoot]);

  useEffect(() => {
    const projectRoot = vaultProjectWindowRoot(window.location.search);
    if (!projectRoot || openedProjectVaultRef.current === projectRoot) return;
    openedProjectVaultRef.current = projectRoot;
    void loadVault(projectRoot).catch((error) => {
      const { message } = parseVaultError(error, "打开项目目录失败");
      toast.error(message);
    });
  }, [loadVault]);

  useEffect(() => {
    if (!appConfig || restoredVaultRef.current) return;
    restoredVaultRef.current = true;
    const root = restorableVaultRoot(
      vaultProjectWindowRoot(window.location.search),
      useVaultStore.getState().vaultRoot,
      appConfig.vaultRoot,
      appConfig.recentVaults,
    );
    if (!root) return;
    void loadVault(root).catch((error) => {
      const { message } = parseVaultError(error, "恢复上次目录失败");
      toast.error(message);
    });
  }, [appConfig, loadVault]);

  const requestVaultOpen = useCallback(async (path: string) => {
    const root = path.trim();
    if (!root || root === vaultRoot) return;
    if (vaultRoot) {
      setPendingVaultRoot(root);
      return;
    }
    try {
      await loadVault(root);
    } catch (error) {
      const { message } = parseVaultError(error, "打开目录失败");
      toast.error(message);
    }
  }, [loadVault, vaultRoot]);

  async function handleOpenVault() {
    try {
      const selected = await selectVaultDirectory();
      if (!selected) return;
      await requestVaultOpen(selected);
    } catch (error) {
      const { message } = parseVaultError(error, "选择目录失败");
      toast.error(message);
    }
  }

  async function openPendingVaultInCurrentWindow() {
    const root = pendingVaultRoot;
    if (!root) return;
    try {
      await loadVault(root);
    } catch (error) {
      const { message } = parseVaultError(error, "打开目录失败");
      throw new Error(message);
    }
  }

  async function openPendingVaultInNewWindow() {
    const root = pendingVaultRoot;
    if (!root) return;
    await openVaultProjectWindow(root);
  }

  async function confirmRemoveRecentVault() {
    const root = recentVaultToRemove;
    if (!root) return;
    try {
      await removeRecentVaultRecord(root);
      removeRecentVault(root);
      const app = useAppStore.getState();
      if (app.appConfig) {
        app.setAppConfig({ ...app.appConfig, recentVaults: useVaultStore.getState().recentVaults });
      }
      setRecentVaultToRemove(undefined);
    } catch (error) {
      const { message } = parseVaultError(error, "移除最近目录失败");
      throw new Error(message);
    }
  }

  const refreshTree = useCallback(async (showError = true) => {
    const root = useVaultStore.getState().vaultRoot;
    if (!root) return;
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    setIsLoadingTree(true);
    try {
      const listing = await listVaultEntries(root, undefined, true);
      if (useVaultStore.getState().vaultRoot === root) {
        setEntries(listing.entries, listing.truncated);
        loadedDirsRef.current = new Set();
      }
    } catch (error) {
      if (showError) {
        const { message } = parseVaultError(error, "刷新文件树失败");
        toast.error(message);
      }
    } finally {
      refreshInFlightRef.current = false;
      if (useVaultStore.getState().vaultRoot === root) {
        setIsLoadingTree(false);
      }
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        window.setTimeout(() => void refreshTree(false), 0);
      }
    }
  }, [setEntries, setIsLoadingTree]);

  async function handleRefresh() {
    await refreshTree(true);
  }

  useEffect(() => {
    if (!vaultRoot || !isTauriEnvironment()) return;
    let active = true;
    let timer: number | undefined;
    let unlisten: UnlistenFn | undefined;

    const scheduleRefresh = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void refreshTree(false);
      }, 400);
    };

    const registerListener = async () => {
      const cleanup = await listen<{ root?: string }>("vault://changed", (event) => {
        const changedRoot = event.payload.root;
        if (changedRoot && changedRoot.toLowerCase() !== vaultRoot.toLowerCase()) return;
        scheduleRefresh();
      });
      if (!active) cleanup();
      else unlisten = cleanup;
    };
    void registerListener();

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [refreshTree, vaultRoot]);

  function handleSortModeChange(nextMode: string) {
    if (!isFileTreeSortMode(nextMode)) return;
    setSortMode(nextMode);
    persistFileTreeSortMode(vaultRoot, nextMode);
  }

  /// 全量索引被截断时才走这条：展开哪个目录就单独拉哪一层，避免整棵树重来。
  const ensureDirLoaded = useCallback(async (dir: string) => {
    if (!vaultRoot || !truncated || loadedDirsRef.current.has(dir)) return;
    loadedDirsRef.current.add(dir);
    try {
      const listing = await listVaultEntries(vaultRoot, dir, false);
      mergeEntries(listing.entries);
    } catch (error) {
      loadedDirsRef.current.delete(dir);
      const { message } = parseVaultError(error, "读取子目录失败");
      toast.error(message);
    }
  }, [mergeEntries, truncated, vaultRoot]);

  useEffect(() => {
    if (!locateRequest) return;
    const { path } = locateRequest;
    const parentPaths = ancestorsOf(path);
    if (useVaultStore.getState().treeQuery) setTreeQuery("");
    expandDirs(parentPaths);

    const revealNode = () => {
      if (locateFrameRef.current !== undefined) window.cancelAnimationFrame(locateFrameRef.current);
      locateFrameRef.current = window.requestAnimationFrame(() => {
        locateFrameRef.current = window.requestAnimationFrame(() => {
          const element = document.getElementById(vaultTreeNodeId(path));
          if (!element) return;
          element.scrollIntoView({ block: "center", behavior: "smooth" });
          element.classList.remove("mk-file-tree-row-located");
          void element.offsetWidth;
          element.classList.add("mk-file-tree-row-located");
          if (locateTimerRef.current !== undefined) window.clearTimeout(locateTimerRef.current);
          locateTimerRef.current = window.setTimeout(() => {
            element.classList.remove("mk-file-tree-row-located");
          }, 1400);
        });
      });
    };

    void Promise.all(parentPaths.map((parent) => ensureDirLoaded(parent))).then(revealNode);
  }, [ensureDirLoaded, expandDirs, locateRequest, setTreeQuery]);

  useEffect(() => () => {
    if (locateFrameRef.current !== undefined) window.cancelAnimationFrame(locateFrameRef.current);
    if (locateTimerRef.current !== undefined) window.clearTimeout(locateTimerRef.current);
    clearMarqueeCandidate();
    pointerFileDragCandidateRef.current = undefined;
    pointerFileDragRef.current = undefined;
  }, []);

  function handleToggle(path: string) {
    if (!expandedDirs.has(path)) void ensureDirLoaded(path);
    toggleDir(path);
  }

  function remapOpenVaultPaths(sourcePath: string, targetPath: string, sourceIsDir: boolean) {
    if (!vaultRoot) return;
    const remapPath = (path: string) => {
      if (path === sourcePath) return targetPath;
      if (sourceIsDir && path.startsWith(`${sourcePath}/`)) return `${targetPath}${path.slice(sourcePath.length)}`;
      return undefined;
    };
    const { tabs, renameTab } = useDocumentTabsStore.getState();
    for (const tab of tabs) {
      if ((tab.kind !== "vault" && tab.kind !== "image") || !tab.path) continue;
      const nextPath = remapPath(tab.path);
      if (!nextPath) continue;
      renameTab(tab.id, {
        path: nextPath,
        absolutePath: `${vaultRoot.replace(/[\\/]+$/, "")}/${nextPath}`,
        title: nextPath.split("/").pop() ?? nextPath,
      });
    }

    const activePath = useVaultStore.getState().activeFilePath;
    const nextActivePath = activePath ? remapPath(activePath) : undefined;
    if (nextActivePath) useVaultStore.setState({ activeFilePath: nextActivePath });
  }

  function updateEntriesAfterMove(entry: VaultEntry, moved: VaultEntry, destinationDir: string) {
    const currentState = useVaultStore.getState();
    const sourcePrefix = `${entry.path}/`;
    const targetPrefix = `${moved.path}/`;
    const remapped = currentState.entries.map((current) => {
      if (current.path === entry.path) return moved;
      if (entry.isDir && current.path.startsWith(sourcePrefix)) {
        return { ...current, path: `${targetPrefix}${current.path.slice(sourcePrefix.length)}` };
      }
      return current;
    });

    let nextEntries = remapped;
    if (currentState.truncated) {
      // 懒加载树里看不到的子项不能据此判空；只确认目标目录现在必然有子项。
      nextEntries = remapped.map((current) => (
        current.isDir && current.path === destinationDir && !current.hasChildren
          ? { ...current, hasChildren: true }
          : current
      ));
    } else {
      const parentsWithChildren = new Set(remapped.map((current) => parentOf(current.path)));
      nextEntries = remapped.map((current) => {
        if (!current.isDir) return current;
        const hasChildren = parentsWithChildren.has(current.path);
        return hasChildren === current.hasChildren ? current : { ...current, hasChildren };
      });
    }

    setEntries(nextEntries, currentState.truncated);

    if (entry.isDir) {
      loadedDirsRef.current = new Set([...loadedDirsRef.current].map((path) => (
        path === entry.path || path.startsWith(sourcePrefix)
          ? `${moved.path}${path.slice(entry.path.length)}`
          : path
      )));
    }
  }

  function orderedSiblingNames(parent: string, excludedPath: string | undefined, order: ManualOrder) {
    const siblings = entries.filter((entry) => parentOf(entry.path) === parent && entry.path !== excludedPath);
    const knownNames = new Set(siblings.map((entry) => entry.name));
    const configured = (order[parent] ?? []).filter((name) => knownNames.has(name));
    const configuredNames = new Set(configured);
    const remaining = siblings
      .filter((entry) => !configuredNames.has(entry.name))
      .sort((left, right) => compareEntries(left, right))
      .map((entry) => entry.name);
    return [...configured, ...remaining];
  }

  function updateManualOrderAfterMove(entry: VaultEntry, moved: VaultEntry, target: VaultEntry | null, placement: DropPlacement) {
    setManualOrder((current) => {
      const next = { ...current };
      if (entry.isDir) {
        for (const [parent, names] of Object.entries(next)) {
          if (parent !== entry.path && !parent.startsWith(`${entry.path}/`)) continue;
          next[`${moved.path}${parent.slice(entry.path.length)}`] = names;
          delete next[parent];
        }
      }

      const sourceParent = parentOf(entry.path);
      const destinationParent = placement === "root"
        ? ""
        : placement === "inside"
          ? target?.path ?? ""
          : parentOf(target?.path ?? "");
      if (sourceParent !== destinationParent && next[sourceParent]) {
        const remaining = next[sourceParent].filter((name) => name !== entry.name);
        if (remaining.length > 0) next[sourceParent] = remaining;
        else delete next[sourceParent];
      }

      const names = orderedSiblingNames(destinationParent, entry.path, next)
        .filter((name) => name !== moved.name);
      if (placement === "inside" || placement === "root") {
        names.push(moved.name);
      } else if (target) {
        const targetIndex = names.indexOf(target.name);
        const insertionIndex = targetIndex < 0 ? names.length : targetIndex + (placement === "after" ? 1 : 0);
        names.splice(insertionIndex, 0, moved.name);
      }
      next[destinationParent] = names;
      persistManualOrder(vaultRoot, next);
      return next;
    });
  }

  function updateManualOrderAfterRename(entry: VaultEntry, renamed: VaultEntry) {
    setManualOrder((current) => {
      const next = { ...current };
      const parent = parentOf(entry.path);
      if (next[parent]) next[parent] = next[parent].map((name) => name === entry.name ? renamed.name : name);
      if (entry.isDir) {
        for (const [orderParent, names] of Object.entries(next)) {
          if (orderParent !== entry.path && !orderParent.startsWith(`${entry.path}/`)) continue;
          next[`${renamed.path}${orderParent.slice(entry.path.length)}`] = names;
          delete next[orderParent];
        }
      }
      persistManualOrder(vaultRoot, next);
      return next;
    });
  }

  function updateManualOrderAfterDelete(entry: VaultEntry) {
    setManualOrder((current) => {
      const next = { ...current };
      const parent = parentOf(entry.path);
      if (next[parent]) {
        const remaining = next[parent].filter((name) => name !== entry.name);
        if (remaining.length > 0) next[parent] = remaining;
        else delete next[parent];
      }
      if (entry.isDir) {
        for (const orderParent of Object.keys(next)) {
          if (orderParent === entry.path || orderParent.startsWith(`${entry.path}/`)) delete next[orderParent];
        }
      }
      persistManualOrder(vaultRoot, next);
      return next;
    });
  }

  async function handleMoveEntry(entry: VaultEntry, target: VaultEntry | null, placement: DropPlacement) {
    const destinationDir = placement === "root"
      ? ""
      : placement === "inside"
        ? target?.path ?? ""
        : parentOf(target?.path ?? "");
    if (!vaultRoot || (target && entry.path === target.path)) return;
    if (placement !== "root" && !target) return;
    if (placement === "inside" && !target?.isDir) return;
    if (entry.isDir && (destinationDir === entry.path || destinationDir.startsWith(`${entry.path}/`))) return;

    // 同目录拖动只改变展示顺序，不做无意义的磁盘操作和整树刷新。
    if (parentOf(entry.path) === destinationDir) {
      updateManualOrderAfterMove(entry, entry, target, placement);
      return;
    }

    try {
      const moved = await moveVaultEntry(vaultRoot, entry.path, destinationDir);
      clearClipboardForEntry(entry);
      remapSelectedEntryPaths(entry.path, moved.path, entry.isDir);
      remapOpenVaultPaths(entry.path, moved.path, entry.isDir);
      updateManualOrderAfterMove(entry, moved, target, placement);
      updateEntriesAfterMove(entry, moved, destinationDir);
      if (destinationDir) expandDirs([destinationDir, ...ancestorsOf(destinationDir)]);
    } catch (error) {
      const { message } = parseVaultError(error, "移动文件失败");
      toast.error(message);
    }
  }

  async function handleCreate(name: string) {
    if (!vaultRoot || !createTarget) return;
    try {
      const created = await createVaultEntry(vaultRoot, createTarget.parentDir, name, createTarget.isDir);
      mergeEntries([created]);
      if (createTarget.parentDir) useVaultStore.getState().expandDirs([createTarget.parentDir, ...ancestorsOf(createTarget.parentDir)]);
      if (!created.isDir) onOpenFile(created);
      toast.success(`已创建 ${created.name}`);
    } catch (error) {
      const { message } = parseVaultError(error, "创建失败");
      // 抛回给 Dialog 就地显示，比 toast 更贴近输入框；同时保持对话框不关闭。
      throw new Error(message);
    }
  }

  async function handleRenameSubmit(entry: VaultEntry, nextName: string) {
    setRenamingPath(undefined);
    if (!vaultRoot || nextName.trim() === entry.name || !nextName.trim()) return;

    try {
      const renamed = await renameVaultEntry(vaultRoot, entry.path, nextName.trim());
      clearClipboardForEntry(entry);
      remapSelectedEntryPaths(entry.path, renamed.path, entry.isDir);
      remapOpenVaultPaths(entry.path, renamed.path, entry.isDir);
      updateManualOrderAfterRename(entry, renamed);
      // 目录改名会连带影响所有后代 path，局部更新算不干净，直接重拉一次。
      await handleRefresh();
      toast.success(`已重命名为 ${nextName.trim()}`);
    } catch (error) {
      const { message } = parseVaultError(error, "重命名失败");
      toast.error(message);
    }
  }

  async function handleDelete() {
    if (!vaultRoot || !deleteTargets || deleteTargets.length === 0) return;
    let deleted = 0;
    let firstError: Error | undefined;
    for (const target of deleteTargets) {
      try {
        await deleteVaultEntry(vaultRoot, target.path, target.isDir);
        clearClipboardForEntry(target);
        updateManualOrderAfterDelete(target);
        deleted += 1;
      } catch (error) {
        if (!firstError) {
          const { message } = parseVaultError(error, "删除失败");
          firstError = new Error(message);
        }
      }
    }
    if (deleted > 0) {
      removeSelectedEntryPaths(deleteTargets);
      await handleRefresh();
      toast.success(deleted === 1 ? `已删除 ${deleteTargets[0].name}` : `已删除 ${deleted} 项`);
    }
    if (firstError) throw firstError;
  }

  function clearClipboardForEntry(entry: VaultEntry) {
    const current = useVaultStore.getState().clipboardEntry;
    if (!current) return;
    if (current.entries.some((clipboardEntry) => (
      clipboardEntry.path === entry.path || (entry.isDir && clipboardEntry.path.startsWith(`${entry.path}/`))
    ))) {
      setClipboardEntry(undefined);
    }
  }

  async function startClipboardOperation(targets: VaultEntry[], operation: VaultClipboardEntry["operation"]) {
    if (!vaultRoot) return;
    const entriesToCopy = topLevelVaultEntries(targets).map(({ path, name, isDir }) => ({ path, name, isDir }));
    if (entriesToCopy.length === 0) return;
    setClipboardEntry(undefined);
    try {
      await setVaultEntryClipboard(vaultRoot, entriesToCopy.map((entry) => entry.path));
      setClipboardEntry({ entries: entriesToCopy, operation });
    } catch (error) {
      const { message } = parseVaultError(error, operation === "cut" ? "剪切失败" : "复制失败");
      toast.error(message);
    }
  }

  async function pasteInto(targetDir: string) {
    if (!vaultRoot) return;

    let systemPaths: string[] = [];
    try {
      systemPaths = await readPathsFromClipboard();
    } catch (error) {
      if (!useVaultStore.getState().clipboardEntry) {
        const { message } = parseVaultError(error, "无法读取剪贴板");
        toast.error(message);
        return;
      }
    }

    const internal = useVaultStore.getState().clipboardEntry;
    const internalStillValid = Boolean(
      internal
      && (!isTauriEnvironment() || internal.entries.every((entry) => clipboardContainsVaultEntry(vaultRoot, entry.path, systemPaths))),
    );

    if (internal && internalStillValid) {
      const targetEntries = topLevelVaultEntries(internal.entries);
      const completed: VaultClipboardItem[] = [];
      let firstError = "";

      for (const source of targetEntries) {
        if (internal.operation === "cut" && parentOf(source.path) === targetDir) continue;
        try {
          if (internal.operation === "cut") {
            const moved = await moveVaultEntry(vaultRoot, source.path, targetDir);
            remapOpenVaultPaths(source.path, moved.path, source.isDir);
            remapSelectedEntryPaths(source.path, moved.path, source.isDir);
            completed.push({ path: moved.path, name: moved.name, isDir: moved.isDir });
          } else {
            const copied = await copyVaultEntry(vaultRoot, source.path, targetDir);
            completed.push({ path: copied.path, name: copied.name, isDir: copied.isDir });
          }
        } catch (error) {
          if (!firstError) firstError = parseVaultError(error, "粘贴失败").message;
        }
      }

      if (internal.operation === "cut") setClipboardEntry(undefined);
      if (completed.length > 0) {
        await handleRefresh();
        if (targetDir) expandDirs([targetDir, ...ancestorsOf(targetDir)]);
      }
      if (firstError) toast.error(firstError);
      return;
    }

    if (internal) setClipboardEntry(undefined);
    if (systemPaths.length === 0) {
      try {
        const image = await pasteClipboardImage(vaultRoot, targetDir);
        if (image) {
          await handleRefresh();
          if (targetDir) expandDirs([targetDir, ...ancestorsOf(targetDir)]);
          return;
        }
        toast.error("剪贴板中没有可粘贴的图片、TXT 或 Markdown 文档");
      } catch (error) {
        toast.error(parseVaultError(error, "粘贴图片失败").message);
      }
      return;
    }

    let pasted = 0;
    let firstError = "";
    for (const sourcePath of systemPaths) {
      try {
        await copyExternalVaultFile(vaultRoot, sourcePath, targetDir);
        pasted += 1;
      } catch (error) {
        if (!firstError) firstError = parseVaultError(error, "粘贴失败").message;
      }
    }
    if (pasted > 0) {
      await handleRefresh();
      if (targetDir) expandDirs([targetDir, ...ancestorsOf(targetDir)]);
    }
    if (pasted < systemPaths.length) {
      toast.error(firstError || `${systemPaths.length - pasted} 个项目无法粘贴`);
    }
  }

  function handleEntryClick(entry: VaultEntry, event: ReactMouseEvent<HTMLDivElement>) {
    if (ignoreNextEntryClickRef.current) {
      ignoreNextEntryClickRef.current = false;
      return false;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedEntryPathsRef.current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      replaceSelectedEntries(next);
      return false;
    }
    selectOnly(entry);
    return true;
  }

  function handlePrepareContextMenu(entry: VaultEntry) {
    if (!selectedEntryPathsRef.current.has(entry.path)) selectOnly(entry);
  }

  function clearMarqueeCandidate(pointerId?: number) {
    const candidate = marqueeCandidateRef.current;
    if (!candidate || (pointerId !== undefined && candidate.pointerId !== pointerId)) return;
    window.clearTimeout(candidate.timer);
    if (candidate.active && candidate.didSelect) ignoreNextEntryClickRef.current = true;
    marqueeCandidateRef.current = undefined;
    setMarqueeRect(undefined);
  }

  function updatePointerFileDragState(next: PointerFileDragState | undefined) {
    pointerFileDragRef.current = next;
    setPointerFileDrag(next);
  }

  function pointerFileDropAt(sourcePath: string, clientX: number, clientY: number): PointerFileDragState {
    const tree = treeRef.current;
    if (!tree) return { sourcePath };
    const bounds = tree.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return { sourcePath };

    const element = document.elementFromPoint(clientX, clientY);
    const row = element instanceof Element ? element.closest<HTMLElement>("[data-mk-vault-path]") : null;
    if (!row || !tree.contains(row)) return { sourcePath, placement: "root" };

    const target = entries.find((entry) => entry.path === row.dataset.mkVaultPath);
    if (!target) return { sourcePath };
    const rowBounds = row.getBoundingClientRect();
    const placement = fileTreeDropPlacement(target, clientY, rowBounds.top, rowBounds.height);
    if (!canDropFileTreeEntry(sourcePath, target, placement)) return { sourcePath };
    return { sourcePath, targetPath: target.path, placement };
  }

  function updatePointerFileDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const candidate = pointerFileDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return false;
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (!candidate.active && distance <= MARQUEE_MOVE_THRESHOLD_PX) return true;

    if (!candidate.active) {
      candidate.active = true;
      ignoreNextEntryClickRef.current = true;
      replaceSelectedEntries([candidate.sourcePath]);
      try {
        treeRef.current?.setPointerCapture(candidate.pointerId);
      } catch {
        // WebView 已释放指针时，本次拖动直接在 pointerup 中取消。
      }
    }

    event.preventDefault();
    updatePointerFileDragState(pointerFileDropAt(candidate.sourcePath, event.clientX, event.clientY));
    return true;
  }

  function finishPointerFileDrag(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const candidate = pointerFileDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return false;
    pointerFileDragCandidateRef.current = undefined;
    try {
      if (treeRef.current?.hasPointerCapture(candidate.pointerId)) treeRef.current.releasePointerCapture(candidate.pointerId);
    } catch {
      // 指针捕获已经由 WebView 释放。
    }

    const drop = pointerFileDragRef.current;
    updatePointerFileDragState(undefined);
    if (!candidate.active) return false;
    ignoreNextEntryClickRef.current = true;
    if (!cancelled && drop?.placement) {
      const source = entries.find((entry) => entry.path === candidate.sourcePath);
      const target = drop.targetPath ? entries.find((entry) => entry.path === drop.targetPath) ?? null : null;
      if (source) void handleMoveEntry(source, target, drop.placement);
    }
    return true;
  }

  function updateMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const candidate = marqueeCandidateRef.current;
    const tree = treeRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId || !tree) return;
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (!candidate.active) {
      if (distance > MARQUEE_MOVE_THRESHOLD_PX) clearMarqueeCandidate(event.pointerId);
      return;
    }

    event.preventDefault();
    const bounds = tree.getBoundingClientRect();
    const left = Math.min(candidate.startX, event.clientX);
    const top = Math.min(candidate.startY, event.clientY);
    const right = Math.max(candidate.startX, event.clientX);
    const bottom = Math.max(candidate.startY, event.clientY);
    const selected = new Set<string>();
    for (const row of tree.querySelectorAll<HTMLElement>("[data-mk-vault-path]")) {
      const rowBounds = row.getBoundingClientRect();
      if (rowBounds.right >= left && rowBounds.left <= right && rowBounds.bottom >= top && rowBounds.top <= bottom) {
        const path = row.dataset.mkVaultPath;
        if (path) selected.add(path);
      }
    }
    candidate.didSelect = true;
    replaceSelectedEntries(selected);
    setMarqueeRect({
      left: left - bounds.left + tree.scrollLeft,
      top: top - bounds.top + tree.scrollTop,
      width: right - left,
      height: bottom - top,
    });
  }

  function handleTreePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!vaultRoot || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("button, input, textarea, [contenteditable='true']")) return;
    clearMarqueeCandidate();
    pointerFileDragCandidateRef.current = undefined;
    if (pointerFileDragRef.current) updatePointerFileDragState(undefined);
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mk-vault-path]") : null;
    if (row) {
      const sourcePath = row.dataset.mkVaultPath;
      if (usePointerFileDrag && sourcePath && entries.some((entry) => entry.path === sourcePath)) {
        pointerFileDragCandidateRef.current = {
          pointerId: event.pointerId,
          sourcePath,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
        };
      }
      return;
    }
    const candidate: MarqueeCandidate = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      didSelect: false,
      timer: 0,
    };
    candidate.timer = window.setTimeout(() => {
      const current = marqueeCandidateRef.current;
      if (!current || current.pointerId !== candidate.pointerId) return;
      current.active = true;
      try {
        treeRef.current?.setPointerCapture(current.pointerId);
      } catch {
        // 指针已释放时不用框选，随后的 click 仍按普通单选处理。
      }
    }, MARQUEE_HOLD_DELAY_MS);
    marqueeCandidateRef.current = candidate;
  }

  async function handleNodeAction(action: FileTreeNodeAction, entry: VaultEntry) {
    if (action === "rename") setRenamingPath(entry.path);
    if (action === "delete") setDeleteTargets(selectedEntriesFor(entry));
    if (action === "new-file") setCreateTarget({ parentDir: entry.path, isDir: false });
    if (action === "new-folder") setCreateTarget({ parentDir: entry.path, isDir: true });

    if (action === "copy-relative-path") {
      try {
        await copyTextToClipboard(entry.path);
        setClipboardEntry(undefined);
      } catch {
        toast.error("复制失败");
      }
    }

    if (action === "copy-absolute-path") {
      if (!vaultRoot) return;
      try {
        const absolutePath = `${vaultRoot}\\${entry.path.replace(/\//g, "\\")}`;
        await copyTextToClipboard(absolutePath);
        setClipboardEntry(undefined);
      } catch {
        toast.error("复制失败");
      }
    }

    if (action === "show-in-explorer") {
      if (!vaultRoot) return;
      try {
        const absolutePath = `${vaultRoot}\\${entry.path.replace(/\//g, "\\")}`;
        await showInExplorer(absolutePath);
      } catch (error) {
        const { message } = parseVaultError(error, "打开失败");
        toast.error(message);
      }
    }

    if (action === "copy-entry") {
      await startClipboardOperation(selectedEntriesFor(entry), "copy");
    }

    if (action === "cut-entry") {
      await startClipboardOperation(selectedEntriesFor(entry), "cut");
    }

    if (action === "paste-entry") {
      await pasteInto(vaultPasteTarget(entry));
    }
  }

  const keyword = treeQuery.trim().toLowerCase();

  const { rows, matchCount } = useMemo(() => {
    const byParent = new Map<string, VaultEntry[]>();
    const known = new Set(entries.map((entry) => entry.path));
    for (const entry of entries) {
      // 父目录不在列表里（懒加载/截断场景）时挂到根下，否则整个子树会渲染不出来。
      const parent = parentOf(entry.path);
      const key = parent && known.has(parent) ? parent : "";
      const bucket = byParent.get(key);
      if (bucket) bucket.push(entry);
      else byParent.set(key, [entry]);
    }
    for (const [parent, bucket] of byParent) {
      const order = manualOrder[parent];
      const ranks = sortMode === "manual" && order ? new Map(order.map((name, index) => [name, index])) : undefined;
      bucket.sort((left, right) => compareEntries(left, right, ranks, sortMode));
    }

    // 搜索时用「命中项 + 其全部祖先」的白名单，并把祖先目录视作展开，
    // 这样命中深层文件也能直接看见，且不污染持久化的展开态。
    let visiblePaths: Set<string> | undefined;
    let searchExpanded: Set<string> | undefined;
    let matches = 0;

    if (keyword) {
      visiblePaths = new Set();
      searchExpanded = new Set();
      for (const entry of entries) {
        if (!entry.name.toLowerCase().includes(keyword)) continue;
        matches += 1;
        visiblePaths.add(entry.path);
        for (const ancestor of ancestorsOf(entry.path)) {
          visiblePaths.add(ancestor);
          searchExpanded.add(ancestor);
        }
      }
    }

    const result: VisibleRow[] = [];
    const walk = (parent: string, depth: number) => {
      for (const entry of byParent.get(parent) ?? []) {
        if (visiblePaths && !visiblePaths.has(entry.path)) continue;
        const expanded = entry.isDir && (searchExpanded ? searchExpanded.has(entry.path) : expandedDirs.has(entry.path));
        result.push({ entry, depth, expanded });
        if (entry.isDir && expanded) walk(entry.path, depth + 1);
      }
    };
    walk("", 0);

    return { rows: result, matchCount: matches };
  }, [entries, expandedDirs, keyword, manualOrder, sortMode]);

  // 节点只在自己的可见状态变化时重渲染；回调始终转发到父组件本轮的最新逻辑。
  const nodeToggle = useStableCallback(handleToggle);
  const nodeSelect = useStableCallback(onOpenFile);
  const nodePreviewImage = useStableCallback((entry: VaultEntry) => onOpenImage?.(entry));
  const nodeAction = useStableCallback((action: FileTreeNodeAction, entry: VaultEntry) => { void handleNodeAction(action, entry); });
  const nodeEntryClick = useStableCallback(handleEntryClick);
  const nodePrepareContextMenu = useStableCallback(handlePrepareContextMenu);
  const nodeCanStartDrag = useCallback(() => !marqueeCandidateRef.current?.active, []);
  const nodeRenameSubmit = useStableCallback((entry: VaultEntry, nextName: string) => { void handleRenameSubmit(entry, nextName); });
  const nodeRenameCancel = useCallback(() => setRenamingPath(undefined), []);
  const nodeDropIntoDirectory = useStableCallback((sourcePath: string, target: VaultEntry, placement: Exclude<FileTreeDropPlacement, "root">) => {
    const source = entries.find((entry) => entry.path === sourcePath);
    if (source) void handleMoveEntry(source, target, placement);
  });

  const body = (
    <div className={cn("mk-file-tree-panel mk-sidebar-panel flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[8px]", className)}>
      <div className="shrink-0 space-y-1.5 border-b border-slate-200/80 p-1.5 dark:border-zinc-700">
        <VaultSwitcher
          vaultRoot={vaultRoot}
          recentVaults={recentVaults}
          onOpenVault={() => void handleOpenVault()}
          onSelectVault={(root) => void requestVaultOpen(root)}
          onRemoveRecent={setRecentVaultToRemove}
        />

        <div
          className="mk-file-tree-toolbar flex min-w-0 items-center gap-0.5 overflow-hidden"
          onWheel={(event) => {
            const toolbar = event.currentTarget;
            if (toolbar.scrollWidth <= toolbar.clientWidth) return;
            const delta = event.deltaX || event.deltaY;
            if (!delta) return;
            event.preventDefault();
            toolbar.scrollLeft += delta;
          }}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title="新建文件"
            aria-label="新建文件"
            disabled={!vaultRoot}
            onClick={() => setCreateTarget({ parentDir: "", isDir: false })}
          >
            <FilePlus2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title="新建文件夹"
            aria-label="新建文件夹"
            disabled={!vaultRoot}
            onClick={() => setCreateTarget({ parentDir: "", isDir: true })}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title="刷新"
            aria-label="刷新文件树"
            disabled={!vaultRoot || isLoadingTree}
            onClick={() => void handleRefresh()}
          >
            <RefreshCw className={cn("size-3.5", isLoadingTree && "animate-spin")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="mk-file-tree-tool"
                title={`排序：${sortModeLabel}`}
                aria-label={`文件树排序：${sortModeLabel}`}
                disabled={!vaultRoot}
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuRadioGroup value={sortMode} onValueChange={handleSortModeChange}>
                <DropdownMenuRadioItem value="manual">
                  <GripVertical className="size-4 text-slate-500 dark:text-zinc-400" />
                  自定义顺序
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name-asc">
                  <ArrowDownAZ className="size-4 text-slate-500 dark:text-zinc-400" />
                  名称 A-Z
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name-desc">
                  <ArrowUpAZ className="size-4 text-slate-500 dark:text-zinc-400" />
                  名称 Z-A
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="modified-desc">
                  <ClockArrowDown className="size-4 text-slate-500 dark:text-zinc-400" />
                  修改时间：最新优先
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="modified-asc">
                  <ClockArrowUp className="size-4 text-slate-500 dark:text-zinc-400" />
                  修改时间：最早优先
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title="定位当前文档"
            aria-label="在文件树中定位当前文档"
            disabled={!vaultRoot || !activeEntryPath}
            onClick={() => {
              if (activeEntryPath) useVaultStore.getState().requestLocatePath(activeEntryPath);
            }}
          >
            <LocateFixed className="size-3.5" />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title={allDirectoriesExpanded ? "全部收起" : "全部展开"}
            aria-label={allDirectoriesExpanded ? "全部收起目录" : "全部展开目录"}
            disabled={!vaultRoot || directoryPaths.length === 0}
            onClick={() => {
              if (allDirectoriesExpanded) collapseAllDirs();
              else expandDirs(directoryPaths);
            }}
          >
            {allDirectoriesExpanded ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          </Button>
        </div>

        <div className="relative">
          <Search
            className={cn(
              "pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400",
              vaultRoot ? "dark:text-zinc-300" : "dark:text-zinc-600",
            )}
          />
          <input
            value={treeQuery}
            onChange={(event) => setTreeQuery(event.target.value)}
            placeholder="搜索文件名"
            aria-label="搜索文件名"
            disabled={!vaultRoot}
            className="mk-file-tree-search h-7 w-full rounded-[6px] pr-6 pl-7 text-[13px] outline-none disabled:opacity-50"
          />
          {treeQuery ? (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] p-0.5 text-slate-400 transition hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-100"
              onClick={() => setTreeQuery("")}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {truncated ? (
        <div className="mk-file-tree-notice flex shrink-0 items-start gap-1.5 px-2 py-1.5 text-[11px] leading-4">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>目录过大，已只加载部分文件。展开文件夹时会按需补充。</span>
        </div>
      ) : null}

      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            ref={treeRef}
            role="tree"
            aria-label="文件树"
            data-mk-context-menu
            tabIndex={vaultRoot ? 0 : undefined}
            className={cn(
              "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1",
              (rootDropActive || pointerFileDrag?.placement === "root") && "bg-blue-500/5 ring-1 ring-inset ring-blue-500 dark:bg-blue-400/8 dark:ring-blue-400",
            )}
            data-root-drop-active={rootDropActive || pointerFileDrag?.placement === "root" || undefined}
            onPointerDown={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest("[role='treeitem']")) {
                replaceSelectedEntries([]);
                // 未打开目录时这里只是空状态提示，不应把整个文件树当作可选控件聚焦。
                if (vaultRoot) event.currentTarget.focus();
              }
              handleTreePointerDown(event);
            }}
            onPointerMove={(event) => {
              if (!updatePointerFileDrag(event)) updateMarqueeSelection(event);
            }}
            onPointerUp={(event) => {
              if (finishPointerFileDrag(event)) {
                event.preventDefault();
                event.stopPropagation();
              }
              clearMarqueeCandidate(event.pointerId);
            }}
            onPointerCancel={(event) => {
              finishPointerFileDrag(event, true);
              clearMarqueeCandidate(event.pointerId);
            }}
            onDragEnter={(event) => {
              if (!vaultRoot || (event.target instanceof Element && event.target.closest("[role='treeitem']"))) return;
              if (!Array.from(event.dataTransfer.types).includes(VAULT_ENTRY_DRAG_TYPE)) return;
              event.preventDefault();
              setRootDropActive(true);
            }}
            onDragOver={(event) => {
              if (event.target instanceof Element && event.target.closest("[role='treeitem']")) {
                setRootDropActive(false);
                return;
              }
              if (!vaultRoot || !Array.from(event.dataTransfer.types).includes(VAULT_ENTRY_DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setRootDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
            }}
            onDragEnd={() => setRootDropActive(false)}
            onDrop={(event) => {
              if (event.target instanceof Element && event.target.closest("[role='treeitem']")) return;
              const sourcePath = vaultEntryDragSourcePath(event.dataTransfer);
              if (!sourcePath) return;
              event.preventDefault();
              event.stopPropagation();
              setRootDropActive(false);
              const source = entries.find((entry) => entry.path === sourcePath);
              if (source) void handleMoveEntry(source, null, "root");
            }}
            onContextMenu={(event) => {
              clearMarqueeCandidate();
              pointerFileDragCandidateRef.current = undefined;
              updatePointerFileDragState(undefined);
              setMarqueeRect(undefined);
              if (event.target instanceof Element && event.target.closest("[role='treeitem']")) return;
              replaceSelectedEntries([]);
            }}
            onKeyDownCapture={(event) => {
              if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
              const key = event.key.toLowerCase();
              const modifier = event.ctrlKey || event.metaKey;
              const selectedEntries = selectedEntriesFor();
              const selectedEntry = selectedEntries[0];
              if (modifier && key === "c" && selectedEntries.length > 0) {
                event.preventDefault();
                void startClipboardOperation(selectedEntries, "copy");
              } else if (modifier && key === "x" && selectedEntries.length > 0) {
                event.preventDefault();
                void startClipboardOperation(selectedEntries, "cut");
              } else if (modifier && key === "v") {
                event.preventDefault();
                void pasteInto(vaultPasteTarget(selectedEntry));
              } else if (event.key === "Escape" && clipboardEntry?.operation === "cut") {
                event.preventDefault();
                setClipboardEntry(undefined);
              }
            }}
          >
        {!vaultRoot ? (
          <p className="px-2 py-6 text-center text-xs leading-5 text-slate-500 dark:text-zinc-400">
            还没有打开目录。<br />打开一个文件夹即可管理其中的 Markdown 文档。
          </p>
        ) : isLoadingTree && entries.length === 0 ? (
          <p className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-slate-500 dark:text-zinc-400">
            <Loader2 className="size-3.5 animate-spin" />
            正在读取目录…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs leading-5 text-slate-500 dark:text-zinc-400">
            {keyword ? `没有匹配「${treeQuery.trim()}」的文件` : "该目录下没有 Markdown 文档或图片"}
          </p>
        ) : (
          rows.map(({ entry, depth, expanded }) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={depth}
              expanded={expanded}
              active={activeEntryPath === entry.path}
              selected={selectedEntryPaths.has(entry.path)}
              cut={clipboardEntry?.operation === "cut" && clipboardEntry.entries.some((clipboardItem) => clipboardItem.path === entry.path)}
              renaming={entry.path === renamingPath}
              onToggle={nodeToggle}
              onSelect={nodeSelect}
              onPreviewImage={nodePreviewImage}
              onAction={nodeAction}
              onEntryClick={nodeEntryClick}
              onPrepareContextMenu={nodePrepareContextMenu}
              marqueeSelecting={Boolean(marqueeRect)}
              canStartDrag={nodeCanStartDrag}
              nativeDragEnabled={!usePointerFileDrag}
              pointerDragging={pointerFileDrag?.sourcePath === entry.path}
              pointerDropPlacement={pointerFileDrag?.targetPath === entry.path && pointerFileDrag.placement !== "root" ? pointerFileDrag.placement : undefined}
              onRenameSubmit={nodeRenameSubmit}
              onRenameCancel={nodeRenameCancel}
              onDropIntoDirectory={nodeDropIntoDirectory}
            />
          ))
        )}
        {marqueeRect ? <span aria-hidden className="mk-file-tree-marquee" style={marqueeRect} /> : null}
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 w-fit rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => void handleOpenVault()}><FolderOpen className="size-4" />打开文件夹</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => setCreateTarget({ parentDir: "", isDir: false })} disabled={!vaultRoot}><FilePlus2 className="size-4" />新建文件</ContextMenu.Item>
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => setCreateTarget({ parentDir: "", isDir: true })} disabled={!vaultRoot}><FolderPlus className="size-4" />新建文件夹</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => void pasteInto("")} disabled={!vaultRoot}><ClipboardPaste className="size-4" />粘贴</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => void handleRefresh()} disabled={!vaultRoot || isLoadingTree}><RefreshCw className="size-4" />刷新文件树</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {vaultRoot ? (
        <div className="shrink-0 border-t border-slate-200/80 px-2 py-1 text-[11px] text-slate-400 dark:border-zinc-700 dark:text-zinc-500">
          {keyword ? `匹配 ${matchCount} 项` : `共 ${entries.filter((entry) => !entry.isDir).length} 个文件`}
        </div>
      ) : null}

      <CreateEntryDialog
        open={Boolean(createTarget)}
        isDir={createTarget?.isDir ?? false}
        parentLabel={createTarget?.parentDir || "仓库根目录"}
        onOpenChange={(open) => { if (!open) setCreateTarget(undefined); }}
        onConfirm={handleCreate}
      />

      <DeleteEntryDialog
        open={Boolean(deleteTargets?.length)}
        entries={deleteTargets ?? []}
        onOpenChange={(open) => { if (!open) setDeleteTargets(undefined); }}
        onConfirm={handleDelete}
      />

      <RemoveRecentVaultDialog
        open={Boolean(recentVaultToRemove)}
        root={recentVaultToRemove}
        onOpenChange={(open) => { if (!open) setRecentVaultToRemove(undefined); }}
        onConfirm={confirmRemoveRecentVault}
      />

      <OpenVaultLocationDialog
        open={Boolean(pendingVaultRoot)}
        currentRoot={vaultRoot}
        targetRoot={pendingVaultRoot}
        canOpenNewWindow={isTauriEnvironment()}
        onOpenChange={(open) => { if (!open) setPendingVaultRoot(undefined); }}
        onOpenCurrent={openPendingVaultInCurrentWindow}
        onOpenNewWindow={openPendingVaultInNewWindow}
      />

    </div>
  );

  if (!onWidthChange) {
    return <div className="flex h-full shrink-0" style={{ width }}>{body}</div>;
  }

  return (
    <div className="flex h-full shrink-0" style={{ width }}>
      {body}
      <ResizableDivider
        orientation="vertical"
        size={width}
        min={FILE_TREE_WIDTH_RANGE.min}
        max={FILE_TREE_WIDTH_RANGE.max}
        ariaLabel="调整文件树宽度"
        onResize={onWidthChange}
      />
    </div>
  );
}
