import assert from "node:assert/strict";
import test from "node:test";
import { filterWordFontOptions, wordFontOptions } from "./word-font-options.ts";

test("中英文字体使用同一套可选项", () => {
  assert.ok(wordFontOptions.includes("宋体"));
  assert.ok(wordFontOptions.includes("Times New Roman"));
  assert.ok(wordFontOptions.includes("Consolas"));
});

test("字体输入支持包含匹配与英文缩写匹配", () => {
  assert.ok(filterWordFontOptions(wordFontOptions, "宋").includes("宋体"));
  assert.ok(filterWordFontOptions(wordFontOptions, "times").includes("Times New Roman"));
  assert.ok(filterWordFontOptions(wordFontOptions, "tnr").includes("Times New Roman"));
});
