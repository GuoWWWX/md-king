import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownCalloutHeader, separateMarkdownCallouts } from "./markdown-callout.ts";

test("解析 Obsidian 引用块标题和类型", () => {
  assert.deepEqual(parseMarkdownCalloutHeader("[!abstract] 一句话总结"), {
    type: "abstract",
    tone: "cyan",
    defaultTitle: "摘要",
    fold: undefined,
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
    fold: undefined,
    markerStart: 2,
    markerEnd: 12,
    title: "内容",
  });
});

test("解析 Obsidian Callout 的默认展开和默认收起标记", () => {
  assert.equal(parseMarkdownCalloutHeader("[!question]- 点击查看答案")?.fold, "collapsed");
  assert.equal(parseMarkdownCalloutHeader("[!question]+ 已展开")?.fold, "expanded");
});

test("连续的 Obsidian Callout 会被分隔为独立引用块", () => {
  assert.equal(
    separateMarkdownCallouts("> [!abstract] 摘要\n> 第一段\n>\n> [!info] 信息\n> 第二段"),
    "> [!abstract] 摘要\n> 第一段\n>\n\n> [!info] 信息\n> 第二段",
  );
});
