import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
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

/// 缩进用四个空格而不是制表符：Markdown 的列表嵌套按空格数判定层级，
/// 制表符在不同渲染器里折算成的宽度不一致，写出来的文档换个工具就散架。
export const markdownIndentUnit = indentUnit.of("    ");

/// Tab 缩进。CodeMirror 默认把 Tab 留给焦点移动（无障碍考虑），要自己绑。
///
/// 一律走 indentMore：它认得当前语言的缩进单位，在代码块里会按语言规则走，
/// 在列表里会推进嵌套层级。此前手写「补齐到下一个四空格位」的版本会和
/// 语言自身的自动缩进叠加——Enter 后 Java 已经缩进了四格，再补四格就成了八格。
function insertIndent(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  return indentMore(view);
}

/// 实时渲染下用户直接敲 Markdown 语法就行，不需要工具栏。但这几个
/// 快捷键是跨编辑器的肌肉记忆，留着几乎没有成本。
export const markdownFormattingKeymap: KeyBinding[] = [
  { key: "Tab", run: insertIndent, preventDefault: true },
  { key: "Shift-Tab", run: indentLess, preventDefault: true },
  { key: "Mod-b", run: (view) => wrapSelection(view, "**", "**", "加粗文本"), preventDefault: true },
  { key: "Mod-i", run: (view) => wrapSelection(view, "*", "*", "斜体文本"), preventDefault: true },
  { key: "Mod-e", run: (view) => wrapSelection(view, "`", "`", "代码"), preventDefault: true },
  { key: "Mod-Shift-x", run: (view) => wrapSelection(view, "~~", "~~", "删除线"), preventDefault: true },
];
