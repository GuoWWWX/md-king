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
    fontSize: "15px",
  },
  "&.cm-focused": {
    // CM 默认的蓝色 outline 和本项目的 focus-visible ring 风格冲突，统一去掉。
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-sans, 'Geist Variable', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif)",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": {
    width: "100%",
    minWidth: "0",
    padding: "20px 24px 40vh 24px",
    caretColor: "var(--primary)",
    fontVariantEmoji: "emoji",
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
    position: "absolute !important",
    top: "8px !important",
    right: "12px !important",
    left: "auto !important",
    zIndex: "12",
    width: "min(560px, calc(100% - 24px)) !important",
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "none",
  },
  ".cm-panel.cm-search": {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "4px",
    margin: "0",
    padding: "5px",
    width: "100% !important",
    maxWidth: "100%",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover, var(--background))",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
    fontFamily: "var(--font-sans, 'Geist Variable', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif)",
    fontSize: "11px",
  },
  ".cm-panel.cm-search [data-mk-search-find-row], .cm-panel.cm-search [data-mk-search-replace-row]": {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) 72px repeat(3, 28px)",
    alignItems: "center",
    gap: "4px",
    minWidth: "0",
  },
  // Ctrl+F 默认只显示查找；Ctrl+R 再展开替换行。没有标记的面板也按查找处理，
  // 这样其他搜索命令意外唤起面板时不会露出替换控件。
  ".cm-panel.cm-search:not([data-search-mode='replace']) [data-mk-search-replace-row]": {
    display: "none",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-panel.cm-search [data-mk-search-find-field], .cm-panel.cm-search [data-mk-search-replace-field]": {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    gridColumn: "2",
    height: "30px",
    width: "100%",
    minWidth: "0",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--card)",
  },
  ".cm-panel.cm-search [data-mk-search-find-field]": {
    padding: "0 3px 0 8px",
  },
  ".cm-panel.cm-search [data-mk-search-replace-field]": {
    padding: "0 8px",
  },
  ".cm-panel.cm-search [data-mk-search-find-field]:focus-within, .cm-panel.cm-search [data-mk-search-replace-field]:focus-within": {
    borderColor: "var(--ring, rgba(37, 99, 235, 0.5))",
    boxShadow: "0 0 0 1px color-mix(in srgb, var(--ring, #3b82f6) 48%, transparent)",
  },
  ".cm-panel.cm-search [data-mk-search-find-field] input[name='search'], .cm-panel.cm-search [data-mk-search-replace-field] input[name='replace']": {
    width: "100%",
    minWidth: "0",
    height: "28px",
    padding: "0 7px",
    border: "none !important",
    borderRadius: "0",
    backgroundColor: "transparent !important",
    color: "var(--foreground)",
    outline: "none",
  },
  ".cm-panel.cm-search button:not([name='close'])": {
    height: "28px",
    padding: "0 8px",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    backgroundColor: "transparent",
    backgroundImage: "none",
    color: "var(--foreground)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search button:not([name='close']):hover": {
    backgroundColor: "var(--app-control-hover)",
  },
  ".cm-panel.cm-search [data-mk-search-option]": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 24px",
    width: "24px",
    height: "24px",
    padding: "0",
    borderRadius: "3px",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-panel.cm-search [data-mk-search-option] input": {
    position: "absolute",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  },
  ".cm-panel.cm-search [data-mk-search-option-text]": {
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "1",
  },
  ".cm-panel.cm-search [data-mk-search-option]:hover": {
    backgroundColor: "var(--app-control-hover)",
  },
  ".cm-panel.cm-search [data-mk-search-option]:has(input:checked)": {
    backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
    color: "var(--primary)",
  },
  ".cm-panel.cm-search [name='close']": {
    gridColumn: "6",
    position: "static",
    inset: "auto",
    width: "28px",
    height: "28px",
    display: "inline-grid",
    placeItems: "center",
    margin: "0",
    padding: "0",
    border: "none",
    background: "transparent",
    color: "var(--muted-foreground)",
    fontSize: "16px",
    lineHeight: "1",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name='close']:hover": {
    color: "var(--foreground)",
  },
  ".cm-panel.cm-search button[data-mk-search-replace-toggle]": {
    gridColumn: "1",
    width: "30px",
    minWidth: "30px",
    height: "30px",
    padding: "0",
    display: "inline-grid",
    placeItems: "center",
    borderRadius: "4px",
    color: "var(--muted-foreground)",
  },
  ".cm-panel.cm-search button[data-mk-search-replace-toggle] svg": {
    display: "block",
  },
  ".cm-panel.cm-search button[data-mk-search-replace-toggle]:hover": {
    color: "var(--foreground)",
  },
  ".cm-panel.cm-search [data-mk-search-field-icon]": {
    display: "inline-flex",
    flex: "0 0 auto",
    color: "var(--muted-foreground)",
  },
  ".cm-panel.cm-search button[data-mk-search-icon-button]": {
    width: "28px",
    minWidth: "28px",
    padding: "0",
    display: "inline-grid",
    placeItems: "center",
    border: "none",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
  },
  ".cm-panel.cm-search button[data-mk-search-icon-button]:hover": {
    backgroundColor: "var(--app-control-hover)",
    color: "var(--foreground)",
  },
  ".cm-panel.cm-search button[data-mk-search-icon-button] svg": {
    display: "block",
  },
  ".cm-panel.cm-search [data-mk-search-result-count]": {
    gridColumn: "3",
    justifySelf: "end",
    paddingRight: "6px",
    color: "var(--muted-foreground)",
    fontSize: "11px",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search button[name='prev']": {
    gridColumn: "4",
  },
  ".cm-panel.cm-search button[name='next']": {
    gridColumn: "5",
  },
  ".cm-panel.cm-search [data-mk-search-replace-indent]": {
    gridColumn: "1",
    width: "30px",
  },
  ".cm-panel.cm-search button[name='replace']": {
    gridColumn: "3",
  },
  ".cm-panel.cm-search button[name='replaceAll']": {
    gridColumn: "4 / span 3",
  },
  ".cm-panel.cm-search button:disabled": {
    color: "var(--muted-foreground)",
    cursor: "default",
    opacity: "0.48",
  },
  ".cm-panel.cm-search button:disabled:hover": {
    backgroundColor: "transparent",
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
