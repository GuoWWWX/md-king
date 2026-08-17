import assert from "node:assert/strict";
import test from "node:test";
import { canDropFileTreeEntry, fileTreeDropPlacement } from "./file-tree-drag.ts";

test("目录中部用于移入，边缘用于同级排序", () => {
  const directory = { isDir: true };
  assert.equal(fileTreeDropPlacement(directory, 105, 100, 20), "inside");
  assert.equal(fileTreeDropPlacement(directory, 101, 100, 20), "before");
  assert.equal(fileTreeDropPlacement(directory, 119, 100, 20), "after");
  assert.equal(fileTreeDropPlacement({ isDir: false }, 105, 100, 20), "before");
});

test("文件树拖放拒绝自身和子目录，允许根目录及其他目录", () => {
  assert.equal(canDropFileTreeEntry("资料", null, "root"), true);
  assert.equal(canDropFileTreeEntry("资料", { path: "资料", isDir: true }, "inside"), false);
  assert.equal(canDropFileTreeEntry("资料", { path: "资料/图片", isDir: true }, "inside"), false);
  assert.equal(canDropFileTreeEntry("资料/说明.md", { path: "归档", isDir: true }, "inside"), true);
});
