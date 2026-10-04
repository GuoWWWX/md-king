import assert from "node:assert/strict";
import test from "node:test";
import { parseTableInlineMarkdown } from "./table-inline-renderer.ts";

test("解析表格单元格的粗体、斜体、删除线、行内代码和链接", () => {
  assert.deepEqual(parseTableInlineMarkdown("**粗体** *斜体* ~~删除~~ `code` [链接](https://example.com)"), [
    { type: "element", tag: "strong", children: [{ type: "text", value: "粗体" }] },
    { type: "text", value: " " },
    { type: "element", tag: "em", children: [{ type: "text", value: "斜体" }] },
    { type: "text", value: " " },
    { type: "element", tag: "s", children: [{ type: "text", value: "删除" }] },
    { type: "text", value: " " },
    { type: "code", value: "code" },
    { type: "text", value: " " },
    { type: "element", tag: "a", href: "https://example.com", children: [{ type: "text", value: "链接" }] },
  ]);
});

test("解析闭合星号后紧邻正文的宽松加粗", () => {
  assert.deepEqual(parseTableInlineMarkdown("**实施单元：**集控"), [
    { type: "element", tag: "strong", children: [{ type: "text", value: "实施单元：" }] },
    { type: "text", value: "集控" },
  ]);
});

test("表格单元格把 br 标签渲染为换行节点", () => {
  assert.deepEqual(parseTableInlineMarkdown("第一行<br>第二行<br />第三行</br>"), [
    { type: "text", value: "第一行" },
    { type: "break" },
    { type: "text", value: "第二行" },
    { type: "break" },
    { type: "text", value: "第三行" },
    { type: "break" },
  ]);
});

test("表格单元格支持常用 Markdown 内嵌 HTML", () => {
  assert.deepEqual(parseTableInlineMarkdown("<mark>重点</mark> <u>下划线</u> H<sub>2</sub>O <kbd>Ctrl</kbd>"), [
    { type: "element", tag: "mark", children: [{ type: "text", value: "重点" }] },
    { type: "text", value: " " },
    { type: "element", tag: "u", children: [{ type: "text", value: "下划线" }] },
    { type: "text", value: " H" },
    { type: "element", tag: "sub", children: [{ type: "text", value: "2" }] },
    { type: "text", value: "O " },
    { type: "element", tag: "kbd", children: [{ type: "text", value: "Ctrl" }] },
  ]);
});

test("表格单元格将行内公式作为独立节点且不把方括号识别为链接", () => {
  assert.deepEqual(
    parseTableInlineMarkdown("命中率 $R=N_{\\mathrm{hit}}/N_{\\mathrm{alarm}}$，区间 $[a,b]$"),
    [
      { type: "text", value: "命中率 " },
      { type: "math", value: "R=N_{\\mathrm{hit}}/N_{\\mathrm{alarm}}", source: "$R=N_{\\mathrm{hit}}/N_{\\mathrm{alarm}}$" },
      { type: "text", value: "，区间 " },
      { type: "math", value: "[a,b]", source: "$[a,b]$" },
    ],
  );
});

test("表格单元格支持反斜杠行内公式并保留外层加粗", () => {
  assert.deepEqual(parseTableInlineMarkdown("**公式 \\(a \\le b\\)**"), [
    {
      type: "element",
      tag: "strong",
      children: [
        { type: "text", value: "公式 " },
        { type: "math", value: "a \\le b", source: "\\(a \\le b\\)" },
      ],
    },
  ]);
});

test("常用 HTML 会过滤事件属性，危险链接不会成为可执行节点", () => {
  const nodes = parseTableInlineMarkdown("<img src=x onerror=alert(1)> <script>alert(1)</script> [危险](javascript:alert(1))");
  assert.equal(JSON.stringify(nodes).includes('"tag":"a"'), false);
  assert.deepEqual(nodes[0], { type: "image", src: "x", alt: "" });
  assert.equal(JSON.stringify(nodes).includes("onerror"), false);
  assert.equal(JSON.stringify(nodes).includes("<script>"), true);
});

test("支持粗斜体嵌套、自动链接和安全图片", () => {
  const nodes = parseTableInlineMarkdown('***重点*** <https://example.com> ![图标](https://example.com/icon.png "说明")');
  assert.deepEqual(nodes, [
    {
      type: "element",
      tag: "em",
      children: [{ type: "element", tag: "strong", children: [{ type: "text", value: "重点" }] }],
    },
    { type: "text", value: " " },
    {
      type: "element",
      tag: "a",
      href: "https://example.com",
      children: [{ type: "text", value: "https://example.com" }],
    },
    { type: "text", value: " " },
    { type: "image", src: "https://example.com/icon.png", alt: "图标", title: "说明" },
  ]);
});

test("支持 Obsidian 文档引用和直接粘贴的外链", () => {
  assert.deepEqual(parseTableInlineMarkdown("[[笔记/说明.md|技术说明]] https://example.com/docs"), [
    {
      type: "element",
      tag: "a",
      href: "笔记/说明.md",
      wikilinkTarget: "笔记/说明.md",
      children: [{ type: "text", value: "技术说明" }],
    },
    { type: "text", value: " " },
    { type: "element", tag: "a", href: "https://example.com/docs", children: [{ type: "text", value: "https://example.com/docs" }] },
  ]);
});

test("无别名的 Obsidian 文档引用只显示最后的文件名", () => {
  assert.deepEqual(
    parseTableInlineMarkdown("[[../10-AI应用开发/08-项目实战/07-项目-业务Agent系统]]"),
    [{
      type: "element",
      tag: "a",
      href: "../10-AI应用开发/08-项目实战/07-项目-业务Agent系统",
      wikilinkTarget: "../10-AI应用开发/08-项目实战/07-项目-业务Agent系统",
      children: [{ type: "text", value: "07-项目-业务Agent系统" }],
    }],
  );
});

test("显式别名即使等于完整路径也保持用户写法", () => {
  assert.deepEqual(parseTableInlineMarkdown("[[笔记/说明.md|笔记/说明.md]]"), [{
    type: "element",
    tag: "a",
    href: "笔记/说明.md",
    wikilinkTarget: "笔记/说明.md",
    children: [{ type: "text", value: "笔记/说明.md" }],
  }]);
});

test("普通 Markdown 链接不会被标记为 Obsidian 文档引用", () => {
  assert.deepEqual(parseTableInlineMarkdown("[说明](笔记/说明.md)"), [
    {
      type: "element",
      tag: "a",
      href: "%E7%AC%94%E8%AE%B0/%E8%AF%B4%E6%98%8E.md",
      children: [{ type: "text", value: "说明" }],
    },
  ]);
});

test("直接粘贴的外链不会吞掉中文句末标点", () => {
  assert.deepEqual(parseTableInlineMarkdown("见 https://example.com/docs。"), [
    { type: "text", value: "见 " },
    { type: "element", tag: "a", href: "https://example.com/docs", children: [{ type: "text", value: "https://example.com/docs" }] },
    { type: "text", value: "。" },
  ]);
});
