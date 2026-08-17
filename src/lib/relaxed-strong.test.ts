import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { findRelaxedStrongRanges, relaxedStrongPlugin } from "./relaxed-strong.ts";

test("识别闭合星号后紧邻正文的宽松加粗", () => {
  assert.deepEqual(findRelaxedStrongRanges("**实施单元：**集控  **A网IP：**192.168.101.72"), [
    { from: 0, to: 9, contentFrom: 2, contentTo: 7 },
    { from: 13, to: 22, contentFrom: 15, contentTo: 20 },
  ]);
});

test("宽松加粗不处理转义标记、行内代码和多星号嵌套", () => {
  assert.deepEqual(findRelaxedStrongRanges("\\**保留：**文字 `**代码：**文字` ***粗斜体***"), []);
});

test("未闭合反引号位于行末时能够结束扫描", () => {
  assert.deepEqual(findRelaxedStrongRanges("```"), []);
  assert.deepEqual(findRelaxedStrongRanges("````"), []);
  assert.deepEqual(findRelaxedStrongRanges("前缀 `未闭合"), []);
});

test("markdown-it 将宽松写法输出为 strong 且不增加空格", () => {
  const parser = new MarkdownIt().use(relaxedStrongPlugin);
  assert.equal(
    parser.renderInline("前缀**实施单元：**集控  **PLC位号：**JK_PLC.S"),
    "前缀<strong>实施单元：</strong>集控  <strong>PLC位号：</strong>JK_PLC.S",
  );
  assert.equal(parser.renderInline("**普通文字**后续"), "<strong>普通文字</strong>后续");
  assert.equal(
    parser.renderInline("\\**保留：**文字 **正确：**正文"),
    "**保留：**文字 <strong>正确：</strong>正文",
  );
});
