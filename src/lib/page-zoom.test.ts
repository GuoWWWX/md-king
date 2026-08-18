import assert from "node:assert/strict";
import test from "node:test";
import { clampPageZoomPercent, pageZoomViewportPercent } from "./page-zoom.ts";

test("页面缩放限制为支持的整数范围", () => {
  assert.equal(clampPageZoomPercent(1), 80);
  assert.equal(clampPageZoomPercent(115.4), 115);
  assert.equal(clampPageZoomPercent(999), 120);
  assert.equal(clampPageZoomPercent(Number.NaN), 100);
});

test("页面根容器按缩放倍率补偿视口宽高", () => {
  assert.equal(pageZoomViewportPercent(100), 100);
  assert.equal(pageZoomViewportPercent(80), 125);
  assert.equal(pageZoomViewportPercent(120), 10000 / 120);
  assert.equal(pageZoomViewportPercent(85), 10000 / 85);
  assert.equal(pageZoomViewportPercent(105), 10000 / 105);
});
