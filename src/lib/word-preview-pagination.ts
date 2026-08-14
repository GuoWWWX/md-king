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
  headerHeight?: number;
  safetyInset?: number;
};

export function calculatePreviewContentHeight({
  paperHeight,
  marginTop,
  marginBottom,
  headerHeight = 0,
  safetyInset = 2,
}: PreviewContentHeightOptions) {
  return Math.max(320, paperHeight - marginTop - marginBottom - headerHeight - safetyInset);
}

type SplitRowsWithRepeatedHeaderOptions<T> = {
  rows: T[];
  availableHeight: number;
  fixedHeight: number;
  estimateRowHeight: (row: T, rowIndex: number) => number;
};

export function splitRowsWithRepeatedHeader<T>({
  rows,
  availableHeight,
  fixedHeight,
  estimateRowHeight,
}: SplitRowsWithRepeatedHeaderOptions<T>) {
  const [header, ...bodyRows] = rows;
  if (!header || bodyRows.length < 2) return undefined;

  let usedHeight = fixedHeight + estimateRowHeight(header, 0);
  let bodyRowsInHead = 0;
  for (let index = 0; index < bodyRows.length; index += 1) {
    const nextHeight = estimateRowHeight(bodyRows[index], index + 1);
    if (usedHeight + nextHeight > availableHeight) break;
    usedHeight += nextHeight;
    bodyRowsInHead += 1;
  }

  if (bodyRowsInHead === 0 || bodyRowsInHead >= bodyRows.length) return undefined;
  return {
    head: [header, ...bodyRows.slice(0, bodyRowsInHead)],
    tail: [header, ...bodyRows.slice(bodyRowsInHead)],
    bodyRowsInHead,
  };
}

type PaginateByEstimatedHeightOptions<T> = {
  blocks: T[];
  pageHeight: number;
  estimateHeight: (block: T) => number;
  estimateVerticalMargins?: (block: T) => { before: number; after: number };
  splitToFit?: (block: T, availableHeight: number) => PreviewBlockSplit<T> | undefined;
};

export function paginateByEstimatedHeight<T>({
  blocks,
  pageHeight,
  estimateHeight,
  estimateVerticalMargins,
  splitToFit,
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
