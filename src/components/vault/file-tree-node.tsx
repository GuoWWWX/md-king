import { memo, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, ClipboardPaste, Copy, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, ImageIcon, MoreHorizontal, Pencil, Scissors, Trash2, FolderOpen as ExternalLink } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { TooltipAnchor } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { canDropFileTreeEntry, fileTreeDropPlacement, type FileTreeDropPlacement } from "@/components/vault/file-tree-drag";
import { isSupportedImagePath } from "@/lib/image-files";
import { cn } from "@/lib/utils";
import { resolveVaultImageSource } from "@/lib/vault";
import { useVaultStore } from "@/stores/vault-store";
import type { VaultEntry } from "@/types/vault";

const INDENT_PER_LEVEL = 12;
const BASE_PADDING = 6;
export const VAULT_ENTRY_DRAG_TYPE = "application/x-md-king-vault-entry";
let currentDraggedPath: string | undefined;

export function vaultEntryDragSourcePath(dataTransfer: DataTransfer) {
  return dataTransfer.getData(VAULT_ENTRY_DRAG_TYPE) || currentDraggedPath;
}
const contextMenuItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function vaultTreeNodeId(path: string) {
  return `mk-vault-node-${encodeURIComponent(path)}`;
}

export type FileTreeNodeAction = "rename" | "delete" | "new-file" | "new-folder" | "copy-relative-path" | "copy-absolute-path" | "show-in-explorer" | "copy-entry" | "cut-entry" | "paste-entry";

type FileTreeNodeProps = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  active?: boolean;
  selected?: boolean;
  cut?: boolean;
  renaming?: boolean;
  onToggle: (path: string) => void;
  onSelect: (entry: VaultEntry) => void;
  onPreviewImage?: (entry: VaultEntry) => void;
  onAction: (action: FileTreeNodeAction, entry: VaultEntry) => void;
  onEntryClick?: (entry: VaultEntry, event: ReactMouseEvent<HTMLDivElement>) => boolean;
  onPrepareContextMenu?: (entry: VaultEntry) => void;
  marqueeSelecting?: boolean;
  canStartDrag?: () => boolean;
  nativeDragEnabled?: boolean;
  pointerDragging?: boolean;
  pointerDropPlacement?: Exclude<FileTreeDropPlacement, "root">;
  /// 内联重命名的提交/取消由父组件持有，节点只负责输入框的本地文本。
  onRenameSubmit?: (entry: VaultEntry, nextName: string) => void;
  onRenameCancel?: () => void;
  onDropIntoDirectory?: (sourcePath: string, target: VaultEntry, placement: "before" | "after" | "inside") => void;
};

function VaultImageThumbnail({ entry }: { entry: VaultEntry }) {
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const observer = new IntersectionObserver(([observation]) => {
      if (!observation?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "80px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !vaultRoot) return undefined;
    let cancelled = false;
    setSource(undefined);
    void resolveVaultImageSource(vaultRoot, entry.path).then((next) => {
      if (!cancelled) setSource(next);
    }).catch(() => {
      if (!cancelled) setSource(undefined);
    });
    return () => { cancelled = true; };
  }, [entry.path, vaultRoot, visible]);

  return (
    <span ref={hostRef} className="flex size-[18px] shrink-0 overflow-hidden rounded-[3px] border border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800">
      {source ? <img src={source} alt="" className="size-full object-cover" /> : <ImageIcon className="m-auto size-3 text-slate-400 dark:text-zinc-500" />}
    </span>
  );
}

export const FileTreeNode = memo(function FileTreeNode({ entry, depth, expanded, active = false, selected = false, cut = false, renaming = false, onToggle, onSelect, onPreviewImage, onAction, onEntryClick, onPrepareContextMenu, marqueeSelecting = false, canStartDrag, nativeDragEnabled = true, pointerDragging = false, pointerDropPlacement, onRenameSubmit, onRenameCancel, onDropIntoDirectory }: FileTreeNodeProps) {
  const [draftName, setDraftName] = useState(entry.name);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPlacement, setDropPlacement] = useState<"before" | "after" | "inside">();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    setDraftName(entry.name);
    // 进入重命名时保留完整文件名，并把光标放到末尾；用户可直接点击任意位置继续编辑。
    const timer = window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(entry.name.length, entry.name.length);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renaming, entry.name]);

  const indent = BASE_PADDING + depth * INDENT_PER_LEVEL;
  const canAcceptDrop = (sourcePath: string | undefined, placement: "before" | "after" | "inside") => {
    return canDropFileTreeEntry(sourcePath, entry, placement);
  };
  const effectiveDropPlacement = pointerDropPlacement ?? dropPlacement;
  const isDropTarget = effectiveDropPlacement !== undefined;

  function dragSourcePath(dataTransfer: DataTransfer) {
    return vaultEntryDragSourcePath(dataTransfer);
  }

  function isVaultEntryDrag(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.types).includes(VAULT_ENTRY_DRAG_TYPE);
  }

  function getDropPlacement(event: ReactDragEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return fileTreeDropPlacement(entry, event.clientY, rect.top, rect.height);
  }

  function handleActivate() {
    if (entry.isDir) onToggle(entry.path);
    else if (isSupportedImagePath(entry.path)) onPreviewImage?.(entry);
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
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-current={active ? "page" : undefined}
        aria-expanded={entry.isDir ? expanded : undefined}
        data-mk-vault-path={entry.path}
        className={cn("mk-file-tree-row flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-1 text-[13px]", active && "mk-file-tree-row-active", selected && "mk-file-tree-row-selected", cut && "mk-file-tree-row-cut")}
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
        <span className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draftName}
            className="mk-file-tree-rename-input min-w-16 max-w-full bg-transparent py-0 text-[13px] outline-none [field-sizing:content]"
            style={{ height: "20px", padding: "0 3px", borderRadius: "3px" }}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameSubmit?.(entry, draftName);
              if (event.key === "Escape") onRenameCancel?.();
            }}
            onBlur={() => onRenameSubmit?.(entry, draftName)}
            aria-label={`重命名 ${entry.name}`}
          />
        </span>
      </div>
    );
  }

  return (
    <ContextMenu.Root>
      <TooltipAnchor content={entry.path} tooltipSide="right">
        <ContextMenu.Trigger asChild>
        <div
          id={vaultTreeNodeId(entry.path)}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected}
          aria-current={active ? "page" : undefined}
          aria-expanded={entry.isDir ? expanded : undefined}
          data-mk-context-menu
          data-mk-file-tree-node-context
          data-mk-vault-path={entry.path}
          className={cn(
            "mk-file-tree-row group/node relative flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-1 text-[13px]",
            active && "mk-file-tree-row-active",
            selected && "mk-file-tree-row-selected",
            cut && "mk-file-tree-row-cut",
            (isDragging || pointerDragging) && "opacity-50",
            isDropTarget && "bg-slate-200 text-slate-950 dark:bg-zinc-700 dark:text-zinc-50",
          )}
          style={{ paddingLeft: indent }}
          onClick={(event) => {
            if (onEntryClick?.(entry, event) !== false) handleActivate();
          }}
          draggable={nativeDragEnabled}
          onDragStart={(event) => {
            if (marqueeSelecting || canStartDrag?.() === false) {
              event.preventDefault();
              return;
            }
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
          onContextMenu={(event) => {
            onPrepareContextMenu?.(entry);
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleActivate();
            }
          }}
          tabIndex={0}
        >
          {effectiveDropPlacement === "inside" ? <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-blue-500/10 ring-1 ring-inset ring-blue-500 dark:bg-blue-400/10 dark:ring-blue-400" /> : null}
          {effectiveDropPlacement === "before" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
          {effectiveDropPlacement === "after" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
          {entry.isDir ? (
            <ChevronRight className={cn("size-3.5 shrink-0 text-slate-400 transition-transform dark:text-zinc-500", expanded && "rotate-90")} />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}

          <span className={cn("flex shrink-0 items-center justify-center", !entry.isDir && isSupportedImagePath(entry.path) ? "size-[18px]" : "size-4")}>
            {entry.isDir
              ? (expanded ? <FolderOpen className="size-3.5 text-blue-500 dark:text-blue-400" /> : <Folder className="size-3.5 text-blue-500 dark:text-blue-400" />)
              : isSupportedImagePath(entry.path) ? <VaultImageThumbnail entry={entry} /> : <FileText className="size-3.5 text-slate-400 dark:text-zinc-500" />}
          </span>

          <span className="min-w-0 flex-1">
            <span className="inline-block max-w-full truncate align-bottom" onDoubleClick={handleNameDoubleClick}>{entry.name}</span>
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="mk-file-tree-more shrink-0 opacity-0 transition group-hover/node:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                aria-label={`${entry.name} 的操作菜单`}
                onPointerDown={() => onPrepareContextMenu?.(entry)}
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
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Copy className="size-4" />
                  复制路径
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuItem onSelect={() => onAction("copy-relative-path", entry)}>
                      复制相对路径
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onAction("copy-absolute-path", entry)}>
                      复制绝对路径
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => onAction("show-in-explorer", entry)}>
                <ExternalLink className="size-4" />
                资源管理器中打开
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("copy-entry", entry)}>
                <Copy className="size-4" />
                复制
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("cut-entry", entry)}>
                <Scissors className="size-4" />
                剪切
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("paste-entry", entry)}>
                <ClipboardPaste className="size-4" />
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
        </ContextMenu.Trigger>
      </TooltipAnchor>

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
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={contextMenuItemClass}>
              <Copy className="size-4" />
              复制路径
              <ChevronRight className="ml-auto size-4" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="z-50 min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-relative-path", entry)}>
                  复制相对路径
                </ContextMenu.Item>
                <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-absolute-path", entry)}>
                  复制绝对路径
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("show-in-explorer", entry)}>
            <ExternalLink className="size-4" />
            资源管理器中打开
          </ContextMenu.Item>
          <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("copy-entry", entry)}>
            <Copy className="size-4" />
            复制
          </ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("cut-entry", entry)}>
            <Scissors className="size-4" />
            剪切
          </ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onAction("paste-entry", entry)}>
            <ClipboardPaste className="size-4" />
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
});
