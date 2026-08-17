import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedTextFile, preserveSupportedTextExtension, stripSupportedTextExtension } from "./markdown-files.ts";

test("accepts Markdown and TXT files", () => {
  assert.equal(isSupportedTextFile(new File(["# 标题"], "报告.md")), true);
  assert.equal(isSupportedTextFile(new File(["# 标题"], "报告.markdown")), true);
  assert.equal(isSupportedTextFile(new File(["# 标题"], "报告.TXT")), true);
});

test("rejects unsupported file extensions", () => {
  assert.equal(isSupportedTextFile(new File(["# 标题"], "报告.docx")), false);
});

test("hides supported text extensions from the editable file name", () => {
  assert.equal(stripSupportedTextExtension("报告.md"), "报告");
  assert.equal(stripSupportedTextExtension("报告.markdown"), "报告");
  assert.equal(stripSupportedTextExtension("报告.TXT"), "报告");
  assert.equal(stripSupportedTextExtension("报告.v1.md"), "报告.v1");
});

test("keeps the original extension when the editable file name changes", () => {
  assert.equal(preserveSupportedTextExtension("旧名称.md", "新名称"), "新名称.md");
  assert.equal(preserveSupportedTextExtension("旧名称.md", "新名称.txt"), "新名称.md");
  assert.equal(preserveSupportedTextExtension("未命名", "新名称"), "新名称");
});
