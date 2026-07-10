export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "indigo" | "blue" | "emerald" | "sky" | "slate" | "rose" | "amber";
export type DefaultConflictStrategy = "overwrite" | "rename" | "ask";

export type AppConfig = {
  pandocPath?: string;
  useBundledPandoc: boolean;
  defaultTemplateId: string;
  defaultOutputDir?: string;
  openAfterConvert: boolean;
  enableContextMenu: boolean;
  enableFloatingBall: boolean;
  enableTray: boolean;
  enableQuickPaste: boolean;
  quickPasteShortcut: string;
  quickPasteTemplateId?: string;
  cliDefaultJson: boolean;
  logLevel: "error" | "warn" | "info" | "debug";
  language: "zh" | "en";
  themeMode: ThemeMode;
  accentColor: AccentColor;
  defaultConflictStrategy: DefaultConflictStrategy;
  keepConversionLog: boolean;
};

export type AppStatus = {
  name: string;
  version: string;
  description: string;
  tauriVersion: string;
  platform: string;
};
