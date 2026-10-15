import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { highlightTree, tags, tagHighlighter } from "@lezer/highlight";
import { mermaidLanguage, mermaidLanguageDescription } from "./mermaid-language.ts";

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: "keyword" },
  { tag: tags.string, class: "string" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.operator, class: "operator" },
  { tag: tags.number, class: "number" },
  { tag: tags.typeName, class: "name" },
]);

function tokens(source: string, fenced = false) {
  const parser = fenced ? markdown({ codeLanguages: [mermaidLanguageDescription] }).language.parser : mermaidLanguage.parser;
  const result: Array<{ text: string; kind: string }> = [];
  highlightTree(parser.parse(source), highlighter, (from, to, kind) => result.push({ text: source.slice(from, to), kind }));
  return result;
}

test("Mermaid 源码区分关键字、中文节点、连线、注释和样式数值", () => {
  const result = tokens('flowchart LR\n%% 说明\n A[开始] --> B{通过？}\n classDef done fill:#d1fae5,stroke-width:2px;');
  for (const [text, kind] of [["flowchart", "keyword"], ["[开始]", "string"], ["{通过？}", "string"], ["-->", "operator"], ["%% 说明", "comment"], ["#d1fae5", "number"], ["2px", "number"]]) {
    assert.ok(result.some(token => token.text === text && token.kind === kind), `${text}: ${JSON.stringify(result)}`);
  }
});

test("字符串中的注释符保留为字符串，多行与转义引号不会泄露高亮状态", () => {
  const result = tokens('sequenceDiagram\n title "第一行\\\"\n%% 标题内容"\n%% 真正注释\n A->>B: "https://example.com/#part"');
  assert.ok(result.some(token => token.text === "%% 标题内容\"" && token.kind === "string"));
  assert.ok(result.some(token => token.text === "%% 真正注释" && token.kind === "comment"));
  assert.ok(result.some(token => token.text === '"https://example.com/#part"' && token.kind === "string"));
});

test("常见 Mermaid 类型的声明均着色，节点名称不会吞掉紧邻的箭头", () => {
  for (const header of ["stateDiagram-v2", "classDiagram", "erDiagram", "sequenceDiagram", "gantt", "mindmap", "C4Context", "xychart-beta", "radar-beta"]) {
    assert.deepEqual(tokens(header), [{ text: header, kind: "keyword" }]);
  }
  assert.deepEqual(tokens("A-->B"), [{ text: "A", kind: "name" }, { text: "-->", kind: "operator" }, { text: "B", kind: "name" }]);
});

test("Mermaid 高亮接入 Markdown 围栏，支持大小写和围栏属性", () => {
  for (const info of ["mermaid", "Mermaid", 'mermaid {caption="流程图"}']) {
    const source = `正文\n\n\`\`\`${info}\nflowchart LR\nA[开始]-->B[结束]\n\`\`\``;
    const result = tokens(source, true);
    assert.ok(result.some(token => token.text === "flowchart" && token.kind === "keyword"));
    assert.ok(result.some(token => token.text === "[开始]" && token.kind === "string"));
  }
});
