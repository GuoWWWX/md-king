import { markdownLanguage } from "@codemirror/lang-markdown";
import { Language } from "@codemirror/language";
import type { MarkdownParser } from "@lezer/markdown";

// Tab 会真实写入四个空格。标准 Markdown 会把顶层四空格解释成缩进代码块，
// 这会让标题、链接、引用等在实时预览里全部退化成源码。编辑器只支持围栏代码块，
// 因而在编辑解析层关闭缩进代码块，让四空格继续作为内容缩进参与原有语法解析。
// Word 预览的 MarkdownIt 使用 `html: false`，所以 `<示例文本>` 必须作为文本
// 保留。同步关掉 Lezer 的 HTML 解析，避免编辑器吞掉 Callout 答案中的尖括号内容。
export const livePreviewMarkdownLanguage = new Language(
  markdownLanguage.data,
  (markdownLanguage.parser as MarkdownParser).configure({ remove: ["IndentedCode", "HTMLBlock", "HTMLTag"] }),
  [],
  "markdown",
);
