export type MarkdownCalloutTone = "cyan" | "blue" | "green" | "amber" | "red" | "purple" | "slate";

export type MarkdownCalloutHeader = {
  type: string;
  tone: MarkdownCalloutTone;
  defaultTitle: string;
  /** `-` 默认收起，`+` 默认展开；未写时保持普通展开的 Callout。 */
  fold: "collapsed" | "expanded" | undefined;
  markerStart: number;
  markerEnd: number;
  title: string;
};

type CalloutPreset = {
  tone: MarkdownCalloutTone;
  title: string;
};

const calloutPresets: Record<string, CalloutPreset> = {
  abstract: { tone: "cyan", title: "摘要" },
  summary: { tone: "cyan", title: "摘要" },
  tldr: { tone: "cyan", title: "摘要" },
  note: { tone: "blue", title: "笔记" },
  info: { tone: "blue", title: "信息" },
  todo: { tone: "blue", title: "待办" },
  tip: { tone: "green", title: "提示" },
  hint: { tone: "green", title: "提示" },
  success: { tone: "green", title: "成功" },
  check: { tone: "green", title: "完成" },
  question: { tone: "amber", title: "问题" },
  help: { tone: "amber", title: "帮助" },
  warning: { tone: "amber", title: "警告" },
  caution: { tone: "amber", title: "注意" },
  failure: { tone: "red", title: "失败" },
  fail: { tone: "red", title: "失败" },
  danger: { tone: "red", title: "危险" },
  error: { tone: "red", title: "错误" },
  bug: { tone: "red", title: "缺陷" },
  example: { tone: "purple", title: "示例" },
  quote: { tone: "slate", title: "引用" },
  cite: { tone: "slate", title: "引用" },
};

/** 解析 Obsidian 兼容的 `> [!type] 标题` 首行。 */
export function parseMarkdownCalloutHeader(text: string): MarkdownCalloutHeader | undefined {
  const match = text.match(/^(\s*)\[!([a-z][\w-]*)\]([+-])?(?:[ \t]+|$)/i);
  if (!match) return undefined;

  const type = match[2].toLocaleLowerCase();
  const preset = calloutPresets[type] ?? { tone: "slate" as const, title: type };
  return {
    type,
    tone: preset.tone,
    defaultTitle: preset.title,
    fold: match[3] === "-" ? "collapsed" : match[3] === "+" ? "expanded" : undefined,
    markerStart: match[1].length,
    markerEnd: match[0].length,
    title: text.slice(match[0].length).trim(),
  };
}
