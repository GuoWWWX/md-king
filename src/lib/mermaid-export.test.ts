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
