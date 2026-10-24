import { AlignLeft, AlignCenter, AlignRight, Underline, PenLine } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { useRef } from "react";
import { formattingSpanAt, type TextAttributes } from "@/lib/markdown-formatting";
import { Button } from "@/components/ui/button";

export function applyTextFormat(view: EditorView, patch: TextAttributes, removeColor = false) {
  if (view.state.readOnly) return;
  const cell = view.dom.querySelector<HTMLTextAreaElement>('.mk-cm-table-input:not([hidden])');
  if (cell) {
    const original = cell.value;
    const from = patch.align ? 0 : cell.selectionStart, to = patch.align ? original.length : cell.selectionEnd;
    const selected = original.slice(from, to);
    const existing = formattingSpanAt(selected, 0);
    const attrs = { ...(existing?.to === selected.length ? existing.attrs : {}), ...patch };
    if (patch.underline && existing?.attrs.underline) delete attrs.underline;
    if (removeColor) delete attrs.color;
    const body = existing?.to === selected.length ? selected.slice(existing.contentFrom, existing.contentTo) : selected || "文字";
    const attr = [attrs.underline && ".underline", attrs.align && `align="${attrs.align}"`, attrs.color && `color="${attrs.color}"`].filter(Boolean).join(" ");
    const insert = attr ? `[${body}]{${attr}}` : body;
    cell.setRangeText(insert, from, to, "select"); cell.dispatchEvent(new Event("input", { bubbles: true })); cell.focus();
    return;
  }
  let { from, to } = view.state.selection.main;
  if (patch.align) {
    from = view.state.doc.lineAt(from).from;
    to = view.state.doc.lineAt(to).to;
    while (from > 0 && view.state.doc.lineAt(from - 1).text.trim()) from = view.state.doc.lineAt(from - 1).from;
    while (to < view.state.doc.length && view.state.doc.lineAt(to + 1).text.trim()) to = view.state.doc.lineAt(to + 1).to;
  }
  const line = view.state.doc.lineAt(from);
  for (let i = line.from; i <= from; i++) {
    const range = formattingSpanAt(view.state.doc.toString(), i);
    if (range && range.contentFrom <= from && range.contentTo >= to) { from = range.from; to = range.to; break; }
  }
  const source = view.state.doc.sliceString(from, to);
  if (patch.align && (source.startsWith(":::") || /\n\s*\n/.test(source))) {
    const insert = source.startsWith(":::")
      ? source.replace(/^(:::\s*\{)([^}]*)(\})/, (_, open: string, attrs: string, end: string) => `${open}${attrs.replace(/\balign\s*=\s*(?:"[^"]*"|'[^']*'|[^\s}]+)/g, "").trim()} align="${patch.align}"${end}`)
      : `::: {align="${patch.align}"}\n\n${source}\n\n:::`;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from, head: from + insert.length }, userEvent: "input.format" }); view.focus(); return;
  }
  const range = formattingSpanAt(source, 0);
  const attrs = { ...(range?.to === source.length ? range.attrs : {}), ...patch };
  if (patch.underline && range?.attrs.underline) delete attrs.underline;
  if (removeColor) delete attrs.color;
  const body = range?.to === source.length ? source.slice(range.contentFrom, range.contentTo) : source || "文字";
  const attributes = [attrs.underline && ".underline", attrs.align && `align="${attrs.align}"`, attrs.color && `color="${attrs.color}"`].filter(Boolean).join(" ");
  const insert = attributes ? `[${body}]{${attributes}}` : body;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from, head: from + insert.length }, scrollIntoView: true, userEvent: "input.format" });
  view.focus();
}

export function FormattingToolbar({ getView }: { getView: () => EditorView | null }) {
  const colorCell = useRef<{ table: string; row: string; column: string; from: number; to: number } | null>(null);
  const format = (attrs: TextAttributes, remove = false) => { const view = getView(); if (view) applyTextFormat(view, attrs, remove); };
  const rememberCell = () => {
    const cell = getView()?.dom.querySelector<HTMLTextAreaElement>('.mk-cm-table-input:not([hidden])');
    colorCell.current = cell ? { table: cell.closest<HTMLElement>('.mk-cm-table-wrapper')?.dataset.tableFrom ?? '', row: cell.dataset.tableRow ?? '', column: cell.dataset.tableColumn ?? '', from: cell.selectionStart, to: cell.selectionEnd } : null;
  };
  const setColor = (color: string) => {
    const saved = colorCell.current, view = getView(); colorCell.current = null;
    if (saved && view) {
      const cell = view.dom.querySelector<HTMLTextAreaElement>(`.mk-cm-table-wrapper[data-table-from="${saved.table}"] textarea[data-table-row="${saved.row}"][data-table-column="${saved.column}"]`);
      if (cell) {
        cell.hidden = false; cell.parentElement?.querySelector('.mk-cm-table-cell-content')?.classList.add('is-editing'); cell.focus(); cell.setSelectionRange(saved.from, saved.to);
      }
    }
    format({ color });
  };
  return <div role="toolbar" aria-label="文字格式" className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
    {([[AlignLeft, "靠左", "left"], [AlignCenter, "居中", "center"], [AlignRight, "靠右", "right"]] as const).map(([Icon, label, align]) => <Button key={align} type="button" variant="ghost" size="icon" className="size-7" title={label} aria-label={label} onClick={() => format({ align })}><Icon className="size-4" /></Button>)}
    <Button type="button" variant="ghost" size="icon" className="size-7" title="下划线" aria-label="下划线" onClick={() => format({ underline: true })}><Underline className="size-4" /></Button>
    <label className="flex cursor-pointer items-center gap-1 px-1 text-xs" title="文字颜色">文字颜色<input aria-label="文字颜色" type="color" defaultValue="#D32F2F" className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" onPointerDown={rememberCell} onChange={e => setColor(e.target.value.toUpperCase())} /></label>
    <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={() => format({}, true)}>跟随样式</Button>
    <Button type="button" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => {
      const view = getView(); if (!view) return;
      const at = view.state.selection.main.to;
      view.dispatch({ changes: { from: at, insert: '\n\n::: {.signature}\n| 字段 | 内容 | 备注 |\n| --- | --- | --- |\n| 签字 | ____ | （签字） |\n| 日期 | ____ | |\n:::\n' }, userEvent: "input.format" }); view.focus();
    }}><PenLine className="size-3.5" />签署块</Button>
  </div>;
}
