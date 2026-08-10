import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2, Copy, Clipboard, FolderOpen as ExternalLink } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { TooltipAnchor } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/stores/vault-store";
import type { VaultEntry } from "@/types/vault";

const INDENT_PER_LEVEL = 12;
const BASE_PADDING = 6;
const VAULT_ENTRY_DRAG_TYPE = "application/x-md-king-vault-entry";
let currentDraggedPath: string | undefined;
const contextMenuItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function vaultTreeNodeId(path: string) {
  return `mk-vault-node-${encodeURIComponent(path)}`;
}

export type FileTreeNodeAction = "rename" | "delete" | "new-file" | "new-folder" | "copy-relative-path" | "copy-absolute-path" | "show-in-explorer" | "copy-entry" | "paste-entry";

type FileTreeNodeProps = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  renaming?: boolean;
  onToggle: (path: string) => void;
  onSelect: (entry: VaultEntry) => void;
  onAction: (action: FileTreeNodeAction, entry: VaultEntry) => void;
  /// 内联重命名的提交/取消由父组件持有，节点只负责输入框的本地文本。
  onRenameSubmit?: (entry: VaultEntry, nextName: string) => void;
  onRenameCancel?: () => void;
  onDropIntoDirectory?: (sourcePath: string, target: VaultEntry, placement: "before" | "after" | "inside") => void;
};

function parentOf(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function FileTreeNode({ entry, depth, expanded, renaming = false, onToggle, onSelect, onAction, onRenameSubmit, onRenameCancel, onDropIntoDirectory }: FileTreeNodeProps) {
  const [draftName, setDraftName] = useState(entry.name);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPlacement, setDropPlacement] = useState<"before" | "after" | "inside">();
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useVaultStore((state) => state.activeFilePath === entry.path);

  useEffect(() => {
    if (!renaming) return;
    setDraftName(entry.name);
    // 只选中主干名，扩展名保持不选——改名时绝大多数情况扩展名是不动的。
    const timer = window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const dotIndex = entry.isDir ? -1 : entry.name.lastIndexOf(".");
      input.setSelectionRange(0, dotIndex > 0 ? dotIndex : entry.name.length);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renaming, entry.name, entry.isDir]);

  const indent = BASE_PADDING + depth * INDENT_PER_LEVEL;
  const canAcceptDrop = (sourcePath: string | undefined, placement: "before" | "after" | "inside") => {
    const destination = placement === "inside" ? entry.path : parentOf(entry.path);
    return Boolean(
      sourcePath
        && sourcePath !== entry.path
        && (placement !== "inside" || entry.isDir)
        && destination !== sourcePath
        && !destination.startsWith(`${sourcePath}/`),
    );
  };
  const isDropTarget = dropPlacement !== undefined;

  function dragSourcePath(dataTransfer: DataTransfer) {
    return dataTransfer.getData(VAULT_ENTRY_DRAG_TYPE) || currentDraggedPath;
  }

  function isVaultEntryDrag(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.types).includes(VAULT_ENTRY_DRAG_TYPE);
  }

  function getDropPlacement(event: ReactDragEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    if (entry.isDir && offset >= rect.height * 0.25 && offset <= rect.height * 0.75) return "inside" as const;
    return offset < rect.height / 2 ? "before" as const : "after" as const;
  }

  function handleActivate() {
    if (entry.isDir) onToggle(entry.path);
    else onSelect(entry);
  }

  function handleNameDoubleClick(event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    onAction("rename", entry);
  }

  if (renaming) {
    return (
      <div
        className={cn("mk-file-tree-row flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-1 text-[13px]", active && "mk-file-tree-row-active")}
        style={{ paddingLeft: indent }}
      >
        {entry.isDir ? (
          <ChevronRight className="size-3.5 shrink-0 rotate-90 text-slate-400 dark:text-zinc-500" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="flex size-4 shrink-0 items-center justify-center">
          {entry.isDir ? <FolderOpen className="size-3.5 text-blue-500 dark:text-blue-400" /> : <FileText className="size-3.5 text-slate-400 dark:text-zinc-500" />}
        </span>
        <input
          ref={inputRef}
          value={draftName}
          className="mk-file-tree-rename-input min-w-0 flex-1 bg-transparent py-0 text-[13px] outline-none"
          style={{ height: "22px", padding: "0 4px", borderRadius: "4px" }}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRenameSubmit?.(entry, draftName);
            if (event.key === "Escape") onRenameCancel?.();
          }}
          onBlur={() => onRenameSubmit?.(entry, draftName)}
          aria-label={`重命名 ${entry.name}`}
        />
      </div>
    );
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <TooltipAnchor content={entry.path} tooltipSide="right">
        <div
          id={vaultTreeNodeId(entry.path)}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={active}
          aria-expanded={entry.isDir ? expanded : undefined}
          data-mk-context-menu
          data-mk-file-tree-node-context
          className={cn(
            "mk-file-tree-row group/node relative flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-1 text-[13px]",
            active && "mk-file-tree-row-active",
            isDragging && "opacity-50",
            isDropTarget && "bg-slate-200 text-slate-950 dark:bg-zinc-700 dark:text-zinc-50",
          )}
          style={{ paddingLeft: indent }}
          onClick={handleActivate}
          draggable
          onDragStart={(event) => {
            currentDraggedPath = entry.path;
            setIsDragging(true);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(VAULT_ENTRY_DRAG_TYPE, entry.path);
            event.dataTransfer.setData("text/plain", entry.path);
          }}
          onDragEnd={() => {
            currentDraggedPath = undefined;
            setIsDragging(false);
            setDropPlacement(undefined);
          }}
          onDragEnter={(event) => {
            const sourcePath = dragSourcePath(event.dataTransfer);
            const placement = getDropPlacement(event);
            if ((!sourcePath && !isVaultEntryDrag(event.dataTransfer)) || (sourcePath && !canAcceptDrop(sourcePath, placement))) return;
            event.preventDefault();
            setDropPlacement((current) => current === placement ? current : placement);
          }}
          onDragOver={(event) => {
            const sourcePath = dragSourcePath(event.dataTransfer);
            const placement = getDropPlacement(event);
            if ((!sourcePath && !isVaultEntryDrag(event.dataTransfer)) || (sourcePath && !canAcceptDrop(sourcePath, placement))) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropPlacement((current) => current === placement ? current : placement);
          }}
          onDragLeave={(event) => {
            if (!isDropTarget || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDropPlacement(undefined);
          }}
          onDrop={(event) => {
            const sourcePath = dragSourcePath(event.dataTransfer);
            const placement = getDropPlacement(event);
            if (!sourcePath || !canAcceptDrop(sourcePath, placement)) return;
            event.preventDefault();
            setDropPlacement(undefined);
            onDropIntoDirectory?.(sourcePath, entry, placement);
          }}
          // 父级菜单只服务文件树空白处；节点菜单在这里截断事件冒泡。
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleActivate();
            }
          }}
          tabIndex={0}
        >
          {dropPlacement === "inside" ? <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-blue-500/10 ring-1 ring-inset ring-blue-500 dark:bg-blue-400/10 dark:ring-blue-400" /> : null}
          {dropPlacement === "before" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
          {dropPlacement === "after" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
          {entry.isDir ? (
            <ChevronRight className={cn("size-3.5 shrink-0 text-slate-400 transition-transform dark:text-zinc-500", expanded && "rotate-90")} />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}

          <span className="flex size-4 shrink-0 items-center justify-center">
            {entry.isDir
              ? (expanded ? <FolderOpen className="size-3.5 text-blue-500 dark:text-blue-400" /> : <Folder className="size-3.5 text-blue-500 dark:text-blue-400" />)
              : <FileText className="size-3.5 text-slate-400 dark:text-zinc-500" />}
          </span>

          <span className="min-w-0 flex-1 truncate" onDoubleClick={handleNameDoubleClick}>{entry.name}</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="mk-file-tree-more shrink-0 opacity-0 transition group-hover/node:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                aria-label={`${entry.name} 的操作菜单`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 min-w-40">
              {entry.isDir ? (
                <>
                  <DropdownMenuItem onSelect={() => onAction("new-file", entry)}>
                    <FilePlus2 className="size-4" />
                    新建文件
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("new-folder", entry)}>
                    <FolderPlus className="size-4" />
                    新建文件夹
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => onAction("copy-relative-path", entry)}>
                <Copy className="size-4" />
                复制相对路径
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("copy-absolute-path", entry)}>
                <Copy className="size-4" />
                复制绝对路径
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("show-in-explorer", entry)}>
                <ExternalLink className="size-4" />
                在资源管理器中打开
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("copy-entry", entry)}>
                <Copy className="size-4" />
                复制
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("paste-entry", entry)}>
                <Clipboard className="size-4" />
                粘贴
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("rename", entry)}>
                <Pencil className="size-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete", entry)}>
                <Trash2 className="size-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </TooltipAnchor>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {entry.isDir ? (
            <>
              <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("new-file", entry)}>
                <FilePlus2 className="size-4" />
                新建文件
              </ContextMenu.Item>
              <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("new-folder", entry)}>
                <FolderPlus className="size-4" />
                新建文件夹
              </ContextMenu.Item>
              <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
            </>
          ) : null}
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-relative-path", entry)}>
            <Copy className="size-4" />
            复制相对路径
          </ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-absolute-path", entry)}>
            <Copy className="size-4" />
            复制绝对路径
          </ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("show-in-explorer", entry)}>
            <ExternalLink className="size-4" />
            在资源管理器中打开
          </ContextMenu.Item>
          <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-entry", entry)}>
            <Copy className="size-4" />
            复制
          </ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("paste-entry", entry)}>
            <Clipboard className="size-4" />
            粘贴
          </ContextMenu.Item>
          <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("rename", entry)}>
            <Pencil className="size-4" />
            重命名
          </ContextMenu.Item>
          <ContextMenu.Item className={cn(contextMenuItemClass, "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive")} onSelect={() => onAction("delete", entry)}>
            <Trash2 className="size-4" />
            删除
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
