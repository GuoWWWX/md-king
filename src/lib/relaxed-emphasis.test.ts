import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { findRelaxedEmphasisRanges, relaxedEmphasisPlugin } from "./relaxed-emphasis.ts";

test("识别闭合星号后紧邻中文标点的宽松斜体", () => {
  assert.deepEqual(findRelaxedEmphasisRanges("*实施单元：*集控  *A网IP：*192.168.101.72"), [
    { from: 0, to: 7, contentFrom: 1, contentTo: 6 },
    { from: 11, to: 18, contentFrom: 12, contentTo: 17 },
  ]);
});

test("宽松斜体不处理转义标记和行内代码", () => {
  assert.deepEqual(findRelaxedEmphasisRanges("\\*保留：*文字 `*代码：*文字`"), []);
});

test("markdown-it 将宽松单星号输出为 em 且不增加空格", () => {
  const parser = new MarkdownIt().use(relaxedEmphasisPlugin);
  assert.equal(
    parser.renderInline("前缀*实施单元：*集控  *PLC位号：*JK_PLC.S"),
    "前缀<em>实施单元：</em>集控  <em>PLC位号：</em>JK_PLC.S",
  );
  assert.equal(parser.renderInline("*普通文字*后续"), "<em>普通文字</em>后续");
});
