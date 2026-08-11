export type PreviewMermaidSize = {
  width: number;
  height: number;
};

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
