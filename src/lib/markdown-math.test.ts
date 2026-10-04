import assert from "node:assert/strict";
import test from "node:test";
import { findBlockMarkdownMath, findInlineMarkdownMath } from "./markdown-math.ts";

test("识别行内美元公式并忽略转义美元和行内代码", () => {
  const source = "分数为 $s(t)$，阈值为 $\\theta_{\\mathrm{warning}}$，价格 \\$10，代码 `$raw$`。";
  assert.deepEqual(
    findInlineMarkdownMath(source).map((range) => source.slice(range.contentFrom, range.contentTo)),
    ["s(t)", "\\theta_{\\mathrm{warning}}"],
  );
});

test("识别反斜杠行内公式", () => {
  const source = "满足 \\(a \\le b\\) 时继续";
  const [range] = findInlineMarkdownMath(source);
  assert.equal(source.slice(range.contentFrom, range.contentTo), "a \\le b");
});

test("公式中的 Markdown 方括号保持在同一个公式范围内", () => {
  const source = "区间 $R_j=[Q_j(\\alpha),\\,Q_j(1-\\alpha)]$ 不应成为文件链接";
  const [range] = findInlineMarkdownMath(source);

  assert.equal(source.slice(range.contentFrom, range.contentTo), "R_j=[Q_j(\\alpha),\\,Q_j(1-\\alpha)]");
});

test("识别多行块公式并保留原始位置", () => {
  const source = "正文\r\n\r\n$$\r\n\\theta_{clear}\r\n< \\theta_{warning}\r\n$$\r\n\r\n结尾";
  const [range] = findBlockMarkdownMath(source);
  assert.equal(source.slice(range.from, range.to), "$$\r\n\\theta_{clear}\r\n< \\theta_{warning}\r\n$$");
  assert.equal(source.slice(range.contentFrom, range.contentTo).trim(), "\\theta_{clear}\r\n< \\theta_{warning}");
});

test("块公式范围完整包含可能被误认成链接的方括号", () => {
  const source = "$$\n\\text{经验正常区间}=[Q_j(\\alpha),\\,Q_j(1-\\alpha)]\n$$";
  const [range] = findBlockMarkdownMath(source);

  assert.equal(
    source.slice(range.contentFrom, range.contentTo).trim(),
    "\\text{经验正常区间}=[Q_j(\\alpha),\\,Q_j(1-\\alpha)]",
  );
});

test("识别带缩进的单行块公式", () => {
  const source = "  $$\\text{核心线程数} = \\text{CPU 核心数} \\times 2$$";
  const [range] = findBlockMarkdownMath(source);
  assert.equal(source.slice(range.contentFrom, range.contentTo), "\\text{核心线程数} = \\text{CPU 核心数} \\times 2");
});

test("支持反斜杠块公式并忽略代码围栏中的分隔符", () => {
  const source = "```text\n$$\nnot math\n$$\n```\n\n\\[\na+b\n\\]";
  const ranges = findBlockMarkdownMath(source);
  assert.equal(ranges.length, 1);
  assert.equal(source.slice(ranges[0].contentFrom, ranges[0].contentTo).trim(), "a+b");
});

test("未闭合或空块公式保持源码", () => {
  assert.deepEqual(findBlockMarkdownMath("$$\na+b"), []);
  assert.deepEqual(findBlockMarkdownMath("$$\n$$"), []);
  assert.deepEqual(findInlineMarkdownMath("未闭合 $a+b"), []);
});

test("货币符号与带空格的美元符号不误判为行内公式", () => {
  const source = "这件衣服 $5，那件衣服 $10，运费 $ 3 元。";
  assert.deepEqual(findInlineMarkdownMath(source), []);
});

test("识别引用块内的单行与多行块级数学公式", () => {
  const single = "> $$E = mc^2$$";
  const [rangeSingle] = findBlockMarkdownMath(single);
  assert.equal(single.slice(rangeSingle.contentFrom, rangeSingle.contentTo), "E = mc^2");

  const multi = "> $$\n> \\frac{a}{b}\n> $$";
  const [rangeMulti] = findBlockMarkdownMath(multi);
  assert.ok(rangeMulti);
  assert.equal(multi.slice(rangeMulti.contentFrom, rangeMulti.contentTo).replace(/^>\s*/gm, "").trim(), "\\frac{a}{b}");
});

