# 转换冒烟测试素材

本目录保存用于人工检查 Pandoc / Word / WPS 输出的 Markdown 和图片，不保存生成的 DOCX、PDF 或调试截图。

| 素材 | 检查点 |
| --- | --- |
| `default-template-smoke.md` | 默认模板的标题、表格、公式和图片。 |
| `missing-image-check/` | 相对图片路径、绝对图片路径和缺失图片。 |
| `p0-heading-numbering/` | 手动标题编号。 |
| `p0-mermaid/` | Mermaid 转换。 |
| `p0-sections/` | 封面、目录和正文分节。 |

`image-paths.md` 中的绝对路径是维护者本机示例；换机器时需改成当前仓库路径。相对图片路径无需修改。输出文件建议保存到 `.codex/`；同目录生成的 DOCX / PDF 也已加入 Git 忽略规则。
