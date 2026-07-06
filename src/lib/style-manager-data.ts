import type { BorderStyleMode, MarkdownFeatureSettings, PageSettingsDraft, StyleDraft, StyleGroupKey, StyleNode, TablePresetKey, TemplateStyleConfig } from "@/types/style-manager";

export const styleGroupLabels: Record<StyleGroupKey, string> = {
  headings: "标题样式",
  blocks: "正文与块级样式",
  lists: "列表样式",
  tables: "表格样式",
};

export const styleNodes: StyleNode[] = [
  { id: "heading-1", name: "Heading 1", displayName: "一级标题", group: "headings", kind: "heading", markdown: "#", description: "文档主标题，通常映射为 Word Heading 1" },
  { id: "heading-2", name: "Heading 2", displayName: "二级标题", group: "headings", kind: "heading", markdown: "##", description: "章节标题，常用于报告主体结构" },
  { id: "heading-3", name: "Heading 3", displayName: "三级标题", group: "headings", kind: "heading", markdown: "###", description: "小节标题" },
  { id: "heading-4", name: "Heading 4", displayName: "四级标题", group: "headings", kind: "heading", markdown: "####", description: "深层级标题" },
  { id: "heading-5", name: "Heading 5", displayName: "五级标题", group: "headings", kind: "heading", markdown: "#####", description: "深层级标题" },
  { id: "heading-6", name: "Heading 6", displayName: "六级标题", group: "headings", kind: "heading", markdown: "######", description: "最深层级标题" },
  { id: "normal", name: "Normal", displayName: "正文", group: "blocks", kind: "paragraph", markdown: "paragraph", description: "普通正文段落" },
  { id: "body-text", name: "Body Text", displayName: "正文增强", group: "blocks", kind: "paragraph", markdown: "body", description: "增强正文样式" },
  { id: "quote", name: "Quote", displayName: "引用块", group: "blocks", kind: "block", markdown: ">", description: "Markdown 引用内容" },
  { id: "source-code", name: "Source Code", displayName: "代码块", group: "blocks", kind: "code", markdown: "```", description: "围栏代码块", warning: "建议设置等宽字体和底纹" },
  { id: "inline-code", name: "Inline Code", displayName: "行内代码", group: "blocks", kind: "code", markdown: "`code`", description: "行内代码样式" },
  { id: "caption", name: "Caption", displayName: "题注", group: "blocks", kind: "paragraph", markdown: "caption", description: "图片或表格题注" },
  { id: "bullet-list", name: "Bullet List", displayName: "无序列表", group: "lists", kind: "list", markdown: "-", description: "项目符号列表" },
  { id: "numbered-list", name: "Numbered List", displayName: "有序列表", group: "lists", kind: "list", markdown: "1.", description: "编号列表" },
  { id: "nested-list", name: "Nested List", displayName: "多级列表", group: "lists", kind: "list", markdown: "  -", description: "嵌套列表" },
  { id: "table", name: "Table", displayName: "表格整体", group: "tables", kind: "table", markdown: "table", description: "控制表格宽度、布局、自适应和整体边框" },
  { id: "table-header", name: "Table Header", displayName: "表头", group: "tables", kind: "table", markdown: "thead", description: "控制表头加粗、居中、背景色、边框与字号" },
  { id: "table-body", name: "Table Body", displayName: "表格体", group: "tables", kind: "table", markdown: "tbody", description: "控制表格体字体字号、水平/垂直对齐与隔行底色" },
  { id: "table-caption", name: "Table Caption", displayName: "表格题注", group: "tables", kind: "table", markdown: "table caption", description: "控制表格标题、对齐和自动编号" },
];

export const borderStyleOptions: { value: BorderStyleMode; label: string }[] = [
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" },
  { value: "dotted", label: "点线" },
  { value: "double", label: "双线" },
  { value: "none", label: "无边框" },
];

export const defaultStyleDraft: StyleDraft = {
  styleId: "heading-2",
  chineseFont: "微软雅黑",
  latinFont: "Times New Roman",
  fontSize: 15,
  fontWeight: "600",
  color: "#111827",
  lineHeight: "1.5",
  firstLineIndent: 0,
  beforeSpacing: 12,
  afterSpacing: 6,
  align: "left",
  autoNumbering: true,
  numberFormat: "1.1",
  backgroundColor: "transparent",
  tableLayout: "auto",
  fitToPageWidth: true,
  tableWidthPercent: 100,
  tableHorizontalAlign: "center",
  columnWidthMode: "auto",
  firstColumnWidth: 34,
  secondColumnWidth: 33,
  thirdColumnWidth: 33,
  cellVerticalAlign: "middle",
  cellPaddingX: 10,
  cellPaddingY: 8,
  cellWrap: true,
  minRowHeight: 28,
  rowStripe: true,
  borderStyle: "solid",
  borderColor: "#CBD5E1",
  borderWidth: 1,
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 1,
  headerBorderColor: "#A5B4FC",
  headerBorderWidth: 1,
  bodyBorderColor: "#CBD5E1",
  bodyBorderWidth: 1,
  outerBorderStrong: true,
  showInnerVerticalBorder: true,
  showInnerHorizontalBorder: true,
  headerBold: true,
  headerAlign: "center",
  headerVerticalAlign: "middle",
  headerBackgroundColor: "#EEF2FF",
  headerFontSize: 11,
  headerLineHeight: "1.4",
  bodyAlign: "center",
  bodyVerticalAlign: "middle",
  bodyFontSize: 10,
  bodyLineHeight: "1.5",
  bodyBackgroundColor: "#FFFFFF",
  captionAlign: "center",
  captionNumbering: true,
  tablePreset: "business",
};

export const tablePresets: { key: TablePresetKey; label: string; description: string; patch: Partial<StyleDraft> }[] = [
  {
    key: "business",
    label: "商务风",
    description: "浅蓝表头、细网格线，适合方案和汇报。",
    patch: {
      tablePreset: "business",
      headerBackgroundColor: "#EEF2FF",
      headerBorderColor: "#A5B4FC",
      bodyBorderColor: "#CBD5E1",
      borderColor: "#CBD5E1",
      rowStripe: true,
      headerBold: true,
      headerAlign: "center",
      bodyAlign: "center",
      borderStyle: "solid",
      outerBorderStrong: true,
    },
  },
  {
    key: "official",
    label: "公文风",
    description: "黑色边框、白底表格，适合正式材料。",
    patch: {
      tablePreset: "official",
      headerBackgroundColor: "#FFFFFF",
      bodyBackgroundColor: "#FFFFFF",
      borderColor: "#111827",
      headerBorderColor: "#111827",
      bodyBorderColor: "#111827",
      rowStripe: false,
      headerBold: true,
      borderStyle: "solid",
      borderWidth: 1,
      outerBorderStrong: true,
    },
  },
  {
    key: "grid",
    label: "网格风",
    description: "紧凑网格和固定列宽，适合数据对照。",
    patch: {
      tablePreset: "grid",
      tableLayout: "fixed",
      columnWidthMode: "custom",
      firstColumnWidth: 30,
      secondColumnWidth: 35,
      thirdColumnWidth: 35,
      headerBackgroundColor: "#F1F5F9",
      borderColor: "#64748B",
      headerBorderColor: "#64748B",
      bodyBorderColor: "#64748B",
      rowStripe: false,
      cellPaddingX: 8,
      cellPaddingY: 6,
      minRowHeight: 24,
    },
  },
  {
    key: "striped",
    label: "斑马纹",
    description: "弱边框和隔行底色，适合长表阅读。",
    patch: {
      tablePreset: "striped",
      headerBackgroundColor: "#ECFDF5",
      borderColor: "#BBF7D0",
      headerBorderColor: "#86EFAC",
      bodyBorderColor: "#DCFCE7",
      rowStripe: true,
      showInnerVerticalBorder: false,
      showInnerHorizontalBorder: true,
      bodyAlign: "left",
      cellPaddingX: 12,
      cellPaddingY: 9,
    },
  },
];
export const defaultPageSettings: PageSettingsDraft = {
  paperSize: "A4",
  orientation: "portrait",
  marginTop: 2.54,
  marginBottom: 2.54,
  marginLeft: 3.18,
  marginRight: 3.18,
  headerEnabled: false,
  headerText: "md-king · Word 样式预览",
  footerEnabled: true,
  footerText: "",
  footerPageNumberFormat: "page-total",
  footerShowFromPage: 1,
  footerStartPage: 1,
  tocEnabled: true,
  tocDepth: "1-3",
};

export const defaultMarkdownFeatures: MarkdownFeatureSettings = {
  inlineCode: false,
  codeBlock: true,
  quoteBlock: true,
  horizontalRule: false,
};

export const headingNumberFormats: Record<string, string> = {
  "heading-1": "1",
  "heading-2": "1.1",
  "heading-3": "1.1.1",
  "heading-4": "1.1.1.1",
  "heading-5": "1.1.1.1.1",
  "heading-6": "1.1.1.1.1.1",
};

export const numberFormatOptions = ["1", "1.1", "1.1.1", "1.1.1.1", "1.1.1.1.1", "1.1.1.1.1.1", "一、", "第一章", "无编号"] as const;

export function getDefaultNumberFormat(styleId: string) {
  return headingNumberFormats[styleId] ?? "1.1";
}

export function buildHeadingPreviewTitle(_styleId: string, draft: Pick<StyleDraft, "autoNumbering" | "numberFormat">, title: string) {
  if (!draft.autoNumbering || draft.numberFormat === "无编号") return title;
  return `${draft.numberFormat} ${title}`;
}

export function createDefaultStyleDraft(styleId = "heading-2"): StyleDraft {
  const node = styleNodes.find((item) => item.id === styleId);
  const draft: StyleDraft = { ...defaultStyleDraft, styleId };

  if (node?.kind === "heading") {
    const level = Number(styleId.replace("heading-", "")) || 2;
    return {
      ...draft,
      fontSize: Math.max(10, 22 - level * 2),
      fontWeight: level <= 2 ? "700" : "600",
      color: "#111827",
      lineHeight: "1.35",
      firstLineIndent: 0,
      beforeSpacing: level <= 2 ? 18 : 12,
      afterSpacing: level <= 2 ? 10 : 6,
      align: level === 1 ? "center" : "left",
      autoNumbering: true,
      numberFormat: getDefaultNumberFormat(styleId),
    };
  }

  if (styleId === "normal" || styleId === "body-text") {
    return {
      ...draft,
      fontSize: 12,
      fontWeight: "400",
      color: "#111827",
      lineHeight: "1.75",
      firstLineIndent: 2,
      beforeSpacing: 0,
      afterSpacing: 8,
      align: "justify",
      autoNumbering: false,
    };
  }

  if (node?.kind === "code") {
    return {
      ...draft,
      chineseFont: styleId === "inline-code" ? "Microsoft YaHei UI" : "微软雅黑",
      latinFont: styleId === "inline-code" ? "Consolas" : "JetBrains Mono",
      fontSize: styleId === "inline-code" ? 10.5 : 9,
      fontWeight: "400",
      color: styleId === "source-code" ? "#E2E8F0" : "#111827",
      backgroundColor: styleId === "source-code" ? "#111827" : "#F1F5F9",
      lineHeight: "1.55",
      firstLineIndent: 0,
      autoNumbering: false,
    };
  }

  if (styleId === "quote") {
    return {
      ...draft,
      fontSize: 10,
      fontWeight: "400",
      color: "#475569",
      backgroundColor: "#F8FAFC",
      lineHeight: "1.7",
      firstLineIndent: 0,
      autoNumbering: false,
    };
  }

  if (node?.kind === "list") {
    return {
      ...draft,
      fontSize: 12,
      fontWeight: "400",
      color: "#111827",
      lineHeight: "1.65",
      firstLineIndent: 0,
      autoNumbering: styleId !== "bullet-list",
      numberFormat: styleId === "numbered-list" ? "1.1" : "无编号",
    };
  }

  if (styleId === "table-caption" || styleId === "caption") {
    return {
      ...draft,
      fontSize: 10,
      fontWeight: "500",
      color: "#334155",
      align: "center",
      firstLineIndent: 0,
      captionAlign: "center",
      captionNumbering: true,
      autoNumbering: false,
    };
  }

  return draft;
}

export function createDefaultTemplateStyleConfig(templateId: string): TemplateStyleConfig {
  const styles = Object.fromEntries(styleNodes.map((node) => [node.id, createDefaultStyleDraft(node.id)]));
  if (templateId === "default-report") {
    styles.normal = {
      ...styles.normal,
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 12,
      lineHeight: "1.25",
      beforeSpacing: 0,
      afterSpacing: 0,
      firstLineIndent: 2,
      color: "#111827",
    };
    styles["body-text"] = {
      ...styles["body-text"],
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 12,
      lineHeight: "1.25",
      beforeSpacing: 0,
      afterSpacing: 0,
      firstLineIndent: 2,
      color: "#111827",
    };
    styles["bullet-list"] = {
      ...styles["bullet-list"],
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 12,
      lineHeight: "1.25",
      beforeSpacing: 0,
      afterSpacing: 0,
      color: "#111827",
    };
    styles["numbered-list"] = {
      ...styles["numbered-list"],
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 12,
      lineHeight: "1.25",
      beforeSpacing: 0,
      afterSpacing: 0,
      color: "#111827",
    };
    styles["nested-list"] = {
      ...styles["nested-list"],
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 12,
      lineHeight: "1.25",
      beforeSpacing: 0,
      afterSpacing: 0,
      color: "#111827",
    };
    styles["source-code"] = {
      ...styles["source-code"],
      latinFont: "Consolas",
      fontSize: 9,
      color: "#111827",
      backgroundColor: "#F8FAFC",
      lineHeight: "1.55",
    };
    styles["inline-code"] = {
      ...styles["inline-code"],
      chineseFont: "Microsoft YaHei UI",
      latinFont: "Consolas",
      fontSize: 10.5,
      color: "#111827",
      backgroundColor: "#F1F5F9",
      lineHeight: "1.35",
      firstLineIndent: 0,
    };
    styles.quote = {
      ...styles.quote,
      fontSize: 10.5,
      color: "#475569",
      backgroundColor: "#F8FAFC",
      lineHeight: "1.7",
    };
    styles.table = {
      ...styles.table,
      borderColor: "#CBD5E1",
      headerBorderColor: "#CBD5E1",
      bodyBorderColor: "#CBD5E1",
      headerBackgroundColor: "#FFFFFF",
      headerFontSize: 10.5,
      bodyFontSize: 10.5,
      headerAlign: "center",
      headerVerticalAlign: "middle",
      bodyAlign: "left",
      bodyVerticalAlign: "middle",
      rowStripe: false,
    };
  }

  if (templateId === "official-document") {
    styles["heading-1"] = { ...styles["heading-1"], chineseFont: "宋体", fontSize: 22, color: "#111827", align: "center", autoNumbering: false };
    styles["heading-2"] = { ...styles["heading-2"], chineseFont: "黑体", fontSize: 16, color: "#111827", numberFormat: "一、" };
    styles.normal = { ...styles.normal, chineseFont: "仿宋", fontSize: 12, lineHeight: "1.85", firstLineIndent: 2, color: "#111827" };
    styles.quote = { ...styles.quote, chineseFont: "仿宋", backgroundColor: "#FFFFFF", color: "#374151" };
    styles.table = { ...styles.table, tablePreset: "official", rowStripe: false, borderColor: "#111827", headerBackgroundColor: "#FFFFFF", headerBorderColor: "#111827", bodyBorderColor: "#111827" };
  }

  if (templateId === "technical-spec") {
    styles["heading-1"] = { ...styles["heading-1"], fontSize: 20, color: "#1D4ED8", align: "left" };
    styles["heading-2"] = { ...styles["heading-2"], fontSize: 16, color: "#1D4ED8" };
    styles.normal = { ...styles.normal, fontSize: 11, lineHeight: "1.7", firstLineIndent: 0, align: "left" };
    styles["source-code"] = { ...styles["source-code"], fontSize: 9, backgroundColor: "#0F172A", color: "#E2E8F0" };
    styles.table = { ...styles.table, tablePreset: "grid", tableLayout: "fixed", rowStripe: false, borderColor: "#64748B", headerBackgroundColor: "#F1F5F9", headerBorderColor: "#64748B", bodyBorderColor: "#64748B" };
  }

  styles["table-header"] = { ...styles.table, styleId: "table-header" };
  styles["table-body"] = { ...styles.table, styleId: "table-body" };
  styles["table-caption"] = { ...styles.table, ...styles["table-caption"], styleId: "table-caption" };

  return {
    templateId,
    styles,
    pageSettings: defaultPageSettings,
    markdownFeatures: defaultMarkdownFeatures,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLegacyStyleDraft(styleId: string, draft: StyleDraft): StyleDraft {
  let normalized = { ...draft, firstLineIndent: draft.firstLineIndent ?? createDefaultStyleDraft(styleId).firstLineIndent };
  if (!styleId.startsWith("heading-")) return normalized;

  const defaultFormat = getDefaultNumberFormat(styleId);
  const isLegacyDefault = (styleId === "heading-1" && normalized.numberFormat === "一、") || (styleId !== "heading-1" && normalized.numberFormat === "1.1");

  if (isLegacyDefault && normalized.numberFormat !== defaultFormat) {
    normalized = { ...normalized, autoNumbering: true, numberFormat: defaultFormat };
  }

  return normalized;
}

export function mergeTemplateStyleConfig(templateId: string, config?: Partial<TemplateStyleConfig>): TemplateStyleConfig {
  const defaults = createDefaultTemplateStyleConfig(templateId);
  const styles = Object.fromEntries(
    Object.entries({
      ...defaults.styles,
      ...(config?.styles ?? {}),
    }).map(([styleId, draft]) => [styleId, normalizeLegacyStyleDraft(styleId, draft)]),
  );

  return {
    ...defaults,
    ...config,
    templateId,
    styles,
    pageSettings: {
      ...defaults.pageSettings,
      ...(config?.pageSettings ?? {}),
    },
    markdownFeatures: {
      ...defaults.markdownFeatures,
      ...(config?.markdownFeatures ?? {}),
    },
  };
}

export const markdownMappings = [
  ["# 一级标题", "Heading 1"],
  ["## 二级标题", "Heading 2"],
  ["### 三级标题", "Heading 3"],
  ["#### 四级标题", "Heading 4"],
  ["##### 五级标题", "Heading 5"],
  ["###### 六级标题", "Heading 6"],
  ["正文段落", "Normal"],
  ["> 引用块", "Quote"],
  ["```code```", "Source Code"],
  ["`inline code`", "Inline Code"],
  ["表格", "Table"],
  ["表头", "Table Header"],
  ["表格体", "Table Body"],
  ["表格题注", "Table Caption"],
  ["图片题注", "Caption"],
] as const;

export const batchActions = ["统一标题字体", "按层级自动缩放字号", "复制 Heading 2 设置到 Heading 3-6", "恢复 Pandoc 默认样式", "从当前 DOCX 重新读取样式"];
