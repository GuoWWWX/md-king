import assert from "node:assert/strict";
import test from "node:test";
import { collapsedDockedX, revealedDockedX } from "./floating-window-geometry.ts";

test("左右停靠时完整悬浮球贴住对应屏幕边缘", () => {
  assert.equal(revealedDockedX("left", 0, 1920, 48), 0);
  assert.equal(revealedDockedX("right", 0, 1920, 48), 1872);
});

test("左右收起时只在对应边缘保留指定宽度", () => {
  assert.equal(collapsedDockedX("left", 0, 1920, 48, 14), -34);
  assert.equal(collapsedDockedX("right", 0, 1920, 48, 14), 1906);
  assert.equal(collapsedDockedX("left", -1920, 1920, 48, 14), -1954);
});
