export const CODE_BLOCK_INDENT_STEP_PT = 24;
export const CODE_BLOCK_INDENT_MAX_PT = 144;
const INDENT_ATTRIBUTE = "data-md-king-indent-pt";

export function codeBlockIndentAttributeRange(info: string): { from: number; to: number } | null {
  const onlyIndentAttribute = /^(.*?)(\s*)\{\s*data-md-king-indent-pt\s*=\s*(?:"[^"]*"|'[^']*'|[^\s}]+)\s*\}\s*$/i.exec(info);
  if (onlyIndentAttribute) {
    const from = onlyIndentAttribute[1].length;
    return { from, to: info.length };
  }
  const match = /(?:\s*)data-md-king-indent-pt\s*=\s*(?:"[^"]*"|'[^']*'|[^\s}]+)/i.exec(info);
  return match ? { from: match.index, to: match.index + match[0].length } : null;
}

export function selectionCoversCodeFence(
  selection: { from: number; to: number },
  openingLine: { from: number; to: number },
  closingLine: { from: number; to: number },
): boolean {
  return selection.from < selection.to
    && selection.from <= openingLine.to
    && selection.to >= closingLine.from;
}

export function normalizeCodeBlockIndentPt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const stepped = Math.round(value / CODE_BLOCK_INDENT_STEP_PT) * CODE_BLOCK_INDENT_STEP_PT;
  return Math.max(0, Math.min(CODE_BLOCK_INDENT_MAX_PT, stepped));
}

export function codeBlockIndentPtFromInfo(info: string | undefined): number {
  const match = info?.match(/(?:^|[\s{])data-md-king-indent-pt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  return normalizeCodeBlockIndentPt(Number(raw ?? 0));
}

export function codeFenceLanguageFromInfo(info: string | undefined): string {
  const trimmed = info?.trim() ?? "";
  if (!trimmed) return "";
  const normalized = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  for (const token of normalized.split(/\s+/)) {
    const candidate = token.trim().replace(/^\.+/, "");
    if (!candidate || candidate.startsWith("#") || candidate.includes("=")) continue;
    const language = candidate.replace(/[^\p{L}\p{N}+#\-_.]/gu, "");
    if (language) return language;
  }
  return "";
}

export function updateCodeFenceIndentInfo(info: string, indentPt: number): string {
  const nextIndent = normalizeCodeBlockIndentPt(indentPt);
  const trimmed = info.trim();
  const attributeBlock = trimmed.match(/^(.*?)(?:\s*)\{([^{}]*)\}\s*$/);
  const prefix = attributeBlock?.[1]?.trim() ?? trimmed;
  const attributes = (attributeBlock?.[2] ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.toLowerCase().startsWith(`${INDENT_ATTRIBUTE}=`));

  if (nextIndent > 0) attributes.push(`${INDENT_ATTRIBUTE}="${nextIndent}"`);
  const block = attributes.length > 0 ? `{${attributes.join(" ")}}` : "";
  return [prefix, block].filter(Boolean).join(" ");
}

export function codeBlockIndentClass(indentPt: number): string {
  const level = normalizeCodeBlockIndentPt(indentPt) / CODE_BLOCK_INDENT_STEP_PT;
  return level > 0 ? `mk-cm-code-indent-${level}` : "";
}
