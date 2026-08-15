import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { normalizeBareExternalLink } from "../../../lib/document-links.ts";
import { obsidianWikilinkPlugin } from "../../../lib/obsidian-wikilinks.ts";

export type TableInlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "break" }
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "element"; tag: "strong" | "em" | "s" | "a"; href?: string; title?: string; children: TableInlineNode[] };

const parser = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(obsidianWikilinkPlugin);

type PendingInlineElement = {
  tag: "strong" | "em" | "s" | "a";
  href?: string;
  title?: string;
  children: TableInlineNode[];
  autoLink?: boolean;
  trailingText?: string;
};

function appendText(target: TableInlineNode[], value: string) {
  if (!value) return;
  const previous = target[target.length - 1];
  if (previous?.type === "text") previous.value += value;
  else target.push({ type: "text", value });
}

export function parseTableInlineMarkdown(source: string): TableInlineNode[] {
  const children = parser.parseInline(source, {})[0]?.children ?? [];
  const root: TableInlineNode[] = [];
  const stack: PendingInlineElement[] = [];
  const target = () => stack[stack.length - 1]?.children ?? root;

  for (const token of children) {
    if (token.type === "text") {
      const active = stack[stack.length - 1];
      if (active?.tag === "a" && active.autoLink && active.href && /^https?:\/\//i.test(token.content)) {
        const href = normalizeBareExternalLink(token.content);
        active.href = href;
        appendText(target(), href);
        if (href.length < token.content.length) active.trailingText = token.content.slice(href.length);
        continue;
      }
      appendText(target(), token.content);
      continue;
    }
    if (token.type === "code_inline") {
      target().push({ type: "code", value: token.content });
      continue;
    }
    if (token.type === "softbreak" || token.type === "hardbreak") {
      target().push({ type: "break" });
      continue;
    }
    const openingTag = openingElement(token);
    if (openingTag) {
      stack.push({ ...openingTag, children: [] });
      continue;
    }
    const closeTag = closingTag(token);
    if (closeTag && stack[stack.length - 1]?.tag === closeTag) {
      const element = stack.pop();
      if (element) {
        const { autoLink: _autoLink, trailingText, ...node } = element;
        target().push({ type: "element", ...node });
        if (trailingText) appendText(target(), trailingText);
      }
      continue;
    }
    if (token.type === "image") {
      const src = token.attrGet("src") ?? "";
      const title = token.attrGet("title") ?? undefined;
      if (src && parser.validateLink(src)) {
        target().push({ type: "image", src, alt: token.content, ...(title ? { title } : {}) });
      }
      else appendText(target(), token.content);
      continue;
    }
    appendText(target(), token.content);
  }

  while (stack.length > 0) {
    const element = stack.pop();
    if (element) {
      const { autoLink: _autoLink, trailingText, ...node } = element;
      target().push({ type: "element", ...node });
      if (trailingText) appendText(target(), trailingText);
    }
  }
  return root;
}

function openingElement(token: Token): { tag: "strong" | "em" | "s" | "a"; href?: string; title?: string; autoLink?: boolean } | null {
  if (token.type === "strong_open") return { tag: "strong" };
  if (token.type === "em_open") return { tag: "em" };
  if (token.type === "s_open") return { tag: "s" };
  if (token.type === "link_open") {
    const href = token.attrGet("href") ?? "";
    const title = token.attrGet("title") ?? undefined;
    return parser.validateLink(href) ? { tag: "a", href, ...(title ? { title } : {}), ...(token.markup === "linkify" ? { autoLink: true } : {}) } : null;
  }
  return null;
}

function closingTag(token: Token): "strong" | "em" | "s" | "a" | null {
  if (token.type === "strong_close") return "strong";
  if (token.type === "em_close") return "em";
  if (token.type === "s_close") return "s";
  if (token.type === "link_close") return "a";
  return null;
}

function appendNodes(parent: HTMLElement, nodes: readonly TableInlineNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.append(document.createTextNode(node.value));
    } else if (node.type === "code") {
      const code = document.createElement("code");
      code.textContent = node.value;
      parent.append(code);
    } else if (node.type === "break") {
      parent.append(document.createElement("br"));
    } else if (node.type === "image") {
      const image = document.createElement("img");
      image.src = node.src;
      image.alt = node.alt;
      image.loading = "lazy";
      if (node.title) image.title = node.title;
      parent.append(image);
    } else {
      const element = document.createElement(node.tag);
      if (node.tag === "a" && node.href) {
        element.setAttribute("href", node.href);
        element.setAttribute("rel", "noreferrer");
        element.dataset.mkLinkTarget = node.href;
        if (node.title) element.setAttribute("title", node.title);
        element.addEventListener("click", (event) => event.preventDefault());
      }
      appendNodes(element, node.children);
      parent.append(element);
    }
  }
}

export function renderTableInlineMarkdown(source: string): HTMLElement {
  const content = document.createElement("div");
  content.className = "mk-cm-table-cell-content";
  appendNodes(content, parseTableInlineMarkdown(source));
  if (!content.hasChildNodes()) content.append(document.createElement("br"));
  return content;
}
