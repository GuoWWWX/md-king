import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { stripSupportedTextExtension } from "@/lib/markdown-files";

class DocumentTitleWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly editable: boolean,
    readonly onRename?: (nextTitle: string) => Promise<boolean>,
    readonly onFocus?: () => void,
  ) {
    super();
  }

  eq(other: DocumentTitleWidget) {
    return other.title === this.title && other.editable === this.editable;
  }

  toDOM() {
    const editableTitle = stripSupportedTextExtension(this.title);
    const container = document.createElement("div");
    container.className = "mk-cm-document-title";
    container.setAttribute("contenteditable", "false");

    const input = document.createElement("input");
    input.className = "mk-cm-document-title-input";
    input.value = editableTitle;
    input.readOnly = !this.editable;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", this.editable ? `修改文件名：${editableTitle}` : `文件名：${editableTitle}`);

    let composing = false;
    let submitting = false;
    const submit = async () => {
      const nextTitle = input.value.trim();
      if (!this.editable || submitting || nextTitle === editableTitle) {
        input.value = nextTitle || editableTitle;
        return;
      }
      if (!nextTitle || !this.onRename) {
        input.value = editableTitle;
        return;
      }

      submitting = true;
      input.readOnly = true;
      input.setAttribute("aria-busy", "true");
      try {
        const renamed = await this.onRename(nextTitle);
        if (!renamed) input.value = editableTitle;
      } catch {
        input.value = editableTitle;
      } finally {
        submitting = false;
        input.readOnly = !this.editable;
        input.removeAttribute("aria-busy");
      }
    };

    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener("focus", () => { this.onFocus?.(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !composing) {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = editableTitle;
        input.blur();
      }
    });
    input.addEventListener("blur", () => { void submit(); });

    container.append(input);
    return container;
  }

  ignoreEvent() {
    return true;
  }
}

export function documentTitleExtension(
  title?: string,
  editable = false,
  onRename?: (nextTitle: string) => Promise<boolean>,
  onFocus?: () => void,
): Extension {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return [];

  return EditorView.decorations.of(Decoration.set([
    Decoration.widget({
      widget: new DocumentTitleWidget(normalizedTitle, editable, onRename, onFocus),
      block: true,
      side: -1,
    }).range(0),
  ]));
}
