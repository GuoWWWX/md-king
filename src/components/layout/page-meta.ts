import type { PageMeta } from "./page-header";

export const appPageMeta: Record<string, PageMeta> = {
  convert: {
    title: "转换 Markdown 为 Word",
    description: "拖入 Markdown 文件，或粘贴 AI 生成内容，一键生成样式统一、可继续编辑的 DOCX 文档。",
    tags: ["本地转换", "Word/WPS", "模板样式可复用"],
  },
  templates: {
    title: "模板中心",
    description: "管理 Word/WPS 样式模板，让同一份 Markdown 按不同模板生成稳定统一的文档效果。",
    tags: ["参考 DOCX", "样式诊断", "样式管理器"],
  },
  history: {
    title: "转换历史",
    description: "查看最近生成的 DOCX，快速复制输出路径、定位失败原因，或重新触发转换流程。",
    tags: ["成功 / 失败", "模板追踪", "错误详情"],
  },
  settings: {
    title: "设置中心",
    description: "配置默认输出目录、Pandoc 路径、转换行为和系统集成能力。",
    tags: ["Pandoc", "右键菜单", "悬浮球"],
  },
  about: {
    title: "关于 md-king",
    description: "面向 AI 时代的 Markdown 转 Word/WPS 本地效率工具。",
    tags: ["隐私优先", "本地运行", "Pandoc 引擎"],
  },
};
