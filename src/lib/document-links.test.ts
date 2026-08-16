import assert from "node:assert/strict";
import test from "node:test";
import { defaultObsidianWikilinkLabel, documentLinkFragment, findBareExternalLinks, findObsidianWikilinks, isMarkdownWikilinkTarget, parseObsidianWikilink, resolveVaultDocumentLink } from "./document-links.ts";

test("解析 Obsidian 文档引用及显示名", () => {
  assert.deepEqual(parseObsidianWikilink("[[笔记/技术/说明.md]]"), { target: "笔记/技术/说明.md", label: "笔记/技术/说明.md" });
  assert.deepEqual(parseObsidianWikilink("[[笔记/技术/说明.md#安装|安装说明]]"), { target: "笔记/技术/说明.md#安装", label: "安装说明" });
  assert.equal(parseObsidianWikilink("![[图片.png]]"), undefined);
  assert.equal(parseObsidianWikilink("[[javascript:alert(1)]]"), undefined);
});

test("扫描 wikilink 时保留显示名范围并忽略嵌入", () => {
  assert.deepEqual(findObsidianWikilinks("见 [[docs/说明.md|技术说明]] 和 ![[图片.png]]"), [
    { target: "docs/说明.md", label: "技术说明", displayLabel: "技术说明", from: 2, to: 21, displayFrom: 15, displayTo: 19 },
  ]);
});

test("无别名的 wikilink 默认显示文件名，拖选定位到文件名源码", () => {
  const source = "见 [[10-AI应用开发/08-项目实战/_index.md]]";
  const [link] = findObsidianWikilinks(source);

  assert.equal(link.displayLabel, "_index");
  assert.equal(source.slice(link.displayFrom, link.displayTo), "_index");
  assert.equal(defaultObsidianWikilinkLabel("笔记/说明.md#安装"), "说明");
});

test("显式指向非 Markdown 文件的 wikilink 可被识别", () => {
  assert.equal(isMarkdownWikilinkTarget("笔记/说明.md"), true);
  assert.equal(isMarkdownWikilinkTarget("笔记/说明"), true);
  assert.equal(isMarkdownWikilinkTarget("#当前标题"), true);
  assert.equal(isMarkdownWikilinkTarget("笔记/说明.pdf"), false);
  assert.equal(isMarkdownWikilinkTarget("笔记/说明.txt"), false);
});

test("直接粘贴的外链会忽略行尾标点", () => {
  assert.deepEqual(findBareExternalLinks("请看 https://example.com/docs。以及 https://example.org/test)."), [
    { from: 3, to: 27, target: "https://example.com/docs" },
    { from: 31, to: 55, target: "https://example.org/test" },
  ]);
});

test("提取跨文档标题锚点", () => {
  assert.equal(documentLinkFragment("notes/说明.md#安装"), "#安装");
  assert.equal(documentLinkFragment("#当前标题"), "#当前标题");
  assert.equal(documentLinkFragment("notes/说明.md"), undefined);
});

test("wikilink 目标沿用现有相对文档路径解析", () => {
  assert.equal(resolveVaultDocumentLink("../目标.md#安装", "笔记/当前.md", ["目标.md"]), "目标.md");
});
