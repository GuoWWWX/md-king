import assert from "node:assert/strict";
import test from "node:test";
import { standaloneMarkdownTableSource, tableBlockPaste } from "./table-block-paste.ts";

const table = "| 名称 | 说明 |\n| --- | --- |\n| 第一行 | 内容 |";

test("只识别完整的 Markdown 表格剪贴板内容", () => {
  assert.equal(standaloneMarkdownTableSource(table), table);
  assert.equal(standaloneMarkdownTableSource("标题\n---"), null);
  assert.equal(standaloneMarkdownTableSource("普通文本"), null);
});

test("整表粘贴会与前后段落保留空行", () => {
  const source = "上面的段落\n下面的段落";
  const from = source.indexOf("下面的段落");
  const plan = tableBlockPaste(source, from, from, table);

  assert.ok(plan);
  assert.equal(plan.insert, `\n${table}\n\n`);
  const next = `${source.slice(0, plan.from)}${plan.insert}${source.slice(plan.to)}`;
  assert.equal(next, `上面的段落\n\n${table}\n\n下面的段落`);
});

test("文档首尾粘贴不额外制造空行", () => {
  const atStart = tableBlockPaste("后续段落", 0, 0, table);
  const atEnd = tableBlockPaste("前面的段落", 6, 6, table);

  assert.equal(atStart?.insert, `${table}\n\n`);
  assert.equal(atEnd?.insert, `\n\n${table}`);
});
