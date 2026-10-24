import { Facet } from "@codemirror/state";
import { isSupportedImagePath } from "../../../lib/image-files.ts";

export type EditorImageContext = {
  sourcePath?: string;
  importFile?: (file: File) => Promise<string | undefined>;
};

export const editorImageContext = Facet.define<EditorImageContext, EditorImageContext>({
  combine: (values) => values[0] ?? {},
});

export function transferredImageFiles(transfer: DataTransfer | null): File[] {
  return Array.from(transfer?.files ?? []).filter(file => file.type.startsWith("image/") || isSupportedImagePath(file.name));
}
