import assert from "node:assert/strict";
import test from "node:test";
import { livePreviewMarkdownLanguage } from "./markdown-language.ts";

function parsedNodeNames(source: string): string {
  return livePreviewMarkdownLanguage.parser.parse(source).toString();
}

test("四空格缩进后仍解析 Markdown 块语义", () => {
  assert.match(parsedNodeNames("    # 标题"), /ATXHeading1/);
  assert.match(parsedNodeNames("    [技术说明](\.\.\/技术\/说明\.md)"), /Link\(/);
  assert.match(parsedNodeNames("    - 列表项"), /BulletList\(/);
  assert.match(parsedNodeNames("    > 引用内容"), /Blockquote\(/);
});

test("四空格缩进后仍解析行内 Markdown", () => {
  const tree = parsedNodeNames("    **粗体** 和 *斜体*");
  assert.match(tree, /StrongEmphasis\(/);
  assert.match(tree, /Emphasis\(/);
  assert.doesNotMatch(tree, /CodeBlock\(/);
});

test("尖括号中的内容按普通 Markdown 文本保留", () => {
  const tree = parsedNodeNames("> [!question]- 点击查看答案\n> <先给结论和最关键的理由>");
  assert.doesNotMatch(tree, /HTMLTag|HTMLBlock/);
});
