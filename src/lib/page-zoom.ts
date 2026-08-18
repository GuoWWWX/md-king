export const PAGE_ZOOM_MIN_PERCENT = 80;
export const PAGE_ZOOM_MAX_PERCENT = 120;
export const PAGE_ZOOM_DEFAULT_PERCENT = 100;
export const PAGE_ZOOM_STEP_PERCENT = 5;

export function clampPageZoomPercent(value: number) {
  if (!Number.isFinite(value)) return PAGE_ZOOM_DEFAULT_PERCENT;
  return Math.min(PAGE_ZOOM_MAX_PERCENT, Math.max(PAGE_ZOOM_MIN_PERCENT, Math.round(value)));
}

export function pageZoomViewportPercent(value: number) {
  return 10000 / clampPageZoomPercent(value);
}
