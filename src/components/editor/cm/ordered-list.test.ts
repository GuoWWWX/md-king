import assert from "node:assert/strict";
import test from "node:test";
import { orderedListMarker } from "./source-indent.ts";

test("有序列表保持源码中的数字或英文标记类型", () => {
  assert.equal(orderedListMarker("1.", 3), "3.");
  assert.equal(orderedListMarker("1)", 3), "3)");
  assert.equal(orderedListMarker("a.", 3), "a.");
  assert.equal(orderedListMarker("B)", 3), "B)");
});
