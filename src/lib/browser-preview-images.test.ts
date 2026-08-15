import assert from "node:assert/strict";
import test from "node:test";
import { registerBrowserPreviewImage, resolveBrowserPreviewImage } from "./browser-preview-images.ts";

test("resolves a browser-vault image from a Markdown-relative path", () => {
  const source = "data:image/png;base64,cG5n";
  registerBrowserPreviewImage("D:/示例仓库/.md-king/img/截图-20260814-120000-001.png", source);

  assert.equal(
    resolveBrowserPreviewImage(".md-king/img/%E6%88%AA%E5%9B%BE-20260814-120000-001.png", "D:/示例仓库/README.md"),
    source,
  );
});
