import assert from "node:assert/strict";
import test from "node:test";
import { useDocumentTabsStore } from "./document-tabs-store.ts";

function resetTabs() {
  useDocumentTabsStore.getState().closeAllTabs();
}

test("首次同步相同内容不会把刚打开的 Vault 文件标成脏状态", () => {
  resetTabs();
  try {
    const id = useDocumentTabsStore.getState().openVaultTab({
      path: "草稿/未命名草稿.md",
      absolutePath: "D:/示例仓库/草稿/未命名草稿.md",
      title: "未命名草稿.md",
      content: "草稿内容\n",
      eol: "lf",
      hasBom: false,
      modifiedMs: 1,
    });

    useDocumentTabsStore.getState().updateTabContent(id, "草稿内容\n");
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.dirty, false);

    useDocumentTabsStore.getState().updateTabContent(id, "草稿内容\n已修改");
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.dirty, true);
  } finally {
    resetTabs();
  }
});

test("导入到临时标签的初始内容不算用户改动", () => {
  resetTabs();
  try {
    const id = useDocumentTabsStore.getState().openScratchTab({ title: "导入内容", content: "原始内容" });
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.dirty, false);

    useDocumentTabsStore.getState().updateTabContent(id, "原始内容");
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.dirty, false);
  } finally {
    resetTabs();
  }
});

test("重新打开已修改的 Vault 文件不会覆盖本地改动", () => {
  resetTabs();
  try {
    const id = useDocumentTabsStore.getState().openVaultTab({
      path: "README.md",
      absolutePath: "D:/示例仓库/README.md",
      title: "README.md",
      content: "磁盘内容",
      eol: "lf",
      hasBom: false,
      modifiedMs: 1,
    });
    useDocumentTabsStore.getState().updateTabContent(id, "本地改动");

    const reopenedId = useDocumentTabsStore.getState().openVaultTab({
      path: "README.md",
      absolutePath: "D:/示例仓库/README.md",
      title: "README.md",
      content: "新的磁盘内容",
      eol: "lf",
      hasBom: false,
      modifiedMs: 2,
    });

    const tab = useDocumentTabsStore.getState().tabs[0];
    assert.equal(reopenedId, id);
    assert.equal(tab?.content, "本地改动");
    assert.equal(tab?.dirty, true);
    assert.equal(tab?.modifiedMs, 1);
  } finally {
    resetTabs();
  }
});

test("图片在同一路径上复用工作区标签，并保留图片类型", () => {
  resetTabs();
  try {
    const firstId = useDocumentTabsStore.getState().openImageTab({
      path: "assets/流程图.png",
      absolutePath: "D:/示例仓库/assets/流程图.png",
      title: "流程图.png",
    });
    const secondId = useDocumentTabsStore.getState().openImageTab({
      path: "assets/流程图.png",
      absolutePath: "D:/示例仓库/assets/流程图.png",
      title: "流程图.png",
    });

    assert.equal(secondId, firstId);
    assert.equal(useDocumentTabsStore.getState().tabs.length, 1);
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.kind, "image");
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.dirty, false);

    useDocumentTabsStore.getState().renameTab(firstId, {
      path: "assets/新版流程图.png",
      absolutePath: "D:/示例仓库/assets/新版流程图.png",
      title: "新版流程图.png",
    });
    assert.equal(useDocumentTabsStore.getState().tabs[0]?.kind, "image");
  } finally {
    resetTabs();
  }
});

test("关闭其他标签会只保留指定标签并激活它", () => {
  resetTabs();
  try {
    const firstId = useDocumentTabsStore.getState().openScratchTab({ title: "第一份", content: "一" });
    const keptId = useDocumentTabsStore.getState().openScratchTab({ title: "保留", content: "二" });
    useDocumentTabsStore.getState().openScratchTab({ title: "第三份", content: "三" });

    useDocumentTabsStore.getState().closeOtherTabs(keptId);

    assert.deepEqual(useDocumentTabsStore.getState().tabs.map((tab) => tab.id), [keptId]);
    assert.equal(useDocumentTabsStore.getState().activeTabId, keptId);
    assert.notEqual(firstId, keptId);
  } finally {
    resetTabs();
  }
});
