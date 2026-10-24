use clap::{Parser, Subcommand};
use md_king_lib::{
    convert_markdown_cli, import_template_for_cli, inspect_template_for_cli, list_templates_for_cli,
    replace_template_for_cli, resolve_template_selector_for_cli, ConvertRequest,
    ImportTemplateRequest, TemplateSelectorError,
};
use std::fs;
use std::io::{IsTerminal, Read};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "md-king-cli",
    version,
    about = "将 Markdown 转换为可编辑的 Word/WPS DOCX，管理自定义模板。",
    propagate_version = true,
    after_help = "常用命令：\n  md-king-cli convert input.md -o output.docx --template default-report\n  md-king-cli templates import reference.docx --name 我的模板\n  md-king-cli templates replace 我的模板 revised.docx\n  md-king-cli templates list --json\n\n详细帮助：\n  md-king-cli convert --help\n  md-king-cli templates --help\n  md-king-cli templates replace --help\n\n脚本约定：退出码 0=成功，1=执行失败，2=参数错误；--help/--version 返回 0。\n业务命令加 --json 时，标准输出为 JSON；参数解析错误仍写入标准错误。\n模板与桌面版共享当前用户的配置；建议脚本使用稳定的模板 ID。"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 转换 Markdown 文件、文本或标准输入为 DOCX。
    #[command(
        after_help = "示例：\n  md-king-cli convert report.md -o report.docx --template default-report\n  md-king-cli convert report.md -o report.docx --template 我的模板 --overwrite --json\n  md-king-cli convert \"# 标题\" --text -o output.docx\n  Get-Content -Raw -Encoding utf8 report.md | md-king-cli convert - -o report.docx\n  md-king-cli convert report.md --lint-only --strict --json\n\n输入：现有文件按路径读取；兼容直接传入 Markdown 文本，建议加 --text 明确指定。\n标准输入必须为 UTF-8；使用 - 时相对图片路径以当前工作目录为基准。\n不指定 -o 时使用配置的输出目录；不指定 --template 时使用默认模板。\n--overwrite 仅覆盖输出 DOCX，不会覆盖模板。\n模板 ID/名称可用 templates list 查看；同名模板必须使用 ID。\n目录/页码域默认由打开文档的 Word/WPS 更新；--update-fields 会调用本机 Office，耗时较长。\n--report 保存完整转换结果；--json 输出同样的结果，包含警告、诊断和更新域状态。"
    )]
    Convert {
        /// Markdown 文件路径、Markdown 文本，或 -（从标准输入读取）。
        input: String,

        /// 将 INPUT 明确作为 Markdown 文本，不按文件路径读取。
        #[arg(long)]
        text: bool,

        /// 输出 DOCX 路径，例如 ./report.docx。
        #[arg(short = 'o', long = "output", alias = "out")]
        output: Option<String>,

        /// 模板 ID 或精确名称；用 templates list 查看。
        #[arg(long = "template")]
        template_selector: Option<String>,

        /// 转换成功后打开输出文档。
        #[arg(long = "open")]
        open_after_convert: bool,

        /// 允许覆盖已存在的输出文件。
        #[arg(long)]
        overwrite: bool,

        /// 输出完整转换结果 JSON。
        #[arg(long)]
        json: bool,

        /// 标题编号来源：auto 自动、source 保留源编号、word 使用模板、none 禁用。
        #[arg(
            long = "heading-numbering",
            default_value = "auto",
            value_parser = ["auto", "source", "word", "none"]
        )]
        heading_numbering: String,

        /// 更新目录/页码域：none 不调用 Office，auto 自动选择，wps/word 指定程序。
        #[arg(
            long = "update-fields",
            default_value = "none",
            value_parser = ["none", "auto", "wps", "word"]
        )]
        update_fields: String,

        /// 目录最多包含的标题层级（1～6）。
        #[arg(long = "toc-depth", value_parser = clap::value_parser!(u8).range(1..=6))]
        toc_depth: Option<u8>,

        /// 目录位置：after-cover 封面后、before-body 正文前、none 禁用。
        #[arg(long = "toc-position", value_parser = ["after-cover", "before-body", "none"])]
        toc_position: Option<String>,

        /// 正文章节的起始阿拉伯页码（大于 0）。
        #[arg(long = "body-page-start", value_parser = clap::value_parser!(u32).range(1..))]
        body_page_start: Option<u32>,

        /// 封面/目录的页码：none 不编号，roman 罗马数字。
        #[arg(long = "front-page-number", value_parser = ["none", "roman"])]
        front_page_number: Option<String>,

        /// Mermaid 图片格式；png 默认兼容 Word/WPS，svg 保留矢量。
        #[arg(long = "mermaid-format", default_value = "png", value_parser = ["svg", "png"])]
        mermaid_format: String,

        /// Mermaid PNG 清晰度倍率（1～4）。
        #[arg(long = "mermaid-scale", default_value_t = 4, value_parser = clap::value_parser!(u32).range(1..=4))]
        mermaid_scale: u32,

        /// 图片保留策略：vector-preferred 矢量优先、original 原图、compressed 压缩。
        #[arg(long = "image-policy", default_value = "vector-preferred", value_parser = ["vector-preferred", "original", "compressed"])]
        image_policy: String,

        /// 强制关闭 Word/WPS 图片压缩（优先于 compressed）。
        #[arg(long = "no-compress-pictures")]
        no_compress_pictures: bool,

        /// 仅检查 Markdown 并输出诊断，不生成 DOCX。
        #[arg(long = "lint-only")]
        lint_only: bool,

        /// 将诊断和 Mermaid 渲染失败视为错误并返回非零退出码。
        #[arg(long = "strict")]
        strict: bool,

        /// 将完整转换结果另存为 JSON 报告文件。
        #[arg(long = "report")]
        report: Option<String>,
    },

    /// 导入、覆盖、列出和检查 Word/WPS 模板。
    #[command(after_help = "工作流程：在 Word/WPS 中编辑 DOCX → import 首次导入 → replace 覆盖旧模板 → convert 转换。\n覆盖会保留模板 ID、名称、默认状态、描述和标签，更新 DOCX 并重新提取样式、页眉页脚和页面设置。\n覆盖会替换样式管理器对该模板的修改；请先把希望保留的设置写入源 DOCX。\n内置模板不能覆盖，可将 DOCX 导入为自定义模板。\n导入的 DOCX 会复制到应用模板目录，之后修改原文件不会自动生效。\n\n示例：\n  md-king-cli templates import reference.docx --name 商务模板\n  md-king-cli templates list\n  md-king-cli templates replace 商务模板 revised.docx --json\n  md-king-cli templates inspect 商务模板 --json")]
    Templates {
        #[command(subcommand)]
        command: TemplateCommands,
    },
}

#[derive(Subcommand)]
enum TemplateCommands {
    /// 列出模板 ID、默认标记和名称。
    #[command(
        after_help = "示例：\n  md-king-cli templates list\n  md-king-cli templates list --json\n\n文本输出每行依次为模板 ID、默认标记（*）和名称；JSON 输出模板数组。\nconvert --template、templates inspect 和 templates replace 均接受 ID 或精确名称。"
    )]
    List {
        /// 输出模板 JSON 数组。
        #[arg(long)]
        json: bool,
    },

    /// 检查模板的实际 DOCX 路径和 SHA-256。
    #[command(after_help = "示例：md-king-cli templates inspect 我的模板 --json\n可在覆盖前后比较 templateSha256，确认实际引用的 DOCX 已更新。")]
    Inspect {
        /// 模板 ID 或精确名称。
        selector: String,

        /// 输出检查结果 JSON。
        #[arg(long)]
        json: bool,
    },

    /// 首次导入 DOCX 并自动提取样式。
    #[command(after_help = "示例：\n  md-king-cli templates import reference.docx --name 我的模板\n  md-king-cli templates import reference.docx --name 我的模板 --default --json\n\n同名模板已存在时会报错；更新旧模板请用 templates replace，避免产生重复模板。\n导入成功返回模板信息，其中 id 可直接用于 convert --template。")]
    Import {
        /// 源 DOCX 文件路径（含空格时加引号）。
        docx: String,
        /// 新模板名称。
        #[arg(long)]
        name: String,
        /// 同时设为默认模板。
        #[arg(long = "default")]
        is_default: bool,
        /// 输出模板 JSON；失败输出 ok=false、errorCode 和 message。
        #[arg(long)]
        json: bool,
    },

    /// 用新的 DOCX 覆盖自定义模板，保留模板 ID。
    #[command(after_help = "示例：\n  md-king-cli templates replace 我的模板 revised.docx\n  md-king-cli templates replace user-example-123 revised.docx --json\n\nSELECTOR 为模板 ID 或精确名称；名称重复时请使用 ID。\n重新提取样式会覆盖该模板在样式管理器中的设置；源 DOCX 不会被修改。\n无效 DOCX 不会覆盖旧模板，写入失败会尝试恢复旧文件和样式。")]
    Replace {
        /// 已有自定义模板的 ID 或精确名称。
        selector: String,
        /// 新的源 DOCX 文件路径。
        docx: String,
        /// 输出模板 JSON；失败输出 ok=false、errorCode 和 message。
        #[arg(long)]
        json: bool,
    },
}

fn main() {
    let cli = Cli::parse();
    let exit_code = match cli.command {
        Commands::Convert {
            input,
            text,
            output,
            template_selector,
            open_after_convert,
            overwrite,
            json,
            heading_numbering,
            update_fields,
            toc_depth,
            toc_position,
            body_page_start,
            front_page_number,
            mermaid_format,
            mermaid_scale,
            image_policy,
            no_compress_pictures,
            lint_only,
            strict,
            report,
        } => run_convert(
            input,
            text,
            output,
            template_selector,
            open_after_convert,
            overwrite,
            json,
            heading_numbering,
            update_fields,
            toc_depth,
            toc_position,
            body_page_start,
            front_page_number,
            mermaid_format,
            mermaid_scale,
            image_policy,
            no_compress_pictures,
            lint_only,
            strict,
            report,
        ),
        Commands::Templates { command } => match command {
            TemplateCommands::List { json } => run_templates_list(json),
            TemplateCommands::Inspect { selector, json } => run_templates_inspect(&selector, json),
            TemplateCommands::Import { docx, name, is_default, json } => {
                run_templates_import(docx, name, is_default, json)
            }
            TemplateCommands::Replace { selector, docx, json } => {
                run_templates_replace(&selector, &docx, json)
            }
        },
    };

    std::process::exit(exit_code);
}

fn run_convert(
    input: String,
    text: bool,
    output: Option<String>,
    template_selector: Option<String>,
    open_after_convert: bool,
    overwrite: bool,
    json: bool,
    heading_numbering: String,
    update_fields: String,
    toc_depth: Option<u8>,
    toc_position: Option<String>,
    body_page_start: Option<u32>,
    front_page_number: Option<String>,
    mermaid_format: String,
    mermaid_scale: u32,
    image_policy: String,
    no_compress_pictures: bool,
    lint_only: bool,
    strict: bool,
    report: Option<String>,
) -> i32 {
    let (input, input_kind) = if input == "-" && !text {
        if std::io::stdin().is_terminal() {
            return print_cli_error(json, "STDIN_REQUIRED", "请通过管道或重定向传入 UTF-8 Markdown；字面量 - 请加 --text。");
        }
        let mut markdown = String::new();
        if let Err(error) = std::io::stdin().read_to_string(&mut markdown) {
            return print_cli_error(json, "STDIN_READ_FAILED", &format!("读取 UTF-8 标准输入失败：{error}"));
        }
        (markdown, Some("text".to_string()))
    } else {
        (input, text.then(|| "text".to_string()))
    };
    let template_id = match resolve_template_id(template_selector) {
        Ok(template_id) => template_id,
        Err(error) => {
            if json {
                print_json(&serde_json::json!({
                    "ok": false,
                    "errorCode": error.code,
                    "message": error.message,
                }));
            } else {
                eprintln!("ERROR {}: {}", error.code, error.message);
            }
            return 1;
        }
    };

    let source_path = input_kind.as_deref().filter(|kind| *kind == "text")
        .and_then(|_| std::env::current_dir().ok())
        .map(|path| path.to_string_lossy().to_string());
    let result = convert_markdown_cli(ConvertRequest {
        input,
        input_kind,
        source_path,
        output,
        template_id,
        open_after_convert: Some(open_after_convert),
        overwrite: Some(overwrite),
        conflict_strategy: None,
        heading_numbering: Some(heading_numbering),
        toc_page_numbers: None,
        update_fields: Some(update_fields),
        toc_depth,
        toc_position,
        body_page_start,
        front_page_number,
        mermaid_format: Some(mermaid_format),
        mermaid_scale: Some(mermaid_scale),
        image_policy: Some(image_policy),
        no_compress_pictures: no_compress_pictures.then_some(true),
        lint_only: lint_only.then_some(true),
        strict: strict.then_some(true),
    });

    if let Some(report_path) = report.as_deref() {
        if let Err(error) = write_conversion_report(report_path, &result) {
            eprintln!("ERROR REPORT_WRITE_FAILED: {error}");
            return 1;
        }
    }

    if json {
        print_json(&result);
    } else if lint_only && result.ok {
        println!("OK: Markdown 检查完成，未生成 DOCX。");
        for warning in &result.warnings {
            println!("warning: {warning}");
        }
    } else if result.ok {
        println!(
            "OK: {}",
            result
                .output
                .as_deref()
                .unwrap_or("output path unavailable")
        );
        for warning in &result.warnings {
            println!("warning: {warning}");
        }
    } else {
        eprintln!(
            "ERROR {}: {}",
            result.error_code.as_deref().unwrap_or("UNKNOWN"),
            result.message.as_deref().unwrap_or("conversion failed")
        );
        for warning in &result.warnings {
            eprintln!("warning: {warning}");
        }
    }

    if result.ok {
        0
    } else {
        1
    }
}

fn write_conversion_report(path: &str, result: &impl serde::Serialize) -> Result<(), String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|error| format!("创建报告目录失败：{error}"))?;
    }
    let data = serde_json::to_vec_pretty(result)
        .map_err(|error| format!("序列化转换报告失败：{error}"))?;
    fs::write(&path, data).map_err(|error| format!("写入转换报告失败：{error}"))
}

fn run_templates_list(json: bool) -> i32 {
    let templates = list_templates_for_cli();
    if json {
        print_json(&templates);
    } else {
        for template in templates {
            let default_marker = if template.is_default { " *" } else { "" };
            println!("{}{}\t{}", template.id, default_marker, template.name);
        }
    }
    0
}

fn print_cli_error(json: bool, code: &str, message: &str) -> i32 {
    if json {
        print_json(&serde_json::json!({"ok": false, "errorCode": code, "message": message}));
    } else {
        eprintln!("ERROR {code}: {message}");
    }
    1
}

fn run_templates_import(docx: String, name: String, is_default: bool, json: bool) -> i32 {
    if list_templates_for_cli().iter().any(|template| template.name == name.trim()) {
        return print_cli_error(json, "TEMPLATE_ALREADY_EXISTS", "同名模板已存在。请选择新名称，或使用 templates replace 按 ID/名称覆盖原模板。");
    }
    print_template_result(import_template_for_cli(ImportTemplateRequest {
        name,
        description: None,
        reference_docx_path: docx,
        tags: Vec::new(),
        is_default: Some(is_default),
    }), "TEMPLATE_IMPORT_FAILED", json)
}

fn run_templates_replace(selector: &str, docx: &str, json: bool) -> i32 {
    let template = match resolve_template_selector_for_cli(selector) {
        Ok(template) => template,
        Err(error) => {
            let error = template_selector_error(error);
            return print_cli_error(json, error.code, &error.message);
        }
    };
    print_template_result(replace_template_for_cli(&template.id, docx), "TEMPLATE_REPLACE_FAILED", json)
}

fn print_template_result(result: Result<md_king_lib::Template, String>, code: &str, json: bool) -> i32 {
    match result {
        Ok(template) => {
            if json {
                print_json(&template);
            } else {
                println!("OK: {}\t{}", template.id, template.name);
                println!("reference-docx: {}", template.reference_docx_path);
            }
            0
        }
        Err(error) => print_cli_error(json, code, &error),
    }
}

fn run_templates_inspect(selector: &str, json: bool) -> i32 {
    match inspect_template_for_cli(selector) {
        Ok(inspection) => {
            if json {
                print_json(&inspection);
            } else {
                println!("template-id: {}", inspection.template_id);
                println!("name: {}", inspection.name);
                println!(
                    "resolved-template-path: {}",
                    inspection
                        .resolved_template_path
                        .as_deref()
                        .unwrap_or("未解析")
                );
                println!(
                    "template-sha256: {}",
                    inspection.template_sha256.as_deref().unwrap_or("不可用")
                );
            }
            0
        }
        Err(error) => {
            let error = template_selector_error(error);
            if json {
                print_json(&serde_json::json!({
                    "ok": false,
                    "errorCode": error.code,
                    "message": error.message,
                }));
            } else {
                eprintln!("ERROR {}: {}", error.code, error.message);
            }
            1
        }
    }
}

struct CliTemplateError {
    code: &'static str,
    message: String,
}

fn resolve_template_id(
    template_selector: Option<String>,
) -> Result<Option<String>, CliTemplateError> {
    let Some(selector) = template_selector
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    match resolve_template_selector_for_cli(selector) {
        Ok(template) => Ok(Some(template.id)),
        Err(error) => Err(template_selector_error(error)),
    }
}

fn template_selector_error(error: TemplateSelectorError) -> CliTemplateError {
    match error {
        TemplateSelectorError::NotFound(value) => CliTemplateError {
            code: "TEMPLATE_NOT_FOUND",
            message: format!(
                "未找到模板「{value}」。请运行 `md-king-cli templates list` 查看可用模板。"
            ),
        },
        TemplateSelectorError::AmbiguousName { name, ids } => CliTemplateError {
            code: "TEMPLATE_NAME_AMBIGUOUS",
            message: format!(
                "模板名称「{name}」不唯一，请改用模板 id：{}",
                ids.join(", ")
            ),
        },
    }
}

fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("ERROR JSON_SERIALIZE_FAILED: {error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_import_and_replace_without_requiring_an_output_path() {
        let cli = Cli::try_parse_from(["md-king-cli", "templates", "import", "模板.docx", "--name", "商务", "--default", "--json"]).unwrap();
        assert!(matches!(cli.command, Commands::Templates { command: TemplateCommands::Import { is_default: true, json: true, .. } }));
        let cli = Cli::try_parse_from(["md-king-cli", "templates", "replace", "user-123", "新版.docx"]).unwrap();
        assert!(matches!(cli.command, Commands::Templates { command: TemplateCommands::Replace { .. } }));
        assert!(Cli::try_parse_from(["md-king-cli", "templates", "import", "模板.docx"]).is_err());
        assert!(Cli::try_parse_from(["md-king-cli", "templates", "replace", "user-123"]).is_err());
    }

    #[test]
    fn accepts_stdin_and_explicit_text() {
        for args in [vec!["md-king-cli", "convert", "-"], vec!["md-king-cli", "convert", "file.md", "--text"]] {
            assert!(Cli::try_parse_from(args).is_ok());
        }
    }

    #[test]
    fn every_help_level_and_nested_version_exits_successfully() {
        for args in [
            vec!["md-king-cli", "--help"],
            vec!["md-king-cli", "convert", "--help"],
            vec!["md-king-cli", "templates", "--help"],
            vec!["md-king-cli", "templates", "list", "--help"],
            vec!["md-king-cli", "templates", "inspect", "--help"],
            vec!["md-king-cli", "templates", "import", "--help"],
            vec!["md-king-cli", "templates", "replace", "--help"],
            vec!["md-king-cli", "templates", "replace", "--version"],
        ] {
            let error = Cli::try_parse_from(args).err().unwrap();
            assert!(matches!(error.kind(), clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion));
            assert_eq!(error.exit_code(), 0);
        }
    }
}
