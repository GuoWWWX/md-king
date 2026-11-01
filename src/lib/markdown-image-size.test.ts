import assert from "node:assert/strict";
import test from "node:test";
import { parseTableInlineMarkdown } from "../components/editor/cm/table-inline-renderer.ts";
import { imageLengthPixels } from "./markdown-image-size.ts";

test("表格图片的尺寸属性可渲染，不把属性显示成文字", () => {
  assert.deepEqual(parseTableInlineMarkdown('![照片](photo.png){width=2.5cm height=3.5cm}'), [
    { type: "image", src: "photo.png", alt: "照片", width: "2.5cm", height: "3.5cm" },
  ]);
  assert.ok(Math.abs(imageLengthPixels("25mm")! - imageLengthPixels("2.5cm")!) < 0.001);
});

test("空格、转义和无效尺寸保留原文，不误识别", () => {
  for (const source of [
    '![照片](photo.png) {width=2.5cm}',
    '![照片](photo.png)\\{width=2.5cm}',
    '![照片](photo.png){width=2..5cm}',
    '![照片](photo.png){width=0cm}',
    '![照片](photo.png){width=2cm other=1}',
  ]) {
    const nodes = parseTableInlineMarkdown(source);
    assert.equal(nodes[0].type, "image");
    assert.ok(nodes.some((node) => node.type === "text" && node.value.includes("width=")), source);
  }
  assert.deepEqual(parseTableInlineMarkdown('`![照片](photo.png){width=2.5cm}`'), [
    { type: "code", value: "![照片](photo.png){width=2.5cm}" },
  ]);
});
