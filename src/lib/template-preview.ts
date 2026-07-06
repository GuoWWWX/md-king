import { getTemplateCategory } from "@/lib/template-categories";
import type { Template } from "@/types";

export function createTemplatePreviewMarkdown(template: Template) {
  const category = getTemplateCategory(template.tags, template.isBuiltIn);
  const text = `${template.name} ${category} ${template.tags.join(" ")}`;

  if (/技术|代码|开发|API/i.test(text)) {
    return "# 技术方案\n\n## 接口概览\n\n- Markdown 解析\n- Word 样式映射\n\n```ts\nconvert(markdown, template)\n```\n\n| 模块 | 状态 |\n| --- | --- |\n| 预览 | 正常 |";
  }

  if (/公文|正式|政务|通知/i.test(text)) {
    return "# 关于材料报送的通知\n\n## 一、总体要求\n\n正文段落用于展示公文模板的标题、行距和段落间距。\n\n> 请按统一格式提交材料。\n\n| 项目 | 要求 |\n| --- | --- |\n| 格式 | 统一 |";
  }

  if (/论文|学术|研究/i.test(text)) {
    return "# 研究报告标题\n\n## 摘要\n\n本文用于预览学术类模板的标题层级、正文和表格样式。\n\n| 指标 | 结果 |\n| --- | --- |\n| 样本 | 120 |";
  }

  return "# 项目报告\n\n## 核心结论\n\n这是一段报告正文，用于快速展示默认模板的标题、正文、引用和表格。\n\n> 关键内容可以在这里突出展示。\n\n| 字段 | 样式 | 备注 |\n| --- | --- | --- |\n| 标题 | 加粗 | 层级清晰 |";
}
