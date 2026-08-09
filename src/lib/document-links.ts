import { parseMarkdownOutline } from "@/lib/document-outline";

export function isExternalDocumentLink(target: string) {
  return /^(?:https?:|mailto:)/i.test(target.trim());
}

function decodeLinkPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function markdownHeadingAnchor(text: string) {
  const anchor = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s_.-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return anchor || "section";
}

export function nextMarkdownHeadingAnchor(text: string, counts: Map<string, number>) {
  const base = markdownHeadingAnchor(text);
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function findMarkdownHeadingLine(markdown: string, target: string) {
  const requested = decodeLinkPart(target.trim().replace(/^#/, ""));
  const counts = new Map<string, number>();
  for (const heading of parseMarkdownOutline(markdown)) {
    if (nextMarkdownHeadingAnchor(heading.text, counts) === requested) return heading.line;
  }
  return undefined;
}

function normalizeRelativePath(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function resolveVaultDocumentLink(target: string, currentPath: string, availablePaths: readonly string[]) {
  const rawPath = target.trim().split("#", 1)[0].split("?", 1)[0];
  if (!rawPath || isExternalDocumentLink(rawPath) || /^(?:[a-z]+:|\/|[a-z]:[\\/])/i.test(rawPath)) return undefined;

  const decodedPath = decodeLinkPart(rawPath);
  const parent = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
  const normalized = normalizeRelativePath(parent ? `${parent}/${decodedPath}` : decodedPath);
  if (!normalized) return undefined;

  const pathsByLowerCase = new Map(availablePaths.map((path) => [path.toLocaleLowerCase(), path]));
  const candidates = /\.(?:md|markdown|txt)$/i.test(normalized)
    ? [normalized]
    : [normalized, `${normalized}.md`, `${normalized}.markdown`, `${normalized}.txt`];
  for (const candidate of candidates) {
    const matched = pathsByLowerCase.get(candidate.toLocaleLowerCase());
    if (matched) return matched;
  }
  return undefined;
}
