import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { selectionOnLines, selectionTouches } from "./selection-utils";
import { BulletWidget } from "./widgets";

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

function lineDecoration(className: string): Decoration {
  let deco = lineDecorationCache.get(className);
  if (!deco) {
    deco = Decoration.line({ class: className });
    lineDecorationCache.set(className, deco);
  }
  return deco;
}

function markDecoration(className: string): Decoration {
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
};

function touches(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && selectionTouches(collector.state, from, to);
}

function onLines(collector: DecorationCollector, from: number, to: number): boolean {
  return collector.focused && selectionOnLines(collector.state, from, to);
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

function addMark(collector: DecorationCollector, from: number, to: number, className: string): void {
  if (from >= to || to > collector.state.doc.length) return;
  collector.decorations.push(markDecoration(className).range(from, to));
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

const headingPattern = /^ATXHeading([1-6])$/;

function handleHeading(collector: DecorationCollector, ref: SyntaxNodeRef, level: number): void {
  const state = collector.state;
  addLine(collector, state.doc.lineAt(ref.from).from, `mk-cm-heading mk-cm-h${level}`);

  // 标题是单行元素，用行粒度判定：光标在这一行上就完整还原 `### `，方便直接改级别。
  if (onLines(collector, ref.from, ref.to)) return;

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
}

/** 加粗 / 斜体 / 删除线 / 行内代码共用一套：整体加 mark 类，两端的标记按内联粒度显隐。 */
function handleInlineWrapper(
  collector: DecorationCollector,
  ref: SyntaxNodeRef,
  markType: string,
  className: string,
): void {
  addMark(collector, ref.from, ref.to, className);
  if (touches(collector, ref.from, ref.to)) return;
  for (const mark of childrenOfType(ref.node, markType)) {
    hide(collector, mark.from, mark.to);
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
  const marks = childrenOfType(ref.node, "LinkMark");
  if (marks.length < 2) {
    addMark(collector, ref.from, ref.to, "mk-cm-link");
    return;
  }

  const open = marks[0];
  const close = marks[1];
  addMark(collector, open.to, close.from, "mk-cm-link");

  if (touches(collector, ref.from, ref.to)) return;
  hide(collector, open.from, open.to);
  hide(collector, close.from, ref.to);
}

function handleQuoteMark(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const state = collector.state;
  const line = state.doc.lineAt(ref.from);
  addLine(collector, line.from, "mk-cm-quote-line");

  // QuoteMark 本身只占一个字符且必在单行内，行粒度判定等价于「光标在这一行」。
  if (onLines(collector, ref.from, ref.to)) return;
  hide(collector, ref.from, ref.to + trailingSpaceCount(state, ref.to, 1));
}

function handleListMark(collector: DecorationCollector, ref: SyntaxNodeRef): void {
  const state = collector.state;
  const line = state.doc.lineAt(ref.from);
  const node = ref.node;
  const parentList = node.parent?.parent;
  const ordered = parentList?.name === "OrderedList";

  addLine(collector, line.from, ordered ? "mk-cm-list-line mk-cm-list-ordered" : "mk-cm-list-line");

  if (onLines(collector, ref.from, ref.to)) return;
  // 有序列表的 `1.` 本身就是要读的内容，只有无序列表的 `-`/`*`/`+` 换成排版化圆点。
  if (ordered) return;

  if (ref.from >= ref.to || ref.to > state.doc.length) return;
  if (state.doc.lineAt(ref.from).number !== state.doc.lineAt(ref.to).number) return;

  const widget = Decoration.replace({ widget: new BulletWidget(bulletDepth(node)) });
  collector.decorations.push(widget.range(ref.from, ref.to));
  collector.atomics.push(widget.range(ref.from, ref.to));
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
  // 光标落在代码块任意一行上就整块回到源码态，和标题、引用的处理一致；
  // 移开后把 ``` 围栏收起来，只留下背景块本身作为边界提示。
  const editing = onLines(collector, ref.from, ref.to);

  // 语言标记（```java 的 java）通过 data 属性交给 CSS 伪元素画在左上角。
  // 用属性而不是 widget：widget 会插进文档流占掉一行高度，把首行内容顶下去。
  const infoNode = ref.node.getChild("CodeInfo");
  const language = infoNode ? doc.sliceString(infoNode.from, infoNode.to).trim() : "";

  // 行号范围先和可见区间取交集：一个两千行的代码块若按 node.from/node.to 全量铺行装饰，
  // 一次滚动就会产生两千个装饰对象，可见区间优化就白做了。
  const start = doc.lineAt(Math.max(ref.from, rangeFrom));
  const end = doc.lineAt(Math.min(Math.max(ref.to, ref.from), rangeTo));

  for (let lineNumber = start.number; lineNumber <= end.number; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const isFence = lineNumber === firstLine.number || lineNumber === lastLine.number;

    if (isFence && !editing) {
      // 整行 replace 掉围栏。跨行装饰必须由 StateField 提供，所以这里只能
      // 逐行处理：把这一行的字符全部隐藏，行本身仍然存在（高度靠 CSS 压到 0）。
      hide(collector, line.from, line.to);
      addLine(collector, line.from, lineNumber === firstLine.number ? "mk-cm-code-fence mk-cm-code-fence-first" : "mk-cm-code-fence mk-cm-code-fence-last");
      continue;
    }

    if (editing) {
      // 编辑态就是裸源码：连背景和边框一起撤掉，只留等宽字体。
      // 留着框会让「正在编辑的那几行」和收起态长得几乎一样，反而看不出状态差别。
      addLine(collector, line.from, "mk-cm-code-raw");
      continue;
    }

    const edge = lineNumber === firstLine.number
      ? " mk-cm-code-first"
      : lineNumber === lastLine.number
        ? " mk-cm-code-last"
        : "";
    addLine(collector, line.from, `mk-cm-code-line${edge}`);
  }

  // 只有渲染态才挂语言标签：编辑态首行显示的就是 ```java 本身，
  // 再叠一个标签会和源码文字重合。
  if (!editing && language && firstLine.from >= rangeFrom && firstLine.from <= rangeTo) {
    collector.decorations.push(
      Decoration.line({ attributes: { "data-code-language": language } }).range(firstLine.from),
    );
  }
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; atomics: DecorationSet } {
  const state = view.state;
  const collector: DecorationCollector = { state, focused: view.hasFocus, decorations: [], atomics: [] };
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
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
          case "Link":
            handleLink(collector, ref);
            return;
          case "QuoteMark":
            handleQuoteMark(collector, ref);
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

    if (this.pendingRebuild || update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
      this.pendingRebuild = false;
      const built = buildDecorations(update.view);
      this.decorations = built.decorations;
      this.atomics = built.atomics;
    }
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomics ?? Decoration.none),
});
