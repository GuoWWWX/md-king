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
