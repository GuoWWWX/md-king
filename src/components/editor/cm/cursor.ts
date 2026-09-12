import { EditorView, layer, RectangleMarker } from "@codemirror/view";

// 只绘制输入光标，保留浏览器原生选区；drawSelection 会同时改变选区的行尾填充。
export function markdownCursorExtension(isDark: boolean) {
  return [
  layer({
    above: true,
    class: "cm-cursorLayer",
    mount(dom) { dom.classList.add("mk-cm-cursor-layer"); },
    markers(view) {
      if (view.state.readOnly || !view.state.facet(EditorView.editable)) return [];
      return view.state.selection.ranges.flatMap((range) =>
        range.empty ? RectangleMarker.forRange(view, "cm-cursor", range) : [],
      );
    },
    update(update, dom) {
      if (update.docChanged || update.selectionSet) {
        dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
      }
      return update.docChanged || update.selectionSet || update.geometryChanged || update.focusChanged
        || update.startState.readOnly !== update.state.readOnly
        || update.startState.facet(EditorView.editable) !== update.state.facet(EditorView.editable);
    },
  }),
  EditorView.theme({
    ".cm-content, .cm-line": { caretColor: "transparent !important" },
    // 表格等 widget 内的独立输入框仍使用它自己的原生光标。
    ".cm-content :focus": { caretColor: "auto !important" },
    ".mk-cm-cursor-layer .cm-cursor": {
      borderLeftWidth: "3px",
      borderLeftColor: isDark ? "#79a7df" : "#5f8fd1",
      marginLeft: "-1px",
      transform: `scaleY(${isDark ? 0.85 : 0.9})`,
      transformOrigin: "center",
    },
  }),
  ];
}
