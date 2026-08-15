import assert from "node:assert/strict";
import test from "node:test";
import { imageFileExtension, isSupportedImagePath, markdownImageReference, relativeMarkdownPath } from "./image-files.ts";

test("recognizes only image formats supported by the preview pipeline", () => {
  assert.equal(isSupportedImagePath("cover.JPG"), true);
  assert.equal(isSupportedImagePath("image.svg?version=2"), true);
  assert.equal(isSupportedImagePath("report.docx"), false);
});

test("builds a portable relative Markdown image reference", () => {
  assert.equal(relativeMarkdownPath("notes/guide.md", "notes/assets/图 (1).png"), "assets/图 (1).png");
  assert.equal(markdownImageReference("notes/guide.md", "notes/assets/图 (1).png"), "![图 (1)](assets/%E5%9B%BE%20%281%29.png)");
  assert.equal(markdownImageReference("guide.md", "assets/chart.png"), "![chart](assets/chart.png)");
});

test("prefers a supported filename extension and falls back to the image MIME type", () => {
  assert.equal(imageFileExtension(new File(["x"], "截图.webp", { type: "image/png" })), "webp");
  assert.equal(imageFileExtension(new File(["x"], "image", { type: "image/jpeg" })), "jpg");
});
