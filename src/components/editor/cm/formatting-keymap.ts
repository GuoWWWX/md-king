import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import {
  codeBlockIndentPtFromInfo,
  normalizeCodeBlockIndentPt,
  selectionCoversCodeFence,
  updateCodeFenceIndentInfo,
} from "./code-block-indent";

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
 * - 光标已在两个反引号之间再输入第 2 个 ` → 越过自动补出的闭合符
 * - 行首已有两个反引号再输入第 3 个 ` → 精确补全标准围栏，光标停在语言位置
 */
function handleBacktick(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  if (from !== to) return false; // 有选区时走默认行为

  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const before = doc.sliceString(Math.max(line.from, from - 2), from);
  const after = doc.sliceString(from, Math.min(line.to, from + 1));

  // 第三个反引号：把行首的 `` 一次替换成完整围栏，避免自动闭合符残留成四个反引号。
  if (before === "``" && from - 2 === line.from && from === line.to) {
    const insert = "```\n\n```";
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + 3 },
      scrollIntoView: true,
    });
    return true;
  }

  // 第二个反引号：复用第一次自动补出的闭合符，只把光标移到它后面。
  if (from > line.from && before.endsWith("`") && after === "`") {
    view.dispatch({
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
  if (adjustSelectedCodeBlockIndent(view, 24)) return true;
  return indentMore(view);
}

function removeIndent(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  if (adjustSelectedCodeBlockIndent(view, -24)) return true;
  return indentLess(view);
}

function fencedCodeAt(state: EditorState, position: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "FencedCode" || position < ref.from || position > ref.to) return undefined;
      result = { from: ref.from, to: ref.to };
      return false;
    },
  });
  return result;
}

function fencedCodeCoveredBySelection(state: EditorState): { from: number; to: number } | null {
  const selection = state.selection.main;
  if (selection.empty) return null;
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (result || ref.name !== "FencedCode") return undefined;
      const openingLine = state.doc.lineAt(ref.from);
      const closingLine = state.doc.lineAt(Math.min(ref.to, state.doc.length));
      if (!selectionCoversCodeFence(selection, openingLine, closingLine)) return undefined;
      result = { from: ref.from, to: ref.to };
      return false;
    },
  });
  return result;
}

function openingFenceInfo(
  view: EditorView,
  range = fencedCodeAt(view.state, view.state.selection.main.head),
): { range: { from: number; to: number }; info: string; indentPt: number } | null {
  if (!range) return null;
  const line = view.state.doc.lineAt(range.from);
  const match = line.text.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const info = match[3].trim();
  return { range: { from: line.from, to: line.to }, info, indentPt: codeBlockIndentPtFromInfo(info) };
}

export function getCodeBlockIndentContext(view: EditorView) {
  const fence = openingFenceInfo(view);
  if (!fence) return null;
  return {
    indentPt: fence.indentPt,
    canIndent: fence.indentPt < 144,
    canOutdent: fence.indentPt > 0,
  };
}

export function adjustCodeBlockIndent(view: EditorView, delta: number): boolean {
  if (view.state.readOnly) return false;
  return adjustFenceIndent(view, openingFenceInfo(view), delta);
}

function adjustSelectedCodeBlockIndent(view: EditorView, delta: number): boolean {
  const range = fencedCodeCoveredBySelection(view.state);
  if (!range) return false;
  return adjustFenceIndent(view, openingFenceInfo(view, range), delta);
}

function adjustFenceIndent(
  view: EditorView,
  fence: { range: { from: number; to: number }; info: string; indentPt: number } | null,
  delta: number,
): boolean {
  if (!fence) return false;
  const next = normalizeCodeBlockIndentPt(fence.indentPt + delta);
  if (next === fence.indentPt && delta !== 0) return true;
  const line = view.state.doc.lineAt(fence.range.from);
  const match = line.text.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return false;
  const replacementInfo = updateCodeFenceIndentInfo(fence.info, next);
  const replacement = `${match[1]}${match[2]}${replacementInfo}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: replacement },
    scrollIntoView: false,
  });
  return true;
}

function increaseCodeBlockIndent(view: EditorView) {
  return adjustCodeBlockIndent(view, 24);
}

function decreaseCodeBlockIndent(view: EditorView) {
  return adjustCodeBlockIndent(view, -24);
}

/// 实时渲染下用户直接敲 Markdown 语法就行，不需要工具栏。但这几个
/// 快捷键是跨编辑器的肌肉记忆，留着几乎没有成本。
export const markdownFormattingKeymap: KeyBinding[] = [
  { key: "Tab", run: insertIndent, preventDefault: true },
  { key: "Shift-Tab", run: removeIndent, preventDefault: true },
  { key: "Mod-]", run: increaseCodeBlockIndent, preventDefault: true },
  { key: "Mod-[", run: decreaseCodeBlockIndent, preventDefault: true },
  { key: "Mod-b", run: (view) => wrapSelection(view, "**", "**", "加粗文本"), preventDefault: true },
  { key: "Mod-i", run: (view) => wrapSelection(view, "*", "*", "斜体文本"), preventDefault: true },
  { key: "Mod-e", run: (view) => wrapSelection(view, "`", "`", "代码"), preventDefault: true },
  { key: "Mod-Shift-x", run: (view) => wrapSelection(view, "~~", "~~", "删除线"), preventDefault: true },
  { key: "`", run: handleBacktick },
];
