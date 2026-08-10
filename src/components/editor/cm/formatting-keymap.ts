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

/**
 * 处理反引号输入的自动配对与围栏代码块补全。
 *
 * - 输入第 1 个 ` → 补成 `` 并把光标置于两个反引号之间
 * - 光标已在两个反引号之间再输入第 2 个 ` → 变成 ``` 并把光标移到三个之后
 * - 光标已在三个反引号之后再输入第 3 个 ` → 补全围栏代码块并把光标移到语言行尾
 */
function handleBacktick(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  if (from !== to) return false; // 有选区时走默认行为

  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const before = doc.sliceString(Math.max(line.from, from - 3), from);

  // 已经是 ``` 在行首：补全代码围栏（插入语言行 + 结尾围栏，光标停在语言后面）
  if (before === "```" && from - 3 === line.from) {
    const insert = "\n\n```";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from },
      scrollIntoView: true,
    });
    return true;
  }

  // 已经是 `` 在光标前：变成 ``` 光标移到三个后面
  if (before.endsWith("``")) {
    view.dispatch({
      changes: { from, to, insert: "`" },
      selection: { anchor: from + 1 },
      scrollIntoView: true,
    });
    return true;
  }

  // 普通情况：插入配对 `` 并把光标放在中间
  view.dispatch({
    changes: { from, to, insert: "``" },
    selection: { anchor: from + 1 },
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
  { key: "`", run: handleBacktick },
];
