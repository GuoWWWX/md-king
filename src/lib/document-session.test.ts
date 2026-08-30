import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentSession, documentSessionStorageKey, parseDocumentSession } from "./document-session.ts";
import type { DocumentTab } from "../stores/document-tabs-store.ts";

test("会话保留标签顺序、活动页面和每个文档的视图位置", () => {
  const tabs: DocumentTab[] = [
    {
      id: "vault-1",
      kind: "vault",
      path: "文档/第一份.md",
      absolutePath: "D:/仓库/文档/第一份.md",
      title: "第一份.md",
      content: "磁盘正文不需要重复存储",
      dirty: false,
      revision: 0,
      viewState: { scrollTop: 860.5, anchor: 120, head: 126, scrollAnchor: 96, scrollAnchorOffset: -18.5 },
    },
    {
      id: "scratch-2",
      kind: "scratch",
      title: "剪贴板内容",
      content: "尚未保存的正文",
      dirty: true,
      revision: 0,
      viewState: { scrollTop: 315, anchor: 18, head: 18 },
    },
  ];

  const session = createDocumentSession(
    tabs,
    "scratch-2",
    "D:\\仓库\\",
    "settings",
    ["templates", "settings", "settings"],
  );

  assert.equal(session.vaultRoot, "D:/仓库");
  assert.equal(session.activeIndex, 1);
  assert.equal(session.tabs[0]?.content, undefined);
  assert.equal(session.tabs[1]?.content, "尚未保存的正文");
  assert.deepEqual(session.tabs.map((tab) => tab.viewState?.scrollTop), [860.5, 315]);
  assert.deepEqual(session.tabs[0]?.viewState, {
    scrollTop: 860.5,
    anchor: 120,
    head: 126,
    scrollAnchor: 96,
    scrollAnchorOffset: -18.5,
  });
  assert.equal(session.activePage, "settings");
  assert.deepEqual(session.pageTabs, ["templates", "settings"]);

  const parsed = parseDocumentSession(JSON.stringify(session), "d:/仓库");
  assert.deepEqual(parsed, session);
});

test("损坏、跨目录和无效标签不会污染恢复会话", () => {
  const raw = JSON.stringify({
    version: 1,
    vaultRoot: "D:/仓库A",
    activeIndex: 99,
    activePage: "unknown",
    pageTabs: ["convert", "history", "unknown"],
    tabs: [
      { kind: "vault", title: "无路径", dirty: false },
      { kind: "scratch", title: "缺正文", dirty: true },
      { kind: "image", path: "图片/结构图.png", title: "结构图.png", dirty: false, viewState: { scrollTop: -20, anchor: -1, head: 3, scrollAnchor: 8.9, scrollAnchorOffset: -12.25 } },
    ],
  });

  assert.equal(parseDocumentSession(raw, "D:/仓库B"), undefined);
  const parsed = parseDocumentSession(raw, "D:/仓库A");
  assert.equal(parsed?.tabs.length, 1);
  assert.equal(parsed?.activeIndex, 0);
  assert.deepEqual(parsed?.tabs[0]?.viewState, { scrollTop: 0, anchor: 0, head: 3, scrollAnchor: 8, scrollAnchorOffset: -12.25 });
  assert.equal(parsed?.activePage, "convert");
  assert.deepEqual(parsed?.pageTabs, ["history"]);
  assert.notEqual(documentSessionStorageKey("D:/仓库A"), documentSessionStorageKey("D:/仓库B"));
});
