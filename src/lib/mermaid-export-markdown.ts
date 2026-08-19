/** 匹配 Mermaid 围栏块。语言标记允许带空格与大小写差异。 */
const MERMAID_FENCE = /^([ \t]*)(```|~~~)[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)^\1?\2[ \t]*$/gim;

export type MermaidImageReplacementResult = { markdown: string; failed: number; errors: string[] };

/** 让出一次浏览器事件循环，避免连续栅格化多张图时界面长时间无响应。 */
function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function replaceMermaidFencesWithImages(markdown: string, writeImage: (source: string) => Promise<string>): Promise<MermaidImageReplacementResult> {
  const blocks = [...markdown.matchAll(MERMAID_FENCE)];
  if (blocks.length === 0) return { markdown, failed: 0, errors: [] };

  let output = "";
  let cursor = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const block of blocks) {
    const start = block.index ?? 0;
    const source = block[3];
    output += markdown.slice(cursor, start);

    try {
      await yieldToBrowser();
      const path = await writeImage(source);
      output += `![图表](${encodeMarkdownPath(path)})`;
    } catch (cause) {
      failed += 1;
      errors.push(cause instanceof Error ? cause.message : "图表转图片失败");
      output += block[0];
    }

    cursor = start + block[0].length;
  }

  output += markdown.slice(cursor);
  return { markdown: output, failed, errors };
}

/** 图片路径里的空格和括号要转义，否则会截断 Markdown 的链接语法。 */
function encodeMarkdownPath(path: string) {
  return path.replace(/([ ()[\]])/g, "\\$1");
}
