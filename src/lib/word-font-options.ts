export const wordFontOptions = [
  "微软雅黑",
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "微软雅黑 Light",
  "等线",
  "等线 Light",
  "宋体",
  "新宋体",
  "黑体",
  "楷体",
  "仿宋",
  "华文中宋",
  "华文宋体",
  "思源黑体",
  "思源宋体",
  "Noto Sans CJK SC",
  "Noto Serif CJK SC",
  "PingFang SC",
  "Times New Roman",
  "Calibri",
  "Cambria",
  "Georgia",
  "Arial",
  "Arial Unicode MS",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Segoe UI",
  "Inter",
  "Roboto",
  "Consolas",
  "Cascadia Mono",
  "Courier New",
  "JetBrains Mono",
] as const;

function normalizeFontSearchTerm(value: string) {
  return value.trim().toLocaleLowerCase();
}

function matchesAbbreviation(value: string, abbreviation: string) {
  let currentIndex = 0;
  for (const character of abbreviation) {
    currentIndex = value.indexOf(character, currentIndex);
    if (currentIndex < 0) return false;
    currentIndex += 1;
  }
  return true;
}

export function filterWordFontOptions(options: readonly string[], query: string) {
  const normalizedQuery = normalizeFontSearchTerm(query);
  if (!normalizedQuery) return [...options];

  return options.filter((option) => {
    const normalizedOption = normalizeFontSearchTerm(option);
    return normalizedOption.includes(normalizedQuery)
      || matchesAbbreviation(normalizedOption, normalizedQuery);
  });
}

export function findWordFontOption(options: readonly string[], value: string) {
  const normalizedValue = normalizeFontSearchTerm(value);
  return options.find((option) => normalizeFontSearchTerm(option) === normalizedValue);
}
