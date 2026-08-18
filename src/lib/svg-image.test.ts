import assert from "node:assert/strict";
import test from "node:test";
import { calculateRasterSize, normalizeSvgForImage } from "./svg-image.ts";

test("SVG 图片源会把 Mermaid 的 HTML 换行转换为合法 XML", () => {
  const svg = '<svg><foreignObject><div>第一行<br class="label">第二行&nbsp;</div></foreignObject></svg>';
  const normalized = normalizeSvgForImage(svg);

  assert.match(normalized, /<br class="label" \/>/);
  assert.match(normalized, /第二行&#160;/);
});

test("已有自闭合换行不会被重复处理", () => {
  assert.equal(normalizeSvgForImage("<svg><br /></svg>"), "<svg><br /></svg>");
});

test("超长 Mermaid 栅格化时按比例缩小且不超过画布限制", () => {
  const size = calculateRasterSize(1200, 12_000, 2);

  assert.equal(size.height, 8192);
  assert.equal(size.width, 819);
  assert.ok(size.width * size.height <= 16_000_000);
  assert.ok(Math.abs(size.width / size.height - 0.1) < 0.001);
});

test("普通 Mermaid 仍按两倍尺寸导出", () => {
  assert.deepEqual(calculateRasterSize(640, 480, 2), { width: 1280, height: 960, scale: 2 });
});
