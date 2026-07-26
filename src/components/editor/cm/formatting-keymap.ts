import type { EditorView, KeyBinding } from "@codemirror/view";

/// 用 before/after 包裹选区。选区为空时插入占位文本并选中它，
/// 用户可以直接覆盖着打字——比把光标停在标记中间更省一次操作。
function wrapSelection(view: EditorView, before: string, after = before, placeholder = "文本") {
  if (view.state.readOnly) return false;

  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const body = selected || placeholder;

  // 已经被同一对标记包着就脱掉，让快捷键可以来回切换——
  // 这是文本编辑器的通用预期，只加不减会让用户越按越乱。
  const outerFrom = from - before.length;
  const outerTo = to + after.length;
  if (
    selected
    && outerFrom >= 0
    && outerTo <= view.state.doc.length
    && view.state.sliceDoc(outerFrom, from) === before
    && view.state.sliceDoc(to, outerTo) === after
  ) {
    view.dispatch({
      changes: { from: outerFrom, to: outerTo, insert: selected },
      selection: { anchor: outerFrom, head: outerFrom + selected.length },
      scrollIntoView: true,
    });
    return true;
  }

  view.dispatch({
    changes: { from, to, insert: `${before}${body}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + body.length },
    scrollIntoView: true,
  });
  return true;
}

/// 实时渲染下用户直接敲 Markdown 语法就行，不需要工具栏。但这几个
/// 快捷键是跨编辑器的肌肉记忆，留着几乎没有成本。
export const markdownFormattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: (view) => wrapSelection(view, "**", "**", "加粗文本"), preventDefault: true },
  { key: "Mod-i", run: (view) => wrapSelection(view, "*", "*", "斜体文本"), preventDefault: true },
  { key: "Mod-e", run: (view) => wrapSelection(view, "`", "`", "代码"), preventDefault: true },
  { key: "Mod-Shift-x", run: (view) => wrapSelection(view, "~~", "~~", "删除线"), preventDefault: true },
];
