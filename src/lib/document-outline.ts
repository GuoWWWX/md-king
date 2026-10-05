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
  /** 滚动对齐位置：全局搜索默认为 center，大纲目录跳转默认为 start */
  y?: "start" | "center";
  yMargin?: number;
};

export const markdownOutlineRevealEvent = "md-king:reveal-markdown-heading";
export const markdownVisibleLineChangeEvent = "md-king:visible-line-change";
export const markdownVisibleLineQueryEvent = "md-king:visible-line-query";

export type MarkdownVisibleLineChangeDetail = {
  tabId: string;
  line: number;
  activeHeadingLine?: number;
};

export type HeadingViewportPosition = {
  line: number;
  top: number;
  bottom: number;
};

/**
 * 根据大纲各标题相对于编辑器视口顶部的物理像素坐标（top / bottom），
 * 精准判定当前读者正在注视与阅读的章节标题行号。
 *
 * 核心设计（第一性原理与 KISS 原则）：
 * 1. 到达底部保护：当滚动到文档最底部时，激活最后一个标题；
 * 2. 黄金阅读视线判定（Primary Focus Line）：位于视口顶部偏下区域（72px ~ 140px，随视口自适应）；
 *    在所有已经到达或越过视线判定线（top <= focusLine）的标题中，取物理位置最靠下的标题（即用户当前正文所属的最新章节）；
 * 3. 彻底免疫空行与组件高度塌陷：直接以标题真实 DOM 渲染位置为几何基准，
 *    解决标题上方空行或水平线导致单点行号采样跳回上一章的顽疾；
 * 4. 到达文首保护：若视口尚在首个标题之前，激活首个标题。
 */
export function computeActiveHeadingLine(
  headings: HeadingViewportPosition[],
  options: {
    clientHeight: number;
    isAtBottom?: boolean;
    readingOffset?: number;
  },
): number | undefined {
  if (headings.length === 0) return undefined;
  if (options.isAtBottom) {
    return headings[headings.length - 1].line;
  }

  // 黄金视线判定线：位于阅读视口顶部偏下区域（48px ~ 80px，约 2~3 行正文高度，随视口自适应）
  const focusLine = options.readingOffset ?? Math.min(80, Math.max(48, options.clientHeight * 0.1));

  // 寻找物理位置已经越过或到达视线判定线（top <= focusLine）的最后一个标题
  let activeHeading = headings[0];
  for (const heading of headings) {
    if (heading.top <= focusLine) {
      activeHeading = heading;
    } else {
      break;
    }
  }

  return activeHeading.line;
}

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

/**
 * 根据读者当前视口首行实质内容行号（readingLine），结合大纲目录精准解析所属章节。
 * 遵循第一性原理：视口第一行露出的正文、表格、图表、代码块所属的章节，即为大纲中最后一个行号 <= readingLine 的标题。
 */
export function resolveActiveHeadingFromReadingLine(
  outline: MarkdownOutlineItem[],
  readingLine: number,
  options?: { isAtBottom?: boolean },
): number | undefined {
  if (outline.length === 0) return undefined;
  if (options?.isAtBottom) {
    return outline[outline.length - 1].line;
  }
  return findActiveOutlineLine(outline, readingLine);
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

/**
 * 查找指定标题行号在 Markdown 大纲树中的所有祖先标题行号（自顶向下返回）。
 * 用于高亮深层子标题时，自动展开其折叠的父节点，确保当前章节必定在目录中清晰可见。
 */
export function findOutlineAncestors(items: MarkdownOutlineItem[], targetLine: number): number[] {
  const ancestors: number[] = [];
  const tree = buildMarkdownOutlineTree(items);

  function search(nodes: MarkdownOutlineNode[], currentPath: number[]): boolean {
    for (const node of nodes) {
      if (node.line === targetLine) {
        ancestors.push(...currentPath);
        return true;
      }
      if (node.children.length > 0) {
        if (search(node.children, [...currentPath, node.line])) {
          return true;
        }
      }
    }
    return false;
  }

  search(tree, []);
  return ancestors;
}

