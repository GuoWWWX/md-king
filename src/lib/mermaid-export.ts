import { isTauriEnvironment } from "@/lib/tauri";
import { mermaidToPngDataUrl } from "@/lib/mermaid";
import { invoke } from "@tauri-apps/api/core";

/** 匹配 mermaid 围栏块。语言标记允许带空格与大小写差异。 */
const MERMAID_FENCE = /^([ \t]*)(```|~~~)[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)^\1?\2[ \t]*$/gim;

/**
 * 转换前把 Markdown 里的 mermaid 块换成图片引用。
 *
 * DOCX 不支持 SVG——Pandoc 遇到 SVG 会直接跳过那张图，所以图先在前端
 * 栅格化成 PNG、落到临时目录，再用普通的 `![](path)` 语法引用。
 * 导出用的图一律走浅色主题：文档最终是印在白纸上的。
 *
 * 任何一张图失败就保留它的原始代码块——宁可导出成一段代码，
 * 也不要让整篇文档因为一张图转不出来而失败。
 */
export async function inlineMermaidImages(markdown: string): Promise<{ markdown: string; failed: number }> {
  if (!markdown.includes("mermaid")) return { markdown, failed: 0 };
  if (!isTauriEnvironment()) return { markdown, failed: 0 };

  const blocks = [...markdown.matchAll(MERMAID_FENCE)];
  if (blocks.length === 0) return { markdown, failed: 0 };

  let output = "";
  let cursor = 0;
  let failed = 0;

  for (const block of blocks) {
    const start = block.index ?? 0;
    const source = block[3];
    output += markdown.slice(cursor, start);

    try {
      const dataUrl = await mermaidToPngDataUrl(source, false);
      const path = await invoke<string>("write_temp_image", { dataBase64: dataUrl, extension: "png" });
      // 图片路径原样写进 Markdown。Pandoc 在 Windows 上认反斜杠路径，
      // 但空格和中括号要转义，否则会被当成链接语法的一部分。
      output += `![图表](${encodeMarkdownPath(path)})`;
    } catch {
      failed += 1;
      output += block[0];
    }

    cursor = start + block[0].length;
  }

  output += markdown.slice(cursor);
  return { markdown: output, failed };
}

/** 图片路径里的空格和括号要转义，否则会截断 Markdown 的链接语法。 */
function encodeMarkdownPath(path: string) {
  return path.replace(/([ ()[\]])/g, "\\$1");
}
