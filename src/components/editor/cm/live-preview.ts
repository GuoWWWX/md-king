import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { isMermaidLanguage } from "@/lib/mermaid";
import { markdownCaptionText, mermaidFenceCaption } from "@/lib/mermaid-fence";
import { findBareExternalLinks, findObsidianWikilinks, isExternalDocumentLink, isMarkdownWikilinkTarget } from "@/lib/document-links";
import { parseMarkdownCalloutHeader } from "@/lib/markdown-callout";
import { parseYamlFrontmatter } from "@/lib/markdown-frontmatter";
import { findBlockMarkdownMath, findInlineMarkdownMath } from "@/lib/markdown-math";
import { findRelaxedStrongRanges } from "@/lib/relaxed-strong";
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate, type WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import {
  codeBlockIndentAttributeRange,
  codeBlockIndentClass,
  codeBlockIndentPtFromInfo,
  codeFenceLanguageFromInfo,
} from "./code-block-indent";
import { markdownSourceIndentClass, markdownSourceIndentLength, parseMarkdownSourceListLine, sourceOrderedListValue } from "./source-indent";
import { selectedMarkdownTableRows, selectionIntersectsRange, selectionOnLines, selectionTouchesOnSameLine, cursorOnLines } from "./selection-utils";
import { parseMarkdownTable } from "./markdown-table";
import {
  applyTableWidthMode,
  createTableDisplaySettings,
  mapTableDisplaySettings,
  resetTableDisplaySettingsEffect,
  setTableWidthModeEffect,
  tableWidthModeFor,
  type TableDisplaySettings,
  type TableWidthMode,
} from "./table-display-settings";
import { BulletWidget, CopyCodeWidget, editMermaidSourceEffect, editTableSourceEffect, MarkdownCalloutIconWidget, MarkdownFrontmatterWidget, MarkdownImageWidget, MarkdownLinkIconWidget, MarkdownMathWidget, MarkdownWikilinkWidget, MermaidWidget, OrderedListWidget, selectWholeTableEffect, TableWidget, TaskCheckboxWidget } from "./widgets";

/**
 * 内联装饰层：Obsidian 式实时预览的核心。
 *
 * 为什么整层挂在 ViewPlugin 而不是 StateField：内联装饰只影响单行内的排版，
 * CM 可以在算完视口之后再拿；这样就能只遍历 view.visibleRanges，
 * 5000 行文档滚动时每帧的工作量和屏幕高度成正比而不是和文档长度成正比。
 *
 * 反过来说，跨行的 replace 和 block:true 的 widget **绝不能**放这里——
 * CM 需要在计算视口高度之前就知道块级装饰，ViewPlugin 的装饰那时还不存在，
 * 结果是静默失效、不报错、极难排查。那部分留给后续阶段的 StateField。
 */

// 复用同一个 Decoration 实例，避免每次重建都 new 出成千上万个等价对象。
const hiddenMark = Decoration.replace({});
const lineDecorationCache = new Map<string, Decoration>();
const markDecorationCache = new Map<string, Decoration>();

type CalloutCollapseChange = {
  from: number;
  collapsed: boolean;
};

/** 点击 Callout 标题后的显隐状态。位置会随正文编辑映射，不写回 Markdown 源码。 */
export const setCalloutCollapsedEffect = StateEffect.define<CalloutCollapseChange>();
/** 文档切换时不能把上一个文件的展开状态带到新文件。 */
export const resetCalloutCollapsedEffect = StateEffect.define<void>();
/** 焦点离开编辑区时，即使选区仍停在 Frontmatter，也恢复属性卡片。 */
export const renderFrontmatterEffect = StateEffect.define<void>();

const calloutCollapseState = StateField.define<ReadonlyMap<number, boolean>>({
  create: () => new Map(),
  update: (value, transaction) => {
    let next = value;
    if (transaction.docChanged && value.size > 0) {
      const mapped = new Map<number, boolean>();
      for (const [from, collapsed] of value) {
        const mappedFrom = transaction.changes.mapPos(from, 1);
        if (mappedFrom >= 0 && mappedFrom <= transaction.state.doc.length) mapped.set(mappedFrom, collapsed);
      }
      next = mapped;
    }
    for (const effect of transaction.effects) {
      if (effect.is(resetCalloutCollapsedEffect)) return new Map();
      if (!effect.is(setCalloutCollapsedEffect)) continue;
      if (next === value) next = new Map(value);
      (next as Map<number, boolean>).set(effect.value.from, effect.value.collapsed);
    }
    return next;
  },
});

function isCalloutCollapsed(state: EditorState, from: number, defaultFold: "collapsed" | "expanded" | undefined): boolean {
  return state.field(calloutCollapseState, false)?.get(from) ?? defaultFold === "collapsed";
}

function lineDecoration(className: string): Decoration {
  let deco = lineDecorationCache.get(className);
  if (!deco) {
    deco = Decoration.line({ class: className });
    lineDecorationCache.set(className, deco);
  }
  return deco;
}

function markDecoration(className: string, attributes?: Record<string, string>): Decoration {
  if (attributes) return Decoration.mark({ ...(className ? { class: className } : {}), attributes });
  let deco = markDecorationCache.get(className);
  if (!deco) {
    deco = Decoration.mark({ class: className });
    markDecorationCache.set(className, deco);
  }
  return deco;
}

/** 装饰收集器：内联装饰和「原子区间」要分两套，原因见 atomicRanges 的注释。 */
type DecorationCollector = {
  readonly state: EditorState;
  /**
   * 编辑器没有焦点时一律按「不命中」处理，即使 state 里还留着上次的选区。
   * 否则失焦后文档里会永远杵着一行裸源码，看着像渲染坏了。
   */
  readonly focused: boolean;
  readonly decorations: Range<Decoration>[];
  readonly atomics: Range<Decoration>[];
  readonly mathRanges: Array<{ from: number; to: number }>;
};

// 列表标记和复选框专用：pad 不跨行，避免光标停在上一行末尾误触发下一行源码展开。
function touchesSameLine(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && selectionTouchesOnSameLine(collector.state, from, to);
}

// 链接允许光标停在源码起止边界时展开，但不向外扩字符。
// CodeMirror 会把可见链接文字末端的光标吸附到整个 Link 节点的末端；若用严格不等式，
// 用户看到光标紧贴链接，源码却仍被隐藏。限制在同一行可避免影响下一行。
function cursorInside(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && selectionTouchesOnSameLine(collector.state, from, to, 0);
}

/** 非空选区覆盖到的 Markdown 对象统一显示源码，表格和图片由各自的块级字段处理。 */
function sourceSelected(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && selectionIntersectsRange(collector.state, from, to);
}

// 双链被拖选或光标落到源码范围及其边界时还原源码。
function wikilinkSourceActive(collector: DecorationCollector, from: number, to: number): boolean {
  return sourceSelected(collector, from, to) || cursorInside(collector, from, to);
}

// 选区跨行时只在光标（head）所在行展开源码，其他行保持渲染态。
function cursorLine(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && cursorOnLines(collector.state, from, to);
}

/**
 * 隐藏一段源码标记。
 *
 * 两道守卫都不能省：
 * - from >= to：语法树滞后于文档时会算出空区间，空的 replace 会被 CM 当成 point decoration，
 *   在 atomicRanges 里表现为一个永远跳不出去的零宽陷阱。
 * - 跨行：ViewPlugin 提供的 replace 一旦包住换行符，CM 会直接抛
 *   "Decorations that replace line breaks may not be specified via plugins"。
 */
function hide(collector: DecorationCollector, from: number, to: number): void {
  if (from >= to) return;
  const doc = collector.state.doc;
  if (to > doc.length) return;
  if (doc.lineAt(from).number !== doc.lineAt(to).number) return;

  collector.decorations.push(hiddenMark.range(from, to));
  collector.atomics.push(hiddenMark.range(from, to));
}

function addMark(collector: DecorationCollector, from: number, to: number, className: string, attributes?: Record<string, string>): void {
  if (from >= to || to > collector.state.doc.length) return;
  collector.decorations.push(markDecoration(className, attributes).range(from, to));
}

function addWidget(collector: DecorationCollector, position: number, widget: WidgetType, side = -1): void {
  if (position < 0 || position > collector.state.doc.length) return;
  collector.decorations.push(Decoration.widget({ widget, side }).range(position));
}

function replaceInline(collector: DecorationCollector, from: number, to: number, widget: WidgetType): void {
  if (from >= to || to > collector.state.doc.length) return;
  if (collector.state.doc.lineAt(from).number !== collector.state.doc.lineAt(to).number) return;
  const replacement = Decoration.replace({ widget });
  collector.decorations.push(replacement.range(from, to));
  collector.atomics.push(replacement.range(from, to));
}

function addLine(collector: DecorationCollector, linePos: number, className: string): void {
  collector.decorations.push(lineDecoration(className).range(linePos));
}

/** 数出 mark 之后紧跟着的空格数——`### 标题` 要连同分隔空格一起藏掉，否则渲染态行首会多出一个空洞。 */
function trailingSpaceCount(state: EditorState, from: number, limit = 4): number {
  const text = state.doc.sliceString(from, Math.min(from + limit, state.doc.length));
  let count = 0;
  while (count < text.length && (text[count] === " " || text[count] === "\t")) count += 1;
  return count;
}

/** 遍历子节点：找特定类型的直接子节点，避免用 iterate 时丢失「父节点是谁」这个上下文。 */
function childrenOfType(node: SyntaxNode, typeName: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === typeName) result.push(child);
  }
  return result;
}

/** 无序列表的嵌套层级，用来决定圆点符号。ListMark → ListItem → BulletList，所以要跳着往上数。 */
function bulletDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth += 1;
  }
  return Math.max(0, depth - 1);
}

/** 任务列表的 `- [ ]` 是一个完整标记；显隐判断不能把列表符号和复选框拆开。 */
function taskSourceRange(node: SyntaxNode): { from: number; to: number } | undefined {
  let listItem: SyntaxNode | null = node;
  while (listItem && listItem.name !== "ListItem") listItem = listItem.parent;
  if (!listItem) return undefined;

  const listMark = listItem.getChild("ListMark");
  const task = listItem.getChild("Task");
  const taskMarker = node.name === "TaskMarker" ? node : task?.getChild("TaskMarker");
  if (!listMark || !taskMarker) return undefined;
  return { from: listMark.from, to: taskMarker.to };
}

const headingPattern = /^ATXHeading([1-6])$/;

function handleHeading(collector: DecorationCollector, ref: SyntaxNodeRef, level: number): void {
  const state = collector.state;
  addLine(collector, state.doc.lineAt(ref.from).from, `mk-cm-heading mk-cm-h${level}`);

  // 标题在空光标或非空选区命中时都还原 Markdown 标记。
  if (cursorLine(collector, ref.from, ref.to) || sourceSelected(collector, ref.from, ref.to)) return;

  const node = ref.node;
  for (const mark of childrenOfType(node, "HeaderMark")) {
    if (mark.from === ref.from) {
      // 开头的 `###`，连同后面的分隔空格一起藏。
      hide(collector, mark.from, mark.to + trailingSpaceCount(state, mark.to));
    } else {
      // 闭合形式 `### 标题 ###`：把前面的空格一并吃掉，否则行尾会留下悬空空格。
      let start = mark.from;
      while (start > ref.from && /[ \t]/.test(state.doc.sliceString(start - 1, start))) start -= 1;
      hide(collector, start, mark.to);
    }
  }

  // Pandoc 的 `{-}` 与旧版 `{.unnumbered}` 只控制 Word 编号，阅读态不显示。
  const source = state.doc.sliceString(ref.from, ref.to);
  const attribute = source.match(/\s*\{([^{}]*)\}\s*$/);
  const unnumbered = attribute?.[1]
    .split(/\s+/)
    .some((value) => value === "-" || value === ".unnumbered" || value === "unnumbered");
  if (unnumbered && attribute?.index !== undefined) hide(collector, ref.from + attribute.index, ref.to);
}

/** 加粗 / 斜体 / 删除线 / 行内代码共用一套：整体加 mark 类，两端的标记按内联粒度显隐。 */
function handleInlineWrapper(
  collector: DecorationCollector,
  ref: SyntaxNodeRef,
  markType: string,
  className: string,
): void {
  addMark(collector, ref.from, ref.to, className);
  if (cursorInside(collector, ref.from, ref.to) || sourceSelected(collector, ref.from, ref.to)) return;
  for (const mark of childrenOfType(ref.node, markType)) {
    hide(collector, mark.from, mark.to);
  }
}

function isInsideObsidianWikilink(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  if (to > line.to) return false;
  return findObsidianWikilinks(line.text).some((wikilink) => {
    const wikilinkFrom = line.from + wikilink.from;
    const wikilinkTo = line.from + wikilink.to;
    return from >= wikilinkFrom && to <= wikilinkTo;
  });
}

function hasSyntaxAncestor(node: SyntaxNode, names: ReadonlySet<string>): boolean {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (names.has(current.name)) return true;
  }
  return false;
}

const relaxedStrongExcludedNodes = new Set(["StrongEmphasis", "InlineCode", "FencedCode", "CodeBlock"]);

function addRelaxedStrong(collector: DecorationCollector, lineFrom: number, tree: ReturnType<typeof syntaxTree>): void {
  const line = collector.state.doc.lineAt(lineFrom);
  for (const range of findRelaxedStrongRanges(line.text)) {
    const from = line.from + range.from;
    const to = line.from + range.to;
    if (collector.mathRanges.some((math) => from < math.to && to > math.from)) continue;
    const contentFrom = line.from + range.contentFrom;
    const contentNode = tree.resolveInner(contentFrom, 1);
    if (hasSyntaxAncestor(contentNode, relaxedStrongExcludedNodes)) continue;

    addMark(collector, from, to, "mk-cm-strong");
    if (cursorInside(collector, from, to) || sourceSelected(collector, from, to)) continue;
    hide(collector, from, contentFrom);
    hide(collector, line.from + range.contentTo, to);
  }
}

/**
 * 行内链接：`[文本](地址)` 渲染成只剩「文本」。
 *
 * Lezer 给出的子节点顺序固定为 LinkMark(`[`) … LinkMark(`]`) LinkMark(`(`) URL LinkMark(`)`)，
 * 所以拿前两个 LinkMark 就够：第一个单独藏，第二个直接藏到 Link 节点结尾，
 * 一次覆盖 `](地址)`、`](地址 "标题")` 和引用式 `][ref]` 三种写法。
 */
function handleLink(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  // Lezer 会把 `[[目标|显示名]]` 内层的方括号当成普通链接。双链已由行级
  // 渲染接管，不能再叠加一层普通链接标记，否则点击会拿到错误的目标字符串。
  if (isInsideObsidianWikilink(collector.state, ref.from, ref.to)) return;
  const targetNode = ref.node.getChild("URL");
  const target = targetNode ? collector.state.doc.sliceString(targetNode.from, targetNode.to).trim() : "";
  // Lezer 会把 callout 的 `[!abstract]` 识别成无目标引用链接；它由引用块逻辑统一显隐。
  if (!target && /^\[![a-z][\w-]*\](?:[+-])?$/i.test(collector.state.doc.sliceString(ref.from, ref.to))) return;
  const kind = isExternalDocumentLink(target) ? "external" : "document";
  // 光标已经进入源码时，链接必须退回为可编辑文本；保留 data 属性会让点击
  // `[`、`]` 或链接文字继续触发跳转，无法修改 Markdown。
  const editingSource = cursorInside(collector, ref.from, ref.to) || sourceSelected(collector, ref.from, ref.to);
  const linkTarget = target && !editingSource ? { "data-mk-link-target": target } : undefined;
  const marks = childrenOfType(ref.node, "LinkMark");
  if (marks.length < 2) {
    addMark(collector, ref.from, ref.to, `mk-cm-link mk-cm-link--${kind}`, linkTarget);
    return;
  }

  const open = marks[0];
  const close = marks[1];
  addMark(collector, open.to, close.from, `mk-cm-link mk-cm-link--${kind}`, linkTarget);

  if (editingSource) return;
  if (target) addWidget(collector, open.to, new MarkdownLinkIconWidget(kind, target), -1);
  hide(collector, open.from, open.to);
  hide(collector, close.from, ref.to);
}

function insideProtectedInlineSource(state: EditorState, position: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Link" || node.name === "Autolink" || node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

function addObsidianAndBareLinks(collector: DecorationCollector, lineFrom: number): void {
  const line = collector.state.doc.lineAt(lineFrom);
  const wikilinks = findObsidianWikilinks(line.text);

  for (const link of wikilinks) {
    const from = line.from + link.from;
    const to = line.from + link.to;
    if (collector.mathRanges.some((math) => from < math.to && to > math.from)) continue;
    if (insideProtectedInlineSource(collector.state, from)) continue;

    const kind = isExternalDocumentLink(link.target) ? "external" : "document";
    const invalid = kind === "document" && !isMarkdownWikilinkTarget(link.target);
    // 双链整体作为一个可见对象替换，避免无别名时把完整目录路径撑满编辑区。
    // 选区碰到该对象即回退为源码，供用户编辑目标、分隔符或显示名。
    if (wikilinkSourceActive(collector, from, to)) continue;
    replaceInline(collector, from, to, new MarkdownWikilinkWidget(kind, link.target, link.displayLabel, from, invalid));
  }

  for (const link of findBareExternalLinks(line.text)) {
    if (wikilinks.some((wikilink) => link.from < wikilink.to && link.to > wikilink.from)) continue;
    const from = line.from + link.from;
    const to = line.from + link.to;
    if (collector.mathRanges.some((math) => from < math.to && to > math.from)) continue;
    if (insideProtectedInlineSource(collector.state, from)) continue;
    if (cursorInside(collector, from, to) || sourceSelected(collector, from, to)) continue;
    const attributes = { "data-mk-link-target": link.target };
    addMark(collector, from, to, "mk-cm-link mk-cm-link--external", attributes);
    addWidget(collector, from, new MarkdownLinkIconWidget("external", link.target), -1);
  }
}

function insideFencedCode(state: EditorState, position: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "FencedCode") return true;
  }
  return false;
}

function addInlineMath(collector: DecorationCollector, lineFrom: number): void {
  const line = collector.state.doc.lineAt(lineFrom);
  if (insideFencedCode(collector.state, line.from)) return;

  for (const range of findInlineMarkdownMath(line.text)) {
    const from = line.from + range.from;
    const to = line.from + range.to;
    const contentFrom = line.from + range.contentFrom;
    const contentTo = line.from + range.contentTo;
    collector.mathRanges.push({ from, to });
    if (cursorInside(collector, from, to) || sourceSelected(collector, from, to)) {
      // 公式源码内的 `[...]` 会被 Markdown 语法树识别成引用链接。公式优先级
      // 更高：编辑源码时只保留普通文本外观，不能让内部方括号表现成文件链接。
      addMark(collector, from, to, "mk-cm-math-source");
      continue;
    }
    replaceInline(
      collector,
      from,
      to,
      new MarkdownMathWidget(
        collector.state.doc.sliceString(contentFrom, contentTo),
        false,
        contentFrom,
        !collector.state.readOnly,
      ),
    );
  }
}

function addRenderedSourceIndent(collector: DecorationCollector, lineFrom: number): void {
  const line = collector.state.doc.lineAt(lineFrom);
  if (insideFencedCode(collector.state, line.from)) return;
  const indentLength = markdownSourceIndentLength(line.text);
  if (indentLength === 0) return;
  if (sourceSelected(collector, line.from, line.to)) return;
  addLine(collector, line.from, markdownSourceIndentClass(line.text));
  hide(collector, line.from, line.from + indentLength);
}

function lineHasParsedListMark(state: EditorState, from: number, to: number): boolean {
  let found = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "ListMark") return undefined;
      found = true;
      return false;
    },
  });
  return found;
}

function fallbackOrderedListValue(state: EditorState, lineNumber: number): number {
  const current = parseMarkdownSourceListLine(state.doc.line(lineNumber).text);
  if (!current?.ordered) return 1;

  const lines = [state.doc.line(lineNumber).text];
  for (let number = lineNumber - 1; number >= 1; number -= 1) {
    const text = state.doc.line(number).text;
    const previous = parseMarkdownSourceListLine(text);
    if (!previous || previous.level < current.level) break;
    lines.unshift(text);
  }
  return sourceOrderedListValue(lines, lines.length - 1);
}

function listMarkerRangeTo(state: EditorState, markerTo: number): number {
  const line = state.doc.lineAt(markerTo);
  return markerTo + trailingSpaceCount(state, markerTo, line.to - markerTo);
}

function addFallbackSourceList(collector: DecorationCollector, lineFrom: number): void {
  const state = collector.state;
  const line = state.doc.lineAt(lineFrom);
  if (insideFencedCode(state, line.from)) return;
  const sourceList = parseMarkdownSourceListLine(line.text, true);
  if (!sourceList) return;
  const markerFrom = line.from + sourceList.markerFrom;
  const markerTo = line.from + sourceList.markerTo;
  if (lineHasParsedListMark(state, markerFrom, markerTo)) return;

  addLine(collector, line.from, sourceList.ordered ? "mk-cm-list-line mk-cm-list-ordered" : "mk-cm-list-line");
  if (touchesSameLine(collector, markerFrom, markerTo) || sourceSelected(collector, line.from, line.to)) return;
  const widget = Decoration.replace({
    widget: sourceList.ordered
      ? new OrderedListWidget(
          sourceList.marker,
          fallbackOrderedListValue(state, line.number),
        )
      : new BulletWidget(sourceList.level),
  });
  const rangeTo = listMarkerRangeTo(state, markerTo);
  collector.decorations.push(widget.range(markerFrom, rangeTo));
  collector.atomics.push(widget.range(markerFrom, rangeTo));
}

function parsedOrderedListValue(state: EditorState, node: SyntaxNode, marker: string): number {
  const listItem = node.parent;
  const orderedList = listItem?.parent;
  if (!listItem || orderedList?.name !== "OrderedList") return Number.parseInt(marker, 10) || 1;

  let firstValue = 1;
  let itemIndex = 0;
  for (let child = orderedList.firstChild; child; child = child.nextSibling) {
    if (child.name !== "ListItem") continue;
    const listMark = child.getChild("ListMark");
    if (itemIndex === 0 && listMark) {
      firstValue = Number.parseInt(state.doc.sliceString(listMark.from, listMark.to), 10) || 1;
    }
    if (child.from === listItem.from) return firstValue + itemIndex;
    itemIndex += 1;
  }
  return Number.parseInt(marker, 10) || 1;
}

function calloutAtLine(state: EditorState, lineFrom: number) {
  const line = state.doc.lineAt(lineFrom);
  if (line.from !== lineFrom) return undefined;
  const prefix = line.text.match(/^\s*>[ \t]?/);
  return parseMarkdownCalloutHeader(line.text.slice(prefix?.[0].length ?? 0));
}

function handleQuoteMark(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const state = collector.state;
  const line = state.doc.lineAt(ref.from);
  let block = ref.node.parent;
  while (block && block.name !== "Blockquote") block = block.parent;
  const firstLine = state.doc.lineAt(block?.from ?? line.from);
  const lastLine = state.doc.lineAt(Math.max(firstLine.from, Math.min(state.doc.length, (block?.to ?? line.to) - 1)));
  const firstPrefix = firstLine.text.match(/^\s*>[ \t]?/);
  const firstContentStart = firstLine.from + (firstPrefix?.[0].length ?? 0);
  const callout = parseMarkdownCalloutHeader(state.doc.sliceString(firstContentStart, firstLine.to));
  const isFirstLine = line.number === firstLine.number;
  const isLastLine = line.number === lastLine.number;
  const collapsed = callout?.fold
    ? isCalloutCollapsed(state, firstLine.from, callout.fold)
    : false;
  const classes = callout
    ? `mk-cm-quote-line mk-cm-callout-line mk-cm-callout-line--${callout.tone}${isFirstLine ? " mk-cm-callout-first" : ""}${isLastLine ? " mk-cm-callout-last" : ""}${collapsed && isFirstLine ? " mk-cm-callout-collapsed-summary" : ""}${collapsed && !isFirstLine ? " mk-cm-callout-collapsed" : ""}`
    : "mk-cm-quote-line";
  addLine(collector, line.from, classes);

  // 围栏首行的 QuoteMark 是 FencedCode 的前一个兄弟，其余行在 FencedCode 内。
  // 代码块进入源码态时统一保留真实引用前缀，不让普通引用的逐行 hide 再将它隐藏。
  const next = ref.node.nextSibling;
  const code = ref.node.parent?.name === "FencedCode"
    ? ref.node.parent
    : next?.name === "FencedCode" && state.doc.lineAt(next.from).from === line.from ? next : null;
  if (code) {
    const prefixTo = ref.to + trailingSpaceCount(state, ref.to, 1);
    if (cursorLine(collector, code.from, code.to) || sourceSelected(collector, code.from, code.to)) {
      addLine(collector, line.from, callout ? "mk-cm-callout-code-source" : "mk-cm-quote-code-source");
      // 包含前缀后的空格，避免源码态额外占一个字符宽度而使代码左右跳动。
      collector.decorations.push(markDecoration(callout ? "mk-cm-callout-code-prefix" : "mk-cm-quote-code-prefix").range(ref.from, prefixTo));
    } else {
      hide(collector, ref.from, prefixTo);
    }
    return;
  }

  // 选中引用正文时同样露出 `>`，避免选区中混入渲染符号而无法直接修改。
  if (cursorLine(collector, ref.from, ref.to) || sourceSelected(collector, line.from, line.to)) return;
  hide(collector, ref.from, ref.to + trailingSpaceCount(state, ref.to, 1));
  if (!callout || !isFirstLine) return;
  const markerFrom = firstContentStart + callout.markerStart;
  addWidget(
    collector,
    markerFrom,
    new MarkdownCalloutIconWidget(
      callout.type,
      callout.tone,
      callout.title || callout.defaultTitle,
      callout.fold ? collapsed : undefined,
      callout.fold ? firstLine.from : undefined,
      callout.fold ? (view) => { toggleCalloutCollapsed(view, firstLine.from); } : undefined,
    ),
    -1,
  );
  hide(collector, markerFrom, firstLine.to);
}

/**
 * 分隔线 `---` / `***` / `___`：光标不在这一行时把源码整行隐藏，只留 CSS 横线。
 * 光标在行上时还原成源码，让用户可以直接删除或修改。
 */
function handleHorizontalRule(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const line = collector.state.doc.lineAt(ref.from);
  const editing = cursorLine(collector, ref.from, ref.to) || sourceSelected(collector, line.from, line.to);
  if (editing) return;
  addLine(collector, line.from, "mk-cm-hr");
  // 整行源码（`---`）替换成零宽内容，高度由 CSS 的 ::before 横线撑起来。
  hide(collector, line.from, line.to);
}

function handleListMark(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const state = collector.state;
  const line = state.doc.lineAt(ref.from);
  const node = ref.node;
  const parentList = node.parent?.parent;
  const ordered = parentList?.name === "OrderedList";
  const taskRange = taskSourceRange(node);

  const quoted = /^\s*>[ \t]?/.test(line.text);
  const quoteClass = quoted ? " mk-cm-quote-list-line" : "";
  addLine(collector, line.from, `${ordered ? "mk-cm-list-line mk-cm-list-ordered" : "mk-cm-list-line"}${quoteClass}`);

  // 任务项用 TaskMarker 的复选框作为唯一符号，不能再额外留一个普通圆点。
  // `- [ ]` 作为一个整体判断：只有光标靠近这组标记时才一起显示源码，
  // 光标落在正文的其他位置不能单独露出前面的短横线。
  if (taskRange) {
    if (touchesSameLine(collector, taskRange.from, taskRange.to) || sourceSelected(collector, taskRange.from, taskRange.to)) return;
    hide(collector, ref.from, ref.to + trailingSpaceCount(state, ref.to, 1));
    return;
  }

  if (touchesSameLine(collector, ref.from, ref.to) || sourceSelected(collector, ref.from, listMarkerRangeTo(state, ref.to))) return;
  if (ref.from >= ref.to || ref.to > state.doc.length) return;
  if (state.doc.lineAt(ref.from).number !== state.doc.lineAt(ref.to).number) return;

  const sourceLevel = parseMarkdownSourceListLine(line.text)?.level ?? 0;
  const depth = Math.max(bulletDepth(node), sourceLevel);
  const marker = state.doc.sliceString(ref.from, ref.to);
  const widget = Decoration.replace({
    widget: ordered
      ? new OrderedListWidget(marker, parsedOrderedListValue(state, node, marker))
      : new BulletWidget(depth),
  });
  const rangeTo = listMarkerRangeTo(state, ref.to);
  collector.decorations.push(widget.range(ref.from, rangeTo));
  collector.atomics.push(widget.range(ref.from, rangeTo));
}

/**
 * 围栏代码块：只给每一行加类，**不做 replace**。
 *
 * 和 Obsidian 一致——代码块里 ``` 本身就是要看见的结构信息，藏掉反而让人分不清边界。
 * 行号范围必须先和可见区间取交集：一个 2000 行的代码块如果按 node.from/node.to 全量铺行装饰，
 * 一次滚动就会产生 2000 个装饰对象，可见区间优化就白做了。
 */
function handleFencedCode(collector: DecorationCollector, ref: SyntaxNodeRef, rangeFrom: number, rangeTo: number): void {
  const state = collector.state;
  const doc = state.doc;

  const firstLine = doc.lineAt(ref.from);
  const lastLine = doc.lineAt(Math.min(ref.to, doc.length));
  // 语言标记（```java 的 java）通过 data 属性交给 CSS 伪元素画在左上角。
  // 用属性而不是 widget：widget 会插进文档流占掉一行高度，把首行内容顶下去。
  const infoNode = ref.node.getChild("CodeInfo");
  const info = infoNode ? doc.sliceString(infoNode.from, infoNode.to).trim() : "";
  const language = codeFenceLanguageFromInfo(info);
  // Mermaid 被选中时与其他 Markdown 对象一样回退到源码；源码显示后继续
  // 保留整块行装饰，避免选区变化时背景卡片闪退。
  const editing = cursorLine(collector, ref.from, ref.to)
    || sourceSelected(collector, ref.from, ref.to);
  const indentClass = codeBlockIndentClass(codeBlockIndentPtFromInfo(info));
  const indented = indentClass ? ` ${indentClass}` : "";
  const indentAttribute = infoNode ? codeBlockIndentAttributeRange(doc.sliceString(infoNode.from, infoNode.to)) : null;
  // 代码行保留外层引用背景；QuoteMark 的显隐和可编辑前缀由 handleQuoteMark 处理。
  let calloutClass = "";
  const fenceLine = doc.lineAt(ref.from);
  const fencePrefix = fenceLine.text.match(/^\s*>[ \t]?/);
  if (fencePrefix) {
    for (let number = fenceLine.number; number >= 1; number -= 1) {
      const line = doc.line(number);
      const prefix = line.text.match(/^\s*>[ \t]?/);
      if (!prefix) break;
      const header = parseMarkdownCalloutHeader(line.text.slice(prefix[0].length));
      if (header) {
        calloutClass = ` mk-cm-callout-line mk-cm-callout-line--${header.tone}`;
        break;
      }
    }
  }
  const quoteClass = fencePrefix && !calloutClass ? " mk-cm-quote-line mk-cm-quote-code-line" : "";
  if (infoNode && indentAttribute) {
    hide(collector, infoNode.from + indentAttribute.from, infoNode.from + indentAttribute.to);
  }

  // mermaid 块在渲染态整块换成图。跨行 replace 只能由 StateField 提供
  // （CM 要在算视口前知道块高度），所以这里只打个标记，实际替换在
  // mermaidBlockField 里做。
  if (!editing && isMermaidLanguage(language)) return;

  // 行号范围先和可见区间取交集：一个两千行的代码块若按 node.from/node.to 全量铺行装饰，
  // 一次滚动就会产生两千个装饰对象，可见区间优化就白做了。
  const start = doc.lineAt(Math.max(ref.from, rangeFrom));
  const end = doc.lineAt(Math.min(Math.max(ref.to, ref.from), rangeTo));

  for (let lineNumber = start.number; lineNumber <= end.number; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const isFirst = lineNumber === firstLine.number;
    const isLast = lineNumber === lastLine.number;
    const isFence = isFirst || isLast;

    if (isFence && !editing) {
      // 整行 replace 掉围栏。跨行装饰必须由 StateField 提供，所以这里只能
      // 逐行处理：把这一行的字符全部隐藏，行本身仍然存在（高度靠 CSS 压到 0）。
      hide(collector, line.from, line.to);
      addLine(collector, line.from, `${isFirst
        ? `mk-cm-code-fence mk-cm-code-fence-first${indented}`
        : `mk-cm-code-fence mk-cm-code-fence-last${indented}`}${quoteClass}${calloutClass}`);
      continue;
    }

    // 编辑态和渲染态用同一套 mk-cm-code-line 背景/边框/内边距，卡片始终在，
    // 光标进出代码块时不会跳。编辑态下围栏行不再隐藏文字，直接显示 ``` 源码，
    // 首尾行仍然套 first/last 拿圆角。
    const edge = isFirst ? " mk-cm-code-first" : isLast ? " mk-cm-code-last" : "";
    addLine(collector, line.from, `mk-cm-code-line${edge}${indented}${quoteClass}${calloutClass}`);
  }

  // 只有渲染态才挂语言标签和复制按钮：编辑态首行显示的就是 ```java 本身，
  // 标签叠上去会跟源码文字重叠。
  if (!editing && firstLine.from >= rangeFrom && firstLine.from <= rangeTo) {
    if (language) {
      collector.decorations.push(
        Decoration.line({ attributes: { "data-code-language": language } }).range(firstLine.from),
      );
    }
    // 复制按钮作为 side:1 的 widget 挂在围栏首行末尾，绝对定位在右上角。
    const codeText = extractFenceCodeText(state, ref.from, ref.to);
    if (codeText) {
      collector.decorations.push(
        Decoration.widget({ widget: new CopyCodeWidget(codeText), side: 1 }).range(firstLine.to),
      );
    }
  }
}

/** GFM 会为列表开头的 `[ ]` / `[x]` 生成专用 TaskMarker，正文方括号不会命中。 */
function handleTaskMarker(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const marker = collector.state.doc.sliceString(ref.from, ref.to);
  if (!/^\[(?: |x|X)\]$/.test(marker)) return;
  // 用行级判定：字符级 touches(pad=1) 会向外扩一格，光标停在上一行末尾就会跨行误触发。
  const sourceRange = taskSourceRange(ref.node) ?? ref;
  const line = collector.state.doc.lineAt(ref.from);
  if (touchesSameLine(collector, sourceRange.from, sourceRange.to) || sourceSelected(collector, line.from, line.to)) return;
  const widget = Decoration.replace({ widget: new TaskCheckboxWidget(marker[1].toLowerCase() === "x") });
  collector.decorations.push(widget.range(ref.from, ref.to));
  collector.atomics.push(widget.range(ref.from, ref.to));
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; atomics: DecorationSet } {
  const state = view.state;
  const collector: DecorationCollector = {
    state,
    focused: view.hasFocus && !state.readOnly,
    decorations: [],
    atomics: [],
    // 块级公式的内容行仍会进入 Markdown 语法树。先登记完整范围，确保其中
    // 的 `[...]`、`[[...]]` 等字符不会再被链接装饰层隐藏或变成可跳转对象。
    mathRanges: findBlockMarkdownMath(state.doc.toString()).map(({ from, to }) => ({ from, to })),
  };
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
      const lineFrom = state.doc.line(lineNumber).from;
      addInlineMath(collector, lineFrom);
      addRenderedSourceIndent(collector, lineFrom);
      addFallbackSourceList(collector, lineFrom);
      addObsidianAndBareLinks(collector, lineFrom);
      addRelaxedStrong(collector, lineFrom, tree);
    }
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const name = ref.name;

        const heading = headingPattern.exec(name);
        if (heading) {
          handleHeading(collector, ref, Number(heading[1]));
          return;
        }

        if (collector.mathRanges.some((math) => ref.from < math.to && ref.to > math.from)
          && (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough" || name === "InlineCode" || name === "Link")) return;

        switch (name) {
          case "StrongEmphasis":
            handleInlineWrapper(collector, ref, "EmphasisMark", "mk-cm-strong");
            return;
          case "Emphasis":
            handleInlineWrapper(collector, ref, "EmphasisMark", "mk-cm-em");
            return;
          case "Strikethrough":
            handleInlineWrapper(collector, ref, "StrikethroughMark", "mk-cm-strike");
            return;
          case "InlineCode":
            handleInlineWrapper(collector, ref, "CodeMark", "mk-cm-inline-code");
            return;
          case "TaskMarker":
            handleTaskMarker(collector, ref);
            return;
          case "Link":
            handleLink(collector, ref);
            return;
          case "QuoteMark":
            handleQuoteMark(collector, ref);
            return;
          case "HorizontalRule":
            handleHorizontalRule(collector, ref);
            return;
          case "ListMark":
            handleListMark(collector, ref);
            return;
          case "FencedCode":
            handleFencedCode(collector, ref, from, to);
            return;
          default:
            return;
        }
      },
    });
  }

  // 第二个参数 true 让 CM 自己排序：同一个节点会同时产出 line / mark / replace 三种装饰，
  // 手工维护 RangeSetBuilder 要求的严格升序几乎必漏，排错成本远高于这里多一次排序。
  return {
    decorations: Decoration.set(collector.decorations, true),
    atomics: Decoration.set(collector.atomics, true),
  };
}

function toggleCalloutCollapsed(view: EditorView, from: number): boolean {
  if (from > view.state.doc.length) return false;
  const callout = calloutAtLine(view.state, from);
  if (!callout?.fold) return false;
  view.dispatch({
    effects: setCalloutCollapsedEffect.of({
      from,
      collapsed: !isCalloutCollapsed(view.state, from, callout.fold),
    }),
  });
  view.requestMeasure();
  return true;
}

class LivePreviewPlugin {
  decorations: DecorationSet;
  /**
   * 只放被隐藏的 replace 区间，绝不能直接把 decorations 整个交给 atomicRanges。
   *
   * atomicRanges 的判定是「pos 落在任一区间内部就弹开」，而 mark 装饰覆盖的是
   * `**加粗**` 的整段可见文本——一并交上去的话，光标根本无法停进加粗文字中间，
   * 表现为「点了没反应／方向键直接跳过整个词」。
   */
  atomics: DecorationSet;
  /** 组合输入期间跳过的重建要在组合结束后补上，否则装饰会一直停在打字前的状态。 */
  private pendingRebuild = false;

  constructor(view: EditorView) {
    const built = buildDecorations(view);
    this.decorations = built.decorations;
    this.atomics = built.atomics;
  }

  update(update: ViewUpdate): void {
    const readOnlyChanged = update.startState.readOnly !== update.state.readOnly;

    // IME 组合期绝对不能重建装饰：重建会替换 contenteditable 里的 DOM 节点，
    // 微软拼音/搜狗的候选框依附在这些节点上，一换就被强制中断，表现为掉字、候选消失。
    // 但位置还是要跟着改动走，否则组合结束时会拿到越界区间直接抛错。
    if (update.view.composing) {
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.atomics = this.atomics.map(update.changes);
      }
      this.pendingRebuild = true;
      return;
    }

    const calloutFoldChanged = update.transactions.some((transaction) => (
      transaction.effects.some((effect) => effect.is(setCalloutCollapsedEffect) || effect.is(resetCalloutCollapsedEffect))
    ));
    if (this.pendingRebuild || update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || readOnlyChanged || calloutFoldChanged) {
      this.pendingRebuild = false;
      const built = buildDecorations(update.view);
      this.decorations = built.decorations;
      this.atomics = built.atomics;
    }
  }
}

const livePreviewViewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomics ?? Decoration.none),
});

export const livePreviewPlugin: Extension = [
  calloutCollapseState,
  livePreviewViewPlugin,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const eventTarget = event.target instanceof Element
        ? event.target.closest(".mk-cm-quote-code-prefix, .mk-cm-callout-code-prefix")
        : null;
      const line = event.target instanceof Element
        ? event.target.closest(".cm-line.mk-cm-quote-code-line, .cm-line.mk-cm-callout-line")
        : null;
      // 箭头右侧到代码卡片左边是可编辑的引用沟槽，即使点在空白处也应定位到 `>`。
      if (!eventTarget && line) {
        const lineBox = line.getBoundingClientRect();
        const cardLeft = Number.parseFloat(getComputedStyle(line, "::after").left) + lineBox.left;
        if (event.clientX >= lineBox.left && event.clientX < cardLeft) {
          const from = view.posAtDOM(line, 0);
          view.dispatch({ selection: { anchor: from }, userEvent: "select.pointer" });
          view.focus();
          event.preventDefault();
          return true;
        }
      }
      if (!eventTarget) return false;
      // 负 text-indent 会让浏览器按“代码正文”命中；把前缀区域显式映射回 `>` 的真实位置。
      const from = view.posAtDOM(eventTarget, 0);
      view.dispatch({ selection: { anchor: from }, userEvent: "select.pointer" });
      view.focus();
      event.preventDefault();
      return true;
    },
  }),
];

function buildMathBlocks(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const editable = !state.readOnly;
  const source = state.doc.toString();

  for (const range of findBlockMarkdownMath(source)) {
    if (editable && selectionOnLines(state, range.from, range.to)) {
      builder.add(range.from, range.to, Decoration.mark({ class: "mk-cm-math-source" }));
      continue;
    }
    const formula = source.slice(range.contentFrom, range.contentTo).trim();
    if (!formula) continue;
    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new MarkdownMathWidget(formula, true, range.contentFrom, editable),
        block: true,
      }),
    );
  }

  return builder.finish();
}

/** 独占行的 `$$...$$` / `\[...\]` 使用块级装饰，避免跨行 replace 在 ViewPlugin 中失效。 */
export const markdownMathBlockExtension = StateField.define<{ decorations: DecorationSet; readOnly: boolean }>({
  create: (state) => ({ decorations: buildMathBlocks(state), readOnly: state.readOnly }),
  update: (value, transaction) => {
    const readOnly = transaction.state.readOnly;
    if (!transaction.docChanged && !transaction.selection && readOnly === value.readOnly) return value;
    return { decorations: buildMathBlocks(transaction.state), readOnly };
  },
  provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
});

function buildFrontmatterBlock(state: EditorState, editable: boolean, forceRender = false): DecorationSet {
  const frontmatter = parseYamlFrontmatter(state.doc.toString());
  if (!frontmatter) return Decoration.none;
  if (editable && !forceRender && selectionOnLines(state, frontmatter.from, frontmatter.contentTo)) {
    const closingLine = state.doc.lineAt(frontmatter.contentTo);
    return Decoration.set([
      Decoration.line({ class: "mk-cm-frontmatter-source-end" }).range(closingLine.from),
    ]);
  }

  return Decoration.set([
    Decoration.replace({
      widget: new MarkdownFrontmatterWidget(frontmatter.entries, editable, frontmatter.from),
      block: true,
    }).range(frontmatter.from, frontmatter.to),
  ]);
}

/** 顶部 YAML Frontmatter 在实时预览中渲染为 Obsidian 风格的文档属性。 */
export function frontmatterBlockExtension(editable = true): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildFrontmatterBlock(state, editable),
    update: (value, transaction) => {
      if (transaction.effects.some((effect) => effect.is(renderFrontmatterEffect))) {
        return buildFrontmatterBlock(transaction.state, editable, true);
      }
      return transaction.docChanged || transaction.selection
        ? buildFrontmatterBlock(transaction.state, editable)
        : value;
    },
    provide: (self) => EditorView.decorations.from(self),
  });
  const frontmatterDocumentClass = EditorView.editorAttributes.compute(["doc"], (state) => (
    { class: parseYamlFrontmatter(state.doc.toString()) ? "mk-cm-has-frontmatter" : "" }
  ));
  return [field, frontmatterDocumentClass];
}


/**
 * Mermaid 的块级装饰。
 *
 * 必须用 StateField 而不是 ViewPlugin：跨行的 `Decoration.replace` 和
 * `block: true` 的 widget 要在 CM 计算视口之前就存在，ViewPlugin 提供的装饰
 * 那时还没生成——放错层不会报错，只是静默不生效。
 *
 * 代价是这里要遍历整篇文档而不是可见区。可以接受：mermaid 块通常一篇文档里
 * 只有几个，远少于内联标记的数量。
 */
function buildMermaidBlocks(state: EditorState, dark: boolean, sourceBlockFrom: number | null, editable: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "FencedCode") return undefined;

      const infoNode = ref.node.getChild("CodeInfo");
      const info = infoNode ? state.doc.sliceString(infoNode.from, infoNode.to).trim() : "";
      const language = codeFenceLanguageFromInfo(info);
      if (!isMermaidLanguage(language)) return false;
      let caption = mermaidFenceCaption(info);

      const first = state.doc.lineAt(ref.from);
      const last = state.doc.lineAt(Math.min(ref.to, state.doc.length));
      let replaceFrom = first.from;
      let replaceTo = last.to;
      if (!caption && first.number > 1) {
        const captionLine = state.doc.line(first.number - 1);
        const precedingCaption = markdownCaptionText(captionLine.text);
        if (precedingCaption) {
          caption = precedingCaption;
          replaceFrom = captionLine.from;
        }
      }
      if (!caption && last.number < state.doc.lines) {
        const captionLine = state.doc.line(last.number + 1);
        const followingCaption = markdownCaptionText(captionLine.text);
        if (followingCaption) {
          caption = followingCaption;
          replaceTo = captionLine.to;
        }
      }
      if (sourceBlockFrom !== null && sourceBlockFrom >= replaceFrom && sourceBlockFrom <= replaceTo) return false;
      // Mermaid 是块级 replace，源码平时不在 DOM 里。非空选区经过该块时先撤销
      // replace，才能和普通 Markdown 一样显示完整源码并继续修改。
      if (editable && selectionIntersectsRange(state, replaceFrom, replaceTo)) return false;

      const body = extractFenceBody(state, ref.from, ref.to);
      if (!body.trim()) return false;

      builder.add(
        replaceFrom,
        replaceTo,
        Decoration.replace({ widget: new MermaidWidget(body, dark, first.from, editable, caption), block: true }),
      );
      return false;
    },
  });

  return builder.finish();
}

/** 取围栏之间的正文，去掉首尾的 ``` 行。 */
function extractFenceBody(state: EditorState, from: number, to: number): string {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(Math.min(to, state.doc.length));
  if (last.number <= first.number) return "";

  const bodyStart = state.doc.line(first.number + 1).from;
  // 末行是收尾围栏时不要带进来；文档结尾缺收尾围栏时它就是正文的一部分。
  const closing = /^\s*(```|~~~)/.test(last.text);
  const bodyEnd = closing ? state.doc.line(last.number - 1>= first.number + 1 ? last.number - 1 : first.number + 1).to : last.to;
  if (bodyEnd <= bodyStart) return "";
  return state.doc.sliceString(bodyStart, bodyEnd);
}

/** 取围栏代码块的纯文本正文（供复制按钮使用），去掉首尾围栏行。 */
function extractFenceCodeText(state: EditorState, from: number, to: number): string {
  return extractFenceBody(state, from, to);
}

/// 深浅色作为 field 的一部分：主题切换时要重画图，否则深色模式下
/// 拿到的还是上次缓存的浅色版本。
export function mermaidBlockExtension(dark: boolean, editable = true): Extension {
  interface MermaidBlockState {
    decorations: DecorationSet;
    parserTree: ReturnType<typeof syntaxTree>;
    sourceBlockFrom: number | null;
  }

  const field = StateField.define<MermaidBlockState>({
    create: (state) => {
      const parserTree = syntaxTree(state);
      return { decorations: buildMermaidBlocks(state, dark, null, editable), parserTree, sourceBlockFrom: null };
    },
    update: (value, tr) => {
      const parserTree = syntaxTree(tr.state);
      const parserChanged = parserTree !== value.parserTree;
      let sourceBlockFrom = value.sourceBlockFrom;
      if (sourceBlockFrom !== null && tr.docChanged) sourceBlockFrom = tr.changes.mapPos(sourceBlockFrom);
      for (const effect of tr.effects) {
        if (editable && effect.is(editMermaidSourceEffect)) sourceBlockFrom = effect.value;
      }
      if (sourceBlockFrom !== null && tr.selection) {
        const headLine = tr.state.doc.lineAt(tr.state.selection.main.head);
        const sourceLine = tr.state.doc.lineAt(Math.min(sourceBlockFrom, tr.state.doc.length));
        let inSourceBlock = false;
        syntaxTree(tr.state).iterate({
          from: sourceLine.from,
          to: sourceLine.to,
          enter: (ref) => {
            if (ref.name !== "FencedCode" || sourceBlockFrom! < ref.from || sourceBlockFrom! >= ref.to) return undefined;
            const last = tr.state.doc.lineAt(Math.min(ref.to, tr.state.doc.length));
            inSourceBlock = headLine.number >= sourceLine.number && headLine.number <= last.number;
            return false;
          },
        });
        if (!inSourceBlock) sourceBlockFrom = null;
      }
      // Mermaid 是否需要替换为图形取决于非空选区；选区变化也必须重建块级装饰。
      // 大段粘贴后语法树可能在后台才补齐；解析树变化时也必须重建，否则要等
      // 用户再点击一次产生选区事务后才会把源码替换成图表。
      if (!tr.docChanged && tr.selection === undefined && !parserChanged && sourceBlockFrom === value.sourceBlockFrom) return value;
      return { decorations: buildMermaidBlocks(tr.state, dark, sourceBlockFrom, editable), parserTree, sourceBlockFrom };
    },
    provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
  });
  return field;
}

function imageSelectionIsEditing(state: EditorState, from: number, to: number): boolean {
  const selection = state.selection.main;
  if (selection.empty) return selection.head >= from && selection.head < to;
  const selectsWholeImage = selection.from <= from && selection.to >= to;
  return !selectsWholeImage && selection.from < to && selection.to > from;
}

function imageIsSelected(state: EditorState, from: number, to: number): boolean {
  const selection = state.selection.main;
  return !selection.empty && selection.from <= from && selection.to >= to;
}

function markdownImageAlt(source: string) {
  const matched = source.match(/^!\[([\s\S]*)\]\([\s\S]*\)$/);
  return matched?.[1] ?? "";
}

function buildImageBlocks(state: EditorState, markdownSourcePath: string | undefined, editable: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Image") return undefined;

      const line = state.doc.lineAt(ref.from);
      const source = state.doc.sliceString(ref.from, ref.to);
      if (state.doc.sliceString(line.from, line.to).trim() !== source.trim() || (editable && imageSelectionIsEditing(state, ref.from, ref.to))) return false;

      const url = ref.node.getChild("URL");
      const src = url ? state.doc.sliceString(url.from, url.to) : "";
      if (!src) return false;

      builder.add(
        line.from,
        line.to,
        Decoration.replace({
          widget: new MarkdownImageWidget(
            src,
            markdownImageAlt(source),
            markdownSourcePath,
            line.from,
            line.to,
            editable && imageIsSelected(state, line.from, line.to),
            editable,
          ),
          block: true,
        }),
      );
      return false;
    },
  });

  return builder.finish();
}

/** 图片和 Mermaid 一样以块级 decoration 替换，确保在编辑区中独占一行并居中。 */
export function markdownImageBlockExtension(markdownSourcePath?: string, editable = true): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildImageBlocks(state, markdownSourcePath, editable),
    update: (value, tr) => tr.docChanged || tr.selection ? buildImageBlocks(tr.state, markdownSourcePath, editable) : value,
    provide: (self) => EditorView.decorations.from(self),
  });
  return field;
}

function buildTableBlocks(
  state: EditorState,
  sourceTableFrom: number | null,
  displaySettings: TableDisplaySettings,
  documentSelectedTableRows: ReadonlyMap<number, readonly number[]>,
  selectedFromToolbarTableFrom: number | null,
  editable: boolean,
  tree = syntaxTree(state),
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  tree.iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return undefined;

      const { first, last } = markdownTableBlockLines(state, ref.from, ref.to);

      // 只有 Widget 内的专用按钮能进入源码态；普通 selection 变化不再拆掉整张表。
      if (sourceTableFrom !== null && sourceTableFrom >= first.from && sourceTableFrom <= last.to) return false;

      const source = state.doc.sliceString(first.from, last.to);
      const table = parseMarkdownTable(source);
      if (!table) return false;

      builder.add(
        first.from,
        last.to,
        Decoration.replace({
          widget: new TableWidget(
            table,
            source,
            first.from,
            last.to,
            tableWidthModeFor(displaySettings, first.from),
            documentSelectedTableRows.get(first.from) ?? [],
            editable && selectedFromToolbarTableFrom === first.from,
            editable,
          ),
          block: true,
        }),
      );
      return false;
    },
  });

  return builder.finish();
}

function documentSelectedTableRows(state: EditorState): ReadonlyMap<number, readonly number[]> {
  const selected = new Map<number, readonly number[]>();
  if (state.selection.ranges.every((range) => range.empty)) return selected;

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return undefined;
      const { first, last } = markdownTableBlockLines(state, ref.from, ref.to);
      const rows = selectedMarkdownTableRows(state, first.from, last.to);
      if (rows.length > 0) selected.set(first.from, rows);
      return false;
    },
  });

  return selected;
}

function sameDocumentTableRows(
  left: ReadonlyMap<number, readonly number[]>,
  right: ReadonlyMap<number, readonly number[]>,
): boolean {
  return left.size === right.size && [...left].every(([position, rows]) => {
    const otherRows = right.get(position);
    return otherRows !== undefined
      && rows.length === otherRows.length
      && rows.every((row, index) => row === otherRows[index]);
  });
}

interface TableBlockState {
  decorations: DecorationSet;
  parserTree: ReturnType<typeof syntaxTree>;
  sourceTableFrom: number | null;
  displaySettings: TableDisplaySettings;
  documentSelectedTableRows: ReadonlyMap<number, readonly number[]>;
  selectedFromToolbarTableFrom: number | null;
  readOnly: boolean;
}

function selectionInsideSourceTable(state: EditorState, sourceTableFrom: number): boolean {
  let inside = false;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return undefined;
      const { first, last } = markdownTableBlockLines(state, ref.from, ref.to);
      if (sourceTableFrom < first.from || sourceTableFrom > last.to) return false;
      const selection = state.selection.main;
      // 表格源码整体被选中时必须继续保留源码态；但折叠光标恰好落在
      // 表格末尾已经属于下一处插入点，不能让粘贴后的表格永久停在源码态。
      inside = selection.empty
        ? selection.head >= first.from && selection.head <= last.to
        : selection.from <= last.to && selection.to > first.from;
      return false;
    },
  });
  return inside;
}

/** GFM 表格的块级装饰，和 Mermaid 一样用 StateField 而不是 ViewPlugin。 */
export const tableBlockExtension = StateField.define<TableBlockState>({
  create: (state) => {
    const displaySettings = createTableDisplaySettings();
    const readOnly = state.readOnly;
    const selectedTableRows = documentSelectedTableRows(state);
    const parserTree = syntaxTree(state);
    return {
      decorations: buildTableBlocks(state, null, displaySettings, selectedTableRows, null, !readOnly, parserTree),
      parserTree,
      sourceTableFrom: null,
      displaySettings,
      documentSelectedTableRows: selectedTableRows,
      selectedFromToolbarTableFrom: null,
      readOnly,
    };
  },
  update: (value, tr) => {
    const parserTree = syntaxTree(tr.state);
    const parserChanged = parserTree !== value.parserTree;
    const readOnly = tr.state.readOnly;
    let sourceTableFrom = value.sourceTableFrom;
    let displaySettings = tr.docChanged
      ? mapTableDisplaySettings(value.displaySettings, (position) => tr.changes.mapPos(position))
      : value.displaySettings;
    let selectedFromToolbarTableFrom = value.selectedFromToolbarTableFrom;
    if (sourceTableFrom !== null && tr.docChanged) sourceTableFrom = tr.changes.mapPos(sourceTableFrom);
    let selectedFromToolbar = false;
    for (const effect of tr.effects) {
      if (!readOnly && effect.is(editTableSourceEffect)) sourceTableFrom = effect.value;
      if (!readOnly && effect.is(selectWholeTableEffect)) {
        selectedFromToolbarTableFrom = effect.value;
        selectedFromToolbar = true;
      }
      if (effect.is(resetTableDisplaySettingsEffect)) displaySettings = createTableDisplaySettings(effect.value);
      if (effect.is(setTableWidthModeEffect)) displaySettings = applyTableWidthMode(displaySettings, effect.value);
    }
    if (readOnly) {
      sourceTableFrom = null;
      selectedFromToolbarTableFrom = null;
    }
    if (tr.docChanged && !selectedFromToolbar) selectedFromToolbarTableFrom = null;
    if (!readOnly && tr.effects.some((effect) => effect.is(editTableSourceEffect))) selectedFromToolbarTableFrom = null;
    const selectedTableRows = tr.docChanged || tr.selection || parserChanged || readOnly !== value.readOnly
      ? documentSelectedTableRows(tr.state)
      : value.documentSelectedTableRows;
    const selectionChanged = !sameDocumentTableRows(value.documentSelectedTableRows, selectedTableRows);
    if (sourceTableFrom !== null && tr.selection && !selectionInsideSourceTable(tr.state, sourceTableFrom)) {
      sourceTableFrom = null;
    }

    if (!tr.docChanged
      && sourceTableFrom === value.sourceTableFrom
      && displaySettings === value.displaySettings
      && !parserChanged
      && !selectionChanged
      && selectedFromToolbarTableFrom === value.selectedFromToolbarTableFrom
      && readOnly === value.readOnly) return value;
    return {
      decorations: buildTableBlocks(tr.state, sourceTableFrom, displaySettings, selectedTableRows, selectedFromToolbarTableFrom, !readOnly, parserTree),
      parserTree,
      sourceTableFrom,
      displaySettings,
      documentSelectedTableRows: selectedTableRows,
      selectedFromToolbarTableFrom,
      readOnly,
    };
  },
  provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
});

/**
 * CodeMirror 会在空闲时间逐步扩展语法树。表格是 StateField，不能像内联预览那样
 * 靠 viewport 更新自动重建，所以主动推进到当前可视末尾并派发空事务通知字段刷新。
 */
class TableSyntaxRefreshPlugin {
  private frame: number | null = null;

  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.schedule(update.view);
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  private schedule(view: EditorView): void {
    if (this.frame !== null || syntaxTreeAvailable(view.state, view.viewport.to)) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (syntaxTreeAvailable(view.state, view.viewport.to)) return;
      forceParsing(view, view.viewport.to, 12);
      this.schedule(view);
    });
  }
}

function markdownTableBlockLines(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from);
  const lastPos = Math.max(from, Math.min(to - 1, state.doc.length - 1));
  let last = state.doc.lineAt(lastPos);
  if (last.number > first.number && markdownCaptionText(last.text)) {
    last = state.doc.line(last.number - 1);
  }
  return { first, last };
}

export const tableSyntaxRefreshPlugin = ViewPlugin.fromClass(TableSyntaxRefreshPlugin);

export type TableDisplayContext = {
  tableFrom: number | null;
  widthMode: TableWidthMode;
  scope: "global" | "table";
};

export function getTableDisplayContext(state: EditorState, tableFrom: number | null): TableDisplayContext {
  // HMR may briefly retain a state created with the previous field identity.
  // Treat that transition as the default table context instead of crashing the editor.
  const displaySettings = state.field(tableBlockExtension, false)?.displaySettings ?? createTableDisplaySettings();
  const hasTableOverride = tableFrom !== null && displaySettings.widthModeOverrides.has(tableFrom);
  return {
    tableFrom,
    widthMode: tableFrom === null
      ? displaySettings.defaultWidthMode
      : tableWidthModeFor(displaySettings, tableFrom),
    scope: hasTableOverride ? "table" : "global",
  };
}
