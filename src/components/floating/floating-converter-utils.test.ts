import assert from "node:assert/strict";
import test from "node:test";
import {
  floatingOutputName,
  isFloatingMarkdownFile,
  normalizeFloatingOutputName,
  parentDirectory,
} from "./floating-converter-utils.ts";

test("悬浮转换只接受 md 扩展名", () => {
  assert.equal(isFloatingMarkdownFile("报告.md"), true);
  assert.equal(isFloatingMarkdownFile("REPORT.MD"), true);
  assert.equal(isFloatingMarkdownFile("报告.markdown"), false);
  assert.equal(isFloatingMarkdownFile("报告.txt"), false);
});

test("文件路径和粘贴内容生成对应的 Word 文件名", () => {
  assert.equal(floatingOutputName("D:\\资料\\技术说明.md", ""), "技术说明.docx");
  assert.equal(floatingOutputName(undefined, "# 粘贴标题\n\n正文"), "粘贴标题.docx");
});

test("输出文件名补齐 docx 后缀并清理非法字符", () => {
  assert.equal(normalizeFloatingOutputName("周报", "untitled.docx"), "周报.docx");
  assert.equal(normalizeFloatingOutputName("周报.docx", "untitled.docx"), "周报.docx");
  assert.equal(normalizeFloatingOutputName("周报:最终版", "untitled.docx"), "周报-最终版.docx");
});

test("从 Windows 或 Unix 文件路径提取目录", () => {
  assert.equal(parentDirectory("D:\\资料\\技术说明.md"), "D:\\资料");
  assert.equal(parentDirectory("/home/user/技术说明.md"), "/home/user");
});
