import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { formattingSpanAt, markdownFormattingPlugin, parseTextAttributes } from "./markdown-formatting.ts";

const md = new MarkdownIt({ html: false }).use(markdownFormattingPlugin);
test("formatting preserves nested emphasis and links and excludes code", () => {
  const html = md.render('普通[***红字***和[链接](https://example.com)]{color="#d32f2f" .underline}。\n\n`[代码]{color="#D32F2F"}`');
  assert.match(html, /color:#D32F2F/); assert.match(html, /text-decoration-line:underline/);
  assert.match(html, /<strong>/); assert.match(html, /<em>/); assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<code>\[代码\]/);
  assert.equal(parseTextAttributes('color="red;position:fixed"'), null);
  assert.equal(parseTextAttributes('align="invalid"'), null);
  assert.equal(formattingSpanAt('[[文档.md]]', 0), null);
  assert.match(md.render('[[网页](https://example.com)]{color="#D32F2F"}'), /<a href="https:\/\/example.com">网页<\/a>/);
  assert.equal(formattingSpanAt(String.raw`\[字面量]{color="#D32F2F"}`, 1), null);
});
test("paragraph alignment applies to whole paragraphs and nested blocks", () => {
  const html = md.render('::: {align="right"}\n\n外层\n\n::: {align="center"}\n\n内层\n\n:::\n\n[局部靠左]{align="left"}\n\n:::');
  assert.match(html, /<p style="text-align:right">外层/);
  assert.match(html, /<p style="text-align:center">内层/);
  assert.match(html, /<p style="text-align:left">/);
  assert.doesNotMatch(md.render('正文[几个字]{align="center"}末尾'), /<p style=/);
});

test("inline formatting does not cross blank paragraphs but keeps soft line breaks", () => {
  for (const gap of ['\n\n', '\r\n \t\r\n', '\\\n\n']) {
    assert.equal(formattingSpanAt(`[第一段${gap}第二段]{color="#D32F2F"}`, 0), null);
  }
  assert.ok(formattingSpanAt('[合法换行\n仍属一段]{color="#D32F2F"}', 0));
});
test("table and quote formatting use the same spans", () => {
  const html = md.render('| 项目 |\n| --- |\n| [**红字**]{color="#D32F2F"} |\n\n> [引用]{.underline color="#2563EB"}');
  assert.match(html, /<td><span[^>]*color:#D32F2F[^>]*><strong>红字/);
  assert.match(html, /<blockquote>/); assert.match(html, /color:#2563EB/);
});

test("heading alignment preserves the heading tag and inline emphasis", () => {
  const html = md.render('## [居中**标题**]{align="center"}\n\n::: {align="right"}\n## 分组标题\n:::');
  assert.match(html, /<h2 style="text-align:center"><span[^>]*>居中<strong>标题<\/strong><\/span><\/h2>/);
  assert.match(html, /<h2 style="text-align:right">分组标题<\/h2>/);
});
test("signature lines are explicit and fixed width; blank cells stay empty", () => {
  const html = md.render('::: {.signature align="right"}\n| 字段 | 内容 | 备注 |\n| --- | --- | --- |\n| 签字 | ____ | （签字） |\n| 日期 | [待补充]{color="#D32F2F"} | |\n| 空白 | | |\n:::');
  assert.match(html, /justify-content:flex-end/); assert.match(html, /4cm/);
  assert.equal((html.match(/border-bottom:/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<th|____|:::|>字段</); assert.match(html, /color:#D32F2F/);
});
