import MarkdownIt from "markdown-it";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

type ReferenceEnvironment = { references?: Record<string, { href: string; title: string }> };
const parser = new MarkdownIt({ html: false });
// Selections and viewport updates reuse the same immutable document.
const references = new WeakMap<Text, ReferenceEnvironment>();

export function markdownLinkTarget(state: EditorState, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  let env: ReferenceEnvironment = {};
  if (!url || node.name === "LinkReference") {
    const cached = references.get(state.doc);
    if (cached) env = cached;
    else {
      parser.parse(state.doc.toString(), env);
      references.set(state.doc, env);
    }
  }
  if (node.name === "LinkReference") {
    const label = node.getChild("LinkLabel");
    return label ? env.references?.[parser.utils.normalizeReference(state.doc.sliceString(label.from + 1, label.to - 1))]?.href : undefined;
  }
  const token = parser.parseInline(state.doc.sliceString(node.from, node.to), env)[0]?.children?.[0];
  const target = token?.type === "link_open" ? token.attrGet("href")
    : token?.type === "image" ? token.attrGet("src") : undefined;
  // Keep source paths unchanged, but only after the Markdown parser accepts them.
  return target == null ? undefined : url ? state.doc.sliceString(url.from, url.to).trim() : target;
}
