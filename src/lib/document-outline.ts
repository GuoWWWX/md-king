export type MarkdownOutlineItem = {
  level: number;
  text: string;
  line: number;
};

export type MarkdownOutlineRevealTarget = {
  tabId: string;
  line: number;
};

export const markdownOutlineRevealEvent = "md-king:reveal-markdown-heading";

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
    const text = heading[2].trim();
    if (text) outline.push({ level: heading[1].length, text, line: index + 1 });
  }

  return outline;
}
