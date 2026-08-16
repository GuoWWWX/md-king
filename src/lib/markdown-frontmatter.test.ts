import assert from "node:assert/strict";
import test from "node:test";
import { splitYamlFrontmatter } from "./markdown-frontmatter.ts";

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
