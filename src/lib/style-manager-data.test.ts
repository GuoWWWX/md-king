import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultTemplateStyleConfig } from "./style-manager-data.ts";

test("默认报告模板使用 Word 中文字号和表格排版规范", () => {
  const config = createDefaultTemplateStyleConfig("default-report");
  const normal = config.styles.normal;
  const table = config.styles.table;
  const header = config.styles["table-header"];
  const body = config.styles["table-body"];

  assert.equal(normal.chineseFont, "宋体");
  assert.equal(normal.fontSize, 12);

  assert.equal(table.tableLayout, "auto");
  assert.equal(table.fitToPageWidth, true);
  assert.equal(table.tableWidthPercent, 100);

  assert.equal(header.chineseFont, "宋体");
  assert.equal(header.headerFontSize, 10.5);
  assert.equal(header.headerBold, true);
  assert.equal(header.headerAlign, "center");
  assert.equal(header.headerVerticalAlign, "middle");

  assert.equal(body.chineseFont, "宋体");
  assert.equal(body.bodyFontSize, 10.5);
  assert.equal(body.bodyVerticalAlign, "middle");
});
