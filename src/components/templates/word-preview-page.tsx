import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import { AppSurface } from "@/components/ui/app-surface";
import { createDefaultStyleDraft } from "@/lib/style-manager-data";
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
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; caption?: string; rows: string[][] };

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

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

function formatPreviewPageNumber(format: TemplateStyleConfig["pageSettings"]["footerPageNumberFormat"], pageNumber: number, totalPages: number) {
  if (format === "none") return "";
  if (format === "page-total") return `第 ${pageNumber} / ${totalPages} 页`;
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

function resolveVerticalAlign(align: StyleDraft["cellVerticalAlign"] | StyleDraft["headerVerticalAlign"] | StyleDraft["bodyVerticalAlign"]): CSSProperties["verticalAlign"] {
  return align === "middle" ? "middle" : align === "bottom" ? "bottom" : "top";
}

function resolveBorderStyle(style: StyleDraft["borderStyle"]) {
  return style === "none" ? "none" : style;
}

function border(width: number, style: StyleDraft["borderStyle"], color: string) {
  return `${width}px ${resolveBorderStyle(style)} ${color}`;
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

function selectedRing(selectedStyle: StyleNode | undefined, id: string) {
  return isSelected(selectedStyle, id) ? "outline outline-2 outline-offset-2 outline-indigo-400" : undefined;
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

function parseMarkdownPreview(markdown: string): PreviewBlock[] {
  const tokens = markdownParser.parse(markdown, {});
  const blocks: PreviewBlock[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token.type === "heading_open" && next?.type === "inline") {
      const level = Number(token.tag.slice(1));
      const normalizedLevel = Math.min(6, Math.max(1, level)) as HeadingLevel;
      blocks.push({ type: "heading", level: normalizedLevel, text: next.content });
      index += 2;
      continue;
    }

    if (token.type === "paragraph_open" && next?.type === "inline") {
      blocks.push({ type: "paragraph", text: next.content });
      index += 2;
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      blocks.push({ type: "code", text: token.content.trimEnd() });
      continue;
    }

    if (token.type === "hr") {
      blocks.push({ type: "hr" });
      continue;
    }

    if (token.type === "blockquote_open") {
      const parts: string[] = [];
      index += 1;
      while (index < tokens.length && tokens[index].type !== "blockquote_close") {
        if (tokens[index].type === "inline" || tokens[index].type === "fence" || tokens[index].type === "code_block") {
          parts.push(tokens[index].content);
        }
        index += 1;
      }
      blocks.push({ type: "quote", text: parts.join("\n").trim() });
      continue;
    }

    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const items: string[] = [];
      const ordered = token.type === "ordered_list_open";
      index += 1;
      while (index < tokens.length && tokens[index].type !== (ordered ? "ordered_list_close" : "bullet_list_close")) {
        if (tokens[index].type === "list_item_open") {
          const parts: string[] = [];
          index += 1;
          while (index < tokens.length && tokens[index].type !== "list_item_close") {
            if (tokens[index].type === "inline") {
              parts.push(tokens[index].content);
            }
            index += 1;
          }
          items.push(parts.join(" ").trim());
        }
        index += 1;
      }
      if (items.length > 0) blocks.push({ type: "list", ordered, items });
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
    return drafts.normal.beforeSpacing + estimateTextLines(block.text, estimateCharsPerLine(contentWidth, drafts.normal)) * resolveLineHeightPx(drafts.normal) + drafts.normal.afterSpacing;
  }

  if (block.type === "quote") {
    return drafts.quote.beforeSpacing + 16 + estimateTextLines(block.text, estimateCharsPerLine(contentWidth - 24, drafts.quote)) * resolveLineHeightPx(drafts.quote) + drafts.quote.afterSpacing;
  }

  if (block.type === "code") {
    return drafts.code.beforeSpacing + 18 + estimateTextLines(block.text, estimateCharsPerLine(contentWidth - 24, drafts.code, 0.62)) * resolveLineHeightPx(drafts.code) + drafts.code.afterSpacing;
  }

  if (block.type === "hr") {
    return 28;
  }

  if (block.type === "list") {
    return 12 + block.items.reduce((total, item) => total + estimateTextLines(item, estimateCharsPerLine(contentWidth - 28, drafts.normal)) * resolveLineHeightPx(drafts.normal), 0);
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
      return splitTextByLength(block.text, estimateCharsPerLine(contentWidth, drafts.normal) * 24).map((text) => ({ ...block, text }));
    }

    if (block.type === "quote") {
      return splitTextByLength(block.text, estimateCharsPerLine(contentWidth - 24, drafts.quote) * 20).map((text) => ({ ...block, text }));
    }

    if (block.type === "code") {
      return splitTextByLength(block.text, estimateCharsPerLine(contentWidth - 24, drafts.code, 0.62) * 24).map((text) => ({ ...block, text }));
    }

    if (block.type === "hr") return [block];

    if (block.type === "list") {
      const pages: PreviewBlock[] = [];
      let currentItems: string[] = [];
      let usedHeight = 20;

      block.items.forEach((item) => {
        const itemHeight = estimateTextLines(item, estimateCharsPerLine(contentWidth - 28, drafts.normal)) * resolveLineHeightPx(drafts.normal);
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

function createFallbackBlocks(tableCaption: string): PreviewBlock[] {
  return [
    { type: "heading", level: 1, text: "文档标题" },
    { type: "paragraph", text: "md-king · 样式结构预览" },
    { type: "heading", level: 2, text: "一级章节" },
    { type: "heading", level: 3, text: "二级小节" },
    { type: "heading", level: 4, text: "三级条目" },
    { type: "heading", level: 5, text: "四级条目" },
    { type: "heading", level: 6, text: "五级条目" },
    { type: "paragraph", text: "这是一段正文，用于预览正文样式、行距、字号、对齐方式和段落间距。md-king 会把 AI 生成的 Markdown 转换成可继续编辑的 Word/WPS 文档，并尽量保留清晰的文档结构。行内代码也会在这里展示实际效果。" },
    { type: "quote", text: "这里展示引用块样式，内容仅用于观察缩进、边框、字体和背景效果。" },
    { type: "code", text: "输出格式: DOCX\n保留目录结构: 是\n完成后打开: 否" },
    { type: "hr" },
    { type: "table", caption: tableCaption, rows: [["字段", "样式", "备注"], ["标题", "加粗", "用于章节层级"], ["正文", "常规", "用于段落内容"], ["表格", "按页面宽度铺满", "自动换行"]] },
  ];
}

function applyMarkdownFeatureSettings(blocks: PreviewBlock[], features: MarkdownFeatureSettings): PreviewBlock[] {
  return blocks.map((block) => {
    if (block.type === "quote" && !features.quoteBlock) return { type: "paragraph", text: block.text };
    if (block.type === "code" && !features.codeBlock) return { type: "paragraph", text: block.text };
    if (block.type === "hr" && !features.horizontalRule) return undefined;
    return block;
  }).filter((block): block is PreviewBlock => Boolean(block));
}

function renderMarkdownBlocks({
  blocks,
  drafts,
  selectedStyle,
  tableStyle,
}: {
  blocks: PreviewBlock[];
  drafts: Record<string, StyleDraft>;
  selectedStyle?: StyleNode;
  tableStyle: {
    captionStyle: CSSProperties;
    headerStyle: CSSProperties;
    bodyCellStyle: CSSProperties;
    tableWidth: string;
    tableMargin: string;
    tableLayout: CSSProperties["tableLayout"];
    borderStyle: CSSProperties;
  };
}) {
  const rendered: ReactNode[] = [];

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
      rendered.push(<p key={index} className={cn(selectedRing(selectedStyle, "normal"), "break-words")} style={textStyle(drafts.normal)}>{block.text}</p>);
      return;
    }

    if (block.type === "quote") {
      rendered.push(
        <blockquote
          key={index}
          className={cn("border-l-4 px-3 py-2 italic", selectedRing(selectedStyle, "quote"))}
          style={{ ...textStyle(drafts.quote), textIndent: 0, borderLeftColor: "#94A3B8", backgroundColor: drafts.quote.backgroundColor === "transparent" ? "#F8FAFC" : drafts.quote.backgroundColor }}
        >
          {block.text}
        </blockquote>,
      );
      return;
    }

    if (block.type === "code") {
      rendered.push(
        <pre key={index} className={cn("overflow-hidden whitespace-pre-wrap break-words rounded-lg p-3", selectedRing(selectedStyle, "source-code"))} style={{ ...textStyle(drafts.code), textIndent: 0, backgroundColor: drafts.code.backgroundColor === "transparent" ? "#111827" : drafts.code.backgroundColor }}>
          <code>{block.text}</code>
        </pre>,
      );
      return;
    }

    if (block.type === "hr") {
      rendered.push(<hr key={index} className="my-4 border-0 border-t border-slate-300" />);
      return;
    }

    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";
      rendered.push(
        <ListTag key={index} className={cn("space-y-1.5 pl-5", block.ordered ? "list-decimal" : "list-disc", selectedRing(selectedStyle, "normal"))} style={textStyle(drafts.normal)}>
          {block.items.map((item, itemIndex) => <li key={itemIndex} className="break-words">{item}</li>)}
        </ListTag>,
      );
      return;
    }

    if (block.type === "table") {
      const [header, ...rows] = block.rows;
      rendered.push(
        <div key={index}>
          {block.caption ? <div className="mb-2 mt-4 text-[10px] font-semibold text-slate-700" style={tableStyle.captionStyle}>{block.caption}</div> : null}
        <table className={cn("mt-3 border-collapse text-[10px]", selectedRing(selectedStyle, "table"))} style={{ width: tableStyle.tableWidth, margin: tableStyle.tableMargin, tableLayout: tableStyle.tableLayout, ...tableStyle.borderStyle }}>
          {header ? (
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex} style={tableStyle.headerStyle}>{cell}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex} className="break-words" style={tableStyle.bodyCellStyle}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
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
  const table = getDraft(styleConfig, "table");
  const tableHeader = getDraft(styleConfig, "table-header");
  const tableBody = getDraft(styleConfig, "table-body");
  const tableCaption = getDraft(styleConfig, "table-caption");

  const tableWidth = `${table.fitToPageWidth ? 100 : table.tableWidthPercent}%`;
  const tableMargin = table.tableHorizontalAlign === "center" ? "0 auto" : table.tableHorizontalAlign === "right" ? "0 0 0 auto" : "0";
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
  const fallbackBlocks = createFallbackBlocks(tableCaption.captionNumbering ? "表 1-1  表格样式预览" : "表格样式预览");
  const activeBlocks = applyMarkdownFeatureSettings(hasMarkdownPreview ? markdownBlocks : fallbackBlocks, styleConfig?.markdownFeatures ?? defaultMarkdownFeatures);
  const previewDrafts = { "heading-1": heading1, "heading-2": heading2, "heading-3": heading3, "heading-4": heading4, "heading-5": heading5, "heading-6": heading6, normal, quote, code };
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
  const effectiveZoom = Math.round(scale * 100);
  const previewHeaderSubtitle = headerSubtitle ?? `类 Word 页面 · ${effectiveZoom}%`;
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
          <p className="truncate text-xs text-slate-500">{previewHeaderSubtitle}</p>
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
            tableStyle: { captionStyle, headerStyle, bodyCellStyle, tableWidth, tableMargin, tableLayout: table.tableLayout, borderStyle: { border: baseBorder, ...sideBorders } },
          })}
          {footerEnabled ? (() => {
            const pageNumber = footerStartPage + pageIndex;
            const pageNumberText = formatPreviewPageNumber(pageSettings?.footerPageNumberFormat ?? "page-total", pageNumber, previewPages.length);
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
