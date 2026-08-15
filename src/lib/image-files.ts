export const supportedImageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] as const;

const mimeExtension: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export function imagePathExtension(path: string) {
  const clean = path.trim().split(/[?#]/, 1)[0];
  const match = /\.([a-z0-9]+)$/i.exec(clean);
  return match?.[1]?.toLowerCase();
}

export function isSupportedImagePath(path: string) {
  const extension = imagePathExtension(path);
  return extension !== undefined && supportedImageExtensions.includes(extension as typeof supportedImageExtensions[number]);
}

export function imageFileExtension(file: File) {
  const fromName = imagePathExtension(file.name);
  if (fromName && isSupportedImagePath(file.name)) return fromName;
  return mimeExtension[file.type.toLowerCase()] ?? "png";
}

function pathSegments(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

/** 从 Markdown 文件到 vault 内资源的相对路径，始终使用 `/` 以兼容 Markdown/Pandoc。 */
export function relativeMarkdownPath(markdownPath: string, targetPath: string) {
  const sourceDir = pathSegments(markdownPath).slice(0, -1);
  const target = pathSegments(targetPath);
  let common = 0;
  while (common < sourceDir.length && common < target.length && sourceDir[common] === target[common]) common += 1;
  const relative = [...sourceDir.slice(common).map(() => ".."), ...target.slice(common)];
  return relative.join("/") || target[target.length - 1] || "";
}

function markdownImageAlt(path: string) {
  const parts = pathSegments(path);
  const name = parts[parts.length - 1] ?? "图片";
  return name.replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "").trim() || "图片";
}

/** 自动插入的路径编码空格和括号，避免 Markdown 解析截断本地文件名。 */
export function markdownImageReference(markdownPath: string, imagePath: string) {
  const relativePath = relativeMarkdownPath(markdownPath, imagePath);
  const destination = encodeURI(relativePath).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `![${markdownImageAlt(imagePath)}](${destination})`;
}
