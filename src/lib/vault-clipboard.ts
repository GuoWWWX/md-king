import type { VaultEntry } from "@/types/vault";

export type VaultClipboardItem = {
  path: string;
  name: string;
  isDir: boolean;
};

export type VaultClipboardEntry = {
  entries: VaultClipboardItem[];
  operation: "copy" | "cut";
};

export function vaultPasteTarget(entry?: VaultEntry) {
  if (!entry) return "";
  if (entry.isDir) return entry.path;
  const index = entry.path.lastIndexOf("/");
  return index < 0 ? "" : entry.path.slice(0, index);
}

export function vaultAbsolutePath(root: string, relative: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/[\\/]/g, separator)}`;
}

function normalizeSystemPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function clipboardContainsVaultEntry(root: string, relative: string, clipboardPaths: string[]) {
  const expected = normalizeSystemPath(vaultAbsolutePath(root, relative));
  return clipboardPaths.some((path) => normalizeSystemPath(path) === expected);
}

/// 同时选中父目录和其内部条目时，只对父目录执行文件操作，避免复制或删除两次。
export function topLevelVaultEntries<T extends VaultClipboardItem>(entries: T[]) {
  const byDepth = [...entries].sort((left, right) => left.path.length - right.path.length);
  return byDepth.filter((entry, index) => !byDepth.slice(0, index).some((ancestor) => (
    ancestor.isDir && entry.path.startsWith(`${ancestor.path}/`)
  )));
}
