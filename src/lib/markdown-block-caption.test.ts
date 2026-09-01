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
