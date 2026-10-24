import { t } from "./i18n.ts";
import { documentLinkFragment, nextMarkdownHeadingAnchor } from "./document-links.ts";
import { parseMarkdownOutline } from "./document-outline.ts";

export type ReferenceRange = { from: number; to: number; startLine: number; endLine: number; title: string; kind: "file" | "heading" | "paragraph" | "lines" };
export type ReferenceDocument = { path: string; absolutePath?: string; content: string; eol?: "lf" | "crlf"; hasBom?: boolean; modifiedMs?: number };
export type ReferencePreview = ReferenceDocument & { range: ReferenceRange };

function sourceLines(source: string) {
  let from = 0, fence = "";
  return source.split("\n").map(raw => {
    const text = raw.replace(/\r$/, "");
    const mark = text.match(/^\s*(?:>\s*)*(`{3,}|~{3,})/)?.[1];
    const code = Boolean(fence || mark);
    if (mark && !fence) fence = mark;
    else if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = "";
    const line = { from, to: from + text.length, text, code };
    from += raw.length + 1;
    return line;
  });
}

/** Only our anchors and explicit paragraph IDs are hidden; fenced code is untouched. */
export function referenceMetadata(source: string): Array<{ from: number; to: number }> {
  return sourceLines(source).flatMap(line => {
    if (line.code) return [];
    const ranges = [...line.text.matchAll(/<!--md-king:range [a-zA-Z0-9-]+:(?:start|end)-->/g)]
      .map(match => ({ from: line.from + match.index!, to: line.from + match.index! + match[0].length }));
    const block = line.text.match(/(?:^|[ \t])\^[a-zA-Z0-9-]+[ \t]*$/);
    if (block) ranges.push({ from: line.from + block.index!, to: line.to });
    return ranges;
  });
}

export function stripReferenceMetadata(source: string) {
  let output = source;
  for (const range of referenceMetadata(source).reverse()) output = output.slice(0, range.from) + output.slice(range.to);
  return output;
}

export function referenceLineLabel(range: Pick<ReferenceRange, "startLine" | "endLine">) {
  return range.startLine === range.endLine ? `line ${range.startLine}` : `line ${range.startLine}-${range.endLine}`;
}

function paragraphText(text: string) { return text.replace(/^\s*(?:>\s*)+/, ""); }

export function resolveDocumentReference(source: string, target: string): ReferenceRange | undefined {
  const lines = sourceLines(source);
  const make = (first: number, last: number, kind: ReferenceRange["kind"], title: string, from = lines[first]?.from, to = lines[last]?.to): ReferenceRange | undefined => {
    if (from === undefined || to === undefined || to < from) return undefined;
    return { from, to, startLine: first + 1, endLine: last + 1, kind, title };
  };
  const raw = documentLinkFragment(target);
  if (!raw) return make(0, lines.length - 1, "file", t("全文"));
  let fragment: string;
  try { fragment = decodeURIComponent(raw.slice(1)); } catch { return undefined; }
  const numbered = fragment.match(/^L([1-9]\d*)(?:-L?([1-9]\d*))?$/i);
  if (numbered) {
    const first = Number(numbered[1]) - 1, last = Number(numbered[2] ?? numbered[1]) - 1;
    if (last < first || last >= lines.length) return undefined;
    return make(first, last, "lines", t("行范围"));
  }
  if (fragment.startsWith("^")) {
    const id = fragment.slice(1);
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return undefined;
    const start = `<!--md-king:range ${id}:start-->`, end = `<!--md-king:range ${id}:end-->`;
    const starts = lines.flatMap((line, index) => line.code ? [] : [...line.text.matchAll(new RegExp(start, "g"))].map(match => ({ index, position: line.from + match.index! })));
    const ends = lines.flatMap((line, index) => line.code ? [] : [...line.text.matchAll(new RegExp(end, "g"))].map(match => ({ index, position: line.from + match.index! })));
    if (starts.length || ends.length) {
      if (starts.length !== 1 || ends.length !== 1 || starts[0].position + start.length > ends[0].position) return undefined;
      const from = lines[starts[0].index].from;
      const to = starts[0].index === ends[0].index ? starts[0].position : ends[0].position;
      if (!stripReferenceMetadata(source.slice(from, to)).trim()) return undefined;
      return make(starts[0].index, ends[0].index, "lines", t("行范围"), from, to);
    }
    const matches = lines.map((line, index) => !line.code && new RegExp(`(?:^|[ \\t])\\^${id}[ \\t]*$`).test(line.text) ? index : -1).filter(index => index >= 0);
    if (matches.length !== 1) return undefined;
    let last = matches[0];
    const marker = lines[last].text.match(new RegExp(`(?:^|[ \\t])\\^${id}[ \\t]*$`))!;
    let to = lines[last].from + marker.index!;
    if (!paragraphText(lines[last].text.slice(0, marker.index)).trim()) {
      if (last === 0) return undefined;
      while (last > 0 && !paragraphText(lines[--last].text).trim()) { /* skip the separator before a standalone ID */ }
      if (!paragraphText(lines[last].text).trim() || lines[last].code) return undefined;
      to = lines[last].to;
    }
    let first = last;
    const beginsBlock = (text: string) => /^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(text);
    while (first > 0 && paragraphText(lines[first - 1].text).trim() && !lines[first - 1].code && !/^\s*#{1,6}\s/.test(paragraphText(lines[first - 1].text)) && !beginsBlock(paragraphText(lines[first].text))) first--;
    return make(first, last, "paragraph", t("段落"), lines[first].from, to);
  }
  const headings = parseMarkdownOutline(stripReferenceMetadata(source));
  // Strip metadata without changing offsets when locating source headings.
  const originalHeadings = headings;
  const counts = new Map<string, number>();
  const index = headings.findIndex(heading => nextMarkdownHeadingAnchor(heading.text, counts) === fragment
    || heading.text.normalize("NFKC") === fragment.normalize("NFKC"));
  if (index < 0 || !originalHeadings[index]) return undefined;
  const heading = originalHeadings[index];
  let last = lines.length - 1;
  for (const next of originalHeadings.slice(index + 1)) {
    if (next.level <= heading.level) { last = next.line - 2; break; }
  }
  while (last > heading.line - 1 && !lines[last].text.trim()) last--;
  return make(heading.line - 1, last, "heading", headings[index].text);
}

export function referencePathCandidates(target: string, currentPath: string): string[] {
  let path: string;
  try { path = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]); } catch { return []; }
  if (!path || /^(?:[a-z]+:|[a-z]:[\\/]|\\\\)/i.test(path)) return [];
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return undefined; parts.pop(); }
      else parts.push(part);
    }
    return parts.join("/") || undefined;
  };
  const parent = currentPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const relative = normalize(path.startsWith("/") ? path : `${parent}/${path}`);
  const root = !path.startsWith(".") ? normalize(path) : undefined;
  return [...new Set([relative, root].filter((path): path is string => Boolean(path)).flatMap(path => /\.(?:md|markdown|txt)$/i.test(path) ? [path] : /\.[^/]+$/.test(path) ? [] : [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]))];
}

export function createDocumentReference(source: string, from: number, to: number, kind: "heading" | "paragraph" | "lines", path?: string, id = `ref-${crypto.randomUUID()}`) {
  const lines = sourceLines(source);
  const lineAt = (position: number) => {
    let index = 0;
    for (let current = 0; current < lines.length && lines[current].from <= position; current++) index = current;
    return index;
  };
  let first = lineAt(from), last = lineAt(to > from ? to - 1 : to);
  const file = path ? `/${path.replace(/\\/g, "/").replace(/^\/+/, "")}` : "";
  if (kind === "heading") {
    const headings = parseMarkdownOutline(source);
    const eligible = headings.filter(heading => heading.line <= first + 1);
    const heading = eligible[eligible.length - 1];
    if (!heading) throw new Error(t("当前位置之前没有章节标题"));
    const counts = new Map<string, number>();
    let anchor = "";
    for (const entry of headings) { anchor = nextMarkdownHeadingAnchor(entry.text, counts); if (entry === heading) break; }
    return { reference: `[[${file}#${anchor}|${heading.text.replace(/\|/g, "")}]]`, changes: [] as Array<{ from: number; to: number; insert: string }> };
  }
  if (lines.slice(first, last + 1).some(line => line.code) || [lines[first], lines[last]].some(line => /^\s*(?:\||!\[|\$\$|---\s*$|===\s*$)/.test(line.text))) {
    // Comments inside fenced code would alter the code itself. Use explicit source line coordinates.
    return { reference: `[[${file}#L${first + 1}${last > first ? `-L${last + 1}` : ""}|${referenceLineLabel({ startLine: first + 1, endLine: last + 1 })}]]`, changes: [] };
  }
  if (kind === "paragraph") {
    while (first > 0 && paragraphText(lines[first - 1].text).trim() && !lines[first - 1].code && !/^\s*#{1,6}\s/.test(paragraphText(lines[first - 1].text)) && !/^\s*(?:#{1,6}|[-+*]|\d+[.)])\s/.test(paragraphText(lines[first].text))) first--;
    while (last + 1 < lines.length && paragraphText(lines[last + 1].text).trim() && !lines[last + 1].code && !/^\s*(?:#{1,6}|[-+*]|\d+[.)])\s/.test(paragraphText(lines[last + 1].text))) last++;
    if (!source.slice(lines[first].from, lines[last].to).trim()) throw new Error(t("请先选中需要引用的段落"));
    const existing = lines[last].text.match(/[ \t]\^([a-zA-Z0-9-]+)[ \t]*$/)?.[1];
    const blockId = existing ?? id;
    return { reference: `[[${file}#^${blockId}|段落引用]]`, changes: existing ? [] : [{ from: lines[last].to, to: lines[last].to, insert: ` ^${blockId}` }] };
  }
  return {
    reference: `[[${file}#^${id}|@line]]`,
    changes: [
      { from: lines[first].to, to: lines[first].to, insert: `<!--md-king:range ${id}:start-->` },
      { from: lines[last].to, to: lines[last].to, insert: `<!--md-king:range ${id}:end-->` },
    ],
  };
}
