import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export type RelaxedStrongRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
};

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function backtickRunLength(source: string, index: number): number {
  let length = 0;
  while (source[index + length] === "`") length += 1;
  return length;
}

function inlineCodeRanges(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] !== "`" || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const markerLength = backtickRunLength(source, cursor);
    let closing = cursor + markerLength;
    let matched = false;
    while (closing < source.length) {
      closing = source.indexOf("`", closing);
      if (closing < 0) break;
      const closingLength = backtickRunLength(source, closing);
      if (closingLength === markerLength) {
        ranges.push({ from: cursor, to: closing + closingLength });
        cursor = closing + closingLength;
        matched = true;
        break;
      }
      closing += closingLength;
    }

    if (!matched) cursor += markerLength;
  }

  return ranges;
}

function isExactDoubleAsterisk(source: string, index: number): boolean {
  return source[index] === "*"
    && source[index + 1] === "*"
    && source[index - 1] !== "*"
    && source[index + 2] !== "*";
}

/**
 * 查找标准 CommonMark 可能漏掉、但用户直觉上仍应视为加粗的 `**内容**`。
 * 这里只处理单行文本；转义标记、行内代码和三/四星嵌套仍交给标准解析器。
 */
function collectRelaxedStrongRanges(source: string, ignoreFirstMarker: boolean): RelaxedStrongRange[] {
  const codeRanges = inlineCodeRanges(source);
  const ranges: RelaxedStrongRange[] = [];
  let opener: number | undefined;
  let ignoreNextMarker = ignoreFirstMarker;

  for (let cursor = 0; cursor < source.length - 1; cursor += 1) {
    if (!isExactDoubleAsterisk(source, cursor)) continue;
    if (codeRanges.some((range) => cursor >= range.from && cursor < range.to)) {
      cursor += 1;
      continue;
    }
    if (isEscaped(source, cursor)) {
      if (opener === undefined) ignoreNextMarker = true;
      cursor += 1;
      continue;
    }
    if (ignoreNextMarker) {
      ignoreNextMarker = false;
      cursor += 1;
      continue;
    }

    if (opener === undefined) {
      opener = cursor;
    } else {
      const contentFrom = opener + 2;
      const contentTo = cursor;
      if (source.slice(contentFrom, contentTo).trim()) {
        ranges.push({ from: opener, to: cursor + 2, contentFrom, contentTo });
        opener = undefined;
      } else {
        opener = cursor;
      }
    }
    cursor += 1;
  }

  return ranges;
}

export function findRelaxedStrongRanges(source: string): RelaxedStrongRange[] {
  return collectRelaxedStrongRanges(source, false);
}

function expandedTextTokens(
  token: Token,
  TokenConstructor: new (type: string, tag: string, nesting: -1 | 0 | 1) => Token,
  ignoreFirstMarker: boolean,
): Token[] {
  const ranges = collectRelaxedStrongRanges(token.content, ignoreFirstMarker);
  if (ranges.length === 0) return [token];

  const expanded: Token[] = [];
  let cursor = 0;
  const addText = (content: string, level: number) => {
    if (!content) return;
    const text = new TokenConstructor("text", "", 0);
    text.content = content;
    text.level = level;
    expanded.push(text);
  };

  for (const range of ranges) {
    addText(token.content.slice(cursor, range.from), token.level);

    const opening = new TokenConstructor("strong_open", "strong", 1);
    opening.markup = "**";
    opening.level = token.level;
    expanded.push(opening);

    addText(token.content.slice(range.contentFrom, range.contentTo), token.level + 1);

    const closing = new TokenConstructor("strong_close", "strong", -1);
    closing.markup = "**";
    closing.level = token.level;
    expanded.push(closing);
    cursor = range.to;
  }

  addText(token.content.slice(cursor), token.level);
  return expanded;
}

/** 为 markdown-it 补上宽松的双星号加粗，且只拆分标准解析器遗留的纯文本 token。 */
export function relaxedStrongPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "relaxed_strong", (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline" || !blockToken.children) continue;
      const expanded: Token[] = [];
      let escapedDoublePrefix = false;
      for (const token of blockToken.children) {
        if (token.type === "text") {
          expanded.push(...expandedTextTokens(token, state.Token, escapedDoublePrefix));
          escapedDoublePrefix = false;
        } else {
          expanded.push(token);
          escapedDoublePrefix = token.type === "text_special" && token.markup === "\\*" && token.content === "*";
        }
      }
      blockToken.children = expanded;
    }
  });
}
