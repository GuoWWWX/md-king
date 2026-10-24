import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { formattingSpanAt } from "../../../lib/markdown-formatting.ts";

// Attribute spans are text formatting, not shortcut reference links.
export const markdownFormattingSyntax: MarkdownConfig = {
  defineNodes: ["TextFormat", { name: "TextFormatMark", style: tags.processingInstruction }],
  parseInline: [{
    name: "TextFormat",
    before: "Link",
    parse(cx, next, pos) {
      if (next !== 91) return -1;
      const range = formattingSpanAt(cx.text, pos - cx.offset);
      if (!range) return -1;
      const start = cx.offset + range.contentFrom, end = cx.offset + range.contentTo;
      return cx.addElement(cx.elt("TextFormat", pos, cx.offset + range.to, [
        cx.elt("TextFormatMark", pos, start),
        ...cx.parser.parseInline(cx.slice(start, end), start),
        cx.elt("TextFormatMark", end, cx.offset + range.to),
      ]));
    },
  }],
};
