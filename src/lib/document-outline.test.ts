import assert from "node:assert/strict";
import test from "node:test";
import { findActiveOutlineLine, parseMarkdownOutline, type MarkdownOutlineItem } from "./document-outline.ts";

test("findActiveOutlineLine 准确匹配视口所在章节", () => {
  const outline: MarkdownOutlineItem[] = [
    { level: 1, text: "一、前言", line: 5 },
    { level: 2, text: "1.1 背景", line: 15 },
    { level: 2, text: "1.2 目标", line: 30 },
    { level: 1, text: "二、架构设计", line: 50 },
    { level: 2, text: "2.1 模块划分", line: 65 },
    { level: 1, text: "三、总结", line: 100 },
  ];

  // 1. 在首个标题之前，归属于首个标题
  assert.equal(findActiveOutlineLine(outline, 1), 5);
  assert.equal(findActiveOutlineLine(outline, 5), 5);

  // 2. 在章节内容之间
  assert.equal(findActiveOutlineLine(outline, 10), 5);
  assert.equal(findActiveOutlineLine(outline, 15), 15);
  assert.equal(findActiveOutlineLine(outline, 25), 15);
  assert.equal(findActiveOutlineLine(outline, 30), 30);
  assert.equal(findActiveOutlineLine(outline, 45), 30);

  // 3. 滚动到第二章
  assert.equal(findActiveOutlineLine(outline, 50), 50);
  assert.equal(findActiveOutlineLine(outline, 55), 50);
  assert.equal(findActiveOutlineLine(outline, 70), 65);

  // 4. 滚动到最后章节及更深位置
  assert.equal(findActiveOutlineLine(outline, 100), 100);
  assert.equal(findActiveOutlineLine(outline, 200), 100);

  // 5. 空目录
  assert.equal(findActiveOutlineLine([], 50), undefined);
});

test("parseMarkdownOutline 忽略代码块内的标题", () => {
  const markdown = [
    "# 第一章",
    "正文内容",
    "```markdown",
    "# 不是真实标题",
    "```",
    "## 真实二级标题",
  ].join("\n");

  const outline = parseMarkdownOutline(markdown);
  assert.deepEqual(
    outline.map((o) => ({ level: o.level, text: o.text, line: o.line })),
    [
      { level: 1, text: "第一章", line: 1 },
      { level: 2, text: "真实二级标题", line: 6 },
    ],
  );
});
