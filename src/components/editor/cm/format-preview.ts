import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import MarkdownIt from "markdown-it";
import { formattingBlocks, formattingSpanAt, formattingCss, markdownFormattingPlugin, signatureHtml } from "../../../lib/markdown-formatting.ts";
import { syntaxTree } from "@codemirror/language";
import { markdownInlineHtmlPlugin } from "../../../lib/markdown-inline-html.ts";
import { obsidianWikilinkPlugin } from "../../../lib/obsidian-wikilinks.ts";
import { relaxedStrongPlugin } from "../../../lib/relaxed-strong.ts";
import { relaxedEmphasisPlugin } from "../../../lib/relaxed-emphasis.ts";

const parser = new MarkdownIt({ html: false, linkify: true }).use(markdownInlineHtmlPlugin).use(obsidianWikilinkPlugin).use(relaxedStrongPlugin).use(relaxedEmphasisPlugin).use(markdownFormattingPlugin);
class SignatureWidget extends WidgetType {
  constructor(readonly from: number, readonly html: string) { super(); }
  eq(other: SignatureWidget) { return other.from === this.from && other.html === this.html; }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "mk-signature-preview";
    dom.innerHTML = this.html;
    for (const anchor of dom.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      anchor.classList.add("mk-cm-link"); anchor.dataset.mkLinkTarget = anchor.getAttribute("href") ?? "";
    }
    dom.addEventListener("mousedown", e => {
      if (e.target instanceof Element && e.target.closest("a")) return;
      if (view.state.readOnly) return;
      e.preventDefault(); view.dispatch({ selection: { anchor: this.from + 1 } }); view.focus();
    });
    return dom;
  }
  ignoreEvent() { return false; }
}

function build(state: EditorState) {
  const source = state.doc.toString();
  if (!source.includes("]{") && !source.includes(":::")) return Decoration.none;
  const decos = [];
  const selected = (from: number, to: number) => !state.readOnly && state.selection.ranges.some(s => s.from <= to && s.to >= from);
  const blocks = formattingBlocks(source);
  const inSignature = (position: number) => blocks.some(b => b.attrs.signature && position >= state.doc.line(b.firstLine).from && position <= state.doc.line(b.lastLine).to);
  for (const block of blocks) {
    const from = state.doc.line(block.firstLine).from, to = state.doc.line(block.lastLine).to;
    if (block.attrs.signature) {
      if (!selected(from, to)) decos.push(Decoration.replace({ block: true, widget: new SignatureWidget(from, signatureHtml(parser, block.source, block.attrs)) }).range(from, to));
    } else {
      for (let n = block.firstLine + 1; n < block.lastLine; n++) decos.push(Decoration.line({ attributes: { style: `text-align:${block.attrs.align}` } }).range(state.doc.line(n).from));
      if (!selected(from, to)) {
        for (const n of [block.firstLine, block.lastLine]) { const l = state.doc.line(n); decos.push(Decoration.replace({}).range(l.from, l.to)); }
      }
    }
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "[" || inSignature(i)) continue;
    let node = syntaxTree(state).resolveInner(i, 1);
    let skip = false;
    while (node.parent) { if (/(Code|Table)/.test(node.name)) { skip = true; break; } node = node.parent; }
    if (skip) continue;
    const range = formattingSpanAt(source, i);
    if (!range) continue;
    const line = state.doc.lineAt(i);
    const prefix = source.slice(line.from, i).replace(/^\s*(?:>\s*)*/, "").replace(/^#{1,6}\s+/, "");
    const lastLine = state.doc.lineAt(range.to);
    if (range.attrs.align && !prefix.trim() && !source.slice(range.to, lastLine.to).trim()) {
      for (let n = line.number; n <= lastLine.number; n++) decos.push(Decoration.line({ attributes: { style: `text-align:${range.attrs.align}` } }).range(state.doc.line(n).from));
    }
    if (!selected(i, range.to)) {
      decos.push(Decoration.replace({}).range(i, range.contentFrom));
      decos.push(Decoration.replace({}).range(range.contentTo, range.to));
    }
    if (range.contentFrom < range.contentTo) decos.push(Decoration.mark({ class: range.attrs.color ? "mk-explicit-color" : "", attributes: { style: formattingCss(range.attrs) } }).range(range.contentFrom, range.contentTo));
  }
  return Decoration.set(decos, true);
}
export const formatPreviewExtension = StateField.define({
  create: build,
  update: (value, tr) => tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly ? build(tr.state) : value,
  provide: field => EditorView.decorations.from(field),
});
