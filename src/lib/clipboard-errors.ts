export function clipboardReadErrorMessage(error: unknown) {
  if (isPermissionError(error)) {
    return "无法读取剪贴板，请检查浏览器或系统剪贴板权限，或手动粘贴内容";
  }

  if (isAbortError(error)) {
    return "已取消读取剪贴板";
  }

  return "读取剪贴板失败，请手动粘贴内容";
}

export function clipboardWriteErrorMessage(error: unknown) {
  if (isPermissionError(error)) {
    return "无法写入剪贴板，请检查浏览器或系统剪贴板权限";
  }

  return "复制失败，请手动复制内容";
}

function isPermissionError(error: unknown) {
  const text = `${getErrorName(error)} ${getErrorMessage(error)}`.toLowerCase();
  return text.includes("notallowed") || text.includes("security") || text.includes("permission") || text.includes("denied");
}

function isAbortError(error: unknown) {
  const text = `${getErrorName(error)} ${getErrorMessage(error)}`.toLowerCase();
  return text.includes("abort") || text.includes("cancelled") || text.includes("canceled");
}

function getErrorName(error: unknown) {
  if (error instanceof Error) return error.name;
  if (typeof error === "object" && error && "name" in error && typeof error.name === "string") return error.name;
  return "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "";
}
