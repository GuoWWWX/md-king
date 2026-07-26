import { extractMarkdownTitle } from "@/lib/convert-utils";
import type { ConvertResult, HistoryItem } from "@/types";

export const MAX_HISTORY_ITEMS = 10_000;

export function limitHistory(items: HistoryItem[]) {
  return items.slice(0, MAX_HISTORY_ITEMS);
}

export function buildHistoryItem(result: ConvertResult): HistoryItem {
  const now = new Date().toISOString();
  const title = extractMarkdownTitle(result.input);
  const compactInput = result.input.replace(/\s+/g, " ").trim();
  const inputLabel = title || (compactInput ? (compactInput.length > 48 ? `${compactInput.slice(0, 48)}...` : compactInput) : "粘贴 Markdown");

  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    inputPath: result.simulated ? `${inputLabel}（浏览器预览）` : inputLabel,
    outputPath: result.output,
    templateId: result.templateId,
    simulated: result.simulated,
    status: result.ok ? "success" : "failed",
    durationMs: result.durationMs,
    errorCode: result.errorCode,
    errorMessage: result.ok ? undefined : result.message,
    createdAt: now,
    finishedAt: now,
  };
}
