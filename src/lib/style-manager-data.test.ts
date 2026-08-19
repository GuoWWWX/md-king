import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultTemplateStyleConfig, mergeTemplateStyleConfig } from "./style-manager-data.ts";

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
  assert.equal(table.borderColor, "#000000");
  assert.equal(table.outerBorderStrong, false);
  assert.equal(table.borderTopWidth, table.borderWidth);
  assert.equal(table.borderRightWidth, table.borderWidth);
  assert.equal(table.borderBottomWidth, table.borderWidth);
  assert.equal(table.borderLeftWidth, table.borderWidth);

  assert.equal(header.chineseFont, "宋体");
  assert.equal(header.headerFontSize, 10.5);
  assert.equal(header.headerBold, true);
  assert.equal(header.headerAlign, "center");
  assert.equal(header.headerVerticalAlign, "middle");
  assert.equal(header.headerBorderColor, "#000000");

  assert.equal(body.chineseFont, "宋体");
  assert.equal(body.bodyFontSize, 10.5);
  assert.equal(body.bodyVerticalAlign, "middle");
  assert.equal(body.bodyBorderColor, "#000000");
});

test("默认报告模板会迁移旧版浅色表格边框", () => {
  const stored = createDefaultTemplateStyleConfig("default-report");
  stored.styles.table = {
    ...stored.styles.table,
    borderColor: "#CBD5E1",
    headerBorderColor: "#A5B4FC",
    bodyBorderColor: "#CBD5E1",
  };
  const config = mergeTemplateStyleConfig("default-report", stored);

  assert.equal(config.styles.table.borderColor, "#000000");
  assert.equal(config.styles.table.headerBorderColor, "#000000");
  assert.equal(config.styles.table.bodyBorderColor, "#000000");
});

test("旧版标题编号格式会恢复二到四级的编号开关", () => {
  const stored = createDefaultTemplateStyleConfig("default-report");
  stored.styles["heading-2"] = { ...stored.styles["heading-2"], autoNumbering: false, numberFormat: "1.1" };
  stored.styles["heading-3"] = { ...stored.styles["heading-3"], autoNumbering: false, numberFormat: "1.1" };
  stored.styles["heading-4"] = { ...stored.styles["heading-4"], autoNumbering: false, numberFormat: "1.1" };
  const config = mergeTemplateStyleConfig("default-report", stored);

  assert.equal(config.styles["heading-2"].autoNumbering, true);
  assert.equal(config.styles["heading-2"].numberFormat, "1.1");
  assert.equal(config.styles["heading-3"].autoNumbering, true);
  assert.equal(config.styles["heading-3"].numberFormat, "1.1.1");
  assert.equal(config.styles["heading-4"].autoNumbering, true);
  assert.equal(config.styles["heading-4"].numberFormat, "1.1.1.1");
});
