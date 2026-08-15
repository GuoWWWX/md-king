import { parseMarkdownOutline } from "./document-outline.ts";

export type ObsidianWikilink = {
  target: string;
  label: string;
};

export type ObsidianWikilinkMatch = ObsidianWikilink & {
  from: number;
  to: number;
  displayFrom: number;
  displayTo: number;
};

export function isExternalDocumentLink(target: string) {
  return /^(?:https?:|mailto:)/i.test(target.trim());
}

function isEscapedAt(source: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function trimmedRange(source: string, from: number, to: number) {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return { from: start, to: end };
}

/**
 * 解析 Obsidian 的 `[[目标]]` 与 `[[目标|显示名]]`。
 *
 * 这里只识别链接本身，不处理 `![[...]]` 嵌入语法；嵌入需要单独定义文件内容的
 * 渲染规则，不能悄悄把它降级为普通链接。
 */
export function parseObsidianWikilink(source: string): ObsidianWikilink | undefined {
  if (!source.startsWith("[[") || !source.endsWith("]]")) return undefined;
  const inner = source.slice(2, -2);
  if (!inner || /[\r\n\[\]]/.test(inner)) return undefined;

  const separator = inner.indexOf("|");
  const target = (separator < 0 ? inner : inner.slice(0, separator)).trim();
  const label = (separator < 0 ? target : inner.slice(separator + 1)).trim();
  if (!target || !label || /^(?:javascript|data|vbscript):/i.test(target)) return undefined;
  return { target, label };
}

/** 找出单行内可渲染的 Obsidian wikilink，并保留显示文字的位置。 */
export function findObsidianWikilinks(source: string): ObsidianWikilinkMatch[] {
  const matches: ObsidianWikilinkMatch[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const from = source.indexOf("[[", cursor);
    if (from < 0) break;
    if (source[from - 1] === "!" || isEscapedAt(source, from)) {
      cursor = from + 2;
      continue;
    }
    const close = source.indexOf("]]", from + 2);
    if (close < 0) break;
    const to = close + 2;
    const parsed = parseObsidianWikilink(source.slice(from, to));
    if (!parsed) {
      cursor = from + 2;
      continue;
    }

    const separator = source.indexOf("|", from + 2);
    const displayRange = separator >= from + 2 && separator < close
      ? trimmedRange(source, separator + 1, close)
      : trimmedRange(source, from + 2, close);
    if (displayRange.from >= displayRange.to) {
      cursor = to;
      continue;
    }
    matches.push({ ...parsed, from, to, displayFrom: displayRange.from, displayTo: displayRange.to });
    cursor = to;
  }
  return matches;
}

export function normalizeBareExternalLink(value: string) {
  const cjkPunctuation = value.search(/[，。；：！？]/u);
  const candidate = cjkPunctuation >= 0 ? value.slice(0, cjkPunctuation) : value;
  let end = candidate.length;
  while (end > 0 && /[.,;:!?]/.test(candidate[end - 1])) end -= 1;
  while (end > 0 && candidate[end - 1] === ")") {
    const body = candidate.slice(0, end);
    if ((body.match(/\(/g) ?? []).length >= (body.match(/\)/g) ?? []).length) break;
    end -= 1;
  }
  return candidate.slice(0, end);
}

/** 找出直接粘贴的 http(s) 地址，末尾的中文句号或英文标点不属于链接。 */
export function findBareExternalLinks(source: string) {
  const matches: Array<{ from: number; to: number; target: string }> = [];
  const pattern = /\bhttps?:\/\/[^\s<>"'`\[\]{}]+/giu;
  for (const match of source.matchAll(pattern)) {
    const target = normalizeBareExternalLink(match[0]);
    if (!target || match.index === undefined) continue;
    matches.push({ from: match.index, to: match.index + target.length, target });
  }
  return matches;
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

export function documentLinkFragment(target: string) {
  const value = target.trim();
  const hash = value.indexOf("#");
  if (hash < 0 || hash === value.length - 1) return undefined;
  return `#${value.slice(hash + 1)}`;
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
