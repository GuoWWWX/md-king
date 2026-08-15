/// Vault（Obsidian 式目录）相关类型。字段名与 Rust 侧 serde camelCase 输出严格一致，
/// 改这里必须同步改 src-tauri/src/core/vault.rs 的返回结构。

export type VaultEol = "lf" | "crlf";

/// entry.path 一律是相对 vault root 的路径，且用 "/" 分隔——Rust 侧已统一转换，
/// 前端不需要再处理 Windows 的 "\"，树结构按 "/" 现算即可。
export type VaultEntry = {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
  hasChildren: boolean;
};

/// entries 是扁平数组而非嵌套树：一次性递归 + 上限，超限时 truncated 为 true，
/// 前端降级为「只展开一层、按需请求子目录」。
export type VaultListing = {
  root: string;
  entries: VaultEntry[];
  truncated: boolean;
  skippedDirs: number;
};

export type VaultFileContent = {
  path: string;
  content: string;
  eol: VaultEol;
  hasBom: boolean;
  modifiedMs: number;
  size: number;
};

export type VaultWriteResult = {
  path: string;
  modifiedMs: number;
  size: number;
};

export type VaultImageImport = {
  entry: VaultEntry;
  imageDir: VaultEntry;
};

export type VaultWriteParams = {
  root: string;
  path: string;
  content: string;
  eol: VaultEol;
  hasBom: boolean;
  /// 乐观锁：带上读取时拿到的 modifiedMs，Rust 侧写前比对，不一致返回 CONFLICT。
  /// 传 undefined 表示放弃乐观锁（用户已在冲突弹窗里选择「覆盖磁盘版本」）。
  expectedModifiedMs?: number;
  /// 默认 false，Rust 侧会拒绝把非空文件写成 0 字节。
  allowEmpty?: boolean;
};

/// Rust 侧所有 vault 错误统一为 "CODE|中文提示" 格式，前端靠 code 分流 UI
/// （冲突要弹窗、非 UTF-8 要切只读，不能全都塞进一个 toast）。
export type VaultErrorCode =
  | "CONFLICT"
  | "NOT_UTF8"
  | "OUT_OF_VAULT"
  | "TOO_LARGE"
  | "EXISTS"
  | "LOCKED"
  | "NOT_FOUND"
  | "INVALID_NAME";

export type VaultSaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "conflict";

/// 渲染期由扁平 entries 现算出来的层级结构，不进 store。
export type VaultTreeNode = {
  entry: VaultEntry;
  children: VaultTreeNode[];
};
