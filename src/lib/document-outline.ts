import { parseUnnumberedHeadingText } from "./markdown-heading-attributes.ts";

export type MarkdownOutlineItem = {
  level: number;
  text: string;
  line: number;
};

export type MarkdownOutlineNode = MarkdownOutlineItem & {
  children: MarkdownOutlineNode[];
};

export type MarkdownOutlineRevealTarget = {
  tabId: string;
  line: number;
  /** 全局正文搜索命中的 UTF-16 列范围；目录跳转不传。 */
  matchStart?: number;
  matchEnd?: number;
};

export const markdownOutlineRevealEvent = "md-king:reveal-markdown-heading";
export const markdownVisibleLineChangeEvent = "md-king:visible-line-change";
export const markdownVisibleLineQueryEvent = "md-king:visible-line-query";

export type MarkdownVisibleLineChangeDetail = {
  tabId: string;
  line: number;
};

/**
 * 根据视口当前首行（1-based），在已解析的大纲中匹配当前读者正在阅读的章节行号。
 * 若视口在首个标题之前，返回首个标题；否则返回最后一个行号 <= currentLine 的标题。
 */
export function findActiveOutlineLine(outline: MarkdownOutlineItem[], currentLine: number): number | undefined {
  if (outline.length === 0) return undefined;
  if (currentLine <= outline[0].line) return outline[0].line;

  let activeLine = outline[0].line;
  for (const item of outline) {
    if (item.line <= currentLine) {
      activeLine = item.line;
    } else {
      break;
    }
  }
  return activeLine;
}

/// 只识别正文中的 ATX 标题，围栏代码块内的 # 不应出现在目录中。
export function parseMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const outline: MarkdownOutlineItem[] = [];
  let fenceMarker: "`" | "~" | undefined;

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      if (!fenceMarker) fenceMarker = marker;
      else if (fenceMarker === marker) fenceMarker = undefined;
      continue;
    }
    if (fenceMarker) continue;

    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*\s*$/);
    if (!heading) continue;
    const text = parseUnnumberedHeadingText(heading[2]).text;
    if (text) outline.push({ level: heading[1].length, text, line: index + 1 });
  }

  return outline;
}

/// 收集所有「有子标题」的行号，供顶部的一键折叠/展开使用。
/// 叶子节点没有折叠态，放进集合只会让「是否已全部折叠」永远判不成立。
export function collectOutlineParentLines(items: MarkdownOutlineItem[]): number[] {
  const lines: number[] = [];

  const walk = (nodes: MarkdownOutlineNode[]) => {
    for (const node of nodes) {
      if (!node.children.length) continue;
      lines.push(node.line);
      walk(node.children);
    }
  };

  walk(buildMarkdownOutlineTree(items));
  return lines;
}

/// 把扁平标题列表折成树：层级跳跃（H1 直接跟 H3）时按栈里最近的更浅标题挂载，
/// 不补虚拟节点，保证渲染出的缩进和原文标题顺序一致。
export function buildMarkdownOutlineTree(items: MarkdownOutlineItem[]): MarkdownOutlineNode[] {
  const roots: MarkdownOutlineNode[] = [];
  const stack: MarkdownOutlineNode[] = [];

  for (const item of items) {
    const node: MarkdownOutlineNode = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}
