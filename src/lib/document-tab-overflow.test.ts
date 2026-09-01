import assert from "node:assert/strict";
import test from "node:test";
import { collectOverflowedTabKeys, tabWheelScrollDelta } from "./document-tab-overflow.ts";

test("只把超出标签栏左右边界的标签列为隐藏标签", () => {
  assert.deepEqual(
    collectOverflowedTabKeys(
      { left: 100, right: 500 },
      [
        { key: "left", left: 40, right: 150 },
        { key: "visible", left: 150, right: 420 },
        { key: "right", left: 420, right: 540 },
      ],
    ),
    ["left", "right"],
  );
});

test("标签栏边界的一像素测量误差不会误报隐藏标签", () => {
  assert.deepEqual(
    collectOverflowedTabKeys(
      { left: 100, right: 500 },
      [{ key: "visible", left: 99.5, right: 500.5 }],
    ),
    [],
  );
});

test("鼠标纵向滚轮转换为标签栏横向滚动并兼容不同 deltaMode", () => {
  assert.equal(tabWheelScrollDelta(0, 80, 0, 600), 80);
  assert.equal(tabWheelScrollDelta(-120, 40, 0, 600), -120);
  assert.equal(tabWheelScrollDelta(0, 3, 1, 600), 48);
  assert.equal(tabWheelScrollDelta(0, 1, 2, 600), 600);
});
