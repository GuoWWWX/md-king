import type { EditorState } from "@codemirror/state";

/** 语法树区间是 [from, to)。当 to 恰好落在下一行开头时，不能把下一行误计入。 */
function coveredLineBounds(state: EditorState, from: number, to: number): { from: number; to: number } {
  const doc = state.doc;
  const safeFrom = Math.max(0, Math.min(from, doc.length));
  const safeTo = Math.max(0, Math.min(to, doc.length));
  const lastPosition = safeTo > safeFrom ? safeTo - 1 : safeFrom;
  return {
    from: doc.lineAt(safeFrom).from,
    to: doc.lineAt(lastPosition).to,
  };
}

/**
 * 判定「光标是否落在某个内联节点上」——决定该节点的 Markdown 标记显示源码还是隐藏。
 *
 * 有选区（range.from !== range.to）时返回 false：选中文字时保持渲染态，
 * 只有空光标（无选区）时才展开源码，避免选中内容时满屏都是 Markdown 标记。
 *
 * pad 默认 1 的原因：`**加粗**` 的 StrongEmphasis 区间是 [from, to)，
 * 光标停在 `**加粗**|` 这个紧邻右外沿的位置时严格判定会算作「不在范围内」，
 * 于是刚打完 `**` 的瞬间标记立刻被隐藏，用户想继续改就得再点回去。
 * 向外扩一个字符让外沿也算命中，手感才接近 Obsidian。
 */
export function selectionTouches(state: EditorState, from: number, to: number, pad = 1): boolean {
  const start = from - pad;
  const end = to + pad;
  for (const range of state.selection.ranges) {
    if (range.from !== range.to) continue; // 有选区时不展开
    if (range.from <= end && range.to >= start) return true;
  }
  return false;
}

/** 非空选区只要覆盖目标的任意部分即视为相交，供链接这类需要直接修改源码的内联对象使用。 */
export function selectionIntersectsRange(state: EditorState, from: number, to: number): boolean {
  const start = Math.max(0, Math.min(from, state.doc.length));
  const end = Math.max(start, Math.min(to, state.doc.length));
  if (start === end) return false;

  return state.selection.ranges.some((range) => !range.empty && range.from < end && range.to > start);
}

/**
 * 行粒度判定：光标落在该节点覆盖的**任意一行**上，就整块还原成源码。
 *
 * 和 selectionTouches 的区别在于跨行元素（列表项、引用块、代码块）。
 * 光标在第 3 行时，如果只按字符区间判定，同一个块里第 1、2 行的标记仍然是隐藏的，
 * 编辑时会出现「同一段落半边源码半边渲染」的割裂感。Obsidian 是整块还原，这里对齐它。
 */
export function selectionOnLines(state: EditorState, from: number, to: number): boolean {
  const bounds = coveredLineBounds(state, from, to);

  for (const range of state.selection.ranges) {
    if (range.from <= bounds.to && range.to >= bounds.from) return true;
  }
  return false;
}

/**
 * 和 selectionTouches 一致，但 pad 不跨行。有选区时同样返回 false。
 */
export function selectionTouchesOnSameLine(state: EditorState, from: number, to: number, pad = 1): boolean {
  const doc = state.doc;
  const line = doc.lineAt(Math.min(from, doc.length));
  const start = Math.max(from - pad, line.from);
  const end = Math.min(to + pad, line.to);
  for (const range of state.selection.ranges) {
    if (range.from !== range.to) continue; // 有选区时不展开
    if (range.from <= end && range.to >= start) return true;
  }
  return false;
}

/** 非空选区必须完整覆盖目标区间，供表格这类原子块显示整块选中状态。 */
export function selectionCoversRange(state: EditorState, from: number, to: number): boolean {
  const start = Math.max(0, Math.min(from, state.doc.length));
  const end = Math.max(start, Math.min(to, state.doc.length));
  if (start === end) return false;

  return state.selection.ranges.some((range) => !range.empty && range.from <= start && range.to >= end);
}

/** 将文档选区覆盖到的 Markdown 表格源码行映射为渲染表格行。GFM 分隔行不对应可见行。 */
export function selectedMarkdownTableRows(state: EditorState, from: number, to: number): number[] {
  if (state.selection.ranges.every((range) => range.empty)) return [];

  const start = Math.max(0, Math.min(from, state.doc.length));
  const end = Math.max(start, Math.min(to, state.doc.length));
  if (start === end) return [];

  const selected = new Set<number>();
  let sourceLineIndex = 0;
  let line = state.doc.lineAt(start);
  while (line.from < end) {
    if (sourceLineIndex !== 1) {
      const renderedRow = sourceLineIndex === 0 ? 0 : sourceLineIndex - 1;
      if (state.selection.ranges.some((range) => !range.empty && range.from < line.to && range.to > line.from)) {
        selected.add(renderedRow);
      }
    }
    sourceLineIndex += 1;
    if (line.number >= state.doc.lines) break;
    line = state.doc.line(line.number + 1);
  }

  return [...selected].sort((left, right) => left - right);
}

/** 光标是否落在指定行号（1-based）上，供逐行装饰的代码块 / 引用使用。 */
export function selectionOnLineNumber(state: EditorState, lineNumber: number): boolean {
  const doc = state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return false;
  const line = doc.line(lineNumber);
  for (const range of state.selection.ranges) {
    if (range.from <= line.to && range.to >= line.from) return true;
  }
  return false;
}

/**
 * 光标（head）是否落在节点覆盖的行上，有选区时返回 false。
 *
 * 选中文字时不展开任何源码，只有空光标时才展开对应行的源码。
 */
export function cursorOnLines(state: EditorState, from: number, to: number): boolean {
  const bounds = coveredLineBounds(state, from, to);

  for (const range of state.selection.ranges) {
    if (range.from !== range.to) continue; // 有选区时不展开
    if (range.head >= bounds.from && range.head <= bounds.to) return true;
  }
  return false;
}
