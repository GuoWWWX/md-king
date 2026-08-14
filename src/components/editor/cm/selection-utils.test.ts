import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { cursorOnLines, selectionCoversRange, selectionOnLines, selectionTouchesOnSameLine } from "./selection-utils.ts";

function stateWithCursor(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

test("行内 Markdown 标记的命中容差不跨越换行", () => {
  const source = "**整行粗体**\n\n下一段";
  const inlineTo = source.indexOf("\n");

  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, inlineTo), 0, inlineTo), true);
  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, inlineTo + 1), 0, inlineTo), false);
});

test("块级行范围的右边界不会吞掉下一行", () => {
  const source = "前一行\n后一行";
  const nextLineFrom = source.indexOf("后一行");

  assert.equal(cursorOnLines(stateWithCursor(source, nextLineFrom - 1), 0, nextLineFrom), true);
  assert.equal(cursorOnLines(stateWithCursor(source, nextLineFrom), 0, nextLineFrom), false);
  assert.equal(selectionOnLines(stateWithCursor(source, nextLineFrom, nextLineFrom + 1), 0, nextLineFrom), false);
});

test("非空选区完整覆盖区间时才视为选中整个原子块", () => {
  const source = "上面的段落\n| 标题 | 内容 |\n| --- | --- |\n| 第一项 | 说明 |\n下面的段落";
  const tableFrom = source.indexOf("| 标题");
  const tableTo = source.indexOf("\n下面的段落");

  assert.equal(selectionCoversRange(stateWithCursor(source, 0, source.length), tableFrom, tableTo), true);
  assert.equal(selectionCoversRange(stateWithCursor(source, tableFrom + 1, tableTo), tableFrom, tableTo), false);
  assert.equal(selectionCoversRange(stateWithCursor(source, tableFrom, tableFrom), tableFrom, tableTo), false);
});
