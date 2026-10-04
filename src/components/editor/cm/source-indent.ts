export const MARKDOWN_SOURCE_INDENT_SPACES = 4;
export const MARKDOWN_SOURCE_INDENT_MAX_LEVEL = 6;

export type MarkdownSourceListLine = {
  indentLength: number;
  level: number;
  markerFrom: number;
  markerTo: number;
  marker: string;
  ordered: boolean;
  order: number;
};

export function orderedListMarker(sourceMarker: string, value: number): string {
  const numeric = /^(?:\d{1,9})([.)])$/.exec(sourceMarker);
  return numeric ? `${Math.max(1, value)}${numeric[1]}` : sourceMarker;
}

export function splitMarkdownQuotePrefix(line: string): { prefix: string; content: string } {
  const match = line.match(/^[ \t]*(?:>[ \t]?)+/);
  return match
    ? { prefix: match[0], content: line.slice(match[0].length) }
    : { prefix: "", content: line };
}

export function markdownSourceIndentLength(line: string): number {
  const { content } = splitMarkdownQuotePrefix(line);
  const spaces = content.match(/^ +/)?.[0].length ?? 0;
  const levels = Math.min(MARKDOWN_SOURCE_INDENT_MAX_LEVEL, Math.floor(spaces / MARKDOWN_SOURCE_INDENT_SPACES));
  return levels * MARKDOWN_SOURCE_INDENT_SPACES;
}

export function markdownSourceIndentClass(line: string): string {
  const level = markdownSourceIndentLength(line) / MARKDOWN_SOURCE_INDENT_SPACES;
  return level > 0 ? `mk-cm-source-indent-${level}` : "";
}

export function parseMarkdownSourceListLine(line: string, allowUnindented = false): MarkdownSourceListLine | null {
  const { prefix, content } = splitMarkdownQuotePrefix(line);
  const spaces = content.match(/^ +/)?.[0].length ?? 0;
  const level = Math.min(MARKDOWN_SOURCE_INDENT_MAX_LEVEL, Math.floor(spaces / MARKDOWN_SOURCE_INDENT_SPACES));
  if (level === 0 && !allowUnindented) return null;

  const rest = content.slice(spaces);
  const unordered = /^[-+*](?=[ \t]+)/.exec(rest);
  const ordered = /^(?:(?:\d{1,9})|(?:[A-Za-z]))[.)](?=[ \t]+)/.exec(rest);
  const marker = unordered ?? ordered;
  if (!marker) return null;

  const markerFrom = prefix.length + spaces;
  return {
    indentLength: prefix.length + spaces,
    level,
    markerFrom,
    markerTo: markerFrom + marker[0].length,
    marker: marker[0],
    ordered: Boolean(ordered),
    order: ordered && /^\d/.test(ordered[0]) ? Number.parseInt(ordered[0], 10) : 0,
  };
}

export function sourceOrderedListValue(lines: readonly string[], lineIndex: number): number {
  const current = parseMarkdownSourceListLine(lines[lineIndex] ?? "", true);
  if (!current?.ordered || current.order === 0) return 1;

  let firstValue = current.order;
  let precedingItems = 0;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previous = parseMarkdownSourceListLine(lines[index], true);
    if (!previous || previous.level < current.level) break;
    if (previous.level > current.level) continue;
    if (!previous.ordered || previous.order === 0) break;
    firstValue = previous.order;
    precedingItems += 1;
  }
  return firstValue + precedingItems;
}
