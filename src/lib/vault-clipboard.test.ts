import assert from "node:assert/strict";
import test from "node:test";
import { clipboardContainsVaultEntry, topLevelVaultEntries, vaultAbsolutePath, vaultPasteTarget } from "./vault-clipboard.ts";

test("粘贴到文件夹内部、文件所在目录或仓库根目录", () => {
  assert.equal(vaultPasteTarget(), "");
  assert.equal(vaultPasteTarget({ path: "草稿", name: "草稿", isDir: true, size: 0, modifiedMs: 0, hasChildren: true }), "草稿");
  assert.equal(vaultPasteTarget({ path: "草稿/笔记.md", name: "笔记.md", isDir: false, size: 1, modifiedMs: 0, hasChildren: false }), "草稿");
  assert.equal(vaultPasteTarget({ path: "README.md", name: "README.md", isDir: false, size: 1, modifiedMs: 0, hasChildren: false }), "");
});

test("Windows 剪贴板路径比较兼容斜杠、大小写和末尾分隔符", () => {
  assert.equal(vaultAbsolutePath("D:\\Docs\\", "草稿/README.md"), "D:\\Docs\\草稿\\README.md");
  assert.equal(
    clipboardContainsVaultEntry("D:\\Docs", "草稿/README.md", ["d:/docs/草稿/readme.MD"]),
    true,
  );
  assert.equal(
    clipboardContainsVaultEntry("D:\\Docs", "草稿/README.md", ["D:\\Docs\\其他.md"]),
    false,
  );
});

test("批量文件操作忽略已被选中父目录覆盖的子项", () => {
  const entries = topLevelVaultEntries([
    { path: "资料/子目录/说明.md", name: "说明.md", isDir: false },
    { path: "独立.md", name: "独立.md", isDir: false },
    { path: "资料", name: "资料", isDir: true },
    { path: "资料/清单.md", name: "清单.md", isDir: false },
  ]);
  assert.deepEqual(entries.map((entry) => entry.path), ["资料", "独立.md"]);
});
