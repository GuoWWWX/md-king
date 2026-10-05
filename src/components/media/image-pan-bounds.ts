/**
 * 图片查看器平移范围与滚动权限判定。
 *
 * 核心规则：
 * 1. 内容未超出视口时：禁止滚动、禁止平移，稳定居中对齐；
 * 2. 内容放大或超出视口时：允许向溢出方向平移滚动，并施加边界安全约束。
 */
export function getPanBounds(imgW?: number, imgH?: number, vpW = 0, vpH = 0) {
  const canScrollX = imgW !== undefined && vpW > 0 && imgW > vpW;
  const canScrollY = imgH !== undefined && vpH > 0 && imgH > vpH;
  // 超出视口时，允许平移距离为溢出尺寸的一半加适度边界冗余，确保能看清完整边缘
  const maxPanX = canScrollX ? Math.max(0, (imgW - vpW) / 2 + 32) : 0;
  const maxPanY = canScrollY ? Math.max(0, (imgH - vpH) / 2 + 32) : 0;
  return { canScrollX, canScrollY, maxPanX, maxPanY };
}
