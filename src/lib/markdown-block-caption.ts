import { markdownCaptionText } from "./mermaid-fence.ts";

const tableRow = /^\s*\|?.*\|.*\|?\s*$/;
const tableDelimiter = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const fenceStart = /^\s*(`{3,}|~{3,})/;

/**
 * markdown-it 会把无空行跟在表格后的普通文本继续当成表格行。先把紧邻表格的
 * 加粗题注移动到表格前，并转成内部兼容指令，避免预览阶段丢失题注。
 */
export function normalizeAdjacentBoldTableCaptions(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const tables: Array<{ start: number; end: number }> = [];
  let activeFence: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(fenceStart)?.[1];
    if (marker) {
      if (!activeFence) activeFence = marker;
      else if (marker[0] === activeFence[0] && marker.length >= activeFence.length) activeFence = undefined;
      continue;
    }
    if (activeFence || index + 1 >= lines.length || !tableRow.test(lines[index]) || !tableDelimiter.test(lines[index + 1])) continue;

    const start = index;
    index += 2;
    while (index < lines.length && tableRow.test(lines[index])) index += 1;
    tables.push({ start, end: index - 1 });
    index -= 1;
  }

  const consumed = new Set<number>();
  const insertBefore = new Map<number, string>();
  for (const table of tables) {
    const candidates = [table.end + 1, table.start - 1];
    const captionLine = candidates.find((line) => line >= 0
      && line < lines.length
      && !consumed.has(line)
      && Boolean(markdownCaptionText(lines[line])));
    if (captionLine === undefined) continue;
    const caption = markdownCaptionText(lines[captionLine]);
    if (!caption) continue;
    consumed.add(captionLine);
    insertBefore.set(table.start, caption);
  }

  const output: string[] = [];
  lines.forEach((line, index) => {
    const caption = insertBefore.get(index);
    if (caption) output.push(`**${caption}**`);
    if (!consumed.has(index)) output.push(line);
  });
  return output.join("\n");
}
