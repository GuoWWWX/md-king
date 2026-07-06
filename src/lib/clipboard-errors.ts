export function clipboardReadErrorMessage(error: unknown) {
  if (isPermissionError(error)) {
    return "无法读取剪贴板，请检查浏览器或系统剪贴板权限";
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
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return error.name === "NotAllowedError" || message.includes("permission") || message.includes("denied");
}
