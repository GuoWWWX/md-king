export function extractMarkdownTitle(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
}

export function sanitizeDocxFileName(title: string | undefined) {
  const fallback = title?.trim() || "未命名文档";
  return fallback.replace(/[\\/:*?\"<>|]/g, "-");
}

export function buildDocxOutputName(markdown: string) {
  return `${sanitizeDocxFileName(extractMarkdownTitle(markdown))}.docx`;
}

export function buildOutputPath(outputDir: string | undefined, outputName: string) {
  const dir = outputDir?.trim();
  if (!dir) return undefined;
  return `${dir.replace(/[\\/]+$/, "")}/${outputName}`;
}
