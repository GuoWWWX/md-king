import assert from "node:assert/strict";
import test from "node:test";
import { replaceMermaidFencesWithImages } from "./mermaid-export-markdown.ts";

test("Mermaid 围栏导出为普通 Markdown 图片", async () => {
  const input = "正文\n\n```Mermaid\ngraph LR\n  A --> B\n```\n\n结尾";
  const result = await replaceMermaidFencesWithImages(input, async (source) => {
    assert.equal(source, "graph LR\n  A --> B\n");
    return "C:\\Temp\\mermaid chart.png";
  });

  assert.equal(result.failed, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.markdown, "正文\n\n![图表](C:\\Temp\\mermaid\\ chart.png)\n\n结尾");
  assert.doesNotMatch(result.markdown, /```mermaid/i);
});

test("Mermaid 图片生成失败时保留原始代码块", async () => {
  const input = "```mermaid\ngraph TD\n  A --> B\n```";
  const result = await replaceMermaidFencesWithImages(input, async () => {
    throw new Error("render failed");
  });

  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors, ["render failed"]);
  assert.equal(result.markdown, input);
});

test("Mermaid caption 属性转换为图片题注且不暴露给 Word 正文", async () => {
  const input = '```mermaid {caption="图9-1 商密服务异常下的受控处置流程"}\nflowchart TB\n  A --> B\n```';
  const result = await replaceMermaidFencesWithImages(input, async () => "C:\\Temp\\figure.png");

  assert.equal(result.failed, 0);
  assert.equal(
    result.markdown,
    '![](C:\\Temp\\figure.png)\n\n::: {custom-style="Image Caption"}\n图9-1 商密服务异常下的受控处置流程\n:::',
  );
  assert.doesNotMatch(result.markdown, /caption=/);
});

test("Mermaid 后紧邻的加粗行转换为 Word 图片题注且不会重复", async () => {
  const input = "```mermaid\ngraph TD\nA-->B\n```\n**图9-1 处置流程**\n\n正文";
  const result = await replaceMermaidFencesWithImages(input, async () => "C:\\Temp\\figure.png");

  assert.equal(
    result.markdown,
    '![](C:\\Temp\\figure.png)\n\n::: {custom-style="Image Caption"}\n图9-1 处置流程\n:::\n\n正文',
  );
});

test("Mermaid 前紧邻的加粗行也转换为图片题注", async () => {
  const input = "正文\n\n**图9-2 前置题注**\n```mermaid\ngraph TD\nA-->B\n```\n\n结尾";
  const result = await replaceMermaidFencesWithImages(input, async () => "C:\\Temp\\figure.png");

  assert.equal(
    result.markdown,
    '正文\n\n![](C:\\Temp\\figure.png)\n\n::: {custom-style="Image Caption"}\n图9-2 前置题注\n:::\n\n结尾',
  );
});

test("Mermaid 与加粗行之间有空行时不识别为题注", async () => {
  const input = "```mermaid\ngraph TD\nA-->B\n```\n\n**普通加粗正文**";
  const result = await replaceMermaidFencesWithImages(input, async () => "C:\\Temp\\figure.png");

  assert.equal(result.markdown, "![图表](C:\\Temp\\figure.png)\n\n**普通加粗正文**");
});
