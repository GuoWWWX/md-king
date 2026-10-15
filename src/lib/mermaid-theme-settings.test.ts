import assert from "node:assert/strict";
import test from "node:test";
import { MERMAID_THEMES, mermaidConfig, mermaidDiagramType, normalizeMermaidThemes, resolveMermaidTheme } from "./mermaid-config.js";

test("旧配置默认配对原生多色主题，无效主题仅回退对应项", () => {
  assert.deepEqual(normalizeMermaidThemes(), { light: "redux-color", dark: "redux-dark-color", diagrams: {} });
  const result = normalizeMermaidThemes(JSON.parse('{"light":"unknown","dark":"neo-dark","diagrams":{"state":{"light":"forest","dark":"unknown"},"flowchart":{},"unknown":{"light":"forest"}}}'));
  assert.deepEqual(result, { light: "redux-color", dark: "neo-dark", diagrams: { state: { light: "forest" } } });
});

test("同一图可分别继承深浅默认值，单独覆盖不影响其他图", () => {
  const settings = normalizeMermaidThemes({ light: "neutral", dark: "dark", diagrams: { state: { light: "forest" } } });
  assert.equal(resolveMermaidTheme("stateDiagram-v2\n A --> B", false, settings), "forest");
  assert.equal(resolveMermaidTheme("stateDiagram-v2\n A --> B", true, settings), "dark");
  assert.equal(resolveMermaidTheme("flowchart LR\n A --> B", false, settings), "neutral");
  assert.equal(resolveMermaidTheme("flowchart LR\n A --> B", true, settings), "dark");
  assert.equal(resolveMermaidTheme("stateDiagram\n A --> B", false, { ...settings, diagrams: {} }), "neutral");
});

test("识别类型会跳过配置前言、初始化指令及注释，忽略标签中的类型词", () => {
  assert.equal(mermaidDiagramType('---\nconfig:\n  theme: forest\n---\n%% ignored\n%%{init: {"theme":"default"}}%%\ngraph LR\n A[sequenceDiagram]'), "flowchart");
  for (const [header, type] of [["classDiagram-v2", "class"], ["stateDiagram-v2", "state"], ["erDiagram", "er"], ["sequenceDiagram", "sequence"], ["C4Container", "c4"], ["xychart-beta", "xychart"], ["requirementDiagram", "requirement"], ["flowchart-elk", "flowchart"]]) {
    assert.equal(mermaidDiagramType(header), type);
  }
});

test("全部 11 个原生主题均可用于全局和图类型设置，不改写源码", () => {
  assert.equal(MERMAID_THEMES.length, 11);
  for (const { id } of MERMAID_THEMES) {
    const settings = normalizeMermaidThemes({ light: id, dark: id, diagrams: { sequence: { dark: id } } });
    assert.equal(resolveMermaidTheme("sequenceDiagram", true, settings), id);
    assert.equal(mermaidConfig("dark", id).theme, id);
    assert.equal(mermaidConfig("default", id).theme, id);
  }
});
