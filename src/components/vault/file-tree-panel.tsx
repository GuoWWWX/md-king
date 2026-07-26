import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FilePlus2, FolderPlus, Loader2, PanelLeftClose, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { ResizableDivider } from "@/components/layout/resizable-divider";
import { Button } from "@/components/ui/button";
import { CreateEntryDialog, DeleteEntryDialog } from "@/components/vault/vault-dialogs";
import { FileTreeNode, type FileTreeNodeAction } from "@/components/vault/file-tree-node";
import { VaultSwitcher } from "@/components/vault/vault-switcher";
import { createVaultEntry, deleteVaultEntry, listVaultEntries, openVault, renameVaultEntry, selectVaultDirectory } from "@/lib/vault";
import { parseVaultError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { FILE_TREE_WIDTH_RANGE, useVaultStore } from "@/stores/vault-store";
import type { VaultEntry } from "@/types/vault";

type FileTreePanelProps = {
  width: number;
  /// 传了才渲染右侧拖拽条；由 AppShell 自行插入分隔条时不要传，否则会出现两条。
  onWidthChange?: (width: number) => void;
  onOpenFile: (entry: VaultEntry) => void;
  onCollapse?: () => void;
  className?: string;
};

type VisibleRow = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
};

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
function compareEntries(left: VaultEntry, right: VaultEntry) {
  if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
  return left.name.localeCompare(right.name, "zh-CN");
}

export function FileTreePanel({ width, onWidthChange, onOpenFile, onCollapse, className }: FileTreePanelProps) {
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

  const [renamingPath, setRenamingPath] = useState<string>();
  const [createTarget, setCreateTarget] = useState<{ parentDir: string; isDir: boolean }>();
  const [deleteTarget, setDeleteTarget] = useState<VaultEntry>();
  /// truncated 降级下已按需拉过的目录，避免同一目录被反复请求。
  const loadedDirsRef = useRef(new Set<string>());

  useEffect(() => {
    loadedDirsRef.current = new Set();
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
      await renameVaultEntry(vaultRoot, entry.path, nextName.trim());
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
    for (const bucket of byParent.values()) bucket.sort(compareEntries);

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
  }, [entries, expandedDirs, keyword]);

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
          <div className="flex-1" />
          {onCollapse ? (
            <Button variant="ghost" size="icon-sm" className="mk-file-tree-tool" title="收起文件树" aria-label="收起文件树" onClick={onCollapse}>
              <PanelLeftClose className="size-3.5" />
            </Button>
          ) : null}
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

      <div role="tree" aria-label="文件树" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1">
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
            />
          ))
        )}
      </div>

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
