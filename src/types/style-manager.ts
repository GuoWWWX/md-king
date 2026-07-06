export type StyleGroupKey = "headings" | "blocks" | "lists" | "tables";

export type StyleNodeKind = "heading" | "paragraph" | "block" | "code" | "list" | "table";

export type HorizontalAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "middle" | "bottom";
export type TableLayoutMode = "auto" | "fixed";
export type BorderStyleMode = "solid" | "dashed" | "dotted" | "double" | "none";
export type ColumnWidthMode = "auto" | "custom";
export type TablePresetKey = "business" | "official" | "grid" | "striped";

export type StyleNode = {
  id: string;
  name: string;
  displayName: string;
  group: StyleGroupKey;
  kind: StyleNodeKind;
  markdown: string;
  description: string;
  warning?: string;
};

export type StyleDraft = {
  styleId: string;
  chineseFont: string;
  latinFont: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  lineHeight: string;
  firstLineIndent: number;
  beforeSpacing: number;
  afterSpacing: number;
  align: HorizontalAlign;
  autoNumbering: boolean;
  numberFormat: string;
  backgroundColor: string;
  tableLayout: TableLayoutMode;
  fitToPageWidth: boolean;
  tableWidthPercent: number;
  tableHorizontalAlign: Exclude<HorizontalAlign, "justify">;
  columnWidthMode: ColumnWidthMode;
  firstColumnWidth: number;
  secondColumnWidth: number;
  thirdColumnWidth: number;
  cellVerticalAlign: VerticalAlign;
  cellPaddingX: number;
  cellPaddingY: number;
  cellWrap: boolean;
  minRowHeight: number;
  rowStripe: boolean;
  borderStyle: BorderStyleMode;
  borderColor: string;
  borderWidth: number;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  headerBorderColor: string;
  headerBorderWidth: number;
  bodyBorderColor: string;
  bodyBorderWidth: number;
  outerBorderStrong: boolean;
  showInnerVerticalBorder: boolean;
  showInnerHorizontalBorder: boolean;
  headerBold: boolean;
  headerAlign: Exclude<HorizontalAlign, "justify">;
  headerVerticalAlign: VerticalAlign;
  headerBackgroundColor: string;
  headerFontSize: number;
  headerLineHeight: string;
  bodyAlign: Exclude<HorizontalAlign, "justify">;
  bodyVerticalAlign: VerticalAlign;
  bodyFontSize: number;
  bodyLineHeight: string;
  bodyBackgroundColor: string;
  captionAlign: Exclude<HorizontalAlign, "justify">;
  captionNumbering: boolean;
  tablePreset: TablePresetKey;
};

export type PaperSize = "A3" | "A4" | "A5" | "A6" | "B4" | "B5" | "B6" | "Letter" | "Legal" | "Executive" | "Tabloid" | "K16" | "K32";
export type FooterPageNumberFormat = "page" | "page-total" | "dash" | "none";

export type PageSettingsDraft = {
  paperSize: PaperSize;
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerEnabled: boolean;
  headerText: string;
  footerEnabled: boolean;
  footerText: string;
  footerPageNumberFormat: FooterPageNumberFormat;
  footerShowFromPage: number;
  footerStartPage: number;
  tocEnabled: boolean;
  tocDepth: string;
};

export type MarkdownFeatureSettings = {
  inlineCode: boolean;
  codeBlock: boolean;
  quoteBlock: boolean;
  horizontalRule: boolean;
};

export type TemplateStyleConfig = {
  templateId: string;
  styles: Record<string, StyleDraft>;
  pageSettings: PageSettingsDraft;
  markdownFeatures: MarkdownFeatureSettings;
  updatedAt: string;
};
