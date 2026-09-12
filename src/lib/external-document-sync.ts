import type { DocumentTab } from "../stores/document-tabs-store.ts";
import type { VaultFileContent } from "../types/vault.ts";

export type ExternalDocumentSyncDecision = "ignore" | "align" | "reload" | "conflict";

/**
 * 只根据标签的磁盘基准和本次读取结果做决策。把这段逻辑留成纯函数，
 * 可避免目录中的无关事件把普通未保存编辑误判为外部冲突。
 */
export function externalDocumentSyncDecision(
  tab: Pick<DocumentTab, "content" | "dirty" | "modifiedMs">,
  disk: Pick<VaultFileContent, "content" | "modifiedMs">,
): ExternalDocumentSyncDecision {
  if (tab.dirty && tab.modifiedMs === disk.modifiedMs) return "ignore";
  if (tab.content === disk.content) return "align";
  return tab.dirty ? "conflict" : "reload";
}
