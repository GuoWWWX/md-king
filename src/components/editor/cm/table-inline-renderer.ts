import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import katex from "katex";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileText, Globe2 } from "lucide-react";
import {
  isExternalDocumentLink,
  isMarkdownWikilinkTarget,
  normalizeBareExternalLink,
} from "../../../lib/document-links.ts";
import { obsidianWikilinkPlugin } from "../../../lib/obsidian-wikilinks.ts";
import { findInlineMarkdownMath, normalizeMathSource } from "../../../lib/markdown-math.ts";
import { relaxedStrongPlugin } from "../../../lib/relaxed-strong.ts";
import { relaxedEmphasisPlugin } from "../../../lib/relaxed-emphasis.ts";
import { markdownInlineHtmlPlugin, splitMarkdownInlineHtml, type MarkdownInlineHtmlTag } from "../../../lib/markdown-inline-html.ts";

type TableInlineElementTag =
  | "strong" | "em" | "s" | "u" | "mark" | "sub" | "sup" | "small" | "kbd" | "code"
  | "span" | "abbr" | "q" | "cite" | "var" | "samp" | "time" | "ruby" | "rt" | "rp"
  | "a" | "div" | "p" | "details" | "summary" | "pre" | "blockquote"
  | "ul" | "ol" | "li" | "dl" | "dt" | "dd" | "table" | "thead" | "tbody" | "tr" | "th" | "td" | "caption";

export type TableInlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "math"; value: string; source: string }
  | { type: "break" }
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "void"; tag: "hr" | "wbr" }
  | {
    type: "element";
    tag: TableInlineElementTag;
    href?: string;
    title?: string;
    wikilinkTarget?: string;
    open?: boolean;
    dateTime?: string;
    children: TableInlineNode[];
  };

function tableInlineMathPlugin(md: MarkdownIt) {
  md.inline.ruler.before("escape", "table_math_inline", (state, silent) => {
    const start = state.pos;
    const possibleOpener = state.src[start] === "$"
      || (state.src[start] === "\\" && state.src[start + 1] === "(");
    if (!possibleOpener) return false;

    const [range] = findInlineMarkdownMath(state.src.slice(start));
    if (!range || range.from !== 0) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(start + range.contentFrom, start + range.contentTo);
      token.markup = state.src.slice(start, start + range.contentFrom);
      token.meta = { source: state.src.slice(start, start + range.to) };
    }
    state.pos = start + range.to;
    return true;
  });
}

const parser = new MarkdownIt({ html: false, linkify: true, typographer: false })
  .use(markdownInlineHtmlPlugin)
  .use(tableInlineMathPlugin)
  .use(obsidianWikilinkPlugin)
  .use(relaxedStrongPlugin)
  .use(relaxedEmphasisPlugin);

type PendingInlineElement = {
  tag: TableInlineElementTag;
  sourceTag?: string;
  href?: string;
  title?: string;
  wikilinkTarget?: string;
  open?: boolean;
  dateTime?: string;
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
    if (token.type === "text" || token.type === "html_inline") {
      const parts = token.type === "html_inline" ? splitMarkdownInlineHtml(token.content) : [{ type: "text" as const, value: token.content }];
      for (const part of parts) {
        if (part.type === "tag") {
          if (part.name === "br") {
            target().push({ type: "break" });
            continue;
          }
          if (part.name === "hr" || part.name === "wbr") {
            target().push({ type: "void", tag: part.name });
            continue;
          }
          if (part.name === "img" && !part.closing) {
            const src = part.attributes.src ?? "";
            if (src && parser.validateLink(src)) {
              const title = part.attributes.title || undefined;
              target().push({ type: "image", src, alt: part.attributes.alt ?? "", ...(title ? { title } : {}) });
            } else {
              appendText(target(), part.raw);
            }
            continue;
          }
          const element = htmlInlineElement(part);
          if (!element) {
            appendText(target(), part.raw);
            continue;
          }
          if (!part.closing) {
            stack.push({ ...element, sourceTag: part.name, children: [] });
            continue;
          }
          const active = stack[stack.length - 1];
          if (active?.sourceTag !== part.name) {
            appendText(target(), part.raw);
            continue;
          }
          const closed = stack.pop();
          if (closed) {
            const { autoLink: _autoLink, trailingText, sourceTag: _sourceTag, ...node } = closed;
            target().push({ type: "element", ...node });
            if (trailingText) appendText(target(), trailingText);
          }
          continue;
        }
        const active = stack[stack.length - 1];
        if (active?.tag === "a" && active.autoLink && active.href && /^https?:\/\//i.test(part.value)) {
          const href = normalizeBareExternalLink(part.value);
          active.href = href;
          appendText(target(), href);
          if (href.length < part.value.length) active.trailingText = part.value.slice(href.length);
          continue;
        }
        appendText(target(), part.value);
      }
      continue;
    }
    if (token.type === "code_inline") {
      target().push({ type: "code", value: token.content });
      continue;
    }
    if (token.type === "math_inline") {
      const source = typeof token.meta?.source === "string" ? token.meta.source : `$${token.content}$`;
      target().push({ type: "math", value: token.content, source });
      continue;
    }
    if (token.type === "softbreak" || token.type === "hardbreak") {
      target().push({ type: "break" });
      continue;
    }
    const openingTag = openingElement(token);
    if (openingTag) {
      stack.push({ ...openingTag, sourceTag: openingTag.tag, children: [] });
      continue;
    }
    const closeTag = closingTag(token);
    if (closeTag && stack[stack.length - 1]?.tag === closeTag) {
      const element = stack.pop();
      if (element) {
        const { autoLink: _autoLink, trailingText, sourceTag: _sourceTag, ...node } = element;
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
      const { autoLink: _autoLink, trailingText, sourceTag: _sourceTag, ...node } = element;
      target().push({ type: "element", ...node });
      if (trailingText) appendText(target(), trailingText);
    }
  }
  return root;
}

function canonicalHtmlElementTag(name: string): TableInlineElementTag | null {
  if (name === "b") return "strong";
  if (name === "i") return "em";
  if (name === "del" || name === "strike") return "s";
  if (name === "ins") return "u";
  if (name === "strong" || name === "em" || name === "s" || name === "u" || name === "mark"
    || name === "sub" || name === "sup" || name === "small" || name === "kbd" || name === "code"
    || name === "span" || name === "abbr" || name === "q" || name === "cite" || name === "var"
    || name === "samp" || name === "time" || name === "ruby" || name === "rt" || name === "rp"
    || name === "a" || name === "div" || name === "p" || name === "details" || name === "summary"
    || name === "pre" || name === "blockquote" || name === "ul" || name === "ol" || name === "li"
    || name === "dl" || name === "dt" || name === "dd" || name === "table" || name === "thead"
    || name === "tbody" || name === "tr" || name === "th" || name === "td" || name === "caption") return name;
  return null;
}

function htmlInlineElement(tag: MarkdownInlineHtmlTag): Omit<PendingInlineElement, "children" | "sourceTag"> | null {
  const elementTag = canonicalHtmlElementTag(tag.name);
  if (!elementTag) return null;
  const title = tag.attributes.title || undefined;
  if (elementTag === "a") {
    const href = tag.attributes.href ?? "";
    if (href && !parser.validateLink(href)) return null;
    return { tag: elementTag, ...(href ? { href } : {}), ...(title ? { title } : {}) };
  }
  return {
    tag: elementTag,
    ...(title ? { title } : {}),
    ...(elementTag === "details" && Object.prototype.hasOwnProperty.call(tag.attributes, "open") ? { open: true } : {}),
    ...(elementTag === "time" && tag.attributes.datetime ? { dateTime: tag.attributes.datetime } : {}),
  };
}

function openingElement(token: Token): {
  tag: TableInlineElementTag;
  href?: string;
  title?: string;
  wikilinkTarget?: string;
  autoLink?: boolean;
} | null {
  if (token.type === "strong_open") return { tag: "strong" };
  if (token.type === "em_open") return { tag: "em" };
  if (token.type === "s_open") return { tag: "s" };
  if (token.type === "link_open") {
    const href = token.attrGet("href") ?? "";
    const title = token.attrGet("title") ?? undefined;
    const wikilinkTarget = typeof token.meta?.mkWikilinkTarget === "string"
      ? token.meta.mkWikilinkTarget
      : undefined;
    return parser.validateLink(href)
      ? {
          tag: "a",
          href,
          ...(title ? { title } : {}),
          ...(wikilinkTarget ? { wikilinkTarget } : {}),
          ...(token.markup === "linkify" ? { autoLink: true } : {}),
        }
      : null;
  }
  return null;
}

function closingTag(token: Token): TableInlineElementTag | null {
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
    } else if (node.type === "math") {
      const math = document.createElement("span");
      math.className = "mk-cm-math-inline mk-cm-table-math-inline";
      math.setAttribute("aria-label", node.value);
      try {
        math.innerHTML = katex.renderToString(normalizeMathSource(node.value), {
          displayMode: false,
          throwOnError: true,
          output: "html",
          strict: false,
        });
      } catch {
        math.classList.add("is-invalid");
        math.textContent = node.source;
      }
      parent.append(math);
    } else if (node.type === "break") {
      parent.append(document.createElement("br"));
    } else if (node.type === "image") {
      const image = document.createElement("img");
      image.src = node.src;
      image.alt = node.alt;
      image.loading = "lazy";
      if (node.title) image.title = node.title;
      parent.append(image);
    } else if (node.type === "void") {
      parent.append(document.createElement(node.tag));
    } else if (node.tag === "a" && node.wikilinkTarget) {
      const target = node.wikilinkTarget;
      const kind = isExternalDocumentLink(target) ? "external" : "document";
      const invalid = kind === "document" && !isMarkdownWikilinkTarget(target);
      const link = document.createElement("span");
      link.className = `mk-cm-link mk-cm-link--${kind} mk-cm-link--wikilink${invalid ? " mk-cm-link--invalid" : ""}`;
      link.dataset.mkLinkTarget = target;
      if (invalid) link.dataset.mkWikilinkInvalid = "true";
      link.setAttribute("role", "link");
      link.setAttribute("aria-label", invalid ? `非 Markdown 文件：${target}` : `打开文档：${target}`);
      link.title = invalid ? "仅支持 Markdown 文档" : target;

      const icon = document.createElement("span");
      icon.className = `mk-cm-link-icon mk-cm-link-icon--${kind}${invalid ? " mk-cm-link-icon--invalid" : ""}`;
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = renderToStaticMarkup(createElement(kind === "external" ? Globe2 : FileText, { size: 14, strokeWidth: 2 }));
      link.append(icon);
      appendNodes(link, node.children);
      parent.append(link);
    } else {
      const element = document.createElement(node.tag);
      if (node.title) element.setAttribute("title", node.title);
      if (node.tag === "a" && node.href) {
        element.setAttribute("href", node.href);
        element.setAttribute("rel", "noreferrer");
        element.dataset.mkLinkTarget = node.href;
        element.addEventListener("click", (event) => event.preventDefault());
      }
      if (node.tag === "details" && node.open) element.setAttribute("open", "");
      if (node.tag === "time" && node.dateTime) element.setAttribute("datetime", node.dateTime);
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

/** Same HTML/Markdown rendering for body widgets and table cells. */
export function renderMarkdownHtml(source: string, block: boolean): HTMLElement {
  const content = document.createElement(block ? "div" : "span");
  content.className = "mk-markdown-html";
  appendNodes(content, parseTableInlineMarkdown(source));
  return content;
}
