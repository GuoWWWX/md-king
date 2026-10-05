import assert from "node:assert/strict";
import test from "node:test";
import {
  computeActiveHeadingLine,
  findActiveOutlineLine,
  parseMarkdownOutline,
  resolveActiveHeadingFromReadingLine,
  type HeadingViewportPosition,
} from "./document-outline.ts";

test("parseMarkdownOutline 正确提取标题并忽略代码块内部的井号", () => {
  const markdown = [
    "# 第一章 导论",
    "正文段落",
    "```python",
    "# 这是代码注释，不是大纲标题",
    "print('hello')",
    "```",
    "## 1.1 背景与动机",
    "段落内容",
    "### 1.1.1 细节分析",
  ].join("\n");

  const outline = parseMarkdownOutline(markdown);
  assert.equal(outline.length, 3);
  assert.deepEqual(outline[0], { level: 1, text: "第一章 导论", line: 1 });
  assert.deepEqual(outline[1], { level: 2, text: "1.1 背景与动机", line: 7 });
  assert.deepEqual(outline[2], { level: 3, text: "1.1.1 细节分析", line: 9 });
});

test("findActiveOutlineLine: 向后兼容的基础行号查找", () => {
  const outline = [
    { level: 1, text: "第一章", line: 1 },
    { level: 2, text: "1.1", line: 10 },
    { level: 2, text: "1.2", line: 20 },
  ];
  assert.equal(findActiveOutlineLine(outline, 5), 1);
  assert.equal(findActiveOutlineLine(outline, 15), 10);
  assert.equal(findActiveOutlineLine(outline, 25), 20);
});

test("computeActiveHeadingLine: 空大纲保护", () => {
  const result = computeActiveHeadingLine([], { clientHeight: 800 });
  assert.equal(result, undefined);
});

test("computeActiveHeadingLine: 文档首部（所有标题都在视线下方时返回首个标题）", () => {
  const headings: HeadingViewportPosition[] = [
    { line: 10, top: 250, bottom: 280 },
    { line: 30, top: 600, bottom: 630 },
  ];
  const result = computeActiveHeadingLine(headings, { clientHeight: 800 });
  assert.equal(result, 10);
});

test("computeActiveHeadingLine: 视口直达第 5 章大标题（即使上方存在空行分割线，精准激活第 5 章）", () => {
  // 模拟真实场景：第 4 章第 2 小节在视口上方（top: -300px），第 5 章大标题停在视口顶部偏下（top: 24px）
  const headings: HeadingViewportPosition[] = [
    { line: 141, top: -300, bottom: -270 }, // 4.2 小节
    { line: 166, top: 24, bottom: 64 },    // 5. 混合持久化
    { line: 186, top: 480, bottom: 510 },   // 5.1 小节
  ];
  // 视线判定线约为 120px，line 166 的 top(24) <= 120，应命中第 5 章大标题 line 166
  const result = computeActiveHeadingLine(headings, { clientHeight: 800 });
  assert.equal(result, 166);
});

test("computeActiveHeadingLine: 点击目录跳转后稳定对齐（yMargin 24px，无任何回退误判）", () => {
  const headings: HeadingViewportPosition[] = [
    { line: 20, top: -800, bottom: -770 },
    { line: 55, top: 24, bottom: 56 },
    { line: 90, top: 700, bottom: 730 },
  ];
  const result = computeActiveHeadingLine(headings, { clientHeight: 900 });
  assert.equal(result, 55);
});

test("computeActiveHeadingLine: 深入正文阅读（标题滚出视口上方，稳定归属当前章节）", () => {
  // 第 5 章大标题已滚到视口上方 -180px，视口中为长篇正文，下一小节在 500px 处
  const headings: HeadingViewportPosition[] = [
    { line: 141, top: -900, bottom: -870 },
    { line: 166, top: -180, bottom: -140 },
    { line: 186, top: 500, bottom: 530 },
  ];
  const result = computeActiveHeadingLine(headings, { clientHeight: 800 });
  assert.equal(result, 166);
});

test("computeActiveHeadingLine: 连续子小节平滑推进", () => {
  const headings: HeadingViewportPosition[] = [
    { line: 10, top: -120, bottom: -90 }, // 主标题
    { line: 25, top: 40, bottom: 70 },    // 子小节 1
    { line: 40, top: 220, bottom: 250 },  // 子小节 2
  ];
  // 子小节 1 处于视线区（top: 40 <= 120），子小节 2 尚在下方（220 > 120）
  assert.equal(computeActiveHeadingLine(headings, { clientHeight: 800 }), 25);

  // 继续向下滚动，子小节 2 进入视线区（top: 60 <= 120）
  const rolledHeadings: HeadingViewportPosition[] = [
    { line: 10, top: -280, bottom: -250 },
    { line: 25, top: -120, bottom: -90 },
    { line: 40, top: 60, bottom: 90 },
  ];
  assert.equal(computeActiveHeadingLine(rolledHeadings, { clientHeight: 800 }), 40);
});

test("computeActiveHeadingLine: 滚动到文档最底部时强制激活最后一个章节", () => {
  const headings: HeadingViewportPosition[] = [
    { line: 10, top: -500, bottom: -470 },
    { line: 30, top: 200, bottom: 230 },
    { line: 50, top: 450, bottom: 480 }, // 篇幅较短，即便到底也只能停在 450px
  ];
  const result = computeActiveHeadingLine(headings, { clientHeight: 800, isAtBottom: true });
  assert.equal(result, 50);
});

test("resolveActiveHeadingFromReadingLine: 读者正在阅读各章节正文、图表或代码块时精准归属", () => {
  const outline = [
    { level: 1, text: "第一章 项目背景与概述", line: 1 },
    { level: 1, text: "第二章 系统架构设计", line: 20 },
    { level: 2, text: "2.1 模块划分", line: 28 },
    { level: 1, text: "第三章 渲染引擎实现", line: 45 },
    { level: 1, text: "第四章 AOF 重写与日志机制", line: 70 },
    { level: 1, text: "第五章 性能评测与优化", line: 110 },
    { level: 1, text: "第六章 总结与展望", line: 150 },
  ];

  // 1. 在第一章前言或第一章正文中（例如 line 5）
  assert.equal(resolveActiveHeadingFromReadingLine(outline, 5), 1);

  // 2. 深入第二章正文（例如 line 25）
  assert.equal(resolveActiveHeadingFromReadingLine(outline, 25), 20);

  // 3. 进入 2.1 子小节（例如 line 35）
  assert.equal(resolveActiveHeadingFromReadingLine(outline, 35), 28);

  // 4. 视口第一行露出的正是第五章正文/图表（例如 line 125，第四章早已滚过）
  // 此时必须精准激活第五章（line 110），绝不能错误显示在第四章
  assert.equal(resolveActiveHeadingFromReadingLine(outline, 125), 110);

  // 5. 真实案例回归：文档末尾窗口第一行是第四章内容，下方紧邻简短的“上下篇导航”，必须准确高亮第四章
  const interviewOutline = [
    { level: 2, text: "一、为什么要做...", line: 10 },
    { level: 2, text: "二、架构设计...", line: 50 },
    { level: 2, text: "三、核心方案...", line: 100 },
    { level: 2, text: "四、高频面试自测", line: 200 },
    { level: 2, text: "上下篇导航", line: 230 },
  ];
  // 窗口第一行为 line 200（第四章大标题）或 line 205（Q1/Q2 正文）：
  assert.equal(resolveActiveHeadingFromReadingLine(interviewOutline, 200), 200);
  assert.equal(resolveActiveHeadingFromReadingLine(interviewOutline, 215), 200);
});
