import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronsDown, ChevronsUp, FilePlus2, FolderPlus, Loader2, RefreshCw, Search, X } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import { ResizableDivider } from "@/components/layout/resizable-divider";
import { Button } from "@/components/ui/button";
import { CreateEntryDialog, DeleteEntryDialog } from "@/components/vault/vault-dialogs";
import { FileTreeNode, type FileTreeNodeAction } from "@/components/vault/file-tree-node";
import { VaultSwitcher } from "@/components/vault/vault-switcher";
import { createVaultEntry, deleteVaultEntry, listVaultEntries, moveVaultEntry, openVault, renameVaultEntry, selectVaultDirectory } from "@/lib/vault";
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

type DropTarget = {
  path: string;
  placement: DropPlacement;
};

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
function compareEntries(left: VaultEntry, right: VaultEntry, manualOrder?: string[]) {
  const leftOrder = manualOrder?.indexOf(left.name) ?? -1;
  const rightOrder = manualOrder?.indexOf(right.name) ?? -1;
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
  const activeFilePath = useVaultStore((state) => state.activeFilePath);
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

  const [renamingPath, setRenamingPath] = useState<string>();
  const [createTarget, setCreateTarget] = useState<{ parentDir: string; isDir: boolean }>();
  const [deleteTarget, setDeleteTarget] = useState<VaultEntry>();
  const [draggingEntry, setDraggingEntry] = useState<VaultEntry>();
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [manualOrder, setManualOrder] = useState<ManualOrder>({});
  /// truncated 降级下已按需拉过的目录，避免同一目录被反复请求。
  const loadedDirsRef = useRef(new Set<string>());
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
        next[sourceParent] = next[sourceParent].filter((name) => name !== entry.name);
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

  async function handleMoveEntry(entry: VaultEntry, target: VaultEntry, placement: DropPlacement) {
    const destinationDir = placement === "inside" ? target.path : parentOf(target.path);
    if (!vaultRoot || entry.path === target.path) return;
    if (placement === "inside" && !target.isDir) return;
    if (entry.isDir && (destinationDir === entry.path || destinationDir.startsWith(`${entry.path}/`))) return;

    try {
      const moved = await moveVaultEntry(vaultRoot, entry.path, destinationDir);
      remapOpenVaultPaths(entry.path, moved.path, entry.isDir);
      updateManualOrderAfterMove(entry, moved, target, placement);
      if (destinationDir) expandDirs([destinationDir, ...ancestorsOf(destinationDir)]);
      await handleRefresh();
      toast.success(`已移动「${entry.name}」到「${target.name}」`);
    } catch (error) {
      const { message } = parseVaultError(error, "移动文件失败");
      toast.error(message);
    } finally {
      setDraggingEntry(undefined);
      setDropTarget(undefined);
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
      await handleRefresh();
      toast.success(`已删除 ${deleteTarget.name}`);
    } catch (error) {
      const { message } = parseVaultError(error, "删除失败");
      throw new Error(message);
    }
  }

  function handleNodeAction(action: FileTreeNodeAction, entry: VaultEntry) {
    if (action === "rename") setRenamingPath(entry.path);
    if (action === "delete") setDeleteTarget(entry);
    if (action === "new-file") setCreateTarget({ parentDir: entry.path, isDir: false });
    if (action === "new-folder") setCreateTarget({ parentDir: entry.path, isDir: true });
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
    for (const [parent, bucket] of byParent) bucket.sort((left, right) => compareEntries(left, right, manualOrder[parent]));

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
            title={allDirectoriesExpanded ? "全部收起" : "全部展开"}
            aria-label={allDirectoriesExpanded ? "全部收起目录" : "全部展开目录"}
            disabled={!vaultRoot || directoryPaths.length === 0}
            onClick={() => {
              if (allDirectoriesExpanded) collapseAllDirs();
              else expandDirs(directoryPaths);
            }}
          >
            {allDirectoriesExpanded ? <ChevronsUp className="size-3.5" /> : <ChevronsDown className="size-3.5" />}
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
              active={entry.path === activeFilePath}
              renaming={entry.path === renamingPath}
              onToggle={handleToggle}
              onSelect={onOpenFile}
              onAction={handleNodeAction}
              onRenameSubmit={(target, nextName) => void handleRenameSubmit(target, nextName)}
              onRenameCancel={() => setRenamingPath(undefined)}
              draggingPath={draggingEntry?.path}
              dropTarget={dropTarget}
              onDragStart={setDraggingEntry}
              onDragEnd={() => {
                setDraggingEntry(undefined);
                setDropTarget(undefined);
              }}
              onDropTargetChange={setDropTarget}
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
          <ContextMenu.Content className="z-50 min-w-40 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800" onSelect={() => void handleOpenVault()}>打开文件夹</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800" onSelect={() => setCreateTarget({ parentDir: "", isDir: false })} disabled={!vaultRoot}>新建文件</ContextMenu.Item>
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800" onSelect={() => setCreateTarget({ parentDir: "", isDir: true })} disabled={!vaultRoot}>新建文件夹</ContextMenu.Item>
            <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
            <ContextMenu.Item className="relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800" onSelect={() => void handleRefresh()} disabled={!vaultRoot || isLoadingTree}>刷新文件树</ContextMenu.Item>
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
