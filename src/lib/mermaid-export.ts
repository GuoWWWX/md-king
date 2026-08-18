import { isTauriEnvironment } from "@/lib/tauri";
import { mermaidToPngDataUrl } from "@/lib/mermaid";
import { replaceMermaidFencesWithImages } from "@/lib/mermaid-export-markdown";
import { invoke } from "@tauri-apps/api/core";

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
export async function inlineMermaidImages(markdown: string): Promise<{ markdown: string; failed: number; errors: string[] }> {
  if (!/mermaid/i.test(markdown)) return { markdown, failed: 0, errors: [] };
  if (!isTauriEnvironment()) return { markdown, failed: 0, errors: [] };

  return replaceMermaidFencesWithImages(markdown, async (source) => {
    const dataUrl = await mermaidToPngDataUrl(source, false);
    return invoke<string>("write_temp_image", { dataBase64: dataUrl, extension: "png" });
  });
}
