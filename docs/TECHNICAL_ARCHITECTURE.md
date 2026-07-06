# md-king 技术架构文档

> 版本：v0.1  
> 当前阶段：MVP 实现与验证  
> 技术路线：**Tauri + React + TypeScript + shadcn/ui + Rust + bundled Pandoc**

---

## 当前实现状态（2026-06）

桌面端默认优先使用应用内置 Pandoc：普通用户安装后无需单独安装 Pandoc；当用户填写自定义 `pandocPath` 时，该路径会覆盖内置 Pandoc；否则在 `useBundledPandoc = true` 时使用 bundled pandoc，最后才 fallback 到系统 `pandoc`。浏览器预览仅用于前端界面调试，Pandoc 检测和转换都是模拟能力，不生成真实 DOCX；真实验证必须使用 `pnpm tauri dev`。

当前已落地：Tauri command 转换、配置持久化、模板导入和保存、历史记录写入/清空、打开输出文件、默认输出目录、模板样式编辑器的表格样式前端预览。仍处规划期：Windows 右键菜单、悬浮球、系统托盘、CLI/MCP Server、本地 HTTP API、完整 DOCX 样式写回与批量队列。界面上这些入口应继续禁用或明确标注规划中，避免误导用户。

---

## 1. 架构目标

`md-king` 是一个面向 AI 生成 Markdown 内容的本地桌面工具，核心目标是把 Markdown 稳定转换为样式可控、可编辑、适配 Word/WPS 的 `DOCX` 文档。

技术架构需要同时满足：

1. **轻量流畅**：安装包和运行资源尽量小，避免 Electron 式臃肿体验。
2. **本地优先**：默认本地转换，不上传用户文档，保护隐私。
3. **样式可控**：基于 Word `reference.docx` 模板实现稳定样式复用。
4. **入口丰富**：支持桌面窗口、拖拽、剪贴板、悬浮球、右键菜单、CLI。
5. **AI 智能体友好**：提供结构化 CLI 输出，方便 agent、脚本、自动化系统调用。
6. **可演进**：MVP 先用 Pandoc 快速落地，后续可扩展自研 DOCX 引擎、MCP Server、云端模板市场。

---

## 2. 最终技术选型

| 层级 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | `Tauri 2` | 轻量桌面容器，使用系统 WebView，Rust 后端适合本地系统集成 |
| 前端框架 | `React` | 组件生态成熟，适合复杂交互 UI |
| 前端语言 | `TypeScript` | 类型安全，便于维护和与 CLI/API 类型共享 |
| 构建工具 | `Vite` | 启动快，适合 Tauri 前端开发 |
| UI 组件 | `shadcn/ui` | 现代、可定制、适合做漂亮工具型产品 |
| 样式 | `Tailwind CSS` | 与 shadcn/ui 配套，快速构建现代 UI |
| 图标 | `lucide-react` | 与 shadcn/ui 风格统一 |
| 状态管理 | `Zustand` 或 `Jotai` | 轻量状态管理，避免引入复杂全局架构 |
| 表单 | `react-hook-form` + `zod` | 用于模板配置、转换参数、设置页面校验 |
| 本地后端 | `Rust / Tauri commands` | 文件、进程、注册表、剪贴板、系统托盘、CLI 等本地能力 |
| CLI | `Rust clap` | 与核心逻辑复用，输出稳定，适合 AI 智能体调用 |
| 转换引擎 | `Pandoc CLI sidecar` | MVP 默认转换内核，成熟支持 Markdown → DOCX |
| 模板机制 | `reference.docx` | Pandoc 官方机制，用 Word/WPS 样式模板控制输出格式 |
| 本地数据库 | `SQLite` | 存转换历史、任务状态、模板索引 |
| 配置文件 | `TOML / JSON` | 存用户配置、默认模板、Pandoc 路径等 |
| 日志 | `tracing` / `tauri-plugin-log` | Rust 侧结构化日志 |
| 后续云端 API | `NestJS` | 仅在做账号、模板市场、团队空间时引入 |
| 后续官网/模板市场 | `Next.js` | 仅用于 Web 官网、模板市场、用户后台，不用于桌面 MVP |

---

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│                         用户入口                            │
├────────────────────────────────────────────────────────────┤
│  桌面主窗口  悬浮球  系统托盘  右键菜单  剪贴板  CLI/Agent   │
└───────────────┬────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────┐
│                      React 前端 UI                          │
├────────────────────────────────────────────────────────────┤
│  文件拖拽  模板选择  任务队列  历史记录  设置  CLI 说明页      │
│  React + TypeScript + Vite + Tailwind + shadcn/ui           │
└───────────────┬────────────────────────────────────────────┘
                │ Tauri invoke
                ▼
┌────────────────────────────────────────────────────────────┐
│                    Rust 本地应用服务层                      │
├────────────────────────────────────────────────────────────┤
│  ConvertService     Markdown 转 DOCX 任务编排               │
│  TemplateService    模板导入、选择、诊断                    │
│  HistoryService     转换历史和任务状态                      │
│  ConfigService      用户配置                                │
│  SystemService      右键菜单、托盘、悬浮球、剪贴板            │
│  CliService         命令行入口与 JSON 输出                   │
└───────────────┬────────────────────────────────────────────┘
                │ Command / Process
                ▼
┌────────────────────────────────────────────────────────────┐
│                       转换引擎层                            │
├────────────────────────────────────────────────────────────┤
│  Pandoc sidecar                                            │
│  markdown-it 预览/清洗，后续 docx.js/docx-rs 自研引擎预留     │
└───────────────┬────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────┐
│                       本地文件系统                          │
├────────────────────────────────────────────────────────────┤
│  input.md  output.docx  templates/*.docx  history.db  logs   │
└────────────────────────────────────────────────────────────┘
```

---

## 4. 设计原则

### 4.1 桌面端不是传统 Web 后端

本项目 MVP 不是 SaaS，不需要一开始引入常驻 Web Server。

不推荐 MVP 使用：

- `NestJS` 作为本地后端；
- `Next.js` 作为桌面端前端；
- 本地 HTTP 服务作为 UI 与后端通信主路径。

原因：

- 本地转换、文件处理、注册表、托盘、CLI 等能力由 Tauri Rust 层直接处理更自然；
- 常驻 Node/Nest 服务会增加进程、端口、打包体积和排错成本；
- Next.js 的 SSR/API Routes/SEO 对桌面端主窗口价值有限；
- `React + Vite` 更适合 Tauri 本地 UI。

### 4.2 所有入口共用同一套核心逻辑

不能让主窗口、CLI、右键菜单各自实现一套转换逻辑。正确架构是：

```text
桌面 UI ─┐
悬浮球  ─┤
右键菜单 ─┤
CLI     ─┤──▶ mdking-core ─▶ Pandoc ─▶ DOCX
Agent   ─┘
```

这样可以保证：

- 同一输入、同一模板、同一参数，输出结果一致；
- CLI 和 GUI 的行为一致；
- 右键菜单只是调用 CLI，不重复实现；
- 后续 MCP Server 也可以复用核心逻辑。

### 4.3 MVP 先复用成熟转换能力

DOCX 格式复杂，MVP 不应自研完整 DOCX 生成器。优先使用 Pandoc：

```bash
pandoc input.md -o output.docx --reference-doc template.docx
```

后续再根据用户反馈决定是否引入：

- `markdown-it + docx.js`；
- `docx-rs`；
- 自定义 Pandoc filter；
- DOCX 后处理器。

---

## 5. 模块划分

## 5.1 前端模块

```text
src/
├─ App.tsx                      # 当前主界面壳、页面导航和全局布局
├─ main.tsx                     # React 应用入口
├─ components/                  # 通用组件
│  ├─ ui/                       # shadcn/ui 组件
│  ├─ convert/                  # 转换输入、结果与设置组件
│  ├─ templates/                # 模板中心与样式管理组件
│  ├─ history/                  # 转换历史卡片
│  ├─ layout/                   # 标题栏、侧边栏和应用壳
│  └─ command-preview/          # CLI 命令展示
├─ pages/
│  ├─ convert/                  # 转换主页
│  ├─ templates/                # 模板中心
│  ├─ history/                  # 转换历史
│  ├─ cli/                      # CLI/API 说明
│  ├─ settings/                 # 设置
│  └─ about/                    # 关于
├─ stores/                      # Zustand 状态
├─ lib/                         # Tauri invoke 封装与前端工具函数
├─ types/                       # TypeScript 类型
├─ assets/                      # 静态资源
└─ vite-env.d.ts
```

当前实现暂未拆出 `src/app/` 和 `src/hooks/`，后续页面复杂度上升后再按需补充分层。

### 5.1.1 主要页面

| 页面 | 作用 |
|---|---|
| 转换主页 | 拖拽文件、选择模板、开始转换、查看当前任务 |
| 模板中心 | 导入模板、设置默认模板、查看模板信息 |
| 历史记录 | 查看成功/失败转换记录，打开输出文件 |
| CLI/API | 展示命令行用法、JSON 输出示例、agent 调用说明 |
| 设置 | Pandoc 路径、输出目录、右键菜单、悬浮球、开机启动等 |
| 关于 | 版本、许可证、依赖信息 |

### 5.1.2 前端调用后端方式

使用 Tauri `invoke`：

```ts
import { invoke } from "@tauri-apps/api/core"

const result = await invoke<ConvertResult>("convert_markdown", {
  input: "D:/docs/input.md",
  output: "D:/docs/input.docx",
  templateId: "business-report"
})
```

前端不直接调用 Pandoc，不直接写注册表，不直接操作系统关键能力。

---

## 5.2 Rust 本地后端模块

推荐 Rust 侧按功能拆分：

```text
src-tauri/src/
├─ main.rs                      # Tauri 启动入口
├─ lib.rs                       # Tauri Builder 与 invoke_handler
├─ commands/                    # 暴露给前端的 Tauri commands
│  ├─ convert_commands.rs
│  ├─ template_commands.rs
│  ├─ history_commands.rs
│  ├─ config_commands.rs
│  ├─ system_commands.rs
│  └─ mod.rs
├─ core/                        # 业务核心模块
│  ├─ convert.rs                # 转换请求/结果；已支持存在的 .md 文件路径调用 Pandoc 生成 DOCX
│  ├─ pandoc.rs                 # Pandoc 检测与命令执行封装
│  ├─ template.rs               # 内置模板占位数据
│  ├─ history.rs                # 历史记录占位数据
│  ├─ config.rs                 # 默认配置
│  ├─ errors.rs                 # 统一错误类型
│  └─ mod.rs
├─ system/                      # 系统集成预留
│  ├─ open_file.rs              # 打开文件/目录占位
│  └─ mod.rs
└─ storage/                     # 本地存储预留
   ├─ paths.rs                  # 应用数据目录提示
   └─ mod.rs
```

当前实现尚未加入 `core/markdown.rs`、`system/windows_context_menu.rs`、`tray.rs`、`floating_window.rs`、`clipboard.rs`、`storage/sqlite.rs`、`storage/migrations.rs` 和 `cli/` 目录；这些仍是后续阶段的目标模块。

推荐 Rust 侧按功能逐步补全，后续项目变大后可拆成 Rust workspace：

```text
crates/
├─ mdking-core/
├─ mdking-pandoc/
├─ mdking-template/
├─ mdking-storage/
├─ mdking-windows/
└─ mdking-cli/
```

MVP 初期可以先放在 `src-tauri/src`，避免过早复杂化。

---

## 5.3 核心服务说明

### 5.3.1 ConvertService

负责转换任务：

- 接收输入文件/剪贴板内容；
- 解析转换参数；
- 查找模板；
- 调用 Pandoc；
- 处理输出路径；
- 记录历史；
- 返回结构化结果。

核心输入：

```ts
type ConvertRequest = {
  input: string
  output?: string
  templateId?: string
  openAfterConvert?: boolean
  overwrite?: boolean
}
```

核心输出：

```ts
type ConvertResult = {
  ok: boolean
  input: string
  output?: string
  templateId?: string
  durationMs: number
  warnings: string[]
  errorCode?: string
  message?: string
}
```

### 5.3.2 PandocService

负责封装 Pandoc 调用：

- 检测 Pandoc 是否存在；
- 获取 Pandoc 版本；
- 处理内置 sidecar 路径；
- 拼接安全参数；
- 捕获 stdout/stderr；
- 超时控制；
- 返回统一错误。

示例命令：

```bash
pandoc input.md \
  -o output.docx \
  --from markdown+table_captions+fenced_code_blocks \
  --to docx \
  --reference-doc template.docx
```

### 5.3.3 TemplateService

负责模板：

- 内置模板初始化；
- 用户模板导入；
- 模板元数据读取；
- 默认模板设置；
- 模板删除/重命名；
- 模板诊断；
- 打开模板文件让用户编辑。

模板元数据示例：

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

### 5.3.4 HistoryService

负责转换历史：

- 记录转换任务；
- 查询最近任务；
- 按状态筛选；
- 打开输出文件；
- 清空历史；
- CLI 查询最近结果。

### 5.3.5 ConfigService

负责配置：

- Pandoc 路径；
- 默认模板；
- 默认输出目录；
- 是否启用右键菜单；
- 是否启用悬浮球；
- 是否开机启动；
- CLI 默认输出格式；
- 日志级别。

---

## 6. CLI 架构

## 6.1 CLI 定位

CLI 是本项目的重要入口，不只是附属功能。它服务于：

- 高级用户；
- Shell 脚本；
- 企业自动化；
- AI 智能体；
- Windows 右键菜单；
- 后续 MCP Server。

## 6.2 技术选择

使用 Rust `clap` 实现：

```text
md-king.exe
├─ GUI 模式：双击打开桌面窗口
└─ CLI 模式：带子命令时执行命令行任务
```

也可以拆成两个二进制：

```text
md-king.exe       # 桌面应用
md-king-cli.exe   # 命令行工具
```

MVP 推荐先用同一核心逻辑，是否拆二进制看 Tauri 打包便利性决定。

## 6.3 CLI 命令设计

```bash
# 单文件转换
md-king convert ./input.md -o ./output.docx --template report

# 批量转换
md-king batch ./docs --out ./dist --template official

# 从剪贴板转换
md-king clipboard --template default --open

# 查看模板列表
md-king templates list

# 查看默认模板
md-king templates default

# 设置默认模板
md-king templates use official-report

# 查看转换历史
md-king history list

# 查看最近一次转换结果
md-king history latest

# 查看当前状态
md-king status

# 机器可读输出
md-king status --json
md-king templates list --json
md-king convert ./input.md --template report --json
```

## 6.4 CLI JSON 输出规范

成功：

```json
{
  "ok": true,
  "input": "D:/docs/input.md",
  "output": "D:/docs/input.docx",
  "templateId": "report",
  "durationMs": 842,
  "warnings": []
}
```

失败：

```json
{
  "ok": false,
  "errorCode": "PANDOC_NOT_FOUND",
  "message": "未找到 Pandoc，请安装 Pandoc 或启用内置 Pandoc。",
  "input": "D:/docs/input.md"
}
```

退出码：

| 退出码 | 含义 |
|---:|---|
| `0` | 成功 |
| `1` | 通用失败 |
| `2` | 参数错误 |
| `3` | 输入文件不存在 |
| `4` | Pandoc 不可用 |
| `5` | 模板不存在或无效 |
| `6` | 输出路径不可写 |

---

## 7. 转换流程

## 7.1 单文件转换流程

```text
用户选择 input.md
      │
      ▼
前端提交 ConvertRequest
      │
      ▼
Rust ConvertService 校验输入
      │
      ▼
TemplateService 解析模板路径
      │
      ▼
PandocService 调用 Pandoc
      │
      ▼
生成 output.docx
      │
      ▼
HistoryService 写入历史
      │
      ▼
返回 ConvertResult 给前端
      │
      ▼
前端显示成功/失败，可打开文件
```

## 7.2 右键菜单转换流程

```text
用户右键 .md 文件
      │
      ▼
Windows Shell 调用 md-king convert "%1"
      │
      ▼
CLI 解析参数
      │
      ▼
调用同一套 ConvertService
      │
      ▼
输出 DOCX
      │
      ▼
返回退出码 / 可选通知用户
```

## 7.3 AI 智能体调用流程

```text
AI agent 生成 input.md
      │
      ▼
执行 md-king convert input.md --template report --json
      │
      ▼
读取 JSON 结果
      │
      ▼
如果 ok=true，拿到 output.docx 路径
      │
      ▼
后续打开、发送或继续处理
```

---

## 8. 本地数据目录

推荐目录结构：

```text
用户数据目录/md-king/
├─ config.toml
├─ history.db
├─ templates/
│  ├─ default.docx
│  ├─ business-report.docx
│  ├─ academic-paper.docx
│  └─ templates.json
├─ cache/
│  └─ previews/
├─ logs/
│  ├─ app.log
│  └─ pandoc.log
└─ temp/
   └─ clipboard-convert-*.docx
```

Windows 上可放在：

```text
%APPDATA%/md-king/
```

或使用 Tauri app data dir。

---

## 9. 数据模型

## 9.1 Template

```ts
type Template = {
  id: string
  name: string
  description?: string
  referenceDocxPath: string
  previewImagePath?: string
  tags: string[]
  isBuiltIn: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}
```

## 9.2 ConvertTask

```ts
type ConvertTask = {
  id: string
  inputPath: string
  outputPath?: string
  templateId?: string
  status: "pending" | "running" | "success" | "failed"
  durationMs?: number
  errorCode?: string
  errorMessage?: string
  createdAt: string
  finishedAt?: string
}
```

## 9.3 AppConfig

```ts
type AppConfig = {
  pandocPath?: string
  useBundledPandoc: boolean
  defaultTemplateId: string
  defaultOutputDir?: string
  openAfterConvert: boolean
  enableContextMenu: boolean
  enableFloatingBall: boolean
  enableTray: boolean
  cliDefaultJson: boolean
  logLevel: "error" | "warn" | "info" | "debug"
}
```

---

## 10. 错误码设计

| 错误码 | 说明 | 用户提示 |
|---|---|---|
| `INPUT_NOT_FOUND` | 输入文件不存在 | 请检查 Markdown 文件路径 |
| `INPUT_NOT_MARKDOWN` | 输入格式不是 Markdown | 请选择 `.md` 或 `.markdown` 文件 |
| `OUTPUT_NOT_WRITABLE` | 输出路径不可写 | 请更换输出目录或检查权限 |
| `TEMPLATE_NOT_FOUND` | 模板不存在 | 请重新选择模板 |
| `TEMPLATE_INVALID` | 模板文件无效 | 请导入有效的 `.docx` 模板 |
| `PANDOC_NOT_FOUND` | 找不到 Pandoc | 请安装 Pandoc 或启用内置 Pandoc |
| `PANDOC_FAILED` | Pandoc 转换失败 | 请查看错误日志 |
| `CLIPBOARD_EMPTY` | 剪贴板为空 | 请先复制 Markdown 内容 |
| `WINDOWS_CONTEXT_MENU_FAILED` | 右键菜单注册失败 | 请检查权限或手动重试 |
| `UNKNOWN_ERROR` | 未知错误 | 请查看日志并反馈 |

---

## 11. Windows 系统集成

## 11.1 右键菜单

通过注册表写入当前用户级别：

```text
HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.md\shell\MdKingConvert
HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.md\shell\MdKingConvert\command
```

命令指向：

```text
md-king.exe convert "%1"
```

原则：

- 默认不强制写入；
- 用户在设置中开启；
- 优先 `HKCU`，避免管理员权限；
- 卸载或关闭功能时清理；
- 多文件右键后续支持。

## 11.2 悬浮球

通过 Tauri 独立窗口实现：

```text
FloatingBallWindow
├─ transparent: true
├─ decorations: false
├─ always_on_top: true
├─ resizable: false
├─ skip_taskbar: true
└─ drag_drop: true
```

交互：

- 单击：从剪贴板转换；
- 拖入文件：转换文件；
- 右键：选择模板/打开主窗口/查看历史；
- 双击：打开主窗口；
- 悬停：显示当前模板。

## 11.3 系统托盘

托盘菜单：

- 打开主窗口；
- 从剪贴板转换；
- 切换默认模板；
- 打开历史记录；
- 显示/隐藏悬浮球；
- 退出。

---

## 12. Pandoc 集成策略

## 12.1 开发期

开发期先检测系统 Pandoc：

```bash
pandoc --version
```

这样实现最快。

## 12.2 发布期

正式发布建议：

```text
优先使用内置 Pandoc sidecar
允许用户改用系统 Pandoc
设置页显示当前 Pandoc 版本
```

原因：

- 普通用户不需要自己安装 Pandoc；
- 输出质量更可控；
- 便于排错；
- 企业离线环境可用。

## 12.3 参数构建原则

必须避免 shell 拼接风险。Rust 侧应使用进程参数数组，而不是拼接字符串：

```rust
Command::new(pandoc_path)
  .arg(input_path)
  .arg("-o")
  .arg(output_path)
  .arg("--reference-doc")
  .arg(template_path)
```

---

## 13. Markdown 清洗与预览

MVP 可先只做基础检查：

- 文件是否为空；
- 是否存在标题；
- 代码块是否闭合；
- 图片路径是否存在；
- 表格格式是否明显错误。

前端预览使用：

```text
markdown-it → HTML preview
```

后续增强：

- AI Markdown 清洗；
- 标题层级修复；
- 表格修复；
- 图片复制到资源目录；
- 自定义 Pandoc filters。

---

## 14. 安全与隐私

### 14.1 本地文件安全

- 默认不上传用户文档；
- 转换在本地进行；
- 临时文件定期清理；
- CLI 不输出敏感正文，只输出路径和状态；
- 日志避免记录完整文档内容。

### 14.2 命令执行安全

- Pandoc 调用使用参数数组；
- 不拼接 shell 字符串；
- 限制 sidecar 路径；
- 对输入/输出路径做存在性和权限校验。

### 14.3 模板安全

- 导入模板只接受 `.docx`；
- 不执行模板中的宏；
- 对模板路径做白名单或用户数据目录管理；
- 模板诊断只读取结构和样式元数据。

---

## 15. 后续云端架构预留

MVP 不做云端，但架构预留：

```text
apps/
├─ desktop/      # Tauri + React
├─ web/          # Next.js 官网/模板市场
├─ server/       # NestJS 云端 API
└─ cli/          # Rust CLI 或独立分发
```

后续云端能力：

- 用户账号；
- 模板市场；
- 团队模板库；
- 会员订阅；
- 云同步；
- 企业授权；
- 模板审核；
- 远程 API。

云端建议：

```text
Web 前端：Next.js
API 后端：NestJS
数据库：PostgreSQL
缓存/队列：Redis
对象存储：S3/R2/OSS/COS
鉴权：Auth.js / JWT / 企业 SSO
```

---

## 16. 后续 AI 智能体集成预留

本项目后续可以提供：

### 16.1 CLI Agent 模式

AI 智能体直接调用：

```bash
md-king convert ./draft.md --template official --json
```

### 16.2 本地 HTTP API

可选启动本地服务：

```bash
md-king serve --port 39721
```

用于本机自动化，不建议 MVP 做。

### 16.3 MCP Server

后续提供：

```text
md-king-mcp-server
├─ convert_markdown_to_docx
├─ list_templates
├─ get_convert_history
├─ get_latest_output
└─ validate_template
```

这样 Claude Code、Cursor、其他 agent 可以把 `md-king` 当作本地文档转换工具调用。

---

## 17. MVP 开发阶段划分

## 17.1 阶段一：转换原型

目标：命令行可完成 Markdown → DOCX。

任务：

- Rust 调用 Pandoc；
- 输入 `.md` 输出 `.docx`；
- 支持 `--reference-doc`；
- 输出 JSON 结果；
- 基础错误码。

## 17.2 阶段二：桌面主窗口

目标：普通用户可用。

任务：

- Tauri + React + shadcn/ui；
- 文件拖拽；
- 模板选择；
- 单文件转换；
- 成功后打开文件；
- 转换历史。

## 17.3 阶段三：模板中心

目标：解决格式复用。

任务：

- 内置模板；
- 导入模板；
- 默认模板；
- 模板列表；
- 模板诊断基础版。

## 17.4 阶段四：效率入口

目标：形成产品差异。

任务：

- 剪贴板转换；
- 右键菜单；
- 系统托盘；
- 悬浮球；
- 批量转换。

## 17.5 阶段五：Agent 友好能力

目标：支持 AI 智能体和自动化。

任务：

- 完善 CLI；
- 所有命令支持 `--json`；
- 稳定退出码；
- 文档化命令；
- 后续 MCP Server 设计。

---

## 18. 当前目录结构与后续目标

当前仓库已经落地的主要结构：

```text
md-king/
├─ README.md
├─ docs/
│  └─ TECHNICAL_ARCHITECTURE.md
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ components.json              # shadcn/ui 配置
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ components/
│  │  ├─ ui/
│  │  ├─ convert/
│  │  ├─ templates/
│  │  ├─ history/
│  │  ├─ layout/
│  │  └─ command-preview/
│  ├─ pages/
│  ├─ stores/
│  ├─ lib/
│  ├─ types/
│  ├─ assets/
│  └─ vite-env.d.ts
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     ├─ commands/
│     ├─ core/
│     ├─ system/
│     └─ storage/
└─ __scaffold_md_king/          # 初始脚手架参考目录，可后续清理
```

`tailwind.config.ts`、`src/app/`、`src/hooks/`、`src-tauri/src/cli/`、根目录 `templates/` 与 `tests/` 仍属于后续可选补充结构，不是当前实现的一部分。

---

## 19. 当前结论

本项目推荐架构最终确定为：

```text
Tauri 2
+ React
+ TypeScript
+ Vite
+ Tailwind CSS
+ shadcn/ui
+ Rust 本地后端
+ Rust CLI
+ Pandoc sidecar
+ reference.docx 模板系统
+ SQLite 本地历史
```

暂不引入：

- `NestJS`：留给后期云端 API；
- `Next.js`：留给官网、模板市场、Web 控制台；
- 自研 DOCX 引擎：留给转换质量需要突破 Pandoc 时；
- 本地 HTTP Server：留给后续 MCP/API 集成。

一句话：

> **MVP 先把本地桌面转换工具做轻、做稳、做顺手；后期再平台化、云端化、Agent 化。**
