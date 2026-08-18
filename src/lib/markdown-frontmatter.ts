export type MarkdownFrontmatter = {
  title?: string;
  author?: string;
  date?: string;
};

export type MarkdownFrontmatterValue = string | string[];

export type MarkdownFrontmatterEntry = {
  key: string;
  value: MarkdownFrontmatterValue;
  /** 该属性键所在源码行的起点。 */
  sourceFrom: number;
};

export type ParsedYamlFrontmatter = {
  /** YAML 区块的起点，包含开头的 `---`。 */
  from: number;
  /** 结束分隔线的末尾，不包含其后的换行。供编辑器判定光标是否在属性内。 */
  contentTo: number;
  /** YAML 区块的结束位置，包含结束分隔线后的换行。 */
  to: number;
  entries: MarkdownFrontmatterEntry[];
  markdown: string;
};

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseInlineYamlList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;

  const items: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];
    if ((char === "'" || char === '"') && (index === 1 || trimmed[index - 1] !== "\\")) {
      quote = quote === char ? undefined : quote ?? char;
      current += char;
      continue;
    }
    if (char === "," && quote === undefined) {
      const item = unquoteYamlValue(current);
      if (item) items.push(item);
      current = "";
      continue;
    }
    current += char;
  }
  const last = unquoteYamlValue(current);
  if (last) items.push(last);
  return items;
}

/**
 * 解析文首的常用 YAML Frontmatter。这里刻意只覆盖文档属性的常见写法：
 * `key: value`、`key: [a, b]` 和缩进的 `- item` 列表；复杂 YAML 仍保留原样。
 */
export function parseYamlFrontmatter(markdown: string): ParsedYamlFrontmatter | undefined {
  const bomLength = markdown.startsWith("\uFEFF") ? 1 : 0;
  const source = bomLength === 0 ? markdown : markdown.slice(bomLength);
  if (!source.startsWith("---") || !/^(?:---)\s*(?:\r?\n|$)/.test(source)) return undefined;

  const lines = source.split(/\r?\n/);
  const closingLine = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (closingLine < 0) return undefined;

  const lineStarts: number[] = [];
  let lineOffset = 0;
  for (const line of lines) {
    lineStarts.push(lineOffset);
    lineOffset += line.length;
    lineOffset += source.startsWith("\r\n", lineOffset) ? 2 : source[lineOffset] === "\n" ? 1 : 0;
  }

  const entries: MarkdownFrontmatterEntry[] = [];
  let listEntry: MarkdownFrontmatterEntry | undefined;
  for (let lineIndex = 1; lineIndex < closingLine; lineIndex += 1) {
    const line = lines[lineIndex];
    const property = line.match(/^\s*([^:\s][^:]*?)\s*:\s*(.*?)\s*$/);
    if (property) {
      const value = property[2];
      const inlineList = parseInlineYamlList(value);
      const entry: MarkdownFrontmatterEntry = {
        key: property[1],
        value: inlineList ?? (value ? unquoteYamlValue(value) : []),
        sourceFrom: bomLength + lineStarts[lineIndex],
      };
      entries.push(entry);
      listEntry = Array.isArray(entry.value) ? entry : undefined;
      continue;
    }

    const listItem = line.match(/^\s+-\s+(.*?)\s*$/);
    if (listItem && listEntry && Array.isArray(listEntry.value)) {
      const item = unquoteYamlValue(listItem[1]);
      if (item) listEntry.value.push(item);
      continue;
    }

    listEntry = undefined;
  }
  if (entries.length === 0) return undefined;

  let contentTo = 0;
  for (let index = 0; index <= closingLine; index += 1) {
    contentTo += lines[index].length;
    if (index < closingLine) contentTo += source.startsWith("\r\n", contentTo) ? 2 : 1;
  }
  const to = contentTo + (source.startsWith("\r\n", contentTo) ? 2 : source[contentTo] === "\n" ? 1 : 0);

  return {
    from: bomLength,
    contentTo: bomLength + contentTo,
    to: bomLength + to,
    entries,
    markdown: source.slice(to),
  };
}

export function splitYamlFrontmatter(markdown: string): { markdown: string; metadata?: MarkdownFrontmatter } {
  const frontmatter = parseYamlFrontmatter(markdown);
  if (!frontmatter) return { markdown };

  const metadata: MarkdownFrontmatter = {};
  for (const entry of frontmatter.entries) {
    const key = entry.key.toLowerCase();
    if (key !== "title" && key !== "author" && key !== "date") continue;
    const value = Array.isArray(entry.value) ? entry.value.join(", ") : entry.value;
    if (value) metadata[key] = value;
  }

  return {
    markdown: frontmatter.markdown,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
