import assert from "node:assert/strict";
import test from "node:test";
import { formatCaptionText } from "./caption-numbering.ts";

test("关闭自动编号时完整保留手写题注", () => {
  for (const source of ["表A-1 典型系统角色权限矩阵", "图 1.1 系统图", "表 1 测试指标", "不带序号的题注"]) {
    assert.equal(formatCaptionText(source, 5, { captionNumbering: false, captionNumberFormat: "表 1" }), source);
  }
});

test("明确开启时按配置递增，替换旧序号且不重复前缀", () => {
  for (const [source, format, expected] of [
    ["图A-1 系统图", "图 1.1", "图 1.2 系统图"],
    ["图 1.1 系统图", "图 1.1", "图 1.2 系统图"],
    ["表A-1 权限矩阵", "表 1", "表 2 权限矩阵"],
    ["Figure 3-1 Architecture", "Figure 1", "Figure 2 Architecture"],
    ["表B-1 权限矩阵", "表 1-1", "表 1-2 权限矩阵"],
  ]) {
    assert.equal(formatCaptionText(source, 2, { captionNumbering: true, captionNumberFormat: format }), expected);
  }
});
