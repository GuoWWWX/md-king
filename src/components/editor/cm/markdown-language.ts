import { markdownLanguage } from "@codemirror/lang-markdown";
import { Language } from "@codemirror/language";
import type { MarkdownParser } from "@lezer/markdown";
import { styleTags } from "@lezer/highlight";
import { markdownFormattingSyntax } from "./markdown-formatting.ts";

const baseParser = markdownLanguage.parser as MarkdownParser;

// Tab 会真实写入四个空格。标准 Markdown 会把顶层四空格解释成缩进代码块，
// 这会让标题、链接、引用等在实时预览里全部退化成源码。编辑器只支持围栏代码块，
// 因而在编辑解析层关闭缩进代码块，让四空格继续作为内容缩进参与原有语法解析。
// 常用 HTML 由实时预览层按安全标签集合渲染，未匹配的尖括号文本仍然保留。
export const livePreviewMarkdownLanguage = new Language(
  markdownLanguage.data,
  baseParser.configure([
    {
      remove: ["IndentedCode", "HTMLBlock", "HTMLTag"],
      // Lezer emits bracket nodes even for undefined references. Only the
      // validated live-preview decorations should give those brackets a color.
      props: [styleTags({ "LinkMark LinkLabel": [] })],
      // Autolinks share Lezer's HTMLTag parser; retain only actual autolinks
      // while unsupported angle-bracket text remains ordinary Markdown.
      parseInline: [{
        name: "StandardAutolink",
        before: "Link",
        parse(cx, next, pos) {
          if (next !== 60) return -1;
          const end = cx.text.indexOf(">", pos - cx.offset + 1);
          if (end < 0) return -1;
          const to = cx.offset + end + 1;
          const element = baseParser.parseInline(cx.slice(pos, to), pos)[0];
          return element?.to === to && baseParser.nodeSet.types[element.type].name === "Autolink"
            ? cx.addElement(element) : -1;
        },
      }],
    },
    markdownFormattingSyntax,
  ]),
  [],
  "markdown",
);
