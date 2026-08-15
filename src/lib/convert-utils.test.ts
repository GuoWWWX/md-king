import assert from "node:assert/strict";
import test from "node:test";
import { buildOutputPath } from "./convert-utils.ts";

test("Windows 输出目录保留绝对路径和反斜杠", () => {
  assert.equal(
    buildOutputPath("C:\\Users\\gyx\\Documents\\MD King", "报告.docx"),
    "C:\\Users\\gyx\\Documents\\MD King\\报告.docx",
  );
});

test("非 Windows 输出目录保持斜杠分隔", () => {
  assert.equal(buildOutputPath("/tmp/output/", "report.docx"), "/tmp/output/report.docx");
});
