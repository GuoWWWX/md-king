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

export function markdownSourceIndentLength(line: string): number {
  const spaces = line.match(/^ +/)?.[0].length ?? 0;
  const levels = Math.min(MARKDOWN_SOURCE_INDENT_MAX_LEVEL, Math.floor(spaces / MARKDOWN_SOURCE_INDENT_SPACES));
  return levels * MARKDOWN_SOURCE_INDENT_SPACES;
}

export function markdownSourceIndentClass(line: string): string {
  const level = markdownSourceIndentLength(line) / MARKDOWN_SOURCE_INDENT_SPACES;
  return level > 0 ? `mk-cm-source-indent-${level}` : "";
}

export function parseMarkdownSourceListLine(line: string): MarkdownSourceListLine | null {
  const indentLength = markdownSourceIndentLength(line);
  if (indentLength === 0) return null;
  const rest = line.slice(indentLength);
  const unordered = /^[-+*](?=[ \t]+)/.exec(rest);
  const ordered = /^(?:(?:\d{1,9})|(?:[A-Za-z]+))[.)](?=[ \t]+)/.exec(rest);
  const marker = unordered ?? ordered;
  if (!marker) return null;
  return {
    indentLength,
    level: indentLength / MARKDOWN_SOURCE_INDENT_SPACES,
    markerFrom: indentLength,
    markerTo: indentLength + marker[0].length,
    marker: marker[0],
    ordered: Boolean(ordered),
    order: ordered && /^\d/.test(ordered[0]) ? Number.parseInt(ordered[0], 10) : 0,
  };
}

export function sourceOrderedListValue(lines: readonly string[], lineIndex: number): number {
  const current = parseMarkdownSourceListLine(lines[lineIndex] ?? "");
  if (!current?.ordered || current.order === 0) return 1;

  let firstValue = current.order;
  let precedingItems = 0;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previous = parseMarkdownSourceListLine(lines[index]);
    if (!previous || previous.level < current.level) break;
    if (previous.level > current.level) continue;
    if (!previous.ordered || previous.order === 0) break;
    firstValue = previous.order;
    precedingItems += 1;
  }
  return firstValue + precedingItems;
}
