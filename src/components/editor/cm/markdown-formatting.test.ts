import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM, type MarkdownParser } from "@lezer/markdown";
import { markdownFormattingSyntax } from "./markdown-formatting.ts";

const parser = (markdownLanguage.parser as MarkdownParser).configure([markdownFormattingSyntax, ...GFM]);
test("attribute spans are not shortcut links and retain inline Markdown", () => {
  const tree = parser.parse('## [居中**标题**]{align="center"}\n\n[正文[链接](https://example.com)]{.underline}\n\n- [ ] 待办');
  const nodes: string[] = [];
  tree.iterate({ enter: node => { nodes.push(node.name); } });
  assert.equal(nodes.filter(name => name === "TextFormat").length, 2);
  assert.equal(nodes.filter(name => name === "Link").length, 1);
  assert.ok(nodes.includes("ATXHeading2") && nodes.includes("StrongEmphasis") && nodes.includes("TaskMarker"));
});
test("nested formats keep their offsets while code and wikilinks are unchanged", () => {
  const source = '[外层[内层]{.underline}]{color="#D32F2F"}\n\n`[代码]{align="center"}`\n\n[[目标.md]]';
  const ranges: string[] = [];
  parser.parse(source).iterate({ enter: node => { if (node.name === "TextFormat") ranges.push(source.slice(node.from, node.to)); } });
  assert.deepEqual(ranges, ['[外层[内层]{.underline}]{color="#D32F2F"}', '[内层]{.underline}']);
});
