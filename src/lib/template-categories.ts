const TEMPLATE_GROUP_STORAGE_KEY = "md-king.custom-template-groups";
const templateMetaTags = new Set(["内置", "系统", "自定义"]);

export const systemTemplateCategories = ["全部", "系统", "报告", "论文", "公文", "技术文档", "商务", "简历"] as const;
export const fixedTemplateGroups = [...systemTemplateCategories, "未分组"] as const;

function normalizeGroupName(value: string) {
  return value.trim();
}

export function getTemplateCategory(tags: string[], isBuiltIn = false) {
  const normalized = tags.map((tag) => tag.toLowerCase());
  if (isBuiltIn || tags.includes("系统") || tags.includes("内置")) return "系统";
  if (tags.includes("报告")) return "报告";
  if (tags.includes("论文") || tags.includes("学术")) return "论文";
  if (tags.includes("公文") || tags.includes("正式")) return "公文";
  if (tags.includes("技术") || tags.includes("代码")) return "技术文档";
  if (tags.includes("商务") || tags.includes("方案")) return "商务";
  if (tags.includes("简历") || normalized.includes("resume")) return "简历";
  const firstMeaningfulTag = tags.find((tag) => !templateMetaTags.has(tag));
  return firstMeaningfulTag ?? "未分组";
}

export function getTemplateGroups(templates: Array<{ tags: string[]; isBuiltIn: boolean }>, extraGroups: string[] = []) {
  const groups: string[] = [];
  const seen = new Set<string>();
  const normalizedExtraGroups = extraGroups.map(normalizeGroupName).filter((group, index, array) => group && array.indexOf(group) === index);
  const extraGroupSet = new Set(normalizedExtraGroups);

  const appendGroup = (group: string) => {
    const normalized = normalizeGroupName(group);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    groups.push(normalized);
  };

  fixedTemplateGroups.forEach(appendGroup);

  for (const template of templates) {
    const category = getTemplateCategory(template.tags, template.isBuiltIn);
    if (extraGroupSet.has(category)) continue;
    appendGroup(category);
  }

  for (const group of normalizedExtraGroups) {
    appendGroup(group);
  }

  return groups;
}

export function isFixedTemplateGroup(group: string) {
  return fixedTemplateGroups.includes(normalizeGroupName(group) as (typeof fixedTemplateGroups)[number]);
}

export function loadCustomTemplateGroups() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(TEMPLATE_GROUP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? normalizeGroupName(item) : ""))
      .filter((item, index, array) => item && !isFixedTemplateGroup(item) && array.indexOf(item) === index);
  } catch {
    return [];
  }
}

export function saveCustomTemplateGroups(groups: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = groups
    .map(normalizeGroupName)
    .filter((group, index, array) => group && !isFixedTemplateGroup(group) && array.indexOf(group) === index);

  window.localStorage.setItem(TEMPLATE_GROUP_STORAGE_KEY, JSON.stringify(normalized));
}

export function toTemplateGroupName(value: string) {
  return normalizeGroupName(value);
}
