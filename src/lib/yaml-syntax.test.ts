import assert from "node:assert/strict";
import test from "node:test";
import { yamlHighlightTokens, yamlScalarKind } from "./yaml-syntax.ts";

test("YAML 区分数字、布尔/空值以及单位和普通字符串", () => {
  for (const number of ["100", "50.0", "-2", "+.5", "1e3", "0xFF", "0o77", ".inf", "-.Inf", ".nan"]) assert.equal(yamlScalarKind(number), "number", number);
  for (const keyword of ["true", "FALSE", "null", "~"]) assert.equal(yamlScalarKind(keyword), "keyword", keyword);
  for (const string of ["COUNT_BASED", "2000ms", "10000ms", "on", "off", "yes", "2026-10-23", "https://example.com/#part", "'100'"]) assert.equal(yamlScalarKind(string), "string", string);
});

test("YAML 使用语法树区分键、标量和注释，保留字符串内 # 与多行内容", async () => {
  const source = 'resilience4j:\n  maxCalls: 100 # 注释\n  enabled: true\n  type: COUNT_BASED\n  wait: 2000ms\n  url: https://example.com/#anchor\n  "quoted-key": "# 字符串"\n  note: |\n    # 文本\n    enabled: false\n';
  const tokens = (await yamlHighlightTokens(source)).map(token => ({ text: source.slice(token.from, token.to), kind: token.kind }));
  for (const [text, kind] of [['resilience4j', 'function'], ['maxCalls', 'function'], ['100', 'number'], ['true', 'keyword'], ['COUNT_BASED', 'string'], ['2000ms', 'string'], ['# 注释', 'comment'], ['https://example.com/#anchor', 'string'], ['"quoted-key"', 'function'], ['"# 字符串"', 'string']]) assert.ok(tokens.some(token => token.text === text && token.kind === kind), `${text}: ${JSON.stringify(tokens)}`);
  assert.ok(tokens.some(token => token.text.includes('# 文本') && token.text.includes('enabled: false') && token.kind === 'string'));
});
