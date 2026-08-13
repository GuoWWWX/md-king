import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { selectionTouchesOnSameLine } from "./selection-utils.ts";

function stateWithCursor(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor } });
}

test("行内 Markdown 标记的命中容差不跨越换行", () => {
  const source = "**整行粗体**\n\n下一段";
  const inlineTo = source.indexOf("\n");

  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, inlineTo), 0, inlineTo), true);
  assert.equal(selectionTouchesOnSameLine(stateWithCursor(source, inlineTo + 1), 0, inlineTo), false);
});
