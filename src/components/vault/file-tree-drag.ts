import type { VaultEntry } from "@/types/vault";

export type FileTreeDropPlacement = "before" | "after" | "inside" | "root";

function parentOf(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function fileTreeDropPlacement(target: Pick<VaultEntry, "isDir">, pointerY: number, rowTop: number, rowHeight: number) {
  const offset = pointerY - rowTop;
  if (target.isDir && offset >= rowHeight * 0.25 && offset <= rowHeight * 0.75) return "inside" as const;
  return offset < rowHeight / 2 ? "before" as const : "after" as const;
}

export function canDropFileTreeEntry(
  sourcePath: string | undefined,
  target: Pick<VaultEntry, "path" | "isDir"> | null,
  placement: FileTreeDropPlacement,
) {
  if (!sourcePath) return false;
  if (placement === "root") return true;
  if (!target || sourcePath === target.path || (placement === "inside" && !target.isDir)) return false;

  const destination = placement === "inside" ? target.path : parentOf(target.path);
  return destination !== sourcePath && !destination.startsWith(`${sourcePath}/`);
}
