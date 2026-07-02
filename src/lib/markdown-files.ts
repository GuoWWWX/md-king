export const markdownFileAccept = ".md,.markdown,text/markdown";

export function isMarkdownFile(file: File) {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith(".md") || fileName.endsWith(".markdown");
}

export async function readMarkdownFile(file: File) {
  if (!isMarkdownFile(file)) {
    throw new Error(`不支持的文件类型：${file.name}`);
  }

  return {
    name: file.name,
    text: await file.text(),
  };
}
