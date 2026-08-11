import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { darkSyntaxPalette, lightSyntaxPalette } from "@/lib/syntax-palette";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * 编辑器主题。
 *
 * 颜色一律走 CSS 变量（shadcn 的 --foreground/--muted 系列 + 项目自有的 --mk-*），
 * 不写死色值——这样 `.dark` 切换时浏览器自己重算，
 * 不需要在 React 里重建 EditorView（重建会丢光标和 undo 历史）。
 * 只有真正随主题变形的属性（选区底色的混合比例、代码块背景的明暗）才需要两份 theme。
 */

const sharedTheme = EditorView.theme({
  "&": {
    height: "100%",
    // 搜索面板靠绝对定位浮在右上角，定位上下文必须落在编辑器本体上，
    // 否则它会相对更外层的滚动容器定位，滚动时跟着跑。
    position: "relative",
    // 编辑器背景交给外层 .mk-editor-surface，这里透明避免叠出两层底色。
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "14px",
  },
  "&.cm-focused": {
    // CM 默认的蓝色 outline 和本项目的 focus-visible ring 风格冲突，统一去掉。
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-sans, 'Geist Variable', sans-serif)",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": {
    width: "100%",
    minWidth: "0",
    padding: "20px 24px 40vh 24px",
    caretColor: "var(--primary)",
  },
  // 底部留白给到 40vh：写到文档末尾时最后一行仍能滚到屏幕中部，长文写作的基本手感。
  ".cm-line": {
    padding: "0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
    borderLeftWidth: "2px",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
  ".cm-selectionBackground": {
    // drawSelection() 已禁用，这条规则不生效，选区由浏览器原生 ::selection 渲染。
    backgroundColor: "transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  // 搜索面板：CM 默认把它当整行的 panel 布局，会横贯顶部并把正文往下挤。
  // 外层 .cm-panels 改成绝对定位后就脱离了 panel 的高度计算，正文位置不受影响。
  ".cm-panels": {
    position: "absolute",
    top: "0",
    right: "0",
    zIndex: "12",
    width: "auto",
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "none",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    // 悬浮框不能贴死边缘，右上角留出和滚动条的间距。
    margin: "8px 12px 0 0",
    padding: "6px",
    maxWidth: "min(340px, calc(100vw - 32px))",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover, var(--background))",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
    fontFamily: "var(--font-sans, 'Geist Variable', sans-serif)",
    fontSize: "11px",
  },
  ".cm-panel.cm-search br": {
    // 官方模板用 <br> 换行分隔搜索行和替换行，flex 布局下它会占掉一整行宽度，
    // 正好当作强制换行用，但要去掉默认高度免得多出一条空隙。
    width: "100%",
    height: "0",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    fontFamily: "inherit",
    fontSize: "11px",
  },
  ".cm-panel.cm-search input[name='search'], .cm-panel.cm-search input[name='replace']": {
    width: "132px",
    height: "24px",
    padding: "0 6px",
    borderRadius: "5px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  },
  ".cm-panel.cm-search input[name='search']:focus, .cm-panel.cm-search input[name='replace']:focus": {
    borderColor: "var(--ring, rgba(37, 99, 235, 0.5))",
  },
  ".cm-panel.cm-search button:not([name='close'])": {
    height: "24px",
    padding: "0 8px",
    borderRadius: "5px",
    border: "1px solid var(--border)",
    backgroundColor: "transparent",
    backgroundImage: "none",
    color: "var(--foreground)",
    cursor: "pointer",
  },
  ".cm-panel.cm-search button:not([name='close']):hover": {
    backgroundColor: "var(--accent, rgba(148, 163, 184, 0.18))",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    color: "var(--muted-foreground)",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search [name='close']": {
    position: "static",
    // 关掉官方那个绝对定位的大号 ×，改成排在最后的小按钮，免得盖住输入框。
    order: "99",
    padding: "0 4px",
    border: "none",
    background: "transparent",
    color: "var(--muted-foreground)",
    fontSize: "14px",
    lineHeight: "1",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name='close']:hover": {
    color: "var(--foreground)",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(250, 204, 21, 0.32)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(249, 115, 22, 0.48)",
  },
});

const lightTheme = EditorView.theme(
  {
    "&": { color: "#0f172a" },
    ".cm-content": { caretColor: "#1d4ed8" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#1d4ed8" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(37, 99, 235, 0.18)",
    },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    "&": { color: "#f8fafc" },
    ".cm-content": { caretColor: "#93c5fd" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#93c5fd" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(96, 165, 250, 0.26)",
    },
  },
  { dark: true },
);

/**
 * 语法高亮。
 *
 * 这一层管的是 Lezer tag → 颜色，和 live-preview.ts 的 `.mk-cm-*` 类是互补关系：
 * 那边负责字号/字重/隐藏标记这类**排版**，这里只负责**着色**。
 * 分开的好处是深浅色只需要改这里，排版规则不受影响。
 */
const lightHighlight = HighlightStyle.define(
  [
    { tag: tags.heading1, color: "#0f172a" },
    { tag: tags.heading2, color: "#0f172a" },
    { tag: tags.heading3, color: "#1e293b" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#334155" },
    { tag: tags.strong, color: "#0f172a" },
    { tag: tags.emphasis, color: "#1e293b" },
    { tag: tags.strikethrough, color: "#64748b" },
    { tag: tags.link, color: "#1d4ed8" },
    { tag: tags.url, color: "#2563eb" },
    { tag: tags.monospace, color: lightSyntaxPalette.plain },
    { tag: tags.quote, color: "#475569" },
    { tag: tags.list, color: "#334155" },
    { tag: tags.contentSeparator, color: "#94a3b8" },
    { tag: tags.labelName, color: lightSyntaxPalette.keyword },
    // 以下几项和 Word 预览共用同一份调色板，同一段代码左右两栏必须同色。
    { tag: tags.comment, color: lightSyntaxPalette.comment },
    { tag: [tags.keyword, tags.modifier, tags.self, tags.null, tags.atom, tags.bool], color: lightSyntaxPalette.keyword },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: lightSyntaxPalette.string },
    { tag: [tags.number, tags.integer, tags.float], color: lightSyntaxPalette.number },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: lightSyntaxPalette.function },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: lightSyntaxPalette.operator },
    { tag: [tags.typeName, tags.className], color: lightSyntaxPalette.function },
    // processingInstruction 就是 `**` `#` `>` 这些标记本身。
    // 光标进入时它们会重新出现，颜色调淡以免抢走正文的视觉重心。
    { tag: tags.processingInstruction, color: "#94a3b8" },
  ],
  { themeType: "light" },
);

const darkHighlight = HighlightStyle.define(
  [
    { tag: tags.heading1, color: "#f8fafc" },
    { tag: tags.heading2, color: "#f8fafc" },
    { tag: tags.heading3, color: "#e2e8f0" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#cbd5e1" },
    { tag: tags.strong, color: "#f8fafc" },
    { tag: tags.emphasis, color: "#e2e8f0" },
    { tag: tags.strikethrough, color: "#94a3b8" },
    { tag: tags.link, color: "#93c5fd" },
    { tag: tags.url, color: "#7dd3fc" },
    { tag: tags.monospace, color: darkSyntaxPalette.plain },
    { tag: tags.quote, color: "#cbd5e1" },
    { tag: tags.list, color: "#e2e8f0" },
    { tag: tags.contentSeparator, color: "#64748b" },
    { tag: tags.labelName, color: darkSyntaxPalette.keyword },
    { tag: tags.comment, color: darkSyntaxPalette.comment },
    { tag: [tags.keyword, tags.modifier, tags.self, tags.null, tags.atom, tags.bool], color: darkSyntaxPalette.keyword },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: darkSyntaxPalette.string },
    { tag: [tags.number, tags.integer, tags.float], color: darkSyntaxPalette.number },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: darkSyntaxPalette.function },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: darkSyntaxPalette.operator },
    { tag: [tags.typeName, tags.className], color: darkSyntaxPalette.function },
    { tag: tags.processingInstruction, color: "#71717a" },
  ],
  { themeType: "dark" },
);

/** 供 Compartment 热替换：换主题只 reconfigure 这一份扩展，view 本身不重建。 */
export function markdownEditorTheme(isDark: boolean): Extension {
  return [
    sharedTheme,
    isDark ? darkTheme : lightTheme,
    syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
  ];
}
