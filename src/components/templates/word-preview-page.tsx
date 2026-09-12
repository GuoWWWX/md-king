import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";
import MarkdownIt from "markdown-it";
import katexPlugin from "@vscode/markdown-it-katex";
import katex from "katex";
import "katex/dist/katex.min.css";
import { AppSurface } from "@/components/ui/app-surface";
import { MarkdownCalloutIcon } from "@/components/markdown-callout-icon";
import { codeBlockIndentPtFromInfo } from "@/components/editor/cm/code-block-indent";
import { parseMarkdownTable } from "@/components/editor/cm/markdown-table";
import { TooltipButton } from "@/components/ui/tooltip";
import { MediaPreviewDialog } from "@/components/media/image-viewer";
import { createDefaultStyleDraft, defaultMarkdownFeatures, defaultMarkdownRules, listMarkerOptions } from "@/lib/style-manager-data";
import { resolvePreviewImageSource } from "@/lib/tauri";
import { isExternalDocumentLink, nextMarkdownHeadingAnchor, normalizeBareExternalLink } from "@/lib/document-links";
import { obsidianWikilinkPlugin } from "@/lib/obsidian-wikilinks";
import { syntaxPaletteFor } from "@/lib/syntax-palette";
import { getCachedMermaidSvg, isMermaidLanguage, renderMermaid } from "@/lib/mermaid";
import { calculatePreviewContentHeight, estimateImageBlockHeight, estimateMermaidBlockHeight, estimateTableColumnContentWidths, paginateByEstimatedHeight, resolveWordAutoLineHeightPx, splitTableRows, type PreviewBlockSplit, type PreviewImageSize, type PreviewMermaidSize } from "@/lib/word-preview-pagination";
import { svgDataUrl } from "@/lib/svg-image";
import { parseMarkdownCalloutHeader, separateMarkdownCallouts, type MarkdownCalloutTone } from "@/lib/markdown-callout";
import { splitYamlFrontmatter, type MarkdownFrontmatter } from "@/lib/markdown-frontmatter";
import { extractExplicitImageCaptions } from "@/lib/markdown-image-caption";
import { normalizeAdjacentBoldTableCaptions } from "@/lib/markdown-block-caption";
import { isConventionalUnnumberedHeading, parseUnnumberedHeadingText } from "@/lib/markdown-heading-attributes";
import { markdownCaptionText, mermaidFenceCaption } from "@/lib/mermaid-fence";
import { relaxedStrongPlugin } from "@/lib/relaxed-strong";
import { cn } from "@/lib/utils";
import type { MarkdownFeatureSettings, MarkdownHeadingStyleId, MarkdownRulesSettings, StyleDraft, StyleNode, TemplateStyleConfig, TocLeaderStyle } from "@/types/style-manager";

type WordPreviewPageProps = {
  selectedStyle?: StyleNode;
  styleConfig?: TemplateStyleConfig;
  zoom?: number;
  markdown?: string;
  markdownSourcePath?: string;
  showHeader?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  badgeText?: string;
  pageWidth?: number;
  pageMinHeight?: number;
  paginate?: boolean;
  showTocPage?: boolean;
  thumbnailContainer?: HTMLElement | null;
  onThumbnailPageSelect?: (page: number) => void;
  onPreviewOutlineChange?: (items: PreviewOutlineItem[]) => void;
  onOpenLink?: (target: string) => void;
  showPageFooter?: boolean;
  interactiveViewport?: boolean;
  paperTheme?: "light" | "dark";
  className?: string;
  viewportClassName?: string;
};

export type PreviewOutlineItem = {
  id: string;
  level: HeadingLevel;
  text: string;
  number?: string;
  page: number;
};

type PreviewBlock =
  | { type: "heading"; level: HeadingLevel; text: string; number?: string; anchorId?: string; isDocumentTitle?: boolean; unnumbered?: boolean }
  | { type: "toc"; entries: Array<{ level: HeadingLevel; text: string; number?: string; anchorId?: string; page?: number }> }
  | { type: "paragraph"; segments: PreviewTextSegment[]; metadata?: "author" | "date"; continuedFromPrevious?: boolean; continuesNext?: boolean }
  | { type: "quote"; segments: PreviewTextSegment[]; callout?: { type: string; tone: MarkdownCalloutTone; title: string } }
  | { type: "code"; text: string; language?: string; indentPt: number; caption?: string; continuedFromPrevious?: boolean; continuesNext?: boolean }
  | { type: "math"; text: string }
  | { type: "hr" }
  | { type: "list"; items: PreviewListItem[]; continuedFromPrevious?: boolean; continuesNext?: boolean }
  | { type: "image"; src?: string; alt?: string; caption?: string }
  | { type: "table"; caption?: string; header?: PreviewTableCell[]; rows: PreviewTableCell[][]; bodyRowOffset?: number; columnWidthPercentages?: number[] };

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type PreviewTextSegment = { text: string; code?: boolean; math?: boolean; bold?: boolean; italic?: boolean; strike?: boolean; link?: string };
type PreviewListItem = { segments: PreviewTextSegment[]; level: number; ordered: boolean; index: number; task?: "checked" | "unchecked" };
type PreviewTableCell = { segments: PreviewTextSegment[] };
type MarkdownInlineToken = {
  type: string;
  content?: string;
  info?: string;
  markup?: string;
  attrs?: Array<[string, string]> | null;
  meta?: { mkWikilinkTarget?: string } | null;
  children?: MarkdownInlineToken[] | null;
};

// Pandoc 导出侧开启了 tex_math_single_backslash，支持 \(...\) 与 \[...\]，
// 但 @vscode/markdown-it-katex 只认 $ 分隔符，缺这条规则预览会把分隔符当转义字符吃掉。
function backslashMathPlugin(md: MarkdownIt) {
  md.block.ruler.before("fence", "math_block_backslash", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, start + 2) !== "\\[") return false;

    let closeLine = -1;
    let content = "";
    const firstRest = state.src.slice(start + 2, max);
    const inlineClose = firstRest.indexOf("\\]");

    if (inlineClose >= 0) {
      if (firstRest.slice(inlineClose + 2).trim()) return false;
      closeLine = startLine;
      content = firstRest.slice(0, inlineClose);
    } else {
      const parts = [firstRest];
      let line = startLine + 1;
      while (line < endLine) {
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        const closeIndex = text.indexOf("\\]");
        if (closeIndex >= 0) {
          if (text.slice(closeIndex + 2).trim()) return false;
          parts.push(text.slice(0, closeIndex));
          closeLine = line;
          break;
        }
        parts.push(text);
        line += 1;
      }
      content = parts.join("\n");
    }

    if (closeLine < 0 || !content.trim()) return false;
    if (silent) return true;

    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.markup = "\\[";
    token.map = [startLine, closeLine + 1];
    state.line = closeLine + 1;
    return true;
  });

  md.inline.ruler.before("escape", "math_inline_backslash", (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x5c) return false;

    const open = state.src.slice(start, start + 2);
    if (open !== "\\(" && open !== "\\[") return false;

    const close = open === "\\(" ? "\\)" : "\\]";
    const end = state.src.indexOf(close, start + 2);
    if (end < 0) return false;

    const content = state.src.slice(start + 2, end).trim();
    if (!content) return false;
    if (!silent) {
      const token = state.push(open === "\\(" ? "math_inline" : "math_inline_double", "math", 0);
      token.content = content;
      token.markup = open;
    }
    state.pos = end + close.length;
    return true;
  });
}

const markdownParser = new MarkdownIt({ html: false, linkify: true, typographer: false })
  .use(obsidianWikilinkPlugin)
  .use(relaxedStrongPlugin)
  .use(katexPlugin, { throwOnError: false, enableBareBlocks: true })
  .use(backslashMathPlugin);
// 与 Rust 端 is_math_fence_language 保持一致，避免预览与导出对 ```math 的判定不同。
const mathFenceLanguages = new Set(["math", "latex", "tex", "formula", "equation", "公式"]);
const PT_TO_PX = 4 / 3;
const CSS_DPI = 96;
const WORD_TEXT_CHARACTER_SPACING_PT = 0.2;
const WORD_CJK_LATIN_GAP_PT = 2.8;
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

/**
 * 行高在样式管理器里是纯文本输入（见 template-style-manager.tsx 的「表格体行高」），
 * 用户可以填任意内容。`Number("abc")` 是 NaN，而 `draft.lineHeight || 1.5` 这种写法
 * 又拦不住它——非空字符串本身是 truthy，兜底值根本轮不到。NaN 会一路传进
 * estimateBlockHeight，让 paginateBlocks 的 `usedHeight + blockHeight > pageContentHeight`
 * 恒为 false，分页彻底失效、整篇内容挤在第一页。
 *
 * 这里和 Rust 导出侧的 read_line_height_key（convert.rs）对齐：只接受有限正数，
 * 其余一律回退，保证预览和导出对同一份非法输入给出相同结果。
 */
function resolveLineHeightValue(value: string | number | undefined, fallback = 1.5) {
  const lineHeight = Number(value);
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallback;
}

function resolveLineHeightPx(draft: StyleDraft) {
  return resolveWordAutoLineHeightPx(draft.fontSize, draft.lineHeight);
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

function tableColumnWidthPercentages(percentages: [number, number, number], columnCount: number) {
  if (columnCount <= 1) return [100];
  const raw = columnCount === 2
    ? percentages.slice(0, 2)
    : [percentages[0], percentages[1], ...Array.from({ length: columnCount - 2 }, () => percentages[2] / (columnCount - 2))];
  const total = raw.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return [];
  return raw.map((value) => Math.max(0, value) / total * 100);
}

function tableColumnWidths(percentages: [number, number, number], columnCount: number) {
  return tableColumnWidthPercentages(percentages, columnCount).map((value) => `${value.toFixed(3)}%`);
}

function percentageColumnWidths(percentages: readonly number[]) {
  return percentages.map((value) => `${value.toFixed(3)}%`);
}

function codeBlockBorder(draft: StyleDraft) {
  return `1px solid ${draft.codeBorderColor || "#E2E8F0"}`;
}

const emojiFontFallback = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';

function previewFontFamily(chineseFont: string, latinFont: string, generic = "sans-serif") {
  // Match Word's run fallback: ASCII uses the Latin font and East Asian text
  // uses the configured Chinese font. This keeps mixed-text line breaks close
  // to the generated DOCX instead of letting the Chinese font shape numbers.
  return `"${latinFont}", "${chineseFont}", ${emojiFontFallback}, ${generic}`;
}

function textStyle(draft: StyleDraft): CSSProperties {
  return {
    color: draft.color,
    fontFamily: previewFontFamily(draft.chineseFont, draft.latinFont),
    fontSize: `${draft.fontSize}pt`,
    fontWeight: draft.fontWeight,
    letterSpacing: `${WORD_TEXT_CHARACTER_SPACING_PT}pt`,
    lineHeight: `${resolveLineHeightPx(draft)}px`,
    marginTop: `${draft.beforeSpacing}pt`,
    marginBottom: `${draft.afterSpacing}pt`,
    textAlign: resolveTextAlign(draft.align),
    textIndent: `${draft.firstLineIndent}em`,
    backgroundColor: draft.backgroundColor === "transparent" ? undefined : draft.backgroundColor,
  };
}

function inlineCodeStyle(draft: StyleDraft): CSSProperties {
  return {
    color: draft.color,
    fontFamily: previewFontFamily(draft.chineseFont, draft.latinFont, "monospace"),
    fontSize: `${draft.fontSize}pt`,
    fontWeight: draft.fontWeight,
    letterSpacing: 0,
    lineHeight: `${resolveWordAutoLineHeightPx(draft.fontSize, 1.35)}px`,
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

// 与 Rust 端 parse_fence_language 对齐：既要吃掉 ```{.math} 这类 Pandoc attribute 语法，
// 也要跳过 ```{#id key=value} 里的非语言 token，否则预览与导出会认出不同的语言。
function parseFenceLanguage(info?: string) {
  const trimmed = info?.trim() ?? "";
  if (!trimmed) return undefined;

  const normalized = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  for (const token of normalized.split(/\s+/)) {
    const candidate = token.trim().replace(/^\.+/, "");
    if (!candidate || candidate.startsWith("#") || candidate.includes("=")) continue;
    const language = candidate.replace(/[^\p{L}\p{N}+#\-_.]/gu, "");
    if (language) return language;
  }
  return undefined;
}

function normalizeCodeLanguage(info?: string) {
  const raw = parseFenceLanguage(info)?.replace(/^language-/, "").toLowerCase();
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
  return (languageLabels[language] ?? language).toUpperCase();
}

function hexToLuminance(value: string) {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0.1;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function syntaxPalette(backgroundColor: string | undefined) {
  // 深色底用亮色调色板。颜色值来自 lib/syntax-palette，编辑器那边取同一份，
  // 否则同一段代码在左右两栏会是两种配色。
  const dark = Boolean(backgroundColor && backgroundColor !== "transparent" && hexToLuminance(backgroundColor) < 0.45);
  return syntaxPaletteFor(dark);
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

function canMergeSegments(a: PreviewTextSegment, b: PreviewTextSegment) {
  if (a.math || b.math) return false;
  return Boolean(a.code) === Boolean(b.code)
    && Boolean(a.bold) === Boolean(b.bold)
    && Boolean(a.italic) === Boolean(b.italic)
    && Boolean(a.strike) === Boolean(b.strike)
    && a.link === b.link;
}

function mergeTextSegments(segments: PreviewTextSegment[]) {
  return segments.reduce<PreviewTextSegment[]>((merged, segment) => {
    if (!segment.text) return merged;
    const last = merged[merged.length - 1];
    if (last && canMergeSegments(last, segment)) {
      last.text += segment.text;
      return merged;
    }
    merged.push({ ...segment });
    return merged;
  }, []);
}

function renderKatexMarkup(text: string, displayMode: boolean) {
  try {
    return katex.renderToString(text, { displayMode, throwOnError: true, output: "html", strict: false });
  } catch {
    return undefined;
  }
}

function MathInline({ text }: { text: string }) {
  const markup = renderKatexMarkup(text, false);
  if (!markup) {
    return <span className="rounded bg-rose-50 px-1 font-mono text-[0.9em] text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">{text}</span>;
  }
  return <span className="md-king-math" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function MathBlock({ text, style, className }: { text: string; style?: CSSProperties; className?: string }) {
  const markup = renderKatexMarkup(text, true);
  if (!markup) {
    return (
      <div className={cn("whitespace-pre-wrap break-words rounded border border-rose-200 bg-rose-50 px-3 py-2 text-center font-mono text-[0.85em] text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300", className)} style={style}>
        {text}
      </div>
    );
  }
  return <div className={cn("md-king-math text-center", className)} style={style} dangerouslySetInnerHTML={{ __html: markup }} />;
}

/**
 * 代码块左上角的语言标签。
 *
 * 位置和编辑器侧的 .mk-cm-code-fence::before 对齐——此前预览放在右上角，
 * 同一份文档左右两栏的标签一个在左一个在右，看着像两个不同的东西。
 */
function CodeLanguageLabel({ label, backgroundColor }: { label: string; backgroundColor?: string }) {
  const dark = Boolean(backgroundColor && hexToLuminance(backgroundColor) < 0.45);
  return (
    <span
      className="absolute left-2 top-1 text-[8px] font-bold uppercase tracking-wide"
      style={{ color: syntaxPalette(backgroundColor).comment, opacity: dark ? 0.9 : 0.85 }}
    >
      {label}
    </span>
  );
}

/**
 * Word 预览里的 Mermaid 图。
 *
 * 和编辑器共用 lib/mermaid 的渲染与缓存，所以左右两栏拿到的是同一张图。
 * 渲染是异步的，先给一个占位再补上——直接返回空会让分页测高拿到 0 高度。
 */
function MermaidBlock({ source, dark, maxHeight, style, className, onSize }: { source: string; dark: boolean; maxHeight: number; style?: CSSProperties; className?: string; onSize?: (source: string, dark: boolean, size: PreviewMermaidSize) => void }) {
  const [svg, setSvg] = useState(() => getCachedMermaidSvg(source, dark)?.svg);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const cached = getCachedMermaidSvg(source, dark);
    if (cached) {
      setSvg(cached.svg);
      setError(undefined);
      onSize?.(source, dark, cached);
      return undefined;
    }

    let cancelled = false;
    setError(undefined);
    void renderMermaid(source, dark)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          onSize?.(source, dark, result);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "图表渲染失败");
      });

    return () => {
      cancelled = true;
    };
  }, [dark, onSize, source]);

  if (error) {
    return (
      <div className={cn("whitespace-pre-wrap break-words rounded border border-rose-200 bg-rose-50 px-3 py-2 font-mono text-[0.8em] text-rose-600", className)} style={style}>
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={cn("flex items-center justify-center px-3 py-6 text-[0.8em] text-slate-400", className)} style={style}>
        正在渲染图表…
      </div>
    );
  }

  return (
    <div className={cn("flex justify-center", className)} style={style}>
      <img
        src={svgDataUrl(svg)}
        alt="Mermaid 图表"
        className="block h-auto w-auto max-w-full object-contain"
        style={{ maxHeight }}
      />
    </div>
  );
}

function headingTextStyle(draft: StyleDraft): CSSProperties {
  return textStyle(draft);
}

function textSegments(text: string): PreviewTextSegment[] {
  return text ? [{ text }] : [];
}

function plainText(segments: PreviewTextSegment[]) {
  return segments.map((segment) => segment.text).join("");
}

// markdown-it 的 inline children 是扁平的 open/close 流，不是嵌套树，
// 所以这里用一个标记栈来跟踪加粗、斜体、删除线、链接的作用范围。
function inlineSegmentsFromToken(token: MarkdownInlineToken | undefined): PreviewTextSegment[] {
  if (!token) return [];
  const children = token.children ?? [];
  if (children.length === 0) return textSegments(token.content ?? "");

  const segments: PreviewTextSegment[] = [];
  const marks = { bold: 0, italic: 0, strike: 0 };
  const linkStack: Array<{ target: string; auto: boolean; wikilinkTarget?: string }> = [];

  const currentMarks = (): Omit<PreviewTextSegment, "text"> => ({
    bold: marks.bold > 0 || undefined,
    italic: marks.italic > 0 || undefined,
    strike: marks.strike > 0 || undefined,
    link: linkStack[linkStack.length - 1]?.target,
  });

  for (const child of children) {
    switch (child.type) {
      case "strong_open": marks.bold += 1; break;
      case "strong_close": marks.bold = Math.max(0, marks.bold - 1); break;
      case "em_open": marks.italic += 1; break;
      case "em_close": marks.italic = Math.max(0, marks.italic - 1); break;
      case "s_open": marks.strike += 1; break;
      case "s_close": marks.strike = Math.max(0, marks.strike - 1); break;
      case "link_open": linkStack.push({
        target: markdownTokenAttribute(child, "href") ?? "",
        auto: child.markup === "linkify",
        wikilinkTarget: child.meta?.mkWikilinkTarget,
      }); break;
      case "link_close": linkStack.pop(); break;
      case "text": {
        const text = child.content ?? "";
        const activeLink = linkStack[linkStack.length - 1];
        if (activeLink?.wikilinkTarget) {
          // 双链的显示名只服务编辑体验。为了和 DOCX 导出保持一致，Word 预览
          // 直接展示目标 URL 或文档路径，并保留原目标用于点击跳转。
          segments.push({ ...currentMarks(), text: activeLink.wikilinkTarget, link: activeLink.target });
          break;
        }
        if (activeLink?.auto && isExternalDocumentLink(activeLink.target) && /^https?:\/\//i.test(text)) {
          const target = normalizeBareExternalLink(text);
          const current = currentMarks();
          segments.push({ ...current, text: target, link: target });
          if (target.length < text.length) {
            const { link: _link, ...withoutLink } = current;
            segments.push({ ...withoutLink, text: text.slice(target.length) });
          }
          break;
        }
        segments.push({ ...currentMarks(), text });
        break;
      }
      case "code_inline": segments.push({ ...currentMarks(), text: child.content ?? "", code: true }); break;
      case "math_inline":
      case "math_inline_double": segments.push({ text: child.content ?? "", math: true }); break;
      case "softbreak":
      case "hardbreak": segments.push({ text: "\n" }); break;
      case "image": segments.push({ ...currentMarks(), text: plainText(inlineSegmentsFromToken(child)) }); break;
      default:
        // 未识别但带子节点的 token（例如插件产生的容器）仍然递归展开，避免整段文字丢失。
        if (child.children?.length) {
          segments.push(...inlineSegmentsFromToken(child).map((segment) => (segment.math ? segment : { ...currentMarks(), ...segment })));
        } else if (child.content) {
          segments.push({ ...currentMarks(), text: child.content });
        }
        break;
    }
  }

  return mergeTextSegments(segments);
}

function inlineSegmentsFromMarkdown(source: string): PreviewTextSegment[] {
  return inlineSegmentsFromToken(markdownParser.parseInline(source, {})[0]);
}

function markdownTokenAttribute(token: MarkdownInlineToken, name: string) {
  return token.attrs?.find(([key]) => key === name)?.[1];
}

function inlineImageBlocks(token: MarkdownInlineToken | undefined): Array<Extract<PreviewBlock, { type: "image" }>> {
  return (token?.children ?? [])
    .filter((child) => child.type === "image")
    .map((child) => ({
      type: "image" as const,
      src: markdownTokenAttribute(child, "src"),
      alt: plainText(inlineSegmentsFromToken(child)).trim() || child.content?.trim(),
    }));
}

function isImageOnlyInline(token: MarkdownInlineToken | undefined) {
  const children = token?.children ?? [];
  return children.length > 0 && children.every((child) => child.type === "image" || child.type === "softbreak" || child.type === "hardbreak");
}

function joinTextSegmentGroups(groups: PreviewTextSegment[][], separator: string) {
  return mergeTextSegments(groups.flatMap((group, index) => (index === 0 ? group : [{ text: separator }, ...group])));
}

function splitSegmentsAtFirstLine(segments: PreviewTextSegment[]) {
  const header: PreviewTextSegment[] = [];
  const body: PreviewTextSegment[] = [];
  let foundBreak = false;
  for (const segment of segments) {
    if (foundBreak) {
      body.push(segment);
      continue;
    }
    const breakIndex = segment.text.indexOf("\n");
    if (breakIndex < 0) {
      header.push(segment);
      continue;
    }
    if (breakIndex > 0) header.push({ ...segment, text: segment.text.slice(0, breakIndex) });
    if (breakIndex + 1 < segment.text.length) body.push({ ...segment, text: segment.text.slice(breakIndex + 1) });
    foundBreak = true;
  }
  return { header: mergeTextSegments(header), body: mergeTextSegments(body) };
}

function calloutQuote(parts: PreviewTextSegment[][]): Extract<PreviewBlock, { type: "quote" }> | undefined {
  const joined = joinTextSegmentGroups(parts, "\n");
  const lines = splitSegmentsAtFirstLine(joined);
  const parsed = parseMarkdownCalloutHeader(plainText(lines.header));
  if (!parsed) return undefined;
  return {
    type: "quote",
    segments: lines.body,
    callout: {
      type: parsed.type,
      tone: parsed.tone,
      title: parsed.title || parsed.defaultTitle,
    },
  };
}

function inlineMarkStyle(segment: PreviewTextSegment): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (segment.bold) style.fontWeight = 700;
  if (segment.italic) style.fontStyle = "italic";
  if (segment.strike) style.textDecorationLine = "line-through";
  if (segment.link !== undefined) {
    // Word 默认 Hyperlink 样式就是蓝色加下划线，预览保持一致。
    style.color = "#0563C1";
    style.textDecorationLine = segment.strike ? "line-through underline" : "underline";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function isWordCjkCharacter(character: string) {
  return /^[\u3400-\u9fff]$/.test(character);
}

function isWordLatinCharacter(character: string) {
  return /^[A-Za-z0-9]$/.test(character);
}

function isWordCjkLatinBoundary(left: string | undefined, right: string) {
  if (!left) return false;
  return (isWordCjkCharacter(left) && isWordLatinCharacter(right))
    || (isWordLatinCharacter(left) && isWordCjkCharacter(right));
}

function renderWordCompatibleText(
  text: string,
  keyPrefix: string,
  style?: CSSProperties,
  previousCharacter?: string,
  includeBoundaryGap = true,
) {
  const pieces: Array<{ text: string; gapBefore: boolean }> = [];
  let current = "";
  let previous = previousCharacter;

  for (const character of Array.from(text)) {
    const gapBefore = includeBoundaryGap && isWordCjkLatinBoundary(previous, character);
    if (gapBefore && current) {
      pieces.push({ text: current, gapBefore: false });
      current = "";
    }
    current += character;
    if (gapBefore) pieces.push({ text: current, gapBefore: true });
    previous = character;
    if (gapBefore) current = "";
  }
  if (current) pieces.push({ text: current, gapBefore: false });

  if (pieces.length <= 1) return style ? <span style={style}>{text}</span> : text;
  return pieces.map((piece, index) => (
    <span
      key={`${keyPrefix}-mixed-${index}`}
      style={{ ...style, ...(piece.gapBefore ? { marginLeft: `${WORD_CJK_LATIN_GAP_PT}pt` } : undefined) }}
    >
      {piece.text}
    </span>
  ));
}

function renderInlineTextLine(segments: PreviewTextSegment[], inlineCodeDraft: StyleDraft, inlineCodeEnabled: boolean, keyPrefix: string, selectedStyle: StyleNode | undefined, onOpenLink: (target: string) => void, includeBoundaryGap = true) {
  return segments.map((segment, index) => {
    if (segment.math) return <MathInline key={`${keyPrefix}-math-${index}`} text={segment.text} />;

    const markStyle = inlineMarkStyle(segment);
    let content: ReactNode;
    if (segment.code && inlineCodeEnabled) {
      content = (
        <code
          className={cn("mx-0.5 rounded px-1 py-0.5", selectedRing(selectedStyle, "inline-code"))}
          style={{ ...inlineCodeStyle(inlineCodeDraft), ...markStyle }}
        >
          {segment.text}
        </code>
      );
    } else {
      const previousCharacter = index > 0 ? segments[index - 1].text.slice(-1) : undefined;
      content = renderWordCompatibleText(segment.text, `${keyPrefix}-${index}`, markStyle, previousCharacter, includeBoundaryGap);
    }

    if (segment.link === undefined) return <span key={`${keyPrefix}-${index}`}>{content}</span>;
    return (
      <a
        key={`${keyPrefix}-link-${index}`}
        href={segment.link}
        className="cursor-pointer"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenLink(segment.link ?? "");
        }}
      >
        {content}
      </a>
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

function resolveHeadingNumber(level: HeadingLevel, draft: StyleDraft, counters: number[]) {
  if (!draft.autoNumbering || draft.numberFormat === "无编号") return undefined;

  const current = counters[level - 1] || 1;
  if (draft.numberFormat === "一、") return `${toChineseNumber(current)}、`;
  if (draft.numberFormat === "第一章") return `第${toChineseNumber(current)}章`;

  if (/^1(?:\.1){0,5}$/.test(draft.numberFormat)) {
    const requestedDepth = draft.numberFormat.split(".").length;
    const depth = Math.min(level, requestedDepth);
    const parts = counters.slice(0, depth).map((value) => value || 1);
    return parts.join(".");
  }

  return draft.numberFormat;
}

function listMarkerFromStyle(value: StyleDraft["listMarkerStyle"]) {
  return listMarkerOptions.find((option) => option.value === value)?.marker ?? "•";
}

function listNumberText(format: string, index: number) {
  if (format === "1)") return `${index})`;
  if (format === "(1)") return `(${index})`;
  if (format === "01.") return `${String(index).padStart(2, "0")}.`;
  if (format === "A.") return `${alphabeticMarker(index)}.`;
  if (format === "A)") return `${alphabeticMarker(index)})`;
  if (format === "a.") return `${alphabeticMarker(index).toLowerCase()}.`;
  if (format === "a)") return `${alphabeticMarker(index).toLowerCase()})`;
  if (format === "I.") return `${romanMarker(index)}.`;
  if (format === "I)") return `${romanMarker(index)})`;
  if (format === "i.") return `${romanMarker(index).toLowerCase()}.`;
  if (format === "i)") return `${romanMarker(index).toLowerCase()})`;
  if (format === "一、") return `${toChineseNumber(index)}、`;
  if (format === "（一）") return `（${toChineseNumber(index)}）`;
  return `${index}.`;
}

function alphabeticMarker(value: number) {
  let next = Math.max(1, Math.floor(value));
  const chars: string[] = [];
  while (next > 0) {
    next -= 1;
    chars.unshift(String.fromCharCode(65 + (next % 26)));
    next = Math.floor(next / 26);
  }
  return chars.join("");
}

function romanMarker(value: number) {
  let next = Math.max(1, Math.min(3999, Math.floor(value)));
  const parts: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let result = "";
  parts.forEach(([amount, marker]) => {
    while (next >= amount) {
      result += marker;
      next -= amount;
    }
  });
  return result;
}

function listMarkerTypeFromStyle(draft: StyleDraft, item: Pick<PreviewListItem, "level" | "ordered">) {
  const configured = [draft.listLevel1Type, draft.listLevel2Type, draft.listLevel3Type, draft.listLevel4Type][Math.min(3, Math.max(0, item.level))];
  return configured === "number" || configured === "bullet" ? configured : item.ordered ? "number" : "bullet";
}

function markerTextFromStyle(draft: StyleDraft, item: PreviewListItem, markerType: "bullet" | "number", displayIndex = item.index) {
  if (item.task === "checked") return "☑";
  if (item.task === "unchecked") return "☐";
  return markerType === "number" ? listNumberText(draft.numberFormat, displayIndex) : listMarkerFromStyle(draft.listMarkerStyle);
}

function resolveListIndent(draft: StyleDraft, item: Pick<PreviewListItem, "level">) {
  void item;
  return Math.max(0, draft.listIndent);
}

function resolveListLevelDraft(draft: StyleDraft, item: Pick<PreviewListItem, "level">): StyleDraft {
  const level = Math.min(4, Math.max(1, item.level + 1));
  if (level === 1) {
    return { ...draft, chineseFont: draft.listLevel1ChineseFont, latinFont: draft.listLevel1LatinFont, fontSize: draft.listLevel1FontSize, fontWeight: draft.listLevel1FontWeight, color: draft.listLevel1Color, lineHeight: draft.listLevel1LineHeight, beforeSpacing: draft.listLevel1BeforeSpacing, afterSpacing: draft.listLevel1AfterSpacing, align: draft.listLevel1Align, listMarkerStyle: draft.listLevel1MarkerStyle, numberFormat: draft.listLevel1NumberFormat, listIndent: draft.listLevel1Indent, listTextIndent: draft.listLevel1TextIndent, listWrapMode: draft.listLevel1WrapMode, listNumberingMode: draft.listLevel1NumberingMode };
  }
  if (level === 2) {
    return { ...draft, chineseFont: draft.listLevel2ChineseFont, latinFont: draft.listLevel2LatinFont, fontSize: draft.listLevel2FontSize, fontWeight: draft.listLevel2FontWeight, color: draft.listLevel2Color, lineHeight: draft.listLevel2LineHeight, beforeSpacing: draft.listLevel2BeforeSpacing, afterSpacing: draft.listLevel2AfterSpacing, align: draft.listLevel2Align, listMarkerStyle: draft.listLevel2MarkerStyle, numberFormat: draft.listLevel2NumberFormat, listIndent: draft.listLevel2Indent, listTextIndent: draft.listLevel2TextIndent, listWrapMode: draft.listLevel2WrapMode, listNumberingMode: draft.listLevel2NumberingMode };
  }
  if (level === 3) {
    return { ...draft, chineseFont: draft.listLevel3ChineseFont, latinFont: draft.listLevel3LatinFont, fontSize: draft.listLevel3FontSize, fontWeight: draft.listLevel3FontWeight, color: draft.listLevel3Color, lineHeight: draft.listLevel3LineHeight, beforeSpacing: draft.listLevel3BeforeSpacing, afterSpacing: draft.listLevel3AfterSpacing, align: draft.listLevel3Align, listMarkerStyle: draft.listLevel3MarkerStyle, numberFormat: draft.listLevel3NumberFormat, listIndent: draft.listLevel3Indent, listTextIndent: draft.listLevel3TextIndent, listWrapMode: draft.listLevel3WrapMode, listNumberingMode: draft.listLevel3NumberingMode };
  }
  return { ...draft, chineseFont: draft.listLevel4ChineseFont, latinFont: draft.listLevel4LatinFont, fontSize: draft.listLevel4FontSize, fontWeight: draft.listLevel4FontWeight, color: draft.listLevel4Color, lineHeight: draft.listLevel4LineHeight, beforeSpacing: draft.listLevel4BeforeSpacing, afterSpacing: draft.listLevel4AfterSpacing, align: draft.listLevel4Align, listMarkerStyle: draft.listLevel4MarkerStyle, numberFormat: draft.listLevel4NumberFormat, listIndent: draft.listLevel4Indent, listTextIndent: draft.listLevel4TextIndent, listWrapMode: draft.listLevel4WrapMode, listNumberingMode: draft.listLevel4NumberingMode };
}

function resolveListBaseDraft(drafts: Record<string, StyleDraft>, item: PreviewListItem) {
  if (item.level > 0) return drafts["nested-list"];
  return item.ordered ? drafts["numbered-list"] : drafts["bullet-list"];
}

function listMarkerWidthPt(marker: string) {
  // Keep the preview aligned with convert.rs::list_marker_and_gap_twips:
  // Word reserves 6pt per ASCII marker character and 12pt per non-ASCII one.
  return Array.from(marker).reduce((width, character) => width + (/^[\x00-\x7F]$/.test(character) ? 6 : 12), 0);
}

function resolveListTextOffsetPx(draft: StyleDraft, item: PreviewListItem) {
  const markerType = listMarkerTypeFromStyle(draft, item);
  const marker = markerTextFromStyle(draft, item, markerType);
  const markerLeftPt = resolveListIndent(draft, item) * draft.fontSize;
  const markerGapPt = Math.max(0, draft.listTextIndent) * 6;
  return ptToPx(markerLeftPt + listMarkerWidthPt(marker) + markerGapPt);
}

function applyHeadingMappings(blocks: PreviewBlock[], mappings: MarkdownRulesSettings["headingMappings"]) {
  return blocks.map((block) => {
    if (block.type !== "heading") return block;
    if (block.isDocumentTitle) return block;
    const sourceStyleId = `heading-${block.level}` as MarkdownHeadingStyleId;
    const target = mappings[sourceStyleId] ?? sourceStyleId;
    if (target === "title") return { ...block, level: 1 as HeadingLevel, isDocumentTitle: true };
    const targetLevel = Number(target.replace("heading-", "")) as HeadingLevel;
    return { ...block, level: targetLevel, isDocumentTitle: false };
  });
}

function annotateHeadingNumbers(blocks: PreviewBlock[], drafts: Record<string, StyleDraft>) {
  const counters = [0, 0, 0, 0, 0, 0];

  return blocks.map((block) => {
    if (block.type !== "heading") return block;
    if (block.isDocumentTitle) return { ...block, number: undefined };
    if (block.unnumbered) return { ...block, number: undefined };
    counters[block.level - 1] += 1;
    for (let index = block.level; index < counters.length; index += 1) counters[index] = 0;

    const styleId = `heading-${block.level}`;
    return {
      ...block,
      number: resolveHeadingNumber(block.level, drafts[styleId], counters),
    };
  });
}

function tocDepth(value: string | undefined) {
  const matched = value?.match(/(\d+)\s*-\s*(\d+)/);
  return matched ? Math.min(6, Math.max(1, Number(matched[2]))) : 3;
}

function estimateTocHeight(entries: Extract<PreviewBlock, { type: "toc" }>['entries'], drafts: Record<string, StyleDraft>, contentWidth: number) {
  const titleDraft = drafts["heading-1"];
  const bodyDraft = drafts.normal;
  const titleHeight = ptToPx(titleDraft.beforeSpacing + titleDraft.afterSpacing)
    + resolveLineHeightPx(titleDraft);
  const entriesHeight = entries.reduce((total, entry) => {
    const indent = (entry.level - 1) * ptToPx(bodyDraft.fontSize) * 2;
    const text = `${entry.number ? `${entry.number} ` : ""}${entry.text}`;
    return total
      + estimateTextLines(text, estimateCharsPerLine(Math.max(80, contentWidth - indent), bodyDraft)) * resolveLineHeightPx(bodyDraft)
      + ptToPx(bodyDraft.afterSpacing);
  }, 0);

  return titleHeight + entriesHeight;
}

type TocTitlePreviewSettings = {
  fontSize: number;
  lineHeight: string;
  beforeSpacing: number;
  afterSpacing: number;
};

function estimateTocHeightWithSettings(entries: Extract<PreviewBlock, { type: "toc" }>['entries'], drafts: Record<string, StyleDraft>, contentWidth: number, titleSettings?: TocTitlePreviewSettings) {
  if (!titleSettings) return estimateTocHeight(entries, drafts, contentWidth);
  const bodyDraft = drafts.normal;
  const titleHeight = ptToPx(titleSettings.beforeSpacing + titleSettings.afterSpacing)
      + resolveWordAutoLineHeightPx(titleSettings.fontSize, titleSettings.lineHeight);
  const entriesHeight = entries.reduce((total, entry) => {
    const indent = (entry.level - 1) * ptToPx(bodyDraft.fontSize) * 2;
    const text = `${entry.number ? `${entry.number} ` : ""}${entry.text}`;
    return total
      + estimateTextLines(text, estimateCharsPerLine(Math.max(80, contentWidth - indent), bodyDraft)) * resolveLineHeightPx(bodyDraft)
      + ptToPx(bodyDraft.afterSpacing);
  }, 0);
  return titleHeight + entriesHeight;
}

function createPreviewTocPages(blocks: PreviewBlock[], enabled: boolean, depth: string | undefined, pageContentHeight: number, drafts: Record<string, StyleDraft>, contentWidth: number, firstPageReservedHeight = 0, titleSettings?: TocTitlePreviewSettings): PreviewBlock[][] {
  if (!enabled) return [];
  const maxLevel = tocDepth(depth);
  const entries = blocks
    .filter((block): block is Extract<PreviewBlock, { type: "heading" }> => block.type === "heading" && !block.isDocumentTitle && block.level <= maxLevel)
    .map((block) => ({ level: block.level, text: block.text, number: block.number, anchorId: block.anchorId }));
  if (entries.length === 0) return [];

  const pages: PreviewBlock[][] = [];
  let currentEntries: typeof entries = [];
  for (const entry of entries) {
    const availableHeight = pageContentHeight - (pages.length === 0 ? firstPageReservedHeight : 0);
    const nextEntries = [...currentEntries, entry];
    if (currentEntries.length > 0 && estimateTocHeightWithSettings(nextEntries, drafts, contentWidth, titleSettings) > availableHeight) {
      pages.push([{ type: "toc", entries: currentEntries }]);
      currentEntries = [entry];
      continue;
    }
    currentEntries = nextEntries;
  }
  if (currentEntries.length > 0) pages.push([{ type: "toc", entries: currentEntries }]);
  return pages;
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

    const segments = joinTextSegmentGroups(parts, " ");
    const taskMatch = plainText(segments).match(/^\[([ xX])\]\s*/);
    const task = taskMatch?.[1].trim() ? "checked" : taskMatch ? "unchecked" : undefined;
    const taskPrefix = taskMatch?.[0] ?? "";
    const taskSegments = taskPrefix
      ? segments.map((segment, segmentIndex) => (segmentIndex === 0 ? { ...segment, text: segment.text.replace(taskPrefix, "") } : segment))
      : segments;
    items.push({ segments: taskSegments, level, ordered, index: itemIndex, task });
    items.push(...nestedItems);
    index += 1;
  }

  return { items, nextIndex: index };
}

function parseMarkdownPreview(markdown: string): { blocks: PreviewBlock[]; metadata?: MarkdownFrontmatter } {
  const frontmatter = splitYamlFrontmatter(markdown);
  const extractedCaptions = extractExplicitImageCaptions(frontmatter.markdown);
  const previewMarkdown = separateMarkdownCallouts(normalizeAdjacentBoldTableCaptions(extractedCaptions.markdown));
  const tokens = markdownParser.parse(previewMarkdown, {});
  const markdownLines = previewMarkdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PreviewBlock[] = [];
  const headingAnchorCounts = new Map<string, number>();
  let pendingTableCaption: string | undefined;
  let pendingMermaidCaption: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token.type === "heading_open" && next?.type === "inline") {
      const level = Number(token.tag.slice(1));
      const normalizedLevel = Math.min(6, Math.max(1, level)) as HeadingLevel;
      const parsedHeading = parseUnnumberedHeadingText(plainText(inlineSegmentsFromToken(next)));
      const text = parsedHeading.text;
      const unnumbered = parsedHeading.unnumbered || isConventionalUnnumberedHeading(text);
      blocks.push({ type: "heading", level: normalizedLevel, text, unnumbered, anchorId: nextMarkdownHeadingAnchor(text, headingAnchorCounts) });
      index += 2;
      continue;
    }

    if (token.type === "paragraph_open" && next?.type === "inline") {
      const adjacentCaption = markdownCaptionText(next.content);
      const adjacentBlock = tokens[index + 3];
      const directlyBeforeBlock = token.map && adjacentBlock?.map && token.map[1] === adjacentBlock.map[0];
      if (adjacentCaption && directlyBeforeBlock && adjacentBlock.type === "table_open") {
        pendingTableCaption = adjacentCaption;
        index += 2;
        continue;
      }
      if (adjacentCaption && directlyBeforeBlock && adjacentBlock.type === "fence" && isMermaidLanguage(normalizeCodeLanguage(adjacentBlock.info))) {
        pendingMermaidCaption = adjacentCaption;
        index += 2;
        continue;
      }
      if (isImageOnlyInline(next)) {
        const imageIndex = blocks.filter((block) => block.type === "image").length;
        blocks.push(...inlineImageBlocks(next).map((block, offset) => ({
          ...block,
          caption: extractedCaptions.captionsByImageIndex.get(imageIndex + offset),
        })));
        index += 2;
        continue;
      }
      blocks.push({ type: "paragraph", segments: inlineSegmentsFromToken(next) });
      index += 2;
      continue;
    }

    if (token.type === "math_block" || token.type === "math_block_eqno") {
      blocks.push({ type: "math", text: token.content.trim() });
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      const language = token.type === "fence" ? normalizeCodeLanguage(token.info) : undefined;
      const indentPt = token.type === "fence" ? codeBlockIndentPtFromInfo(token.info) : 0;
      let caption = token.type === "fence" && isMermaidLanguage(language)
        ? mermaidFenceCaption(token.info) ?? pendingMermaidCaption
        : undefined;
      if (token.type === "fence" && isMermaidLanguage(language)) {
        const captionParagraph = tokens[index + 1];
        const captionInline = tokens[index + 2];
        const captionClose = tokens[index + 3];
        const followingCaption = captionParagraph?.type === "paragraph_open"
          && captionInline?.type === "inline"
          && captionClose?.type === "paragraph_close"
          && token.map && captionParagraph.map && token.map[1] === captionParagraph.map[0]
          ? markdownCaptionText(captionInline.content)
          : undefined;
        if (followingCaption && (!caption || caption === followingCaption)) {
          caption ??= followingCaption;
          index += 3;
        }
        pendingMermaidCaption = undefined;
      }
      // ```math / ```latex 等围栏在导出时会被 Rust 端转成 $$...$$，预览必须同样按公式渲染。
      if (language && mathFenceLanguages.has(language)) {
        blocks.push({ type: "math", text: token.content.trim() });
        continue;
      }
      blocks.push({ type: "code", text: token.content.trimEnd(), language, indentPt, caption });
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
      blocks.push(calloutQuote(parts) ?? { type: "quote", segments: joinTextSegmentGroups(parts, "\n") });
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
      const sourceTable = token.map
        ? parseMarkdownTable(markdownLines.slice(token.map[0], token.map[1]).join("\n"))
        : null;
      if (sourceTable) {
        const [header, ...rows] = sourceTable.rows.map((row) => row.map((cell) => ({ segments: inlineSegmentsFromMarkdown(cell) })));
        while (index < tokens.length && tokens[index].type !== "table_close") index += 1;
        const followingCaption = tokens[index + 1]?.type === "paragraph_open"
          && tokens[index + 2]?.type === "inline"
          && tokens[index + 3]?.type === "paragraph_close"
          && token.map && tokens[index + 1].map && token.map[1] === tokens[index + 1].map![0]
          ? markdownCaptionText(tokens[index + 2].content)
          : undefined;
        if (followingCaption) index += 3;
        if (header) blocks.push({ type: "table", caption: pendingTableCaption ?? followingCaption, header, rows });
        pendingTableCaption = undefined;
        continue;
      }

      const rows: PreviewTableCell[][] = [];
      let currentRow: PreviewTableCell[] | undefined;
      index += 1;
      while (index < tokens.length && tokens[index].type !== "table_close") {
        if (tokens[index].type === "tr_open") currentRow = [];
        if ((tokens[index].type === "td_open" || tokens[index].type === "th_open") && tokens[index + 1]?.type === "inline") {
          currentRow?.push({ segments: inlineSegmentsFromToken(tokens[index + 1]) });
        }
        if (tokens[index].type === "tr_close" && currentRow) {
          rows.push(currentRow);
          currentRow = undefined;
        }
        index += 1;
      }
      const followingCaption = tokens[index + 1]?.type === "paragraph_open"
        && tokens[index + 2]?.type === "inline"
        && tokens[index + 3]?.type === "paragraph_close"
        && token.map && tokens[index + 1].map && token.map[1] === tokens[index + 1].map![0]
        ? markdownCaptionText(tokens[index + 2].content)
        : undefined;
      if (followingCaption) index += 3;
      if (rows.length > 0) {
        const [header, ...bodyRows] = rows;
        blocks.push({ type: "table", caption: pendingTableCaption ?? followingCaption, header, rows: bodyRows });
        pendingTableCaption = undefined;
      }
    }
  }

  return { blocks, metadata: frontmatter.metadata };
}

function estimatedTextUnits(text: string) {
  return Array.from(text).reduce((total, character, index, characters) => {
    const boundaryGap = isWordCjkLatinBoundary(characters[index - 1], character)
      ? WORD_CJK_LATIN_GAP_PT / 12
      : 0;
    if (/\s/.test(character)) return total + 0.35;
    if (/^[\x00-\x7F]$/.test(character)) return total + 0.58 + boundaryGap;
    return total + 1 + boundaryGap;
  }, 0);
}

function estimateTextLines(text: string, charsPerLine = 26, proportionalText = true) {
  const explicitLines = text.split(/\r?\n/);
  return explicitLines.reduce((total, line) => {
    const width = proportionalText ? estimatedTextUnits(line) : Array.from(line).length;
    return total + Math.max(1, Math.ceil(width / charsPerLine));
  }, 0);
}

function estimateCharsPerLine(contentWidth: number, draft: StyleDraft, ratio = 1) {
  const glyphWidth = ptToPx(draft.fontSize) * ratio;
  const characterSpacing = ptToPx(WORD_TEXT_CHARACTER_SPACING_PT);
  return Math.max(8, Math.floor(contentWidth / Math.max(1, glyphWidth + characterSpacing)));
}

function splitTextSegmentsAt(segments: PreviewTextSegment[], offset: number): [PreviewTextSegment[], PreviewTextSegment[]] {
  const head: PreviewTextSegment[] = [];
  const tail: PreviewTextSegment[] = [];
  let remaining = offset;

  segments.forEach((segment) => {
    if (remaining <= 0) {
      tail.push(segment);
      return;
    }
    if (remaining >= segment.text.length) {
      head.push(segment);
      remaining -= segment.text.length;
      return;
    }
    head.push({ ...segment, text: segment.text.slice(0, remaining) });
    tail.push({ ...segment, text: segment.text.slice(remaining) });
    remaining = 0;
  });

  return [head.filter((segment) => segment.text), tail.filter((segment) => segment.text)];
}

function textSplitOffset(text: string, maxChars: number) {
  if (text.length <= maxChars) return text.length;
  const candidates = ["\n", "。", "；", "！", "？", "，", " "]
    .map((separator) => text.lastIndexOf(separator, maxChars))
    .filter((index) => index >= Math.floor(maxChars * 0.55));
  const splitAt = candidates.length > 0 ? Math.max(...candidates) + 1 : maxChars;
  return Math.min(text.length - 1, Math.max(1, splitAt));
}

function textSplitOffsetByUnits(text: string, maxUnits: number) {
  let units = 0;
  let offset = 0;

  for (const character of text) {
    const characterUnits = estimatedTextUnits(character);
    if (offset > 0 && units + characterUnits > maxUnits) break;
    units += characterUnits;
    offset += character.length;
  }

  return textSplitOffset(text, offset);
}

function mermaidSizeKey(source: string, dark: boolean) {
  return `${dark ? "d" : "l"}:${source.trim()}`;
}

function estimateTableColumnWidths(block: Extract<PreviewBlock, { type: "table" }>, tableDraft: StyleDraft, contentWidth: number) {
  const allRows = block.header ? [block.header, ...block.rows] : block.rows;
  const columnCount = Math.max(1, ...allRows.map((row) => row.length));
  const tableWidth = contentWidth * (tableDraft.fitToPageWidth ? 1 : Math.min(100, Math.max(1, tableDraft.tableWidthPercent)) / 100);
  const columnWidthWeights = block.columnWidthPercentages ?? (tableDraft.columnWidthMode === "custom"
    ? tableColumnWidthPercentages([tableDraft.firstColumnWidth, tableDraft.secondColumnWidth, tableDraft.thirdColumnWidth], columnCount)
    : undefined);
  return estimateTableColumnContentWidths({
    rows: allRows.map((row) => row.map((cell) => plainText(cell.segments))),
    tableWidth,
    horizontalPadding: tableDraft.cellPaddingX,
    layout: tableDraft.tableLayout,
    columnWidthWeights,
  });
}

function splitTextSegmentsByLine(segments: PreviewTextSegment[]) {
  const lines: PreviewTextSegment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part, partIndex) => {
      if (part) lines[lines.length - 1].push({ ...segment, text: part });
      if (partIndex < parts.length - 1) lines.push([]);
    });
  }
  return lines;
}

function renderInlineText(segments: PreviewTextSegment[], inlineCodeDraft: StyleDraft, inlineCodeEnabled: boolean, keyPrefix: string, selectedStyle: StyleNode | undefined, onOpenLink: (target: string) => void, indentEachLine = false, lineIndent = "0em", includeBoundaryGap = true) {
  if (!indentEachLine || !segments.some((segment) => segment.text.includes("\n"))) {
    return renderInlineTextLine(segments, inlineCodeDraft, inlineCodeEnabled, keyPrefix, selectedStyle, onOpenLink, includeBoundaryGap);
  }
  return splitTextSegmentsByLine(segments).map((line, lineIndex) => (
    <span key={`${keyPrefix}-line-${lineIndex}`} className="block" style={{ textIndent: lineIndent }}>
      {renderInlineTextLine(line, inlineCodeDraft, inlineCodeEnabled, `${keyPrefix}-line-${lineIndex}`, selectedStyle, onOpenLink, includeBoundaryGap)}
    </span>
  ));
}

function resolveTableBlockColumnWidths(block: PreviewBlock, tableDraft: StyleDraft, contentWidth: number): PreviewBlock {
  if (block.type !== "table" || block.columnWidthPercentages) return block;
  const contentWidths = estimateTableColumnWidths(block, tableDraft, contentWidth);
  const outerWidths = contentWidths.map((width) => width + Math.max(0, tableDraft.cellPaddingX) * 2);
  const totalWidth = outerWidths.reduce((sum, width) => sum + width, 0);
  return {
    ...block,
    columnWidthPercentages: outerWidths.map((width) => width / totalWidth * 100),
  };
}

function estimateTableRowHeight(row: PreviewTableCell[], isHeader: boolean, tableDraft: StyleDraft, drafts: Record<string, StyleDraft>, columnContentWidths: number[]) {
  const rowDraft = drafts[isHeader ? "table-header" : "table-body"] ?? tableDraft;
  const fontSize = isHeader ? rowDraft.headerFontSize : rowDraft.bodyFontSize;
  const lineHeight = resolveLineHeightValue(isHeader ? rowDraft.headerLineHeight : rowDraft.bodyLineHeight);
  const contentLines = Math.max(1, ...row.map((cell, columnIndex) => {
    if (!tableDraft.cellWrap) return estimateTextLines(plainText(cell.segments), Number.POSITIVE_INFINITY);
    const charsPerLine = Math.max(4, Math.floor((columnContentWidths[columnIndex] ?? 24) / Math.max(1, ptToPx(fontSize))));
    return estimateTextLines(plainText(cell.segments), charsPerLine);
  }));
  return Math.max(tableDraft.minRowHeight, contentLines * ptToPx(fontSize) * lineHeight + tableDraft.cellPaddingY * 2);
}

function estimateTableCaptionHeight(block: Extract<PreviewBlock, { type: "table" }>, drafts: Record<string, StyleDraft>) {
  const tableCaptionDraft = drafts["table-caption"];
  return block.caption && tableCaptionDraft
    ? resolveLineHeightPx(tableCaptionDraft) + ptToPx(tableCaptionDraft.beforeSpacing + tableCaptionDraft.afterSpacing)
    : 0;
}

function paragraphDraft(block: Extract<PreviewBlock, { type: "paragraph" }>, drafts: Record<string, StyleDraft>) {
  return block.metadata ? { ...drafts.title, fontSize: 12 } : drafts.normal;
}

function estimateBlockVerticalMargins(block: PreviewBlock, drafts: Record<string, StyleDraft>) {
  if (block.type === "heading") {
    const draft = drafts[block.isDocumentTitle ? "title" : `heading-${block.level}`];
    return { before: ptToPx(draft.beforeSpacing), after: ptToPx(draft.afterSpacing) };
  }
  if (block.type === "paragraph") {
    const draft = paragraphDraft(block, drafts);
    return {
      before: block.continuedFromPrevious ? 0 : ptToPx(draft.beforeSpacing),
      after: block.continuesNext ? 0 : ptToPx(draft.afterSpacing),
    };
  }
  if (block.type === "quote") return { before: ptToPx(drafts.quote.beforeSpacing), after: ptToPx(drafts.quote.afterSpacing) };
  if (block.type === "code") return {
    before: block.continuedFromPrevious ? 0 : ptToPx(drafts.code.beforeSpacing),
    after: block.continuesNext ? 0 : ptToPx(drafts.code.afterSpacing),
  };
  if (block.type === "math") return { before: ptToPx(drafts.normal.beforeSpacing), after: ptToPx(drafts.normal.afterSpacing) };
  if (block.type === "hr") {
    const draft = drafts["horizontal-rule"];
    return { before: ptToPx(draft.beforeSpacing), after: ptToPx(draft.afterSpacing) };
  }
  if (block.type === "list") {
    const firstItem = block.items[0];
    const lastItem = block.items[block.items.length - 1];
    const firstDraft = firstItem ? resolveListLevelDraft(resolveListBaseDraft(drafts, firstItem), firstItem) : undefined;
    const lastDraft = lastItem ? resolveListLevelDraft(resolveListBaseDraft(drafts, lastItem), lastItem) : undefined;
    return {
      before: block.continuedFromPrevious ? 0 : ptToPx(firstDraft?.beforeSpacing ?? 0),
      after: block.continuesNext ? 0 : ptToPx(lastDraft?.afterSpacing ?? 0),
    };
  }
  return { before: 0, after: 0 };
}

function estimateBlockHeight(block: PreviewBlock, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number, mermaidSizes?: Readonly<Record<string, PreviewMermaidSize>>, pageContentHeight?: number, imageSizes?: Readonly<Record<string, PreviewImageSize>>, previewDark = false) {
  if (block.type === "heading") {
    const draft = drafts[block.isDocumentTitle ? "title" : `heading-${block.level}`];
    const lineHeight = resolveLineHeightPx(draft);
    return ptToPx(draft.beforeSpacing + draft.afterSpacing) + estimateTextLines(block.text, estimateCharsPerLine(contentWidth, draft, 1.05)) * lineHeight;
  }

  if (block.type === "toc") {
    return estimateTocHeight(block.entries, drafts, contentWidth);
  }

  if (block.type === "paragraph") {
    const draft = paragraphDraft(block, drafts);
    const beforeSpacing = block.continuedFromPrevious ? 0 : draft.beforeSpacing;
    const afterSpacing = block.continuesNext ? 0 : draft.afterSpacing;
    return ptToPx(beforeSpacing + afterSpacing) + estimateTextLines(plainText(block.segments), estimateCharsPerLine(contentWidth, draft)) * resolveLineHeightPx(draft);
  }

  if (block.type === "quote") {
    return ptToPx(drafts.quote.beforeSpacing + drafts.quote.afterSpacing) + 16 + estimateTextLines(plainText(block.segments), estimateCharsPerLine(contentWidth - 24, drafts.quote)) * resolveLineHeightPx(drafts.quote);
  }

  if (block.type === "code") {
    if (isMermaidLanguage(block.language)) {
      const backgroundColor = drafts.code.backgroundColor === "transparent" ? undefined : drafts.code.backgroundColor;
      const dark = previewDark || Boolean(backgroundColor && hexToLuminance(backgroundColor) < 0.45);
      const size = mermaidSizes?.[mermaidSizeKey(block.text, dark)] ?? getCachedMermaidSvg(block.text, dark);
      const marginHeight = ptToPx(drafts.code.beforeSpacing + drafts.code.afterSpacing);
      const diagramHeight = estimateMermaidBlockHeight({
        size,
        contentWidth: contentWidth - ptToPx(block.indentPt),
        horizontalPadding: Math.max(0, drafts.code.codePaddingX) * 2,
        verticalPadding: Math.max(0, drafts.code.codePaddingY) * 2,
        marginHeight,
        maxBlockHeight: pageContentHeight === undefined ? undefined : Math.max(1, pageContentHeight - marginHeight),
      });
      const captionDraft = drafts.caption;
      const captionHeight = block.caption && captionDraft
        ? resolveLineHeightPx(captionDraft) + ptToPx(captionDraft.beforeSpacing + captionDraft.afterSpacing)
        : 0;
      return diagramHeight + captionHeight;
    }
    // 语言标签是绝对定位，只需要一小段顶部留白；预览估高必须和实际
    // padding 保持一致，否则代码块尾行会被错误推到下一页。
    const languageExtra = block.language && !block.continuedFromPrevious ? 10 : 0;
    const beforeSpacing = block.continuedFromPrevious ? 0 : drafts.code.beforeSpacing;
    const afterSpacing = block.continuesNext ? 0 : drafts.code.afterSpacing;
    return ptToPx(beforeSpacing + afterSpacing) + 18 + languageExtra + estimateTextLines(block.text, estimateCharsPerLine(contentWidth - 24 - ptToPx(block.indentPt), drafts.code, 0.62), false) * resolveLineHeightPx(drafts.code);
  }

  if (block.type === "math") {
    // 公式按行数估高，分式/求和等纵向结构再留一点余量。
    const lines = block.text.split(/\\\\|\r?\n/).length;
    const tall = /\\frac|\\sum|\\int|\\prod|\\begin|\\lim|\^|_/.test(block.text) ? 1.6 : 1.2;
    return ptToPx(drafts.normal.beforeSpacing + drafts.normal.afterSpacing) + lines * resolveLineHeightPx(drafts.normal) * tall;
  }

  if (block.type === "hr") {
    const draft = drafts["horizontal-rule"];
    return ptToPx(draft.beforeSpacing + draft.afterSpacing + Math.max(0.25, draft.borderWidth));
  }

  if (block.type === "list") {
    const contentHeight = block.items.reduce((total, item) => {
      const draft = resolveListLevelDraft(resolveListBaseDraft(drafts, item), item);
      const listOffset = resolveListTextOffsetPx(draft, item);
      return total + estimateTextLines(plainText(item.segments), estimateCharsPerLine(contentWidth - listOffset, draft)) * resolveLineHeightPx(draft);
    }, 0);
    const firstItem = block.items[0];
    const lastItem = block.items[block.items.length - 1];
    const firstDraft = firstItem ? resolveListLevelDraft(resolveListBaseDraft(drafts, firstItem), firstItem) : undefined;
    const lastDraft = lastItem ? resolveListLevelDraft(resolveListBaseDraft(drafts, lastItem), lastItem) : undefined;
    const spacingHeight = ptToPx(
      (block.continuedFromPrevious ? 0 : (firstDraft?.beforeSpacing ?? 0))
      + (block.continuesNext ? 0 : (lastDraft?.afterSpacing ?? 0)),
    );
    return contentHeight + spacingHeight;
  }

  if (block.type === "image") {
    const captionDraft = drafts.caption;
    return estimateImageBlockHeight({
      size: block.src ? imageSizes?.[block.src] : undefined,
      contentWidth,
      // “原始尺寸”的容器当前使用 block 的 auto 宽度，实际会占满正文区；
      // 分页估算必须采用相同宽度，否则会低估图片高度并把正文挤进页脚。
      widthPercent: drafts.image.imageWidthMode === "original" ? 100 : imageWidthPercent(drafts.image),
      captionHeight: block.caption && captionDraft ? resolveLineHeightPx(captionDraft) + ptToPx(captionDraft.beforeSpacing + captionDraft.afterSpacing) : 0,
    });
  }

  const columnContentWidths = estimateTableColumnWidths(block, tableDraft, contentWidth);
  const estimatedHeight = estimateTableCaptionHeight(block, drafts)
    + (block.header ? estimateTableRowHeight(block.header, true, tableDraft, drafts, columnContentWidths) : 0)
    + block.rows.reduce((height, row) => height + estimateTableRowHeight(row, false, tableDraft, drafts, columnContentWidths), 0);
  return estimatedHeight;
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

function splitLargeBlocks(blocks: PreviewBlock[], pageContentHeight: number, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number, mermaidSizes?: Readonly<Record<string, PreviewMermaidSize>>, imageSizes?: Readonly<Record<string, PreviewImageSize>>, previewDark = false) {
  return blocks.flatMap((block) => {
    if (estimateBlockHeight(block, drafts, tableDraft, contentWidth, mermaidSizes, pageContentHeight, imageSizes, previewDark) <= pageContentHeight) return [block];

    if (block.type === "paragraph") {
      return splitTextByLength(plainText(block.segments), estimateCharsPerLine(contentWidth, paragraphDraft(block, drafts)) * 24).map((text) => ({ ...block, segments: textSegments(text) }));
    }

    if (block.type === "quote") {
      return splitTextByLength(plainText(block.segments), estimateCharsPerLine(contentWidth - 24, drafts.quote) * 20).map((text) => ({ ...block, segments: textSegments(text) }));
    }

    if (block.type === "code") {
      // Mermaid 以及普通代码块都交给 paginateBlocks 按实际剩余高度拆分。
      // 这里按固定“字符数 x 24”预切会把最后一行提前切到下一页，
      // 而且无法反映代码字体和当前纸张宽度的真实行高。
      return [block];
    }

    if (block.type === "hr") return [block];
    // 公式整体不可切分，拆开会得到两段无法解析的 LaTeX。
    if (block.type === "math") return [block];

    if (block.type === "list") {
      const pages: PreviewBlock[] = [];
      let currentItems: PreviewListItem[] = [];
      let usedHeight = 20;

      block.items.forEach((item) => {
        const draft = resolveListLevelDraft(resolveListBaseDraft(drafts, item), item);
        const listOffset = resolveListTextOffsetPx(draft, item);
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

    return [block];
  });
}

function paginateBlocks(blocks: PreviewBlock[], pageContentHeight: number, drafts: Record<string, StyleDraft>, tableDraft: StyleDraft, contentWidth: number, mermaidSizes?: Readonly<Record<string, PreviewMermaidSize>>, imageSizes?: Readonly<Record<string, PreviewImageSize>>, previewDark = false) {
  const estimateHeight = (block: PreviewBlock) => estimateBlockHeight(block, drafts, tableDraft, contentWidth, mermaidSizes, pageContentHeight, imageSizes, previewDark);

  const minimumFollowingHeight = (block: PreviewBlock, following: PreviewBlock) => {
    if (block.type !== "heading") return 0;
    if (following.type === "paragraph") {
      return Math.min(estimateHeight(following), ptToPx(drafts.normal.beforeSpacing) + resolveLineHeightPx(drafts.normal) * 2);
    }
    if (following.type === "list") {
      const firstItem = following.items[0];
      if (!firstItem) return 0;
      const draft = resolveListLevelDraft(resolveListBaseDraft(drafts, firstItem), firstItem);
      return Math.min(estimateHeight(following), ptToPx(draft.beforeSpacing) + resolveLineHeightPx(draft) * 2);
    }
    if (following.type === "table") {
      const columnContentWidths = estimateTableColumnWidths(following, tableDraft, contentWidth);
      const headerHeight = following.header ? estimateTableRowHeight(following.header, true, tableDraft, drafts, columnContentWidths) : 0;
      const firstRowHeight = following.rows[0] ? estimateTableRowHeight(following.rows[0], false, tableDraft, drafts, columnContentWidths) : 0;
      return estimateTableCaptionHeight(following, drafts) + headerHeight + firstRowHeight;
    }
    return Math.min(estimateHeight(following), resolveLineHeightPx(drafts.normal) * 2);
  };

  const splitToFit = (block: PreviewBlock, availableHeight: number): PreviewBlockSplit<PreviewBlock> | undefined => {
    if (block.type === "list" && block.items.length > 1) {
      let splitIndex = 0;
      for (let index = 1; index < block.items.length; index += 1) {
        const candidate: PreviewBlock = {
          ...block,
          items: block.items.slice(0, index),
          continuesNext: true,
        };
        if (estimateHeight(candidate) > availableHeight) break;
        splitIndex = index;
      }
      if (splitIndex > 0) {
        return {
          head: { ...block, items: block.items.slice(0, splitIndex), continuesNext: true },
          tail: { ...block, items: block.items.slice(splitIndex), continuedFromPrevious: true },
        };
      }
    }

    if (block.type === "paragraph") {
      const lineHeight = resolveLineHeightPx(drafts.normal);
      const beforeSpacing = block.continuedFromPrevious ? 0 : ptToPx(drafts.normal.beforeSpacing);
      const availableLines = Math.floor((availableHeight - beforeSpacing) / lineHeight);
      const text = plainText(block.segments);
      const charsPerLine = estimateCharsPerLine(contentWidth, drafts.normal);
      const totalLines = estimateTextLines(text, charsPerLine);
      const maxChars = availableLines * charsPerLine;
      // Word 默认启用孤行控制：段落跨页时，页底和下一页页首至少各保留两行。
      if (availableLines >= 2 && totalLines - availableLines >= 2 && maxChars < text.length) {
        const [headSegments, tailSegments] = splitTextSegmentsAt(block.segments, textSplitOffsetByUnits(text, maxChars));
        if (headSegments.length > 0 && tailSegments.length > 0) {
          return {
            head: { ...block, segments: headSegments, continuesNext: true },
            tail: { ...block, segments: tailSegments, continuedFromPrevious: true },
          };
        }
      }
    }

    if (block.type === "code" && !isMermaidLanguage(block.language)) {
      const lines = block.text.split("\n");
      if (lines.length > 1) {
        let splitIndex = 0;
        for (let index = 1; index < lines.length; index += 1) {
          const candidate: PreviewBlock = {
            ...block,
            text: lines.slice(0, index).join("\n"),
            continuesNext: true,
          };
          if (estimateHeight(candidate) > availableHeight) break;
          splitIndex = index;
        }
        if (splitIndex > 0) {
          return {
            head: { ...block, text: lines.slice(0, splitIndex).join("\n"), continuesNext: true },
            tail: { ...block, text: lines.slice(splitIndex).join("\n"), continuedFromPrevious: true },
          };
        }
      }
    }

    if (block.type === "table") {
      const columnContentWidths = estimateTableColumnWidths(block, tableDraft, contentWidth);
      const split = splitTableRows({
        header: block.header,
        rows: block.rows,
        availableHeight,
        fixedHeight: estimateTableCaptionHeight(block, drafts),
        repeatHeader: tableDraft.repeatHeaderOnEachPage,
        estimateHeaderHeight: (header) => estimateTableRowHeight(header, true, tableDraft, drafts, columnContentWidths),
        estimateRowHeight: (row) => estimateTableRowHeight(row, false, tableDraft, drafts, columnContentWidths),
      });
      if (split) {
        const bodyRowOffset = block.bodyRowOffset ?? 0;
        return {
          head: { ...block, header: split.head.header, rows: split.head.rows },
          tail: {
            ...block,
            caption: undefined,
            header: split.tail.header,
            rows: split.tail.rows,
            bodyRowOffset: bodyRowOffset + split.rowsInHead,
          },
        };
      }
    }

    return undefined;
  };

  return paginateByEstimatedHeight({
    blocks,
    pageHeight: pageContentHeight,
    estimateHeight,
    estimateVerticalMargins: (block) => estimateBlockVerticalMargins(block, drafts),
    splitToFit,
    minimumFollowingHeight,
  });
}

function createFallbackBlocks(imageCaption: string, tableCaption: string): PreviewBlock[] {
  return [
    { type: "heading", level: 1, text: "文档大标题", anchorId: "heading-1" },
    { type: "heading", level: 2, text: "一级章节", anchorId: "heading-2" },
    { type: "heading", level: 3, text: "二级小节", anchorId: "heading-3" },
    { type: "heading", level: 4, text: "三级条目", anchorId: "heading-4" },
    { type: "heading", level: 5, text: "四级条目", anchorId: "heading-5" },
    { type: "heading", level: 6, text: "五级条目", anchorId: "heading-6" },
    { type: "paragraph", segments: [...textSegments("正文用于预览字号、行距和缩进，"), { text: "inlineCode()", code: true }, ...textSegments(" 展示行内代码。")] },
    { type: "list", items: [
      { segments: textSegments("一级列表用于观察项目符号、缩进和换行对齐。"), level: 0, ordered: false, index: 1 },
      { segments: textSegments("二级无序列表使用较长内容展示自动换行效果，换行后可以检查续行是否与符号后的正文文字保持对齐。"), level: 1, ordered: false, index: 1 },
      { segments: textSegments("三级列表继续缩进。"), level: 2, ordered: false, index: 1 },
      { segments: textSegments("有序列表第一项使用较长内容检查自动换行，续行可以观察编号、正文文字和当前对齐方式之间的关系。"), level: 0, ordered: true, index: 1 },
      { segments: textSegments("第二项用于检查编号递增。"), level: 0, ordered: true, index: 2 },
    ] },
    { type: "quote", segments: textSegments("引用块用于观察缩进、边框和背景。") },
    { type: "code", language: "javascript", text: "const docx = convertMarkdown(input);\nsaveAs(docx, \"report.docx\");", indentPt: 0 },
    { type: "image", caption: imageCaption },
    { type: "hr" },
    { type: "table", caption: tableCaption, header: ["字段", "样式", "备注"].map((cell) => ({ segments: textSegments(cell) })), rows: [["标题", "加粗", "章节层级"], ["正文", "常规", "段落内容"]].map((row) => row.map((cell) => ({ segments: textSegments(cell) }))) },
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

function PreviewImage({
  src,
  alt,
  markdownSourcePath,
  className,
  onSize,
}: {
  src?: string;
  alt?: string;
  markdownSourcePath?: string;
  className?: string;
  onSize?: (src: string, size: PreviewImageSize) => void;
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setResolvedSrc(undefined);
    if (!src) return undefined;

    void resolvePreviewImageSource(src, markdownSourcePath)
      .then((value) => {
        if (!cancelled) setResolvedSrc(value);
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [markdownSourcePath, src]);

  if (!src) {
    return (
      <div className={cn("relative flex h-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-[10px] font-semibold text-slate-400 dark:border-zinc-700 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-800 dark:text-zinc-500", className)}>
        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/70 to-transparent dark:from-white/5" />
        <svg className="absolute inset-x-0 bottom-0 h-full w-full" viewBox="0 0 420 132" preserveAspectRatio="none" aria-hidden="true">
          <circle cx="318" cy="36" r="14" fill="rgba(96,165,250,0.45)" />
          <path d="M0 132 L0 92 L78 56 L142 96 L205 42 L322 132 Z" fill="rgba(59,130,246,0.16)" />
          <path d="M82 132 L170 70 L230 106 L280 82 L420 132 Z" fill="rgba(99,102,241,0.18)" />
          <path d="M0 132 L120 80 L210 132 Z" fill="rgba(15,23,42,0.08)" />
        </svg>
        <span className="relative rounded-full border border-white/70 bg-white/72 px-3 py-1 text-[10px] font-bold text-slate-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-950/72 dark:text-zinc-400">图片占位预览</span>
      </div>
    );
  }

  if (resolvedSrc && !failed) {
    return (
      <>
        <div className={cn("group relative", className)}>
          <img src={resolvedSrc} alt={alt ?? ""} className="block h-auto w-full max-h-[520px] object-contain" onLoad={(event) => onSize?.(src, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
          <TooltipButton
            variant="ghost"
            size="icon-xs"
            className="absolute right-2 top-2 z-10 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            tooltip="放大查看图片"
            aria-label="放大查看图片"
            onClick={() => setPreviewOpen(true)}
          >
            <Maximize2 className="size-3.5" />
          </TooltipButton>
        </div>
        <MediaPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} src={resolvedSrc} alt={alt} title={alt || "图片预览"} />
      </>
    );
  }

  return (
    <div className={cn("relative flex h-28 items-center justify-center overflow-hidden border border-dashed border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500", className)}>
      <span>图片无法预览</span>
    </div>
  );
}

function renderMarkdownBlocks({
  blocks,
  drafts,
  selectedStyle,
  tableStyle,
  inlineCodeDraft,
  inlineCodeEnabled,
  markdownSourcePath,
  onOpenLink,
  onMermaidSize,
  onImageSize,
  pageContentHeight,
  previewDark = false,
  renderAsThumbnail = false,
}: {
  blocks: PreviewBlock[];
  drafts: Record<string, StyleDraft>;
  selectedStyle?: StyleNode;
  inlineCodeDraft: StyleDraft;
  inlineCodeEnabled: boolean;
  markdownSourcePath?: string;
  onOpenLink: (target: string) => void;
  onMermaidSize?: (source: string, dark: boolean, size: PreviewMermaidSize) => void;
  onImageSize?: (src: string, size: PreviewImageSize) => void;
  pageContentHeight: number;
  previewDark?: boolean;
  renderAsThumbnail?: boolean;
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
    columnWidthMode: StyleDraft["columnWidthMode"];
    columnWidthPercentages: [number, number, number];
    tocLeader: TocLeaderStyle;
    tocShowPageNumbers: boolean;
    tocTitle: string;
    tocTitleChineseFont: string;
    tocTitleLatinFont: string;
    tocTitleFontSize: number;
    tocTitleFontWeight: string;
    tocTitleColor: string;
    tocTitleLineHeight: string;
    tocTitleAlign: Exclude<StyleDraft["align"], "justify">;
    tocTitleBeforeSpacing: number;
    tocTitleAfterSpacing: number;
  };
}) {
  const rendered: ReactNode[] = [];
  let continuedOrderedListIndex = 0;

  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      const styleId = block.isDocumentTitle ? "title" : `heading-${block.level}`;
      rendered.push(
        <div key={index} data-preview-heading-id={renderAsThumbnail ? undefined : block.anchorId} data-markdown-heading-id={renderAsThumbnail ? undefined : block.anchorId} className={cn(selectedRing(selectedStyle, styleId), "break-words")} style={{
          ...(block.isDocumentTitle ? textStyle(drafts[styleId]) : headingTextStyle(drafts[styleId])),
        }}>
          {block.number ? <span>{block.number} </span> : null}
          {block.text}
        </div>,
      );
      return;
    }

    if (block.type === "toc") {
      const bodyDraft = drafts.normal;
      rendered.push(
        <section key={index}>
          <div
            style={{
              color: tableStyle.tocTitleColor,
              fontFamily: previewFontFamily(tableStyle.tocTitleChineseFont, tableStyle.tocTitleLatinFont),
              fontSize: `${tableStyle.tocTitleFontSize}pt`,
              fontWeight: tableStyle.tocTitleFontWeight,
              lineHeight: `${resolveWordAutoLineHeightPx(tableStyle.tocTitleFontSize, tableStyle.tocTitleLineHeight)}px`,
              marginTop: `${tableStyle.tocTitleBeforeSpacing}pt`,
              marginBottom: `${tableStyle.tocTitleAfterSpacing}pt`,
              textAlign: resolveTextAlign(tableStyle.tocTitleAlign),
              textIndent: 0,
            }}
          >
            {tableStyle.tocTitle || "目录"}
          </div>
          <div>
            {block.entries.map((entry, entryIndex) => (
              <div
                key={`${entry.level}-${entryIndex}-${entry.text}`}
                className="flex min-w-0 items-end gap-1"
                style={{
                  color: bodyDraft.color,
                  fontFamily: previewFontFamily(bodyDraft.chineseFont, bodyDraft.latinFont),
                  fontSize: `${bodyDraft.fontSize}pt`,
                  lineHeight: `${resolveWordAutoLineHeightPx(bodyDraft.fontSize, bodyDraft.lineHeight)}px`,
                  marginBottom: `${bodyDraft.afterSpacing}pt`,
                  paddingLeft: `${(entry.level - 1) * 2}em`,
                }}
              >
                <span className="shrink-0">{entry.number ? `${entry.number} ` : ""}{entry.text}</span>
                {tableStyle.tocLeader === "cjk-dot" ? <span className="min-w-2 flex-1 overflow-hidden whitespace-nowrap text-slate-400">………………</span> : null}
                {tableStyle.tocLeader === "dot-spaced" ? <span className="min-w-2 flex-1 overflow-hidden whitespace-nowrap text-slate-400">· · · · · · ·</span> : null}
                {tableStyle.tocLeader !== "cjk-dot" && tableStyle.tocLeader !== "dot-spaced" ? <span className={cn("mb-1 min-w-2 flex-1 border-slate-400", tableStyle.tocLeader === "dot" && "border-b border-dotted", tableStyle.tocLeader === "dash" && "border-b border-dashed", tableStyle.tocLeader === "line" && "border-b", tableStyle.tocLeader === "space" && "border-b border-transparent")} /> : null}
                {tableStyle.tocShowPageNumbers ? <span className="shrink-0 text-slate-500">{entry.page ?? ""}</span> : null}
              </div>
            ))}
          </div>
        </section>,
      );
      return;
    }

    if (block.type === "paragraph") {
      const draft = paragraphDraft(block, drafts);
      const indentEachLine = draft.firstLineIndent !== 0 && block.segments.some((segment) => segment.text.includes("\n"));
      rendered.push(
        <p
          key={index}
          className={cn(selectedRing(selectedStyle, block.metadata ? "title" : "normal"), "break-words")}
          style={{
            ...textStyle(draft),
            // Markdown 普通换行在解析后是 softbreak；预览应与编辑区一样保留它，
            // 否则内容会被 HTML 的默认空白折叠合并成一行。
            whiteSpace: "pre-wrap",
            marginTop: block.continuedFromPrevious ? 0 : `${draft.beforeSpacing}pt`,
            marginBottom: block.continuesNext ? 0 : `${draft.afterSpacing}pt`,
            textIndent: indentEachLine || block.continuedFromPrevious ? 0 : `${draft.firstLineIndent}em`,
          }}
        >
          {renderInlineText(block.segments, inlineCodeDraft, inlineCodeEnabled, `p-${index}`, selectedStyle, onOpenLink, indentEachLine, `${draft.firstLineIndent}em`)}
        </p>,
      );
      return;
    }

    if (block.type === "quote") {
      if (block.callout) {
        rendered.push(
          <blockquote
            key={index}
            className={cn("mk-word-callout", `mk-word-callout--${block.callout.tone}`, selectedRing(selectedStyle, "quote"))}
            style={{ ...textStyle(drafts.quote), fontStyle: "normal", textIndent: 0, padding: "9px 12px", border: 0 }}
          >
            <div className="mk-word-callout-title">
              <MarkdownCalloutIcon type={block.callout.type} tone={block.callout.tone} className="size-[1.05em] shrink-0" />
              <span>{block.callout.title}</span>
            </div>
            {block.segments.length > 0 ? (
              <div className="mk-word-callout-body">
                {renderInlineText(block.segments, inlineCodeDraft, inlineCodeEnabled, `q-${index}`, selectedStyle, onOpenLink)}
              </div>
            ) : null}
          </blockquote>,
        );
        return;
      }
      rendered.push(
        <blockquote
          key={index}
          className={cn(selectedRing(selectedStyle, "quote"))}
          style={{
            ...textStyle(drafts.quote),
            fontStyle: "normal",
            textIndent: 0,
            borderLeft: `${Math.max(1, drafts.quote.quoteBorderWidth || 4)}px solid ${drafts.quote.quoteBorderColor || "#94A3B8"}`,
            backgroundColor: drafts.quote.backgroundColor === "transparent" ? "#F8FAFC" : drafts.quote.backgroundColor,
            padding: "8px 12px",
          }}
        >
          {renderInlineText(block.segments, inlineCodeDraft, inlineCodeEnabled, `q-${index}`, selectedStyle, onOpenLink)}
        </blockquote>,
      );
      return;
    }

    if (block.type === "code") {
      const languageLabel = block.continuedFromPrevious ? undefined : codeLanguageLabel(block.language);
      const backgroundColor = drafts.code.backgroundColor === "transparent" ? undefined : drafts.code.backgroundColor;

      // mermaid 块渲染成图而不是代码。外框沿用代码块的背景与边框，
      // 这样它和编辑器里那个带 MERMAID 标签的框看起来是同一个东西。
      if (isMermaidLanguage(block.language)) {
        // 模板通常给代码块配置浅色背景；深色纸张下这个内联颜色不会被页面
        // 深色 CSS 覆盖，图表会留下突兀的白底。因此 Mermaid 外框与 SVG 主题
        // 必须同时随预览纸张切换。
        const mermaidBackgroundColor = previewDark ? "#202124" : backgroundColor;
        const mermaidDark = previewDark || Boolean(backgroundColor && hexToLuminance(backgroundColor) < 0.45);
        const mermaidMarginHeight = ptToPx(drafts.code.beforeSpacing + drafts.code.afterSpacing);
        const mermaidImageMaxHeight = Math.max(
          1,
          pageContentHeight - mermaidMarginHeight - Math.max(0, drafts.code.codePaddingY) * 2 - 2,
        );
        const diagram = (
          <div
            className={cn("relative", selectedRing(selectedStyle, "source-code"))}
            style={{
              backgroundColor: mermaidBackgroundColor,
              border: codeBlockBorder(drafts.code),
              borderRadius: 0,
              boxSizing: "border-box",
              width: block.indentPt ? `calc(100% - ${block.indentPt}pt)` : "100%",
              padding: `${Math.max(0, drafts.code.codePaddingY)}px ${Math.max(0, drafts.code.codePaddingX)}px`,
              marginTop: `${drafts.code.beforeSpacing}pt`,
              marginBottom: `${drafts.code.afterSpacing}pt`,
              marginLeft: block.indentPt ? `${block.indentPt}pt` : undefined,
              marginRight: 0,
            }}
          >
            <MermaidBlock source={block.text} dark={mermaidDark} maxHeight={mermaidImageMaxHeight} onSize={onMermaidSize} />
          </div>
        );
        const caption = block.caption ? (
          <div className={cn(selectedRing(selectedStyle, "caption"))} style={tableStyle.figureCaptionStyle}>
            {block.caption}
          </div>
        ) : null;
        rendered.push(
          <figure key={index} className="m-0">
            {tableStyle.figureCaptionPosition === "above" ? caption : null}
            {diagram}
            {tableStyle.figureCaptionPosition === "below" ? caption : null}
          </figure>,
        );
        return;
      }
      rendered.push(
        <pre
          key={index}
          className={cn("relative overflow-hidden whitespace-pre-wrap break-words", selectedRing(selectedStyle, "source-code"))}
          style={{
            ...textStyle(drafts.code),
            textIndent: 0,
            letterSpacing: 0,
            backgroundColor,
            border: codeBlockBorder(drafts.code),
            borderRadius: 0,
            boxSizing: "border-box",
            width: block.indentPt ? `calc(100% - ${block.indentPt}pt)` : "100%",
            padding: `${Math.max(0, drafts.code.codePaddingY) + (languageLabel ? 10 : 0)}px ${Math.max(0, drafts.code.codePaddingX)}px ${Math.max(0, drafts.code.codePaddingY)}px`,
            marginTop: block.continuedFromPrevious ? 0 : `${drafts.code.beforeSpacing}pt`,
            marginBottom: block.continuesNext ? 0 : `${drafts.code.afterSpacing}pt`,
            marginLeft: block.indentPt ? `${block.indentPt}pt` : undefined,
            marginRight: 0,
          }}
        >
          {languageLabel ? <CodeLanguageLabel label={languageLabel} backgroundColor={backgroundColor} /> : null}
          <code>{renderHighlightedCode(block.text, block.language, drafts.code)}</code>
        </pre>,
      );
      return;
    }

    if (block.type === "math") {
      rendered.push(
        <MathBlock
          key={index}
          text={block.text}
          className={cn("break-words", selectedRing(selectedStyle, "normal"))}
          style={{
            ...textStyle(drafts.normal),
            textAlign: "center",
            textIndent: 0,
          }}
        />,
      );
      return;
    }

    if (block.type === "hr") {
      const draft = drafts["horizontal-rule"];
      rendered.push(
        <hr
          key={index}
          className={cn("border-0", selectedRing(selectedStyle, "horizontal-rule"))}
          style={{
            borderTop: `${Math.max(0.25, draft.borderWidth)}pt ${draft.borderStyle} ${draft.borderColor}`,
            marginTop: `${draft.beforeSpacing}pt`,
            marginBottom: `${draft.afterSpacing}pt`,
          }}
        />,
      );
      return;
    }

    if (block.type === "list") {
      rendered.push(
        <div key={index}>
          {block.items.map((item, itemIndex) => {
            const listStyleId = item.level > 0 ? "nested-list" : item.ordered ? "numbered-list" : "bullet-list";
            const listBaseDraft = resolveListBaseDraft(drafts, item) ?? drafts.normal;
            const listDraft = resolveListLevelDraft(listBaseDraft, item);
            const markerType = listMarkerTypeFromStyle(listBaseDraft, item);
            const isNumbered = markerType === "number" && !item.task;
            const displayIndex = isNumbered && item.level === 0 && listDraft.listNumberingMode === "continue" ? continuedOrderedListIndex + 1 : item.index;
            if (isNumbered && item.level === 0 && listDraft.listNumberingMode === "continue") continuedOrderedListIndex = displayIndex;
            const marker = markerTextFromStyle(listDraft, item, markerType, displayIndex);
            const markerWidth = `${listMarkerWidthPt(marker)}pt`;
            const markerGap = `${Math.max(0, listDraft.listTextIndent) * 6}pt`;
            const itemStyle = {
              ...textStyle(listDraft),
              marginLeft: `${resolveListIndent(listDraft, item)}em`,
              marginTop: itemIndex === 0 && !block.continuedFromPrevious ? `${listDraft.beforeSpacing}pt` : 0,
              marginBottom: itemIndex === block.items.length - 1 && !block.continuesNext ? `${listDraft.afterSpacing}pt` : 0,
              textAlign: "left" as const,
              textIndent: 0,
            };

            if (listDraft.listWrapMode === "flat") {
              return (
                <div key={itemIndex} className={cn("break-words", selectedRing(selectedStyle, listStyleId))} style={itemStyle}>
                  <span aria-hidden="true" className="inline-block" style={{ width: markerWidth, marginRight: markerGap }}>{marker}</span>
                  {renderInlineText(item.segments, inlineCodeDraft, inlineCodeEnabled, `li-${index}-${itemIndex}`, selectedStyle, onOpenLink)}
                </div>
              );
            }

            return (
              <div
                key={itemIndex}
                className={cn("grid break-words", selectedRing(selectedStyle, listStyleId))}
                style={{ ...itemStyle, gridTemplateColumns: `${markerWidth} minmax(0, 1fr)`, columnGap: markerGap }}
              >
                <span aria-hidden="true" className="whitespace-nowrap">{marker}</span>
                <span className="min-w-0">{renderInlineText(item.segments, inlineCodeDraft, inlineCodeEnabled, `li-${index}-${itemIndex}`, selectedStyle, onOpenLink)}</span>
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
          <div className={cn("overflow-hidden", selectedRing(selectedStyle, "image"))} style={tableStyle.imageStyle}>
            <PreviewImage src={block.src} alt={block.alt} markdownSourcePath={markdownSourcePath} onSize={onImageSize} />
          </div>
          {tableStyle.figureCaptionPosition === "below" ? caption : null}
        </figure>,
      );
      return;
    }

    if (block.type === "table") {
      const { header, rows } = block;
      const columnWidths = block.columnWidthPercentages
        ? percentageColumnWidths(block.columnWidthPercentages)
        : tableStyle.columnWidthMode === "custom"
          ? tableColumnWidths(tableStyle.columnWidthPercentages, Math.max(header?.length ?? 0, ...rows.map((row) => row.length), 1))
          : [];
      const caption = block.caption ? <div className="text-[10px] font-semibold text-slate-700" style={tableStyle.captionStyle}>{block.caption}</div> : null;
      rendered.push(
        <div key={index}>
          {tableStyle.captionPosition === "above" ? caption : null}
        <table className={cn("border-collapse text-[10px]", selectedRing(selectedStyle, "table"))} style={{ width: tableStyle.tableWidth, margin: tableStyle.tableMargin, tableLayout: tableStyle.tableLayout === "auto" ? "fixed" : tableStyle.tableLayout, ...tableStyle.borderStyle }}>
          {columnWidths.length > 0 ? <colgroup>{columnWidths.map((width, widthIndex) => <col key={widthIndex} style={{ width }} />)}</colgroup> : null}
          {header ? (
            <thead>
              {/* DOCX table runs do not carry the paragraph-level CJK/Latin boundary gap used by body text. */}
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex} style={tableStyle.headerStyle}>{renderInlineText(cell.segments, inlineCodeDraft, inlineCodeEnabled, `th-${index}-${cellIndex}`, selectedStyle, onOpenLink, false, "0em", false)}</th>)}</tr>
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
                      backgroundColor: tableStyle.rowStripe && ((block.bodyRowOffset ?? 0) + rowIndex) % 2 === 1 ? "#F8FAFC" : tableStyle.bodyCellStyle.backgroundColor,
                    }}
                  >
                    {renderInlineText(cell.segments, inlineCodeDraft, inlineCodeEnabled, `td-${index}-${rowIndex}-${cellIndex}`, selectedStyle, onOpenLink, false, "0em", false)}
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

export function WordPreviewPage({ selectedStyle, styleConfig, zoom = 85, markdown, markdownSourcePath, showHeader = true, headerTitle = "实时预览", headerSubtitle, badgeText, pageWidth, pageMinHeight, paginate = false, showTocPage = false, thumbnailContainer, onThumbnailPageSelect, onPreviewOutlineChange, onOpenLink = () => {}, showPageFooter = true, interactiveViewport = false, paperTheme, className, viewportClassName }: WordPreviewPageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastPreviewOutlineSignatureRef = useRef<string | undefined>(undefined);
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [mermaidSizes, setMermaidSizes] = useState<Record<string, PreviewMermaidSize>>({});
  const [imageSizes, setImageSizes] = useState<Record<string, PreviewImageSize>>({});
  const handleMermaidSize = useCallback((source: string, dark: boolean, size: PreviewMermaidSize) => {
    const key = mermaidSizeKey(source, dark);
    setMermaidSizes((current) => {
      const previous = current[key];
      if (previous?.width === size.width && previous.height === size.height) return current;
      return { ...current, [key]: size };
    });
  }, []);
  const handleImageSize = useCallback((src: string, size: PreviewImageSize) => {
    setImageSizes((current) => {
      const previous = current[src];
      if (previous?.width === size.width && previous.height === size.height) return current;
      return { ...current, [src]: size };
    });
  }, []);
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
  const pageNumberStartAt = pageSettings?.pageNumberStartAt ?? "body";
  const pageMargins = {
    top: cmToPx(pageSettings?.marginTop ?? 2.54),
    right: cmToPx(pageSettings?.marginRight ?? 3.18),
    bottom: cmToPx(pageSettings?.marginBottom ?? 2.54),
    left: cmToPx(pageSettings?.marginLeft ?? 3.18),
  };
  const contentWidth = Math.max(240, paperWidth - pageMargins.left - pageMargins.right);
  const title = getDraft(styleConfig, "title");
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
  const horizontalRule = getDraft(styleConfig, "horizontal-rule");
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
  // 与 Rust 侧 table_style_config_from_value 对齐：外边框加粗是对四向宽度的后置加成，
  // 且宽度 0 表示「无边框」，不能用 || 兜底成基准宽度。
  const outerBorderWidth = (value: number) => {
    const width = Number.isFinite(value) ? value : table.borderWidth;
    return table.outerBorderStrong && width > 0 ? width + 0.5 : width;
  };
  const baseBorderWidth = outerBorderWidth(table.borderWidth);
  const baseBorder = border(baseBorderWidth, table.borderStyle, table.borderColor);
  const sideBorders = {
    borderTop: border(outerBorderWidth(table.borderTopWidth), table.borderStyle, table.borderColor),
    borderRight: border(outerBorderWidth(table.borderRightWidth), table.borderStyle, table.borderColor),
    borderBottom: border(outerBorderWidth(table.borderBottomWidth), table.borderStyle, table.borderColor),
    borderLeft: border(outerBorderWidth(table.borderLeftWidth), table.borderStyle, table.borderColor),
  };
  const headerBorder = border(tableHeader.headerBorderWidth, table.borderStyle, tableHeader.headerBorderColor);
  const bodyBorder = border(tableBody.bodyBorderWidth, table.borderStyle, tableBody.bodyBorderColor);
  const whiteSpace = table.cellWrap ? "normal" : "nowrap";
  const captionStyle: CSSProperties = {
    color: tableCaption.color,
    fontFamily: previewFontFamily(tableCaption.chineseFont, tableCaption.latinFont),
    fontSize: `${tableCaption.fontSize}pt`,
    fontWeight: tableCaption.fontWeight,
    lineHeight: `${resolveWordAutoLineHeightPx(tableCaption.fontSize, tableCaption.lineHeight)}px`,
    textAlign: resolveTextAlign(tableCaption.captionAlign),
    marginTop: `${tableCaption.beforeSpacing}pt`,
    marginBottom: `${tableCaption.afterSpacing}pt`,
  };
  const figureCaptionStyle: CSSProperties = {
    color: caption.color,
    fontFamily: previewFontFamily(caption.chineseFont, caption.latinFont),
    fontSize: `${caption.fontSize}pt`,
    fontWeight: caption.fontWeight,
    lineHeight: `${resolveWordAutoLineHeightPx(caption.fontSize, caption.lineHeight)}px`,
    textAlign: resolveTextAlign(caption.captionAlign),
    marginTop: `${caption.beforeSpacing}pt`,
    marginBottom: `${caption.afterSpacing}pt`,
  };
  const imageStyle: CSSProperties = {
    width: image.imageWidthMode === "original" ? "auto" : `${imageWidthPercent(image)}%`,
    maxWidth: "100%",
    margin: imageMargin(image),
  };
  const headerStyle: CSSProperties = {
    backgroundColor: tableHeader.headerBackgroundColor === "transparent" ? undefined : tableHeader.headerBackgroundColor,
    color: tableHeader.color,
    fontFamily: previewFontFamily(tableHeader.chineseFont, tableHeader.latinFont),
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
    fontFamily: previewFontFamily(tableBody.chineseFont, tableBody.latinFont),
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
  const markdownPreview = markdown?.trim() ? parseMarkdownPreview(markdown) : undefined;
  const markdownBlocks = markdownPreview?.blocks ?? [];
  const hasMarkdownPreview = markdownBlocks.length > 0;
  const fallbackBlocks = createFallbackBlocks(captionText(caption, "图片样式预览"), captionText(tableCaption, "表格样式预览"));
  const activeBlocks = applyMarkdownFeatureSettings(hasMarkdownPreview ? markdownBlocks : fallbackBlocks, styleConfig?.markdownFeatures ?? defaultMarkdownFeatures)
    .map((block) => block.type === "image" && !block.caption && block.alt
      ? { ...block, caption: captionText(caption, block.alt) }
      : block);
  const mappedBlocks = applyHeadingMappings(activeBlocks, styleConfig?.markdownRules?.headingMappings ?? defaultMarkdownRules.headingMappings);
  const previewDrafts = { title, "heading-1": heading1, "heading-2": heading2, "heading-3": heading3, "heading-4": heading4, "heading-5": heading5, "heading-6": heading6, normal, quote, code, image, caption, "table-header": tableHeader, "table-body": tableBody, "table-caption": tableCaption, "inline-code": inlineCode, "horizontal-rule": horizontalRule, "bullet-list": bulletList, "numbered-list": numberedList, "nested-list": nestedList };
  // 页脚绝对定位在底部边距内，不占正文流；这里只扣除真正位于正文流中的页眉。
  const pageContentHeight = calculatePreviewContentHeight({
    paperHeight,
    marginTop: pageMargins.top,
    marginBottom: pageMargins.bottom,
  });
  const shouldPaginate = paginate && hasMarkdownPreview;
  const numberedBlocks = annotateHeadingNumbers(mappedBlocks, previewDrafts);
  const blocksWithTableColumnWidths = numberedBlocks.map((block) => resolveTableBlockColumnWidths(block, table, contentWidth));
  const metadataBlocks: PreviewBlock[] = [
    ...(markdownPreview?.metadata?.author ? [{ type: "paragraph" as const, metadata: "author" as const, segments: textSegments(markdownPreview.metadata.author) }] : []),
    ...(markdownPreview?.metadata?.date ? [{ type: "paragraph" as const, metadata: "date" as const, segments: textSegments(markdownPreview.metadata.date) }] : []),
  ];
  const metadataHeight = metadataBlocks.reduce((total, block) => total + estimateBlockHeight(block, previewDrafts, table, contentWidth, mermaidSizes, undefined, imageSizes), 0);
  const tocPages = shouldPaginate && showTocPage
    ? createPreviewTocPages(numberedBlocks, pageSettings?.tocEnabled ?? false, pageSettings?.tocDepth, pageContentHeight, previewDrafts, contentWidth, metadataHeight, {
      fontSize: pageSettings?.tocTitleFontSize ?? 18,
      lineHeight: pageSettings?.tocTitleLineHeight ?? "1.25",
      beforeSpacing: pageSettings?.tocTitleBeforeSpacing ?? 10,
      afterSpacing: pageSettings?.tocTitleAfterSpacing ?? 5,
    })
    : [];
  const documentBlocks = tocPages.length > 0 ? blocksWithTableColumnWidths : [...metadataBlocks, ...blocksWithTableColumnWidths];
  const previewBlocks = shouldPaginate ? splitLargeBlocks(documentBlocks, pageContentHeight, previewDrafts, table, contentWidth, mermaidSizes, imageSizes, paperTheme === "dark") : documentBlocks;
  const documentPages = shouldPaginate ? paginateBlocks(previewBlocks, pageContentHeight, previewDrafts, table, contentWidth, mermaidSizes, imageSizes, paperTheme === "dark") : [previewBlocks];
  const documentPageNumberOffset = footerStartPage + (pageNumberStartAt === "document" ? tocPages.length : 0);
  const previewOutline = documentPages.flatMap((pageBlocks, pageIndex) => pageBlocks.flatMap((block) => {
    if (block.type !== "heading" || block.isDocumentTitle || !block.anchorId) return [];
    return [{ id: block.anchorId, level: block.level, text: block.text, number: block.number, page: documentPageNumberOffset + pageIndex }];
  }));
  const pageByHeadingId = new Map(previewOutline.map((item) => [item.id, item.page]));
  const tocPagesWithPageNumbers = tocPages.map((pageBlocks, pageIndex) => [
    ...(pageIndex === 0 ? metadataBlocks : []),
    ...pageBlocks.map((block) => block.type === "toc"
      ? { ...block, entries: block.entries.map((entry) => ({ ...entry, page: entry.anchorId ? pageByHeadingId.get(entry.anchorId) : undefined })) }
      : block),
  ]);
  const previewPages = [...tocPagesWithPageNumbers, ...documentPages];
  const previewOutlineSignature = previewOutline.map((item) => `${item.id}:${item.level}:${item.number ?? ""}:${item.page}:${item.text}`).join("|");
  const scale = interactiveViewport
    ? requestedScale
    : viewportWidth > 0
      ? Math.min(requestedScale, Math.max(0.25, (viewportWidth - 12) / paperWidth))
      : requestedScale;
  const previewHeaderSubtitle = headerSubtitle;
  const previewBadgeText = badgeText ?? `当前：${selectedStyle?.name ?? "Heading 2"}`;
  const pageScaleStyle: CSSProperties = { position: "relative", width: paperWidth * scale, height: paperHeight * scale };
  const pageStyle: CSSProperties = { position: "absolute", inset: 0, width: paperWidth, height: paperHeight, boxSizing: "border-box", padding: `${pageMargins.top}px ${pageMargins.right}px ${pageMargins.bottom}px ${pageMargins.left}px`, transform: `scale(${scale})`, transformOrigin: "top left" };
  const thumbnailScale = Math.min(0.16, 112 / paperWidth);
  const thumbnailPageScaleStyle: CSSProperties = { position: "relative", width: paperWidth * thumbnailScale, height: paperHeight * thumbnailScale };
  const thumbnailPageStyle: CSSProperties = { ...pageStyle, transform: `scale(${thumbnailScale})` };
  const markdownTableStyle = { imageStyle, figureCaptionPosition: caption.captionPosition, figureCaptionStyle, captionPosition: tableCaption.captionPosition, captionStyle, headerStyle, bodyCellStyle, tableWidth, tableMargin, tableLayout: table.tableLayout, borderStyle: { border: baseBorder, ...sideBorders }, rowStripe: table.rowStripe, columnWidthMode: table.columnWidthMode, columnWidthPercentages: [table.firstColumnWidth, table.secondColumnWidth, table.thirdColumnWidth] as [number, number, number], tocLeader: pageSettings?.tocLeader ?? "dot", tocShowPageNumbers: pageSettings?.tocShowPageNumbers ?? true, tocTitle: pageSettings?.tocTitle ?? "目录", tocTitleChineseFont: pageSettings?.tocTitleChineseFont ?? "宋体", tocTitleLatinFont: pageSettings?.tocTitleLatinFont ?? "Times New Roman", tocTitleFontSize: pageSettings?.tocTitleFontSize ?? 18, tocTitleFontWeight: pageSettings?.tocTitleFontWeight ?? "700", tocTitleColor: pageSettings?.tocTitleColor ?? "#111827", tocTitleLineHeight: pageSettings?.tocTitleLineHeight ?? "1.25", tocTitleAlign: pageSettings?.tocTitleAlign ?? "center", tocTitleBeforeSpacing: pageSettings?.tocTitleBeforeSpacing ?? 10, tocTitleAfterSpacing: pageSettings?.tocTitleAfterSpacing ?? 5 };

  useEffect(() => {
    if (!onPreviewOutlineChange || lastPreviewOutlineSignatureRef.current === previewOutlineSignature) return;
    lastPreviewOutlineSignatureRef.current = previewOutlineSignature;
    onPreviewOutlineChange(previewOutline);
  }, [onPreviewOutlineChange, previewOutline, previewOutlineSignature]);

  function renderPreviewPage(pageBlocks: PreviewBlock[], pageIndex: number, thumbnail = false) {
    const isTocPage = pageIndex < tocPages.length;
    const pageHasFooter = pageNumberStartAt === "document" || !isTocPage;
    const pageNumber = pageNumberStartAt === "document"
      ? footerStartPage + pageIndex
      : footerStartPage + pageIndex - tocPages.length;
    const pageNumberText = formatPreviewPageNumber(pageSettings?.footerPageNumberFormat ?? "page", pageNumber);
    const footerContent = [footerText, pageNumberText].filter(Boolean).join(" · ");

    return (
      <div
        key={pageIndex}
        data-preview-page-index={thumbnail ? undefined : pageIndex + 1}
        data-preview-page-kind={thumbnail ? undefined : isTocPage ? "toc" : "document"}
        data-preview-thumbnail-page-index={thumbnail ? pageIndex + 1 : undefined}
        className={cn(
          thumbnail ? "pointer-events-none" : interactiveViewport ? "shrink-0" : "mx-auto",
          !thumbnail && !interactiveViewport && pageIndex > 0 && "mt-0",
          paperTheme === "dark" && "dark",
        )}
        style={thumbnail ? thumbnailPageScaleStyle : pageScaleStyle}
      >
        <div className={cn("mk-word-preview-page overflow-hidden rounded-sm bg-white text-slate-900 shadow-none ring-1 ring-slate-200", paperTheme && `mk-word-preview-page--paper-${paperTheme}`)} style={thumbnail ? thumbnailPageStyle : pageStyle}>
          {headerEnabled && headerText ? <div className="absolute left-0 right-0 text-center text-[9pt] text-slate-500" style={{ top: 48, paddingInline: pageMargins.left }}>{headerText}</div> : null}
          {renderMarkdownBlocks({
            blocks: pageBlocks,
            selectedStyle,
            drafts: previewDrafts,
            inlineCodeDraft: inlineCode,
            inlineCodeEnabled: styleConfig?.markdownFeatures.inlineCode ?? defaultMarkdownFeatures.inlineCode,
            markdownSourcePath,
            onOpenLink,
            onMermaidSize: handleMermaidSize,
            onImageSize: handleImageSize,
            pageContentHeight,
            previewDark: paperTheme === "dark",
            renderAsThumbnail: thumbnail,
            tableStyle: markdownTableStyle,
          })}
          {footerEnabled && pageHasFooter && footerContent ? <div className="absolute left-0 right-0 px-8 text-center text-[9pt] text-black" style={{ bottom: 48 }}>{footerContent}</div> : null}
        </div>
      </div>
    );
  }

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
          "mk-word-preview-viewport min-h-0 flex-1 rounded-lg bg-slate-200/60 p-3 2xl:p-4",
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
        {interactiveViewport ? (
          <div className="flex min-h-full min-w-full flex-wrap content-start items-start justify-center gap-5">
            {previewPages.map((pageBlocks, pageIndex) => renderPreviewPage(pageBlocks, pageIndex))}
          </div>
        ) : (
          <div className="flex w-full flex-col gap-5 py-1">
            {previewPages.map((pageBlocks, pageIndex) => renderPreviewPage(pageBlocks, pageIndex))}
          </div>
        )}
      </div>
      {thumbnailContainer && onThumbnailPageSelect ? createPortal(
        <div className="contents">
          {previewPages.map((pageBlocks, pageIndex) => (
            <TooltipButton
              key={pageIndex}
              type="button"
              className="group relative flex h-fit w-fit max-w-full flex-col items-center justify-start gap-0 justify-self-center overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50 p-1.5 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-500/60 dark:hover:bg-blue-500/12"
              style={{ height: paperHeight * thumbnailScale + 32 }}
              onClick={() => onThumbnailPageSelect(pageIndex + 1)}
              tooltip={pageIndex < tocPages.length ? "跳到目录页" : `跳到第 ${pageIndex + 1} 页`}
              tooltipSide="right"
              aria-label={pageIndex < tocPages.length ? "跳到目录页" : `跳到第 ${pageIndex + 1} 页`}
            >
              <div className="overflow-hidden rounded-[6px] border border-slate-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
                {renderPreviewPage(pageBlocks, pageIndex, true)}
              </div>
              <span className="mt-1 block w-full text-center text-[10px] leading-4 font-black text-slate-500 group-hover:text-blue-700 dark:text-zinc-400 dark:group-hover:text-blue-200">{pageIndex + 1}</span>
              {pageIndex < tocPages.length ? <span className="absolute right-2 top-2 rounded bg-white/90 px-1 py-0.5 text-[8px] font-bold text-slate-500 shadow-sm dark:bg-zinc-900/90 dark:text-zinc-300">目录</span> : null}
            </TooltipButton>
          ))}
        </div>,
        thumbnailContainer,
      ) : null}
    </AppSurface>
  );
}
