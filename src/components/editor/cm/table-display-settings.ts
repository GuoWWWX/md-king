import { StateEffect } from "@codemirror/state";

export type TableWidthMode = "content" | "window";

export type TableDisplaySettings = {
  defaultWidthMode: TableWidthMode;
  widthModeOverrides: ReadonlyMap<number, TableWidthMode>;
};

export type SetTableWidthMode = {
  scope: "global" | "table";
  mode: TableWidthMode;
  tableFrom?: number;
};

export const tableContextChangeEvent = "mk-table-context-change";
export const setTableWidthModeEffect = StateEffect.define<SetTableWidthMode>();
export const resetTableDisplaySettingsEffect = StateEffect.define<TableWidthMode>();

export function createTableDisplaySettings(defaultWidthMode: TableWidthMode = "content"): TableDisplaySettings {
  return { defaultWidthMode, widthModeOverrides: new Map() };
}

export function mapTableDisplaySettings(
  settings: TableDisplaySettings,
  mapPosition: (position: number) => number,
): TableDisplaySettings {
  const widthModeOverrides = new Map<number, TableWidthMode>();
  settings.widthModeOverrides.forEach((mode, position) => {
    widthModeOverrides.set(mapPosition(position), mode);
  });
  return { ...settings, widthModeOverrides };
}

export function applyTableWidthMode(
  settings: TableDisplaySettings,
  change: SetTableWidthMode,
): TableDisplaySettings {
  if (change.scope === "global") {
    // 未选中表格时，顶栏操作必须立即覆盖当前文档的全部表格。
    return { defaultWidthMode: change.mode, widthModeOverrides: new Map() };
  }
  if (change.tableFrom === undefined) return settings;
  const widthModeOverrides = new Map(settings.widthModeOverrides);
  widthModeOverrides.set(change.tableFrom, change.mode);
  return { ...settings, widthModeOverrides };
}

export function tableWidthModeFor(settings: TableDisplaySettings, tableFrom: number): TableWidthMode {
  return settings.widthModeOverrides.get(tableFrom) ?? settings.defaultWidthMode;
}
