import type { BorderStyleMode, CaptionPosition, CodeBlockPresetKey, ImageWidthMode, ListLevelType, ListMarkerStyle, ListNumberingMode, ListWrapMode, MarkdownFeatureSettings, MarkdownRulesSettings, PageSettingsDraft, StyleDraft, StyleGroupKey, StyleNode, TablePresetKey, TemplateStyleConfig } from "@/types/style-manager";

export const styleGroupLabels: Record<StyleGroupKey, string> = {
  basic: "基础样式",
  images: "图片类",
  tables: "表格样式",
  blocks: "扩展样式",
};

export const styleNodes: StyleNode[] = [
  { id: "title", name: "Title", displayName: "大标题", group: "basic", kind: "paragraph", markdown: "#", description: "文档大标题，不参与章节编号和目录" },
  { id: "heading-1", name: "Heading 1", displayName: "一级标题", group: "basic", kind: "heading", markdown: "#", description: "文档主标题，通常映射为 Word Heading 1" },
  { id: "heading-2", name: "Heading 2", displayName: "二级标题", group: "basic", kind: "heading", markdown: "##", description: "章节标题，常用于报告主体结构" },
  { id: "heading-3", name: "Heading 3", displayName: "三级标题", group: "basic", kind: "heading", markdown: "###", description: "小节标题" },
  { id: "heading-4", name: "Heading 4", displayName: "四级标题", group: "basic", kind: "heading", markdown: "####", description: "深层级标题" },
  { id: "heading-5", name: "Heading 5", displayName: "五级标题", group: "basic", kind: "heading", markdown: "#####", description: "深层级标题" },
  { id: "heading-6", name: "Heading 6", displayName: "六级标题", group: "basic", kind: "heading", markdown: "######", description: "最深层级标题" },
  { id: "normal", name: "Normal", displayName: "正文", group: "basic", kind: "paragraph", markdown: "paragraph", description: "普通正文段落" },
  { id: "quote", name: "Quote", displayName: "引用块", group: "blocks", kind: "block", markdown: ">", description: "Markdown 引用内容" },
  { id: "source-code", name: "Source Code", displayName: "代码块", group: "blocks", kind: "code", markdown: "```", description: "围栏代码块", warning: "建议设置等宽字体和底纹" },
  { id: "inline-code", name: "Inline Code", displayName: "行内代码", group: "blocks", kind: "code", markdown: "`code`", description: "行内代码样式" },
  { id: "horizontal-rule", name: "Horizontal Rule", displayName: "分割线", group: "blocks", kind: "rule", markdown: "---", description: "Markdown 分割线" },
  { id: "image", name: "Image", displayName: "图片样式", group: "images", kind: "image", markdown: "![alt](url)", description: "控制 Markdown 图片的宽度和对齐方式" },
  { id: "caption", name: "Caption", displayName: "图片题注", group: "images", kind: "paragraph", markdown: "caption", description: "控制图片下方或上方的说明文字" },
  { id: "bullet-list", name: "Bullet List", displayName: "无序列表", group: "basic", kind: "list", markdown: "-", description: "项目符号列表" },
  { id: "numbered-list", name: "Numbered List", displayName: "有序列表", group: "basic", kind: "list", markdown: "1.", description: "编号列表" },
  { id: "nested-list", name: "Nested List", displayName: "多级列表", group: "basic", kind: "list", markdown: "  -", description: "嵌套列表" },
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

export const listMarkerOptions: { value: ListMarkerStyle; label: string; marker: string }[] = [
  { value: "disc", label: "实心圆点", marker: "•" },
  { value: "circle", label: "空心圆", marker: "○" },
  { value: "square", label: "方块", marker: "■" },
  { value: "triangle", label: "三角", marker: "▸" },
  { value: "dash", label: "短横", marker: "-" },
  { value: "check", label: "对勾", marker: "✓" },
  { value: "bar", label: "竖条", marker: "|" },
  { value: "double-bar", label: "双竖条", marker: "||" },
  { value: "triple-bar", label: "三竖条", marker: "|||" },
];

export const listLevelTypeOptions: { value: ListLevelType; label: string }[] = [
  { value: "bullet", label: "无序" },
  { value: "number", label: "有序" },
];

export const listNumberFormatOptions = ["1.", "1)", "(1)", "01.", "A.", "A)", "a.", "a)", "I.", "I)", "i.", "i)", "一、", "（一）"] as const;

export const listWrapModeOptions: { value: ListWrapMode; label: string; description: string }[] = [
  { value: "hanging", label: "与正文文字对齐", description: "换行后与符号后的文字起点对齐" },
  { value: "flat", label: "与符号对齐", description: "换行后与列表符号起点对齐" },
];

export const listNumberingModeOptions: { value: ListNumberingMode; label: string; description: string }[] = [
  { value: "restart", label: "每组重新开始", description: "新的有序列表从 1 开始" },
  { value: "continue", label: "延续上一组", description: "后续有序列表继续累计编号" },
];

export const captionPositionOptions: { value: CaptionPosition; label: string; description: string }[] = [
  { value: "above", label: "对象上方", description: "题注显示在图片或表格上方" },
  { value: "below", label: "对象下方", description: "题注显示在图片或表格下方" },
];

export const captionNumberFormatOptions = ["图 1", "图 1-1", "Figure 1", "1.", "表 1", "表 1-1", "Table 1"] as const;

export const imageWidthModeOptions: { value: ImageWidthMode; label: string; description: string }[] = [
  { value: "content", label: "铺满正文宽度", description: "图片宽度等于去掉页边距后的内容宽度" },
  { value: "original", label: "保留原始宽度", description: "不主动缩放图片尺寸" },
  { value: "custom", label: "自定义比例", description: "按正文宽度百分比设置图片宽度" },
];

export const defaultStyleDraft: StyleDraft = {
  styleId: "heading-2",
  chineseFont: "微软雅黑",
  latinFont: "Times New Roman",
  fontSize: 15,
  fontWeight: "700",
  color: "#111827",
  lineHeight: "1.5",
  firstLineIndent: 0,
  beforeSpacing: 12,
  afterSpacing: 6,
  align: "left",
  autoNumbering: true,
  numberFormat: "1.1",
  listMarkerStyle: "disc",
  listIndent: 2,
  listTextIndent: 1,
  listWrapMode: "hanging",
  listNumberingMode: "restart",
  nestedLevel2MarkerStyle: "circle",
  nestedLevel3MarkerStyle: "square",
  nestedLevel2NumberFormat: "1)",
  nestedLevel3NumberFormat: "(1)",
  listLevel1Type: "bullet",
  listLevel2Type: "bullet",
  listLevel3Type: "bullet",
  listLevel4Type: "bullet",
  listLevel1MarkerStyle: "disc",
  listLevel2MarkerStyle: "circle",
  listLevel3MarkerStyle: "square",
  listLevel4MarkerStyle: "dash",
  listLevel1NumberFormat: "1.",
  listLevel2NumberFormat: "A.",
  listLevel3NumberFormat: "a.",
  listLevel4NumberFormat: "I.",
  listLevel1ChineseFont: "微软雅黑",
  listLevel2ChineseFont: "微软雅黑",
  listLevel3ChineseFont: "微软雅黑",
  listLevel4ChineseFont: "微软雅黑",
  listLevel1LatinFont: "Times New Roman",
  listLevel2LatinFont: "Times New Roman",
  listLevel3LatinFont: "Times New Roman",
  listLevel4LatinFont: "Times New Roman",
  listLevel1FontSize: 12,
  listLevel2FontSize: 12,
  listLevel3FontSize: 12,
  listLevel4FontSize: 12,
  listLevel1FontWeight: "400",
  listLevel2FontWeight: "400",
  listLevel3FontWeight: "400",
  listLevel4FontWeight: "400",
  listLevel1Color: "#111827",
  listLevel2Color: "#111827",
  listLevel3Color: "#111827",
  listLevel4Color: "#111827",
  listLevel1LineHeight: "1.65",
  listLevel2LineHeight: "1.65",
  listLevel3LineHeight: "1.65",
  listLevel4LineHeight: "1.65",
  listLevel1BeforeSpacing: 0,
  listLevel2BeforeSpacing: 0,
  listLevel3BeforeSpacing: 0,
  listLevel4BeforeSpacing: 0,
  listLevel1AfterSpacing: 6,
  listLevel2AfterSpacing: 6,
  listLevel3AfterSpacing: 6,
  listLevel4AfterSpacing: 6,
  listLevel1Align: "left",
  listLevel2Align: "left",
  listLevel3Align: "left",
  listLevel4Align: "left",
  listLevel1Indent: 2,
  listLevel2Indent: 4,
  listLevel3Indent: 6,
  listLevel4Indent: 8,
  listLevel1TextIndent: 1,
  listLevel2TextIndent: 1,
  listLevel3TextIndent: 1,
  listLevel4TextIndent: 1,
  listLevel1WrapMode: "hanging",
  listLevel2WrapMode: "hanging",
  listLevel3WrapMode: "hanging",
  listLevel4WrapMode: "hanging",
  listLevel1NumberingMode: "restart",
  listLevel2NumberingMode: "restart",
  listLevel3NumberingMode: "restart",
  listLevel4NumberingMode: "restart",
  nestedIndentStep: 2,
  backgroundColor: "transparent",
  quoteBorderColor: "#94A3B8",
  quoteBorderWidth: 4,
  codeBlockPreset: "document",
  codeBorderColor: "#E2E8F0",
  // Word paragraph borders cannot represent CSS-style rounded code blocks.
  // Keep the legacy field in persisted configs, but default all new styles to square corners.
  codeBorderRadius: 0,
  codePaddingX: 12,
  codePaddingY: 10,
  tableLayout: "auto",
  fitToPageWidth: true,
  tableWidthPercent: 100,
  tableHorizontalAlign: "center",
  columnWidthMode: "auto",
  firstColumnWidth: 34,
  secondColumnWidth: 33,
  thirdColumnWidth: 33,
  cellPaddingX: 10,
  cellPaddingY: 8,
  cellWrap: true,
  minRowHeight: 28,
  rowStripe: true,
  repeatHeaderOnEachPage: true,
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
  captionPosition: "above",
  captionNumberFormat: "表 1-1",
  imageAlign: "center",
  imageWidthMode: "content",
  imageWidthPercent: 100,
  tablePreset: "business",
};

function withSyncedListLevelDefaults(draft: StyleDraft): StyleDraft {
  return {
    ...draft,
    listLevel1ChineseFont: draft.chineseFont,
    listLevel2ChineseFont: draft.chineseFont,
    listLevel3ChineseFont: draft.chineseFont,
    listLevel4ChineseFont: draft.chineseFont,
    listLevel1LatinFont: draft.latinFont,
    listLevel2LatinFont: draft.latinFont,
    listLevel3LatinFont: draft.latinFont,
    listLevel4LatinFont: draft.latinFont,
    listLevel1FontSize: draft.fontSize,
    listLevel2FontSize: draft.fontSize,
    listLevel3FontSize: draft.fontSize,
    listLevel4FontSize: draft.fontSize,
    listLevel1FontWeight: draft.fontWeight,
    listLevel2FontWeight: draft.fontWeight,
    listLevel3FontWeight: draft.fontWeight,
    listLevel4FontWeight: draft.fontWeight,
    listLevel1Color: draft.color,
    listLevel2Color: draft.color,
    listLevel3Color: draft.color,
    listLevel4Color: draft.color,
    listLevel1LineHeight: draft.lineHeight,
    listLevel2LineHeight: draft.lineHeight,
    listLevel3LineHeight: draft.lineHeight,
    listLevel4LineHeight: draft.lineHeight,
    listLevel1BeforeSpacing: draft.beforeSpacing,
    listLevel2BeforeSpacing: draft.beforeSpacing,
    listLevel3BeforeSpacing: draft.beforeSpacing,
    listLevel4BeforeSpacing: draft.beforeSpacing,
    listLevel1AfterSpacing: draft.afterSpacing,
    listLevel2AfterSpacing: draft.afterSpacing,
    listLevel3AfterSpacing: draft.afterSpacing,
    listLevel4AfterSpacing: draft.afterSpacing,
    listLevel1Align: draft.align,
    listLevel2Align: draft.align,
    listLevel3Align: draft.align,
    listLevel4Align: draft.align,
    listLevel1Indent: draft.listIndent,
    listLevel2Indent: draft.listIndent + draft.nestedIndentStep,
    listLevel3Indent: draft.listIndent + draft.nestedIndentStep * 2,
    listLevel4Indent: draft.listIndent + draft.nestedIndentStep * 3,
    listLevel1TextIndent: draft.listTextIndent,
    listLevel2TextIndent: draft.listTextIndent,
    listLevel3TextIndent: draft.listTextIndent,
    listLevel4TextIndent: draft.listTextIndent,
    listLevel1WrapMode: draft.listWrapMode,
    listLevel2WrapMode: draft.listWrapMode,
    listLevel3WrapMode: draft.listWrapMode,
    listLevel4WrapMode: draft.listWrapMode,
    listLevel1NumberingMode: draft.listNumberingMode,
    listLevel2NumberingMode: draft.listNumberingMode,
    listLevel3NumberingMode: draft.listNumberingMode,
    listLevel4NumberingMode: draft.listNumberingMode,
  };
}

function inheritListTextFromBody(draft: StyleDraft, body: StyleDraft): StyleDraft {
  return withSyncedListLevelDefaults({
    ...draft,
    chineseFont: body.chineseFont,
    latinFont: body.latinFont,
    fontSize: body.fontSize,
    fontWeight: body.fontWeight,
    color: body.color,
    lineHeight: body.lineHeight,
    beforeSpacing: body.beforeSpacing,
    afterSpacing: body.afterSpacing,
    align: body.align,
  });
}

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

export const codeBlockPresets: { key: CodeBlockPresetKey; label: string; description: string; patch: Partial<StyleDraft> }[] = [
  {
    key: "document",
    label: "浅色文档",
    description: "白底浅边框，适合正式文档和打印。",
    patch: {
      codeBlockPreset: "document",
      latinFont: "Consolas",
      chineseFont: "Microsoft YaHei UI",
      color: "#111827",
      backgroundColor: "#F8FAFC",
      codeBorderColor: "#E2E8F0",
      codeBorderRadius: 0,
      lineHeight: "1.55",
      beforeSpacing: 8,
      afterSpacing: 8,
      codePaddingX: 12,
      codePaddingY: 10,
    },
  },
  {
    key: "terminal",
    label: "深色终端",
    description: "深底高对比，适合展示命令和日志。",
    patch: {
      codeBlockPreset: "terminal",
      latinFont: "JetBrains Mono",
      chineseFont: "Microsoft YaHei UI",
      color: "#E2E8F0",
      backgroundColor: "#111827",
      codeBorderColor: "#334155",
      codeBorderRadius: 0,
      lineHeight: "1.6",
      beforeSpacing: 10,
      afterSpacing: 10,
      codePaddingX: 14,
      codePaddingY: 12,
    },
  },
  {
    key: "blueprint",
    label: "蓝色科技",
    description: "蓝灰底和蓝色边线，适合技术方案。",
    patch: {
      codeBlockPreset: "blueprint",
      latinFont: "JetBrains Mono",
      chineseFont: "Microsoft YaHei UI",
      color: "#0F172A",
      backgroundColor: "#EFF6FF",
      codeBorderColor: "#93C5FD",
      codeBorderRadius: 0,
      lineHeight: "1.6",
      beforeSpacing: 10,
      afterSpacing: 10,
      codePaddingX: 14,
      codePaddingY: 11,
    },
  },
  {
    key: "minimal",
    label: "灰色专业",
    description: "低饱和灰底，适合论文和说明书。",
    patch: {
      codeBlockPreset: "minimal",
      latinFont: "Consolas",
      chineseFont: "Microsoft YaHei UI",
      color: "#1F2937",
      backgroundColor: "#F3F4F6",
      codeBorderColor: "#D1D5DB",
      codeBorderRadius: 0,
      lineHeight: "1.5",
      beforeSpacing: 6,
      afterSpacing: 6,
      codePaddingX: 12,
      codePaddingY: 8,
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
  footerPageNumberFormat: "page",
  footerStartPage: 1,
  tocEnabled: true,
  tocDepth: "1-3",
  tocLeader: "dot",
  tocShowPageNumbers: true,
};

export const defaultMarkdownFeatures: MarkdownFeatureSettings = {
  inlineCode: false,
  codeBlock: true,
  quoteBlock: true,
  horizontalRule: false,
};

export const defaultMarkdownRules: MarkdownRulesSettings = {
  headingMappings: {
    "heading-1": "heading-1",
    "heading-2": "heading-2",
    "heading-3": "heading-3",
    "heading-4": "heading-4",
    "heading-5": "heading-5",
    "heading-6": "heading-6",
  },
};

const builtInTemplateIds = new Set(["default-report", "official-document", "technical-spec"]);

const builtInMarkdownRules: MarkdownRulesSettings = {
  headingMappings: {
    "heading-1": "title",
    "heading-2": "heading-1",
    "heading-3": "heading-2",
    "heading-4": "heading-3",
    "heading-5": "heading-4",
    "heading-6": "heading-5",
  },
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

  if (styleId === "title") {
    return {
      ...draft,
      fontSize: 24,
      fontWeight: "700",
      color: "#111827",
      lineHeight: "1.35",
      firstLineIndent: 0,
      beforeSpacing: 0,
      afterSpacing: 24,
      align: "center",
      autoNumbering: false,
      numberFormat: "无编号",
    };
  }

  if (node?.kind === "heading") {
    const level = Number(styleId.replace("heading-", "")) || 2;
    const headingFontSizes: Record<number, number> = { 1: 22, 2: 18, 3: 16, 4: 15, 5: 14, 6: 12 };
    return {
      ...draft,
      fontSize: headingFontSizes[level] ?? 12,
      fontWeight: "700",
      color: "#111827",
      lineHeight: "1.35",
      firstLineIndent: 0,
      beforeSpacing: level <= 2 ? 18 : 12,
      afterSpacing: level <= 2 ? 10 : 6,
      align: "left",
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
      codeBlockPreset: styleId === "source-code" ? "terminal" : "document",
      codeBorderColor: styleId === "source-code" ? "#334155" : "#CBD5E1",
      codeBorderRadius: 0,
      codePaddingX: styleId === "source-code" ? 14 : 4,
      codePaddingY: styleId === "source-code" ? 12 : 1,
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
      quoteBorderColor: "#94A3B8",
      quoteBorderWidth: 4,
      lineHeight: "1.7",
      firstLineIndent: 0,
      autoNumbering: false,
    };
  }

  if (styleId === "horizontal-rule") {
    return {
      ...draft,
      borderStyle: "solid",
      borderColor: "#CBD5E1",
      borderWidth: 1,
      beforeSpacing: 12,
      afterSpacing: 12,
      autoNumbering: false,
    };
  }

  if (node?.kind === "list") {
    const isNumbered = styleId === "numbered-list";
    const isNested = styleId === "nested-list";
    return withSyncedListLevelDefaults({
      ...draft,
      fontSize: 12,
      fontWeight: "400",
      color: "#111827",
      lineHeight: "1.65",
      firstLineIndent: 0,
      autoNumbering: isNumbered,
      numberFormat: isNumbered ? "1." : "无编号",
      listMarkerStyle: isNested ? "circle" : "disc",
      listIndent: 2,
      listTextIndent: 1,
      listWrapMode: "hanging",
      listNumberingMode: "restart",
      listLevel1Type: isNumbered ? "number" : "bullet",
      listLevel2Type: "bullet",
      listLevel3Type: "bullet",
      listLevel4Type: "bullet",
      nestedLevel2MarkerStyle: "circle",
      nestedLevel3MarkerStyle: "square",
      nestedLevel2NumberFormat: "1)",
      nestedLevel3NumberFormat: "(1)",
      nestedIndentStep: 2,
    });
  }

  if (styleId === "image") {
    return {
      ...draft,
      imageAlign: "center",
      imageWidthMode: "content",
      imageWidthPercent: 100,
      autoNumbering: false,
    };
  }

  if (styleId === "table-caption" || styleId === "caption") {
    const isTableCaption = styleId === "table-caption";
    return {
      ...draft,
      fontSize: 10,
      fontWeight: "400",
      color: "#334155",
      align: "center",
      firstLineIndent: 0,
      captionAlign: "center",
      captionNumbering: true,
      captionPosition: isTableCaption ? "above" : "below",
      captionNumberFormat: isTableCaption ? "表 1-1" : "图 1-1",
      autoNumbering: false,
    };
  }

  return draft;
}

export function createDefaultTemplateStyleConfig(templateId: string): TemplateStyleConfig {
  const styles = Object.fromEntries(styleNodes.map((node) => [node.id, createDefaultStyleDraft(node.id)]));
  // body-text 没有独立的样式节点（界面上不单独暴露），但导出侧会按 Word 的 BodyText 样式读取它，
  // 这里必须先建出完整草稿，否则后面的 { ...styles["body-text"] } 会展开 undefined，产出残缺对象。
  styles["body-text"] = createDefaultStyleDraft("body-text");
  if (templateId === "default-report") {
    styles.title = {
      ...styles.title,
      chineseFont: "宋体",
      latinFont: "Times New Roman",
      fontSize: 18,
      align: "center",
      afterSpacing: 24,
    };
    const defaultReportHeadingSizes: Record<string, number> = {
      "heading-1": 16,
      "heading-2": 15,
      "heading-3": 14,
      "heading-4": 12,
      "heading-5": 10.5,
      "heading-6": 9,
    };
    for (const [styleId, fontSize] of Object.entries(defaultReportHeadingSizes)) {
      styles[styleId] = {
        ...styles[styleId],
        chineseFont: "宋体",
        latinFont: "Times New Roman",
        fontSize,
      };
    }
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
    styles["bullet-list"] = inheritListTextFromBody({
      ...styles["bullet-list"],
    }, styles.normal);
    styles["numbered-list"] = inheritListTextFromBody({
      ...styles["numbered-list"],
    }, styles.normal);
    styles["nested-list"] = inheritListTextFromBody({
      ...styles["nested-list"],
    }, styles.normal);
    styles["source-code"] = {
      ...styles["source-code"],
      latinFont: "Consolas",
      fontSize: 9,
      color: "#111827",
      backgroundColor: "#F8FAFC",
      codeBlockPreset: "document",
      codeBorderColor: "#E2E8F0",
      codeBorderRadius: 0,
      lineHeight: "1.55",
    };
    styles["inline-code"] = {
      ...styles["inline-code"],
      chineseFont: "Microsoft YaHei UI",
      latinFont: "Consolas",
      fontSize: 10.5,
      color: "#111827",
      backgroundColor: "#F1F5F9",
      codeBorderColor: "#CBD5E1",
      codeBorderRadius: 0,
      codePaddingX: 4,
      codePaddingY: 1,
      lineHeight: "1.35",
      firstLineIndent: 0,
    };
    styles.quote = {
      ...styles.quote,
      fontSize: 10.5,
      color: "#475569",
      backgroundColor: "#F8FAFC",
      quoteBorderColor: "#94A3B8",
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
    styles.title = { ...styles.title, chineseFont: "宋体", fontSize: 24, color: "#111827", align: "center", afterSpacing: 28 };
    styles["heading-1"] = { ...styles["heading-1"], chineseFont: "宋体", fontSize: 22, color: "#111827", align: "left", autoNumbering: false };
    styles["heading-2"] = { ...styles["heading-2"], chineseFont: "黑体", fontSize: 16, color: "#111827", numberFormat: "一、" };
    styles.normal = { ...styles.normal, chineseFont: "仿宋", fontSize: 12, lineHeight: "1.85", firstLineIndent: 2, color: "#111827" };
    styles.quote = { ...styles.quote, chineseFont: "仿宋", backgroundColor: "#FFFFFF", color: "#374151" };
    styles.table = { ...styles.table, tablePreset: "official", rowStripe: false, borderColor: "#111827", headerBackgroundColor: "#FFFFFF", headerBorderColor: "#111827", bodyBorderColor: "#111827" };
  }

  if (templateId === "technical-spec") {
    styles.title = { ...styles.title, fontSize: 24, color: "#1D4ED8", align: "left", afterSpacing: 22 };
    styles["heading-1"] = { ...styles["heading-1"], fontSize: 22, color: "#1D4ED8", align: "left" };
    styles["heading-2"] = { ...styles["heading-2"], fontSize: 16, color: "#1D4ED8" };
    styles.normal = { ...styles.normal, fontSize: 11, lineHeight: "1.7", firstLineIndent: 0, align: "left" };
    styles["source-code"] = { ...styles["source-code"], fontSize: 9, codeBlockPreset: "terminal", backgroundColor: "#0F172A", color: "#E2E8F0", codeBorderColor: "#334155", codeBorderRadius: 0, codePaddingX: 14, codePaddingY: 12 };
    styles.table = { ...styles.table, tablePreset: "grid", tableLayout: "fixed", rowStripe: false, borderColor: "#64748B", headerBackgroundColor: "#F1F5F9", headerBorderColor: "#64748B", bodyBorderColor: "#64748B" };
  }

  // body-text 不在 styleNodes 中（UI 不单独编辑），必须从 normal 派生出完整草稿，
  // 否则导出侧读到残缺对象会静默回退到 Rust 硬编码默认值。
  styles["body-text"] = { ...styles.normal, styleId: "body-text" };

  styles["bullet-list"] = inheritListTextFromBody(styles["bullet-list"], styles.normal);
  styles["numbered-list"] = inheritListTextFromBody(styles["numbered-list"], styles.normal);
  styles["nested-list"] = inheritListTextFromBody(styles["nested-list"], styles.normal);

  styles["table-header"] = { ...styles.table, styleId: "table-header" };
  styles["table-body"] = { ...styles.table, styleId: "table-body" };
  styles["table-caption"] = { ...styles.table, ...styles["table-caption"], styleId: "table-caption" };

  return {
    templateId,
    styles,
    pageSettings: defaultPageSettings,
    markdownFeatures: defaultMarkdownFeatures,
    markdownRules: builtInTemplateIds.has(templateId) ? builtInMarkdownRules : defaultMarkdownRules,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeFontWeight(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "400";
  return String(Math.min(800, Math.max(300, Math.round(numeric / 100) * 100)));
}

function normalizeLegacyStyleDraft(styleId: string, draft: Partial<StyleDraft>, fallback = createDefaultStyleDraft(styleId)): StyleDraft {
  let normalized: StyleDraft = {
    ...fallback,
    ...draft,
    styleId,
    fontWeight: normalizeFontWeight(draft.fontWeight ?? fallback.fontWeight),
    firstLineIndent: draft.firstLineIndent ?? fallback.firstLineIndent,
  };
  if (styleNodes.find((node) => node.id === styleId)?.kind === "list") {
    normalized = {
      ...normalized,
      listLevel1ChineseFont: draft.listLevel1ChineseFont ?? normalized.chineseFont,
      listLevel2ChineseFont: draft.listLevel2ChineseFont ?? normalized.chineseFont,
      listLevel3ChineseFont: draft.listLevel3ChineseFont ?? normalized.chineseFont,
      listLevel4ChineseFont: draft.listLevel4ChineseFont ?? normalized.chineseFont,
      listLevel1LatinFont: draft.listLevel1LatinFont ?? normalized.latinFont,
      listLevel2LatinFont: draft.listLevel2LatinFont ?? normalized.latinFont,
      listLevel3LatinFont: draft.listLevel3LatinFont ?? normalized.latinFont,
      listLevel4LatinFont: draft.listLevel4LatinFont ?? normalized.latinFont,
      listLevel1FontSize: draft.listLevel1FontSize ?? normalized.fontSize,
      listLevel2FontSize: draft.listLevel2FontSize ?? normalized.fontSize,
      listLevel3FontSize: draft.listLevel3FontSize ?? normalized.fontSize,
      listLevel4FontSize: draft.listLevel4FontSize ?? normalized.fontSize,
      listLevel1FontWeight: normalizeFontWeight(draft.listLevel1FontWeight ?? normalized.fontWeight),
      listLevel2FontWeight: normalizeFontWeight(draft.listLevel2FontWeight ?? normalized.fontWeight),
      listLevel3FontWeight: normalizeFontWeight(draft.listLevel3FontWeight ?? normalized.fontWeight),
      listLevel4FontWeight: normalizeFontWeight(draft.listLevel4FontWeight ?? normalized.fontWeight),
      listLevel1Color: draft.listLevel1Color ?? normalized.color,
      listLevel2Color: draft.listLevel2Color ?? normalized.color,
      listLevel3Color: draft.listLevel3Color ?? normalized.color,
      listLevel4Color: draft.listLevel4Color ?? normalized.color,
      listLevel1LineHeight: draft.listLevel1LineHeight ?? normalized.lineHeight,
      listLevel2LineHeight: draft.listLevel2LineHeight ?? normalized.lineHeight,
      listLevel3LineHeight: draft.listLevel3LineHeight ?? normalized.lineHeight,
      listLevel4LineHeight: draft.listLevel4LineHeight ?? normalized.lineHeight,
      listLevel1BeforeSpacing: draft.listLevel1BeforeSpacing ?? normalized.beforeSpacing,
      listLevel2BeforeSpacing: draft.listLevel2BeforeSpacing ?? normalized.beforeSpacing,
      listLevel3BeforeSpacing: draft.listLevel3BeforeSpacing ?? normalized.beforeSpacing,
      listLevel4BeforeSpacing: draft.listLevel4BeforeSpacing ?? normalized.beforeSpacing,
      listLevel1AfterSpacing: draft.listLevel1AfterSpacing ?? normalized.afterSpacing,
      listLevel2AfterSpacing: draft.listLevel2AfterSpacing ?? normalized.afterSpacing,
      listLevel3AfterSpacing: draft.listLevel3AfterSpacing ?? normalized.afterSpacing,
      listLevel4AfterSpacing: draft.listLevel4AfterSpacing ?? normalized.afterSpacing,
      listLevel1Align: draft.listLevel1Align ?? normalized.align,
      listLevel2Align: draft.listLevel2Align ?? normalized.align,
      listLevel3Align: draft.listLevel3Align ?? normalized.align,
      listLevel4Align: draft.listLevel4Align ?? normalized.align,
      listLevel1Indent: draft.listLevel1Indent ?? normalized.listIndent,
      listLevel2Indent: draft.listLevel2Indent ?? normalized.listIndent + normalized.nestedIndentStep,
      listLevel3Indent: draft.listLevel3Indent ?? normalized.listIndent + normalized.nestedIndentStep * 2,
      listLevel4Indent: draft.listLevel4Indent ?? normalized.listIndent + normalized.nestedIndentStep * 3,
      listLevel1TextIndent: draft.listLevel1TextIndent ?? normalized.listTextIndent,
      listLevel2TextIndent: draft.listLevel2TextIndent ?? normalized.listTextIndent,
      listLevel3TextIndent: draft.listLevel3TextIndent ?? normalized.listTextIndent,
      listLevel4TextIndent: draft.listLevel4TextIndent ?? normalized.listTextIndent,
      listLevel1WrapMode: draft.listLevel1WrapMode ?? normalized.listWrapMode,
      listLevel2WrapMode: draft.listLevel2WrapMode ?? normalized.listWrapMode,
      listLevel3WrapMode: draft.listLevel3WrapMode ?? normalized.listWrapMode,
      listLevel4WrapMode: draft.listLevel4WrapMode ?? normalized.listWrapMode,
      listLevel1NumberingMode: draft.listLevel1NumberingMode ?? normalized.listNumberingMode,
      listLevel2NumberingMode: draft.listLevel2NumberingMode ?? normalized.listNumberingMode,
      listLevel3NumberingMode: draft.listLevel3NumberingMode ?? normalized.listNumberingMode,
      listLevel4NumberingMode: draft.listLevel4NumberingMode ?? normalized.listNumberingMode,
    };
  }
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
  const storedMarkdownRules = config?.markdownRules as (Partial<MarkdownRulesSettings> & { headingMappingMode?: string }) | undefined;
  const legacyHeadingMappings = storedMarkdownRules?.headingMappingMode === "title-offset"
    ? {
      "heading-1": "title",
      "heading-2": "heading-1",
      "heading-3": "heading-2",
      "heading-4": "heading-3",
      "heading-5": "heading-4",
      "heading-6": "heading-5",
    } as const
    : {};
  const styles = Object.fromEntries(
    Object.entries({
      ...defaults.styles,
      ...(config?.styles ?? {}),
    }).map(([styleId, draft]) => [styleId, normalizeLegacyStyleDraft(styleId, draft, defaults.styles[styleId] ?? createDefaultStyleDraft(styleId))]),
  );
  if (templateId === "default-report") {
    const legacyDefaults: Record<string, { chineseFont: string; fontSize: number }> = {
      title: { chineseFont: "宋体", fontSize: 24 },
      "heading-1": { chineseFont: "微软雅黑", fontSize: 22 },
      "heading-2": { chineseFont: "微软雅黑", fontSize: 18 },
      "heading-3": { chineseFont: "微软雅黑", fontSize: 16 },
      "heading-4": { chineseFont: "微软雅黑", fontSize: 15 },
      "heading-5": { chineseFont: "微软雅黑", fontSize: 14 },
      "heading-6": { chineseFont: "微软雅黑", fontSize: 12 },
    };
    for (const [styleId, legacy] of Object.entries(legacyDefaults)) {
      const current = styles[styleId];
      if (current?.chineseFont === legacy.chineseFont && current.fontSize === legacy.fontSize) {
        styles[styleId] = defaults.styles[styleId];
      }
    }
  }
  const legacyDefaultHeadingOneDrafts = [
    { ...defaults.styles["heading-1"], fontSize: 20, align: "center" as const },
    { ...defaults.styles["heading-1"], fontSize: 20, align: "left" as const },
    { ...defaults.styles["heading-1"], fontSize: 22, align: "center" as const },
  ];
  if (legacyDefaultHeadingOneDrafts.some((draft) => JSON.stringify(styles["heading-1"]) === JSON.stringify(draft))) {
    styles["heading-1"] = defaults.styles["heading-1"];
  }
  const legacyHeadingFontSizes: Record<string, number> = { "heading-4": 14, "heading-5": 12, "heading-6": 10 };
  for (const [styleId, legacyFontSize] of Object.entries(legacyHeadingFontSizes)) {
    const legacyDraft = { ...defaults.styles[styleId], fontSize: legacyFontSize };
    if (JSON.stringify(styles[styleId]) === JSON.stringify(legacyDraft)) {
      styles[styleId] = defaults.styles[styleId];
    }
  }

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
    markdownRules: {
      headingMappings: {
        ...defaults.markdownRules.headingMappings,
        ...legacyHeadingMappings,
        ...(storedMarkdownRules?.headingMappings ?? {}),
      },
    },
  };
}

export const markdownMappings = [
  ["#", "Heading 1"],
  ["##", "Heading 2"],
  ["###", "Heading 3"],
  ["####", "Heading 4"],
  ["#####", "Heading 5"],
  ["######", "Heading 6"],
  ["正文段落", "Normal"],
  ["> 引用块", "Quote"],
  ["```code```", "Source Code"],
  ["`inline code`", "Inline Code"],
  ["---", "Horizontal Rule"],
  ["$...$ / $$...$$ / ```math", "Word 公式（自动转换）"],
  ["表格", "Table"],
  ["表头", "Table Header"],
  ["表格体", "Table Body"],
  ["表格题注", "Table Caption"],
  ["图片题注", "Caption"],
] as const;

export const batchActions = ["统一标题字体", "按层级自动缩放字号", "复制 Heading 2 设置到 Heading 3-6", "恢复 Pandoc 默认样式", "从当前 DOCX 重新读取样式"];
