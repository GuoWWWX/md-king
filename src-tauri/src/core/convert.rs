use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::AppHandle;
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::core::config::load_config;
use crate::core::pandoc::{
    check_pandoc_available, check_pandoc_available_cli, run_pandoc_to_docx, run_pandoc_to_docx_cli,
    PandocDocumentOptions, PandocExecution, PandocStatus,
};
use crate::core::template::find_template;
use crate::core::template_style::get_template_style_config;
use crate::system::open_file::open_path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input: String,
    pub output: Option<String>,
    pub template_id: Option<String>,
    pub open_after_convert: Option<bool>,
    pub overwrite: Option<bool>,
    pub conflict_strategy: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub ok: bool,
    pub input: String,
    pub output: Option<String>,
    pub template_id: Option<String>,
    pub duration_ms: u64,
    pub warnings: Vec<String>,
    pub error_code: Option<String>,
    pub message: Option<String>,
}

struct TemplateResolution {
    reference_docx_path: Option<PathBuf>,
    warnings: Vec<String>,
}

#[derive(Clone)]
struct HeadingNumberingConfig {
    formats: [Option<String>; 6],
}

#[derive(Clone)]
struct MarkdownFeatureConfig {
    inline_code: bool,
    code_block: bool,
    quote_block: bool,
    horizontal_rule: bool,
}

#[derive(Clone)]
struct PageSettingsConfig {
    paper_size: String,
    orientation: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
}

#[derive(Clone, Copy)]
enum ConflictStrategy {
    Overwrite,
    Rename,
    Ask,
}

#[derive(Clone, Copy)]
enum ConvertRuntime<'a> {
    Tauri(&'a AppHandle),
    Cli,
}

pub fn convert_markdown(app: &AppHandle, request: ConvertRequest) -> ConvertResult {
    convert_markdown_with_runtime(ConvertRuntime::Tauri(app), request)
}

pub fn convert_markdown_cli(request: ConvertRequest) -> ConvertResult {
    convert_markdown_with_runtime(ConvertRuntime::Cli, request)
}

fn convert_markdown_with_runtime(
    runtime: ConvertRuntime<'_>,
    request: ConvertRequest,
) -> ConvertResult {
    let started_at = Instant::now();
    let input_path = PathBuf::from(&request.input);
    let output = normalize_output(request.output.as_deref());

    if input_path.exists() {
        return convert_existing_file(runtime, request, input_path, output, started_at);
    }

    if has_markdown_extension(&input_path) {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "INPUT_FILE_NOT_FOUND",
            "输入看起来是 Markdown 文件路径，但文件不存在。",
        );
    }

    convert_text_input(runtime, request, output, started_at)
}

fn convert_existing_file(
    runtime: ConvertRuntime<'_>,
    request: ConvertRequest,
    input_path: PathBuf,
    output: Option<String>,
    started_at: Instant,
) -> ConvertResult {
    if !input_path.is_file() {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "INPUT_NOT_FILE",
            "输入路径存在，但不是文件。",
        );
    }

    if !has_markdown_extension(&input_path) {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "UNSUPPORTED_INPUT_FILE",
            "当前阶段仅支持存在的 .md/.markdown 文件路径执行真实转换。",
        );
    }

    let mut output_path = output
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| input_path.with_extension("docx"));

    let template_resolution = resolve_template(runtime, &request);
    let mut warnings = template_resolution.warnings;

    if let Err(error) = ensure_output_parent_dir(&output_path) {
        return failure_result(
            request,
            Some(output_path.to_string_lossy().to_string()),
            started_at,
            warnings,
            "OUTPUT_DIR_CREATE_FAILED",
            &error,
        );
    }

    if let Err(error) = apply_conflict_strategy(&mut output_path, &request, &mut warnings) {
        return failure_result(
            request,
            Some(output_path.to_string_lossy().to_string()),
            started_at,
            warnings,
            "OUTPUT_EXISTS",
            &error,
        );
    }
    let output_string = Some(output_path.to_string_lossy().to_string());

    let pandoc_status = check_pandoc_available_for(runtime);
    if !pandoc_status.available {
        let error_code = pandoc_status
            .error_code
            .as_deref()
            .unwrap_or("PANDOC_NOT_AVAILABLE");
        let message = pandoc_status
            .message
            .as_deref()
            .unwrap_or("Pandoc 不可用，无法执行真实转换。");

        return failure_result(
            request,
            output_string,
            started_at,
            warnings,
            error_code,
            message,
        );
    }

    let (pandoc_input_path, temp_preprocessed_input) =
        match prepare_markdown_file_for_pandoc(&input_path) {
            Ok(value) => value,
            Err(error) => {
                return failure_result(
                    request,
                    output_string,
                    started_at,
                    warnings,
                    "TEMP_INPUT_WRITE_FAILED",
                    &error.0,
                )
            }
        };

    let conversion = run_pandoc_to_docx_for(
        runtime,
        &pandoc_input_path,
        &output_path,
        template_resolution.reference_docx_path.as_deref(),
        &pandoc_document_options(&request),
    );

    if let Some(path) = temp_preprocessed_input {
        let _ = fs::remove_file(path);
    }

    match conversion {
        Ok(execution) if execution.success => {
            if let Err(error) = normalize_docx(
                &output_path,
                should_apply_default_template_postprocess(&request),
                heading_numbering_config(&request).as_ref(),
                &markdown_feature_config(&request),
                page_settings_config(&request).as_ref(),
            ) {
                warnings.push(format!("调整 DOCX 样式失败：{error}"));
            }
            success_result(request, output_path, output_string, started_at, warnings)
        }
        Ok(execution) => {
            let status = execution
                .status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let stderr = execution.stderr.trim();
            let stdout = execution.stdout.trim();
            let detail = if stderr.is_empty() { stdout } else { stderr };
            let message = if detail.is_empty() {
                format!("Pandoc 转换失败，退出状态：{status}。")
            } else {
                format!("Pandoc 转换失败，退出状态：{status}，详情：{detail}")
            };

            failure_result(
                request,
                output_string,
                started_at,
                warnings,
                "PANDOC_CONVERT_FAILED",
                &message,
            )
        }
        Err(error) => failure_result(
            request,
            output_string,
            started_at,
            warnings,
            "PANDOC_SPAWN_FAILED",
            &format!("调用 Pandoc 失败：{error}"),
        ),
    }
}

fn convert_text_input(
    runtime: ConvertRuntime<'_>,
    request: ConvertRequest,
    output: Option<String>,
    started_at: Instant,
) -> ConvertResult {
    if request.input.trim().is_empty() {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "EMPTY_INPUT",
            "Markdown 文本输入不能为空。",
        );
    }

    let template_resolution = resolve_template(runtime, &request);
    let mut warnings = template_resolution.warnings;
    let output_was_provided = output.is_some();
    let mut output_path = output
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| default_text_output_path(&request.input));

    if let Err(error) = ensure_output_parent_dir(&output_path) {
        return failure_result(
            request,
            Some(output_path.to_string_lossy().to_string()),
            started_at,
            warnings,
            if output_was_provided {
                "OUTPUT_DIR_CREATE_FAILED"
            } else {
                "TEMP_DIR_CREATE_FAILED"
            },
            &error,
        );
    }

    if !output_was_provided {
        warnings.push("未指定输出路径，已使用默认输出目录。".to_string());
    }

    if let Err(error) = apply_conflict_strategy(&mut output_path, &request, &mut warnings) {
        return failure_result(
            request,
            Some(output_path.to_string_lossy().to_string()),
            started_at,
            warnings,
            "OUTPUT_EXISTS",
            &error,
        );
    }
    let output_string = Some(output_path.to_string_lossy().to_string());

    let temp_input_path = make_sibling_temp_path(&output_path, "input", "md");

    let pandoc_status = check_pandoc_available_for(runtime);
    if !pandoc_status.available {
        let error_code = pandoc_status
            .error_code
            .as_deref()
            .unwrap_or("PANDOC_NOT_AVAILABLE");
        let message = pandoc_status
            .message
            .as_deref()
            .unwrap_or("Pandoc 不可用，无法执行真实转换。");

        return failure_result(
            request,
            output_string,
            started_at,
            warnings,
            error_code,
            message,
        );
    }

    if let Some(parent) = temp_input_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return failure_result(
                request,
                output_string,
                started_at,
                warnings,
                "TEMP_DIR_CREATE_FAILED",
                &format!("创建临时目录失败：{error}"),
            );
        }
    }

    let prepared_input = preprocess_markdown_for_word(&request.input);
    if let Err(error) = fs::write(&temp_input_path, prepared_input.as_bytes()) {
        return failure_result(
            request,
            output_string,
            started_at,
            warnings,
            "TEMP_INPUT_WRITE_FAILED",
            &format!("写入临时 Markdown 文件失败：{error}"),
        );
    }

    warnings.push(format!(
        "Markdown 文本已写入临时文件：{}",
        temp_input_path.to_string_lossy()
    ));

    match run_pandoc_to_docx_for(
        runtime,
        &temp_input_path,
        &output_path,
        template_resolution.reference_docx_path.as_deref(),
        &pandoc_document_options(&request),
    ) {
        Ok(execution) if execution.success => {
            let _ = fs::remove_file(&temp_input_path);
            if let Err(error) = normalize_docx(
                &output_path,
                should_apply_default_template_postprocess(&request),
                heading_numbering_config(&request).as_ref(),
                &markdown_feature_config(&request),
                page_settings_config(&request).as_ref(),
            ) {
                warnings.push(format!("调整 DOCX 样式失败：{error}"));
            }
            success_result(request, output_path, output_string, started_at, warnings)
        }
        Ok(execution) => {
            let _ = fs::remove_file(&temp_input_path);
            let status = execution
                .status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let stderr = execution.stderr.trim();
            let stdout = execution.stdout.trim();
            let detail = if stderr.is_empty() { stdout } else { stderr };
            let message = if detail.is_empty() {
                format!("Pandoc 转换失败，退出状态：{status}。")
            } else {
                format!("Pandoc 转换失败，退出状态：{status}，详情：{detail}")
            };

            failure_result(
                request,
                output_string,
                started_at,
                warnings,
                "PANDOC_CONVERT_FAILED",
                &message,
            )
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_input_path);
            failure_result(
                request,
                output_string,
                started_at,
                warnings,
                "PANDOC_SPAWN_FAILED",
                &format!("调用 Pandoc 失败：{error}"),
            )
        }
    }
}

fn success_result(
    request: ConvertRequest,
    output_path: PathBuf,
    output: Option<String>,
    started_at: Instant,
    mut warnings: Vec<String>,
) -> ConvertResult {
    if request.open_after_convert.unwrap_or(false) {
        if let Err(error) = open_path(&output_path) {
            warnings.push(format!("打开输出文件失败：{error}"));
        }
    }

    ConvertResult {
        ok: true,
        input: request.input,
        output,
        template_id: request.template_id,
        duration_ms: elapsed_ms(started_at),
        warnings,
        error_code: None,
        message: Some("Pandoc 转换完成。".to_string()),
    }
}

fn failure_result(
    request: ConvertRequest,
    output: Option<String>,
    started_at: Instant,
    warnings: Vec<String>,
    error_code: &str,
    message: &str,
) -> ConvertResult {
    ConvertResult {
        ok: false,
        input: request.input,
        output,
        template_id: request.template_id,
        duration_ms: elapsed_ms(started_at),
        warnings,
        error_code: Some(error_code.to_string()),
        message: Some(message.to_string()),
    }
}

fn check_pandoc_available_for(runtime: ConvertRuntime<'_>) -> PandocStatus {
    match runtime {
        ConvertRuntime::Tauri(app) => check_pandoc_available(app),
        ConvertRuntime::Cli => check_pandoc_available_cli(),
    }
}

fn run_pandoc_to_docx_for(
    runtime: ConvertRuntime<'_>,
    input_path: &Path,
    output_path: &Path,
    reference_docx_path: Option<&Path>,
    options: &PandocDocumentOptions,
) -> std::io::Result<PandocExecution> {
    match runtime {
        ConvertRuntime::Tauri(app) => {
            run_pandoc_to_docx(app, input_path, output_path, reference_docx_path, options)
        }
        ConvertRuntime::Cli => {
            run_pandoc_to_docx_cli(input_path, output_path, reference_docx_path, options)
        }
    }
}

fn requested_conflict_strategy(request: &ConvertRequest) -> ConflictStrategy {
    match request
        .conflict_strategy
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("overwrite") => ConflictStrategy::Overwrite,
        Some("rename") => ConflictStrategy::Rename,
        Some("ask") => ConflictStrategy::Ask,
        _ if request.overwrite.unwrap_or(false) => ConflictStrategy::Overwrite,
        _ => ConflictStrategy::Ask,
    }
}

fn apply_conflict_strategy(
    output_path: &mut PathBuf,
    request: &ConvertRequest,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    if !output_path.exists() {
        return Ok(());
    }

    match requested_conflict_strategy(request) {
        ConflictStrategy::Overwrite => Ok(()),
        ConflictStrategy::Ask => {
            Err("输出文件已存在，请选择覆盖、自动重命名，或指定其他输出路径。".to_string())
        }
        ConflictStrategy::Rename => {
            let renamed = next_available_output_path(output_path)?;
            warnings.push(format!(
                "输出文件已存在，已自动重命名为：{}",
                renamed.to_string_lossy()
            ));
            *output_path = renamed;
            Ok(())
        }
    }
}

fn next_available_output_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("output");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1..=999 {
        let file_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem} ({index}).{extension}"),
            _ => format!("{stem} ({index})"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("输出文件已存在，自动重命名已尝试 999 次，请指定其他输出路径。".to_string())
}

fn resolve_template(runtime: ConvertRuntime<'_>, request: &ConvertRequest) -> TemplateResolution {
    let mut warnings = Vec::new();
    let Some(template_id) = request
        .template_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return TemplateResolution {
            reference_docx_path: None,
            warnings,
        };
    };

    let Some(template) = find_template(template_id) else {
        warnings.push(format!(
            "未找到模板 {template_id}，已跳过 reference.docx 映射。"
        ));
        return TemplateResolution {
            reference_docx_path: None,
            warnings,
        };
    };

    let reference_docx_path = template.reference_docx_path.trim();
    if reference_docx_path.is_empty() {
        if let Some(path) = built_in_reference_docx_path(runtime, &template.id) {
            warnings.push(format!(
                "已应用内置模板「{}」的 reference.docx。",
                template.name
            ));
            return TemplateResolution {
                reference_docx_path: Some(path),
                warnings,
            };
        }

        warnings.push(format!(
            "模板「{}」未绑定 reference.docx，使用 Pandoc 默认 DOCX 样式。",
            template.name
        ));
        return TemplateResolution {
            reference_docx_path: None,
            warnings,
        };
    }

    let path = PathBuf::from(reference_docx_path);
    if !path.exists() || !path.is_file() {
        warnings.push(format!(
            "模板「{}」的 reference.docx 不存在，已跳过：{}",
            template.name, reference_docx_path
        ));
        return TemplateResolution {
            reference_docx_path: None,
            warnings,
        };
    }

    warnings.push(format!(
        "已应用模板「{}」的 reference.docx。",
        template.name
    ));
    TemplateResolution {
        reference_docx_path: Some(path),
        warnings,
    }
}

fn built_in_reference_docx_path(runtime: ConvertRuntime<'_>, template_id: &str) -> Option<PathBuf> {
    let resource_path = match template_id {
        "default-report" => "templates/default-report/reference.docx",
        _ => return None,
    };

    match runtime {
        ConvertRuntime::Tauri(app) => app
            .path()
            .resolve(resource_path, BaseDirectory::Resource)
            .ok()
            .filter(|path| path.exists() && path.is_file())
            .or_else(|| built_in_reference_docx_path_for_cli_resource(resource_path)),
        ConvertRuntime::Cli => built_in_reference_docx_path_for_cli_resource(resource_path),
    }
}

fn built_in_reference_docx_path_for_cli_resource(resource_path: &str) -> Option<PathBuf> {
    let resource_path = resource_path.replace('/', std::path::MAIN_SEPARATOR_STR);
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));

    exe_dir
        .as_ref()
        .map(|dir| dir.join(&resource_path))
        .filter(|path| path.exists() && path.is_file())
        .or_else(|| {
            exe_dir
                .as_ref()
                .map(|dir| dir.join("resources").join(&resource_path))
                .filter(|path| path.exists() && path.is_file())
        })
        .or_else(|| {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(resource_path);
            dev_path.exists().then_some(dev_path)
        })
}

fn should_apply_default_template_postprocess(request: &ConvertRequest) -> bool {
    request
        .template_id
        .as_deref()
        .map(str::trim)
        .is_some_and(|template_id| template_id == "default-report")
}

fn heading_numbering_config(request: &ConvertRequest) -> Option<HeadingNumberingConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    if let Ok(Some(config)) = get_template_style_config(template_id.to_string()) {
        if let Some(numbering) = heading_numbering_config_from_value(&config) {
            return Some(numbering);
        }
    }

    if template_id == "default-report" {
        return Some(default_report_heading_numbering_config());
    }

    None
}

fn markdown_feature_config(request: &ConvertRequest) -> MarkdownFeatureConfig {
    let Some(template_id) = request.template_id.as_deref().map(str::trim) else {
        return default_markdown_feature_config();
    };
    if template_id.is_empty() {
        return default_markdown_feature_config();
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .map(|config| markdown_feature_config_from_value(&config))
        .unwrap_or_else(default_markdown_feature_config)
}

fn pandoc_document_options(request: &ConvertRequest) -> PandocDocumentOptions {
    let Some(template_id) = request.template_id.as_deref().map(str::trim) else {
        return PandocDocumentOptions::default();
    };
    if template_id.is_empty() {
        return PandocDocumentOptions::default();
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .map(|config| pandoc_document_options_from_value(&config))
        .unwrap_or_default()
}

fn page_settings_config(request: &ConvertRequest) -> Option<PageSettingsConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .and_then(|config| page_settings_config_from_value(&config))
}

fn default_markdown_feature_config() -> MarkdownFeatureConfig {
    MarkdownFeatureConfig {
        inline_code: false,
        code_block: true,
        quote_block: true,
        horizontal_rule: false,
    }
}

fn pandoc_document_options_from_value(config: &Value) -> PandocDocumentOptions {
    let Some(settings) = config.get("pageSettings") else {
        return PandocDocumentOptions::default();
    };
    let toc = settings
        .get("tocEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let toc_depth = settings
        .get("tocDepth")
        .and_then(Value::as_str)
        .and_then(parse_toc_depth);

    PandocDocumentOptions { toc, toc_depth }
}

fn parse_toc_depth(value: &str) -> Option<u8> {
    value
        .rsplit('-')
        .next()
        .and_then(|part| part.trim().parse::<u8>().ok())
        .filter(|depth| (1..=6).contains(depth))
}

fn page_settings_config_from_value(config: &Value) -> Option<PageSettingsConfig> {
    let settings = config.get("pageSettings")?;
    let read_number = |key: &str, default_value: f64| {
        settings
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(default_value)
    };

    Some(PageSettingsConfig {
        paper_size: settings
            .get("paperSize")
            .and_then(Value::as_str)
            .unwrap_or("A4")
            .to_string(),
        orientation: settings
            .get("orientation")
            .and_then(Value::as_str)
            .unwrap_or("portrait")
            .to_string(),
        margin_top: read_number("marginTop", 2.54),
        margin_right: read_number("marginRight", 3.18),
        margin_bottom: read_number("marginBottom", 2.54),
        margin_left: read_number("marginLeft", 3.18),
    })
}

fn markdown_feature_config_from_value(config: &Value) -> MarkdownFeatureConfig {
    let features = config.get("markdownFeatures");
    let read_bool = |key: &str, default_value: bool| {
        features
            .and_then(|value| value.get(key))
            .and_then(Value::as_bool)
            .unwrap_or(default_value)
    };

    MarkdownFeatureConfig {
        inline_code: read_bool("inlineCode", false),
        code_block: read_bool("codeBlock", true),
        quote_block: read_bool("quoteBlock", true),
        horizontal_rule: read_bool("horizontalRule", false),
    }
}

fn default_report_heading_numbering_config() -> HeadingNumberingConfig {
    HeadingNumberingConfig {
        formats: [
            Some("1".to_string()),
            Some("1.1".to_string()),
            Some("1.1.1".to_string()),
            Some("1.1.1.1".to_string()),
            Some("1.1.1.1.1".to_string()),
            Some("1.1.1.1.1.1".to_string()),
        ],
    }
}

fn heading_numbering_config_from_value(config: &Value) -> Option<HeadingNumberingConfig> {
    let styles = config.get("styles")?;
    let mut formats: [Option<String>; 6] = Default::default();

    for level in 1..=6 {
        let style_id = format!("heading-{level}");
        let style = styles.get(&style_id);
        let auto_numbering = style
            .and_then(|value| value.get("autoNumbering"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let number_format = style
            .and_then(|value| value.get("numberFormat"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "无编号");

        if auto_numbering {
            formats[level - 1] = number_format.map(str::to_string);
        }
    }

    formats
        .iter()
        .any(Option::is_some)
        .then_some(HeadingNumberingConfig { formats })
}

fn normalize_output(output: Option<&str>) -> Option<String> {
    output.and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn default_text_output_path(markdown: &str) -> PathBuf {
    let output_dir = load_config()
        .default_output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            make_temp_path("output", "docx")
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(std::env::temp_dir)
        });

    output_dir.join(default_docx_file_name(markdown))
}

fn default_docx_file_name(markdown: &str) -> String {
    let title = markdown
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .unwrap_or("未命名文档");

    let sanitized: String = title
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            ch if ch.is_control() => '-',
            ch => ch,
        })
        .collect();
    let sanitized = sanitized.trim().trim_matches('.').trim();

    format!(
        "{}.docx",
        if sanitized.is_empty() {
            "未命名文档"
        } else {
            sanitized
        }
    )
}

fn ensure_output_parent_dir(output_path: &Path) -> Result<(), String> {
    let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return Ok(());
    };

    fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败：{error}"))
}

fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn make_temp_path(prefix: &str, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let process_id = std::process::id();

    std::env::temp_dir()
        .join("md-king")
        .join(format!("{prefix}-{process_id}-{timestamp}.{extension}"))
}

fn make_sibling_temp_path(output_path: &Path, prefix: &str, extension: &str) -> PathBuf {
    let file_name = make_temp_path(prefix, extension)
        .file_name()
        .map(|name| name.to_owned())
        .unwrap_or_else(|| format!("{prefix}.tmp.{extension}").into());

    output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.join(file_name))
        .unwrap_or_else(|| make_temp_path(prefix, extension))
}

fn prepare_markdown_file_for_pandoc(
    input_path: &Path,
) -> Result<(PathBuf, Option<PathBuf>), ConvertResultPreparationError> {
    let original = fs::read_to_string(input_path).map_err(|error| {
        ConvertResultPreparationError(format!("读取 Markdown 文件失败：{error}"))
    })?;
    let prepared = preprocess_markdown_for_word(&original);
    if prepared == original {
        return Ok((input_path.to_path_buf(), None));
    }

    let temp_input_path = make_sibling_temp_path(input_path, "input-prepared", "md");
    if let Some(parent) = temp_input_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ConvertResultPreparationError(format!("创建临时 Markdown 目录失败：{error}"))
        })?;
    }
    fs::write(&temp_input_path, prepared.as_bytes()).map_err(|error| {
        ConvertResultPreparationError(format!("写入临时 Markdown 文件失败：{error}"))
    })?;

    Ok((temp_input_path.clone(), Some(temp_input_path)))
}

struct ConvertResultPreparationError(String);

fn preprocess_markdown_for_word(markdown: &str) -> String {
    let mut output = Vec::new();
    let mut lines = markdown.lines();

    while let Some(line) = lines.next() {
        if let Some(fence) = parse_math_fence_start(line) {
            let mut formula_lines = Vec::new();
            for content_line in lines.by_ref() {
                if is_fence_end(content_line, fence) {
                    break;
                }
                formula_lines.push(content_line);
            }

            output.push("$$".to_string());
            output.extend(formula_lines.into_iter().map(str::to_string));
            output.push("$$".to_string());
            continue;
        }

        output.push(line.to_string());
    }

    let mut prepared = output.join("\n");
    if markdown.ends_with('\n') {
        prepared.push('\n');
    }
    prepared
}

fn parse_math_fence_start(line: &str) -> Option<&'static str> {
    let trimmed = line.trim();
    let fence = if trimmed.starts_with("```") {
        "```"
    } else if trimmed.starts_with("~~~") {
        "~~~"
    } else {
        return None;
    };
    let language = trimmed
        .trim_start_matches(fence)
        .trim()
        .trim_matches('{')
        .trim_matches('}')
        .trim_start_matches('.')
        .trim()
        .to_ascii_lowercase();

    matches!(
        language.as_str(),
        "math" | "latex" | "tex" | "formula" | "equation" | "公式"
    )
    .then_some(fence)
}

fn is_fence_end(line: &str, fence: &str) -> bool {
    line.trim().starts_with(fence)
}

fn normalize_docx(
    path: &Path,
    apply_default_template_style: bool,
    heading_numbering: Option<&HeadingNumberingConfig>,
    markdown_features: &MarkdownFeatureConfig,
    page_settings: Option<&PageSettingsConfig>,
) -> Result<(), String> {
    let original = fs::read(path).map_err(|error| format!("读取 DOCX 失败：{error}"))?;
    let reader = Cursor::new(original);
    let mut archive =
        ZipArchive::new(reader).map_err(|error| format!("打开 DOCX 包失败：{error}"))?;
    let mut output = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(&mut output);
    let mut has_numbering_xml = false;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取 DOCX 条目失败：{error}"))?;
        let name = file.name().to_string();
        let options = SimpleFileOptions::default().compression_method(file.compression());
        writer
            .start_file(&name, options)
            .map_err(|error| format!("写入 DOCX 条目失败：{error}"))?;

        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|error| format!("读取 DOCX 内容失败：{error}"))?;
        if name == "word/document.xml" {
            let xml = String::from_utf8(data)
                .map_err(|error| format!("解析 document.xml 失败：{error}"))?;
            let xml = normalize_document_xml(
                &xml,
                apply_default_template_style,
                heading_numbering,
                markdown_features,
            );
            data = apply_page_settings_to_document_xml(&xml, page_settings).into_bytes();
        } else if name == "word/styles.xml" && apply_default_template_style {
            let xml = String::from_utf8(data)
                .map_err(|error| format!("解析 styles.xml 失败：{error}"))?;
            data = normalize_default_report_styles_xml(&xml, markdown_features).into_bytes();
        } else if name == "word/numbering.xml" {
            has_numbering_xml = true;
            if let Some(heading_numbering) = heading_numbering {
                let xml = String::from_utf8(data)
                    .map_err(|error| format!("解析 numbering.xml 失败：{error}"))?;
                data = ensure_heading_numbering_xml(&xml, heading_numbering).into_bytes();
            }
        }
        writer
            .write_all(&data)
            .map_err(|error| format!("写入 DOCX 内容失败：{error}"))?;
    }

    if let Some(heading_numbering) = heading_numbering.filter(|_| !has_numbering_xml) {
        writer
            .start_file(
                "word/numbering.xml",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(|error| format!("写入 numbering.xml 失败：{error}"))?;
        writer
            .write_all(create_heading_numbering_xml(heading_numbering).as_bytes())
            .map_err(|error| format!("写入 numbering.xml 内容失败：{error}"))?;
    }

    writer
        .finish()
        .map_err(|error| format!("完成 DOCX 写入失败：{error}"))?;
    fs::write(path, output.into_inner()).map_err(|error| format!("保存 DOCX 失败：{error}"))?;
    Ok(())
}

fn normalize_document_xml(
    xml: &str,
    apply_default_table_style: bool,
    heading_numbering: Option<&HeadingNumberingConfig>,
    markdown_features: &MarkdownFeatureConfig,
) -> String {
    let xml = force_table_width_percent(xml);
    let xml = if markdown_features.horizontal_rule {
        xml
    } else {
        remove_horizontal_rule_paragraphs(&xml)
    };
    let xml = if apply_default_table_style {
        let xml = normalize_table_cells(&xml);
        let xml = normalize_code_and_quote_blocks(&xml, markdown_features);
        let xml = if markdown_features.inline_code {
            normalize_inline_code_runs(&xml)
        } else {
            flatten_inline_code_runs(&xml)
        };
        normalize_list_markers(&xml)
    } else {
        xml
    };

    if let Some(heading_numbering) = heading_numbering {
        normalize_heading_numbering(&xml, heading_numbering)
    } else {
        xml
    }
}

fn apply_page_settings_to_document_xml(
    xml: &str,
    page_settings: Option<&PageSettingsConfig>,
) -> String {
    let Some(page_settings) = page_settings else {
        return xml.to_string();
    };

    let section = Regex::new(r#"(?s)<w:sectPr\b[^>]*>.*?</w:sectPr>"#).expect("valid sectPr regex");
    if section.is_match(xml) {
        return section
            .replace_all(xml, |captures: &Captures| {
                normalize_section_page_settings(&captures[0], page_settings)
            })
            .to_string();
    }

    let insert_at = Regex::new(r#"</w:body>"#).expect("valid body closing regex");
    let section_xml = normalize_section_page_settings("<w:sectPr></w:sectPr>", page_settings);
    insert_at
        .replace(xml, format!("{section_xml}</w:body>"))
        .to_string()
}

fn normalize_section_page_settings(
    section_xml: &str,
    page_settings: &PageSettingsConfig,
) -> String {
    let section_parts = Regex::new(r#"(?s)^(<w:sectPr\b[^>]*>)(.*)(</w:sectPr>)$"#)
        .expect("valid sectPr parts regex");
    let Some(captures) = section_parts.captures(section_xml) else {
        return section_xml.to_string();
    };

    let start = captures
        .get(1)
        .map(|value| value.as_str())
        .unwrap_or("<w:sectPr>");
    let body = captures.get(2).map(|value| value.as_str()).unwrap_or("");
    let end = captures
        .get(3)
        .map(|value| value.as_str())
        .unwrap_or("</w:sectPr>");
    let page_size = page_size_xml(page_settings);
    let page_margins = page_margins_xml(page_settings);
    let page_size_re = Regex::new(r#"(?s)<w:pgSz\b[^>]*/>"#).expect("valid page size regex");
    let page_margins_re = Regex::new(r#"(?s)<w:pgMar\b[^>]*/>"#).expect("valid page margins regex");
    let body = page_size_re.replace_all(body, "");
    let body = page_margins_re.replace_all(&body, "");

    format!("{start}{page_size}{page_margins}{body}{end}")
}

fn page_size_xml(page_settings: &PageSettingsConfig) -> String {
    let (mut width, mut height) = paper_size_twips(&page_settings.paper_size);
    let landscape = page_settings
        .orientation
        .trim()
        .eq_ignore_ascii_case("landscape");
    if landscape {
        std::mem::swap(&mut width, &mut height);
    }
    let orientation = if landscape {
        r#" w:orient="landscape""#
    } else {
        ""
    };
    format!(r#"<w:pgSz w:w="{width}" w:h="{height}"{orientation} />"#)
}

fn page_margins_xml(page_settings: &PageSettingsConfig) -> String {
    let top = cm_to_twips(page_settings.margin_top);
    let right = cm_to_twips(page_settings.margin_right);
    let bottom = cm_to_twips(page_settings.margin_bottom);
    let left = cm_to_twips(page_settings.margin_left);

    format!(
        r#"<w:pgMar w:top="{top}" w:right="{right}" w:bottom="{bottom}" w:left="{left}" w:header="720" w:footer="720" w:gutter="0" />"#
    )
}

fn paper_size_twips(paper_size: &str) -> (u32, u32) {
    match paper_size.trim() {
        "A3" => cm_pair_to_twips(29.7, 42.0),
        "A5" => cm_pair_to_twips(14.8, 21.0),
        "A6" => cm_pair_to_twips(10.5, 14.8),
        "B4" => cm_pair_to_twips(25.0, 35.3),
        "B5" => cm_pair_to_twips(17.6, 25.0),
        "B6" => cm_pair_to_twips(12.5, 17.6),
        "Letter" => inch_pair_to_twips(8.5, 11.0),
        "Legal" => inch_pair_to_twips(8.5, 14.0),
        "Executive" => inch_pair_to_twips(7.25, 10.5),
        "Tabloid" => inch_pair_to_twips(11.0, 17.0),
        "K16" => cm_pair_to_twips(18.4, 26.0),
        "K32" => cm_pair_to_twips(13.0, 18.4),
        _ => cm_pair_to_twips(21.0, 29.7),
    }
}

fn cm_pair_to_twips(width: f64, height: f64) -> (u32, u32) {
    (cm_to_twips(width), cm_to_twips(height))
}

fn inch_pair_to_twips(width: f64, height: f64) -> (u32, u32) {
    (inch_to_twips(width), inch_to_twips(height))
}

fn cm_to_twips(value: f64) -> u32 {
    inch_to_twips(value / 2.54)
}

fn inch_to_twips(value: f64) -> u32 {
    (value * 1440.0).round().max(1.0) as u32
}

fn normalize_default_report_styles_xml(
    xml: &str,
    markdown_features: &MarkdownFeatureConfig,
) -> String {
    let style = Regex::new(r#"(?s)<w:style\b.*?</w:style>"#).expect("valid style regex");
    style
        .replace_all(xml, |captures: &Captures| {
            normalize_default_report_style_xml(&captures[0], markdown_features)
        })
        .to_string()
}

fn normalize_default_report_style_xml(
    style_xml: &str,
    markdown_features: &MarkdownFeatureConfig,
) -> String {
    match capture_style_id(style_xml).as_deref() {
        Some("Normal") | Some("BodyText") | Some("FirstParagraph") => {
            normalize_body_style_xml(style_xml, true)
        }
        Some("Compact") => normalize_body_style_xml(style_xml, false),
        Some("VerbatimChar") if markdown_features.inline_code => {
            normalize_inline_code_style_xml(style_xml)
        }
        _ => style_xml.to_string(),
    }
}

fn capture_style_id(style_xml: &str) -> Option<String> {
    Regex::new(r#"<w:style\b[^>]*\bw:styleId="([^"]+)""#)
        .expect("valid style id regex")
        .captures(style_xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

fn normalize_body_style_xml(style_xml: &str, first_line_indent: bool) -> String {
    let style_xml = ensure_style_paragraph_properties(style_xml, first_line_indent);
    ensure_style_run_properties(&style_xml, body_run_properties_xml())
}

fn ensure_style_paragraph_properties(style_xml: &str, first_line_indent: bool) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid style paragraph regex");
    let indent = if first_line_indent {
        r#"<w:ind w:firstLine="480" />"#
    } else {
        r#"<w:ind w:firstLine="0" />"#
    };
    let properties = format!(
        r#"<w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" /><w:jc w:val="both" />{indent}</w:pPr>"#
    );

    if paragraph_properties.is_match(style_xml) {
        paragraph_properties
            .replace(style_xml, properties)
            .to_string()
    } else {
        style_xml.replace("</w:style>", &format!("{properties}</w:style>"))
    }
}

fn ensure_style_run_properties(style_xml: &str, properties: &str) -> String {
    let run_properties = Regex::new(r#"(?s)<w:rPr>.*?</w:rPr>"#).expect("valid style run regex");
    let replacement = format!("<w:rPr>{properties}</w:rPr>");

    if run_properties.is_match(style_xml) {
        run_properties.replace(style_xml, replacement).to_string()
    } else {
        style_xml.replace("</w:style>", &format!("{replacement}</w:style>"))
    }
}

fn body_run_properties_xml() -> &'static str {
    r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" /><w:color w:val="111827" /><w:sz w:val="24" /><w:szCs w:val="24" /><w:b w:val="0" /><w:bCs w:val="0" />"#
}

fn remove_horizontal_rule_paragraphs(xml: &str) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    paragraph
        .replace_all(xml, |captures: &Captures| {
            let paragraph_xml = &captures[0];
            if is_horizontal_rule_paragraph(paragraph_xml) {
                String::new()
            } else {
                paragraph_xml.to_string()
            }
        })
        .to_string()
}

fn is_horizontal_rule_paragraph(paragraph_xml: &str) -> bool {
    paragraph_xml.contains(r#"<w:pStyle w:val="HorizontalRule""#)
        || paragraph_xml.contains(r#"o:hr="t""#)
        || (paragraph_xml.contains("<w:pBdr>")
            && paragraph_xml.contains("<w:bottom ")
            && !paragraph_xml.contains("<w:t"))
}

fn normalize_inline_code_style_xml(style_xml: &str) -> String {
    ensure_style_run_properties(style_xml, inline_code_run_properties_xml())
}

fn inline_code_run_properties_xml() -> &'static str {
    r#"<w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei UI" w:hAnsi="Consolas" w:cs="Consolas" /><w:noProof /><w:color w:val="111827" /><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9" /><w:sz w:val="21" /><w:szCs w:val="21" /><w:b w:val="0" /><w:bCs w:val="0" /><w:i w:val="0" /><w:iCs w:val="0" />"#
}

fn normalize_inline_code_runs(xml: &str) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(xml, |captures: &Captures| {
        let run_xml = &captures[0];
        if run_xml.contains(r#"<w:rStyle w:val="VerbatimChar""#) {
            normalize_inline_code_run_xml(run_xml)
        } else {
            run_xml.to_string()
        }
    })
    .to_string()
}

fn flatten_inline_code_runs(xml: &str) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(xml, |captures: &Captures| {
        let run_xml = &captures[0];
        if run_xml.contains(r#"<w:rStyle w:val="VerbatimChar""#) {
            flatten_inline_code_run_xml(run_xml)
        } else {
            run_xml.to_string()
        }
    })
    .to_string()
}

fn flatten_inline_code_run_xml(run_xml: &str) -> String {
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");
    if !run_properties.is_match(run_xml) {
        return run_xml.to_string();
    }

    run_properties
        .replace(run_xml, |captures: &Captures| {
            let removable = Regex::new(
                r#"(?s)<w:rStyle w:val="VerbatimChar"\s*/>|<w:shd\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#,
            )
            .expect("valid inline code flatten regex");
            let inner = removable.replace_all(&captures[1], "");
            format!("<w:rPr>{inner}</w:rPr>")
        })
        .to_string()
}

fn normalize_inline_code_run_xml(run_xml: &str) -> String {
    let properties = inline_code_run_properties_xml();
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable = Regex::new(
                    r#"(?s)<w:shd\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#,
                )
                .expect("valid inline code run cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{inner}{properties}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, properties)
}

fn normalize_code_and_quote_blocks(xml: &str, markdown_features: &MarkdownFeatureConfig) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    let mut in_quote_list = false;
    paragraph
        .replace_all(xml, |captures: &Captures| {
            normalize_code_or_quote_paragraph(&captures[0], &mut in_quote_list, markdown_features)
        })
        .to_string()
}

fn normalize_code_or_quote_paragraph(
    paragraph_xml: &str,
    in_quote_list: &mut bool,
    markdown_features: &MarkdownFeatureConfig,
) -> String {
    match capture_paragraph_style_id(paragraph_xml).as_deref() {
        Some("SourceCode") if markdown_features.code_block => {
            *in_quote_list = false;
            normalize_source_code_paragraph(paragraph_xml)
        }
        Some("SourceCode") => {
            *in_quote_list = false;
            flatten_special_block_paragraph(paragraph_xml)
        }
        Some("BlockText") if markdown_features.quote_block => {
            *in_quote_list = true;
            normalize_quote_paragraph(paragraph_xml)
        }
        Some("BlockText") => {
            *in_quote_list = false;
            flatten_special_block_paragraph(paragraph_xml)
        }
        _ if markdown_features.quote_block
            && *in_quote_list
            && has_list_numbering(paragraph_xml) =>
        {
            normalize_quote_list_paragraph(paragraph_xml)
        }
        _ => {
            *in_quote_list = false;
            paragraph_xml.to_string()
        }
    }
}

fn flatten_special_block_paragraph(paragraph_xml: &str) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let properties = r#"<w:pPr><w:pStyle w:val="Normal" /><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" /><w:jc w:val="both" /><w:ind w:firstLine="480" /></w:pPr>"#;

    let paragraph_xml = if paragraph_properties.is_match(paragraph_xml) {
        paragraph_properties
            .replace(paragraph_xml, properties)
            .to_string()
    } else {
        paragraph_xml.replace("<w:p>", &format!("<w:p>{properties}"))
    };

    flatten_special_block_runs(&paragraph_xml)
}

fn flatten_special_block_runs(paragraph_xml: &str) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        flatten_special_text_run_xml(&captures[0])
    })
    .to_string()
}

fn flatten_special_text_run_xml(run_xml: &str) -> String {
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");
    if !run_properties.is_match(run_xml) {
        return run_xml.to_string();
    }

    run_properties
        .replace(run_xml, |captures: &Captures| {
            let removable = Regex::new(
                r#"(?s)<w:rStyle\b[^>]*/>|<w:shd\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#,
            )
            .expect("valid special block run flatten regex");
            let inner = removable.replace_all(&captures[1], "");
            format!("<w:rPr>{inner}</w:rPr>")
        })
        .to_string()
}

fn normalize_source_code_paragraph(paragraph_xml: &str) -> String {
    let paragraph_xml = ensure_code_paragraph_properties(paragraph_xml);
    normalize_code_runs(&paragraph_xml)
}

fn ensure_code_paragraph_properties(paragraph_xml: &str) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    paragraph_properties
        .replace(paragraph_xml, |captures: &Captures| {
            let removable = Regex::new(
                r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#,
            )
            .expect("valid code paragraph cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            format!(
                r#"<w:pPr>{inner}<w:spacing w:before="120" w:after="120" w:line="300" w:lineRule="auto" /><w:ind w:left="360" w:right="360" w:firstLine="0" /><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC" /><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="E2E8F0" /><w:left w:val="single" w:sz="6" w:space="4" w:color="E2E8F0" /><w:bottom w:val="single" w:sz="6" w:space="4" w:color="E2E8F0" /><w:right w:val="single" w:sz="6" w:space="4" w:color="E2E8F0" /></w:pBdr></w:pPr>"#
            )
        })
        .to_string()
}

fn normalize_code_runs(paragraph_xml: &str) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        normalize_code_run_xml(&captures[0])
    })
    .to_string()
}

fn normalize_code_run_xml(run_xml: &str) -> String {
    let properties = r#"<w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei UI" w:hAnsi="Consolas" w:cs="Consolas" /><w:noProof /><w:color w:val="111827" /><w:b w:val="0" /><w:bCs w:val="0" /><w:i w:val="0" /><w:iCs w:val="0" /><w:sz w:val="18" /><w:szCs w:val="18" />"#;
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable =
                    Regex::new(
                        r#"<w:rStyle\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#,
                    )
                        .expect("valid code run cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{properties}{inner}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, properties)
}

fn normalize_quote_paragraph(paragraph_xml: &str) -> String {
    let paragraph_xml = ensure_quote_paragraph_properties(paragraph_xml);
    normalize_quote_runs(&paragraph_xml)
}

fn normalize_quote_list_paragraph(paragraph_xml: &str) -> String {
    let paragraph_xml = ensure_quote_list_paragraph_properties(paragraph_xml);
    normalize_quote_runs(&paragraph_xml)
}

fn ensure_quote_paragraph_properties(paragraph_xml: &str) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    paragraph_properties
        .replace(paragraph_xml, |captures: &Captures| {
            let removable = Regex::new(
                r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#,
            )
            .expect("valid quote paragraph cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            format!(
                r#"<w:pPr>{inner}<w:spacing w:before="80" w:after="80" w:line="360" w:lineRule="auto" /><w:ind w:left="360" w:right="240" w:firstLine="0" /><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC" /><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="94A3B8" /></w:pBdr></w:pPr>"#
            )
        })
        .to_string()
}

fn ensure_quote_list_paragraph_properties(paragraph_xml: &str) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    paragraph_properties
        .replace(paragraph_xml, |captures: &Captures| {
            let removable = Regex::new(
                r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#,
            )
            .expect("valid quote list paragraph cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            format!(
                r#"<w:pPr>{inner}<w:spacing w:before="40" w:after="40" w:line="330" w:lineRule="auto" /><w:ind w:left="540" w:right="240" w:firstLine="0" /><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC" /><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="94A3B8" /></w:pBdr></w:pPr>"#
            )
        })
        .to_string()
}

fn normalize_quote_runs(paragraph_xml: &str) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        normalize_quote_run_xml(&captures[0])
    })
    .to_string()
}

fn normalize_quote_run_xml(run_xml: &str) -> String {
    let properties = r#"<w:rFonts w:ascii="Times New Roman" w:eastAsia="微软雅黑" w:hAnsi="Times New Roman" /><w:color w:val="475569" /><w:i /><w:iCs /><w:sz w:val="21" /><w:szCs w:val="21" />"#;
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable = Regex::new(r#"<w:(?:rFonts|color|sz|szCs|i|iCs)\b[^>]*/>"#)
                    .expect("valid quote run cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{properties}{inner}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, properties)
}

fn insert_run_properties(run_xml: &str, properties: &str) -> String {
    let run_start = Regex::new(r#"<w:r(\s[^>]*)?>"#).expect("valid run start regex");
    run_start
        .replace(run_xml, |captures: &Captures| {
            let attributes = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            format!("<w:r{attributes}><w:rPr>{properties}</w:rPr>")
        })
        .to_string()
}

fn normalize_list_markers(xml: &str) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    let mut ordered_counters: HashMap<String, usize> = HashMap::new();

    paragraph
        .replace_all(xml, |captures: &Captures| {
            normalize_list_paragraph(&captures[0], &mut ordered_counters)
        })
        .to_string()
}

fn normalize_list_paragraph(
    paragraph_xml: &str,
    ordered_counters: &mut HashMap<String, usize>,
) -> String {
    if capture_heading_style_id(paragraph_xml).is_some() {
        return paragraph_xml.to_string();
    }

    let numbering =
        Regex::new(r#"(?s)<w:numPr><w:ilvl w:val="(\d+)" /><w:numId w:val="(\d+)" /></w:numPr>"#)
            .expect("valid paragraph numbering regex");
    let Some(captures) = numbering.captures(paragraph_xml) else {
        return paragraph_xml.to_string();
    };

    let level = captures
        .get(1)
        .and_then(|value| value.as_str().parse::<usize>().ok())
        .unwrap_or(0);
    let num_id = captures.get(2).map(|value| value.as_str()).unwrap_or("");
    if num_id == "9100" {
        return paragraph_xml.to_string();
    }

    let is_ordered = num_id.parse::<usize>().is_ok_and(|value| value >= 1003);
    let marker = if is_ordered {
        let counter = ordered_counters.entry(num_id.to_string()).or_insert(0);
        *counter += 1;
        format!("{}. ", counter)
    } else if level > 0 {
        "◦ ".to_string()
    } else {
        "• ".to_string()
    };

    let without_numbering = numbering.replace(paragraph_xml, "").to_string();
    prefix_first_text_run(&without_numbering, &marker)
}

fn has_list_numbering(paragraph_xml: &str) -> bool {
    Regex::new(r#"(?s)<w:numPr><w:ilvl w:val="\d+" /><w:numId w:val="\d+" /></w:numPr>"#)
        .expect("valid paragraph numbering regex")
        .is_match(paragraph_xml)
}

fn prefix_first_text_run(paragraph_xml: &str, prefix: &str) -> String {
    let text = Regex::new(r#"(<w:t(?:\s+[^>]*)?>)([^<]*)(</w:t>)"#).expect("valid text regex");
    text.replace(paragraph_xml, |captures: &Captures| {
        format!("{}{}{}{}", &captures[1], prefix, &captures[2], &captures[3])
    })
    .to_string()
}

fn normalize_heading_numbering(xml: &str, heading_numbering: &HeadingNumberingConfig) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    paragraph
        .replace_all(xml, |captures: &Captures| {
            normalize_heading_paragraph(&captures[0], heading_numbering)
        })
        .to_string()
}

fn normalize_heading_paragraph(
    paragraph_xml: &str,
    heading_numbering: &HeadingNumberingConfig,
) -> String {
    let Some(style_id) = capture_heading_style_id(paragraph_xml) else {
        return paragraph_xml.to_string();
    };

    let level = style_id
        .trim_start_matches("Heading")
        .parse::<usize>()
        .unwrap_or(1)
        .clamp(1, 6);
    if heading_numbering.formats[level - 1].is_none() {
        return paragraph_xml.to_string();
    }

    let paragraph_xml = strip_manual_heading_number(paragraph_xml);
    ensure_paragraph_numbering(&paragraph_xml, level)
}

fn capture_heading_style_id(paragraph_xml: &str) -> Option<String> {
    capture_paragraph_style_id(paragraph_xml).filter(|style| {
        Regex::new(r#"^Heading[1-6]$"#)
            .expect("valid heading style regex")
            .is_match(style)
    })
}

fn capture_paragraph_style_id(paragraph_xml: &str) -> Option<String> {
    let style =
        Regex::new(r#"<w:pStyle\s+w:val="([^"]+)"\s*/>"#).expect("valid paragraph style regex");
    style
        .captures(paragraph_xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

fn strip_manual_heading_number(paragraph_xml: &str) -> String {
    let text = Regex::new(r#"(<w:t(?:\s+[^>]*)?>)([^<]*)(</w:t>)"#).expect("valid text regex");
    text.replace(paragraph_xml, |captures: &Captures| {
        let stripped = strip_heading_number_prefix(&captures[2]);
        format!("{}{}{}", &captures[1], stripped, &captures[3])
    })
    .to_string()
}

fn strip_heading_number_prefix(text: &str) -> String {
    let prefix = Regex::new(
        r#"^\s*(?:\d+(?:\.\d+)*[\.、．]?\s+|[一二三四五六七八九十百千万]+[、.．]\s*|第[一二三四五六七八九十百千万]+[章节篇]\s*)"#,
    )
    .expect("valid heading number prefix regex");
    prefix.replace(text, "").to_string()
}

fn ensure_paragraph_numbering(paragraph_xml: &str, level: usize) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let ilvl = level.saturating_sub(1);

    paragraph_properties
        .replace(paragraph_xml, |captures: &Captures| {
            let old_numbering = Regex::new(r#"(?s)<w:numPr>.*?</w:numPr>"#)
                .expect("valid numbering cleanup regex");
            let inner = old_numbering.replace_all(&captures[1], "");
            format!(
                r#"<w:pPr>{inner}<w:numPr><w:ilvl w:val="{ilvl}" /><w:numId w:val="9100" /></w:numPr></w:pPr>"#
            )
        })
        .to_string()
}

fn force_table_width_percent(xml: &str) -> String {
    let table_width = Regex::new(r#"<w:tblW\b[^>]*/>"#).expect("valid table width regex");
    table_width
        .replace_all(xml, r#"<w:tblW w:type="pct" w:w="5000" />"#)
        .to_string()
}

fn normalize_table_cells(xml: &str) -> String {
    let table = Regex::new(r#"(?s)<w:tbl>.*?</w:tbl>"#).expect("valid table regex");
    table
        .replace_all(xml, |captures: &Captures| normalize_table_xml(&captures[0]))
        .to_string()
}

fn normalize_table_xml(table_xml: &str) -> String {
    let column_count = count_table_columns(table_xml).max(1);
    let table_xml = normalize_table_properties(table_xml, column_count);
    let row = Regex::new(r#"(?s)<w:tr>.*?</w:tr>"#).expect("valid table row regex");
    let mut row_index = 0usize;
    row.replace_all(&table_xml, |captures: &Captures| {
        let normalized = normalize_table_row_xml(&captures[0], row_index == 0, column_count);
        row_index += 1;
        normalized
    })
    .to_string()
}

fn count_table_columns(table_xml: &str) -> usize {
    let first_row = Regex::new(r#"(?s)<w:tr>.*?</w:tr>"#).expect("valid first row regex");
    let cell = Regex::new(r#"(?s)<w:tc>.*?</w:tc>"#).expect("valid table cell regex");
    first_row
        .find(table_xml)
        .map(|row| cell.find_iter(row.as_str()).count())
        .unwrap_or(0)
}

fn normalize_table_properties(table_xml: &str, column_count: usize) -> String {
    let table_properties =
        Regex::new(r#"(?s)<w:tblPr>(.*?)</w:tblPr>"#).expect("valid table property regex");
    let table_grid =
        Regex::new(r#"(?s)<w:tblGrid>.*?</w:tblGrid>"#).expect("valid table grid regex");
    let grid = build_table_grid_xml(column_count);

    let table_xml = table_properties
        .replace(table_xml, |captures: &Captures| {
            let removable =
                Regex::new(r#"(?s)<w:tblBorders>.*?</w:tblBorders>|<w:(?:tblStyle|tblW|tblLayout|tblLook)\b[^>]*/>"#)
                .expect("valid table layout cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            format!(
                r#"<w:tblPr>{inner}<w:tblW w:type="dxa" w:w="8640" /><w:tblLayout w:type="fixed" />{}</w:tblPr>"#,
                default_table_borders_xml()
            )
        })
        .to_string();

    if table_grid.is_match(&table_xml) {
        table_grid.replace(&table_xml, grid).to_string()
    } else {
        table_xml.replace("</w:tblPr>", &format!("</w:tblPr>{grid}"))
    }
}

fn default_table_borders_xml() -> &'static str {
    r#"<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /><w:left w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /><w:bottom w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /><w:right w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /><w:insideH w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /><w:insideV w:val="single" w:sz="8" w:space="0" w:color="CBD5E1" /></w:tblBorders>"#
}

fn build_table_grid_xml(column_count: usize) -> String {
    let width = 8640 / column_count.max(1);
    let columns = (0..column_count)
        .map(|_| format!(r#"<w:gridCol w:w="{width}" />"#))
        .collect::<Vec<_>>()
        .join("");
    format!("<w:tblGrid>{columns}</w:tblGrid>")
}

fn normalize_table_row_xml(row_xml: &str, is_header: bool, column_count: usize) -> String {
    let cell = Regex::new(r#"(?s)<w:tc>.*?</w:tc>"#).expect("valid table cell regex");
    cell.replace_all(row_xml, |captures: &Captures| {
        normalize_table_cell_xml(&captures[0], is_header, column_count)
    })
    .to_string()
}

fn normalize_table_cell_xml(cell_xml: &str, is_header: bool, column_count: usize) -> String {
    let cell_xml = normalize_table_cell_properties(cell_xml, is_header, column_count);
    let cell_xml = normalize_table_paragraphs(&cell_xml, is_header);
    normalize_table_runs(&cell_xml, is_header)
}

fn normalize_table_cell_properties(
    cell_xml: &str,
    _is_header: bool,
    column_count: usize,
) -> String {
    let cell_width = 8640 / column_count.max(1);
    let cell_properties = format!(
        r#"<w:tcPr><w:tcW w:type="dxa" w:w="{cell_width}" /><w:vAlign w:val="center" />{}</w:tcPr>"#,
        white_cell_shading_xml()
    );

    if cell_xml.contains("<w:tcPr />") {
        return cell_xml.replace("<w:tcPr />", &cell_properties);
    }

    if !cell_xml.contains("<w:tcPr>") {
        return cell_xml.replace("<w:tc>", &format!("<w:tc>{cell_properties}"));
    }

    let existing_cell_properties =
        Regex::new(r#"(?s)<w:tcPr>(.*?)</w:tcPr>"#).expect("valid cell property regex");
    existing_cell_properties
        .replace(cell_xml, |captures: &Captures| {
            let removable = Regex::new(r#"<w:(?:tcW|vAlign|shd)\b[^>]*/>"#)
                .expect("valid cell property cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            let extra = format!(
                r#"<w:tcW w:type="dxa" w:w="{cell_width}" /><w:vAlign w:val="center" />{}"#,
                white_cell_shading_xml()
            );
            format!("<w:tcPr>{inner}{extra}</w:tcPr>")
        })
        .to_string()
}

fn white_cell_shading_xml() -> &'static str {
    r#"<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" />"#
}

fn normalize_table_paragraphs(cell_xml: &str, is_header: bool) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    paragraph_properties
        .replace_all(cell_xml, |captures: &Captures| {
            let removable =
                Regex::new(r#"<w:(?:jc|ind)\b[^>]*/>"#).expect("valid paragraph cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            if is_header {
                format!(
                    r#"<w:pPr>{inner}<w:ind w:left="0" w:right="0" w:firstLine="0" /><w:jc w:val="center" /></w:pPr>"#
                )
            } else {
                format!(
                    r#"<w:pPr>{inner}<w:ind w:left="0" w:right="0" w:firstLine="0" /></w:pPr>"#
                )
            }
        })
        .to_string()
}

fn normalize_table_runs(cell_xml: &str, is_header: bool) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(cell_xml, |captures: &Captures| {
        normalize_table_run_xml(&captures[0], is_header)
    })
    .to_string()
}

fn normalize_table_run_xml(run_xml: &str, is_header: bool) -> String {
    let properties = table_run_properties(is_header);
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable = Regex::new(r#"<w:(?:rFonts|color|sz|szCs|b|bCs)\b[^>]*/>"#)
                    .expect("valid run cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{properties}{inner}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, &properties)
}

fn table_run_properties(is_header: bool) -> String {
    let size = "21";
    let weight = if is_header {
        "<w:b /><w:bCs />"
    } else {
        r#"<w:b w:val="0" /><w:bCs w:val="0" />"#
    };

    format!(
        r#"<w:rFonts w:ascii="Times New Roman" w:eastAsia="微软雅黑" w:hAnsi="Times New Roman" /><w:color w:val="111827" />{weight}<w:sz w:val="{size}" /><w:szCs w:val="{size}" />"#
    )
}

fn ensure_heading_numbering_xml(xml: &str, heading_numbering: &HeadingNumberingConfig) -> String {
    let without_existing = remove_existing_heading_numbering(xml);
    without_existing.replace(
        "</w:numbering>",
        &format!(
            "{}{}",
            heading_numbering_xml_body(heading_numbering),
            "</w:numbering>"
        ),
    )
}

fn remove_existing_heading_numbering(xml: &str) -> String {
    let abstract_num =
        Regex::new(r#"(?s)<w:abstractNum\s+w:abstractNumId="9100">.*?</w:abstractNum>"#)
            .expect("valid heading abstract numbering regex");
    let num = Regex::new(r#"(?s)<w:num\s+w:numId="9100">.*?</w:num>"#)
        .expect("valid heading numbering regex");
    let xml = abstract_num.replace_all(xml, "");
    num.replace_all(&xml, "").to_string()
}

fn create_heading_numbering_xml(heading_numbering: &HeadingNumberingConfig) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{}</w:numbering>"#,
        heading_numbering_xml_body(heading_numbering)
    )
}

fn heading_numbering_xml_body(heading_numbering: &HeadingNumberingConfig) -> String {
    let levels = (0..6)
        .map(|level| {
            let (format, text) = heading_level_numbering_pattern(
                level,
                heading_numbering.formats[level].as_deref(),
            );

            format!(
                r#"<w:lvl w:ilvl="{level}"><w:start w:val="1" /><w:numFmt w:val="{format}" /><w:lvlText w:val="{text}" /><w:suff w:val="space" /><w:lvlJc w:val="left" /><w:pPr><w:ind w:left="0" w:hanging="0" /></w:pPr></w:lvl>"#
            )
        })
        .collect::<Vec<_>>()
        .join("");

    format!(
        r#"<w:abstractNum w:abstractNumId="9100"><w:nsid w:val="4D4B9100" /><w:multiLevelType w:val="hybridMultilevel" />{levels}</w:abstractNum><w:num w:numId="9100"><w:abstractNumId w:val="9100" /></w:num>"#
    )
}

fn heading_level_numbering_pattern(
    level: usize,
    configured_format: Option<&str>,
) -> (&'static str, String) {
    match configured_format.unwrap_or("无编号") {
        "一、" => ("chineseCountingThousand", format!("%{}、", level + 1)),
        "第一章" => ("chineseCountingThousand", format!("第%{}章", level + 1)),
        "无编号" => ("decimal", String::new()),
        format if format.starts_with('1') => ("decimal", decimal_heading_level_text(level, format)),
        _ => ("decimal", decimal_heading_level_text(level, "1")),
    }
}

fn decimal_heading_level_text(level: usize, configured_format: &str) -> String {
    let requested_depth = configured_format.split('.').count().clamp(1, 6);
    let depth = (level + 1).min(requested_depth);
    let text = (1..=depth)
        .map(|index| format!("%{index}"))
        .collect::<Vec<_>>()
        .join(".");

    if depth == 1 {
        format!("{text}.")
    } else {
        text
    }
}

fn elapsed_ms(started_at: Instant) -> u64 {
    started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_conflict_strategy, apply_page_settings_to_document_xml, create_heading_numbering_xml,
        default_markdown_feature_config, default_report_heading_numbering_config,
        heading_numbering_config_from_value, markdown_feature_config_from_value,
        normalize_default_report_styles_xml, normalize_document_xml, normalize_docx,
        page_settings_config_from_value, pandoc_document_options_from_value,
        preprocess_markdown_for_word, ConvertRequest, HeadingNumberingConfig,
        MarkdownFeatureConfig,
    };
    use serde_json::json;
    use std::fs;
    use std::io::{Cursor, Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    #[test]
    fn normalizes_pandoc_table_xml_to_default_preview_style() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Table" /><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:trPr><w:tblHeader w:val="on" /></w:trPr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" /></w:rPr><w:t>模块</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:t>标题</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert!(output.contains(r#"<w:tblW w:type="dxa" w:w="8640" />"#));
        assert!(output.contains(r#"<w:tblLayout w:type="fixed" />"#));
        assert!(output.contains("<w:tblBorders>"));
        assert!(!output.contains("<w:tblStyle"));
        assert!(!output.contains("<w:tblLook"));
        assert!(output.contains(r#"<w:gridCol w:w="8640" />"#));
        assert!(output.contains(r#"<w:tcW w:type="dxa" w:w="8640" />"#));
        assert!(output.contains(r#"<w:ind w:left="0" w:right="0" w:firstLine="0" />"#));
        assert!(!output.contains(r#"w:fill="EEF2FF""#));
        assert!(output.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" />"#));
        assert!(output.contains(r#"<w:jc w:val="center" />"#));
        assert!(output.contains(r#"<w:vAlign w:val="center" />"#));
        assert!(output.contains(r#"<w:b /><w:bCs /><w:sz w:val="21" /><w:szCs w:val="21" />"#));
        assert!(output.contains(
            r#"<w:b w:val="0" /><w:bCs w:val="0" /><w:sz w:val="21" /><w:szCs w:val="21" />"#
        ));
        assert_eq!(output.matches(r#"<w:jc w:val="center" />"#).count(), 1);
    }

    #[test]
    fn preserves_custom_table_cells_when_default_style_is_disabled() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:t>自定义</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

        let output = normalize_document_xml(input, false, None, &default_markdown_feature_config());

        assert!(output.contains(r#"<w:tblW w:type="pct" w:w="5000" />"#));
        assert!(output.contains("<w:tcPr />"));
        assert!(!output.contains(r#"w:fill="EEF2FF""#));
        assert!(!output.contains(r#"<w:sz w:val="20" />"#));
    }

    #[test]
    fn normalizes_default_body_style_to_songti_zero_spacing() {
        let input = r#"<w:styles><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal" /><w:pPr><w:spacing w:after="120" w:line="420" w:lineRule="auto" /><w:ind w:firstLine="480" /></w:pPr><w:rPr><w:rFonts w:eastAsia="微软雅黑" /><w:sz w:val="24" /></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact" /><w:pPr><w:spacing w:after="120" w:line="420" w:lineRule="auto" /></w:pPr></w:style></w:styles>"#;

        let output = normalize_default_report_styles_xml(input, &default_markdown_feature_config());

        assert!(output.contains(
            r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" />"#
        ));
        assert!(output
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" />"#));
        assert!(output.contains(r#"<w:ind w:firstLine="480" />"#));
        assert!(output.contains(r#"<w:ind w:firstLine="0" />"#));
        assert!(!output.contains("微软雅黑"));
        assert!(!output.contains(r#"w:line="420""#));
        assert!(!output.contains(r#"w:after="120""#));
    }

    #[test]
    fn normalizes_inline_code_style_and_runs_to_readable_default_style() {
        let inline_enabled = MarkdownFeatureConfig {
            inline_code: true,
            ..default_markdown_feature_config()
        };
        let styles = r#"<w:styles><w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char" /><w:rPr><w:rFonts w:ascii="JetBrains Mono" w:eastAsia="微软雅黑" w:hAnsi="JetBrains Mono" /><w:i /><w:color w:val="E2E8F0" /><w:sz w:val="18" /></w:rPr></w:style></w:styles>"#;
        let normalized_styles = normalize_default_report_styles_xml(styles, &inline_enabled);

        assert!(normalized_styles.contains(r#"<w:rFonts w:ascii="Consolas""#));
        assert!(normalized_styles.contains(r#"<w:color w:val="111827" />"#));
        assert!(
            normalized_styles.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9" />"#)
        );
        assert!(normalized_styles.contains("<w:noProof />"));
        assert!(normalized_styles.contains(r#"<w:i w:val="0" />"#));
        assert!(!normalized_styles.contains("JetBrains Mono"));
        assert!(!normalized_styles.contains(r#"w:val="E2E8F0""#));

        let document = r#"<w:document><w:body><w:p><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /><w:i /><w:color w:val="E2E8F0" /></w:rPr><w:t>ShipPositionCache.configure()</w:t></w:r></w:p></w:body></w:document>"#;
        let config = default_report_heading_numbering_config();
        let normalized_document =
            normalize_document_xml(document, true, Some(&config), &inline_enabled);

        assert!(normalized_document.contains(r#"<w:rStyle w:val="VerbatimChar" />"#));
        assert!(normalized_document.contains(r#"<w:rFonts w:ascii="Consolas""#));
        assert!(normalized_document.contains(r#"<w:color w:val="111827" />"#));
        assert!(normalized_document.contains(r#"<w:sz w:val="21" />"#));
        assert!(normalized_document.contains("<w:t>ShipPositionCache.configure()</w:t>"));
        assert!(!normalized_document.contains(r#"w:val="E2E8F0""#));
    }

    #[test]
    fn normalizes_default_code_and_quote_blocks() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r><w:rPr><w:i /></w:rPr><w:t>const value = 1;</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="BlockText" /></w:pPr><w:r><w:t>引用内容</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1001" /></w:numPr></w:pPr><w:r><w:t>引用列表</w:t></w:r></w:p></w:body></w:document>"#;

        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert!(output.contains(r#"<w:pStyle w:val="SourceCode" />"#));
        assert!(output.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC" />"#));
        assert!(output.contains(r#"<w:ind w:left="360" w:right="360" w:firstLine="0" />"#));
        assert!(output.contains(r#"<w:rFonts w:ascii="Consolas""#));
        assert!(output.contains("<w:noProof />"));
        assert!(output.contains(r#"<w:i w:val="0" />"#));
        assert!(output.contains(r#"<w:pStyle w:val="BlockText" />"#));
        assert!(
            output.contains(r#"<w:left w:val="single" w:sz="18" w:space="6" w:color="94A3B8" />"#)
        );
        assert!(output.contains(r#"<w:ind w:left="360" w:right="240" w:firstLine="0" />"#));
        assert!(output.contains(r#"<w:ind w:left="540" w:right="240" w:firstLine="0" />"#));
        assert!(output.contains(r#"<w:color w:val="475569" />"#));
        assert!(output.contains("<w:t>• 引用列表</w:t>"));
    }

    #[test]
    fn normalizes_code_runs_with_run_attributes() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r w:rsidRPr="00112233"><w:rPr><w:rStyle w:val="VerbatimChar" /></w:rPr><w:t xml:space="preserve">测试结果:</w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /></w:rPr><w:t xml:space="preserve"> 6 </w:t></w:r><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /></w:rPr><w:t>通过</w:t></w:r></w:p></w:body></w:document>"#;

        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert_eq!(output.matches(r#"<w:color w:val="111827" />"#).count(), 3);
        assert_eq!(output.matches(r#"<w:rFonts w:ascii="Consolas""#).count(), 3);
        assert!(output.contains(r#"<w:r w:rsidRPr="00112233"><w:rPr><w:rFonts"#));
        assert!(!output.contains(r#"<w:rStyle w:val="VerbatimChar""#));
    }

    #[test]
    fn flattens_disabled_markdown_features_to_normal_text() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" /><w:i /><w:color w:val="E2E8F0" /></w:rPr><w:t>const value = 1;</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="BlockText" /></w:pPr><w:r><w:rPr><w:i /><w:color w:val="475569" /></w:rPr><w:t>引用内容</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /><w:color w:val="E2E8F0" /></w:rPr><w:t>ShipPositionCache.configure()</w:t></w:r></w:p></w:body></w:document>"#;
        let features = MarkdownFeatureConfig {
            inline_code: false,
            code_block: false,
            quote_block: false,
            horizontal_rule: false,
        };
        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(input, true, Some(&config), &features);

        assert!(output.contains("<w:t>const value = 1;</w:t>"));
        assert!(output.contains("<w:t>引用内容</w:t>"));
        assert!(output.contains("<w:t>ShipPositionCache.configure()</w:t>"));
        assert!(output.contains(r#"<w:pStyle w:val="Normal" />"#));
        assert!(!output.contains(r#"<w:pStyle w:val="SourceCode" />"#));
        assert!(!output.contains(r#"<w:pStyle w:val="BlockText" />"#));
        assert!(!output.contains(r#"<w:rStyle w:val="VerbatimChar" />"#));
        assert!(!output.contains("Consolas"));
        assert!(!output.contains(r#"w:val="E2E8F0""#));
        assert!(!output.contains(r#"w:fill="F8FAFC""#));
        assert!(!output.contains(r#"<w:left w:val="single" w:sz="18""#));
    }

    #[test]
    fn removes_horizontal_rules_by_default_and_keeps_them_when_enabled() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="HorizontalRule" /><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr></w:p><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr></w:p><w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t" /></w:pict></w:r></w:p><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>"#;
        let config = default_report_heading_numbering_config();
        let removed = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert!(removed.contains("<w:t>正文</w:t>"));
        assert!(!removed.contains(r#"<w:pStyle w:val="HorizontalRule" />"#));
        assert!(!removed.contains("<w:pBdr>"));
        assert!(!removed.contains(r#"o:hr="t""#));

        let kept = normalize_document_xml(
            input,
            true,
            Some(&config),
            &MarkdownFeatureConfig {
                horizontal_rule: true,
                ..default_markdown_feature_config()
            },
        );

        assert!(kept.contains(r#"<w:pStyle w:val="HorizontalRule" />"#));
        assert!(kept.contains("<w:pBdr>"));
        assert!(kept.contains(r#"o:hr="t""#));
    }

    #[test]
    fn reads_markdown_feature_switches_from_template_config() {
        let value = json!({
            "markdownFeatures": {
                "inlineCode": false,
                "codeBlock": true,
                "quoteBlock": false,
                "horizontalRule": true
            }
        });

        let features = markdown_feature_config_from_value(&value);

        assert!(!features.inline_code);
        assert!(features.code_block);
        assert!(!features.quote_block);
        assert!(features.horizontal_rule);

        let legacy_features = markdown_feature_config_from_value(&json!({}));
        assert!(!legacy_features.horizontal_rule);
        assert!(!legacy_features.inline_code);
    }

    #[test]
    fn reads_page_settings_from_template_config() {
        let value = json!({
            "pageSettings": {
                "paperSize": "B5",
                "orientation": "landscape",
                "marginTop": 1.2,
                "marginRight": 2.3,
                "marginBottom": 3.4,
                "marginLeft": 4.5
            }
        });

        let settings = page_settings_config_from_value(&value).unwrap();

        assert_eq!(settings.paper_size, "B5");
        assert_eq!(settings.orientation, "landscape");
        assert_eq!(settings.margin_top, 1.2);
        assert_eq!(settings.margin_right, 2.3);
        assert_eq!(settings.margin_bottom, 3.4);
        assert_eq!(settings.margin_left, 4.5);
    }

    #[test]
    fn reads_toc_options_from_template_page_settings() {
        let value = json!({
            "pageSettings": {
                "tocEnabled": true,
                "tocDepth": "1-4"
            }
        });

        let options = pandoc_document_options_from_value(&value);

        assert!(options.toc);
        assert_eq!(options.toc_depth, Some(4));

        let disabled = pandoc_document_options_from_value(&json!({
            "pageSettings": {
                "tocEnabled": false,
                "tocDepth": "1-6"
            }
        }));

        assert!(!disabled.toc);
        assert_eq!(disabled.toc_depth, Some(6));
    }

    #[test]
    fn applies_page_settings_to_document_section() {
        let input = r#"<w:document><w:body><w:p /><w:sectPr><w:pgSz w:w="1" w:h="2" /><w:pgMar w:top="1" w:right="1" w:bottom="1" w:left="1" /><w:cols w:space="720" /></w:sectPr></w:body></w:document>"#;
        let settings = page_settings_config_from_value(&json!({
            "pageSettings": {
                "paperSize": "A5",
                "orientation": "landscape",
                "marginTop": 1.0,
                "marginRight": 2.0,
                "marginBottom": 3.0,
                "marginLeft": 4.0
            }
        }))
        .unwrap();

        let output = apply_page_settings_to_document_xml(input, Some(&settings));

        assert!(output.contains(r#"<w:pgSz w:w="11906" w:h="8391" w:orient="landscape" />"#));
        assert!(output.contains(r#"<w:pgMar w:top="567" w:right="1134" w:bottom="1701" w:left="2268" w:header="720" w:footer="720" w:gutter="0" />"#));
        assert!(output.contains(r#"<w:cols w:space="720" />"#));
        assert_eq!(output.matches("<w:pgSz").count(), 1);
        assert_eq!(output.matches("<w:pgMar").count(), 1);
    }

    #[test]
    fn converts_formula_fenced_code_to_math_blocks_for_pandoc() {
        let input = "正文\n\n```math\nE = mc^2\n```\n\n```latex\n\\frac{a}{b}\n```\n\n```rust\nlet value = 1;\n```\n";

        let output = preprocess_markdown_for_word(input);

        assert!(output.contains("$$\nE = mc^2\n$$"));
        assert!(output.contains("$$\n\\frac{a}{b}\n$$"));
        assert!(output.contains("```rust\nlet value = 1;\n```"));
    }

    #[test]
    fn adds_word_heading_numbering_and_removes_typed_prefixes() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>总述</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2" /></w:pPr><w:r><w:t>1. 背景</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading3" /></w:pPr><w:r><w:t>1.1.1 细节</w:t></w:r></w:p></w:body></w:document>"#;

        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert!(!output.contains(r#"<w:pStyle w:val="Heading1" /></w:pPr>"#));
        assert!(output.contains(r#"<w:ilvl w:val="0" /><w:numId w:val="9100" />"#));
        assert!(output.contains(r#"<w:ilvl w:val="1" /><w:numId w:val="9100" />"#));
        assert!(output.contains(r#"<w:ilvl w:val="2" /><w:numId w:val="9100" />"#));
        assert!(output.contains("<w:t>背景</w:t>"));
        assert!(output.contains("<w:t>细节</w:t>"));
        assert!(!output.contains("<w:t>1. 背景</w:t>"));
        assert!(!output.contains("<w:t>1.1.1 细节</w:t>"));
    }

    #[test]
    fn makes_default_template_list_markers_visible() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1001" /></w:numPr></w:pPr><w:r><w:t>无序列表 A</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>嵌套列表 B.1</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>有序列表第一项</w:t></w:r></w:p></w:body></w:document>"#;
        let config = default_report_heading_numbering_config();

        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
        );

        assert!(output.contains("<w:t>• 无序列表 A</w:t>"));
        assert!(output.contains("<w:t>◦ 嵌套列表 B.1</w:t>"));
        assert!(output.contains("<w:t>1. 有序列表第一项</w:t>"));
        assert!(!output.contains("<w:numPr>"));
    }

    #[test]
    fn creates_heading_numbering_definition() {
        let numbering = create_heading_numbering_xml(&default_report_heading_numbering_config());

        assert!(numbering.contains(r#"<w:abstractNum w:abstractNumId="9100">"#));
        assert!(numbering.contains(r#"<w:num w:numId="9100">"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="%1." />"#));
        assert!(numbering.contains(r#"<w:suff w:val="space" />"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="%1.%2.%3" />"#));
    }

    #[test]
    fn creates_chinese_heading_numbering_from_template_config() {
        let config = HeadingNumberingConfig {
            formats: [
                Some("无编号".to_string()),
                Some("一、".to_string()),
                Some("第一章".to_string()),
                None,
                None,
                None,
            ],
        };
        let numbering = create_heading_numbering_xml(&config);

        assert!(numbering.contains(r#"<w:numFmt w:val="chineseCountingThousand" />"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="%2、" />"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="第%3章" />"#));
    }

    #[test]
    fn reads_heading_numbering_from_saved_template_style_config() {
        let value = json!({
            "styles": {
                "heading-1": { "autoNumbering": false, "numberFormat": "无编号" },
                "heading-2": { "autoNumbering": true, "numberFormat": "一、" },
                "heading-3": { "autoNumbering": true, "numberFormat": "1.1.1" }
            }
        });

        let config = heading_numbering_config_from_value(&value).unwrap();

        assert_eq!(config.formats[0], None);
        assert_eq!(config.formats[1].as_deref(), Some("一、"));
        assert_eq!(config.formats[2].as_deref(), Some("1.1.1"));
    }

    #[test]
    fn normalizes_heading_numbering_inside_docx_package() {
        let path = std::env::temp_dir().join(format!(
            "md-king-heading-numbering-test-{}.docx",
            std::process::id()
        ));
        let document_xml = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading2" /></w:pPr><w:r><w:t>1. 背景</w:t></w:r></w:p></w:body></w:document>"#;

        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(document_xml.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        fs::write(&path, buffer.into_inner()).unwrap();

        let config = default_report_heading_numbering_config();
        let inline_enabled = MarkdownFeatureConfig {
            inline_code: true,
            ..default_markdown_feature_config()
        };
        normalize_docx(&path, true, Some(&config), &inline_enabled, None).unwrap();

        let data = fs::read(&path).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();
        let mut numbering = String::new();
        archive
            .by_name("word/numbering.xml")
            .unwrap()
            .read_to_string(&mut numbering)
            .unwrap();

        assert!(document.contains(r#"<w:ilvl w:val="1" /><w:numId w:val="9100" />"#));
        assert!(document.contains("<w:t>背景</w:t>"));
        assert!(numbering.contains(r#"<w:lvlText w:val="%1.%2" />"#));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn normalizes_inline_code_inside_docx_package() {
        let path = std::env::temp_dir().join(format!(
            "md-king-inline-code-test-{}.docx",
            std::process::id()
        ));
        let document_xml = r#"<w:document><w:body><w:p><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /></w:rPr><w:t>ShipPositionCache.configure()</w:t></w:r></w:p></w:body></w:document>"#;
        let styles_xml = r#"<w:styles><w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char" /><w:rPr><w:rFonts w:ascii="JetBrains Mono" w:eastAsia="微软雅黑" /><w:i /><w:color w:val="E2E8F0" /><w:sz w:val="18" /></w:rPr></w:style></w:styles>"#;

        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(document_xml.as_bytes()).unwrap();
            writer
                .start_file("word/styles.xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(styles_xml.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        fs::write(&path, buffer.into_inner()).unwrap();

        let config = default_report_heading_numbering_config();
        let inline_enabled = MarkdownFeatureConfig {
            inline_code: true,
            ..default_markdown_feature_config()
        };
        normalize_docx(&path, true, Some(&config), &inline_enabled, None).unwrap();

        let data = fs::read(&path).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();
        let mut styles = String::new();
        archive
            .by_name("word/styles.xml")
            .unwrap()
            .read_to_string(&mut styles)
            .unwrap();

        assert!(document.contains("<w:t>ShipPositionCache.configure()</w:t>"));
        assert!(document.contains(r#"<w:color w:val="111827" />"#));
        assert!(styles.contains(r#"<w:rFonts w:ascii="Consolas""#));
        assert!(styles.contains(r#"<w:color w:val="111827" />"#));
        assert!(!styles.contains(r#"w:val="E2E8F0""#));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn conflict_strategy_rename_picks_next_available_output_path() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("md-king-conflict-{}.docx", std::process::id()));
        let renamed_path = dir.join(format!("md-king-conflict-{} (1).docx", std::process::id()));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&renamed_path);
        fs::write(&path, b"existing").unwrap();

        let request = ConvertRequest {
            input: "# title".to_string(),
            output: Some(path.to_string_lossy().to_string()),
            template_id: None,
            open_after_convert: Some(false),
            overwrite: None,
            conflict_strategy: Some("rename".to_string()),
        };
        let mut output_path = path.clone();
        let mut warnings = Vec::new();

        apply_conflict_strategy(&mut output_path, &request, &mut warnings).unwrap();

        assert_eq!(output_path, renamed_path);
        assert_eq!(warnings.len(), 1);

        let _ = fs::remove_file(path);
        let _ = fs::remove_file(renamed_path);
    }

    #[test]
    fn conflict_strategy_ask_rejects_existing_output_path() {
        let path =
            std::env::temp_dir().join(format!("md-king-conflict-ask-{}.docx", std::process::id()));
        let _ = fs::remove_file(&path);
        fs::write(&path, b"existing").unwrap();

        let request = ConvertRequest {
            input: "# title".to_string(),
            output: Some(path.to_string_lossy().to_string()),
            template_id: None,
            open_after_convert: Some(false),
            overwrite: None,
            conflict_strategy: Some("ask".to_string()),
        };
        let mut output_path = path.clone();
        let mut warnings = Vec::new();

        let result = apply_conflict_strategy(&mut output_path, &request, &mut warnings);

        assert!(result.is_err());
        assert_eq!(output_path, path);

        let _ = fs::remove_file(path);
    }
}
