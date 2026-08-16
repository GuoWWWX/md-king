import { ChevronDown, FolderOpen, Library, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { vaultDisplayName } from "@/lib/vault-window";
import { cn } from "@/lib/utils";

type VaultSwitcherProps = {
  vaultRoot?: string;
  recentVaults: string[];
  onOpenVault: () => void;
  onSelectVault: (root: string) => void;
  onRemoveRecent?: (root: string) => void;
  className?: string;
};

export function VaultSwitcher({ vaultRoot, recentVaults, onOpenVault, onSelectVault, onRemoveRecent, className }: VaultSwitcherProps) {
  if (!vaultRoot && recentVaults.length === 0) {
    return (
      <Button
        variant="ghost"
        className={cn("mk-file-tree-switcher h-9 w-full justify-start gap-2 rounded-[8px] px-2 text-sm font-bold", className)}
        onClick={onOpenVault}
      >
        <FolderOpen className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="min-w-0 truncate">打开目录</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("mk-file-tree-switcher h-9 w-full justify-start gap-2 rounded-[8px] px-2 text-sm font-bold", className)}
          title={vaultRoot}
          aria-label={vaultRoot ? `当前目录 ${vaultRoot}，点击切换` : "打开或选择最近目录"}
        >
          {vaultRoot ? <Library className="size-4 shrink-0 text-blue-600 dark:text-blue-400" /> : <FolderOpen className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />}
          <span className="min-w-0 flex-1 truncate text-left">{vaultRoot ? vaultDisplayName(vaultRoot) : "打开目录"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-400 dark:text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>

      {/* 宽度跟随触发器：写死 360px 会比文件树面板本身还宽，弹出来明显溢出。 */}
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
        <DropdownMenuLabel>最近打开的目录</DropdownMenuLabel>
        {recentVaults.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-slate-500 dark:text-zinc-400">暂无记录</p>
        ) : (
          recentVaults.map((root) => {
            const isActive = root === vaultRoot;
            return (
              <DropdownMenuItem
                key={root}
                className={cn(
                  "min-h-0 items-center gap-2 py-1",
                  isActive && "bg-blue-50 text-blue-950 focus:bg-blue-100 focus:text-blue-950 dark:bg-blue-500/15 dark:text-blue-100 dark:focus:bg-blue-500/25 dark:focus:text-blue-50",
                )}
                onSelect={() => { if (!isActive) onSelectVault(root); }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{vaultDisplayName(root)}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-zinc-400">{root}</span>
                </span>
                {onRemoveRecent ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`从最近列表移除 ${root}`}
                    className="shrink-0 rounded-[6px] p-0.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    // 阻止冒泡，否则点删除会连带触发 DropdownMenuItem 的切换。
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); onRemoveRecent(root); }}
                  >
                    <X className="size-3.5" />
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={onOpenVault}>
          <FolderOpen className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold">打开其他目录…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
