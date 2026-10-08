import assert from "node:assert/strict";
import test from "node:test";
import { containsWordChineseText, splitWordPreviewQuotes } from "./word-preview-quotes.ts";

test("中文弯引号使用中文字体，内容和直引号保持原样", () => {
  const text = '他说：“hello”，内层‘你好’，原样 "hello"。';
  const pieces = splitWordPreviewQuotes(text);
  assert.equal(pieces.map((piece) => piece.text).join(""), text);
  assert.deepEqual(pieces.filter((piece) => piece.chineseQuote).map((piece) => piece.text), ["“", "”", "‘", "’"]);
});

test("加粗把引号分成单独片段时仍沿用段落的中文字体", () => {
  const context = containsWordChineseText("“重点内容”继续正文。");
  assert.deepEqual(splitWordPreviewQuotes("“", context), [{ text: "“", chineseQuote: true }]);
  assert.deepEqual(splitWordPreviewQuotes("”继续正文。", context), [
    { text: "”", chineseQuote: true }, { text: "继续正文。", chineseQuote: false },
  ]);
});

test("纯英文段落和明确排除的代码不切换引号字体", () => {
  assert.deepEqual(splitWordPreviewQuotes('“hello” "world"'), [{ text: '“hello” "world"', chineseQuote: false }]);
  assert.deepEqual(splitWordPreviewQuotes("“中文代码”", false), [{ text: "“中文代码”", chineseQuote: false }]);
  assert.deepEqual(splitWordPreviewQuotes(""), []);
});
