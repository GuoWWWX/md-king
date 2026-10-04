import type MarkdownIt from "markdown-it";

export const markdownInlineHtmlTags = new Set([
  "a", "abbr", "b", "br", "cite", "code", "del", "details", "div", "em", "hr", "i", "img",
  "ins", "kbd", "mark", "p", "q", "ruby", "rp", "rt", "s", "samp", "small", "span", "strike",
  "strong", "sub", "summary", "sup", "time", "u", "var", "wbr", "pre", "blockquote",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th", "td", "caption",
]);

export const markdownInlineHtmlVoidTags = new Set(["br", "hr", "img", "wbr"]);

export type MarkdownInlineHtmlTag = {
  type: "tag";
  raw: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: Readonly<Record<string, string>>;
};

export type MarkdownInlineHtmlPart =
  | { type: "text"; value: string }
  | MarkdownInlineHtmlTag;

const htmlTagPattern = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)(?:\s+((?:"[^"]*"|'[^']*'|[^'"<>])*))?\s*(\/?)\s*>/g;
const htmlAttributePattern = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g;

function parseAttributes(source: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  htmlAttributePattern.lastIndex = 0;
  for (const match of source.matchAll(htmlAttributePattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  htmlAttributePattern.lastIndex = 0;
  return attributes;
}

export function parseMarkdownInlineHtmlTag(raw: string): MarkdownInlineHtmlTag | null {
  htmlTagPattern.lastIndex = 0;
  const match = htmlTagPattern.exec(raw);
  htmlTagPattern.lastIndex = 0;
  if (!match || match[0].length !== raw.length) return null;

  const name = match[2].toLowerCase();
  if (!markdownInlineHtmlTags.has(name)) return null;
  const closing = match[1] === "/";
  return {
    type: "tag",
    raw,
    name,
    closing,
    selfClosing: !closing && (match[4] === "/" || markdownInlineHtmlVoidTags.has(name)),
    attributes: closing ? {} : parseAttributes(match[3] ?? ""),
  };
}

/**
 * Tokenise the common HTML subset supported by Markdown preview. Unknown tags
 * remain text, so examples such as `<示例文本>` keep their original content.
 */
export function splitMarkdownInlineHtml(value: string): MarkdownInlineHtmlPart[] {
  const parts: MarkdownInlineHtmlPart[] = [];
  let cursor = 0;

  htmlTagPattern.lastIndex = 0;
  for (const match of value.matchAll(htmlTagPattern)) {
    const tag = parseMarkdownInlineHtmlTag(match[0]);
    if (!tag) continue;
    const from = match.index ?? cursor;
    if (from > cursor) parts.push({ type: "text", value: value.slice(cursor, from) });
    parts.push(tag);
    cursor = from + match[0].length;
  }
  htmlTagPattern.lastIndex = 0;

  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts;
}

export function markdownInlineHtmlTagRanges(value: string): Array<MarkdownInlineHtmlTag & { from: number; to: number }> {
  const ranges: Array<MarkdownInlineHtmlTag & { from: number; to: number }> = [];
  htmlTagPattern.lastIndex = 0;
  for (const match of value.matchAll(htmlTagPattern)) {
    const tag = parseMarkdownInlineHtmlTag(match[0]);
    if (!tag) continue;
    const from = match.index ?? 0;
    ranges.push({ ...tag, from, to: from + match[0].length });
  }
  htmlTagPattern.lastIndex = 0;
  return ranges;
}

/** Parse tags before text/entity decoding: escaped examples must stay literal. */
export function markdownInlineHtmlPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("html_inline", "markdown_common_html", (state, silent) => {
    if (state.src[state.pos] !== "<") return false;
    const match = state.src.slice(state.pos).match(/^<\/?[a-z][a-z0-9-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>/i);
    const tag = match && parseMarkdownInlineHtmlTag(match[0]);
    if (!tag) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = tag.raw;
    }
    state.pos += tag.raw.length;
    return true;
  });
}

/** The outermost complete HTML object; incomplete markup remains editable text. */
export function markdownHtmlObjectEnd(source: string, from: number): number | null {
  const tags = markdownInlineHtmlTagRanges(source.slice(from));
  const first = tags[0];
  if (!first || first.from !== 0) return null;
  if (first.selfClosing || first.name === "br") return from + first.to;
  if (first.closing) return null;
  let depth = 0;
  for (const tag of tags) {
    if (tag.name !== first.name || tag.selfClosing) continue;
    depth += tag.closing ? -1 : 1;
    if (depth === 0) return from + tag.to;
  }
  return null;
}
