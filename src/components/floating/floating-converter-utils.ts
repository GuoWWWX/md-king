import { buildDocxOutputName, buildDocxOutputNameFromPath, sanitizeDocxFileName } from "../../lib/convert-utils.ts";

export function isFloatingMarkdownFile(name: string) {
  return /\.md$/i.test(name.trim());
}

export function floatingOutputName(inputPath: string | undefined, markdown: string) {
  return inputPath ? buildDocxOutputNameFromPath(inputPath) : buildDocxOutputName(markdown);
}

export function normalizeFloatingOutputName(value: string, fallback: string) {
  const rawName = value.trim().replace(/\.docx$/i, "") || fallback.trim().replace(/\.docx$/i, "") || "untitled";
  return `${sanitizeDocxFileName(rawName)}.docx`;
}

export function parentDirectory(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : undefined;
}
