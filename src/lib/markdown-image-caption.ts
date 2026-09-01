import { markdownCaptionText } from "./mermaid-fence.ts";

export type ImageCaptionExtraction = {
  markdown: string;
  captionsByImageIndex: Map<number, string>;
};

const imageCaptionStart = /^\s*:::\s*\{\s*custom-style\s*=\s*["']Image Caption["']\s*\}\s*$/i;
const fenceLine = /^\s*(`{3,}|~{3,})/;
const imageOnlyLine = /^\s*!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?\s*$/;

/**
 * Pandoc 的 custom-style Div 不是通用 Markdown，markdown-it 会把它作为正文显示。
 * 导出端仍兼容旧写法；预览端只提取紧邻图片的文字作为图题，并移除控制行。
 */
export function extractExplicitImageCaptions(markdown: string): ImageCaptionExtraction {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const captionsByImageIndex = new Map<number, string>();
  let imageIndex = -1;
  let imageCanReceiveCaption = false;
  let captionForNextImage: string | undefined;
  let activeFence: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(fenceLine)?.[1];
    if (fence) {
      if (!activeFence) activeFence = fence;
      else if (fence[0] === activeFence[0] && fence.length >= activeFence.length) activeFence = undefined;
      output.push(line);
      imageCanReceiveCaption = false;
      continue;
    }
    if (activeFence) {
      output.push(line);
      continue;
    }

    const boldCaption = markdownCaptionText(line);
    if (boldCaption) {
      if (index > 0 && imageOnlyLine.test(lines[index - 1]) && imageIndex >= 0) {
        captionsByImageIndex.set(imageIndex, boldCaption);
        imageCanReceiveCaption = false;
        continue;
      }
      if (index + 1 < lines.length && imageOnlyLine.test(lines[index + 1])) {
        captionForNextImage = boldCaption;
        continue;
      }
    }

    if (imageCaptionStart.test(line) && imageCanReceiveCaption && imageIndex >= 0) {
      const captionLines: string[] = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        if (/^\s*:::\s*$/.test(lines[index])) {
          closed = true;
          break;
        }
        captionLines.push(lines[index]);
      }
      if (closed) {
        const caption = plainCaptionText(captionLines.join(" "));
        if (caption) captionsByImageIndex.set(imageIndex, caption);
        imageCanReceiveCaption = false;
        continue;
      }

      // 未闭合的 Div 不是有效的兼容题注，完整保留，避免静默丢正文。
      output.push(line, ...captionLines);
      imageCanReceiveCaption = false;
      break;
    }

    output.push(line);
    if (imageOnlyLine.test(line)) {
      imageIndex += 1;
      if (captionForNextImage) {
        captionsByImageIndex.set(imageIndex, captionForNextImage);
        captionForNextImage = undefined;
      }
      imageCanReceiveCaption = true;
    } else if (!line.trim()) {
      // 题注块允许与图片之间空一行。
    } else {
      imageCanReceiveCaption = false;
    }
  }

  return { markdown: output.join("\n"), captionsByImageIndex };
}

function plainCaptionText(source: string) {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
