export type HorizontalBounds = {
  left: number;
  right: number;
};

export type TabHorizontalBounds = HorizontalBounds & {
  key: string;
};

export function collectOverflowedTabKeys(
  viewport: HorizontalBounds,
  tabs: TabHorizontalBounds[],
  tolerance = 1,
) {
  return tabs
    .filter((tab) => tab.left < viewport.left - tolerance || tab.right > viewport.right + tolerance)
    .map((tab) => tab.key);
}

export function tabWheelScrollDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  viewportWidth: number,
) {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(viewportWidth, 1);
  return delta;
}
