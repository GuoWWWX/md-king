/**
 * 带文字居中分割线语法识别与解析。
 *
 * 语法格式：`--- ABC`、`--- 阶段总结 ---`、`*** 章节 ***` 等。
 * 文字在分割线中间居中显示，左右两端与横线各隔一个空格。
 */

export const HORIZONTAL_RULE_TEXT_PATTERN = /^[ \t]*(?:---|\*\*\*|___)[ \t]+(.+?)(?:[ \t]+(?:---|\*\*\*|___))?[ \t]*$/;

export type ParsedHorizontalRuleText = {
  prefix: string;
  text: string;
  suffix?: string;
};

export function parseHorizontalRuleText(line: string): ParsedHorizontalRuleText | null {
  const match = line.match(/^([ \t]*(?:---|\*\*\*|___)[ \t]+)(.+?)(?:([ \t]+(?:---|\*\*\*|___))[ \t]*)?$/);
  if (!match) return null;
  return {
    prefix: match[1],
    text: match[2].trim(),
    suffix: match[3],
  };
}
