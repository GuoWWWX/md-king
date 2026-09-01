const captionAttribute = /\bcaption\s*=\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s}]+))/i;
const boldCaption = /^\s*\*\*([^\r\n]+?)\*\*\s*$/;

/** 读取 ```mermaid {caption="..."} 中的原生图题。 */
export function mermaidFenceCaption(info: string | undefined) {
  const match = info?.match(captionAttribute);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value) return undefined;
  const caption = value.replace(/\\([\\"'])/g, "$1").trim();
  return caption || undefined;
}

/** 转换链内部使用 Pandoc 样式块；该控制语法不会写回用户的 Markdown。 */
export function imageCaptionStyleBlock(caption: string) {
  return `::: {custom-style="Image Caption"}\n${caption}\n:::`;
}

/** CommonMark 通用指令风格的题注；具体对象类型由调用方根据相邻块确定。 */
/** 用户侧题注只接受与目标块紧邻的整行加粗。 */
export function markdownCaptionText(source: string | undefined) {
  return source?.match(boldCaption)?.[1]?.trim() || undefined;
}

/** 从围栏前一行读取无空行相隔的题注。 */
export function precedingMermaidCaption(markdown: string, fenceStart: number) {
  const prefix = markdown.slice(0, fenceStart);
  const match = prefix.match(/(^|\r?\n)(\*\*[^\r\n]+?\*\*)[ \t]*\r?\n$/);
  const caption = markdownCaptionText(match?.[2]);
  if (!caption || !match || match.index === undefined) return undefined;
  return { caption, start: match.index + match[1].length };
}

/** 从围栏结束后的第一行读取题注；中间出现空行就不再关联。 */
export function followingMermaidCaption(markdown: string, fenceEnd: number) {
  const remainder = markdown.slice(fenceEnd);
  const boldMatch = remainder.match(/^\r?\n(\*\*[^\r\n]+?\*\*)[ \t]*(?=\r?\n|$)/);
  const match = boldMatch;
  const caption = markdownCaptionText(match?.[1]);
  return caption && match ? { caption, end: fenceEnd + match[0].length } : undefined;
}
