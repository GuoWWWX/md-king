import type { MermaidConfig } from "mermaid";

export type MermaidThemeId = "redux-color" | "redux-dark-color" | "redux" | "redux-dark" | "neo" | "neo-dark" | "default" | "dark" | "forest" | "neutral" | "base";
export type MermaidThemeSelection = { light: MermaidThemeId; dark: MermaidThemeId; diagrams: Record<string, { light?: MermaidThemeId; dark?: MermaidThemeId }> };
export type MermaidThemePreset = MermaidThemeSelection & { name: string };
export type MermaidThemeSettings = MermaidThemeSelection & { presets?: MermaidThemePreset[] };
export const MERMAID_THEMES: ReadonlyArray<{ id: MermaidThemeId; label: string }>;
export const MERMAID_DIAGRAM_TYPES: ReadonlyArray<{ id: string; label: string }>;
export function normalizeMermaidThemes(value?: Partial<MermaidThemeSettings>): MermaidThemeSettings;
export function mermaidDiagramType(source: string): string;
export function resolveMermaidTheme(source: string, dark: boolean, settings?: MermaidThemeSettings): MermaidThemeId;
export function mermaidConfig(theme: "default" | "dark", selectedTheme?: MermaidThemeId): MermaidConfig;

export function layoutMermaidKanban(root: SVGSVGElement): boolean;

export function styleMermaidEdgeLabels(root: SVGSVGElement, dark: boolean): void;

export function ensureMermaidContrast(root: SVGSVGElement, dark: boolean): void;
export function contrastRatio(first: number[], second: number[]): number;
