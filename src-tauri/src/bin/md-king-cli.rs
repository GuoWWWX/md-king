use clap::{Parser, Subcommand};
use md_king_lib::{
    convert_markdown_cli, inspect_template_for_cli, list_templates_for_cli,
    resolve_template_selector_for_cli, ConvertRequest, TemplateSelectorError,
};

#[derive(Parser)]
#[command(
    name = "md-king-cli",
    version,
    about = "Convert AI Markdown into editable Word/WPS DOCX documents.",
    after_help = "Common examples:\n  md-king-cli templates list\n  md-king-cli templates list --json\n  md-king-cli convert input.md -o output.docx --template default-report --overwrite\n  md-king-cli convert input.md -o output.docx --template 我的自定义模板 --json\n\nTip: --template accepts a template id or an exact template name. Use template ids in scripts for stable automation."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Convert a Markdown file or Markdown text to DOCX.
    #[command(
        after_help = "Examples:\n  md-king-cli convert report.md -o report.docx --template default-report\n  md-king-cli convert report.md -o report.docx --template 我的自定义模板 --json\n  md-king-cli convert \"# 标题\\n\\n正文\" -o output.docx --template technical-spec --overwrite\n\nTemplate selection:\n  --template default-report       Use a stable template id.\n  --template 我的自定义模板       Use an exact template name.\n\nUse `md-king-cli templates list` to see available template ids and names."
    )]
    Convert {
        /// Markdown file path. If the path does not exist, the value is treated as raw Markdown text.
        input: String,

        /// Output DOCX path, for example ./report.docx.
        #[arg(short = 'o', long = "output", alias = "out")]
        output: Option<String>,

        /// Template id or exact template name. Use `templates list` to inspect available templates.
        #[arg(long = "template")]
        template_selector: Option<String>,

        /// Open the output document after a successful conversion.
        #[arg(long = "open")]
        open_after_convert: bool,

        /// Overwrite output file when it already exists.
        #[arg(long)]
        overwrite: bool,

        /// Print structured JSON output.
        #[arg(long)]
        json: bool,

        /// Heading numbering source: auto, source, word or none.
        #[arg(
            long = "heading-numbering",
            default_value = "auto",
            value_parser = ["auto", "source", "word", "none"]
        )]
        heading_numbering: String,

        /// Update TOC, page number and cross-reference fields with WPS or Word after conversion.
        #[arg(
            long = "update-fields",
            default_value = "none",
            value_parser = ["none", "wps", "word"]
        )]
        update_fields: String,

        /// Maximum heading depth included in the table of contents.
        #[arg(long = "toc-depth", value_parser = clap::value_parser!(u8).range(1..=6))]
        toc_depth: Option<u8>,

        /// TOC placement, or disable it completely.
        #[arg(long = "toc-position", value_parser = ["after-cover", "before-body", "none"])]
        toc_position: Option<String>,

        /// First Arabic page number of the body section.
        #[arg(long = "body-page-start", value_parser = clap::value_parser!(u32).range(1..))]
        body_page_start: Option<u32>,

        /// Page numbering for cover and TOC sections.
        #[arg(long = "front-page-number", value_parser = ["none", "roman"])]
        front_page_number: Option<String>,

        /// Mermaid image format. SVG stays sharp; PNG uses the selected scale.
        #[arg(long = "mermaid-format", default_value = "svg", value_parser = ["svg", "png"])]
        mermaid_format: String,

        /// Device scale factor used when Mermaid is exported as PNG.
        #[arg(long = "mermaid-scale", default_value_t = 4, value_parser = clap::value_parser!(u32).range(1..=4))]
        mermaid_scale: u32,

        /// Image preservation policy used by the generated DOCX.
        #[arg(long = "image-policy", default_value = "vector-preferred", value_parser = ["vector-preferred", "original", "compressed"])]
        image_policy: String,

        /// Force Word/WPS picture compression off, even with the compressed policy.
        #[arg(long = "no-compress-pictures")]
        no_compress_pictures: bool,
    },

    /// Manage and inspect Word/WPS templates.
    Templates {
        #[command(subcommand)]
        command: TemplateCommands,
    },
}

#[derive(Subcommand)]
enum TemplateCommands {
    /// List available templates.
    #[command(
        after_help = "Examples:\n  md-king-cli templates list\n  md-king-cli templates list --json\n\nThe non-JSON output shows: template-id, default marker, and template name. Pass the id or exact name to `convert --template`."
    )]
    List {
        /// Print structured JSON output.
        #[arg(long)]
        json: bool,
    },

    /// Show the resolved reference.docx path and SHA-256 for one template.
    Inspect {
        /// Template id or exact template name.
        selector: String,

        /// Print structured JSON output.
        #[arg(long)]
        json: bool,
    },
}

fn main() {
    let cli = Cli::parse();
    let exit_code = match cli.command {
        Commands::Convert {
            input,
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
        } => run_convert(
            input,
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
        ),
        Commands::Templates { command } => match command {
            TemplateCommands::List { json } => run_templates_list(json),
            TemplateCommands::Inspect { selector, json } => run_templates_inspect(&selector, json),
        },
    };

    std::process::exit(exit_code);
}

fn run_convert(
    input: String,
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
) -> i32 {
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

    let result = convert_markdown_cli(ConvertRequest {
        input,
        input_kind: None,
        source_path: None,
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
    });

    if json {
        print_json(&result);
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
