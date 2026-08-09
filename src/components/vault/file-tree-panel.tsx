import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, FilePlus2, FolderOpen, FolderPlus, Loader2, LocateFixed, RefreshCw, Search, X } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import { ResizableDivider } from "@/components/layout/resizable-divider";
import { Button } from "@/components/ui/button";
import { CreateEntryDialog, DeleteEntryDialog } from "@/components/vault/vault-dialogs";
import { FileTreeNode, vaultTreeNodeId, type FileTreeNodeAction } from "@/components/vault/file-tree-node";
import { VaultSwitcher } from "@/components/vault/vault-switcher";
import { createVaultEntry, deleteVaultEntry, listVaultEntries, moveVaultEntry, openVault, renameVaultEntry, selectVaultDirectory, copyVaultEntry, showInExplorer, copyTextToClipboard, readPathsFromClipboard } from "@/lib/vault";
import { parseVaultError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { FILE_TREE_WIDTH_RANGE, useVaultStore } from "@/stores/vault-store";
import { useDocumentTabsStore } from "@/stores/document-tabs-store";
import type { VaultEntry } from "@/types/vault";

type FileTreePanelProps = {
  width: number;
  /// 传了才渲染右侧拖拽条；由 AppShell 自行插入分隔条时不要传，否则会出现两条。
  onWidthChange?: (width: number) => void;
  onOpenFile: (entry: VaultEntry) => void;
  className?: string;
};

type VisibleRow = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
};

type DropPlacement = "before" | "after" | "inside";

type ManualOrder = Record<string, string[]>;

const FILE_TREE_ORDER_KEY_PREFIX = "md-king-vault-order:";

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

/// 目录在前、同类按中文排序：Windows 资源管理器和 Obsidian 都是这个顺序，
/// 用 localeCompare("zh-CN") 让「文档」排在「zebra」之前而不是按 UTF-16 码点乱序。
function compareEntries(left: VaultEntry, right: VaultEntry, manualRanks?: ReadonlyMap<string, number>) {
  const leftOrder = manualRanks?.get(left.name) ?? -1;
  const rightOrder = manualRanks?.get(right.name) ?? -1;
  if (leftOrder >= 0 || rightOrder >= 0) {
    if (leftOrder < 0) return 1;
    if (rightOrder < 0) return -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
  return left.name.localeCompare(right.name, "zh-CN");
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

export function FileTreePanel({ width, onWidthChange, onOpenFile, className }: FileTreePanelProps) {
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const recentVaults = useVaultStore((state) => state.recentVaults);
  const entries = useVaultStore((state) => state.entries);
  const truncated = useVaultStore((state) => state.truncated);
  const expandedDirs = useVaultStore((state) => state.expandedDirs);
  const treeQuery = useVaultStore((state) => state.treeQuery);
  const isLoadingTree = useVaultStore((state) => state.isLoadingTree);
  const hasActiveFile = useVaultStore((state) => Boolean(state.activeFilePath));
  const locateRequest = useVaultStore((state) => state.locateRequest);
  const setVaultRoot = useVaultStore((state) => state.setVaultRoot);
  const pushRecentVault = useVaultStore((state) => state.pushRecentVault);
  const removeRecentVault = useVaultStore((state) => state.removeRecentVault);
  const setEntries = useVaultStore((state) => state.setEntries);
  const mergeEntries = useVaultStore((state) => state.mergeEntries);
  const setIsLoadingTree = useVaultStore((state) => state.setIsLoadingTree);
  const setTreeQuery = useVaultStore((state) => state.setTreeQuery);
  const toggleDir = useVaultStore((state) => state.toggleDir);
  const expandDirs = useVaultStore((state) => state.expandDirs);
  const collapseAllDirs = useVaultStore((state) => state.collapseAllDirs);
  const setCopiedEntryPath = useVaultStore((state) => state.setCopiedEntryPath);

  const [renamingPath, setRenamingPath] = useState<string>();
  const [createTarget, setCreateTarget] = useState<{ parentDir: string; isDir: boolean }>();
  const [deleteTarget, setDeleteTarget] = useState<VaultEntry>();
  const [manualOrder, setManualOrder] = useState<ManualOrder>({});
  /// truncated 降级下已按需拉过的目录，避免同一目录被反复请求。
  const loadedDirsRef = useRef(new Set<string>());
  const locateFrameRef = useRef<number | undefined>(undefined);
  const locateTimerRef = useRef<number | undefined>(undefined);
  const directoryPaths = useMemo(
    () => entries.filter((entry) => entry.isDir && entry.hasChildren).map((entry) => entry.path),
    [entries],
  );
  const allDirectoriesExpanded = directoryPaths.length > 0 && directoryPaths.every((path) => expandedDirs.has(path));

  useEffect(() => {
    loadedDirsRef.current = new Set();
    setManualOrder(loadManualOrder(vaultRoot));
  }, [vaultRoot]);

  const loadVault = useCallback(async (path: string) => {
    setIsLoadingTree(true);
    try {
      const listing = await openVault(path);
      setVaultRoot(listing.root);
      setEntries(listing.entries, listing.truncated);
      pushRecentVault(listing.root);
    } catch (error) {
      const { message } = parseVaultError(error, "打开目录失败");
      toast.error(message);
    } finally {
      setIsLoadingTree(false);
    }
  }, [pushRecentVault, setEntries, setIsLoadingTree, setVaultRoot]);

  async function handleOpenVault() {
    try {
      const selected = await selectVaultDirectory();
      if (!selected) return;
      await loadVault(selected);
    } catch (error) {
      const { message } = parseVaultError(error, "选择目录失败");
      toast.error(message);
    }
  }

  async function handleRefresh() {
    if (!vaultRoot) return;
    setIsLoadingTree(true);
    try {
      const listing = await listVaultEntries(vaultRoot, undefined, true);
      setEntries(listing.entries, listing.truncated);
      loadedDirsRef.current = new Set();
    } catch (error) {
      const { message } = parseVaultError(error, "刷新文件树失败");
      toast.error(message);
    } finally {
      setIsLoadingTree(false);
    }
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
      if (tab.kind !== "vault" || !tab.path) continue;
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

  function updateManualOrderAfterMove(entry: VaultEntry, moved: VaultEntry, target: VaultEntry, placement: DropPlacement) {
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
      const destinationParent = placement === "inside" ? target.path : parentOf(target.path);
      if (sourceParent !== destinationParent && next[sourceParent]) {
        const remaining = next[sourceParent].filter((name) => name !== entry.name);
        if (remaining.length > 0) next[sourceParent] = remaining;
        else delete next[sourceParent];
      }

      const names = orderedSiblingNames(destinationParent, entry.path, next)
        .filter((name) => name !== moved.name);
      if (placement === "inside") {
        names.push(moved.name);
      } else {
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

  async function handleMoveEntry(entry: VaultEntry, target: VaultEntry, placement: DropPlacement) {
    const destinationDir = placement === "inside" ? target.path : parentOf(target.path);
    if (!vaultRoot || entry.path === target.path) return;
    if (placement === "inside" && !target.isDir) return;
    if (entry.isDir && (destinationDir === entry.path || destinationDir.startsWith(`${entry.path}/`))) return;

    // 同目录拖动只改变展示顺序，不做无意义的磁盘操作和整树刷新。
    if (parentOf(entry.path) === destinationDir) {
      updateManualOrderAfterMove(entry, entry, target, placement);
      return;
    }

    try {
      const moved = await moveVaultEntry(vaultRoot, entry.path, destinationDir);
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
    if (!vaultRoot || !deleteTarget) return;
    try {
      await deleteVaultEntry(vaultRoot, deleteTarget.path, deleteTarget.isDir);
      updateManualOrderAfterDelete(deleteTarget);
      await handleRefresh();
      toast.success(`已删除 ${deleteTarget.name}`);
    } catch (error) {
      const { message } = parseVaultError(error, "删除失败");
      throw new Error(message);
    }
  }

  async function handleNodeAction(action: FileTreeNodeAction, entry: VaultEntry) {
    if (action === "rename") setRenamingPath(entry.path);
    if (action === "delete") setDeleteTarget(entry);
    if (action === "new-file") setCreateTarget({ parentDir: entry.path, isDir: false });
    if (action === "new-folder") setCreateTarget({ parentDir: entry.path, isDir: true });

    if (action === "copy-relative-path") {
      try {
        await copyTextToClipboard(entry.path);
        toast.success("已复制相对路径");
      } catch {
        toast.error("复制失败");
      }
    }

    if (action === "copy-absolute-path") {
      if (!vaultRoot) return;
      try {
        const absolutePath = `${vaultRoot}\\${entry.path.replace(/\//g, "\\")}`;
        await copyTextToClipboard(absolutePath);
        toast.success("已复制绝对路径");
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
      setCopiedEntryPath(entry.path);
      toast.success(`已复制 ${entry.name}`);
    }

    if (action === "paste-entry") {
      if (!vaultRoot) return;
      const copiedPath = useVaultStore.getState().copiedEntryPath;
      if (!copiedPath) {
        // 尝试从系统剪贴板读取文件路径
        try {
          const paths = await readPathsFromClipboard();
          if (paths.length === 0) {
            toast.error("剪贴板中没有可粘贴的内容");
            return;
          }

          // 确定粘贴目标目录
          const targetDir = entry.isDir ? entry.path : parentOf(entry.path);

          for (const sourcePath of paths) {
            try {
              await copyVaultEntry(vaultRoot, sourcePath, targetDir);
            } catch (error) {
              const { message } = parseVaultError(error, "粘贴失败");
              toast.error(message);
            }
          }

          await handleRefresh();
          toast.success(`已粘贴 ${paths.length} 个项目`);
        } catch (error) {
          toast.error("无法读取剪贴板");
        }
        return;
      }

      // 内部复制
      try {
        const targetDir = entry.isDir ? entry.path : parentOf(entry.path);
        await copyVaultEntry(vaultRoot, copiedPath, targetDir);
        await handleRefresh();
        const copiedEntry = entries.find((e) => e.path === copiedPath);
        toast.success(`已粘贴 ${copiedEntry?.name ?? "文件"}`);
      } catch (error) {
        const { message } = parseVaultError(error, "粘贴失败");
        toast.error(message);
      }
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
      const ranks = order ? new Map(order.map((name, index) => [name, index])) : undefined;
      bucket.sort((left, right) => compareEntries(left, right, ranks));
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
  }, [entries, expandedDirs, keyword, manualOrder]);

  const body = (
    <div className={cn("mk-file-tree-panel mk-sidebar-panel flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[8px]", className)}>
      <div className="shrink-0 space-y-1.5 border-b border-slate-200/80 p-1.5 dark:border-zinc-700">
        <VaultSwitcher
          vaultRoot={vaultRoot}
          recentVaults={recentVaults}
          onOpenVault={() => void handleOpenVault()}
          onSelectVault={(root) => void loadVault(root)}
          onRemoveRecent={removeRecentVault}
        />

        <div className="flex items-center gap-0.5">
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="mk-file-tree-tool"
            title="定位当前文档"
            aria-label="在文件树中定位当前文档"
            disabled={!vaultRoot || !hasActiveFile}
            onClick={() => {
              const activePath = useVaultStore.getState().activeFilePath;
              if (activePath) useVaultStore.getState().requestLocatePath(activePath);
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
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
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
            role="tree"
            aria-label="文件树"
            data-mk-context-menu
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1"
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
            {keyword ? `没有匹配「${treeQuery.trim()}」的文件` : "该目录下没有 Markdown 文件"}
          </p>
        ) : (
          rows.map(({ entry, depth, expanded }) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={depth}
              expanded={expanded}
              renaming={entry.path === renamingPath}
              onToggle={handleToggle}
              onSelect={onOpenFile}
              onAction={handleNodeAction}
              onRenameSubmit={(target, nextName) => void handleRenameSubmit(target, nextName)}
              onRenameCancel={() => setRenamingPath(undefined)}
              onDropIntoDirectory={(sourcePath, target, placement) => {
                const source = entries.find((entry) => entry.path === sourcePath);
                if (source) void handleMoveEntry(source, target, placement);
              }}
            />
          ))
        )}
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 w-fit rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => void handleOpenVault()}><FolderOpen className="size-4" />打开文件夹</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => setCreateTarget({ parentDir: "", isDir: false })} disabled={!vaultRoot}><FilePlus2 className="size-4" />新建文件</ContextMenu.Item>
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0" onSelect={() => setCreateTarget({ parentDir: "", isDir: true })} disabled={!vaultRoot}><FolderPlus className="size-4" />新建文件夹</ContextMenu.Item>
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
        open={Boolean(deleteTarget)}
        entryName={deleteTarget?.name ?? ""}
        isDir={deleteTarget?.isDir ?? false}
        hasChildren={deleteTarget?.hasChildren ?? false}
        onOpenChange={(open) => { if (!open) setDeleteTarget(undefined); }}
        onConfirm={handleDelete}
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
