/**
 * 代码高亮的共享调色板。
 *
 * 编辑器（CodeMirror）和 Word 预览是两套完全独立的渲染管线——前者靠 Lezer 的
 * 语法树打 tag，后者是一段手写的正则 tokenizer。两边各自写死颜色的话，
 * 同一段代码在左右两栏会长得不一样，而这个应用的卖点恰恰是「左边写、右边看
 * 最终效果」。颜色值收在这里，两边都从这里取。
 */
export type SyntaxPalette = {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  operator: string;
  plain: string;
};

export const lightSyntaxPalette: SyntaxPalette = {
  keyword: "#7C3AED",
  string: "#15803D",
  comment: "#64748B",
  number: "#B45309",
  function: "#0369A1",
  operator: "#BE185D",
  plain: "#111827",
};

export const darkSyntaxPalette: SyntaxPalette = {
  keyword: "#C084FC",
  string: "#86EFAC",
  comment: "#94A3B8",
  number: "#FBBF24",
  function: "#67E8F9",
  operator: "#F9A8D4",
  plain: "#E2E8F0",
};

export function syntaxPaletteFor(dark: boolean): SyntaxPalette {
  return dark ? darkSyntaxPalette : lightSyntaxPalette;
}
