import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export type RelaxedEmphasisRange = {
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

function isSingleAsterisk(source: string, index: number): boolean {
  return source[index] === "*"
    && source[index - 1] !== "*"
    && source[index + 1] !== "*";
}

/**
 * 查找中文或标点紧排时 CommonMark 遗漏的单星号斜体 `*内容*`。
 * 排除行内代码和转义星号，且两端内容非空。
 */
function collectRelaxedEmphasisRanges(source: string): RelaxedEmphasisRange[] {
  const codeRanges = inlineCodeRanges(source);
  const ranges: RelaxedEmphasisRange[] = [];
  let opener: number | undefined;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (!isSingleAsterisk(source, cursor)) continue;
    if (codeRanges.some((range) => cursor >= range.from && cursor < range.to)) continue;
    if (isEscaped(source, cursor)) continue;

    if (opener === undefined) {
      // 开头星号：后面紧随的内容不能是换行或空
      if (cursor + 1 < source.length && source[cursor + 1] !== "\n" && source[cursor + 1] !== "\r") {
        opener = cursor;
      }
    } else {
      const contentFrom = opener + 1;
      const contentTo = cursor;
      const content = source.slice(contentFrom, contentTo);
      if (content.trim()) {
        ranges.push({ from: opener, to: cursor + 1, contentFrom, contentTo });
        opener = undefined;
      } else {
        opener = cursor;
      }
    }
  }

  return ranges;
}

export function findRelaxedEmphasisRanges(source: string): RelaxedEmphasisRange[] {
  return collectRelaxedEmphasisRanges(source);
}

function expandedTextTokens(
  token: Token,
  TokenConstructor: new (type: string, tag: string, nesting: -1 | 0 | 1) => Token,
): Token[] {
  const ranges = collectRelaxedEmphasisRanges(token.content);
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

    const opening = new TokenConstructor("em_open", "em", 1);
    opening.markup = "*";
    opening.level = token.level;
    expanded.push(opening);

    addText(token.content.slice(range.contentFrom, range.contentTo), token.level + 1);

    const closing = new TokenConstructor("em_close", "em", -1);
    closing.markup = "*";
    closing.level = token.level;
    expanded.push(closing);
    cursor = range.to;
  }

  addText(token.content.slice(cursor), token.level);
  return expanded;
}

/** 为 markdown-it 补上单星号宽松斜体。 */
export function relaxedEmphasisPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "relaxed_emphasis", (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline" || !blockToken.children) continue;
      const expanded: Token[] = [];
      for (const token of blockToken.children) {
        if (token.type === "text") {
          expanded.push(...expandedTextTokens(token, state.Token));
        } else {
          expanded.push(token);
        }
      }
      blockToken.children = expanded;
    }
  });
}
