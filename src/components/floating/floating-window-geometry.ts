export type FloatingDockSide = "left" | "right";

export function revealedDockedX(side: FloatingDockSide, screenLeft: number, screenWidth: number, windowWidth: number) {
  return side === "left" ? screenLeft : screenLeft + screenWidth - windowWidth;
}

export function collapsedDockedX(side: FloatingDockSide, screenLeft: number, screenWidth: number, windowWidth: number, visibleWidth: number) {
  return side === "left"
    ? screenLeft - (windowWidth - visibleWidth)
    : screenLeft + screenWidth - visibleWidth;
}
