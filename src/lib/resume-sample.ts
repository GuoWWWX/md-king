import photoPlaceholder from "./resume-photo-placeholder.png?inline";
import { getLanguage } from "./i18n";

const chineseSample = `# 姓名

| 求职意向：目标岗位<br>电话：138 0000 0000<br>邮箱：name@example.com<br>所在地：城市 | ![](个人照片.jpg){width=2.5cm height=3.5cm} |
| :--- | ---: |

## 工作经历

**公司名称｜岗位名称**　2022.06 — 至今

- 描述负责的工作、采用的方法和取得的具体成果。
- 用数据说明改善效果，例如效率、质量或业务指标的变化。

## 项目经历

**项目名称｜承担角色**　2021.06 — 2022.05

- 简述项目背景和目标，突出自己负责的工作。
- 写明解决的关键问题和最终成果。

## 教育经历

**学校名称｜专业｜学历**　2017.09 — 2021.06

## 专业技能

- 列出与目标岗位相关的技能、工具或证书。
`;

const englishSample = `# Your Name

| Target role: Your role<br>Phone: Your phone<br>Email: name@example.com<br>Location: City | ![](portrait.jpg){width=2.5cm height=3.5cm} |
| :--- | ---: |

## Experience

**Company name | Role**　2022.06 — Present

- Describe your responsibilities, approach, and concrete results.
- Use numbers to show improvements in efficiency, quality, or outcomes.

## Projects

**Project name | Your role**　2021.06 — 2022.05

- Summarize the project's purpose and your contribution.
- Describe a key problem you solved and the result.

## Education

**School | Field | Degree**　2017.09 — 2021.06

## Skills

- List skills, tools, or certifications relevant to the role.
`;

export function resumeSampleMarkdown(preview = false) {
  const english = getLanguage() === "en";
  const sample = english ? englishSample : chineseSample;
  return preview ? sample.replace(english ? "portrait.jpg" : "个人照片.jpg", photoPlaceholder) : sample;
}
