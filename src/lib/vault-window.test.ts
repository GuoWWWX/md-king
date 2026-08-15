import assert from "node:assert/strict";
import test from "node:test";
import { vaultDisplayName, vaultProjectWindowLabel, vaultProjectWindowRoot, vaultProjectWindowUrl } from "./vault-window.ts";

test("项目窗口使用稳定且安全的标签", () => {
  const root = "D:\\示例仓库";
  assert.match(vaultProjectWindowLabel(root), /^project-[a-z0-9]+$/);
  assert.equal(vaultProjectWindowLabel(root), vaultProjectWindowLabel(root));
  assert.notEqual(vaultProjectWindowLabel(root), vaultProjectWindowLabel("D:\\另一个仓库"));
});

test("项目窗口 URL 保留页面参数并传递目标仓库", () => {
  const path = vaultProjectWindowUrl("http://127.0.0.1:1420/?floating=1&view=editor#top", "D:\\示例仓库");
  const url = new URL(path, "http://127.0.0.1:1420");
  assert.equal(url.searchParams.get("floating"), null);
  assert.equal(url.searchParams.get("view"), "editor");
  assert.equal(url.searchParams.get("vault"), "D:\\示例仓库");
  assert.equal(url.hash, "#top");
});

test("项目窗口从查询参数读取非空仓库路径", () => {
  assert.equal(vaultProjectWindowRoot("?vault=D%3A%5C%E7%A4%BA%E4%BE%8B%E4%BB%93%E5%BA%93"), "D:\\示例仓库");
  assert.equal(vaultProjectWindowRoot("?vault=%20%20"), undefined);
  assert.equal(vaultDisplayName("D:\\示例仓库\\"), "示例仓库");
});
