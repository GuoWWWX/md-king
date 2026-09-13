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

function closingDollar(source: string, from: number): number {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] !== "$" || escapedAt(source, index)) continue;
    if (source[index - 1] === "$" || source[index + 1] === "$") continue;
    return index;
  }
  return -1;
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
      const close = closingDollar(source, index + 1);
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

    // Pandoc/Obsidian 文档里常见缩进后的单行显示公式：`  $$...$$`。
    // 它不是行内 `$...$`，但也不满足独占行分隔符的多行形式；单独识别后交给
    // 块公式渲染，避免四空格或列表缩进让公式原样显示。
    const trimmed = line.text.trim();
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      const contentFrom = line.from + line.text.indexOf("$$") + 2;
      const contentTo = line.from + line.text.lastIndexOf("$$");
      if (contentTo > contentFrom) {
        ranges.push({ from: line.from, to: line.to, contentFrom, contentTo, display: true });
        continue;
      }
    }

    const delimiter = displayDelimiter(line.text);
    if (!delimiter) continue;
    for (let closeIndex = index + 1; closeIndex < lines.length; closeIndex += 1) {
      const closingLine = lines[closeIndex];
      if (!closesDisplayDelimiter(closingLine.text, delimiter)) continue;
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
