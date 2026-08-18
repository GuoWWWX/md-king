const DEFAULT_MAX_RASTER_SIDE = 8192;
const DEFAULT_MAX_RASTER_PIXELS = 16_000_000;

/** 把内联 SVG 调整为可由 img/canvas 按 XML 解析的形式。 */
export function normalizeSvgForImage(svg: string) {
  return svg
    .replace(/<br\b([^>]*)>/gi, (tag, attributes: string) => (
      /\/\s*$/.test(attributes) ? tag : `<br${attributes} />`
    ))
    .replace(/&nbsp;/gi, "&#160;");
}

export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizeSvgForImage(svg))}`;
}

type RasterSizeOptions = {
  maxSide?: number;
  maxPixels?: number;
};

/** 在不裁剪、不改变宽高比的前提下限制浏览器画布尺寸。 */
export function calculateRasterSize(
  width: number,
  height: number,
  requestedScale: number,
  { maxSide = DEFAULT_MAX_RASTER_SIDE, maxPixels = DEFAULT_MAX_RASTER_PIXELS }: RasterSizeOptions = {},
) {
  if (![width, height, requestedScale, maxSide, maxPixels].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || requestedScale <= 0
    || maxSide <= 0
    || maxPixels <= 0) {
    throw new Error("图表尺寸无效");
  }

  const scale = Math.min(
    requestedScale,
    maxSide / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );

  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}
