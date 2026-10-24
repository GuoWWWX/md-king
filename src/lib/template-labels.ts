import { t } from "./i18n.ts";
import type { Template } from "../types/index.ts";

type TemplateLabel = Pick<Template, "name" | "isBuiltIn">;

/** Built-in metadata is fixed; user-provided names are always displayed verbatim. */
export function templateLabel(template: TemplateLabel): string {
  return template.isBuiltIn ? t(template.name) : template.name;
}
