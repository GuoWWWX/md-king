import { useEffect, useRef, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VaultEntry } from "@/types/vault";

const INDENT_PER_LEVEL = 12;
const BASE_PADDING = 6;

export type FileTreeNodeAction = "rename" | "delete" | "new-file" | "new-folder";

type FileTreeNodeProps = {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  active: boolean;
  renaming?: boolean;
  onToggle: (path: string) => void;
  onSelect: (entry: VaultEntry) => void;
  onAction: (action: FileTreeNodeAction, entry: VaultEntry) => void;
  /// 内联重命名的提交/取消由父组件持有，节点只负责输入框的本地文本。
  onRenameSubmit?: (entry: VaultEntry, nextName: string) => void;
  onRenameCancel?: () => void;
};

export function FileTreeNode({ entry, depth, expanded, active, renaming = false, onToggle, onSelect, onAction, onRenameSubmit, onRenameCancel }: FileTreeNodeProps) {
  const [draftName, setDraftName] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

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

  function handleActivate() {
    if (entry.isDir) onToggle(entry.path);
    else onSelect(entry);
  }

  if (renaming) {
    return (
      <div className="mk-file-tree-row flex h-7 items-center gap-1" style={{ paddingLeft: indent }}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {entry.isDir ? <Folder className="size-3.5 text-slate-400 dark:text-zinc-500" /> : <FileText className="size-3.5 text-slate-400 dark:text-zinc-500" />}
        </span>
        <input
          ref={inputRef}
          value={draftName}
          className="mk-file-tree-rename-input h-6 min-w-0 flex-1 rounded-[6px] px-1.5 text-[13px] outline-none"
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRenameSubmit?.(entry, draftName);
            if (event.key === "Escape") onRenameCancel?.();
          }}
          onBlur={() => onRenameCancel?.()}
          aria-label={`重命名 ${entry.name}`}
        />
      </div>
    );
  }

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={active}
      aria-expanded={entry.isDir ? expanded : undefined}
      className={cn("mk-file-tree-row group/node flex h-7 cursor-pointer items-center gap-1 rounded-[6px] pr-1 text-[13px]", active && "mk-file-tree-row-active")}
      style={{ paddingLeft: indent }}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleActivate();
        }
      }}
      tabIndex={0}
      title={entry.path}
    >
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

      <span className="min-w-0 flex-1 truncate">{entry.name}</span>

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
  );
}
