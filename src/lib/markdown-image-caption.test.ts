import assert from "node:assert/strict";
import test from "node:test";

import { extractExplicitImageCaptions } from "./markdown-image-caption.ts";

test("将紧邻图片的 Pandoc Image Caption Div 转为预览题注", () => {
  const extracted = extractExplicitImageCaptions([
    "![辅助说明](network.png)",
    "",
    '::: {custom-style="Image Caption"}',
    "**图 2-1 网络结构图**",
    ":::",
    "",
    "正文。",
  ].join("\n"));

  assert.equal(extracted.captionsByImageIndex.get(0), "图 2-1 网络结构图");
  assert.equal(extracted.markdown.includes("custom-style"), false);
  assert.equal(extracted.markdown.includes("图 2-1 网络结构图"), false);
  assert.match(extracted.markdown, /正文。/);
});

test("不处理代码块和未闭合的 Image Caption Div", () => {
  const source = [
    "```markdown",
    '::: {custom-style="Image Caption"}',
    ":::",
    "```",
    "",
    "![图](image.png)",
    '::: {custom-style="Image Caption"}',
    "未闭合题注",
  ].join("\n");
  const extracted = extractExplicitImageCaptions(source);

  assert.equal(extracted.captionsByImageIndex.size, 0);
  assert.equal(extracted.markdown, source);
});

test("旧题注指令不再被识别", () => {
  const source = "![网络拓扑](network.png)\n::caption[图2-1 网络结构图]";
  const extracted = extractExplicitImageCaptions(source);
  assert.equal(extracted.captionsByImageIndex.size, 0);
  assert.equal(extracted.markdown, source);
});

test("普通图片支持前后紧邻的整行加粗题注", () => {
  const extracted = extractExplicitImageCaptions([
    "**图2-1 前置题注**",
    "![前置辅助说明](before.png)",
    "",
    "![后置辅助说明](after.png)",
    "**图2-2 后置题注**",
    "",
    "![无题注](plain.png)",
    "",
    "**普通加粗正文**",
  ].join("\n"));

  assert.equal(extracted.captionsByImageIndex.get(0), "图2-1 前置题注");
  assert.equal(extracted.captionsByImageIndex.get(1), "图2-2 后置题注");
  assert.equal(extracted.captionsByImageIndex.has(2), false);
  assert.equal(extracted.markdown.includes("图2-1 前置题注"), false);
  assert.equal(extracted.markdown.includes("图2-2 后置题注"), false);
  assert.equal(extracted.markdown.includes("**普通加粗正文**"), true);
});
