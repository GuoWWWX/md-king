import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownCalloutHeader } from "./markdown-callout.ts";

test("解析 Obsidian 引用块标题和类型", () => {
  assert.deepEqual(parseMarkdownCalloutHeader("[!abstract] 一句话总结"), {
    type: "abstract",
    tone: "cyan",
    defaultTitle: "摘要",
    markerStart: 0,
    markerEnd: 12,
    title: "一句话总结",
  });
});

test("未知 callout 类型保留名称并使用中性色", () => {
  assert.deepEqual(parseMarkdownCalloutHeader("  [!custom] 内容"), {
    type: "custom",
    tone: "slate",
    defaultTitle: "custom",
    markerStart: 2,
    markerEnd: 12,
    title: "内容",
  });
});
