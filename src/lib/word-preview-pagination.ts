export type PreviewMermaidSize = {
  width: number;
  height: number;
};

export type PreviewBlockSplit<T> = {
  head: T;
  tail: T;
};

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
};

export function estimateMermaidBlockHeight({
  size,
  contentWidth,
  horizontalPadding,
  verticalPadding,
  marginHeight,
  borderWidth = 1,
  maxBlockHeight = 480,
}: EstimateMermaidHeightOptions) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return marginHeight + maxBlockHeight;
  }

  const availableWidth = Math.max(1, contentWidth - horizontalPadding - borderWidth * 2);
  const scale = Math.min(1, availableWidth / size.width);
  const renderedHeight = size.height * scale + verticalPadding + borderWidth * 2;
  return marginHeight + Math.min(maxBlockHeight, renderedHeight);
}
