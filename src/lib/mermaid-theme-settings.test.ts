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

test("通用主题同时出现在深浅列表，专用主题仅出现在对应模式", () => {
  const light = MERMAID_THEMES.filter((theme) => theme.mode === "both" || theme.mode === "light").map((theme) => theme.id);
  const dark = MERMAID_THEMES.filter((theme) => theme.mode === "both" || theme.mode === "dark").map((theme) => theme.id);
  assert.deepEqual(light, ["redux-color", "redux", "neo", "default", "forest", "neutral", "base"]);
  assert.deepEqual(dark, ["redux-dark-color", "redux-dark", "neo-dark", "default", "dark", "forest", "neutral", "base"]);
  assert.deepEqual(light.filter((theme) => dark.includes(theme)), ["default", "forest", "neutral", "base"]);
});

test("自定义组合保留跨模式主题与图类型覆盖，序列化后仍可复用", () => {
  const selection = { light: "dark", dark: "default", diagrams: { sequence: { light: "neo-dark", dark: "forest" } } } as const;
  const settings = normalizeMermaidThemes({ ...selection, presets: [{ name: "  我的组合  ", ...selection }] });
  const reloaded = normalizeMermaidThemes(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(reloaded.presets, [{ name: "我的组合", ...selection }]);
  const applied = normalizeMermaidThemes(reloaded.presets![0]);
  assert.equal(resolveMermaidTheme("flowchart LR\n A --> B", true, applied), "default");
  assert.equal(resolveMermaidTheme("sequenceDiagram", false, applied), "neo-dark");
  assert.equal(resolveMermaidTheme("sequenceDiagram", true, applied), "forest");
  assert.equal(applied.presets, undefined);
});

test("组合清理空名称和重复名称，并只修正无效主题，不嵌套保存组合", () => {
  const settings = normalizeMermaidThemes(JSON.parse(JSON.stringify({ presets: [
    { name: " ", light: "forest" },
    { name: "工作", light: "bad", dark: "default", diagrams: { state: { dark: "forest", light: "bad" } }, presets: [{ name: "不应嵌套" }] },
    { name: " 工作 ", light: "neo" },
  ] })));
  assert.deepEqual(settings.presets, [{ name: "工作", light: "redux-color", dark: "default", diagrams: { state: { dark: "forest" } } }]);
});
