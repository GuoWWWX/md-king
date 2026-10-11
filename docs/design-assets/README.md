# md-king 设计资产

本目录保留文档采用的 Variant C 页面设计参考和当前 Logo 的高清源图。实际界面以应用代码为准，README 中的应用截图位于 `../images/`。

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

`*-full.png` 是用本地 Chrome 从 HTML 渲染的 2560x2048 高清参考图；重复缩略图和已淘汰的探索稿不再保留。

## 使用说明

- 后续实现 UI 时优先参考 `*-full.png`。
- HTML 用于查看布局和提取局部结构，但不要直接复制生成代码到 React 页面。
- 视觉 token 和实现原则见 [../UI_STYLE_DIRECTION.md](../UI_STYLE_DIRECTION.md)。

## Logo

- [当前 Logo 高清源图](logo/source.png)：用于重新生成应用图标。
- 应用使用的 PNG 位于 `../../public/md-king-logo.png`，桌面安装与窗口图标位于 `../../src-tauri/icons/`。
- 候选图、旧 Logo、任务栏检查截图和重复导出图不再保留。
