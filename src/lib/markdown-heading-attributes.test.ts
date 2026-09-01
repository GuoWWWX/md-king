import assert from "node:assert/strict";
import test from "node:test";

import { isConventionalUnnumberedHeading, parseUnnumberedHeadingText } from "./markdown-heading-attributes.ts";

test("无编号标题支持 Pandoc 简写并兼容旧写法", () => {
  assert.deepEqual(parseUnnumberedHeadingText("摘要 {-}"), { text: "摘要", unnumbered: true });
  assert.deepEqual(parseUnnumberedHeadingText("摘要 {.unnumbered}"), { text: "摘要", unnumbered: true });
  assert.deepEqual(parseUnnumberedHeadingText("正文 {#body}"), { text: "正文 {#body}", unnumbered: false });
});

test("常见前置标题无需额外控制标记", () => {
  assert.equal(isConventionalUnnumberedHeading("摘要"), true);
  assert.equal(isConventionalUnnumberedHeading("1 研究定位"), false);
});
