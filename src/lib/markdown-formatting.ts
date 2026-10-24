import MarkdownIt from "markdown-it";
import { parseMarkdownTable } from "../components/editor/cm/markdown-table.ts";

export type TextAlignment = "left" | "center" | "right";
export type TextAttributes = { color?: string; align?: TextAlignment; underline?: boolean; signature?: boolean };
export type SignatureSettings = {
  signatureInheritText: boolean;
  signatureLineWidth: number; signatureLineColor: string; signatureLineThickness: number;
  signatureLabelAlign: TextAlignment; signatureValueAlign: TextAlignment;
  signatureValueColor: string; signatureRemarkColor: string;
  signatureRowSpacing: number; signatureKeepTogether: boolean; signatureWithPrevious: boolean;
};
export const defaultSignatureSettings: SignatureSettings = {
  signatureInheritText: true,
  signatureLineWidth: 4, signatureLineColor: "#000000", signatureLineThickness: 0.5,
  signatureLabelAlign: "right", signatureValueAlign: "left", signatureValueColor: "",
  signatureRemarkColor: "", signatureRowSpacing: 8, signatureKeepTogether: true, signatureWithPrevious: false,
};

export function parseTextAttributes(source: string): TextAttributes | null {
  const attrs: TextAttributes = {};
  const rest = source.replace(/\.(underline|signature)\b|\b(color|align)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g, (_, cls: string, key: string, a: string, b: string, c: string) => {
    const value = a ?? b ?? c;
    if (cls === "underline") attrs.underline = true;
    else if (cls === "signature") attrs.signature = true;
    else if (key === "color" && /^#[0-9a-f]{6}$/i.test(value)) attrs.color = value.toUpperCase();
    else if (key === "align" && /^(left|center|right)$/.test(value)) attrs.align = value as TextAlignment;
    else return "INVALID";
    return "";
  });
  return rest.trim() || !Object.keys(attrs).length ? null : attrs;
}

export function formattingSpanAt(source: string, from: number) {
  if (source[from] !== "[") return null;
  let slashes = 0;
  for (let i = from - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  if (slashes % 2) return null;
  let depth = 1;
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "`") {
      let end = i + 1;
      while (source[end] === "`") end++;
      const close = source.indexOf(source.slice(i, end), end);
      if (close >= 0) { i = close + end - i - 1; continue; }
    }
    if (source[i] === "[") depth++;
    if (source[i] !== "]" || --depth !== 0) continue;
    if (source[i + 1] !== "{") return null;
    const end = source.indexOf("}", i + 2);
    if (end < 0) return null;
    const attrs = parseTextAttributes(source.slice(i + 2, end));
    return attrs && !attrs.signature ? { from, to: end + 1, contentFrom: from + 1, contentTo: i, attrs } : null;
  }
  return null;
}

export function formattingCss(attrs: TextAttributes): string {
  return [attrs.color && `color:${attrs.color};--mk-explicit-color:${attrs.color}`, attrs.underline && "text-decoration-line:underline"].filter(Boolean).join(";");
}

export function paragraphFormatting(source: string): TextAttributes | null {
  const text = source.trim();
  const span = formattingSpanAt(text, 0);
  return span?.to === text.length ? span.attrs : null;
}

export function signatureRows(source: string): string[][] {
  const table = parseMarkdownTable(source.trim());
  return table?.rows[0]?.length === 3 ? table.rows.slice(1).map(row => [row[0] ?? "", row[1] ?? "", row[2] ?? ""]) : [];
}

export function signatureHtml(md: MarkdownIt, source: string, attrs: TextAttributes, settings = defaultSignatureSettings): string {
  const align = attrs.align ?? "left";
  const esc = md.utils.escapeHtml;
  const rows = signatureRows(source);
  if (!rows.length) return md.render(source);
  const labelLength = Math.max(1, ...rows.map(row => Array.from(row[0]).reduce((n, c) => n + (/[\u2e80-\uffff]/.test(c) ? 1 : 0.55), 0)));
  return `<div class="mk-signature" style="display:flex;justify-content:${align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start"}"><div style="max-width:100%;display:grid;grid-template-columns:minmax(0,${labelLength + 1}em) minmax(0,${settings.signatureLineWidth}cm) auto;gap:${settings.signatureRowSpacing}pt 0.4em;align-items:baseline">${rows.map(([label, value, note]) => {
    const line = /^_{4,}$/.test(value.trim());
    const colorAttrs = (color: string) => color ? `class="mk-explicit-color" style="color:${esc(color)};--mk-explicit-color:${esc(color)}"` : "";
    return `<div style="text-align:${settings.signatureLabelAlign}">${md.renderInline(label)}${/[：:]$/.test(label) ? "" : "："}</div><div style="min-width:0;text-align:${settings.signatureValueAlign};${line ? `border-bottom:${settings.signatureLineThickness}pt solid ${settings.signatureLineColor === "#000000" ? "currentColor" : esc(settings.signatureLineColor)};min-height:1.2em` : ""}"><span ${colorAttrs(settings.signatureValueColor)}>${line ? "&nbsp;" : md.renderInline(value)}</span></div><div><span ${colorAttrs(settings.signatureRemarkColor)}>${md.renderInline(note)}</span></div>`;
  }).join("")}</div></div>`;
}

export function markdownFormattingPlugin(md: MarkdownIt) {
  md.inline.ruler.before("link", "mk_format", (state, silent) => {
    const range = formattingSpanAt(state.src, state.pos);
    if (!range) return false;
    if (!silent) {
      const open = state.push("mk_format_open", "span", 1);
      open.meta = range.attrs;
      open.attrSet("style", formattingCss(range.attrs));
      if (range.attrs.color) open.attrSet("class", "mk-explicit-color");
      const children: typeof state.tokens = [];
      state.md.inline.parse(state.src.slice(range.contentFrom, range.contentTo), state.md, state.env, children);
      state.tokens.push(...children);
      state.push("mk_format_close", "span", -1);
    }
    state.pos = range.to;
    return true;
  });
  md.block.ruler.before("fence", "mk_format_block", (state, start, end, silent) => {
    const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
    const match = line(start).match(/^:::\s*\{([^}]*)\}\s*$/);
    const attrs = match && parseTextAttributes(match[1]);
    if (!attrs || (!attrs.align && !attrs.signature)) return false;
    let depth = 1, close = start + 1, fence = "";
    for (; close < end; close++) {
      const text = line(close);
      const code = text.match(/^(`{3,}|~{3,})/);
      if (code) { if (!fence) fence = code[1][0]; else if (code[1][0] === fence) fence = ""; continue; }
      if (fence) continue;
      if (/^:::\s*\{/.test(text)) depth++;
      if (/^:::\s*$/.test(text) && --depth === 0) break;
    }
    if (close === end) return false;
    if (silent) return true;
    if (attrs.signature) {
      const token = state.push("mk_signature", "div", 0);
      token.content = state.src.slice(state.bMarks[start + 1], state.bMarks[close]);
      token.meta = attrs; token.map = [start, close + 1]; token.block = true;
    } else {
      const token = state.push("mk_div_open", "div", 1); token.meta = attrs; token.map = [start, close + 1];
      token.attrSet("style", `text-align:${attrs.align}`);
      state.md.block.tokenize(state, start + 1, close);
      state.push("mk_div_close", "div", -1);
    }
    state.line = close + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.core.ruler.after("inline", "mk_paragraph_format", state => {
    const stack: TextAttributes[] = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === "mk_div_open") stack.push(token.meta);
      if (token.type === "mk_div_close") stack.pop();
      if (token.type !== "paragraph_open") continue;
      const attrs = paragraphFormatting(state.tokens[i + 1]?.content ?? "");
      const align = attrs?.align ?? stack[stack.length - 1]?.align;
      if (align) { token.attrSet("style", `text-align:${align}`); token.meta = { ...token.meta, align }; }
    }
  });
  md.renderer.rules.mk_signature = (tokens, i) => signatureHtml(md, tokens[i].content, tokens[i].meta);
}

const blockParser = new MarkdownIt().use(markdownFormattingPlugin);
export function formattingBlocks(source: string) {
  if (!source.includes(":::")) return [];
  return blockParser.parse(source, {}).filter(token => (token.type === "mk_signature" || token.type === "mk_div_open") && token.map)
    .map(token => ({ firstLine: token.map![0] + 1, lastLine: token.map![1], attrs: token.meta as TextAttributes, source: token.content }));
}
