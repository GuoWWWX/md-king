import assert from "node:assert/strict";
import test from "node:test";
import { externalDocumentSyncDecision } from "./external-document-sync.ts";

test("干净标签检测到外部正文变化后自动重载", () => {
  assert.equal(
    externalDocumentSyncDecision(
      { content: "旧正文", dirty: false, modifiedMs: 1 },
      { content: "外部新正文", modifiedMs: 2 },
    ),
    "reload",
  );
});

test("普通未保存编辑不会被目录中的无关事件误判为外部冲突", () => {
  assert.equal(
    externalDocumentSyncDecision(
      { content: "本地未保存正文", dirty: true, modifiedMs: 1 },
      { content: "磁盘原正文", modifiedMs: 1 },
    ),
    "ignore",
  );
});

test("未保存编辑与新的磁盘版本同时存在时进入冲突处理", () => {
  assert.equal(
    externalDocumentSyncDecision(
      { content: "本地未保存正文", dirty: true, modifiedMs: 1 },
      { content: "外部新正文", modifiedMs: 2 },
    ),
    "conflict",
  );
});

test("自身保存事件只校准磁盘版本而不重复重载编辑器", () => {
  assert.equal(
    externalDocumentSyncDecision(
      { content: "已经保存的正文", dirty: true, modifiedMs: 1 },
      { content: "已经保存的正文", modifiedMs: 2 },
    ),
    "align",
  );
});
