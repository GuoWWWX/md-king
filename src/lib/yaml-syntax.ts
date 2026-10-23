import { languages } from "@codemirror/language-data";
import type { SyntaxNodeRef } from "@lezer/common";
import type { SyntaxPalette } from "./syntax-palette.ts";

export const yamlLanguageDescription = languages.find(language => language.name === "YAML")!;

/** YAML core scalars; duration/unit values such as 2000ms remain strings. */
export function yamlScalarKind(text: string): "number" | "keyword" | "string" {
  if (/^(?:true|false|null|~)$/i.test(text)) return "keyword";
  if (/^[+-]?(?:0x[\da-f]+|0o[0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|\.inf|\.nan)$/i.test(text)) return "number";
  return "string";
}

export function yamlNodeKind(node: SyntaxNodeRef, text: string): keyof SyntaxPalette | undefined {
  if ((node.name === "Literal" || node.name === "QuotedLiteral") && node.node.parent?.name === "Key") return "function";
  if (node.name === "Literal") return yamlScalarKind(text);
  if (node.name === "QuotedLiteral" || node.name === "BlockLiteralContent") return "string";
  if (node.name === "Comment") return "comment";
  if (["DirectiveName", "Anchor", "Alias"].includes(node.name)) return "keyword";
  if (node.name === "Tag") return "function";
  if ([":", ",", "-", "?", "[", "]", "{", "}", "DirectiveEnd", "DocEnd", "BlockLiteralHeader"].includes(node.name)) return "operator";
  return undefined;
}

export async function yamlHighlightTokens(source: string) {
  const support = await yamlLanguageDescription.load();
  const tokens: Array<{ from: number; to: number; kind: keyof SyntaxPalette }> = [];
  support.language.parser.parse(source).iterate({ enter(node) {
    const kind = yamlNodeKind(node, source.slice(node.from, node.to));
    if (kind) tokens.push({ from: node.from, to: node.to, kind });
  } });
  return tokens;
}
