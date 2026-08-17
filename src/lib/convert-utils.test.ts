import assert from "node:assert/strict";
import test from "node:test";
import { buildDocxOutputNameFromPath, buildOutputPath } from "./convert-utils.ts";

test("Word 输出名取 Markdown 文件名并保留 Emoji", () => {
  assert.equal(buildDocxOutputNameFromPath("D:\\Notes\\🤖 AI 应用.md"), "🤖 AI 应用.docx");
  assert.equal(buildDocxOutputNameFromPath("notes/项目报告.markdown"), "项目报告.docx");
});

test("Windows 输出目录保留绝对路径和反斜杠", () => {
  assert.equal(
    buildOutputPath("C:\\Users\\gyx\\Documents\\MD King", "报告.docx"),
    "C:\\Users\\gyx\\Documents\\MD King\\报告.docx",
  );
});

test("非 Windows 输出目录保持斜杠分隔", () => {
  assert.equal(buildOutputPath("/tmp/output/", "report.docx"), "/tmp/output/report.docx");
});
