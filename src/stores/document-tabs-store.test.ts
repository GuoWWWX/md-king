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

test("临时文档另存后转为干净的磁盘标签", () => {
  resetTabs();
  try {
    const id = useDocumentTabsStore.getState().openScratchTab({ title: "粘贴内容", content: "正文", dirty: true });

    useDocumentTabsStore.getState().markTabSavedAs(id, {
      path: "C:/Users/test/Downloads/粘贴内容.md",
      absolutePath: "C:/Users/test/Downloads/粘贴内容.md",
      title: "粘贴内容.md",
      eol: "lf",
      hasBom: false,
      modifiedMs: 10,
    });

    const tab = useDocumentTabsStore.getState().tabs[0];
    assert.equal(tab?.kind, "vault");
    assert.equal(tab?.dirty, false);
    assert.equal(tab?.absolutePath, "C:/Users/test/Downloads/粘贴内容.md");
    assert.equal(tab?.modifiedMs, 10);
  } finally {
    resetTabs();
  }
});

test("临时文档手动修改文件名后不再被正文标题覆盖", () => {
  resetTabs();
  try {
    const id = useDocumentTabsStore.getState().openScratchTab({ title: "原文件名", content: "# 原标题\n" });

    useDocumentTabsStore.getState().renameTab(id, { title: "新文件名" });
    useDocumentTabsStore.getState().updateTabContent(id, "# 新正文标题\n正文");

    const tab = useDocumentTabsStore.getState().tabs[0];
    assert.equal(tab?.title, "新文件名");
    assert.equal(tab?.titleEdited, true);
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

test("切换仓库时关闭全部文档和图片标签", () => {
  resetTabs();
  try {
    useDocumentTabsStore.getState().openVaultTab({
      path: "README.md",
      absolutePath: "D:/仓库A/README.md",
      title: "README.md",
      content: "仓库 A",
    });
    useDocumentTabsStore.getState().openImageTab({
      path: "assets/封面.png",
      absolutePath: "D:/仓库A/assets/封面.png",
      title: "封面.png",
    });

    useDocumentTabsStore.getState().closeAllTabs();

    assert.deepEqual(useDocumentTabsStore.getState().tabs, []);
    assert.equal(useDocumentTabsStore.getState().activeTabId, undefined);
  } finally {
    resetTabs();
  }
});

test("每个标签分别保存滚动位置和光标位置", () => {
  resetTabs();
  try {
    const firstId = useDocumentTabsStore.getState().openScratchTab({ title: "第一份", content: "第一份正文" });
    const secondId = useDocumentTabsStore.getState().openScratchTab({ title: "第二份", content: "第二份正文" });

    useDocumentTabsStore.getState().setTabViewState(firstId, { scrollTop: 480.25, anchor: 4, head: 7 });
    useDocumentTabsStore.getState().setTabViewState(secondId, { scrollTop: 920, anchor: 2, head: 2 });

    const [first, second] = useDocumentTabsStore.getState().tabs;
    assert.deepEqual(first?.viewState, { scrollTop: 480.25, anchor: 4, head: 7 });
    assert.deepEqual(second?.viewState, { scrollTop: 920, anchor: 2, head: 2 });
  } finally {
    resetTabs();
  }
});

test("恢复会话时保持标签顺序和关闭前激活的标签", () => {
  resetTabs();
  try {
    useDocumentTabsStore.getState().restoreSessionTabs([
      { kind: "vault", path: "第一份.md", absolutePath: "D:/仓库/第一份.md", title: "第一份.md", content: "一", dirty: false, viewState: { scrollTop: 100, anchor: 1, head: 1 } },
      { kind: "image", path: "图片/结构图.png", absolutePath: "D:/仓库/图片/结构图.png", title: "结构图.png", content: "", dirty: false },
      { kind: "scratch", title: "第三份", content: "三", dirty: true, viewState: { scrollTop: 300, anchor: 2, head: 2 } },
    ], 2);

    const state = useDocumentTabsStore.getState();
    assert.deepEqual(state.tabs.map((tab) => tab.title), ["第一份.md", "结构图.png", "第三份"]);
    assert.equal(state.tabs.findIndex((tab) => tab.id === state.activeTabId), 2);
    assert.equal(state.tabs[0]?.revision, 0);
    assert.deepEqual(state.tabs[2]?.viewState, { scrollTop: 300, anchor: 2, head: 2 });
  } finally {
    resetTabs();
  }
});

test("异步恢复会话时不覆盖启动参数已经打开的文件", () => {
  resetTabs();
  try {
    const startupTabId = useDocumentTabsStore.getState().openVaultTab({
      path: "启动文件.md",
      absolutePath: "D:\\仓库\\启动文件.md",
      title: "启动文件.md",
      content: "当前启动参数打开的内容",
    });

    useDocumentTabsStore.getState().restoreSessionTabs([
      { kind: "vault", path: "旧文件.md", absolutePath: "D:/仓库/旧文件.md", title: "旧文件.md", content: "旧内容", dirty: false },
      { kind: "vault", path: "启动文件.md", absolutePath: "d:/仓库/启动文件.md", title: "启动文件.md", content: "旧会话内容", dirty: false },
    ], 0);

    const state = useDocumentTabsStore.getState();
    assert.deepEqual(state.tabs.map((tab) => tab.title), ["旧文件.md", "启动文件.md"]);
    assert.equal(state.activeTabId, startupTabId);
    assert.equal(state.tabs[1]?.content, "当前启动参数打开的内容");
  } finally {
    resetTabs();
  }
});
