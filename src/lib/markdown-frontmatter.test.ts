import assert from "node:assert/strict";
import test from "node:test";
import { parseYamlFrontmatter, splitYamlFrontmatter } from "./markdown-frontmatter.ts";

test("提取 YAML 文档信息并保留 Markdown 正文", () => {
  assert.deepEqual(splitYamlFrontmatter('---\ntitle: "测试标题"\nauthor: 张三\ndate: 2026-08-16\n---\n# 正文'), {
    metadata: { title: "测试标题", author: "张三", date: "2026-08-16" },
    markdown: "# 正文",
  });
});

test("不把普通分割线误判为 YAML 文档信息", () => {
  const markdown = "---\n普通正文\n---\n# 标题";
  assert.deepEqual(splitYamlFrontmatter(markdown), { markdown });
});

test("未闭合的 YAML 头部保留为原始 Markdown", () => {
  const markdown = "---\ntitle: 未闭合\n# 标题";
  assert.deepEqual(splitYamlFrontmatter(markdown), { markdown });
});

test("解析 Obsidian 常用文档属性和数组值", () => {
  const markdown = "---\ntitle: 项目周报\ntags: [项目, 周报]\naliases:\n  - 进度汇总\n  - weekly\n状态: 草稿\n...\n# 正文";
  const frontmatter = parseYamlFrontmatter(markdown);
  assert.ok(frontmatter);
  assert.equal(frontmatter.from, 0);
  assert.equal(markdown.slice(frontmatter.from, frontmatter.to), "---\ntitle: 项目周报\ntags: [项目, 周报]\naliases:\n  - 进度汇总\n  - weekly\n状态: 草稿\n...\n");
  assert.equal(frontmatter.markdown, "# 正文");
  assert.deepEqual(frontmatter.entries, [
    { key: "title", value: "项目周报", sourceFrom: markdown.indexOf("title:") },
    { key: "tags", value: ["项目", "周报"], sourceFrom: markdown.indexOf("tags:") },
    { key: "aliases", value: ["进度汇总", "weekly"], sourceFrom: markdown.indexOf("aliases:") },
    { key: "状态", value: "草稿", sourceFrom: markdown.indexOf("状态:") },
  ]);
});

test("解析 Windows 换行的属性区范围", () => {
  const markdown = "---\r\ntags:\r\n  - 版本一\r\n---\r\n# 正文";
  const frontmatter = parseYamlFrontmatter(markdown);
  assert.ok(frontmatter);
  assert.equal(markdown.slice(frontmatter.from, frontmatter.to), "---\r\ntags:\r\n  - 版本一\r\n---\r\n");
  assert.deepEqual(frontmatter.entries, [
    { key: "tags", value: ["版本一"], sourceFrom: markdown.indexOf("tags:") },
  ]);
});
