import { EditorView } from "@codemirror/view";
import { parseMarkdownTable } from "./markdown-table.ts";

export type TableBlockPaste = {
  from: number;
  to: number;
  insert: string;
  anchor: number;
};

/** 只识别完整的 GFM 表格，避免把普通的 Setext 标题误当成表格块。 */
export function standaloneMarkdownTableSource(value: string): string | null {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  while (lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length < 2 || lines.some((line) => !line.includes("|"))) return null;

  const source = lines.join("\n");
  return parseMarkdownTable(source) ? source : null;
}

function separatorAfter(prefix: string): string {
  if (!prefix || prefix.endsWith("\n\n")) return "";
  return prefix.endsWith("\n") ? "\n" : "\n\n";
}

function separatorBefore(suffix: string): string {
  if (!suffix || suffix.startsWith("\n\n")) return "";
  return suffix.startsWith("\n") ? "\n" : "\n\n";
}

/** 把表格作为独立块插入，保证它不会和相邻段落拼成同一行。 */
export function tableBlockPaste(
  document: string,
  from: number,
  to: number,
  clipboardText: string,
): TableBlockPaste | null {
  const table = standaloneMarkdownTableSource(clipboardText);
  if (!table) return null;

  const safeFrom = Math.max(0, Math.min(from, document.length));
  const safeTo = Math.max(safeFrom, Math.min(to, document.length));
  const before = document.slice(0, safeFrom);
  const after = document.slice(safeTo);
  const prefix = separatorAfter(before);
  const suffix = separatorBefore(after);
  return {
    from: safeFrom,
    to: safeTo,
    insert: `${prefix}${table}${suffix}`,
    anchor: safeFrom + prefix.length + table.length,
  };
}

export const tableBlockPasteExtension = EditorView.domEventHandlers({
  paste: (event, view) => {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest(".mk-cm-table-wrapper"))) {
      return false;
    }
    const selection = view.state.selection.main;
    const plan = tableBlockPaste(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      event.clipboardData?.getData("text/plain") ?? "",
    );
    if (!plan) return false;

    event.preventDefault();
    view.dispatch({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.anchor },
      scrollIntoView: true,
    });
    return true;
  },
});
