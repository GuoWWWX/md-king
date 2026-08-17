import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

type RevealHighlightRange = {
  from: number;
  to: number;
};

export const setRevealHighlightEffect = StateEffect.define<RevealHighlightRange | null>();

export const revealHighlightExtension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setRevealHighlightEffect)) continue;
      const range = effect.value;
      next = range && range.to > range.from
        ? Decoration.set([Decoration.mark({ class: "mk-cm-reveal-highlight" }).range(range.from, range.to)])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
