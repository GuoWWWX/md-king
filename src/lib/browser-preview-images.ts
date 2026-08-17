function decodedPath(path: string) {
  try {
    return decodeURI(path.trim());
  } catch {
    return path.trim();
  }
}

function normalizePath(path: string) {
  const parts = decodedPath(path).replace(/\\/g, "/").split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

function isDirectImageSource(path: string) {
  return /^(?:https?:|data:|blob:)/i.test(path);
}

function parentPath(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

const browserPreviewImages = new Map<string, string>();

/** 浏览器内存 vault 没有文件协议，用这张表把逻辑路径映射回剪贴板的 data URL。 */
export function registerBrowserPreviewImage(path: string, source: string) {
  browserPreviewImages.set(normalizePath(path), source);
}

/** 浏览器内存 vault 移动或重命名文件后，同步迁移图片预览路径。 */
export function remapBrowserPreviewImages(sourcePath: string, targetPath: string) {
  const source = normalizePath(sourcePath);
  const target = normalizePath(targetPath);
  if (!source || source === target) return;

  for (const [path, previewSource] of [...browserPreviewImages]) {
    if (path !== source && !path.startsWith(`${source}/`)) continue;
    browserPreviewImages.delete(path);
    browserPreviewImages.set(`${target}${path.slice(source.length)}`, previewSource);
  }
}

export function resolveBrowserPreviewImage(path: string, sourcePath?: string) {
  if (isDirectImageSource(path)) return path;

  const normalizedPath = normalizePath(path);
  const resolvedPath = sourcePath && !/^[a-z]:\//i.test(normalizedPath) && !path.startsWith("/")
    ? normalizePath(`${parentPath(sourcePath)}/${normalizedPath}`)
    : normalizedPath;
  return browserPreviewImages.get(resolvedPath) ?? browserPreviewImages.get(normalizedPath);
}
