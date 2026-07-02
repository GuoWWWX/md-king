# md-king 设计资产

本目录保存 md-king 的视觉探索和页面设计稿。当前主方向是 Variant C：柔和玻光蓝。

## C 风格页面

| 页面 | HTML | 高清图 |
|---|---|---|
| 转换工作台 | `md-king-c-01-convert-workbench.html` | `md-king-c-01-convert-workbench-full.png` |
| 模板中心 | `md-king-c-02-template-center.html` | `md-king-c-02-template-center-full.png` |
| 转换历史 | `md-king-c-03-history.html` | `md-king-c-03-history-full.png` |
| 快速入口 | `md-king-c-04-quick-entry.html` | `md-king-c-04-quick-entry-full.png` |
| Agent 与命令行 | `md-king-c-05-agent-cli.html` | `md-king-c-05-agent-cli-full.png` |
| 设置中心 | `md-king-c-06-settings.html` | `md-king-c-06-settings-full.png` |
| 关于与系统状态 | `md-king-c-07-about-status.html` | `md-king-c-07-about-status-full.png` |

同名 `.png` 文件是 Stitch 返回的 512px 缩略图；`*-full.png` 是用本地 Chrome 从 HTML 渲染的 2560x2048 高清参考图。

## 使用说明

- 后续实现 UI 时优先参考 `*-full.png`。
- HTML 用于查看布局和提取局部结构，但不要直接复制生成代码到 React 页面。
- 视觉 token 和实现原则见 [../UI_STYLE_DIRECTION.md](../UI_STYLE_DIRECTION.md)。

## 旧探索稿

- `md-king-blue-variant-c-glass.*`：用户选中的 C 风格主屏原始稿。
- `md-king-blue-variant-a-office.*`：A 风格，已淘汰。
- `md-king-dimensional-blue-workspace*`：早期蓝色立体探索稿，已作为参考，不作为主方向。
- `md-king-style-board*`：风格板探索稿。
