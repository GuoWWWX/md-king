import type MarkdownIt from "markdown-it";
import { parseObsidianWikilink } from "./document-links.ts";

/** 为 markdown-it 补上 Obsidian 的 `[[目标|显示名]]` 行内链接语法。 */
export function obsidianWikilinkPlugin(markdown: MarkdownIt) {
  markdown.inline.ruler.before("link", "obsidian_wikilink", (state, silent) => {
    const from = state.pos;
    if (state.src.slice(from, from + 2) !== "[[" || state.src[from - 1] === "!") return false;
    const close = state.src.indexOf("]]", from + 2);
    if (close < 0) return false;

    const source = state.src.slice(from, close + 2);
    const link = parseObsidianWikilink(source);
    if (!link) return false;

    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [["href", link.target]];
      // Word 预览和导出需要区分双链与普通 Markdown 链接：双链在成品里
      // 显示真实地址，而编辑器仍可使用显示名。
      open.meta = { mkWikilinkTarget: link.target };
      const text = state.push("text", "", 0);
      text.content = link.label;
      state.push("link_close", "a", -1);
    }
    state.pos = close + 2;
    return true;
  });
}
