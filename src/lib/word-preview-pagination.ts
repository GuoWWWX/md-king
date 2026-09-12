export type PreviewMermaidSize = {
  width: number;
  height: number;
};

export type PreviewImageSize = {
  width: number;
  height: number;
};

export type PreviewBlockSplit<T> = {
  head: T;
  tail: T;
};

// Word's `w:lineRule="auto"` applies the multiplier to the font's single-line
// box, not directly to the CSS font size. For the Chinese/Latin mixed text
// used by the built-in templates, the single-line box is about 1.3x the font
// size (for example, 12pt Songti at 1.25x is about 19.5pt in Word).
export const WORD_AUTO_LINE_HEIGHT_FACTOR = 1.3;

export function resolveWordAutoLineHeightPx(
  fontSize: number,
  lineHeight: string | number | undefined,
  fallback = 1.5,
) {
  const multiplier = Number(lineHeight);
  const resolvedMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : fallback;
  return fontSize * (4 / 3) * resolvedMultiplier * WORD_AUTO_LINE_HEIGHT_FACTOR;
}

type EstimateTableColumnContentWidthsOptions = {
  rows: ReadonlyArray<ReadonlyArray<string>>;
  tableWidth: number;
  horizontalPadding: number;
  layout: "auto" | "fixed";
  columnWidthWeights?: readonly number[];
  minimumContentWidth?: number;
};

export function estimateTableColumnContentWidths({
  rows,
  tableWidth,
  horizontalPadding,
  layout,
  columnWidthWeights,
  minimumContentWidth = 24,
}: EstimateTableColumnContentWidthsOptions) {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const horizontalCellPadding = Math.max(0, horizontalPadding) * 2;
  const availableWidth = Math.max(columnCount * (minimumContentWidth + horizontalCellPadding), tableWidth);
  const minimumColumnWidth = minimumContentWidth + horizontalCellPadding;
  const distributableWidth = Math.max(0, availableWidth - minimumColumnWidth * columnCount);

  // Explicit percentages already describe the rendered outer column widths.
  // Re-running the minimum-width distribution here makes the columns narrower
  // than the actual <colgroup>, which overestimates table row wrapping during
  // pagination. Keep the estimator on the same grid as the rendered table.
  if (columnWidthWeights) {
    const totalWeight = columnWidthWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || columnCount;
    return columnWidthWeights.map((weight) => Math.max(
      minimumContentWidth,
      availableWidth * Math.max(0, weight) / totalWeight - horizontalCellPadding,
    ));
  }

  const contentWeights = Array.from({ length: columnCount }, (_, columnIndex) => {
    if (columnWidthWeights) return Math.max(0, columnWidthWeights[columnIndex] ?? 0);
    if (layout === "fixed") return 1;
    return Math.max(1, ...rows.map((row) => estimatedTableTextUnits(row[columnIndex] ?? "")));
  });
  const totalWeight = contentWeights.reduce((sum, weight) => sum + weight, 0) || columnCount;

  return contentWeights.map((weight) => {
    const columnWidth = minimumColumnWidth + distributableWidth * (weight / totalWeight);
    return Math.max(minimumContentWidth, columnWidth - horizontalCellPadding);
  });
}

function estimatedTableTextUnits(text: string) {
  return Array.from(text).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.35;
    if (/^[\x00-\x7F]$/.test(character)) return total + 0.58;
    return total + 1;
  }, 0);
}

type PreviewContentHeightOptions = {
  paperHeight: number;
  marginTop: number;
  marginBottom: number;
  safetyInset?: number;
};

export function calculatePreviewContentHeight({
  paperHeight,
  marginTop,
  marginBottom,
  safetyInset = 2,
}: PreviewContentHeightOptions) {
  return Math.max(320, paperHeight - marginTop - marginBottom - safetyInset);
}

type SplitTableRowsOptions<T> = {
  header?: T;
  rows: T[];
  availableHeight: number;
  fixedHeight: number;
  repeatHeader: boolean;
  estimateHeaderHeight: (header: T) => number;
  estimateRowHeight: (row: T, rowIndex: number) => number;
};

export function splitTableRows<T>({
  header,
  rows,
  availableHeight,
  fixedHeight,
  repeatHeader,
  estimateHeaderHeight,
  estimateRowHeight,
}: SplitTableRowsOptions<T>) {
  if (rows.length < 2) return undefined;

  let usedHeight = fixedHeight + (header ? estimateHeaderHeight(header) : 0);
  let rowsInHead = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const nextHeight = estimateRowHeight(rows[index], index);
    if (usedHeight + nextHeight > availableHeight) break;
    usedHeight += nextHeight;
    rowsInHead += 1;
  }

  if (rowsInHead === 0 || rowsInHead >= rows.length) return undefined;
  return {
    head: { header, rows: rows.slice(0, rowsInHead) },
    tail: { header: repeatHeader ? header : undefined, rows: rows.slice(rowsInHead) },
    rowsInHead,
  };
}

type PaginateByEstimatedHeightOptions<T> = {
  blocks: T[];
  pageHeight: number;
  estimateHeight: (block: T) => number;
  estimateVerticalMargins?: (block: T) => { before: number; after: number };
  splitToFit?: (block: T, availableHeight: number) => PreviewBlockSplit<T> | undefined;
  minimumFollowingHeight?: (block: T, following: T) => number;
};

export function paginateByEstimatedHeight<T>({
  blocks,
  pageHeight,
  estimateHeight,
  estimateVerticalMargins,
  splitToFit,
  minimumFollowingHeight,
}: PaginateByEstimatedHeightOptions<T>) {
  const pages: T[][] = [];
  const pending = [...blocks];
  let currentPage: T[] = [];
  let usedHeight = 0;
  let previousAfterMargin = 0;

  while (pending.length > 0) {
    const block = pending.shift()!;
    const blockHeight = estimateHeight(block);
    const margins = estimateVerticalMargins?.(block) ?? { before: 0, after: 0 };
    const collapsedBeforeMargin = currentPage.length > 0 ? Math.max(previousAfterMargin, margins.before) : margins.before;
    const effectiveBlockHeight = blockHeight - margins.before - previousAfterMargin + collapsedBeforeMargin;
    const availableHeight = pageHeight - usedHeight;

    if (effectiveBlockHeight <= availableHeight) {
      const following = pending[0];
      const requiredFollowingHeight = following ? minimumFollowingHeight?.(block, following) ?? 0 : 0;
      if (currentPage.length > 0 && effectiveBlockHeight + requiredFollowingHeight > availableHeight) {
        pages.push(currentPage);
        currentPage = [];
        usedHeight = 0;
        previousAfterMargin = 0;
        pending.unshift(block);
        continue;
      }
      currentPage.push(block);
      usedHeight += effectiveBlockHeight;
      previousAfterMargin = margins.after;
      continue;
    }

    const availableBlockHeight = availableHeight + margins.before + previousAfterMargin - collapsedBeforeMargin;
    const split = splitToFit?.(block, availableBlockHeight);
    if (split) {
      currentPage.push(split.head);
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
      previousAfterMargin = 0;
      pending.unshift(split.tail);
      continue;
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
      previousAfterMargin = 0;
      pending.unshift(block);
      continue;
    }

    // 单个不可拆块超过整页时仍保留内容，由页面容器裁切兜底。
    currentPage.push(block);
    usedHeight = blockHeight;
    previousAfterMargin = margins.after;
  }

  if (currentPage.length > 0) pages.push(currentPage);
  return pages.length > 0 ? pages : [[]];
}

type EstimateMermaidHeightOptions = {
  size?: PreviewMermaidSize;
  contentWidth: number;
  horizontalPadding: number;
  verticalPadding: number;
  marginHeight: number;
  borderWidth?: number;
  maxBlockHeight?: number;
  fallbackBlockHeight?: number;
};

export function estimateMermaidBlockHeight({
  size,
  contentWidth,
  horizontalPadding,
  verticalPadding,
  marginHeight,
  borderWidth = 1,
  maxBlockHeight = 480,
  fallbackBlockHeight = 240,
}: EstimateMermaidHeightOptions) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    // Mermaid 是异步渲染的。未知尺寸时只保留一个中等高度占位，不能直接
    // 把整页高度当成图高，否则图会在真实尺寸返回前被错误地单独分页。
    return marginHeight + Math.min(maxBlockHeight, Math.max(1, fallbackBlockHeight));
  }

  const availableWidth = Math.max(1, contentWidth - horizontalPadding - borderWidth * 2);
  const scale = Math.min(1, availableWidth / size.width);
  const renderedHeight = size.height * scale + verticalPadding + borderWidth * 2;
  return marginHeight + Math.min(maxBlockHeight, renderedHeight);
}

type EstimateImageBlockHeightOptions = {
  size?: PreviewImageSize;
  contentWidth: number;
  widthPercent: number;
  captionHeight?: number;
  verticalMargin?: number;
  maxImageHeight?: number;
  fallbackImageHeight?: number;
};

// 图片完成加载后按实际宽高重排页面。此前一律按 132px 估算，宽幅网络图会被
// 错放在页尾，后续正文便会越过页脚显示在下边距内。
export function estimateImageBlockHeight({
  size,
  contentWidth,
  widthPercent,
  captionHeight = 0,
  verticalMargin = 24,
  maxImageHeight = 520,
  fallbackImageHeight = 220,
}: EstimateImageBlockHeightOptions) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return verticalMargin + fallbackImageHeight + captionHeight;
  }

  const targetWidth = Math.max(1, contentWidth * Math.min(100, Math.max(1, widthPercent)) / 100);
  // 预览图片使用 width: 100%，小图也会随容器放大；这里不能把缩放比例封顶为 1，
  // 否则会低估小尺寸图片实际占用的纵向空间。
  const scaledHeight = size.height * targetWidth / size.width;
  return verticalMargin + Math.min(maxImageHeight, scaledHeight) + captionHeight;
}
