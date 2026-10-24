# 命令行使用

Windows 安装目录中包含 `md-king-cli.exe`。以下命令假设程序已加入 PATH；没有加入时，可在 PowerShell 使用 `& 'G:\md-king\md-king-cli.exe'` 代替 `md-king-cli`。

## 帮助与退出码

```powershell
md-king-cli --help
md-king-cli convert --help
md-king-cli templates --help
md-king-cli templates import --help
md-king-cli templates replace --help
md-king-cli --version
```

退出码：`0` 成功，`1` 执行失败，`2` 参数错误。帮助和版本查询返回 `0`。业务命令支持 `--json`，失败时返回 `ok: false`、`errorCode` 和 `message`；Clap 参数解析错误写入标准错误，不输出 JSON。

## 导入与覆盖模板

先在 Word/WPS 中准备好 DOCX，首次导入：

```powershell
md-king-cli templates import 'D:\资料\商务模板.docx' --name '商务模板' --json
md-king-cli templates list
md-king-cli templates inspect '商务模板' --json
```

导入成功返回模板对象，`id` 可用于后续脚本。添加 `--default` 同时设为默认模板。已存在同名模板时，导入会报错，不会产生重复项。

在 Word/WPS 中修改源 DOCX 后，覆盖原模板：

```powershell
md-king-cli templates replace '商务模板' 'D:\资料\商务模板修订.docx' --json
md-king-cli templates inspect '商务模板' --json
md-king-cli convert 'D:\资料\正文.md' -o 'D:\成果\正文.docx' --template '商务模板' --overwrite --json
```

`replace` 的第一个参数接受模板 ID 或精确名称；名称重复时必须使用 ID。它保留 ID、名称、创建时间、默认状态、描述和标签，更新模板 DOCX、更新时间及提取的样式、页眉页脚和页面设置。模板 ID 不变，原有脚本和默认模板选择可继续使用。

**覆盖会重新提取配置，替换该模板在样式管理器中的修改。** 请把希望保留的设置写入源 DOCX。导入后的文件由应用管理，修改原文件不会自动生效，需再次执行 `replace`。无效 DOCX 在写入前拒绝；写入失败时尝试恢复旧文件和样式，并报告恢复失败的具体原因。内置模板不允许覆盖，应导入为自定义模板。

CLI 与桌面版使用同一 Windows 用户的 `%APPDATA%\md-king` 配置。建议串行执行模板写入；桌面版已打开模板页面或缓存样式时，重新打开软件后查看更新。切换运行用户或 `APPDATA` 会使用不同的模板库。

`templates inspect` 返回 `templateId`、`name`、`resolvedTemplatePath`、`templateSha256`、`isBuiltIn`，可比较覆盖前后的 SHA-256。

## 转换与检查

```powershell
md-king-cli convert report.md -o report.docx --template default-report
md-king-cli convert report.md -o report.docx --overwrite --report result.json --json
md-king-cli convert report.md --lint-only --strict --json
md-king-cli convert report.md -o report.docx --update-fields word
```

不指定 `--template` 时使用默认模板；不指定 `-o` 时使用配置的输出目录。`--overwrite` 只允许覆盖输出 DOCX，与模板覆盖无关。`--lint-only` 不生成文档；`--strict` 将诊断和 Mermaid 渲染失败视为错误。

默认不启动 Office 更新域，打开文档后可在 Word/WPS 中更新目录和页码。`--update-fields auto|wps|word` 会调用本机已安装的 Office，耗时较长；JSON 的 `fieldUpdateStatus` 和警告可用于核对是否更新成功。所有转换选项见 `convert --help`。

编号起点沿用模板的页面设置，默认从目录后的正文开始，带总页数的页脚按同一范围计数；`--body-page-start` 可覆盖起始显示值。局部横向页面、签署段落同页等写法见 [Word 导出的分页与页面方向](markdown-syntax.md#控制-word-导出的分页与页面方向)。

## 文本与管道

```powershell
md-king-cli convert '# 标题' --text -o output.docx
Get-Content -Raw -Encoding utf8 report.md | md-king-cli convert - -o report.docx --json
```

标准输入必须为 UTF-8。Windows PowerShell 5.1 的管道编码可能是 ASCII，应先设置 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`；PowerShell 7 默认使用 UTF-8。输入 `-` 表示读取标准输入；需要转换字面量 `-` 时加 `--text`。

`--text` 强制把参数当作正文，即使同名文件存在也不读取文件。文本或管道中的相对图片路径以当前工作目录为基准；文件输入中的相对图片路径以 Markdown 所在目录为基准。旧版直接传入 Markdown 文本的用法仍可用，自动化脚本建议显式添加 `--text`。

常见模板错误：

| errorCode | 含义与处理 |
| --- | --- |
| `TEMPLATE_ALREADY_EXISTS` | 导入名称已存在，换名称或用 `templates replace`。 |
| `TEMPLATE_NOT_FOUND` | 找不到 ID/名称，用 `templates list` 查询。 |
| `TEMPLATE_NAME_AMBIGUOUS` | 名称不唯一，改用返回的 ID。 |
| `TEMPLATE_IMPORT_FAILED` | 导入失败，按 `message` 检查 DOCX 或写入权限。 |
| `TEMPLATE_REPLACE_FAILED` | 覆盖失败，按 `message` 检查目标、DOCX 或写入权限。 |
| `STDIN_REQUIRED` / `STDIN_READ_FAILED` | 缺少管道输入，或输入不是有效 UTF-8。 |
