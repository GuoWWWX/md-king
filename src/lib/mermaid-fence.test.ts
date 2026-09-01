import assert from "node:assert/strict";
import test from "node:test";

import { followingMermaidCaption, imageCaptionStyleBlock, markdownCaptionText, mermaidFenceCaption, precedingMermaidCaption } from "./mermaid-fence.ts";

test("Mermaid 围栏支持简洁的 caption 属性", () => {
  assert.equal(
    mermaidFenceCaption('mermaid {caption="图9-1 商密服务异常下的受控处置流程" width=90%}'),
    "图9-1 商密服务异常下的受控处置流程",
  );
  assert.equal(mermaidFenceCaption("mermaid caption='图 2-1 网络结构图'"), "图 2-1 网络结构图");
  assert.equal(mermaidFenceCaption("mermaid {width=90%}"), undefined);
});

test("Mermaid 图题只在转换链内部生成 Image Caption 样式块", () => {
  assert.equal(
    imageCaptionStyleBlock("图9-1 商密服务异常下的受控处置流程"),
    '::: {custom-style="Image Caption"}\n图9-1 商密服务异常下的受控处置流程\n:::',
  );
});

test("整行加粗作为通用题注并要求紧贴 Mermaid", () => {
  assert.equal(markdownCaptionText("**图9-1 处置流程**"), "图9-1 处置流程");
  assert.equal(markdownCaptionText("普通 **加粗** 正文"), undefined);
  assert.equal(markdownCaptionText("::caption[图9-1 旧语法]"), undefined);
  const source = "**图9-1 前置题注**\n```mermaid\ngraph LR\nA-->B\n```\n**图9-1 前置题注**\n正文";
  assert.deepEqual(precedingMermaidCaption(source, source.indexOf("```mermaid")), {
    caption: "图9-1 前置题注",
    start: 0,
  });
  const fenceEnd = source.indexOf("```\n**") + 3;
  assert.deepEqual(followingMermaidCaption(source, fenceEnd), {
    caption: "图9-1 前置题注",
    end: source.indexOf("\n正文"),
  });

  const separated = "```\n\n**图9-1 不应关联**\n正文";
  assert.equal(followingMermaidCaption(separated, 3), undefined);
  const legacy = "```\n::caption[图9-1 旧语法]\n正文";
  assert.equal(followingMermaidCaption(legacy, 3), undefined);
});
