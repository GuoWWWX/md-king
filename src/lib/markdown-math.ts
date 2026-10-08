export type MarkdownMathRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  display: boolean;
};

type SourceLine = {
  from: number;
  to: number;
  next: number;
  text: string;
};

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from <= source.length) {
    let to = from;
    while (to < source.length && source[to] !== "\n" && source[to] !== "\r") to += 1;
    let next = to;
    if (source[next] === "\r") next += 1;
    if (source[next] === "\n") next += 1;
    lines.push({ from, to, next, text: source.slice(from, to) });
    if (next >= source.length) break;
    from = next;
  }
  return lines;
}

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function backtickRun(source: string, index: number): number {
  let length = 0;
  while (source[index + length] === "`") length += 1;
  return length;
}

function closingBackticks(source: string, from: number, length: number): number {
  const marker = "`".repeat(length);
  for (let index = from; index < source.length;) {
    const found = source.indexOf(marker, index);
    if (found < 0) return -1;
    if (backtickRun(source, found) === length) return found;
    index = found + length;
  }
  return -1;
}

function closingDollar(source: string, from: number, openingFollowedByDigit: boolean): number {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] !== "$" || escapedAt(source, index)) continue;
    if (source[index - 1] === "$" || source[index + 1] === "$") continue;
    // 闭合 $ 紧前面的字符不能是空白字符
    if (/[\s\r\n]/.test(source[index - 1])) continue;
    // 如果起始紧随数字，闭合 $ 后面紧跟数字（如 "$5 and $10" 中的 "$10"），不能作为闭合
    if (openingFollowedByDigit && index + 1 < source.length && /\d/.test(source[index + 1])) continue;
    return index;
  }
  return -1;
}

/** 剥离行首的引用前缀 `> `，返回去除后的文本与前缀字符长度。 */
export function stripMarkdownQuotePrefix(text: string): { prefixLength: number; text: string } {
  const match = text.match(/^[ \t]*(?:>[ \t]?)+/);
  return match
    ? { prefixLength: match[0].length, text: text.slice(match[0].length) }
    : { prefixLength: 0, text };
}

/** 查找单行中的 `$...$` 与 `\(...\)`，位置相对于传入字符串。 */
export function findInlineMarkdownMath(source: string): MarkdownMathRange[] {
  const ranges: MarkdownMathRange[] = [];

  for (let index = 0; index < source.length;) {
    if (source[index] === "`") {
      const run = backtickRun(source, index);
      const close = closingBackticks(source, index + run, run);
      index = close < 0 ? source.length : close + run;
      continue;
    }

    if (source[index] === "$" && !escapedAt(source, index)) {
      // `$$` 由块级公式处理；不能把它拆成两个空的行内公式。
      if (source[index - 1] === "$" || source[index + 1] === "$") {
        index += 1;
        continue;
      }
      // 起始 $ 紧后面的字符不能是空白字符
      if (index + 1 >= source.length || /[\s\r\n]/.test(source[index + 1])) {
        index += 1;
        continue;
      }
      const openingFollowedByDigit = /\d/.test(source[index + 1]);
      const close = closingDollar(source, index + 1, openingFollowedByDigit);
      if (close > index + 1) {
        ranges.push({
          from: index,
          to: close + 1,
          contentFrom: index + 1,
          contentTo: close,
          display: false,
        });
        index = close + 1;
        continue;
      }
    }

    if (source[index] === "\\" && source[index + 1] === "(" && !escapedAt(source, index)) {
      let found = false;
      for (let close = index + 2; close < source.length - 1; close += 1) {
        if (source[close] !== "\\" || source[close + 1] !== ")" || escapedAt(source, close)) continue;
        if (close > index + 2) {
          ranges.push({
            from: index,
            to: close + 2,
            contentFrom: index + 2,
            contentTo: close,
            display: false,
          });
        }
        index = close + 2;
        found = true;
        break;
      }
      if (found) continue;
    }

    index += 1;
  }

  return ranges;
}

type Fence = { marker: "`" | "~"; length: number };

function fenceStart(line: string): Fence | undefined {
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  return { marker: match[1][0] as "`" | "~", length: match[1].length };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = line.match(/^[ \t]{0,3}(`+|~+)/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

type DisplayDelimiter = "$$" | "\\[";

function displayDelimiter(line: string): DisplayDelimiter | undefined {
  const trimmed = line.trim();
  return trimmed === "$$" || trimmed === "\\[" ? trimmed : undefined;
}

function closesDisplayDelimiter(line: string, delimiter: DisplayDelimiter): boolean {
  return line.trim() === (delimiter === "$$" ? "$$" : "\\]");
}

/** 查找独占行的 `$$...$$` 与 `\[...\]`，并忽略围栏代码块。 */
export function findBlockMarkdownMath(source: string): MarkdownMathRange[] {
  const lines = sourceLines(source);
  const ranges: MarkdownMathRange[] = [];
  let fence: Fence | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line.text, fence)) fence = undefined;
      continue;
    }
    const openingFence = fenceStart(line.text);
    if (openingFence) {
      fence = openingFence;
      continue;
    }

    // Pandoc/Obsidian 文档里常见缩进或引用块后的单行显示公式：`  $$...$$` 或 `> $$...$$`。
    // 它不是行内 `$...$`，但也不满足独占行分隔符的多行形式；单独识别后交给
    // 块公式渲染，避免四空格或列表缩进让公式原样显示。
    const { prefixLength, text: strippedText } = stripMarkdownQuotePrefix(line.text);
    const trimmed = strippedText.trim();
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      const firstDollar = strippedText.indexOf("$$");
      const lastDollar = strippedText.lastIndexOf("$$");
      const contentFrom = line.from + prefixLength + firstDollar + 2;
      const contentTo = line.from + prefixLength + lastDollar;
      if (contentTo > contentFrom) {
        ranges.push({ from: line.from, to: line.to, contentFrom, contentTo, display: true });
        continue;
      }
    }

    const delimiter = displayDelimiter(strippedText);
    if (!delimiter) continue;
    for (let closeIndex = index + 1; closeIndex < lines.length; closeIndex += 1) {
      const closingLine = lines[closeIndex];
      const { text: strippedClosing } = stripMarkdownQuotePrefix(closingLine.text);
      if (!closesDisplayDelimiter(strippedClosing, delimiter)) continue;
      if (closingLine.from > line.next) {
        ranges.push({
          from: line.from,
          to: closingLine.to,
          contentFrom: line.next,
          contentTo: closingLine.from,
          display: true,
        });
      }
      index = closeIndex;
      break;
    }
  }

  return ranges;
}

/**
 * 智能纠错与规范化 LaTeX 数学公式源码。
 *
 * 典型问题：用户在 \text{...} 文本模式下习惯性输入了 \mu、\Omega 等数学模式宏命令
 * （例如 `\approx 50 \sim 100 \text{ \mu s}`），因为 \mu 在纯文本模式下未定义，KaTeX 会抛出
 * `Undefined control sequence: \mu` 并标红报错。
 *
 * 本函数自动将非法的 `\text{ \mu s }` 转换为合法的 `\mu\text{s}` 或 `\mu`，
 * 避免用户在书写物理单位、希腊字母时被红色报错打断。
 */
export function normalizeMathSource(source: string): string {
  if (!source) return source;
  return source.replace(
    /\\text\{\s*\\(mu|Omega|Delta|alpha|beta|gamma|delta|sigma|pi|lambda|theta)\s*([a-zA-Z]*)\s*\}/g,
    (_match, symbol, unit) => (unit ? `\\${symbol}\\text{${unit}}` : `\\${symbol}`),
  );
}
