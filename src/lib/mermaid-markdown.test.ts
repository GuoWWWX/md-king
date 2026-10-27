import assert from "node:assert/strict";
import test from "node:test";
import { mermaidMarkdownLayout, prepareMermaidMarkdown } from "./mermaid-markdown.ts";

test("流程图标签支持 Markdown 格式、列表和公式", () => {
  const source = 'flowchart LR\nsubgraph g["**标题**"]\nA["**粗体** *斜体* `代码` $x^2$<br/>- 第一项<br/>- 第二项"] -->|"**连线** `id`"| B["1. 第一项<br/>2. 第二项"]\nend';
  const result = prepareMermaidMarkdown(source);
  assert.equal(result.hasRichLabels, true);
  for (const expected of ["<strong>标题</strong>", "<strong>粗体</strong>", "<em>斜体</em>", "<code>代码</code>", "$$x^2$$", "<ul>", "<ol>", "<strong>连线</strong>"]) {
    assert.ok(result.source.includes(expected), expected);
  }
});

test("兼容 Mermaid 原生 Markdown 字符串和内部代码反引号", () => {
  const result = prepareMermaidMarkdown('flowchart LR\nA["`**标题** 与 `x`<br/>- 内容`"] --> B["正常"]');
  assert.equal(result.hasRichLabels, true);
  assert.match(result.source, /<strong>标题<\/strong>/);
  assert.match(result.source, /<code>x<\/code>/);
  assert.match(result.source, /<ul>/);
});

test("普通标签、注释、样式和链接配置保持原样", () => {
  const source = 'flowchart LR\n%% A["**注释**"]\nA["普通 3 * 4"] --> B["金额 $5"]\nclick A "https://example.com/**"\nclassDef a fill:#123';
  assert.deepEqual(prepareMermaidMarkdown(source), { source, hasRichLabels: false });
});

test("注释中的未闭合引号不会吞掉后面的标签", () => {
  const source = 'flowchart LR\n%% 未闭合 " 注释\nA["**节点**"]';
  const result = prepareMermaidMarkdown(source);
  assert.ok(result.source.includes('%% 未闭合 " 注释'));
  assert.ok(result.source.includes('<strong>节点</strong>'));
});

test("保留 frontmatter、跨行配置和行尾注释的原文", () => {
  const source = '---\nconfig:\n  label: "**配置原文**"\n---\n%%{init: {\n "label": "**指令原文**"\n}}%%\nflowchart LR\nA["普通"] %% "未闭合注释\nB["**节点**"]';
  const result = prepareMermaidMarkdown(source);
  assert.ok(result.source.includes('label: "**配置原文**"'));
  assert.ok(result.source.includes('"label": "**指令原文**"'));
  assert.ok(result.source.includes('%% "未闭合注释'));
  assert.ok(result.source.includes('<strong>节点</strong>'));
});

test("用户明确关闭 HTML 标签时保留 Mermaid 原有行为", () => {
  for (const source of [
    '---\nconfig:\n  htmlLabels: false\n---\nflowchart LR\nA["**节点**"]',
    '%%{init: {"flowchart": {"htmlLabels": false}}}%%\nflowchart LR\nA["**节点**"]',
  ]) assert.deepEqual(prepareMermaidMarkdown(source), { source, hasRichLabels: false });
});

test("代码中的美元符号保持原样，已有 Mermaid 公式不被改写", () => {
  const source = 'flowchart LR\nA["`$x$` 与 $$y^2$$"]';
  const result = prepareMermaidMarkdown(source);
  assert.ok(result.source.includes('<code>$x$</code>'));
  assert.ok(result.source.includes('$$y^2$$'));
});

test("状态图、类图、实体关系图等的引号标签支持格式", () => {
  for (const source of [
    'stateDiagram-v2\nstate "**状态** `id` $x^2$" as A',
    'classDiagram\nclass A["**状态** `id` $x^2$"]',
    'erDiagram\nA ||--o{ B : "**状态** `id` $x^2$"',
    'requirementDiagram\nrequirement doc {\ntext: "**状态** `id` $x^2$"\n}',
    'block-beta\nA["**状态** `id` $x^2$"]',
    'kanban\nboard["**状态** `id` $x^2$"]',
  ]) {
    const result = prepareMermaidMarkdown(source);
    assert.equal(result.hasRichLabels, true, source);
    assert.ok(result.source.includes('<strong>状态</strong>'), source);
    assert.ok(result.source.includes('<code>id</code>'), source);
    assert.ok(result.source.includes('$$x^2$$'), source);
  }
});

test("架构图保留行内代码和多行列表直到 SVG 标签完成排版", () => {
  const source = 'architecture-beta\nservice api(server)["**服务** `id` $x^2$<br/>- 第一项<br/>- 第二项"]';
  const result = prepareMermaidMarkdown(source);
  assert.equal(result.hasRichLabels, true);
  assert.deepEqual(Object.values(result.replacements ?? {}), ['**服务** `id` $x^2$<br/>- 第一项<br/>- 第二项']);
  assert.match(result.source, /\["MKMD\d+X"\]/);
});

test("没有适配的图表类型保持原样", () => {
  const source = 'sequenceDiagram\nA->>B: **消息** $x^2$';
  assert.deepEqual(prepareMermaidMarkdown(source), { source, hasRichLabels: false });
});

test("固定高度图表为单独使用列表的标签预留空间", () => {
  assert.ok((mermaidMarkdownLayout('gantt\n任务<br/>- 第一项<br/>- 第二项 :a, 2026-01-01, 1d').ganttBarHeight ?? 0) > 20);
  assert.ok((mermaidMarkdownLayout('packet-beta\n0-7: "标题<br/>1. 第一项<br/>2. 第二项"').packetRowHeight ?? 0) > 32);
  assert.ok((mermaidMarkdownLayout('journey\n标题<br/>- 第一项<br/>- 第二项: 5: 用户').journeyTaskHeight ?? 0) > 50);
});
