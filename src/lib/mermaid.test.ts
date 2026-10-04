import assert from "node:assert/strict";
import test from "node:test";

import { measureSvg, normalizeMermaidSource } from "./mermaid.ts";

test("Mermaid 源码方向大小写归一化", () => {
  // 顶层流程图方向小写容错
  assert.equal(normalizeMermaidSource("flowchart lr\n  A --> B"), "flowchart LR\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart rl\n  A --> B"), "flowchart RL\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart tb\n  A --> B"), "flowchart TB\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart td\n  A --> B"), "flowchart TD\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart bt\n  A --> B"), "flowchart BT\n  A --> B");

  // graph 语法方向容错
  assert.equal(normalizeMermaidSource("graph lr\n  A --> B"), "graph LR\n  A --> B");
  assert.equal(normalizeMermaidSource("graph rl\n  A --> B"), "graph RL\n  A --> B");

  // 前导空格容错
  assert.equal(normalizeMermaidSource("  flowchart   lr\n  A --> B"), "flowchart LR\n  A --> B");

  // 子图与状态图内部 direction 指令容错
  const subSource = `flowchart TB
  subgraph S1
    direction lr
    a --> b
  end`;
  assert.equal(
    normalizeMermaidSource(subSource),
    `flowchart TB
  subgraph S1
    direction LR
    a --> b
  end`,
  );

  // 状态图内部 direction 指令
  const stateSource = `stateDiagram-v2
  direction lr
  [*] --> S1`;
  assert.equal(
    normalizeMermaidSource(stateSource),
    `stateDiagram-v2
  direction LR
  [*] --> S1`,
  );

  // 不误改普通单词（包含 lr/tb 字符的普通标识符）
  const normalSource = `flowchart LR
  alert --> clearance`;
  assert.equal(normalizeMermaidSource(normalSource), normalSource);
});

test("measureSvg 精确提取 SVG 尺寸并支持科学计数法与逗号分隔", () => {
  // 标准空格分隔 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="0 0 500 300"></svg>'), { width: 500, height: 300 });

  // 逗号分隔 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="0, 0, 640, 480"></svg>'), { width: 640, height: 480 });

  // 状态图/类图常出现的微小浮点数科学计数法 viewBox（不应匹配失败回退到 800x400）
  assert.deepEqual(
    measureSvg('<svg viewBox="9.5367431640625e-7 24.000003814697266 201.82351684570312 52.999996185302734"></svg>'),
    { width: 201.82351684570312, height: 52.999996185302734 },
  );

  // 负坐标起始 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="-10 -20 400 200"></svg>'), { width: 400, height: 200 });

  // width / height 属性提取（普通与带 px 后缀）
  assert.deepEqual(measureSvg('<svg width="320" height="240"></svg>'), { width: 320, height: 240 });
  assert.deepEqual(measureSvg('<svg width="320px" height="240px"></svg>'), { width: 320, height: 240 });

  // 无法识别时的安全兜底
  assert.deepEqual(measureSvg("<svg></svg>"), { width: 800, height: 400 });
});
