import MarkdownIt from "markdown-it";
import katex from "katex";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { mermaidDiagramType } from "./mermaid-config.js";

// Mermaid's own math renderer accepts $$...$$. Accept Markdown's $...$ too,
// while letting the Markdown parser protect code spans and escaped dollar signs.
function parseMath(state: StateInline, silent: boolean) {
  if (state.src[state.pos] !== "$") return false;
  const delimiter = state.src[state.pos + 1] === "$" ? "$$" : "$";
  const start = state.pos + delimiter.length;
  let end = start;
  while ((end = state.src.indexOf(delimiter, end)) !== -1) {
    let slashes = 0;
    for (let i = end - 1; i >= start && state.src[i] === "\\"; i--) slashes++;
    if (slashes % 2 === 0) break;
    end += delimiter.length;
  }
  if (end < 0 || end === start || /\s/.test(state.src[start]) || /\s/.test(state.src[end - 1])) return false;
  if (!silent) {
    const token = state.push("mermaid_math", "", 0);
    token.content = state.src.slice(start, end);
  }
  state.pos = end + delimiter.length;
  return true;
}

function createMarkdown(html: boolean) {
  const parser = new MarkdownIt({ html, breaks: true });
  parser.inline.ruler.before("escape", "mermaid_math", parseMath);
  parser.renderer.rules.mermaid_math = (tokens, index, _options, env) => env.mathML
    ? katex.renderToString(tokens[index].content, { output: "mathml", displayMode: false, throwOnError: false })
    : `$$${tokens[index].content}$$`;
  return parser;
}

const markdown = createMarkdown(true);
const svgMarkdown = createMarkdown(false).disable(["link", "image"]);

const richTokenTypes = new Set(["strong_open", "em_open", "s_open", "code_inline", "bullet_list_open", "ordered_list_open", "mermaid_math"]);

function hasRichTokens(tokens: ReturnType<MarkdownIt["parse"]>): boolean {
  return tokens.some((token) => richTokenTypes.has(token.type) || Boolean(token.children && hasRichTokens(token.children)));
}

function explicitSvgLabels(source: string) {
  const frontmatter = source.match(/^\s*---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  const directives = [...source.matchAll(/^[ \t]*%%\{[\s\S]*?\}%%/gm)].map((match) => match[0]).join("\n");
  return /["']?htmlLabels["']?\s*:\s*false\b/i.test(frontmatter + directives);
}

/** Prepare only quoted diagram labels; comments, directives and other diagram syntax stay intact. */
export function prepareMermaidMarkdown(source: string): { source: string; hasRichLabels: boolean; replacements?: Record<string, string> } {
  const type = mermaidDiagramType(source);
  if (type === "architecture" && !explicitSvgLabels(source)) {
    // The architecture renderer drops code tokens and rejects multiline
    // Markdown. Keep the original label behind a marker until SVG rendering.
    const replacements: Record<string, string> = {};
    let sequence = 0;
    const prepared = source.replace(/^(\s*(?:service|group)\s+[\w.-]+\s*\([^\r\n)]*\)\s*\[)("?)([^"\]\r\n]*)(\2\])/gm,
      (whole, prefix: string, quote: string, label: string, suffix: string) => {
        const tokens = markdown.parse(label.replace(/<br\s*\/?>/gi, "\n"), {});
        if (!hasRichTokens(tokens)) return whole;
        let marker: string;
        do { marker = `MKMD${sequence++}X`; } while (source.includes(marker));
        replacements[marker] = label;
        return prefix + quote + marker + suffix;
      });
    return Object.keys(replacements).length ? { source: prepared, hasRichLabels: true, replacements } : { source, hasRichLabels: false };
  }
  if (!["flowchart", "mindmap", "state", "class", "er", "requirement", "block", "kanban"].includes(type)) {
    return { source, hasRichLabels: false };
  }

  const frontmatter = source.match(/^\s*---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  const directives = [...source.matchAll(/^[ \t]*%%\{[\s\S]*?\}%%/gm)]
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
  // Respect an explicit request for SVG-only labels. In that mode Mermaid
  // displays literal HTML, so leaving the original source is safer.
  if (explicitSvgLabels(source)) {
    return { source, hasRichLabels: false };
  }
  let result = frontmatter;
  let position = frontmatter.length;
  let hasRichLabels = false;
  while (position < source.length) {
    const quote = source.indexOf('"', position);
    if (quote < 0) break;
    const directive = directives.find((range) => quote >= range.start && quote < range.end);
    if (directive) {
      result += source.slice(position, directive.end);
      position = directive.end;
      continue;
    }
    const lineStart = source.lastIndexOf("\n", quote - 1) + 1;
    const before = source.slice(lineStart, quote);
    if (source.slice(Math.max(position, lineStart), quote).includes("%%")) {
      const lineEnd = source.indexOf("\n", quote);
      if (lineEnd < 0) break;
      result += source.slice(position, lineEnd + 1);
      position = lineEnd + 1;
      continue;
    }
    let end = quote + 1;
    for (; end < source.length; end++) {
      if (source[end] === "\\") { end++; continue; }
      if (source[end] === '"') break;
    }
    if (end >= source.length) break;

    const labelContext = (
      /[\[({|]\s*$/.test(before) || /\bsubgraph\s*$/.test(before)
      || /(?:--|==|-\.)\s*$/.test(before) || /\blabel\s*:\s*$/.test(before)
      || (type === "state" && /\bstate\s*$/.test(before))
      || (["state", "class", "er", "requirement"].includes(type) && /:\s*$/.test(before))
    );
    const raw = source.slice(quote + 1, end);
    const nativeMarkdown = raw.startsWith("`") && raw.endsWith("`");
    const text = (nativeMarkdown ? raw.slice(1, -1) : raw).replace(/<br\s*\/?>/gi, "\n");
    const tokens = labelContext ? markdown.parse(text, {}) : [];
    if (labelContext && (nativeMarkdown || hasRichTokens(tokens))) {
      const html = markdown.renderer.render(tokens, markdown.options, {})
        .trim().replace(/\n/g, "").replace(/"/g, "#quot;");
      // Mermaid wraps labels containing math in a flex row; keep the Markdown
      // blocks inside one child so lists stay below the preceding paragraph.
      result += source.slice(position, quote + 1) + `<div>${html}</div>` + '"';
      hasRichLabels = true;
    } else {
      result += source.slice(position, end + 1);
    }
    position = end + 1;
  }
  return { source: result + source.slice(position), hasRichLabels };
}

/** Reserve enough vertical space in fixed-height chart rows for multiline labels. */
export function mermaidMarkdownLayout(source: string): { ganttBarHeight?: number; packetRowHeight?: number; journeyTaskHeight?: number } {
  const type = mermaidDiagramType(source);
  if (type !== "gantt" && type !== "packet" && type !== "journey") return {};
  const segments = [...source.split(/\r?\n/), ...(source.match(/"[^"\r]*"/g) ?? [])];
  const lines = segments.reduce((max, segment) => {
    if (!/[*_`$]/.test(segment) && !/<br\s*\/?>\s*(?:[-+]\s+|\d+[.)]\s+)/i.test(segment)) return max;
    return Math.max(max, 1 + (segment.match(/<br\s*\/?>|\n/gi)?.length ?? 0));
  }, 1);
  if (lines <= 1) return {};
  if (type === "gantt") return { ganttBarHeight: Math.max(20, lines * 15 + 10) };
  if (type === "packet") return { packetRowHeight: Math.max(32, lines * 16 + 10) };
  return { journeyTaskHeight: Math.max(50, lines * 20 + 12) };
}

/** Format labels emitted as SVG text by diagram types without HTML label support. */
export function formatMermaidSvgMarkdown(root: SVGSVGElement, source: string, replacements: Record<string, string> = {}): boolean {
  if (explicitSvgLabels(source)) return false;
  let changed = false;
  const svgNamespace = "http://www.w3.org/2000/svg";
  const htmlNamespace = "http://www.w3.org/1999/xhtml";
  const env = { mathML: true };

  const preserveSvgFormatting = (element: Element): string => {
    let value = Array.from(element.childNodes).map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent ?? ""
      : child instanceof Element ? preserveSvgFormatting(child) : "").join("");
    if (element.tagName.toLowerCase() === "tspan") {
      const leading = value.match(/^\s*/)?.[0] ?? "";
      const trailing = value.match(/\s*$/)?.[0] ?? "";
      let body = value.trim();
      if (body && /^(bold|[6-9]00)$/i.test(element.getAttribute("font-weight") ?? "")) body = `**${body}**`;
      if (body && /^(italic|oblique)$/i.test(element.getAttribute("font-style") ?? "")) body = `*${body}*`;
      value = leading + body + trailing;
    }
    return value;
  };

  for (const text of Array.from(root.querySelectorAll<SVGTextElement>("text"))) {
    if (text.closest("defs, marker, clipPath, mask")) continue;
    if (text.closest("switch")?.querySelector("foreignObject")) continue;
    const rows = Array.from(text.querySelectorAll(":scope > tspan.row"));
    const spans = Array.from(text.querySelectorAll(":scope > tspan"));
    let content = (rows.length ? rows.map(preserveSvgFormatting).join("\n")
      : spans.length ? spans.map(preserveSvgFormatting).join(" ") : text.textContent ?? "");
    for (const [marker, original] of Object.entries(replacements)) content = content.split(marker).join(original);
    content = content.replace(/<br\s*\/?>/gi, "\n");
    const tokens = svgMarkdown.parse(content, env);
    if (!hasRichTokens(tokens)) continue;
    // A single numbered message such as "1. Acquire lock" is common in
    // sequence diagrams; it is not intended as a one-item Markdown list.
    const explicitListLines = source.split(/<br\s*\/?>/i).slice(1);
    const isExplicitListLine = explicitListLines.some((line) => line.trimStart().startsWith(content.trim()));
    if (!content.includes("\n") && !isExplicitListLine
      && tokens.some((token) => token.type === "ordered_list_open" || token.type === "bullet_list_open")) continue;

    let bounds: DOMRect;
    try { bounds = text.getBBox(); } catch { continue; }
    if (bounds.width <= 0 || bounds.height <= 0 || !text.parentNode) continue;
    const style = getComputedStyle(text);
    const foreign = document.createElementNS(svgNamespace, "foreignObject");
    const contentElement = document.createElementNS(htmlNamespace, "div");
    contentElement.setAttribute("xmlns", htmlNamespace);
    contentElement.setAttribute("data-mk-markdown-label", "");
    contentElement.style.cssText = `display:inline-block;width:max-content;max-width:500px;line-height:1.25;white-space:normal;font:${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily};color:${style.fill !== "none" ? style.fill : style.color};`;
    contentElement.innerHTML = svgMarkdown.renderer.render(tokens, svgMarkdown.options, env);
    foreign.append(contentElement);
    foreign.setAttribute("x", String(bounds.x));
    foreign.setAttribute("y", String(bounds.y));
    foreign.setAttribute("width", "600");
    foreign.setAttribute("height", "600");
    for (const attribute of ["transform", "clip-path"]) {
      const value = text.getAttribute(attribute);
      if (value) foreign.setAttribute(attribute, value);
    }
    text.parentNode.insertBefore(foreign, text);
    const width = Math.max(1, contentElement.scrollWidth);
    const height = Math.max(1, contentElement.scrollHeight);
    const anchor = text.getAttribute("text-anchor") || style.textAnchor;
    let x = anchor === "middle" ? bounds.x + (bounds.width - width) / 2
      : anchor === "end" ? bounds.x + bounds.width - width : bounds.x;
    // Mermaid measures the unrendered Markdown when deciding whether a Gantt
    // label fits inside its bar. Recheck using the rendered label's width.
    if (mermaidDiagramType(source) === "gantt" && text.id.endsWith("-text")) {
      const task = Array.from(root.querySelectorAll<SVGRectElement>("rect.task"))
        .find((rect) => rect.id === text.id.slice(0, -5));
      if (task && width + 8 <= Number(task.getAttribute("width"))) {
        x = Number(task.getAttribute("x")) + (Number(task.getAttribute("width")) - width) / 2;
      }
    }
    foreign.setAttribute("x", String(x));
    const topAligned = ["pie", "xychart", "quadrantChart", "architecture"].includes(root.getAttribute("aria-roledescription") ?? "")
      && Boolean(contentElement.querySelector("ul,ol"));
    foreign.setAttribute("y", String(topAligned ? bounds.y : bounds.y + (bounds.height - height) / 2));
    foreign.setAttribute("width", String(width));
    foreign.setAttribute("height", String(height));
    foreign.setAttribute("data-mk-rich-processed", "");
    text.remove();
    changed = true;
  }

  // Mermaid's HTML labels may already contain native strong/em elements but
  // leave code, math, or lists as text. Rebuild only labels with leftovers.
  for (const foreign of Array.from(root.querySelectorAll<SVGForeignObjectElement>("foreignObject"))) {
    if (foreign.querySelector("[data-mk-markdown-label]")) continue;
    const walker = document.createTreeWalker(foreign, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const leftover = nodes.some((node) => {
      const parent = node.parentElement;
      return parent && !parent.closest("code, math, annotation, script, style")
        && (/`[^`]+`|\${1,2}[^$]+\${1,2}/.test(node.data) || ((foreign.querySelector("br") || /\n/.test(foreign.textContent ?? "")) && /^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(node.data)));
    });
    if (leftover) {
      const label = foreign.querySelector(".nodeLabel, .edgeLabel, .label") ?? foreign.firstElementChild;
      if (!label) continue;
      const asMarkdown = (element: Element): string => Array.from(element.childNodes).map((child) => {
        if (child.nodeType === Node.TEXT_NODE) return child.textContent ?? "";
        if (!(child instanceof Element)) return "";
        const tag = child.tagName.toLowerCase();
        if (tag === "br") return "\n";
        if (tag === "math") return `$$${child.querySelector("annotation")?.textContent ?? child.textContent ?? ""}$$`;
        const text = asMarkdown(child);
        if (tag === "strong" || tag === "b") return `**${text}**`;
        if (tag === "em" || tag === "i") return `*${text}*`;
        if (tag === "code") return `\`${text}\``;
        if (tag === "p" || tag === "div") return `${text}\n`;
        return text;
      }).join("");
      const tokens = svgMarkdown.parse(asMarkdown(label).replace(/<br\s*\/?>/gi, "\n"), env);
      if (!hasRichTokens(tokens)) continue;
      label.innerHTML = svgMarkdown.renderer.render(tokens, svgMarkdown.options, env);
      label.setAttribute("data-mk-markdown-label", "");
      const content = foreign.firstElementChild as HTMLElement | null;
      if (content) {
        const width = Math.max(Number(foreign.getAttribute("width")) || 0, content.scrollWidth);
        const height = Math.max(Number(foreign.getAttribute("height")) || 0, content.scrollHeight);
        foreign.setAttribute("width", String(width));
        foreign.setAttribute("height", String(height));
      }
      foreign.setAttribute("data-mk-rich-processed", "");
      changed = true;
    }
  }
  if (changed && root.getAttribute("aria-roledescription") === "pie") {
    let previousBottom = -Infinity;
    for (const legend of root.querySelectorAll<SVGGElement>("g.legend")) {
      const matrix = legend.transform.baseVal.consolidate()?.matrix;
      if (!matrix) continue;
      const box = legend.getBBox();
      const shift = Math.max(0, previousBottom + 4 - (matrix.f + box.y));
      if (shift) {
        matrix.f += shift;
        legend.setAttribute("transform", `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`);
      }
      previousBottom = matrix.f + box.y + box.height;
    }
  }
  if (changed && root.getAttribute("aria-roledescription") === "treemap") {
    for (const group of root.querySelectorAll<SVGGElement>("g.treemapLeafGroup")) {
      const label = group.querySelector<SVGForeignObjectElement>("foreignObject[data-mk-rich-processed]");
      const value = group.querySelector<SVGTextElement>("text.treemapValue");
      if (!label || !value) continue;
      const bottom = Number(label.getAttribute("y")) + Number(label.getAttribute("height"));
      const y = Number(value.getAttribute("y"));
      if (y < bottom + 4) value.setAttribute("y", String(bottom + 4));
    }
  }
  if (changed) {
    try {
      const view = root.viewBox.baseVal;
      let left = view.x, top = view.y, right = view.x + view.width, bottom = view.y + view.height;
      for (const foreign of root.querySelectorAll<SVGForeignObjectElement>("foreignObject[data-mk-rich-processed]")) {
        const rootMatrix = root.getCTM(), foreignMatrix = foreign.getCTM();
        if (!rootMatrix || !foreignMatrix) continue;
        const matrix = rootMatrix.inverse().multiply(foreignMatrix);
        const box = foreign.getBBox();
        const corners = [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
          new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height)]
          .map((point) => point.matrixTransform(matrix));
        left = Math.min(left, ...corners.map((point) => point.x - 8));
        top = Math.min(top, ...corners.map((point) => point.y - 8));
        right = Math.max(right, ...corners.map((point) => point.x + 8));
        bottom = Math.max(bottom, ...corners.map((point) => point.y + 8));
      }
      root.setAttribute("viewBox", `${left} ${top} ${right - left} ${bottom - top}`);
    } catch { /* Some diagram types do not expose a measurable SVG bounding box. */ }
  }
  return changed;
}
