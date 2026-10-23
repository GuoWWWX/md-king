import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { NodeProp } from "@lezer/common";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxPaletteFor } from "../../../lib/syntax-palette.ts";
import { yamlLanguageDescription as yaml, yamlNodeKind } from "../../../lib/yaml-syntax.ts";

function decorations(view: EditorView): DecorationSet {
  if (!yaml.support) return Decoration.none;
  const top = yaml.support.language.parser.parse("").type;
  const palette = syntaxPaletteFor(view.state.facet(EditorView.darkTheme));
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) syntaxTree(view.state).iterate({
    from, to,
    enter(node) {
      const mounted = node.tree?.prop(NodeProp.mounted);
      if (mounted?.tree.type !== top || !mounted.overlay?.length) return;
      // Markdown mounts fenced languages as overlays; normal tree iteration skips them.
      const inner = node.node.enter(node.from + mounted.overlay[0].from, 1);
      inner?.cursor().iterate(scalar => {
        if (scalar.to <= from || scalar.from >= to) return false;
        if (!["Literal", "QuotedLiteral", "BlockLiteralContent"].includes(scalar.name)) return;
        const kind = yamlNodeKind(scalar, view.state.doc.sliceString(scalar.from, scalar.to));
        if (!kind) return;
        for (const overlay of mounted.overlay!) {
          const start = Math.max(from, scalar.from, node.from + overlay.from), end = Math.min(to, scalar.to, node.from + overlay.to);
          if (end > start) marks.push(Decoration.mark({ attributes: { style: `color:${palette[kind]}`, "data-yaml-kind": kind } }).range(start, end));
        }
      });
      return false;
    },
  });
  return Decoration.set(marks, true);
}

/** Lezer YAML intentionally leaves plain scalar types to consumers; add display colors only. */
export const yamlHighlighting = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)
      || update.startState.facet(EditorView.darkTheme) !== update.state.facet(EditorView.darkTheme)) {
      this.decorations = decorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });
