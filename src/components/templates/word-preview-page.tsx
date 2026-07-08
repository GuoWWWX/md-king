import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import { AppSurface } from "@/components/ui/app-surface";
import { createDefaultStyleDraft, listMarkerOptions } from "@/lib/style-manager-data";
import { cn } from "@/lib/utils";
import type { MarkdownFeatureSettings, StyleDraft, StyleNode, TemplateStyleConfig } from "@/types/style-manager";

type WordPreviewPageProps = {
  selectedStyle?: StyleNode;
  styleConfig?: TemplateStyleConfig;
  zoom?: number;
  markdown?: string;
  showHeader?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  badgeText?: string;
  pageWidth?: number;
  pageMinHeight?: number;
  paginate?: boolean;
  showPageFooter?: boolean;
  interactiveViewport?: boolean;
  className?: string;
  viewportClassName?: string;
};

type PreviewBlock =
  | { type: "heading"; level: HeadingLevel; text: string; number?: string }
  | { type: "paragraph"; segments: PreviewTextSegment[] }
  | { type: "quote"; segments: PreviewTextSegment[] }
  | { type: "code"; text: string; language?: string }
  | { type: "hr" }
  | { type: "list"; items: PreviewListItem[] }
  | { type: "image"; caption?: string }
  | { type: "table"; caption?: string; rows: string[][] };

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type PreviewTextSegment = { text: string; code?: boolean };
type PreviewListItem = { segments: PreviewTextSegment[]; level: number; ordered: boolean; index: number };
type MarkdownInlineToken = {
  type: string;
  content?: string;
  info?: string;
  children?: MarkdownInlineToken[] | null;
};

const markdownParser = new MarkdownIt({ html: false, linkify: true, typographer: false });
const defaultMarkdownFeatures: MarkdownFeatureSettings = { inlineCode: true, codeBlock: true, quoteBlock: true, horizontalRule: false };
const PT_TO_PX = 4 / 3;
const CSS_DPI = 96;
const PAPER_SIZE_PX = {
  A3: { width: 1123, height: 1587 },
  A4: { width: 794, height: 1123 },
  A5: { width: 559, height: 794 },
  A6: { width: 397, height: 559 },
  B4: { width: 945, height: 1337 },
  B5: { width: 665, height: 943 },
  B6: { width: 472, height: 665 },
  Letter: { width: 816, height: 1056 },
  Legal: { width: 816, height: 1344 },
  Executive: { width: 696, height: 1008 },
  Tabloid: { width: 1056, height: 1632 },
  K16: { width: 697, height: 984 },
  K32: { width: 492, height: 697 },
} as const;

function formatPreviewPageNumber(format: TemplateStyleConfig["pageSettings"]["footerPageNumberFormat"], pageNumber: number) {
  if (format === "none") return "";
  if (format === "plain" || format === "plain-total") return `${pageNumber}`;
  if (format === "page-total") return `第 ${pageNumber} 页`;
  if (format === "dash") return `- ${pageNumber} -`;
  return `第 ${pageNumber} 页`;
}

function ptToPx(value: number) {
  return value * PT_TO_PX;
}

function cmToPx(value: number) {
  return (value / 2.54) * CSS_DPI;
}

function resolveLineHeightPx(draft: StyleDraft) {
  const lineHeight = Number(draft.lineHeight);
  return ptToPx(draft.fontSize) * (Number.isFinite(lineHeight) ? lineHeight : 1.5);
}

function isSelected(selectedStyle: StyleNode | undefined, id: string) {
  return selectedStyle?.id === id;
}

function getDraft(styleConfig: TemplateStyleConfig | undefined, id: string) {
  return styleConfig?.styles[id] ?? createDefaultStyleDraft(id);
}

function resolveTextAlign(align: StyleDraft["align"] | StyleDraft["headerAlign"] | StyleDraft["bodyAlign"] | StyleDraft["captionAlign"]): CSSProperties["textAlign"] {
  return align === "center" ? "center" : align === "right" ? "right" : align === "justify" ? "justify" : "left";
}

function resolveVerticalAlign(align: StyleDraft["headerVerticalAlign"] | StyleDraft["bodyVerticalAlign"]): CSSProperties["verticalAlign"] {
  return align === "middle" ? "middle" : align === "bottom" ? "bottom" : "top";
}

function resolveBorderStyle(style: StyleDraft["borderStyle"]) {
  return style === "none" ? "none" : style;
}

function border(width: number, style: StyleDraft["borderStyle"], color: string) {
  return `${width}px ${resolveBorderStyle(style)} ${color}`;
}

function captionText(draft: StyleDraft, fallbackTitle: string) {
  return draft.captionNumbering ? `${draft.captionNumberFormat}  ${fallbackTitle}` : fallbackTitle;
}

function imageWidthPercent(draft: StyleDraft) {
  if (draft.imageWidthMode === "custom") return Math.min(100, Math.max(20, draft.imageWidthPercent || 100));
  if (draft.imageWidthMode === "original") return 58;
  return 100;
}

function imageMargin(draft: StyleDraft): CSSProperties["margin"] {
  if (draft.imageAlign === "right") return "0 0 0 auto";
  if (draft.imageAlign === "center") return "0 auto";
  return "0";
}

function codeBlockBorder(draft: StyleDraft) {
  return `1px solid ${draft.codeBorderColor || "#E2E8F0"}`;
}

function textStyle(draft: StyleDraft): CSSProperties {
  return {
    color: draft.color,
    fontFamily: `"${draft.chineseFont}", "${draft.latinFont}", sans-serif`,
    fontSize: `${draft.fontSize}pt`,
    fontWeight: draft.fontWeight,
    lineHeight: draft.lineHeight,
    marginTop: `${draft.beforeSpacing}px`,
    marginBottom: `${draft.afterSpacing}px`,
    textAlign: resolveTextAlign(draft.align),
    textIndent: `${draft.firstLineIndent}em`,
    backgroundColor: draft.backgroundColor === "transparent" ? undefined : draft.backgroundColor,
  };
}

function inlineCodeStyle(draft: StyleDraft): CSSProperties {
  return {
    color: draft.color,
    fontFamily: `"${draft.latinFont}", "${draft.chineseFont}", monospace`,
    fontSize: `${draft.fontSize}pt`,
    fontWeight: draft.fontWeight,
    lineHeight: 1.35,
    backgroundColor: draft.backgroundColor === "transparent" ? "#F1F5F9" : draft.backgroundColor,
  };
}

function selectedRing(selectedStyle: StyleNode | undefined, id: string) {
  return isSelected(selectedStyle, id) ? "outline outline-2 outline-offset-2 outline-indigo-400" : undefined;
}

const languageLabels: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  java: "Java",
  rust: "Rust",
  rs: "Rust",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  shell: "Shell",
  bash: "Shell",
  sh: "Shell",
  powershell: "PowerShell",
  ps1: "PowerShell",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
};

const syntaxKeywords: Record<string, string[]> = {
  javascript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "let", "new", "return", "switch", "throw", "try", "var", "while"],
  typescript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "export", "extends", "finally", "for", "from", "function", "if", "implements", "import", "interface", "let", "new", "private", "protected", "public", "readonly", "return", "switch", "throw", "try", "type", "var", "while"],
  python: ["and", "as", "async", "await", "break", "class", "continue", "def", "elif", "else", "except", "False", "finally", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"],
  java: ["abstract", "boolean", "break", "case", "catch", "class", "const", "continue", "default", "else", "enum", "extends", "final", "finally", "for", "if", "implements", "import", "instanceof", "interface", "new", "private", "protected", "public", "return", "static", "switch", "throw", "throws", "try", "void", "while"],
  rust: ["as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
  sql: ["and", "as", "by", "case", "create", "delete", "desc", "distinct", "from", "group", "having", "insert", "into", "join", "left", "limit", "not", "null", "on", "or", "order", "right", "select", "set", "table", "update", "values", "where"],
};

function normalizeCodeLanguage(info?: string) {
  const raw = info?.trim().split(/\s+/)[0]?.replace(/^language-/, "").toLowerCase() ?? "";
  if (!raw) return undefined;
  if (raw === "jsx") return "javascript";
  if (raw === "tsx") return "typescript";
  if (raw === "js") return "javascript";
  if (raw === "ts") return "typescript";
  if (raw === "py") return "python";
  if (raw === "rs") return "rust";
  if (raw === "bash" || raw === "sh" || raw === "shell") return "shell";
  if (raw === "ps1") return "powershell";
  if (raw === "yml") return "yaml";
  return raw;
}

function codeLanguageLabel(language?: string) {
  if (!language) return undefined;
  return languageLabels[language] ?? language.toUpperCase();
}

function hexToLuminance(value: string) {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0.1;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function syntaxPalette(backgroundColor: string | undefined) {
  const dark = !backgroundColor || backgroundColor === "transparent" || hexToLuminance(backgroundColor) < 0.45;
  return dark
    ? { keyword: "#C084FC", string: "#86EFAC", comment: "#94A3B8", number: "#FBBF24", function: "#67E8F9", operator: "#F9A8D4", plain: "#E2E8F0" }
    : { keyword: "#7C3AED", string: "#15803D", comment: "#64748B", number: "#B45309", function: "#0369A1", operator: "#BE185D", plain: "#111827" };
}

function renderHighlightedCode(text: string, language: string | undefined, draft: StyleDraft) {
  const palette = syntaxPalette(draft.backgroundColor);
  const keywordSet = new Set(syntaxKeywords[language ?? ""] ?? syntaxKeywords.javascript);
  const pattern = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\s*\()|\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:+\-*/%=<>!&|?]+)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    let color: string | undefined;
    if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) color = palette.comment;
    else if (/^["'`]/.test(token)) color = palette.string;
    else if (/^\d/.test(token)) color = palette.number;
    else if (keywordSet.has(token) || (language === "json" && /^(true|false|null)$/.test(token))) color = palette.keyword;
    else if (/^[A-Za-z_$]/.test(token) && text.slice(match.index + token.length).match(/^\s*\(/)) color = palette.function;
    else if (/^[{}()[\].,;:+\-*/%=<>!&|?]+$/.test(token)) color = palette.operator;
    nodes.push(color ? <span key={`${match.index}-${token}`} style={{ color }}>{token}</span> : token);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function mergeTextSegments(segments: PreviewTextSegment[]) {
  return segments.reduce<PreviewTextSegment[]>((merged, segment) => {
    if (!segment.text) return merged;
    const last = merged[merged.length - 1];
    if (last && Boolean(last.code) === Boolean(segment.code)) {
      last.text += segment.text;
      return merged;
    }
    merged.push({ ...segment });
    return merged;
  }, []);
}

function textSegments(text: string): PreviewTextSegment[] {
  return text ? [{ text }] : [];
}

function plainText(segments: PreviewTextSegment[]) {
  return segments.map((segment) => segment.text).join("");
}

function inlineSegmentsFromToken(token: MarkdownInlineToken | undefined): PreviewTextSegment[] {
  if (!token) return [];
  const children = token.children ?? [];
  if (children.length === 0) return textSegments(token.content ?? "");

  return mergeTextSegments(children.flatMap((child) => {
    if (child.type === "code_inline") return [{ text: child.content ?? "", code: true }];
    if (child.type === "softbreak" || child.type === "hardbreak") return [{ text: "\n" }];
    if (child.children?.length) return inlineSegmentsFromToken(child);
    return textSegments(child.content ?? "");
  }));
}

function joinTextSegmentGroups(groups: PreviewTextSegment[][], separator: string) {
  return mergeTextSegments(groups.flatMap((group, index) => (index === 0 ? group : [{ text: separator }, ...group])));
}

function renderInlineText(segments: PreviewTextSegment[], inlineCodeDraft: StyleDraft, inlineCodeEnabled: boolean, keyPrefix: string, selectedStyle?: StyleNode) {
  return segments.map((segment, index) => {
    if (!segment.code || !inlineCodeEnabled) return segment.text;
    return (
      <code
        key={`${keyPrefix}-${index}`}
        className={cn("mx-0.5 rounded px-1 py-0.5", selectedRing(selectedStyle, "inline-code"))}
        style={inlineCodeStyle(inlineCodeDraft)}
      >
        {segment.text}
      </code>
    );
  });
}

function toChineseNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones === 0 ? "" : digits[ones]}`;
  }
  return String(value);
}

function stripHeadingNumberPrefix(text: string) {
  return text.replace(/^\s*(?:\d+(?:\.\d+)*[.、．]?\s+|[一二三四五六七八九十百千万]+[、.．]\s*|第[一二三四五六七八九十百千万]+[章节篇]\s*)/, "");
}

function resolveHeadingNumber(level: HeadingLevel, draft: StyleDraft, counters: number[]) {
  if (!draft.autoNumbering || draft.numberFormat === "无编号") return undefined;

  const current = counters[level - 1] || 1;
  if (draft.numberFormat === "一、") return `${toChineseNumber(current)}、`;
  if (draft.numberFormat === "第一章") return `第${toChineseNumber(current)}章`;

  if (/^1(?:\.1){0,5}$/.test(draft.numberFormat)) {
    const requestedDepth = draft.numberFormat.split(".").length;
    const depth = Math.min(level, requestedDepth);
    const parts = counters.slice(0, depth).map((value) => value || 1);
    const suffix = depth === 1 ? "." : "";
    return `${parts.join(".")}${suffix}`;
  }

  return draft.numberFormat;
}

function listMarkerFromStyle(value: StyleDraft["listMarkerStyle"]) {
  return listMarkerOptions.find((option) => option.value === value)?.marker ?? "•";
}

function listNumberText(format: string, index: number) {
  if (format === "1)") return `${index})`;
  if (format === "(1)") return `(${index})`;
  if (format === "一、") return `${toChineseNumber(index)}、`;
  if (format === "（一）") return `（${toChineseNumber(index)}）`;
  return `${index}.`;
}

function markerTextFromStyle(draft: StyleDraft, item: PreviewListItem, displayIndex = item.index) {
  if (!item.ordered) {
    if (item.level === 1) return listMarkerFromStyle(draft.nestedLevel2MarkerStyle);
    if (item.level >= 2) return listMarkerFromStyle(draft.nestedLevel3MarkerStyle);
    return listMarkerFromStyle(draft.listMarkerStyle);
  }

  if (item.level === 1) return listNumberText(draft.nestedLevel2NumberFormat, displayIndex);
  if (item.level >= 2) return listNumberText(draft.nestedLevel3NumberFormat, displayIndex);
  return listNumberText(draft.numberFormat, displayIndex);
}

function resolveListIndent(draft: StyleDraft, item: Pick<PreviewListItem, "level">) {
  if (item.level <= 0) return Math.max(0, draft.listIndent);
  return Math.max(0, draft.listIndent + Math.max(0, item.level - 1) * draft.nestedIndentStep);
}

function annotateHeadingNumbers(blocks: PreviewBlock[], drafts: Record<string, StyleDraft>) {
  const counters = [0, 0, 0, 0, 0, 0];

  return blocks.map((block) => {
    if (block.type !== "heading") return block;
    counters[block.level - 1] += 1;
    for (let index = block.level; index < counters.length; index += 1) counters[index] = 0;

    const styleId = `heading-${block.level}`;
    return {
      ...block,
      text: stripHeadingNumberPrefix(block.text),
      number: resolveHeadingNumber(block.level, drafts[styleId], counters),
    };
  });
}

function collectListItems(tokens: ReturnType<typeof markdownParser.parse>, index: number, ordered: boolean, level: number) {
  const closeType = ordered ? "ordered_list_close" : "bullet_list_close";
  const items: PreviewListItem[] = [];
  let itemIndex = 0;

  while (index < tokens.length && tokens[index].type !== closeType) {
    if (tokens[index].type !== "list_item_open") {
      index += 1;
      continue;
    }

    itemIndex += 1;
    const parts: PreviewTextSegment[][] = [];
    const nestedItems: PreviewListItem[] = [];
    index += 1;

    while (index < tokens.length && tokens[index].type !== "list_item_close") {
      if (tokens[index].type === "inline") {
        parts.push(inlineSegmentsFromToken(tokens[index]));
      } else if (tokens[index].type === "bullet_list_open" || tokens[index].type === "ordered_list_open") {
        const nestedOrdered = tokens[index].type === "ordered_list_open";
        const nested = collectListItems(tokens, index + 1, nestedOrdered, level + 1);
        nestedItems.push(...nested.items);
        index = nested.nextIndex;
      }
      index += 1;
    }

    items.push({ segments: joinTextSegmentGroups(parts, " "), level, ordered, index: itemIndex });
    items.push(...nestedItems);
    index += 1;
  }

  return { items, nextIndex: index };
}

function parseMarkdownPreview(markdown: string): PreviewBlock[] {
  const tokens = markdownParser.parse(markdown, {});
  const blocks: PreviewBlock[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token.type === "heading_open" && next?.type === "inline") {
      const level = Number(token.tag.slice(1));
      const normalizedLevel = Math.min(6, Math.max(1, level)) as HeadingLevel;
      blocks.push({ type: "heading", level: normalizedLevel, text: plainText(inlineSegmentsFromToken(next)) });
      index += 2;
      continue;
    }

    if (token.type === "paragraph_open" && next?.type === "inline") {
      blocks.push({ type: "paragraph", segments: inlineSegmentsFromToken(next) });
      index += 2;
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      blocks.push({ type: "code", text: token.content.trimEnd(), language: token.type === "fence" ? normalizeCodeLanguage(token.info) : undefined });
      continue;
    }

    if (token.type === "hr") {
      blocks.push({ type: "hr" });
      continue;
    }

    if (token.type === "blockquote_open") {
      const parts: PreviewTextSegment[][] = [];
      index += 1;
      while (index < tokens.length && tokens[index].type !== "blockquote_close") {
        if (tokens[index].type === "inline") {
          parts.push(inlineSegmentsFromToken(tokens[index]));
        } else if (tokens[index].type === "fence" || tokens[index].type === "code_block") {
          parts.push(textSegments(tokens[index].content));
        }
        index += 1;
      }
      blocks.push({ type: "quote", segments: joinTextSegmentGroups(parts, "\n") });
      continue;
    }

    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const ordered = token.type === "ordered_list_open";
      const { items, nextIndex } = collectListItems(tokens, index + 1, ordered, 0);
      index = nextIndex;
      if (items.length > 0) blocks.push({ type: "list", items });
      continue;
    }

    if (token.type === "table_open") {
      const rows: string[][] = [];
      let currentRow: string[] | undefined;
      index += 1;
      while (index < tokens.length && tokens[index].type !== "table_close") {
        if (tokens[index].type === "tr_open") currentRow = [];
        if ((tokens[index].type === "td_open" || tokens[index].type === "th_open") && tokens[index + 1]?.type === "inline") {
          currentRow?.push(tokens[index + 1].content);
        }
        if (tokens[index].type === "tr_close" && currentRow) {
          rows.push(currentRow);
          currentRow = undefined;
        }
        index += 1;
      }
      if (rows.length > 0) blocks.push({ type: "table", rows });
    }
  }

  return blocks.slice(0, 36);
}

function estimateTextLines(text: string, charsPerLine = 26) {
  const explicitLines = text.split(/\r?\n/);
  return explicitLines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

function estimateCharsPerLine(contentWidth: number, draft: StyleDraft, ratio = 1) {
  return Math.max(8, Math.floor(contentWidth / Math.max(1, ptToPx(draft.fontSize) * ratio)));
}

function estimateBlockHeight(block: PreviewBlock, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number) {
  if (block.type === "heading") {
    const draft = drafts[`heading-${block.level}`];
    return draft.beforeSpacing + estimateTextLines(block.text, estimateCharsPerLine(contentWidth, draft, 1.05)) * resolveLineHeightPx(draft) + draft.afterSpacing;
  }

  if (block.type === "paragraph") {
    return drafts.normal.beforeSpacing + estimateTextLines(plainText(block.segments), estimateCharsPerLine(contentWidth, drafts.normal)) * resolveLineHeightPx(drafts.normal) + drafts.normal.afterSpacing;
  }

  if (block.type === "quote") {
    return drafts.quote.beforeSpacing + 16 + estimateTextLines(plainText(block.segments), estimateCharsPerLine(contentWidth - 24, drafts.quote)) * resolveLineHeightPx(drafts.quote) + drafts.quote.afterSpacing;
  }

  if (block.type === "code") {
    return drafts.code.beforeSpacing + 18 + estimateTextLines(block.text, estimateCharsPerLine(contentWidth - 24, drafts.code, 0.62)) * resolveLineHeightPx(drafts.code) + drafts.code.afterSpacing;
  }

  if (block.type === "hr") {
    return 28;
  }

  if (block.type === "list") {
    return 12 + block.items.reduce((total, item) => {
      const draft = item.level > 0 ? drafts["nested-list"] : item.ordered ? drafts["numbered-list"] : drafts["bullet-list"];
      const listOffset = (resolveListIndent(draft, item) + draft.listTextIndent) * ptToPx(draft.fontSize);
      return total + estimateTextLines(plainText(item.segments), estimateCharsPerLine(contentWidth - listOffset, draft)) * resolveLineHeightPx(draft);
    }, 0);
  }

  if (block.type === "image") {
    return 132 + (block.caption ? 26 : 0);
  }

  return (block.caption ? 28 : 10) + Math.max(1, block.rows.length) * Math.max(tableDraft.minRowHeight, ptToPx(tableDraft.bodyFontSize) * Number(tableDraft.bodyLineHeight || 1.5) + tableDraft.cellPaddingY * 2);
}

function splitTextByLength(text: string, maxChars: number) {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > maxChars) {
    const splitAt = Math.max(rest.lastIndexOf("\n", maxChars), rest.lastIndexOf("。", maxChars), rest.lastIndexOf("；", maxChars), rest.lastIndexOf(" ", maxChars));
    const cut = splitAt > maxChars * 0.45 ? splitAt + 1 : maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

function splitLargeBlocks(blocks: PreviewBlock[], pageContentHeight: number, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number) {
  return blocks.flatMap((block) => {
    if (estimateBlockHeight(block, drafts, tableDraft, contentWidth) <= pageContentHeight) return [block];

    if (block.type === "paragraph") {
      return splitTextByLength(plainText(block.segments), estimateCharsPerLine(contentWidth, drafts.normal) * 24).map((text) => ({ ...block, segments: textSegments(text) }));
    }

    if (block.type === "quote") {
      return splitTextByLength(plainText(block.segments), estimateCharsPerLine(contentWidth - 24, drafts.quote) * 20).map((text) => ({ ...block, segments: textSegments(text) }));
    }

    if (block.type === "code") {
      return splitTextByLength(block.text, estimateCharsPerLine(contentWidth - 24, drafts.code, 0.62) * 24).map((text) => ({ ...block, text }));
    }

    if (block.type === "hr") return [block];

    if (block.type === "list") {
      const pages: PreviewBlock[] = [];
      let currentItems: PreviewListItem[] = [];
      let usedHeight = 20;

      block.items.forEach((item) => {
        const draft = item.level > 0 ? drafts["nested-list"] : item.ordered ? drafts["numbered-list"] : drafts["bullet-list"];
        const listOffset = (resolveListIndent(draft, item) + draft.listTextIndent) * ptToPx(draft.fontSize);
        const itemHeight = estimateTextLines(plainText(item.segments), estimateCharsPerLine(contentWidth - listOffset, draft)) * resolveLineHeightPx(draft);
        if (currentItems.length > 0 && usedHeight + itemHeight > pageContentHeight) {
          pages.push({ ...block, items: currentItems });
          currentItems = [];
          usedHeight = 20;
        }
        currentItems.push(item);
        usedHeight += itemHeight;
      });

      if (currentItems.length > 0) pages.push({ ...block, items: currentItems });
      return pages;
    }

    if (block.type === "table") {
      const [header, ...bodyRows] = block.rows;
      const maxBodyRows = Math.max(2, Math.floor((pageContentHeight - 70) / 38));
      const chunks: PreviewBlock[] = [];

      for (let index = 0; index < bodyRows.length; index += maxBodyRows) {
        chunks.push({
          ...block,
          caption: index === 0 ? block.caption : undefined,
          rows: header ? [header, ...bodyRows.slice(index, index + maxBodyRows)] : bodyRows.slice(index, index + maxBodyRows),
        });
      }

      return chunks.length > 0 ? chunks : [block];
    }

    return [block];
  });
}

function paginateBlocks(blocks: PreviewBlock[], pageContentHeight: number, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number) {
  const pages: PreviewBlock[][] = [];
  let currentPage: PreviewBlock[] = [];
  let usedHeight = 0;

  blocks.forEach((block) => {
    const blockHeight = estimateBlockHeight(block, drafts, tableDraft, contentWidth);
    const shouldStartNewPage = currentPage.length > 0 && usedHeight + blockHeight > pageContentHeight;

    if (shouldStartNewPage) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(block);
    usedHeight += blockHeight;
  });

  if (currentPage.length > 0) pages.push(currentPage);
  return pages.length > 0 ? pages : [[]];
}

function createFallbackBlocks(imageCaption: string, tableCaption: string): PreviewBlock[] {
  return [
    { type: "heading", level: 1, text: "文档标题" },
    { type: "paragraph", segments: textSegments("md-king · 样式结构预览") },
    { type: "heading", level: 2, text: "一级章节" },
    { type: "heading", level: 3, text: "二级小节" },
    { type: "heading", level: 4, text: "三级条目" },
    { type: "heading", level: 5, text: "四级条目" },
    { type: "heading", level: 6, text: "五级条目" },
    { type: "paragraph", segments: [...textSegments("这是一段正文，用于预览正文样式、行距、字号、对齐方式和段落间距。md-king 会把 AI 生成的 Markdown 转换成可继续编辑的 Word/WPS 文档，并尽量保留清晰的文档结构。"), { text: "inlineCode()", code: true }, ...textSegments(" 会在这里展示实际效果。")] },
    { type: "list", items: [
      { segments: textSegments("无序列表会展示项目符号、缩进和换行后的对齐效果。这里故意放一段更长的文字，方便观察第二行从哪里开始。"), level: 0, ordered: false, index: 1 },
      { segments: textSegments("二级列表会使用多级列表里的二级样式。"), level: 1, ordered: false, index: 1 },
      { segments: textSegments("三级列表会继续缩进，并使用三级样式。"), level: 2, ordered: false, index: 1 },
      { segments: textSegments("有序列表可以切换数字、括号和中文编号。"), level: 0, ordered: true, index: 1 },
      { segments: textSegments("第二个编号项用于观察编号递增。"), level: 0, ordered: true, index: 2 },
    ] },
    { type: "quote", segments: textSegments("这里展示引用块样式，内容仅用于观察缩进、边框、字体和背景效果。") },
    { type: "code", text: "function convertMarkdown(input) {\n  const docx = renderWordDocument(input);\n  return saveAs(docx, \"report.docx\");\n}" },
    { type: "image", caption: imageCaption },
    { type: "hr" },
    { type: "table", caption: tableCaption, rows: [["字段", "样式", "备注"], ["标题", "加粗", "用于章节层级"], ["正文", "常规", "用于段落内容"], ["表格", "按页面宽度铺满", "自动换行"]] },
  ];
}

function applyMarkdownFeatureSettings(blocks: PreviewBlock[], features: MarkdownFeatureSettings): PreviewBlock[] {
  return blocks.map((block) => {
    if (block.type === "quote" && !features.quoteBlock) return { type: "paragraph", segments: block.segments };
    if (block.type === "code" && !features.codeBlock) return { type: "paragraph", segments: textSegments(block.text) };
    if (block.type === "hr" && !features.horizontalRule) return undefined;
    return block;
  }).filter((block): block is PreviewBlock => Boolean(block));
}

function renderMarkdownBlocks({
  blocks,
  drafts,
  selectedStyle,
  tableStyle,
  inlineCodeDraft,
  inlineCodeEnabled,
}: {
  blocks: PreviewBlock[];
  drafts: Record<string, StyleDraft>;
  selectedStyle?: StyleNode;
  inlineCodeDraft: StyleDraft;
  inlineCodeEnabled: boolean;
  tableStyle: {
    imageStyle: CSSProperties;
    figureCaptionPosition: StyleDraft["captionPosition"];
    figureCaptionStyle: CSSProperties;
    captionStyle: CSSProperties;
    captionPosition: StyleDraft["captionPosition"];
    headerStyle: CSSProperties;
    bodyCellStyle: CSSProperties;
    tableWidth: string;
    tableMargin: string;
    tableLayout: CSSProperties["tableLayout"];
    borderStyle: CSSProperties;
    rowStripe: boolean;
    columnWidths: string[];
  };
}) {
  const rendered: ReactNode[] = [];
  let continuedOrderedListIndex = 0;

  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      const styleId = `heading-${block.level}`;
      rendered.push(
        <div key={index} className={cn(selectedRing(selectedStyle, styleId), "break-words")} style={textStyle(drafts[styleId])}>
          {block.number ? <span>{block.number} </span> : null}
          {block.text}
        </div>,
      );
      return;
    }

    if (block.type === "paragraph") {
      rendered.push(<p key={index} className={cn(selectedRing(selectedStyle, "normal"), "break-words")} style={textStyle(drafts.normal)}>{renderInlineText(block.segments, inlineCodeDraft, inlineCodeEnabled, `p-${index}`, selectedStyle)}</p>);
      return;
    }

    if (block.type === "quote") {
      rendered.push(
        <blockquote
          key={index}
          className={cn("italic", selectedRing(selectedStyle, "quote"))}
          style={{
            ...textStyle(drafts.quote),
            textIndent: 0,
            borderLeft: `${Math.max(1, drafts.quote.quoteBorderWidth || 4)}px solid ${drafts.quote.quoteBorderColor || "#94A3B8"}`,
            backgroundColor: drafts.quote.backgroundColor === "transparent" ? "#F8FAFC" : drafts.quote.backgroundColor,
            padding: "8px 12px",
          }}
        >
          {renderInlineText(block.segments, inlineCodeDraft, inlineCodeEnabled, `q-${index}`, selectedStyle)}
        </blockquote>,
      );
      return;
    }

    if (block.type === "code") {
      const languageLabel = codeLanguageLabel(block.language);
      const backgroundColor = drafts.code.backgroundColor === "transparent" ? "#111827" : drafts.code.backgroundColor;
      rendered.push(
        <pre
          key={index}
          className={cn("relative overflow-hidden whitespace-pre-wrap break-words rounded-lg", selectedRing(selectedStyle, "source-code"))}
          style={{
            ...textStyle(drafts.code),
            textIndent: 0,
            backgroundColor,
            border: codeBlockBorder(drafts.code),
            borderRadius: Math.max(0, drafts.code.codeBorderRadius),
            padding: `${Math.max(0, drafts.code.codePaddingY) + (languageLabel ? 22 : 0)}px ${Math.max(0, drafts.code.codePaddingX)}px ${Math.max(0, drafts.code.codePaddingY)}px`,
          }}
        >
          {languageLabel ? (
            <span
              className="absolute right-2 top-1 rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide"
              style={{ color: syntaxPalette(backgroundColor).comment, backgroundColor: hexToLuminance(backgroundColor) < 0.45 ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)" }}
            >
              {languageLabel}
            </span>
          ) : null}
          <code>{renderHighlightedCode(block.text, block.language, drafts.code)}</code>
        </pre>,
      );
      return;
    }

    if (block.type === "hr") {
      rendered.push(<hr key={index} className="my-4 border-0 border-t border-slate-300" />);
      return;
    }

    if (block.type === "list") {
      rendered.push(
        <div key={index} className="space-y-1.5">
          {block.items.map((item, itemIndex) => {
            const listStyleId = item.level > 0 ? "nested-list" : item.ordered ? "numbered-list" : "bullet-list";
            const listDraft = drafts[listStyleId] ?? drafts.normal;
            const displayIndex = item.ordered && item.level === 0 && listDraft.listNumberingMode === "continue" ? continuedOrderedListIndex + 1 : item.index;
            if (item.ordered && item.level === 0 && listDraft.listNumberingMode === "continue") continuedOrderedListIndex = displayIndex;
            const marker = markerTextFromStyle(listDraft, item, displayIndex);
            const markerWidth = `${Math.max(0.5, listDraft.listTextIndent)}em`;
            const itemStyle = {
              ...textStyle(listDraft),
              marginLeft: `${resolveListIndent(listDraft, item)}em`,
              marginTop: itemIndex === 0 ? `${listDraft.beforeSpacing}px` : 0,
              marginBottom: itemIndex === block.items.length - 1 ? `${listDraft.afterSpacing}px` : 0,
              textIndent: 0,
            };

            if (listDraft.listWrapMode === "flat") {
              return (
                <div key={itemIndex} className={cn("break-words", selectedRing(selectedStyle, listStyleId))} style={itemStyle}>
                  <span aria-hidden="true" style={{ display: "inline-block", width: markerWidth }}>{marker}</span>
                  {renderInlineText(item.segments, inlineCodeDraft, inlineCodeEnabled, `li-${index}-${itemIndex}`, selectedStyle)}
                </div>
              );
            }

            return (
              <div
                key={itemIndex}
                className={cn("grid break-words", selectedRing(selectedStyle, listStyleId))}
                style={{ ...itemStyle, gridTemplateColumns: `${markerWidth} minmax(0,1fr)` }}
              >
                <span aria-hidden="true">{marker}</span>
                <span>{renderInlineText(item.segments, inlineCodeDraft, inlineCodeEnabled, `li-${index}-${itemIndex}`, selectedStyle)}</span>
              </div>
            );
          })}
        </div>,
      );
      return;
    }

    if (block.type === "image") {
      const caption = block.caption ? <div className="text-[10px] font-semibold text-slate-700" style={tableStyle.figureCaptionStyle}>{block.caption}</div> : null;
      rendered.push(
        <figure key={index} className={cn("my-3", selectedRing(selectedStyle, "caption"))}>
          {tableStyle.figureCaptionPosition === "above" ? caption : null}
          <div className={cn("flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-400 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-500", selectedRing(selectedStyle, "image"))} style={tableStyle.imageStyle}>
            Markdown 图片预览
          </div>
          {tableStyle.figureCaptionPosition === "below" ? caption : null}
        </figure>,
      );
      return;
    }

    if (block.type === "table") {
      const [header, ...rows] = block.rows;
      const caption = block.caption ? <div className="text-[10px] font-semibold text-slate-700" style={tableStyle.captionStyle}>{block.caption}</div> : null;
      rendered.push(
        <div key={index}>
          {tableStyle.captionPosition === "above" ? caption : null}
        <table className={cn("my-3 border-collapse text-[10px]", selectedRing(selectedStyle, "table"))} style={{ width: tableStyle.tableWidth, margin: tableStyle.tableMargin, tableLayout: tableStyle.tableLayout, ...tableStyle.borderStyle }}>
          {tableStyle.columnWidths.length > 0 ? <colgroup>{tableStyle.columnWidths.map((width, widthIndex) => <col key={widthIndex} style={{ width }} />)}</colgroup> : null}
          {header ? (
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex} style={tableStyle.headerStyle}>{cell}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="break-words"
                    style={{
                      ...tableStyle.bodyCellStyle,
                      backgroundColor: tableStyle.rowStripe && rowIndex % 2 === 1 ? "#F8FAFC" : tableStyle.bodyCellStyle.backgroundColor,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
          {tableStyle.captionPosition === "below" ? caption : null}
        </div>,
      );
    }
  });

  return rendered;
}

export function WordPreviewPage({ selectedStyle, styleConfig, zoom = 85, markdown, showHeader = true, headerTitle = "实时预览", headerSubtitle, badgeText, pageWidth, pageMinHeight, paginate = false, showPageFooter = true, interactiveViewport = false, className, viewportClassName }: WordPreviewPageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const requestedScale = zoom / 100;
  const pageSettings = styleConfig?.pageSettings;
  const basePaperSize = PAPER_SIZE_PX[pageSettings?.paperSize ?? "A4"] ?? PAPER_SIZE_PX.A4;
  const resolvedPaperSize = pageSettings?.orientation === "landscape" ? { width: basePaperSize.height, height: basePaperSize.width } : basePaperSize;
  const paperWidth = pageWidth ?? resolvedPaperSize.width;
  const paperHeight = pageMinHeight ?? resolvedPaperSize.height;
  const headerEnabled = pageSettings?.headerEnabled ?? false;
  const footerEnabled = showPageFooter && (pageSettings?.footerEnabled ?? true);
  const headerText = pageSettings?.headerText?.trim() ?? "";
  const footerText = pageSettings?.footerText?.trim() ?? "";
  const footerStartPage = Number.isFinite(pageSettings?.footerStartPage) ? Math.max(1, Math.trunc(pageSettings?.footerStartPage ?? 1)) : 1;
  const pageMargins = {
    top: cmToPx(pageSettings?.marginTop ?? 2.54),
    right: cmToPx(pageSettings?.marginRight ?? 3.18),
    bottom: cmToPx(pageSettings?.marginBottom ?? 2.54),
    left: cmToPx(pageSettings?.marginLeft ?? 3.18),
  };
  const contentWidth = Math.max(240, paperWidth - pageMargins.left - pageMargins.right);
  const heading1 = getDraft(styleConfig, "heading-1");
  const heading2 = getDraft(styleConfig, "heading-2");
  const heading3 = getDraft(styleConfig, "heading-3");
  const heading4 = getDraft(styleConfig, "heading-4");
  const heading5 = getDraft(styleConfig, "heading-5");
  const heading6 = getDraft(styleConfig, "heading-6");
  const normal = getDraft(styleConfig, "normal");
  const quote = getDraft(styleConfig, "quote");
  const code = getDraft(styleConfig, "source-code");
  const inlineCode = getDraft(styleConfig, "inline-code");
  const bulletList = getDraft(styleConfig, "bullet-list");
  const numberedList = getDraft(styleConfig, "numbered-list");
  const nestedList = getDraft(styleConfig, "nested-list");
  const caption = getDraft(styleConfig, "caption");
  const image = getDraft(styleConfig, "image");
  const table = getDraft(styleConfig, "table");
  const tableHeader = getDraft(styleConfig, "table-header");
  const tableBody = getDraft(styleConfig, "table-body");
  const tableCaption = getDraft(styleConfig, "table-caption");

  const tableWidth = `${table.fitToPageWidth ? 100 : table.tableWidthPercent}%`;
  const tableMargin = table.tableHorizontalAlign === "center" ? "0 auto" : table.tableHorizontalAlign === "right" ? "0 0 0 auto" : "0";
  const tableColumnWidths = table.columnWidthMode === "custom" ? [`${table.firstColumnWidth}%`, `${table.secondColumnWidth}%`, `${table.thirdColumnWidth}%`] : [];
  const baseBorderWidth = table.outerBorderStrong ? Math.max(1.5, table.borderWidth + 0.5) : table.borderWidth;
  const baseBorder = border(baseBorderWidth, table.borderStyle, table.borderColor);
  const sideBorders = {
    borderTop: border(table.borderTopWidth || baseBorderWidth, table.borderStyle, table.borderColor),
    borderRight: border(table.borderRightWidth || baseBorderWidth, table.borderStyle, table.borderColor),
    borderBottom: border(table.borderBottomWidth || baseBorderWidth, table.borderStyle, table.borderColor),
    borderLeft: border(table.borderLeftWidth || baseBorderWidth, table.borderStyle, table.borderColor),
  };
  const headerBorder = border(tableHeader.headerBorderWidth, table.borderStyle, tableHeader.headerBorderColor);
  const bodyBorder = border(tableBody.bodyBorderWidth, table.borderStyle, tableBody.bodyBorderColor);
  const whiteSpace = table.cellWrap ? "normal" : "nowrap";
  const captionStyle: CSSProperties = {
    color: tableCaption.color,
    fontFamily: `"${tableCaption.chineseFont}", "${tableCaption.latinFont}", sans-serif`,
    fontSize: `${tableCaption.fontSize}pt`,
    fontWeight: tableCaption.fontWeight,
    lineHeight: tableCaption.lineHeight,
    textAlign: resolveTextAlign(tableCaption.captionAlign),
  };
  const figureCaptionStyle: CSSProperties = {
    color: caption.color,
    fontFamily: `"${caption.chineseFont}", "${caption.latinFont}", sans-serif`,
    fontSize: `${caption.fontSize}pt`,
    fontWeight: caption.fontWeight,
    lineHeight: caption.lineHeight,
    textAlign: resolveTextAlign(caption.captionAlign),
    marginTop: caption.captionPosition === "below" ? `${caption.beforeSpacing}px` : 0,
    marginBottom: caption.captionPosition === "above" ? `${caption.afterSpacing}px` : 0,
  };
  const imageStyle: CSSProperties = {
    width: `${imageWidthPercent(image)}%`,
    margin: imageMargin(image),
  };
  const headerStyle: CSSProperties = {
    backgroundColor: tableHeader.headerBackgroundColor,
    color: tableHeader.color,
    fontFamily: `"${tableHeader.chineseFont}", "${tableHeader.latinFont}", sans-serif`,
    fontWeight: tableHeader.headerBold ? 700 : 500,
    fontSize: `${tableHeader.headerFontSize}pt`,
    lineHeight: tableHeader.headerLineHeight,
    minHeight: `${table.minRowHeight}px`,
    textAlign: resolveTextAlign(tableHeader.headerAlign),
    verticalAlign: resolveVerticalAlign(tableHeader.headerVerticalAlign),
    borderTop: headerBorder,
    borderBottom: table.showInnerHorizontalBorder ? headerBorder : "none",
    borderLeft: table.showInnerVerticalBorder ? headerBorder : baseBorder,
    borderRight: table.showInnerVerticalBorder ? headerBorder : baseBorder,
    padding: `${table.cellPaddingY}px ${table.cellPaddingX}px`,
    whiteSpace,
    textIndent: 0,
  };
  const bodyCellStyle: CSSProperties = {
    backgroundColor: tableBody.bodyBackgroundColor,
    color: tableBody.color,
    fontFamily: `"${tableBody.chineseFont}", "${tableBody.latinFont}", sans-serif`,
    fontSize: `${tableBody.bodyFontSize}pt`,
    lineHeight: tableBody.bodyLineHeight,
    minHeight: `${table.minRowHeight}px`,
    textAlign: resolveTextAlign(tableBody.bodyAlign),
    verticalAlign: resolveVerticalAlign(tableBody.bodyVerticalAlign),
    borderTop: table.showInnerHorizontalBorder ? bodyBorder : "none",
    borderBottom: table.showInnerHorizontalBorder ? bodyBorder : baseBorder,
    borderLeft: table.showInnerVerticalBorder ? bodyBorder : baseBorder,
    borderRight: table.showInnerVerticalBorder ? bodyBorder : baseBorder,
    padding: `${table.cellPaddingY}px ${table.cellPaddingX}px`,
    whiteSpace,
    textIndent: 0,
  };
  const markdownBlocks = markdown?.trim() ? parseMarkdownPreview(markdown) : [];
  const hasMarkdownPreview = markdownBlocks.length > 0;
  const fallbackBlocks = createFallbackBlocks(captionText(caption, "图片样式预览"), captionText(tableCaption, "表格样式预览"));
  const activeBlocks = applyMarkdownFeatureSettings(hasMarkdownPreview ? markdownBlocks : fallbackBlocks, styleConfig?.markdownFeatures ?? defaultMarkdownFeatures);
  const previewDrafts = { "heading-1": heading1, "heading-2": heading2, "heading-3": heading3, "heading-4": heading4, "heading-5": heading5, "heading-6": heading6, normal, quote, code, image, caption, "inline-code": inlineCode, "bullet-list": bulletList, "numbered-list": numberedList, "nested-list": nestedList };
  const pageChromeHeight = (headerEnabled && headerText ? 30 : 0) + (footerEnabled ? 26 : 0);
  const pageContentHeight = Math.max(320, paperHeight - pageMargins.top - pageMargins.bottom - pageChromeHeight);
  const shouldPaginate = paginate && hasMarkdownPreview;
  const numberedBlocks = annotateHeadingNumbers(activeBlocks, previewDrafts);
  const previewBlocks = shouldPaginate ? splitLargeBlocks(numberedBlocks, pageContentHeight, previewDrafts, table, contentWidth) : numberedBlocks;
  const previewPages = shouldPaginate ? paginateBlocks(previewBlocks, pageContentHeight, previewDrafts, table, contentWidth) : [previewBlocks];
  const scale = interactiveViewport
    ? requestedScale
    : viewportWidth > 0
      ? Math.min(requestedScale, Math.max(0.25, (viewportWidth - 12) / paperWidth))
      : requestedScale;
  const previewHeaderSubtitle = headerSubtitle;
  const previewBadgeText = badgeText ?? `当前：${selectedStyle?.name ?? "Heading 2"}`;
  const pageScaleStyle: CSSProperties = { position: "relative", width: paperWidth * scale, height: paperHeight * scale };
  const pageStyle: CSSProperties = { position: "absolute", inset: 0, width: paperWidth, height: paperHeight, padding: `${pageMargins.top}px ${pageMargins.right}px ${pageMargins.bottom}px ${pageMargins.left}px`, transform: `scale(${scale})`, transformOrigin: "top left" };

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!interactiveViewport) return;
    if (event.button !== 0) return;
    const element = viewportRef.current;
    if (!element) return;
    const canDrag = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
    if (!canDrag) return;

    dragStateRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    };
    element.setPointerCapture(event.pointerId);
    setIsDraggingPreview(true);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!interactiveViewport) return;
    const element = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!element || !dragState.dragging) return;

    element.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX);
    element.scrollTop = dragState.scrollTop - (event.clientY - dragState.startY);
  }

  function stopPreviewDrag(event: PointerEvent<HTMLDivElement>) {
    if (!interactiveViewport) return;
    if (!dragStateRef.current.dragging) return;
    dragStateRef.current.dragging = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDraggingPreview(false);
  }

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || interactiveViewport) return undefined;

    const updateWidth = () => {
      const style = window.getComputedStyle(element);
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      setViewportWidth(Math.max(0, element.clientWidth - horizontalPadding));
    };
    updateWidth();

    if (!window.ResizeObserver) return undefined;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [interactiveViewport]);

  return (
    <AppSurface variant="plain" radius="sm" padding="none" className={cn("flex h-full max-h-[min(780px,calc(100dvh-220px))] min-h-0 min-w-0 flex-col overflow-hidden p-3 max-xl:max-h-none", className)}>
      {showHeader ? (
      <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{headerTitle}</p>
          {previewHeaderSubtitle ? <p className="truncate text-xs text-slate-500">{previewHeaderSubtitle}</p> : null}
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">{previewBadgeText}</span>
      </div>
      ) : null}
      <div
        ref={viewportRef}
        className={cn(
          "min-h-0 flex-1 rounded-lg bg-slate-200/60 p-3 2xl:p-4",
          interactiveViewport ? "cursor-grab select-none overflow-auto active:cursor-grabbing" : "overflow-y-auto overflow-x-hidden",
          interactiveViewport && isDraggingPreview && "cursor-grabbing",
          viewportClassName,
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPreviewDrag}
        onPointerCancel={stopPreviewDrag}
        onPointerLeave={stopPreviewDrag}
      >
        {previewPages.map((pageBlocks, pageIndex) => (
        <div key={pageIndex} className={cn("mx-auto", pageIndex > 0 && "mt-5")} style={pageScaleStyle}>
        <div className="mk-word-preview-page overflow-hidden rounded-sm bg-white text-slate-900 shadow-none ring-1 ring-slate-200" style={pageStyle}>
          {headerEnabled && headerText ? <div className="mb-5 border-b border-slate-200 pb-2 text-[9px] text-slate-400">{headerText}</div> : null}
          {renderMarkdownBlocks({
            blocks: pageBlocks,
            selectedStyle,
            drafts: previewDrafts,
            inlineCodeDraft: inlineCode,
            inlineCodeEnabled: styleConfig?.markdownFeatures.inlineCode ?? defaultMarkdownFeatures.inlineCode,
            tableStyle: { imageStyle, figureCaptionPosition: caption.captionPosition, figureCaptionStyle, captionPosition: tableCaption.captionPosition, captionStyle, headerStyle, bodyCellStyle, tableWidth, tableMargin, tableLayout: table.tableLayout, borderStyle: { border: baseBorder, ...sideBorders }, rowStripe: table.rowStripe, columnWidths: tableColumnWidths },
          })}
          {footerEnabled ? (() => {
            const pageNumber = footerStartPage + pageIndex;
            const pageNumberText = formatPreviewPageNumber(pageSettings?.footerPageNumberFormat ?? "page", pageNumber);
            const footerContent = [footerText, pageNumberText].filter(Boolean).join(" · ");
            return footerContent ? <div className="absolute bottom-5 left-0 right-0 px-8 text-center text-[9px] text-slate-300">{footerContent}</div> : null;
          })() : null}
        </div>
        </div>
        ))}
      </div>
    </AppSurface>
  );
}
