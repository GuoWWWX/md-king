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
  const withoutExtension = name.replace(/\.(md|markdown|txt)$/i, "");
  return `${sanitizeDocxFileName(withoutExtension)}.docx`;
}

export function buildOutputPath(outputDir: string | undefined, outputName: string) {
  const dir = outputDir?.trim();
  if (!dir) return undefined;
  return `${dir.replace(/[\\/]+$/, "")}/${outputName}`;
}

export function actionableConversionWarnings(warnings: string[]) {
  return warnings.filter((warning) => /Pandoc：|失败|不存在|缺少|跳过|无法|取消/.test(warning));
}
