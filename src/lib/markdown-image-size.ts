import type MarkdownIt from "markdown-it";

// Pandoc image dimensions, used for images inside Markdown tables.
export function markdownImageSizePlugin(md: MarkdownIt) {
  md.inline.ruler.before("text", "image_size", (state, silent) => {
    const image = state.tokens[state.tokens.length - 1];
    if (image?.type !== "image" || state.pending || state.src[state.pos] !== "{") return false;
    const match = /^\{([^{}\n]+)\}/.exec(state.src.slice(state.pos));
    if (!match) return false;
    const attributes: Array<[string, string]> = [];
    for (const part of match[1].trim().split(/\s+/)) {
      const attribute = /^(width|height)=(?:"((?:\d+(?:\.\d+)?|\.\d+)(?:cm|mm|in|pt|px))"|((?:\d+(?:\.\d+)?|\.\d+)(?:cm|mm|in|pt|px)))$/i.exec(part);
      if (!attribute) return false;
      const value = attribute[2] ?? attribute[3];
      if (!(Number.parseFloat(value) > 0) || attributes.some(([name]) => name === attribute[1].toLowerCase())) return false;
      attributes.push([attribute[1].toLowerCase(), value.toLowerCase()]);
    }
    if (!silent) for (const [name, value] of attributes) image.attrSet(name, value);
    state.pos += match[0].length;
    return true;
  });
}

export function imageLengthPixels(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(cm|mm|in|pt|px)$/i.exec(value);
  if (!match) return undefined;
  const unit = match[2].toLowerCase();
  return Number(match[1]) * ({ cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, px: 1 }[unit] ?? 1);
}
