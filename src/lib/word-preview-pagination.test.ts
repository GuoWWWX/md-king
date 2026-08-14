import assert from "node:assert/strict";
import test from "node:test";
import { calculatePreviewContentHeight, estimateMermaidBlockHeight, estimateTableColumnContentWidths, paginateByEstimatedHeight, splitRowsWithRepeatedHeader } from "./word-preview-pagination.ts";

test("Mermaid 分页使用 SVG 实际高度而不是固定最大高度", () => {
  const height = estimateMermaidBlockHeight({
    size: { width: 517.3, height: 177.65 },
    contentWidth: 554,
    horizontalPadding: 28,
    verticalPadding: 46,
    marginHeight: 18,
  });

  assert.ok(height > 242 && height < 245);
});

test("Mermaid 尺寸未知时保留加载阶段的最大高度兜底", () => {
  assert.equal(estimateMermaidBlockHeight({
    contentWidth: 554,
    horizontalPadding: 28,
    verticalPadding: 46,
    marginHeight: 18,
  }), 498);
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

test("页脚位于底部边距内，不重复占用正文分页高度", () => {
  assert.equal(calculatePreviewContentHeight({
    paperHeight: 1123,
    marginTop: 96,
    marginBottom: 96,
  }), 929);
});

test("表格按可用高度拆分数据行并在续页重复表头", () => {
  const split = splitRowsWithRepeatedHeader({
    rows: ["header", "row-1", "row-2", "row-3", "row-4"],
    availableHeight: 105,
    fixedHeight: 15,
    estimateRowHeight: () => 30,
  });

  assert.deepEqual(split, {
    head: ["header", "row-1", "row-2"],
    tail: ["header", "row-3", "row-4"],
    bodyRowsInHead: 2,
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
