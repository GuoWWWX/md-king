export const markdownFileAccept = ".md,.markdown,.txt,text/markdown,text/plain";
const supportedTextExtensionPattern = /\.(?:md|markdown|txt)$/i;

export function stripSupportedTextExtension(name: string) {
  return name.replace(supportedTextExtensionPattern, "");
}

export function preserveSupportedTextExtension(originalName: string, nextBaseName: string) {
  const extension = originalName.match(supportedTextExtensionPattern)?.[0] ?? "";
  return `${stripSupportedTextExtension(nextBaseName)}${extension}`;
}

export function isSupportedTextFile(file: File) {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith(".md") || fileName.endsWith(".markdown") || fileName.endsWith(".txt");
}

export async function readMarkdownFile(file: File) {
  if (!isSupportedTextFile(file)) {
    throw new Error(`不支持的文件类型：${file.name}`);
  }

  return {
    name: file.name,
    text: await file.text(),
  };
}
