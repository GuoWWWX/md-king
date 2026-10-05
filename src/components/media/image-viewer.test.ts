import assert from "node:assert/strict";
import test from "node:test";

import { getPanBounds } from "./image-pan-bounds.ts";

test("图片预览视口滚动与平移边界约束", () => {
  // 1. 图片完全在窗口范围内（未放大或缩小到 69%）：严禁滚动，禁止平移
  {
    const bounds = getPanBounds(800, 600, 1200, 900);
    assert.equal(bounds.canScrollX, false);
    assert.equal(bounds.canScrollY, false);
    assert.equal(bounds.maxPanX, 0);
    assert.equal(bounds.maxPanY, 0);
  }

  // 2. 刚好等于视口尺寸：严禁滚动
  {
    const bounds = getPanBounds(1000, 800, 1000, 800);
    assert.equal(bounds.canScrollX, false);
    assert.equal(bounds.canScrollY, false);
    assert.equal(bounds.maxPanX, 0);
    assert.equal(bounds.maxPanY, 0);
  }

  // 3. 纵向超长（如长流程图或纵向架构图放大后超出）：只允许纵向滚动
  {
    const bounds = getPanBounds(600, 1500, 800, 1000);
    assert.equal(bounds.canScrollX, false);
    assert.equal(bounds.canScrollY, true);
    assert.equal(bounds.maxPanX, 0);
    assert.ok(bounds.maxPanY > 0);
    // (1500 - 1000) / 2 + 32 = 250 + 32 = 282
    assert.equal(bounds.maxPanY, 282);
  }

  // 4. 横向超宽（如横向 flowchart LR 放大后超出）：只允许横向滚动
  {
    const bounds = getPanBounds(1600, 500, 1000, 800);
    assert.equal(bounds.canScrollX, true);
    assert.equal(bounds.canScrollY, false);
    // (1600 - 1000) / 2 + 32 = 300 + 32 = 332
    assert.equal(bounds.maxPanX, 332);
    assert.equal(bounds.maxPanY, 0);
  }

  // 5. 双向放大（如放大至 200% 以上，横竖都超出）：双向均允许滚动浏览
  {
    const bounds = getPanBounds(2000, 1600, 1000, 800);
    assert.equal(bounds.canScrollX, true);
    assert.equal(bounds.canScrollY, true);
    assert.equal(bounds.maxPanX, 532);
    assert.equal(bounds.maxPanY, 432);
  }

  // 6. 异常边界防御：尺寸未就绪或为 0 时安全防御
  {
    const bounds1 = getPanBounds(undefined, undefined, 1000, 800);
    assert.equal(bounds1.canScrollX, false);
    assert.equal(bounds1.canScrollY, false);

    const bounds2 = getPanBounds(1000, 800, 0, 0);
    assert.equal(bounds2.canScrollX, false);
    assert.equal(bounds2.canScrollY, false);
  }
});
