import assert from "node:assert/strict";
import test from "node:test";
import { calculatePreviewContentHeight, estimateImageBlockHeight, estimateMermaidBlockHeight, estimateTableColumnContentWidths, paginateByEstimatedHeight, resolveWordAutoLineHeightPx, splitTableRows } from "./word-preview-pagination.ts";

test("Word 自动行距按字体单倍行高估算，而不是直接按 CSS 字号倍数", () => {
  // 12pt * 1.25 in Word's Chinese mixed-text layout is about 19.5pt = 26px.
  assert.equal(resolveWordAutoLineHeightPx(12, "1.25"), 26);
});

test("Mermaid 分页使用 SVG 实际高度且不预留语言标签空间", () => {
  const height = estimateMermaidBlockHeight({
    size: { width: 517.3, height: 177.65 },
    contentWidth: 554,
    horizontalPadding: 28,
    verticalPadding: 24,
    marginHeight: 18,
  });

  assert.ok(height > 221 && height < 223);
});

test("Mermaid 尺寸未知时保留加载阶段的最大高度兜底", () => {
  assert.equal(estimateMermaidBlockHeight({
    contentWidth: 554,
    horizontalPadding: 28,
    verticalPadding: 46,
    marginHeight: 18,
  }), 498);
});

test("纵向 Mermaid 按页面可用高度等比缩放而不是裁剪", () => {
  const pageContentHeight = 760;
  const marginHeight = 18;
  const height = estimateMermaidBlockHeight({
    size: { width: 420, height: 2400 },
    contentWidth: 554,
    horizontalPadding: 28,
    verticalPadding: 24,
    marginHeight,
    maxBlockHeight: pageContentHeight - marginHeight,
  });

  assert.equal(height, pageContentHeight);
});

test("图片加载后按实际比例参与分页，不再固定按占位图高度计算", () => {
  const height = estimateImageBlockHeight({
    size: { width: 1600, height: 1200 },
    contentWidth: 640,
    widthPercent: 100,
    captionHeight: 28,
  });

  // 640 / 1600 * 1200 + figure 上下外边距 + 题注。
  assert.equal(height, 532);
});

test("预览放大小图时分页高度与实际容器宽度保持一致", () => {
  const height = estimateImageBlockHeight({
    size: { width: 320, height: 160 },
    contentWidth: 640,
    widthPercent: 100,
  });

  assert.equal(height, 344);
});

test("分页会把可拆块的一部分放进当前页剩余空间", () => {
  type Block = { id: string; height: number };
  const pages = paginateByEstimatedHeight<Block>({
    blocks: [{ id: "code", height: 70 }, { id: "list-3", height: 60 }],
    pageHeight: 100,
    estimateHeight: (block) => block.height,
    splitToFit: (block, availableHeight) => {
      if (block.id !== "list-3" || availableHeight < 20) return undefined;
      return {
        head: { id: "list-1", height: 20 },
        tail: { id: "list-2", height: 40 },
      };
    },
  });

  assert.deepEqual(pages.map((page) => page.map((block) => block.id)), [
    ["code", "list-1"],
    ["list-2"],
  ]);
});

test("不可拆块放不下时才整体移到下一页", () => {
  const pages = paginateByEstimatedHeight({
    blocks: [{ id: "code", height: 70 }, { id: "diagram", height: 50 }],
    pageHeight: 100,
    estimateHeight: (block) => block.height,
  });

  assert.deepEqual(pages.map((page) => page.map((block) => block.id)), [
    ["code"],
    ["diagram"],
  ]);
});

test("分页按 CSS 规则合并相邻块的垂直外边距", () => {
  const pages = paginateByEstimatedHeight({
    blocks: [
      { id: "code", height: 70, before: 0, after: 20 },
      { id: "heading", height: 60, before: 10, after: 0 },
    ],
    pageHeight: 120,
    estimateHeight: (block) => block.height,
    estimateVerticalMargins: (block) => ({ before: block.before, after: block.after }),
  });

  assert.deepEqual(pages.map((page) => page.map((block) => block.id)), [["code", "heading"]]);
});

test("标题放不下后续最小内容时会与下一块一起移到下一页", () => {
  const pages = paginateByEstimatedHeight({
    blocks: [
      { id: "paragraph", height: 70 },
      { id: "heading", height: 20 },
      { id: "following", height: 40 },
    ],
    pageHeight: 100,
    estimateHeight: (block) => block.height,
    minimumFollowingHeight: (block) => block.id === "heading" ? 20 : 0,
  });

  assert.deepEqual(pages.map((page) => page.map((block) => block.id)), [
    ["paragraph"],
    ["heading", "following"],
  ]);
});

test("页脚位于底部边距内，不重复占用正文分页高度", () => {
  assert.equal(calculatePreviewContentHeight({
    paperHeight: 1123,
    marginTop: 96,
    marginBottom: 96,
  }), 929);
});

test("页眉位于上边距内，不额外缩短正文分页高度", () => {
  assert.equal(calculatePreviewContentHeight({
    paperHeight: 1123,
    marginTop: 96,
    marginBottom: 96,
  }), 929);
});

test("表格按可用高度拆分数据行并在续页重复表头", () => {
  const split = splitTableRows({
    header: "header",
    rows: ["row-1", "row-2", "row-3", "row-4"],
    availableHeight: 105,
    fixedHeight: 15,
    repeatHeader: true,
    estimateHeaderHeight: () => 30,
    estimateRowHeight: () => 30,
  });

  assert.deepEqual(split, {
    head: { header: "header", rows: ["row-1", "row-2"] },
    tail: { header: "header", rows: ["row-3", "row-4"] },
    rowsInHead: 2,
  });
});

test("页尾放不下首条数据行时不会单独留下表头", () => {
  const split = splitTableRows({
    header: "header",
    rows: ["row-1", "row-2"],
    availableHeight: 50,
    fixedHeight: 15,
    repeatHeader: true,
    estimateHeaderHeight: () => 30,
    estimateRowHeight: () => 30,
  });

  assert.equal(split, undefined);
});

test("模板关闭跨页重复表头时续页只保留数据行", () => {
  const split = splitTableRows({
    header: "header",
    rows: ["row-1", "row-2", "row-3", "row-4"],
    availableHeight: 105,
    fixedHeight: 15,
    repeatHeader: false,
    estimateHeaderHeight: () => 30,
    estimateRowHeight: () => 30,
  });

  assert.deepEqual(split, {
    head: { header: "header", rows: ["row-1", "row-2"] },
    tail: { header: undefined, rows: ["row-3", "row-4"] },
    rowsInHead: 2,
  });
});

test("自动布局按整表内容估算非等宽列", () => {
  const widths = estimateTableColumnContentWidths({
    rows: [
      ["规则", "说明"],
      ["程序顺序规则", "同一个线程中，前面的操作 happens-before 后面的操作"],
      ["volatile 变量规则", "volatile 写 happens-before 后续对同一变量的 volatile 读"],
      ["线程终止规则", "线程中的所有动作 happens-before 其他线程的 Thread.join() 成功返回"],
    ],
    tableWidth: 554,
    horizontalPadding: 10,
    layout: "auto",
  });

  assert.equal(widths.length, 2);
  assert.ok(widths[0] < widths[1]);
  assert.ok(widths[0] > 100 && widths[0] < 180);
  assert.ok(widths[1] > 330);
});

test("显式列宽估算与渲染表格保持同一外宽", () => {
  const widths = estimateTableColumnContentWidths({
    rows: [["A", "B", "C", "D"]],
    tableWidth: 554,
    horizontalPadding: 10,
    layout: "fixed",
    columnWidthWeights: [10, 20, 40, 30],
  });

  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width + 20, 0) - 554) < 0.001);
  assert.ok(Math.abs((widths[2] + 20) / (widths[3] + 20) - 4 / 3) < 0.001);
});
