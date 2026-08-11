import assert from "node:assert/strict";
import test from "node:test";
import {
  codeBlockIndentPtFromInfo,
  codeFenceLanguageFromInfo,
  selectionCoversCodeFence,
  updateCodeFenceIndentInfo,
} from "./code-block-indent.ts";

test("选区碰到首尾围栏行即可识别整个代码块", () => {
  const opening = { from: 10, to: 15 };
  const closing = { from: 40, to: 43 };
  assert.equal(selectionCoversCodeFence({ from: 10, to: 42 }, opening, closing), true);
  assert.equal(selectionCoversCodeFence({ from: 12, to: 41 }, opening, closing), true);
  assert.equal(selectionCoversCodeFence({ from: 16, to: 43 }, opening, closing), false);
  assert.equal(selectionCoversCodeFence({ from: 10, to: 39 }, opening, closing), false);
  assert.equal(selectionCoversCodeFence({ from: 20, to: 20 }, opening, closing), false);
});

test("读取有语言和纯属性围栏的代码块缩进", () => {
  assert.equal(codeBlockIndentPtFromInfo('ts {data-md-king-indent-pt="24"}'), 24);
  assert.equal(codeBlockIndentPtFromInfo('{.java #demo data-md-king-indent-pt=48}'), 48);
  assert.equal(codeBlockIndentPtFromInfo('js {data-md-king-indent-pt="999"}'), 144);
  assert.equal(codeBlockIndentPtFromInfo("python"), 0);
});

test("更新缩进时保留语言和其他 Pandoc attributes", () => {
  assert.equal(updateCodeFenceIndentInfo("ts", 24), 'ts {data-md-king-indent-pt="24"}');
  assert.equal(
    updateCodeFenceIndentInfo('{.java #demo key="value" data-md-king-indent-pt="24"}', 48),
    '{.java #demo key="value" data-md-king-indent-pt="48"}',
  );
  assert.equal(updateCodeFenceIndentInfo('ts {#demo data-md-king-indent-pt="24"}', 0), "ts {#demo}");
  assert.equal(updateCodeFenceIndentInfo('{data-md-king-indent-pt="24"}', 0), "");
});

test("语言解析忽略 id 和缩进属性", () => {
  assert.equal(codeFenceLanguageFromInfo('ts {data-md-king-indent-pt="24"}'), "ts");
  assert.equal(codeFenceLanguageFromInfo('{.java #demo data-md-king-indent-pt="48"}'), "java");
  assert.equal(codeFenceLanguageFromInfo('{#demo data-md-king-indent-pt="24"}'), "");
});
