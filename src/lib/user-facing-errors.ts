import type { VaultErrorCode } from "@/types/vault";

const VAULT_ERROR_CODES: readonly VaultErrorCode[] = [
  "CONFLICT",
  "NOT_UTF8",
  "OUT_OF_VAULT",
  "TOO_LARGE",
  "EXISTS",
  "LOCKED",
  "NOT_FOUND",
  "INVALID_NAME",
  "INVALID_QUERY",
];

/// Rust 侧 vault 错误统一为 "CODE|中文提示"。冲突要弹窗、非 UTF-8 要切只读模式，
/// 光靠一条 toast 分不出这些分支，所以要把 code 单独拆出来给调用方 switch。
export function parseVaultError(error: unknown, fallback = "操作失败"): { code?: VaultErrorCode; message: string } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const separatorIndex = raw.indexOf("|");

  if (separatorIndex > 0) {
    const candidate = raw.slice(0, separatorIndex).trim();
    const code = VAULT_ERROR_CODES.find((item) => item === candidate);
    if (code) {
      const message = raw.slice(separatorIndex + 1).trim();
      return { code, message: message || fallback };
    }
  }

  return { message: userFacingErrorMessage(error, fallback) };
}

export function userFacingErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = message.trim();

  if (!trimmed) return fallback;
  if (containsChinese(trimmed)) return trimmed;
  if (isPermissionError(error, trimmed)) return "权限不足，请检查系统或浏览器授权";
  if (isAbortError(error, trimmed)) return "操作已取消";
  if (trimmed.toLowerCase().includes("failed to fetch")) return "网络请求失败，请检查连接后重试";

  return fallback;
}

function containsChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function isPermissionError(error: unknown, message: string) {
  const name = error instanceof Error ? error.name : "";
  const lower = message.toLowerCase();
  return name === "NotAllowedError" || name === "SecurityError" || lower.includes("permission") || lower.includes("denied");
}

function isAbortError(error: unknown, message: string) {
  const name = error instanceof Error ? error.name : "";
  const lower = message.toLowerCase();
  return name === "AbortError" || lower.includes("aborted") || lower.includes("cancelled") || lower.includes("canceled");
}
