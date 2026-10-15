import type { MermaidConfig } from "mermaid";

export function mermaidConfig(theme: "default" | "dark"): MermaidConfig;

export function styleMermaidEdgeLabels(root: SVGSVGElement, dark: boolean): void;

export function ensureMermaidContrast(root: SVGSVGElement, dark: boolean): void;
export function contrastRatio(first: number[], second: number[]): number;
