const unnumberedAttribute = /\s*\{([^{}]*)\}\s*$/;

export function parseUnnumberedHeadingText(source: string) {
  const match = source.match(unnumberedAttribute);
  if (!match) return { text: source.trim(), unnumbered: false };
  const unnumbered = match[1]
    .split(/\s+/)
    .some((value) => value === "-" || value === ".unnumbered" || value === "unnumbered");
  return unnumbered
    ? { text: source.slice(0, match.index).trimEnd(), unnumbered: true }
    : { text: source.trim(), unnumbered: false };
}

export function isConventionalUnnumberedHeading(text: string) {
  return ["摘要", "前言", "参考文献", "附录说明", "Abstract", "ABSTRACT"].includes(text.trim());
}
