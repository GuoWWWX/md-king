# md-king：AI Markdown 一键转换 Word/WPS 工具调研与产品方案

> 面向 AI 生成 Markdown 内容的本地桌面工具：把 Markdown 稳定转换为可编辑、样式可控的 Word/WPS `DOCX` 文档，减少复制粘贴到 Word 后反复调格式的痛苦。

## 文档索引

- [产品需求文档](docs/PRODUCT_REQUIREMENTS.md)：核心场景、用户价值、MVP 范围和产品原则。
- [界面设计规划](docs/UI_SCREEN_PLAN.md)：主窗口信息架构、关键页面布局、视觉系统和页面优先级。
- [UI 风格方向](docs/UI_STYLE_DIRECTION.md)：已选定的“柔和玻光蓝”视觉方向、设计 token 和实现顺序。
- [设计资产目录](docs/design-assets/README.md)：Stitch 设计稿、HTML 与高清 PNG 参考图。
- [技术架构文档](docs/TECHNICAL_ARCHITECTURE.md)：Tauri + React + shadcn/ui + Rust + Pandoc + CLI 的具体架构设计。

## 当前实现状态（2026-06）

桌面端已按 MVP 路线接入 bundled Pandoc，打包应用默认优先使用内置 Pandoc，普通用户无需单独安装；只有需要强制指定其他版本时才填写自定义 `pandocPath`。浏览器预览（例如 `http://localhost:1420`）不具备真实 Tauri/Rust/Pandoc 能力，Pandoc 检测与转换会明确标记为模拟结果，不生成真实 DOCX；验证真实转换、打开输出文件、配置持久化和内置 Pandoc 时，请使用 `pnpm tauri dev`。

当前已落地的桌面能力包括：Markdown → DOCX 转换、默认输出目录配置、模板导入/管理、历史记录写入/清空、打开输出文件、表格样式前端编辑与 Word 预览增强。CLI 已具备第一版 `md-king-cli convert` 与 `md-king-cli templates list` 命令，可输出 JSON 并复用现有 Rust 转换核心。模板样式编辑器目前主要用于前端草稿和预览，尚未把样式完整写回 `reference.docx`。Windows 右键菜单、悬浮球、系统托盘、MCP Server 与完整批量队列仍是规划能力，界面中应保持禁用或明确标注“规划中”。

## 1. 项目背景

现在越来越多用户用 AI 生成报告、方案、周报、论文草稿、技术文档、公文材料等内容。AI 通常输出 Markdown：标题、列表、表格、代码块、引用、加粗、链接都很清晰；但一旦复制到 Word/WPS，经常会出现：

- 标题样式混乱，一级/二级标题格式不稳定；
- 列表缩进、编号、多级列表样式错乱；
- 表格、代码块、引用块粘贴后难看或不可控；
- Word/WPS 模板样式难复用，每个新文档都要重新调；
- 用户不想每天研究 Word/WPS 样式、模板、编号、目录等复杂功能。

因此，本项目建议定位为：

> **面向 AI 生成 Markdown 的一键结构化 DOCX 转换与 Word/WPS 样式模板工具。**

重点不是做一个新的 Markdown 编辑器，而是解决“AI Markdown 内容如何快速变成规范 Word/WPS 文档”的问题。

---

## 2. 产品定位

### 2.1 一句话定位

**把 AI 生成的 Markdown 内容，一键转换成样式稳定、可编辑、可复用模板的 Word/WPS 文档。**

### 2.2 核心目标

1. **转换稳定**：Markdown 的标题、正文、列表、表格、代码块等结构应稳定映射到 Word 样式。
2. **样式可控**：用户可以选择不同模板，例如论文、报告、公文、技术文档、简历等。
3. **入口方便**：支持拖拽、剪贴板、右键菜单、悬浮球、批量转换。
4. **命令可控**：提供终端命令，方便高级用户、脚本和 AI 智能体查看状态、选择模板、发起转换、读取结果。
5. **轻量流畅**：不做臃肿办公套件，只做 Markdown 到 Word/WPS 的高频工作流。
6. **本地优先**：优先本地转换，避免用户文档上传云端，保护隐私。

### 2.3 产品边界

本工具应该优先承诺：

- Markdown → 可编辑 `DOCX`；
- 结构化内容转换；
- Word/WPS 样式模板复用；
- 批量转换与便捷入口；
- 终端命令控制与状态查看，便于 AI 智能体和自动化脚本调用。

不建议 MVP 阶段承诺：

- 像素级完全还原网页/AI 对话界面；
- 任意复杂 Word 模板正文合并；
- 旧版 `.doc` 完整生成；
- 所有 WPS/Word 版本的高级排版 100% 一致。

> 推荐主格式使用 `DOCX`。旧版 `.doc` 可以后续通过 Word/WPS/LibreOffice 转换或“另存为”支持，不建议作为 MVP 核心目标。

### 2.4 需求说明

本项目当前先按“需求清晰、边界明确、方便后续实现”的方式拆成以下几类。

#### 2.4.1 用户侧核心需求

用户真正需要的不是一个复杂编辑器，而是一个能把 AI 生成内容快速变成规范 Word/WPS 文档的工具：

- 用户可以把 AI 输出的 Markdown 文本转换成 `.docx`；
- 用户可以选择不同 Word/WPS 样式模板，避免每次手动调标题、正文、列表、表格、代码块格式；
- 用户可以批量处理多个 Markdown 文件；
- 用户可以通过拖拽、右键菜单、悬浮球、剪贴板等方式快速转换；
- 用户可以在转换完成后直接打开 Word/WPS 文档继续编辑；
- 用户不需要理解 Word/WPS 的复杂样式系统，也不需要研究 Pandoc 命令。

#### 2.4.2 文档转换需求

转换能力至少应覆盖 AI 文档中最常见的 Markdown 结构：

- 标题层级：`#` 到 `######`；
- 正文段落；
- 加粗、斜体、删除线；
- 有序列表、无序列表、多级列表；
- 表格；
- 引用块；
- 代码块与行内代码；
- 链接；
- 图片；
- 分隔线；
- 可选目录；
- 文档元数据，如标题、作者、日期。

转换结果应优先保证：

- Word/WPS 可打开；
- 内容结构不丢失；
- 样式由模板控制；
- 文档可以继续编辑；
- 同一模板多次转换结果保持一致。

#### 2.4.3 模板与格式需求

模板是本项目的核心差异化能力：

- 支持内置模板；
- 支持用户导入 `.docx` 样式模板；
- 支持设置默认模板；
- 支持不同场景模板：报告、论文、公文、技术文档、商务方案、简历等；
- 支持模板预览、说明、分类、标签；
- 支持检查模板是否包含常用 Word 样式；
- 支持后续扩展模板市场或团队模板库。

#### 2.4.4 多入口使用需求

为了让工具真正高频可用，需要提供多个入口：

- **桌面主窗口**：适合选择文件、批量转换、管理模板；
- **拖拽入口**：把 Markdown 文件拖进窗口或悬浮球即可转换；
- **剪贴板入口**：复制 AI Markdown 后一键生成 DOCX；
- **右键菜单入口**：在文件管理器中右键 `.md` 文件转换；
- **悬浮球入口**：常驻桌面，适合快速转换剪贴板或拖入文件；
- **系统托盘入口**：快速打开主窗口、切换模板、查看历史；
- **终端命令入口**：适合开发者、脚本、自动化流程和 AI 智能体调用。

#### 2.4.5 AI 智能体与终端命令需求

随着 AI 智能体越来越普及，本平台不能只提供图形界面，还需要提供稳定的命令行控制能力，让 AI agent、脚本、CI、本地自动化工具能够直接调用。

终端命令需要覆盖两类能力：

1. **控制类命令**：发起转换、批量转换、选择模板、清理历史、打开输出目录；
2. **查看类命令**：查看模板列表、查看转换任务状态、查看历史记录、查看配置、查看最近输出结果。

当前已接入的 CLI 命令形态：

```bash
# 单文件转换
md-king-cli convert ./input.md -o ./output.docx --template default-report

# 查看模板列表
md-king-cli templates list

# 输出机器可读 JSON，方便 AI 智能体解析
md-king-cli templates list --json
md-king-cli convert ./input.md -o ./output.docx --template default-report --json
```

批量转换、剪贴板转换、历史查询、状态查询、MCP 和本地 HTTP API 仍是规划能力。

为了方便 AI 智能体调用，CLI 应满足：

- 输出结构清晰，支持 `--json`；
- 错误信息明确，包含失败原因、输入文件、输出路径、模板名称；
- 转换成功后返回输出文件路径；
- 支持非交互模式，不依赖 GUI 弹窗；
- 支持退出码，例如成功为 `0`，转换失败为非 `0`；
- 支持查看当前配置，方便 agent 判断下一步操作；
- 后续可以提供本地 API 或 MCP Server，让 AI 工具直接调用转换能力。

#### 2.4.6 平台能力需求

本项目后续可以从“转换工具”升级为“AI 文档格式化平台”：

- 桌面端负责用户交互；
- CLI 负责自动化和 agent 调用；
- 模板中心负责格式复用；
- 转换引擎负责 Markdown 到 DOCX；
- 历史记录负责追踪输出；
- 本地 API/MCP 负责与 AI 智能体集成。

最终目标是让用户或 AI 智能体都能用同一套能力：

```text
AI 生成 Markdown → 选择模板 → 转换 DOCX → 查看结果 → 打开/交付 Word 文档
```


---

## 3. 目标用户与典型场景

### 3.1 目标用户

- 经常用 ChatGPT、Claude、DeepSeek、通义、豆包等 AI 写文档的人；
- 需要提交 Word/WPS 文档的学生、教师、职场用户；
- 写周报、方案、标书、总结、公文、论文、技术文档的人；
- 不熟悉 Word 样式系统，但希望文档看起来规范的人；
- 企业、学校、政企单位中需要统一文档格式的团队。

### 3.2 高频场景

| 场景 | 用户行为 | 工具解决方式 |
|---|---|---|
| AI 生成报告 | 从 AI 对话复制 Markdown | 悬浮球/剪贴板一键转 DOCX |
| 批量文档整理 | 有多个 `.md` 文件 | 拖拽批量转换 |
| 固定单位模板 | 每次都要按同一格式提交 | 选择自定义 `reference.docx` 模板 |
| 临时写材料 | 只想快速得到 Word 文件 | 默认模板一键生成 |
| 技术文档 | 有代码块、表格、链接 | 保留 Markdown 结构并映射样式 |
| 文件管理器操作 | 右键某个 `.md` 文件 | Explorer 右键“转换为 Word” |
| AI 智能体自动化 | agent 需要把生成的 Markdown 变成 Word | 通过 CLI/API 发起转换并用 JSON 查看结果 |
| 终端用户操作 | 用户不打开 GUI，直接在命令行处理文档 | `md-king convert` / `batch` / `status` 命令 |

---

## 4. 功能设计

## 4.1 MVP 核心功能

### 4.1.1 Markdown 转 DOCX

- 支持选择单个 `.md` 文件；
- 支持输出 `.docx`；
- 支持设置输出目录；
- 支持转换完成后自动打开文件；
- 支持失败提示与错误日志。

### 4.1.2 剪贴板一键转换

- 从剪贴板读取 Markdown 文本；
- 选择模板后生成 DOCX；
- 可选：直接插入到当前 Word/WPS 光标位置；
- 可选：生成临时 DOCX 并自动打开。

### 4.1.3 拖拽转换

- 主窗口支持拖入 `.md` 文件；
- 支持拖入多个文件形成批量任务；
- 支持拖入文件夹，扫描其中 Markdown 文件；
- 转换队列显示成功、失败、耗时、输出路径。

### 4.1.4 模板选择

基于 Pandoc 的 `--reference-doc` 机制：

- 内置默认模板；
- 内置几套常用模板：
  - 通用报告；
  - 学术论文；
  - 技术文档；
  - 简洁商务；
  - 公文风格；
- 支持用户导入自己的 `.docx` 作为样式模板；
- 支持设置默认模板。

### 4.1.5 基础样式映射

至少稳定支持：

- 标题：`#` 到 `######` → `Heading 1` 到 `Heading 6`；
- 正文段落 → `Normal` / `Body Text`；
- 加粗、斜体、删除线；
- 有序列表、无序列表、多级列表；
- Markdown 表格；
- 引用块；
- 代码块与行内代码；
- 链接；
- 图片路径；
- 分隔线；
- 目录占位可选。

### 4.1.6 Windows 右键菜单

- 对 `.md` 文件增加右键菜单：
  - `转换为 Word 文档`；
  - `使用默认模板转换`；
  - `选择模板转换...`；
- 可在设置中开启/关闭；
- 优先写入当前用户注册表，不强制管理员权限。

Windows 文件类型关联和右键菜单本质上需要通过 Shell/file association/verb 注册实现，微软文档说明文件扩展名和 `ProgID` 关联可注册在 `HKEY_CURRENT_USER\Software\Classes` 或 `HKEY_LOCAL_MACHINE\Software\Classes`，并且应用可为文件类型提供自己的 `verb` 与 `command`。参考：[Microsoft File Types 文档](https://learn.microsoft.com/en-us/windows/win32/shell/fa-file-types)。

### 4.1.7 悬浮球

- 桌面常驻小悬浮球；
- 拖拽 Markdown 文件到悬浮球即可转换；
- 复制 AI 内容后点击悬浮球即可从剪贴板生成；
- 右键悬浮球可快速切换模板；
- 可设置开机启动、显示/隐藏、透明度、吸附边缘。

### 4.1.8 转换历史

- 记录最近转换文件；
- 可打开输出文件；
- 可打开输出目录；
- 可重复上次转换；
- 可清空历史。

---

## 4.2 进阶功能

### 4.2.1 模板管理中心

- 模板列表；
- 模板预览图；
- 模板分类：报告、论文、公文、合同、技术文档、简历等；
- 模板导入/导出；
- 模板复制、重命名、删除；
- 模板说明：适合场景、字体、字号、页边距、标题样式；
- 检查模板是否包含 Pandoc 常用样式。

Pandoc 官方说明：`--reference-doc=FILE` 可在生成 `docx` 或 `odt` 时指定参考文档；生成 DOCX 时，参考文档正文不会进入新文档，但其中的样式和文档属性会被使用，包括页边距、页面大小、页眉、页脚等。参考：[Pandoc `--reference-doc`](https://pandoc.org/MANUAL.html#option--reference-doc)。

### 4.2.2 样式诊断

用户导入模板后，工具自动检查：

- 是否包含 `Heading 1` 到 `Heading 6`；
- 是否包含 `Normal` / `Body Text`；
- 是否包含 `Source Code` 或代码样式；
- 是否包含表格样式；
- 页边距、纸张大小是否符合预期；
- 是否存在中文字体缺失风险。

### 4.2.3 AI Markdown 清洗

AI 输出经常包含不稳定格式，可在转换前清洗：

- 去掉 AI 回复开头/结尾的废话；
- 修复不闭合代码块；
- 修复 Markdown 表格分隔线；
- 修复标题层级跳跃；
- 修复列表缩进；
- 去除多余空行；
- 自动识别文档标题；
- 可选：把“一级标题过多”转换为二级标题。

### 4.2.4 预览

- Markdown 原文预览；
- HTML 预览；
- 模板样式说明预览；
- 转换前显示文档大纲；
- 转换后可一键打开 DOCX。

> 注意：DOCX 的最终效果仍应以 Word/WPS 打开结果为准，HTML 预览只能作为结构参考。

### 4.2.5 插入 Word/WPS 当前光标

类似 PasteMD 的高效工作流：

- 读取剪贴板 Markdown；
- 转成临时 DOCX；
- 插入到当前 Word/WPS 光标位置；
- 尽量保留标题、表格、代码块等样式。

PasteMD 的 README 显示，它的核心流程就是从剪贴板读取 Markdown，调用 Pandoc 转 DOCX，再插入 Word/WPS 当前光标位置。参考：[PasteMD GitHub](https://github.com/RICHQAQ/PasteMD)。

### 4.2.6 批处理队列

- 多文件并发/串行转换；
- 显示进度；
- 失败重试；
- 按原目录输出；
- 合并多个 Markdown 为一个 DOCX；
- 按文件名生成目录；
- 批量选择模板。

### 4.2.7 CLI/API

给高级用户和企业集成使用：

```bash
md-king convert input.md -o output.docx --template report.docx
md-king batch ./docs --out ./word --template official.docx
md-king clipboard --template default --open
```

### 4.2.8 企业/团队能力

- 团队模板库；
- 统一单位模板；
- 配置锁定；
- 离线安装包；
- 内网部署；
- 批量授权；
- 转换日志导出。

---

## 5. 开源项目与竞品调研

## 5.1 PasteMD

链接：[RICHQAQ/PasteMD](https://github.com/RICHQAQ/PasteMD)

### 定位

PasteMD 是目前最接近本项目设想的开源参考。它面向 Markdown 和网页 AI 对话内容，目标应用包括 Word、WPS、Excel。

### 已验证能力

- 从剪贴板读取 Markdown；
- 调用 Pandoc 转换为 DOCX；
- 插入到 Word/WPS 当前光标位置；
- 支持可选 `reference_docx` 配置；
- 非常贴近“AI 内容 → Word/WPS”的真实痛点。

### 优点

- 工作流简单直接；
- 场景非常准确；
- 已证明 Pandoc + Word/WPS 插入这条路径可行；
- 适合作为热键、剪贴板、插入当前文档能力的参考。

### 不足与机会

- 产品化 UI 能力有限；
- 模板管理不够完整；
- 不适合作为批量转换中心；
- 不强调悬浮球、拖拽、右键菜单等多入口体验；
- 用户自定义模板和样式诊断能力仍有扩展空间。

### 对本项目启发

本项目可以借鉴 PasteMD 的轻量流程，但产品化方向应加强：

- 模板中心；
- 批量转换；
- 现代化 UI；
- 悬浮球入口；
- Explorer 右键菜单；
- 转换历史；
- 样式诊断。

---

## 5.2 Pandoc

链接：

- [Pandoc GitHub](https://github.com/jgm/pandoc)
- [Pandoc Manual](https://pandoc.org/MANUAL.html)
- [Pandoc `--reference-doc`](https://pandoc.org/MANUAL.html#option--reference-doc)

### 定位

Pandoc 是通用文档转换器，官方支持多种 Markdown 输入变体和 Word `DOCX` 输出。

### 关键能力

- Markdown → DOCX；
- 支持 Pandoc Markdown、CommonMark、GFM 等多种输入；
- 支持 `--reference-doc` 自定义 DOCX 样式；
- 支持目录、元数据、引用、脚注等复杂文档能力；
- 转换质量成熟，生态稳定。

### `reference.docx` 机制

Pandoc 的 `--reference-doc` 是本项目模板系统的关键基础。

推荐流程：

```bash
pandoc -o custom-reference.docx --print-default-data-file reference.docx
```

然后用户用 Word/WPS/LibreOffice 打开 `custom-reference.docx`，修改样式后保存，再在转换时使用：

```bash
pandoc input.md -o output.docx --reference-doc=custom-reference.docx
```

### 优点

- 成熟稳定；
- Markdown 到 DOCX 能力强；
- 模板样式机制现成；
- 适合快速做 MVP；
- 可作为独立二进制随应用分发或检测系统安装。

### 不足

- 更偏“结构转换”，不是像素级排版引擎；
- 对任意复杂 Word 模板正文合并能力有限；
- 旧版 `.doc` 不是核心输出格式；
- 高级定制需要理解 Pandoc 参数；
- 分发时需要考虑 Pandoc 二进制体积和许可证。

### 结论

**Pandoc 应作为 MVP 默认转换内核。**

---

## 5.3 Typora

链接：[Typora Export](https://support.typora.io/Export/)

### 定位

Typora 是优秀的 Markdown 编辑器，也支持导出 Word。

### 相关能力

- 内置导出 PDF、HTML、图片等；
- Word、RTF 等更多格式依赖 Pandoc；
- 提供 `Export → Word (.docx)` 入口；
- 支持通过 Pandoc reference doc 自定义 Word 样式。

### 对本项目启发

Typora 证明了“Markdown 编辑/预览 + Pandoc 导出 Word”是用户可理解的路径。但本项目不应做完整 Markdown 编辑器，而应专注“AI 内容到 Word/WPS”的转换效率。

---

## 5.4 Writage

链接：

- [Writage 官网](https://www.writage.com/)
- [Writage Docs](https://www.writage.com/docs/introduction/)

### 定位

Writage 是 Microsoft Word 的 Markdown 插件，可以在 Word 中打开/保存 Markdown，并支持 Markdown 到 DOCX。

### 优点

- 直接嵌入 Word 工作流；
- 对 Word 用户理解成本低；
- 适合“在 Word 内使用 Markdown”的场景。

### 不足

- 更像 Word 插件，不是独立转换中心；
- 对 WPS、批量转换、悬浮球、右键菜单等场景覆盖不足；
- 产品扩展自由度不如独立桌面工具。

---

## 5.5 MarkText

链接：[MarkText GitHub](https://github.com/marktext/marktext)

### 定位

MarkText 是现代 Markdown 编辑器，更适合作为编辑体验和 UI 参考。

### 调研结论

其 README 明确列出的导出格式主要是 HTML 和 PDF，未显示 DOCX/Word 是核心导出能力。因此它不是本项目转换内核参考，但可参考它的现代 Markdown 编辑/预览体验。

---

## 5.6 markdown-it

链接：

- [markdown-it GitHub](https://github.com/markdown-it/markdown-it)
- [markdown-it API](https://markdown-it.github.io/markdown-it/)

### 定位

markdown-it 是快速、可扩展的 Markdown 解析器，支持 CommonMark、GFM 表格、删除线和插件机制。

### 适用场景

- 解析 Markdown；
- 做 HTML 预览；
- 做 AI Markdown 清洗；
- 做自定义语法插件；
- 后续自研 DOCX 生成链路时作为 parser。

### 优点

- JS/TS 生态好；
- 插件丰富；
- 可新增或替换规则；
- 适合处理 AI 生成 Markdown 的不规范语法。

### 不足

- 本身不生成 DOCX；
- 需要配合 docx.js 或其他 DOCX 生成库；
- 自研映射成本高。

### 结论

MVP 不建议用 markdown-it 自研完整转换链路，但可以用于：

- Markdown 预览；
- 格式清洗；
- 文档大纲提取；
- 二期精细化转换。

---

## 5.7 docx.js

链接：

- [docx.js 官网](https://docx.js.org/)
- [dolanmiu/docx GitHub](https://github.com/dolanmiu/docx)

### 定位

docx.js 是用 JavaScript/TypeScript 创建 `.docx` 文档的库，可在 Node.js 和浏览器环境中使用。

### 优点

- 纯 JS/TS 生态；
- 可精细控制段落、表格、编号、图片、样式；
- 与 Tauri/Electron 前端栈整合方便；
- 适合做自研转换引擎。

### 不足

- 它不是 Markdown 转 DOCX 工具；
- 需要自行实现 Markdown AST/token 到 DOCX 结构的映射；
- 多级列表、表格、图片、脚注、目录、题注等都需要大量工程处理；
- 早期开发成本高于 Pandoc。

### 结论

docx.js 适合二期作为“更可控的自研 DOCX 引擎”，不建议 MVP 替代 Pandoc。

---

## 5.8 remark-docx、docx-rs、python-docx、html-to-docx、docx4j

这些项目可作为后续技术储备：

| 项目 | 语言/生态 | 适合用途 | 是否建议 MVP 使用 |
|---|---|---|---|
| [remark-docx](https://github.com/inokawa/remark-docx) | JS/remark | Markdown/MDX 到 DOCX 方向参考 | 可调研，不作为默认 |
| [docx-rs](https://github.com/bokuweb/docx-rs) | Rust | Rust 生成 DOCX | Tauri 深度 Rust 化时可考虑 |
| [python-docx](https://python-docx.readthedocs.io/en/latest/) | Python | 修改/生成 DOCX | 不适合轻量桌面主链路 |
| [html-to-docx](https://github.com/privateOmega/html-to-docx) | JS | HTML 转 DOCX | 可作为备选转换链路 |
| [docx4j](https://github.com/plutext/docx4j) | Java | 企业级 DOCX 操作 | 对轻量桌面过重 |

---

## 6. 技术栈选择

## 6.1 推荐总体架构

```text
┌───────────────────────────────────────┐
│              桌面 UI 层                │
│  Tauri + React/Vue/Svelte + Tailwind   │
├───────────────────────────────────────┤
│              应用服务层                │
│  任务队列 / 模板管理 / 历史记录 / 设置 │
├───────────────────────────────────────┤
│              转换引擎层                │
│  Pandoc CLI sidecar / 后续 docx.js     │
├───────────────────────────────────────┤
│              系统集成层                │
│  右键菜单 / 悬浮球 / 托盘 / 快捷键     │
└───────────────────────────────────────┘
```

---

## 6.2 桌面框架：Tauri vs Electron

### Tauri

链接：[Tauri 官网](https://tauri.app/start/)

Tauri 使用系统 WebView，不需要把浏览器引擎打包进每个应用。官方介绍中强调 Tauri 可以构建体积很小、速度快的桌面/移动应用，最小应用可小于 600KB，并受益于 Rust 的内存、线程和类型安全。

#### 优点

- 安装包更小；
- 内存占用通常更低；
- Rust 后端适合做系统集成；
- 适合轻量工具；
- 可做 sidecar 调用 Pandoc；
- 适合 Windows 托盘、悬浮窗、拖拽、文件系统等能力。

#### 不足

- 生态不如 Electron 成熟；
- 某些 Windows 深度集成需要写 Rust/Win32；
- WebView 在不同系统上可能有差异。

### Electron

链接：[Electron Docs](https://www.electronjs.org/docs/latest/)

Electron 把 Chromium 和 Node.js 嵌入应用二进制，用 HTML、CSS、JavaScript 构建跨平台桌面应用。

#### 优点

- 生态成熟；
- 插件多；
- Windows 集成资料多；
- 适合复杂桌面应用；
- 前端团队上手快。

#### 不足

- 安装包大；
- 内存占用较高；
- 对“轻量工具”定位不够理想。

### 推荐选择

**首选：Tauri + React + TypeScript + Tailwind CSS + Pandoc sidecar。**

原因：

- 用户明确希望轻量、流畅；
- 本项目 UI 不复杂，不需要完整 Chromium 能力；
- Rust 后端适合处理文件、进程、注册表、托盘、全局快捷键；
- Pandoc 可作为 sidecar 二进制封装；
- 前端仍可使用现代 Web 技术做漂亮 UI。

---

## 6.3 前端技术栈

推荐：

- `React` 或 `Vue`：组件化 UI；
- `TypeScript`：类型安全；
- `Vite`：开发启动快；
- `Tailwind CSS`：快速做现代 UI；
- `shadcn/ui` 或同类组件库：构建现代化界面；
- `markdown-it`：Markdown 预览、大纲提取、语法清洗；
- `Zustand` / `Pinia`：轻量状态管理；
- `SQLite` 或 JSON：存储转换历史和配置。

如果选择 React：

```text
Tauri + React + TypeScript + Vite + Tailwind CSS + shadcn/ui
```

如果选择 Vue：

```text
Tauri + Vue + TypeScript + Vite + Tailwind CSS + Naive UI
```

---

## 6.4 后端/本地能力

推荐用 Tauri Rust 后端处理：

- 调用 Pandoc；
- 管理 sidecar；
- 文件拖拽；
- 读写模板文件；
- 读写配置；
- 任务队列；
- Windows 注册表右键菜单；
- 系统托盘；
- 悬浮窗；
- 全局快捷键；
- 自动更新。

---

## 6.5 转换引擎方案

### 方案 A：Pandoc CLI 作为默认引擎（推荐 MVP）

```bash
pandoc input.md -o output.docx --reference-doc template.docx
```

优点：

- 最快做出高质量 MVP；
- DOCX 支持成熟；
- reference.docx 直接满足模板需求；
- 可复用 PasteMD/Typora 已验证路径。

缺点：

- 需要分发或检测 Pandoc；
- 深度定制受 Pandoc 限制；
- 对复杂 Word 模板不是完整模板引擎。

### 方案 B：markdown-it + docx.js 自研引擎（二期）

流程：

```text
Markdown → markdown-it tokens/AST → 自定义样式映射 → docx.js → DOCX
```

优点：

- 控制力强；
- 可以针对中文 Word/WPS 做专项优化；
- 可实现更强模板系统；
- 不依赖 Pandoc 二进制。

缺点：

- 开发成本高；
- 容易踩 DOCX 复杂规范；
- 多级列表、表格、图片、目录、脚注都需要大量测试。

### 推荐策略

- MVP：Pandoc；
- V1/V2：Pandoc + markdown-it 清洗/预览；
- V3：根据用户反馈决定是否自研 docx.js 引擎。

---

## 7. 关键技术实现思路

## 7.1 模板系统

模板本质上是一组 `reference.docx` 文件和元数据。

```json
{
  "id": "business-report",
  "name": "商务报告",
  "description": "适合方案、总结、汇报材料",
  "referenceDocx": "templates/business-report.docx",
  "previewImage": "templates/business-report.png",
  "tags": ["报告", "商务", "通用"],
  "isDefault": true
}
```

转换时：

```bash
pandoc input.md \
  -o output.docx \
  --reference-doc templates/business-report.docx
```

---

## 7.2 右键菜单

Windows 右键菜单可通过注册 `.md` 文件类型的 shell verb 实现。

概念示例：

```reg
HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.md\shell\MdKingConvert
  "MUIVerb"="转换为 Word 文档"
  "Icon"="C:\\Path\\md-king.exe"

HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.md\shell\MdKingConvert\command
  ""="C:\\Path\\md-king.exe" "convert" "%1"
```

实际实现应注意：

- 优先写入 `HKCU`，避免管理员权限；
- 卸载时清理注册项；
- 设置中提供开启/关闭；
- 注册变更后通知 Shell 刷新；
- 多文件右键时处理多个参数。

参考：[Microsoft File Types](https://learn.microsoft.com/en-us/windows/win32/shell/fa-file-types)。

---

## 7.3 悬浮球

实现方式：

- 创建无边框窗口；
- 设置 always-on-top；
- 设置透明背景；
- 支持拖拽移动；
- 支持拖入文件；
- 支持点击读取剪贴板；
- 右键显示菜单；
- 可吸附屏幕边缘。

交互建议：

- 单击：转换剪贴板；
- 拖入文件：转换文件；
- 右键：选择模板/打开主窗口/查看历史；
- 双击：打开主窗口；
- 悬停：显示当前模板。

---

## 7.4 Word/WPS 插入

可分阶段实现：

### 阶段 1：生成 DOCX 并自动打开

最稳定，适合 MVP。

### 阶段 2：复制富文本到剪贴板

将 Markdown 转成 HTML/RTF，再写入剪贴板，用户粘贴到 Word/WPS。

### 阶段 3：自动插入当前光标位置

参考 PasteMD：

- 生成临时 DOCX；
- 检测 Word/WPS 窗口；
- 自动执行插入；
- 或通过剪贴板模拟粘贴。

该能力需要大量 Word/WPS 兼容性测试，建议放在 MVP 后半段或 V1。

---

## 7.5 Markdown 清洗

转换前可以通过 `markdown-it` 做结构分析：

- 提取标题大纲；
- 检测标题层级跳跃；
- 检测表格是否合法；
- 检测代码块是否闭合；
- 检测图片路径是否存在；
- 自动生成文档标题。

---

## 8. 推荐技术方案

最终推荐：

```text
桌面框架：Tauri
前端：React + TypeScript + Vite + Tailwind CSS + shadcn/ui
后端：Rust / Tauri commands
默认转换引擎：Pandoc CLI sidecar
Markdown 预览/清洗：markdown-it
模板机制：Pandoc reference.docx
配置存储：JSON 或 SQLite
系统集成：Windows Registry + Tray + Global Shortcut + Floating Window
后续自研引擎：docx.js 或 docx-rs
```

### 为什么不是纯 Web？

因为需要：

- 本地文件批量处理；
- 调用 Pandoc；
- Windows 右键菜单；
- 悬浮球；
- 系统托盘；
- 可能与 Word/WPS 交互。

纯 Web 不适合。

### 为什么不是 Electron 优先？

Electron 可以做，但用户要求“轻量、流畅”，而 Tauri 更符合轻量工具定位。除非团队对 Rust/Tauri 完全不熟，否则建议 Tauri 优先。

### 为什么不是一开始自研 DOCX？

因为 DOCX 规范复杂，早期自研会拖慢产品验证。Pandoc 已经成熟支持 Markdown→DOCX 和 reference.docx 样式模板，适合作为 MVP 基础。

---

## 9. MVP 路线

## 9.1 第 0 阶段：验证原型

目标：证明核心转换链路可行。

功能：

- 命令行调用 Pandoc；
- 输入 `.md` 输出 `.docx`；
- 使用一个自定义 `reference.docx`；
- 用 Word/WPS 打开测试标题、列表、表格、代码块效果。

验收标准：

- 10 个典型 AI Markdown 样例能成功转换；
- Word 和 WPS 均可打开；
- 标题样式可由模板控制；
- 表格和代码块基本可用。

---

## 9.2 第 1 阶段：桌面 MVP

目标：普通用户可用。

功能：

- Tauri 主窗口；
- 拖拽 Markdown 文件；
- 单文件转换；
- 模板选择；
- 输出目录选择；
- 转换完成自动打开；
- 转换日志；
- 默认模板 + 2 到 3 套内置模板；
- 检测 Pandoc 或内置 Pandoc。

验收标准：

- 用户不用命令行即可完成转换；
- 转换失败能看到原因；
- 模板切换有效；
- 安装包可在 Windows 正常安装运行。

---

## 9.3 第 2 阶段：效率入口

目标：形成差异化体验。

功能：

- 剪贴板 Markdown 一键转换；
- 系统托盘；
- 全局快捷键；
- Windows 右键菜单；
- 批量转换；
- 转换历史；
- 悬浮球基础版。

验收标准：

- 复制 AI 回复后可一键生成 DOCX；
- 右键 `.md` 可转换；
- 拖拽多个文件可批量转换；
- 悬浮球可拖入文件。

---

## 9.4 第 3 阶段：模板中心

目标：解决用户长期格式复用问题。

功能：

- 模板导入；
- 模板列表管理；
- 默认模板设置；
- 模板说明与预览；
- 样式诊断；
- 生成 Pandoc 默认 reference.docx；
- 打开模板进行编辑。

验收标准：

- 用户能导入单位模板；
- 同一 Markdown 使用不同模板能生成明显不同样式；
- 样式缺失时能提示。

---

## 9.5 第 4 阶段：质量增强

目标：提高复杂文档转换质量。

功能：

- AI Markdown 清洗；
- 表格修复；
- 代码块样式增强；
- 图片路径处理；
- 目录生成；
- 页眉页脚模板；
- 多 Markdown 合并为一个 DOCX；
- Word/WPS 当前光标插入。

---

## 9.6 第 5 阶段：高级与商业化

功能：

- 模板市场；
- 团队模板库；
- 企业统一配置；
- CLI/API；
- 自动更新；
- 多平台支持 macOS/Linux；
- 可选云同步；
- 自研 docx.js/docx-rs 引擎；
- 更深 Word/WPS 自动化集成。

---

## 10. 风险与注意事项

### 10.1 WPS 兼容性风险

Word 和 WPS 对 DOCX 的渲染可能存在差异，必须实测：

- 标题样式；
- 多级列表；
- 表格宽度；
- 代码块字体；
- 页眉页脚；
- 目录；
- 图片；
- 中文字体。

### 10.2 Pandoc 分发风险

需要确认：

- 是否内置 Pandoc；
- 安装包体积是否可接受；
- Pandoc 许可证合规；
- 是否允许用户使用系统 Pandoc；
- 企业内网环境如何安装。

### 10.3 模板误解风险

用户可能以为“导入任何 Word 文件，就能完全套用里面所有复杂排版”。实际 `reference.docx` 主要使用样式和文档属性，不是完整模板正文合并引擎。产品文案必须解释清楚。

### 10.4 旧版 `.doc` 风险

`.doc` 是旧格式，不建议 MVP 支持。建议：

- 主输出为 `.docx`；
- 后续可通过 Word/WPS/LibreOffice 转换为 `.doc`；
- 或明确标注 `.doc` 为实验功能。

### 10.5 AI Markdown 不规范

AI 输出可能包含错误 Markdown：

- 代码块未闭合；
- 表格格式错误；
- 标题层级混乱；
- 列表缩进不规范；
- HTML 混杂。

需要转换前清洗和错误提示。

---

## 11. README 可用的产品介绍文案

### 11.1 简短版

`md-king` 是一个面向 AI 时代的 Markdown 转 Word/WPS 工具。它可以把 ChatGPT、Claude、DeepSeek 等 AI 生成的 Markdown 内容，一键转换为样式稳定、可编辑、可复用模板的 `DOCX` 文档，支持拖拽、批量转换、剪贴板转换、Windows 右键菜单和悬浮球。

### 11.2 详细版

当你从 AI 复制 Markdown 到 Word/WPS 时，标题、列表、表格、代码块经常会变得混乱。`md-king` 希望解决这个问题：你只需要准备 Markdown 内容，选择一个 Word 样式模板，点击转换，就能得到一个结构清晰、样式统一、可以继续编辑的 `DOCX` 文档。

它不是一个复杂的办公软件，也不是另一个 Markdown 编辑器，而是一个专注于“AI Markdown → Word/WPS 文档”的轻量效率工具。

---

## 12. 参考资料

- [PasteMD：Markdown 和网页 AI 对话粘贴到 Word/WPS/Excel](https://github.com/RICHQAQ/PasteMD)
- [Pandoc GitHub](https://github.com/jgm/pandoc)
- [Pandoc Manual](https://pandoc.org/MANUAL.html)
- [Pandoc `--reference-doc`](https://pandoc.org/MANUAL.html#option--reference-doc)
- [Pandoc DOCX](https://pandoc.org/MANUAL.html#docx)
- [Pandoc custom styles in DOCX output](https://pandoc.org/MANUAL.html#custom-styles-in-docx-output)
- [Typora Export](https://support.typora.io/Export/)
- [Writage 官网](https://www.writage.com/)
- [Writage Docs](https://www.writage.com/docs/introduction/)
- [MarkText GitHub](https://github.com/marktext/marktext)
- [markdown-it GitHub](https://github.com/markdown-it/markdown-it)
- [markdown-it API](https://markdown-it.github.io/markdown-it/)
- [docx.js 官网](https://docx.js.org/)
- [dolanmiu/docx GitHub](https://github.com/dolanmiu/docx)
- [remark-docx](https://github.com/inokawa/remark-docx)
- [docx-rs](https://github.com/bokuweb/docx-rs)
- [python-docx](https://python-docx.readthedocs.io/en/latest/)
- [html-to-docx](https://github.com/privateOmega/html-to-docx)
- [docx4j](https://github.com/plutext/docx4j)
- [Tauri 官网](https://tauri.app/start/)
- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [Microsoft File Types / File Associations](https://learn.microsoft.com/en-us/windows/win32/shell/fa-file-types)

---

## 13. 当前结论

本项目最适合的路线是：

> **Tauri 桌面应用 + Pandoc 转换内核 + reference.docx 模板系统 + Windows 右键菜单/悬浮球/拖拽批量转换。**

先用 Pandoc 快速做出稳定可用的 DOCX 转换能力，再围绕模板管理、用户入口和 Word/WPS 兼容性打磨体验。后续如果用户对转换细节控制要求更高，再引入 `markdown-it + docx.js` 或 `docx-rs` 做自研转换引擎。

---

## 14. 开发与当前实现进度

### 14.1 本地开发命令

当前项目已经完成 Tauri + React + TypeScript + shadcn/ui + Rust commands 的初始框架搭建。

```bash
# 安装依赖
pnpm install

# 前端开发服务
pnpm dev

# 桌面端开发运行
pnpm tauri dev

# 前端类型检查与生产构建
pnpm build

# Rust/Tauri 后端编译检查
cargo check --manifest-path src-tauri/Cargo.toml
```

### 14.2 当前项目结构

```text
src/
├─ App.tsx                         # md-king 主界面壳与页面导航
├─ components/
│  ├─ ui/                          # shadcn/ui 基础组件
│  ├─ convert/                     # 转换输入、结果与设置组件
│  ├─ templates/                   # 模板中心与样式管理组件
│  ├─ history/                     # 转换历史卡片
│  ├─ layout/                      # 标题栏、侧边栏和应用壳
│  └─ command-preview/             # CLI 命令展示
├─ pages/
│  ├─ convert/                     # 转换主页
│  ├─ templates/                   # 模板中心
│  ├─ history/                     # 转换历史
│  ├─ cli/                         # CLI/API 说明
│  ├─ settings/                    # 设置页
│  └─ about/                       # 关于页
├─ lib/                            # Tauri invoke 封装与前端工具
├─ stores/                         # Zustand 状态管理
└─ types/                          # 前后端契约类型

src-tauri/src/
├─ commands/                       # 暴露给前端的 Tauri commands
├─ core/                           # 转换、模板、配置、Pandoc 检测/转换等核心模块
├─ storage/                        # 本地存储路径预留
├─ system/                         # 系统能力预留
├─ lib.rs                          # Tauri Builder 与 invoke_handler
└─ main.rs                         # 桌面应用入口
```

### 14.3 已完成

- 使用 Tauri 2 + React + TypeScript + Vite 搭建桌面应用骨架；
- 接入 Tailwind CSS v4 与 shadcn/ui；
- 替换默认脚手架页面，建立 md-king 主界面、侧边导航和页面结构；
- 建立转换主页、模板中心、历史记录、CLI/API、设置、关于等页面占位；
- 建立 TypeScript 类型契约、Tauri invoke 封装和 Zustand 状态；
- 建立 Rust `commands/`、`core/`、`storage/`、`system/` 模块骨架；
- 实现 Tauri commands：`get_app_status`、`get_app_config`、`check_pandoc`、`list_templates`、`list_history`、`convert_markdown`；
- `convert_markdown` 已支持“存在的 `.md` 文件路径 → 调用系统 Pandoc → 生成 `.docx`”的第一阶段真实转换；
- 粘贴文本输入目前仍返回占位结果，后续会写入临时 Markdown 文件后再调用 Pandoc；
- 已验证 `pnpm build` 与 `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

### 14.4 下一阶段

- 接入前端文件选择、拖拽读取、批量文件队列和输出路径选择；
- 实现粘贴文本/剪贴板内容写入临时 Markdown 文件后再调用 Pandoc 生成 DOCX；
- 实现 `reference.docx` 模板导入、`templateId` 到真实模板文件的映射、默认模板设置和模板诊断；
- 接入 SQLite 保存转换历史和任务状态；
- 实现 Rust CLI（`convert` / `batch` / `templates list` / `status --json`）；
- 后续再做 Windows 右键菜单、悬浮球、系统托盘和 MCP/API 入口。
