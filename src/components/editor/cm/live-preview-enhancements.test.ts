import assert from "node:assert/strict";
import test from "node:test";
import { findBlockMarkdownMath, findInlineMarkdownMath } from "../../../lib/markdown-math.ts";
import { findRelaxedStrongRanges } from "../../../lib/relaxed-strong.ts";
import { findRelaxedEmphasisRanges } from "../../../lib/relaxed-emphasis.ts";
import { parseMarkdownCalloutHeader } from "../../../lib/markdown-callout.ts";
import {
  markdownSourceIndentClass,
  markdownSourceIndentLength,
  parseMarkdownSourceListLine,
  sourceOrderedListValue,
  splitMarkdownQuotePrefix,
} from "./source-indent.ts";

function isInsideOrCrossingMath(from: number, to: number, mathRanges: Array<{ from: number; to: number }>): boolean {
  for (const math of mathRanges) {
    if (from < math.to && to > math.from) {
      if (!(from <= math.from && to >= math.to)) return true;
    }
  }
  return false;
}

test("加粗包含数学公式时正确放行，公式内部星号被正确拦截", () => {
  const line = "**质能方程 $E=mc^2$ 是核心结论**";
  const inlineMath = findInlineMarkdownMath(line);
  assert.equal(inlineMath.length, 1);
  const mathRange = inlineMath[0];
  assert.equal(line.slice(mathRange.contentFrom, mathRange.contentTo), "E=mc^2");

  const strongRanges = findRelaxedStrongRanges(line);
  assert.equal(strongRanges.length, 1);
  const strong = strongRanges[0];

  // strong 范围完整包裹 math 范围
  const mathRanges = [{ from: mathRange.from, to: mathRange.to }];
  const conflict = isInsideOrCrossingMath(strong.from, strong.to, mathRanges);
  assert.equal(conflict, false, "加粗包裹公式时不应判定为冲突");

  // 若公式内部有星号乘法，如 $a * b * c$，内部星号不应作为加粗/斜体放行
  const formulaWithAsterisk = "公式 $a * b * c$ 正常显示";
  const mathInFormula = findInlineMarkdownMath(formulaWithAsterisk)[0];
  const mathList = [{ from: mathInFormula.from, to: mathInFormula.to }];
  // 假设误判星号区间为 [formulaWithAsterisk.indexOf("*") - 1, ...]
  const asteriskPos = formulaWithAsterisk.indexOf("*");
  const insideConflict = isInsideOrCrossingMath(asteriskPos, asteriskPos + 1, mathList);
  assert.equal(insideConflict, true, "公式内部字符应判定为冲突并跳过样式渲染");
});

test("紧贴中文与标点的宽松加粗和斜体正常提取", () => {
  const strongLine = "**这是重要结论**：请仔细阅读";
  const strongRanges = findRelaxedStrongRanges(strongLine);
  assert.equal(strongRanges.length, 1);
  assert.equal(strongLine.slice(strongRanges[0].contentFrom, strongRanges[0].contentTo), "这是重要结论");

  const emLine = "*这是斜体内容*，紧跟全角逗号。";
  const emRanges = findRelaxedEmphasisRanges(emLine);
  assert.equal(emRanges.length, 1);
  assert.equal(emLine.slice(emRanges[0].contentFrom, emRanges[0].contentTo), "这是斜体内容");
});

test("引用块内无序和有序列表的多级缩进及样式计算", () => {
  const line0 = "> - 顶级无序列表";
  const line1 = ">     - 二级无序列表";
  const line2 = ">         - 三级无序列表";

  // 1. 拆分引用前缀
  const split0 = splitMarkdownQuotePrefix(line0);
  assert.equal(split0.prefix, "> ");
  assert.equal(split0.content, "- 顶级无序列表");

  const split1 = splitMarkdownQuotePrefix(line1);
  assert.equal(split1.prefix, "> ");
  assert.equal(split1.content, "    - 二级无序列表");

  // 2. 缩进长度与类名
  assert.equal(markdownSourceIndentLength(line0), 0);
  assert.equal(markdownSourceIndentClass(line0), "");

  assert.equal(markdownSourceIndentLength(line1), 4);
  assert.equal(markdownSourceIndentClass(line1), "mk-cm-source-indent-1");

  assert.equal(markdownSourceIndentLength(line2), 8);
  assert.equal(markdownSourceIndentClass(line2), "mk-cm-source-indent-2");

  // 3. 列表项解析与深度
  const parsed1 = parseMarkdownSourceListLine(line1);
  assert.ok(parsed1);
  assert.equal(parsed1.level, 1);
  assert.equal(parsed1.marker, "-");
  // 缩进隐藏起点避开引用前缀
  assert.equal(split1.prefix.length, 2);

  // 4. 有序列表连续编号
  const orderedLines = [
    "> 1. 第一项",
    "> 2. 第二项",
    "> 3. 第三项",
  ];
  assert.equal(sourceOrderedListValue(orderedLines, 0), 1);
  assert.equal(sourceOrderedListValue(orderedLines, 1), 2);
  assert.equal(sourceOrderedListValue(orderedLines, 2), 3);
});

test("引用块内单行与多行块级公式识别并纯净化提取", () => {
  const source = [
    "> $$",
    "> \\sum_{i=1}^n i = \\frac{n(n+1)}{2}",
    "> $$",
  ].join("\n");

  const blocks = findBlockMarkdownMath(source);
  assert.equal(blocks.length, 1);
  const block = blocks[0];

  const rawFormula = source.slice(block.contentFrom, block.contentTo);
  const formula = rawFormula
    .split(/\r?\n/)
    .map((line) => line.replace(/^[ \t]*(?:>[ \t]?)+/, ""))
    .join("\n")
    .trim();

  assert.equal(formula, "\\sum_{i=1}^n i = \\frac{n(n+1)}{2}");
  assert.doesNotMatch(formula, /^>/);
});

test("引用块内代码围栏及收尾正确识别并剥离引用符号", () => {
  const lines = [
    "> ```mermaid",
    "> graph TD",
    ">   A --> B",
    "> ```",
  ];

  // 验证闭合正则能匹配带引用符号的收尾围栏
  const closingRegex = /^[ \t]*(?:>[ \t]?)*[ \t]*(```|~~~)/;
  assert.equal(closingRegex.test(lines[3]), true);

  // 提取正文并剥离每一行的 >
  const bodyLines = lines.slice(1, 3).map((line) => line.replace(/^[ \t]*(?:>[ \t]?)+/, ""));
  assert.deepEqual(bodyLines, ["graph TD", "  A --> B"]);
});

test("Callout 首行自定义标题与类型标记切分", () => {
  const text = "[!note] 标题包含 **加粗** 和公式 $E=mc^2$";
  const header = parseMarkdownCalloutHeader(text);
  assert.ok(header);
  assert.equal(header.type, "note");
  assert.equal(header.tone, "blue");
  assert.equal(header.title, "标题包含 **加粗** 和公式 $E=mc^2$");
  assert.equal(header.markerStart, 0);
  assert.equal(header.markerEnd, text.indexOf("]") + 2); // "[!note] " 长度为 8
});
