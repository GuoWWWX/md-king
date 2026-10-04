import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownInlineHtmlTag, splitMarkdownInlineHtml } from "./markdown-inline-html.ts";

test("识别 Markdown 常用 HTML 标签和属性", () => {
  assert.deepEqual(parseMarkdownInlineHtmlTag('<a href="https://example.com" title="示例">'), {
    type: "tag",
    raw: '<a href="https://example.com" title="示例">',
    name: "a",
    closing: false,
    selfClosing: false,
    attributes: { href: "https://example.com", title: "示例" },
  });
  assert.equal(parseMarkdownInlineHtmlTag("<script>"), null);
  assert.equal(parseMarkdownInlineHtmlTag("<示例文本>"), null);
});

test("支持 br 的成对、闭合和大小写变体", () => {
  const parts = splitMarkdownInlineHtml("前<br>中<br />后</br><BR>");
  assert.deepEqual(parts.map((part) => part.type === "text" ? part.value : `${part.closing ? "/" : ""}${part.name}`), [
    "前", "br", "中", "br", "后", "/br", "br",
  ]);
});

test("未开放的标签保持普通文本", () => {
  assert.deepEqual(splitMarkdownInlineHtml("前<script>alert(1)</script>后"), [
    { type: "text", value: "前<script>alert(1)</script>后" },
  ]);
});
