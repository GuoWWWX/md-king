# Windows 发布维护

## 版本与分支

1. 将修复合入 `develop`，通过 CI 后同步至 `main`。发版时两条远端分支指向同一提交。
2. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本，并更新浏览器预览 / 更新状态的版本默认值。
3. 推送 `vX.Y.Z` 标签。Release 工作流自动运行测试、构建和签名，再发布正式版本。手动运行工作流时输入已存在的版本标签。
4. 确认 Release 包含 EXE、MSI、`update-manifest.json`、`update-manifest.sig`、`SHA256SUMS.txt`，并检查工作流成功状态。

## 更新签名密钥

本项目使用 Ed25519 对更新清单的原始 UTF-8 字节签名。清单包含版本、安装包文件名、大小和 SHA-256。客户端固定可信仓库地址、校验清单签名，并在安装前再次校验文件。

- 客户端公钥：`src-tauri/update-public-key.txt`，Base64 编码的 32 字节公钥。
- 仓库 Secret：`UPDATE_SIGNING_PRIVATE_KEY`，Base64 编码的 PKCS#8 DER 私钥。
- 维护者本机备份：Codex 用户目录下的 `secrets/md-king/update-signing-key.der`。请保留离线备份，不要上传到仓库、Issue 或公开日志。
- 本地签名：在当前进程中读取私钥并设置该环境变量，然后执行 `node scripts/sign-update.mjs`；结束后清除进程中的环境变量。不要打印私钥或将其写入命令历史。

Release 工作流缺少私钥、版本不匹配、构建失败或公私钥不匹配时停止发布。签名保证安装包与维护者发布的清单一致；它不是 Windows Authenticode 代码签名，系统仍可能显示发布者 / 权限确认。

已发版客户端内置旧公钥。不要直接替换密钥后发布，否则旧客户端会拒绝更新；轮换前需要设计兼容迁移版本。

## 安装与验收

NSIS 包用于应用内更新；MSI 供手动安装使用。更新参数为 `/S /UPDATE /R /D=<当前可执行文件所在目录>`，其中 `/D` 必须放在最后。更新前持久化草稿会话，安装程序启动失败时保留当前应用。

手动运行 EXE 安装包时，检测到旧 NSIS 版本会显示“覆盖安装（保留原安装，推荐）”，并默认选中；同版本可选择“覆盖安装 / 修复当前版本”。覆盖安装直接更新原目录，不先运行卸载程序。仍保留“先卸载再安装”供用户主动选择。已有 MSI 版迁移到 EXE 版时，Tauri 会先调用 Windows Installer 移除 MSI；迁移页面不提供覆盖选项，以免误导用户。

验收检查：旧版本发现新版本 → 左侧提示 → 进度、取消和重试 → 签名 / 哈希校验 → 覆盖原目录 → 自动重启 → 关于页显示新版本。校验失败不得执行安装包。

README 的七张界面图是浏览器生产构建的 1920 × 1080 真实截图，源文档为 `docs/examples/technical-report.md`。浏览器截图不用于证明 Windows 安装、Pandoc 或系统集成功能。
