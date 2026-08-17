import assert from "node:assert/strict";
import test from "node:test";
import { registerBrowserPreviewImage, remapBrowserPreviewImages, resolveBrowserPreviewImage } from "./browser-preview-images.ts";

test("resolves a browser-vault image from a Markdown-relative path", () => {
  const source = "data:image/png;base64,cG5n";
  registerBrowserPreviewImage("D:/示例仓库/.md-king/img/截图-20260814-120000-001.png", source);

  assert.equal(
    resolveBrowserPreviewImage(".md-king/img/%E6%88%AA%E5%9B%BE-20260814-120000-001.png", "D:/示例仓库/README.md"),
    source,
  );
});

test("moving an image or its parent directory keeps the browser thumbnail mapping", () => {
  const directSource = "data:image/svg+xml,direct";
  registerBrowserPreviewImage("D:/示例仓库/图片/示例.svg", directSource);
  remapBrowserPreviewImages("D:/示例仓库/图片/示例.svg", "D:/示例仓库/示例.svg");
  assert.equal(resolveBrowserPreviewImage("D:/示例仓库/示例.svg"), directSource);
  assert.equal(resolveBrowserPreviewImage("D:/示例仓库/图片/示例.svg"), undefined);

  const nestedSource = "data:image/png;base64,bmVzdGVk";
  registerBrowserPreviewImage("D:/示例仓库/素材/插图/封面.png", nestedSource);
  remapBrowserPreviewImages("D:/示例仓库/素材", "D:/示例仓库/归档素材");
  assert.equal(resolveBrowserPreviewImage("D:/示例仓库/归档素材/插图/封面.png"), nestedSource);
  assert.equal(resolveBrowserPreviewImage("D:/示例仓库/素材/插图/封面.png"), undefined);
});
