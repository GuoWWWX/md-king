import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { cursorOnLines, selectedMarkdownTableRows, selectionCoversRange, selectionIntersectsRange, selectionOnLines, selectionTouchesOnSameLine } from "./selection-utils.ts";

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

test("非空选区覆盖链接任意部分时可切换到源码编辑", () => {
  const source = "前缀 [[docs/说明.md|技术说明]] 后缀";
  const linkFrom = source.indexOf("[[");
  const linkTo = source.indexOf("]]") + 2;

  assert.equal(selectionIntersectsRange(stateWithCursor(source, linkFrom + 3, linkFrom + 10), linkFrom, linkTo), true);
  assert.equal(selectionIntersectsRange(stateWithCursor(source, linkTo, linkTo + 2), linkFrom, linkTo), false);
  assert.equal(selectionIntersectsRange(stateWithCursor(source, linkFrom, linkFrom), linkFrom, linkTo), false);
});

test("列表正文被选中时不会误判为选中行首标记", () => {
  const source = "- **模型不是越大越好**：要看任务类型";
  const markerFrom = 0;
  const markerTo = 2;
  const bodyFrom = source.indexOf("模型");

  assert.equal(selectionIntersectsRange(stateWithCursor(source, bodyFrom, source.length), markerFrom, markerTo), false);
  assert.equal(selectionIntersectsRange(stateWithCursor(source, markerFrom, bodyFrom), markerFrom, markerTo), true);
});

test("双链源码边界可放置光标且不会误命中下一行", () => {
  const source = "- [[docs/说明.md|技术说明]]\n下一行";
  const linkFrom = source.indexOf("[[");
  const linkTo = source.indexOf("]]") + 2;
  const nextLineFrom = source.indexOf("下一行");

  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, linkFrom), linkFrom, linkTo, 0), true);
  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, linkTo), linkFrom, linkTo, 0), true);
  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, nextLineFrom), linkFrom, linkTo, 0), false);
});

test("文档拖选进入表格时按实际覆盖的渲染行高亮", () => {
  const source = "上面的段落\n| 标题 | 内容 |\n| --- | --- |\n| 第一项 | 说明 |\n| 第二项 | 说明 |\n下面的段落";
  const tableFrom = source.indexOf("| 标题");
  const tableTo = source.indexOf("\n下面的段落");
  const firstRow = source.indexOf("| 第一项");
  const secondRow = source.indexOf("| 第二项");

  assert.deepEqual(selectedMarkdownTableRows(stateWithCursor(source, 0, firstRow + 4), tableFrom, tableTo), [0, 1]);
  assert.deepEqual(selectedMarkdownTableRows(stateWithCursor(source, firstRow + 2, firstRow + 6), tableFrom, tableTo), [1]);
  assert.deepEqual(selectedMarkdownTableRows(stateWithCursor(source, source.length, secondRow + 2), tableFrom, tableTo), [2]);
  assert.deepEqual(selectedMarkdownTableRows(stateWithCursor(source, firstRow), tableFrom, tableTo), []);
});
