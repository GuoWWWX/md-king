export function extractMarkdownTitle(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
}

export function sanitizeDocxFileName(title: string | undefined) {
  const fallback = title?.trim() || "untitled";
  return fallback.replace(/[\\/:*?\"<>|]/g, "-");
}

export function buildDocxOutputName(markdown: string) {
  return `${sanitizeDocxFileName(extractMarkdownTitle(markdown))}.docx`;
}

export function buildDocxOutputNameFromPath(path: string) {
  const name = path.split(/[\\/]/).pop() || "untitled.md";
  const withoutExtension = name.replace(/\.(md|markdown)$/i, "");
  return `${sanitizeDocxFileName(withoutExtension)}.docx`;
}

export function buildOutputPath(outputDir: string | undefined, outputName: string) {
  const dir = outputDir?.trim();
  if (!dir) return undefined;
  return `${dir.replace(/[\\/]+$/, "")}/${outputName}`;
}
