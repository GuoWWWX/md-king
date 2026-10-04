import assert from "node:assert/strict";
import test from "node:test";
import { markdownSourceIndentClass, markdownSourceIndentLength, parseMarkdownSourceListLine, sourceOrderedListValue } from "./source-indent.ts";

test("每四个空格形成一级 Markdown 视觉缩进", () => {
  assert.equal(markdownSourceIndentLength("- 列表"), 0);
  assert.equal(markdownSourceIndentLength("   - 列表"), 0);
  assert.equal(markdownSourceIndentLength("    - 列表"), 4);
  assert.equal(markdownSourceIndentLength("        `行内代码`"), 8);
  assert.equal(markdownSourceIndentClass("        1. 有序列表"), "mk-cm-source-indent-2");
});

test("识别不依赖上下文的四空格有序与无序列表", () => {
  assert.deepEqual(parseMarkdownSourceListLine("    - 第一项"), {
    indentLength: 4,
    level: 1,
    markerFrom: 4,
    markerTo: 5,
    marker: "-",
    ordered: false,
    order: 0,
  });
  assert.deepEqual(parseMarkdownSourceListLine("        12. 第二项"), {
    indentLength: 8,
    level: 2,
    markerFrom: 8,
    markerTo: 11,
    marker: "12.",
    ordered: true,
    order: 12,
  });
  assert.equal(parseMarkdownSourceListLine("- 顶层列表"), null);
  assert.equal(parseMarkdownSourceListLine("a. 顶层英文列表"), null);
  assert.deepEqual(parseMarkdownSourceListLine("a. 顶层英文列表", true), {
    indentLength: 0,
    level: 0,
    markerFrom: 0,
    markerTo: 2,
    marker: "a.",
    ordered: true,
    order: 0,
  });
  assert.deepEqual(parseMarkdownSourceListLine("    b. 英文列表"), {
    indentLength: 4,
    level: 1,
    markerFrom: 4,
    markerTo: 6,
    marker: "b.",
    ordered: true,
    order: 0,
  });
  assert.equal(parseMarkdownSourceListLine("    普通缩进正文"), null);
  assert.equal(parseMarkdownSourceListLine("    Note. 普通句子"), null);
});

test("视觉缩进限制为六级但不修改原始文本", () => {
  const source = `${" ".repeat(32)}正文`;
  assert.equal(markdownSourceIndentLength(source), 24);
  assert.equal(markdownSourceIndentClass(source), "mk-cm-source-indent-6");
  assert.equal(source.startsWith(" ".repeat(32)), true);
});

test("缩进有序列表按同级项目连续编号", () => {
  const lines = [
    "正文",
    "    1. 第一项",
    "        1. 子项一",
    "        1. 子项二",
    "    1. 第二项",
  ];
  assert.equal(sourceOrderedListValue(lines, 1), 1);
  assert.equal(sourceOrderedListValue(lines, 2), 1);
  assert.equal(sourceOrderedListValue(lines, 3), 2);
  assert.equal(sourceOrderedListValue(lines, 4), 2);
});

test("引用块内部列表能够正确识别多级缩进与序号", () => {
  const line1 = "> - 一级列表";
  assert.equal(markdownSourceIndentClass(line1), "");
  const parsed1 = parseMarkdownSourceListLine(line1, true);
  assert.ok(parsed1);
  assert.equal(parsed1.level, 0);

  const line2 = ">     - 二级列表";
  assert.equal(markdownSourceIndentClass(line2), "mk-cm-source-indent-1");
  const parsed2 = parseMarkdownSourceListLine(line2);
  assert.ok(parsed2);
  assert.equal(parsed2.level, 1);
  assert.equal(parsed2.marker, "-");

  const line3 = ">         1. 三级有序列表";
  assert.equal(markdownSourceIndentClass(line3), "mk-cm-source-indent-2");
  const parsed3 = parseMarkdownSourceListLine(line3);
  assert.ok(parsed3);
  assert.equal(parsed3.level, 2);
  assert.equal(parsed3.order, 1);
});
