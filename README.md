<div align="center">

<img src="docs/images/logo.png" alt="MD King Logo" width="108" height="108" />

# MD King · Markdown 编辑器与 Markdown 转 Word 工具

**用 Markdown 写作，按自定义模板导出 Word / WPS 文档。**

A local Markdown editor and Markdown-to-Word (DOCX) converter with customizable document styles and templates.

[![Release](https://img.shields.io/github/v/release/GuoWWWX/md-king?color=blue&style=flat-square)](https://github.com/GuoWWWX/md-king/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-brightgreen?style=flat-square)](https://github.com/GuoWWWX/md-king/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

<p align="center">
  <a href="https://github.com/GuoWWWX/md-king/releases/latest"><strong>下载 Windows 版</strong></a> •
  <a href="#quick-start">使用示例</a> •
  <a href="#features">功能截图</a> •
  <a href="https://github.com/GuoWWWX/md-king/issues">反馈问题</a> •
  <a href="#development">开发贡献</a>
</p>

</div>

MD King 是一个 Windows 本地桌面应用，主要提供两种功能：

| 功能 | 可以做什么 |
| :--- | :--- |
| Markdown 编辑器 | 用文件树管理文档，通过大纲定位章节，实时渲染表格、LaTeX 公式和 Mermaid 图表，支持深浅色模式。 |
| Markdown 转 Word / WPS | 将 `.md` 导出为可继续编辑的 `.docx`；自定义模板的字体、字号、行距、缩进、页边距和标题编号，在不同文档中复用。 |

适合写技术方案、工作报告或论文草稿：用 Markdown 组织内容，再按需要的格式交付 Word 文档。来自 ChatGPT、Claude、DeepSeek 等工具的 Markdown 内容也可以在这里编辑、排版和导出。编辑与转换在本机完成，无需上传文档。

下图展示日常写作布局：左侧文件树、中间 Markdown 内容、右侧标题大纲。Word 预览可通过工具栏开启，首图中已隐藏。

![左侧文件树、中间 Markdown 内容与右侧大纲目录](docs/images/feature-workbench.jpg)

<a id="download"></a>

## 下载与安装

支持 Windows 10 / 11，64 位。前往 [最新 Release](https://github.com/GuoWWWX/md-king/releases/latest)，下载 `md-king_<版本>_x64-setup.exe` 后双击安装，安装包内置 Pandoc 转换引擎，无需准备开发环境。

已有 EXE 版可选择覆盖安装；应用内也支持检查和安装更新。Release 同时提供 MSI 安装包及校验文件。

<a id="quick-start"></a>

## 从 Markdown 到 Word

可以用仓库里的[技术报告示例](docs/examples/technical-report.md)试一次完整流程，内容包含多级标题、表格、公式、Mermaid 时序图和代码块。

1. 打开示例 `.md` 文件，在编辑器中修改内容，通过右侧大纲定位章节。
2. 在模板中心选择预设模板，或创建自己的模板。也可以导入已有 `.docx` 的参考样式。
3. 进入样式管理器，调整标题编号、正文中英文字体、字号、行距和页面设置，保存模板。
4. 选择模板并导出 `.docx`，用 Word / WPS 打开检查排版，继续编辑或交付。

例如，同一份报告可以分别使用团队报告模板和课程论文模板导出，无需为每份文档重新设置样式。导入的 DOCX 用于参考样式，模板中的正文不会复制进新文档。

<a id="features"></a>

## 功能展示

### 自定义 Word / WPS 模板样式

在样式管理器中设置标题 1~6 级、正文、列表、代码块、表格和页面样式。支持中英文字体、字号、字重、首行缩进、段前段后间距、行距及多级标题编号，保存后可用于后续导出。

![Word/WPS 模板样式编辑器：字体、字号、间距与编号设置](docs/images/feature-style-manager.jpg)

### 模板中心

选择报告、公文、技术文档等预设模板，或创建自定义模板、导入 DOCX 参考样式。模板支持分组管理和设置默认值。

![模板中心：选择预设模板、导入和管理自定义模板](docs/images/feature-templates.jpg)

### Word 文档导出效果

Markdown 内容导出为 DOCX，支持标题编号、表格、图表和题注。下图为此前生成的文档页，实际分页需在目标 Word / WPS 环境中核对。

![Markdown 转 Word 后的 DOCX 文档页](docs/images/feature-word-preview.png)

<details>
<summary>查看更多截图：大纲、深色模式、设置与更新</summary>

### 大纲目录导航

展开右侧文档大纲，通过多级标题快速定位长篇文档中的章节。

![侧边大纲目录导航](docs/images/feature-workbench-outline.jpg)

### 深色模式

编辑器支持深浅色模式，Mermaid 图表随主题调整背景与文字颜色，代码块保留语法高亮。

![深色 Markdown 编辑器与 Mermaid 时序图](docs/images/feature-dark-mode.jpg)

### 设置

配置输出目录、主题和快捷操作，检查与维护 Pandoc 引擎。

![设置页面：输出目录、主题、快捷操作与 Pandoc 引擎](docs/images/feature-settings.jpg)

### 关于与更新

查看版本信息、Markdown 语法速览，并在 Windows 桌面版中检查更新。

![关于与版本中心](docs/images/feature-about.jpg)

</details>

截图说明：七张应用界面图来自 v1.1.9 前端生产构建在浏览器中实际运行的 1920 × 1080 截图，使用上述技术报告示例；首图文件树来自浏览器示例仓库。DOCX 导出图保留原始纸张比例。浏览器用于前端展示，文件系统操作、Pandoc 转换、系统集成和自动安装更新在 Windows 桌面版运行。

## 其他功能

- LaTeX 行内与块级公式、Mermaid 流程图和时序图、代码高亮、表格、任务清单与 Callout 提示框。
- Windows 右键菜单、全局快捷键 `Ctrl+Alt+V` 与悬浮球转换入口。
- 应用内更新提示、下载进度、取消与失败重试。

## 应用内自动更新

主界面首次启动后 3 秒检查新版本；从托盘恢复或再次启动已有进程时主动检查，持续运行期间每 4 小时检查一次。也可以在“关于”页手动检查。

检测到新版本时，左侧栏下半部分会显示提示。点击后查看发布说明，再点击“立即更新”，弹窗显示下载字节数、百分比和网速。客户端验证签名和安装包哈希后，保存草稿会话，启动覆盖安装并重启。Windows 权限确认仍需用户处理。

<details>
<summary>更新校验与异常处理</summary>

更新来源固定为本仓库正式 Release。客户端先验证内置公钥对应的 Ed25519 清单签名，再验证安装包大小和 SHA-256；校验不通过会阻止安装。草稿存储失败或安装程序启动失败时保留当前应用，允许重试。网络不可用时不会自动退出当前应用。

</details>

<a id="development"></a>

## 🛠️ 开发与代码分支规范

本项目采用清晰的双分支研发规范，欢迎提交 Issue 与 Pull Request：

- **`main` 分支**：主分支，保持稳定可发布状态，每一次发版均打有对应版本的 Git Tag（如 `v1.1.11`）；
- **`develop` 分支**：开发分支，承载日常功能开发与特性合流，新功能提 PR 请合并至此分支。

### 本地启动与构建

需要 Node.js 24.3+、pnpm 10.33.0、Rust stable、Git LFS；Windows 桌面构建还需要 Visual Studio 的 C++ 工具链与 Windows SDK。发布时 `main` 与 `develop` 同步到同一提交，开发中的 `develop` 可以先于 `main`。

```bash
# 1. 克隆仓库
git clone https://github.com/GuoWWWX/md-king.git
cd md-king
git lfs pull

# 2. 安装前端依赖
pnpm install --frozen-lockfile

# 3. 运行前端开发模式
pnpm dev

# 4. 启动 Tauri 桌面端调试
pnpm tauri dev

# 5. 打包生产安装包
pnpm tauri:build
```

---

### 测试、发布与本地路径

```powershell
pnpm build
pnpm test:unit
# Windows 本机可使用 MSVC 环境包装器
pnpm test:msvc
scripts\cargo-msvc.bat tauri-build
```

- NSIS 安装包：`src-tauri/target/release/bundle/nsis/md-king_1.1.13_x64-setup.exe`。
- MSI 安装包：`src-tauri/target/release/bundle/msi/`。
- 当前维护者本机安装路径：`G:\md-king\md-king.exe`；其他用户的升级目录取自当前正在运行的可执行文件，无需修改源码。

CI 对 `main`、`develop` 和 Pull Request 执行前端构建、单元测试与 Rust 测试。发版时同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本，推送对应 `vX.Y.Z` 标签。Release 工作流会先测试，再构建 EXE/MSI，并上传签名清单与校验文件。

客户端公钥位于 `src-tauri/update-public-key.txt`。GitHub 仓库 Secret `UPDATE_SIGNING_PRIVATE_KEY` 保存匹配的 Ed25519 PKCS#8 私钥（Base64）；私钥不能提交到仓库。签名脚本会检查私钥、公钥与版本是否匹配，不匹配则终止发布。密钥维护与验收步骤见[发布维护说明](docs/RELEASING.md)。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。欢迎 Star 🌟 与 Fork 贡献！
