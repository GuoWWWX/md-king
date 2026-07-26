import type { EditorState } from "@codemirror/state";

/**
 * 判定「光标是否落在某个内联节点上」——决定该节点的 Markdown 标记显示源码还是隐藏。
 *
 * pad 默认 1 的原因：`**加粗**` 的 StrongEmphasis 区间是 [from, to)，
 * 光标停在 `**加粗**|` 这个紧邻右外沿的位置时严格判定会算作「不在范围内」，
 * 于是刚打完 `**` 的瞬间标记立刻被隐藏，用户想继续改就得再点回去。
 * 向外扩一个字符让外沿也算命中，手感才接近 Obsidian。
 *
 * 多光标场景要逐个 range 检查：只要任意一个选区碰到该节点就展开源码。
 */
export function selectionTouches(state: EditorState, from: number, to: number, pad = 1): boolean {
  const start = from - pad;
  const end = to + pad;
  for (const range of state.selection.ranges) {
    // 选区和节点区间只要有交叠就算命中；range.from === range.to 的空光标同样适用。
    if (range.from <= end && range.to >= start) return true;
  }
  return false;
}

/**
 * 行粒度判定：光标落在该节点覆盖的**任意一行**上，就整块还原成源码。
 *
 * 和 selectionTouches 的区别在于跨行元素（列表项、引用块、代码块）。
 * 光标在第 3 行时，如果只按字符区间判定，同一个块里第 1、2 行的标记仍然是隐藏的，
 * 编辑时会出现「同一段落半边源码半边渲染」的割裂感。Obsidian 是整块还原，这里对齐它。
 */
export function selectionOnLines(state: EditorState, from: number, to: number): boolean {
  const doc = state.doc;
  // 越界保护：语法树可能滞后于文档（parse 是增量异步的），拿到过期区间会让 lineAt 抛错。
  const safeFrom = Math.max(0, Math.min(from, doc.length));
  const safeTo = Math.max(0, Math.min(to, doc.length));
  const startLine = doc.lineAt(safeFrom).from;
  const endLine = doc.lineAt(safeTo).to;

  for (const range of state.selection.ranges) {
    if (range.from <= endLine && range.to >= startLine) return true;
  }
  return false;
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
