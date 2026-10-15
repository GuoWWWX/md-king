import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAdjacentBoldTableCaptions } from "./markdown-block-caption.ts";

test("表格前后紧邻的整行加粗题注统一移动到表格前", () => {
  const source = [
    "**表1-1 前置题注**",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "| C | D |",
    "| --- | --- |",
    "| 3 | 4 |",
    "**表1-2 后置题注**",
  ].join("\n");

  assert.equal(normalizeAdjacentBoldTableCaptions(source), [
    "**表1-1 前置题注**",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "**表1-2 后置题注**",
    "| C | D |",
    "| --- | --- |",
    "| 3 | 4 |",
  ].join("\n"));
});

test("表格与加粗正文之间有空行时不识别为题注", () => {
  const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**普通加粗正文**";
  assert.equal(normalizeAdjacentBoldTableCaptions(source), source);
});

test("隔空行的编号表题仍识别为题注，并保留原编号", () => {
  for (const source of [
    "**表4-1 仿真测试指标**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**表4-1 仿真测试指标**",
  ]) {
    const result = normalizeAdjacentBoldTableCaptions(source);
    assert.ok(result.includes("**表4-1 仿真测试指标**\n| A | B |"));
    assert.equal(result.match(/仿真测试指标/g)?.length, 1);
  }
});

test("连续表格优先使用各自的前置编号题注", () => {
  const source = "**表1-1 第一表**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**表1-2 第二表**\n\n| C | D |\n| --- | --- |\n| 3 | 4 |";
  const output = normalizeAdjacentBoldTableCaptions(source);
  assert.ok(output.includes("**表1-1 第一表**\n| A | B |"));
  assert.ok(output.includes("**表1-2 第二表**\n| C | D |"));
});
