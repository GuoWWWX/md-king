import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
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
    padding: "20px 24px 40vh 24px",
    caretColor: "var(--primary)",
  },
  // 底部留白给到 40vh：写到文档末尾时最后一行仍能滚到屏幕中部，长文写作的基本手感。
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
    borderLeftWidth: "2px",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
  ".cm-selectionBackground": {
    borderRadius: "2px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
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
    { tag: tags.monospace, color: "#b91c1c" },
    { tag: tags.quote, color: "#475569" },
    { tag: tags.list, color: "#334155" },
    { tag: tags.contentSeparator, color: "#94a3b8" },
    { tag: tags.labelName, color: "#7c3aed" },
    { tag: tags.comment, color: "#94a3b8" },
    { tag: tags.keyword, color: "#7c3aed" },
    { tag: tags.string, color: "#047857" },
    { tag: tags.number, color: "#b45309" },
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
    { tag: tags.monospace, color: "#fca5a5" },
    { tag: tags.quote, color: "#cbd5e1" },
    { tag: tags.list, color: "#e2e8f0" },
    { tag: tags.contentSeparator, color: "#64748b" },
    { tag: tags.labelName, color: "#c4b5fd" },
    { tag: tags.comment, color: "#71717a" },
    { tag: tags.keyword, color: "#c4b5fd" },
    { tag: tags.string, color: "#6ee7b7" },
    { tag: tags.number, color: "#fcd34d" },
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
