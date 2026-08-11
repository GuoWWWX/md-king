import assert from "node:assert/strict";
import test from "node:test";
import { estimateMermaidBlockHeight } from "./word-preview-pagination.ts";

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
