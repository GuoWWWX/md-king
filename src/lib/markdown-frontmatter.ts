export type MarkdownFrontmatter = {
  title?: string;
  author?: string;
  date?: string;
};

export function splitYamlFrontmatter(markdown: string): { markdown: string; metadata?: MarkdownFrontmatter } {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { markdown };

  const closingLine = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  const metadataLines = lines.slice(1, closingLine);
  if (closingLine < 0 || !metadataLines.some((line) => /^\s*[\w.-]+\s*:/.test(line))) return { markdown };

  const metadata: MarkdownFrontmatter = {};
  for (const line of metadataLines) {
    const match = line.match(/^\s*(title|author|date)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const value = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
    if (value) metadata[match[1].toLowerCase() as keyof MarkdownFrontmatter] = value;
  }

  return {
    markdown: lines.slice(closingLine + 1).join("\n"),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
