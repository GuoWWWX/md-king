import assert from "node:assert/strict";
import test from "node:test";
import { parseHorizontalRuleText } from "./horizontal-rule-text.ts";

test("正确解析普通带文字分割线 --- ABC", () => {
  const result = parseHorizontalRuleText("--- ABC");
  assert.notEqual(result, null);
  assert.equal(result?.text, "ABC");
  assert.equal(result?.prefix, "--- ");
});

test("正确解析带闭合标记的分割线 --- 章节总结 ---", () => {
  const result = parseHorizontalRuleText("--- 章节总结 ---");
  assert.notEqual(result, null);
  assert.equal(result?.text, "章节总结");
  assert.equal(result?.suffix, " ---");
});

test("正确解析带前导缩进与星号/下划线的分割线", () => {
  const star = parseHorizontalRuleText("  *** 核心内容 ***");
  assert.notEqual(star, null);
  assert.equal(star?.text, "核心内容");

  const underscore = parseHorizontalRuleText("___ 附录 ___");
  assert.notEqual(underscore, null);
  assert.equal(underscore?.text, "附录");
});

test("普通分割线与非分割线文本不应被误判", () => {
  assert.equal(parseHorizontalRuleText("---"), null);
  assert.equal(parseHorizontalRuleText("----"), null);
  assert.equal(parseHorizontalRuleText("普通的段落内容"), null);
  assert.equal(parseHorizontalRuleText("- 无序列表项"), null);
});
