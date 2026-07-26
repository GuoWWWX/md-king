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

const CODE_LANGUAGE_MARKER_PREFIX: &str = "MD_KING_CODE_LANG:";
const TASK_LIST_MARKER_PREFIX: &str = "MD_KING_TASK_LIST:";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input: String,
    #[serde(default)]
    pub input_kind: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
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
    mappings: [HeadingTarget; 6],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HeadingTarget {
    Title,
    Heading(usize),
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
    header_enabled: bool,
    header_text: String,
    footer_enabled: bool,
    footer_text: String,
    footer_page_number_format: String,
    footer_start_page: u32,
    toc_enabled: bool,
    toc_depth: String,
    toc_leader: String,
    toc_show_page_numbers: bool,
}

#[derive(Clone)]
struct TableStyleConfig {
    width_twips: u32,
    layout: String,
    horizontal_align: String,
    column_width_percentages: Option<[f64; 3]>,
    border_style: String,
    border_color: String,
    border_width: f64,
    border_top_width: f64,
    border_right_width: f64,
    border_bottom_width: f64,
    border_left_width: f64,
    show_inner_vertical_border: bool,
    show_inner_horizontal_border: bool,
    cell_padding_x: f64,
    cell_padding_y: f64,
    min_row_height: f64,
    row_stripe: bool,
    cell_wrap: bool,
    header: TableCellStyleConfig,
    body: TableCellStyleConfig,
}

#[derive(Clone)]
struct TableCellStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    background_color: String,
    horizontal_align: String,
    vertical_align: String,
    line_height: f64,
    border_color: String,
    border_width: f64,
}

#[derive(Clone)]
struct ImageStyleConfig {
    align: String,
    width_mode: String,
    width_percent: f64,
}

#[derive(Clone)]
struct DocumentStyleConfig {
    styles: HashMap<String, TextStyleConfig>,
    image_caption: Option<CaptionStyleConfig>,
    table_caption: Option<CaptionStyleConfig>,
}

#[derive(Clone)]
struct TextStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    line_height: f64,
    before_spacing: f64,
    after_spacing: f64,
    first_line_indent: f64,
    align: String,
    is_list: bool,
    list_numbering_mode: String,
    list_level_type_overrides: [Option<String>; 4],
    list_level_marker_styles: [String; 4],
    list_level_number_formats: [String; 4],
    list_level_styles: [ListLevelStyleConfig; 4],
}

#[derive(Clone)]
struct ListLevelStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    line_height: f64,
    before_spacing: f64,
    after_spacing: f64,
    align: String,
    indent: f64,
    text_indent: f64,
    wrap_mode: String,
    numbering_mode: String,
}

#[derive(Clone)]
struct CaptionStyleConfig {
    text: TextStyleConfig,
    position: String,
    numbering: bool,
    number_format: String,
}

#[derive(Clone)]
struct BlockStyleConfig {
    code: CodeBlockStyleConfig,
    quote: QuoteBlockStyleConfig,
    inline_code: InlineCodeStyleConfig,
    horizontal_rule: HorizontalRuleStyleConfig,
}

#[derive(Clone)]
struct CodeBlockStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    background_color: String,
    border_color: String,
    line_height: f64,
    before_spacing: f64,
    after_spacing: f64,
    padding_x: f64,
    padding_y: f64,
}

#[derive(Clone)]
struct QuoteBlockStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    background_color: String,
    border_color: String,
    border_width: f64,
    line_height: f64,
    before_spacing: f64,
    after_spacing: f64,
}

#[derive(Clone)]
struct InlineCodeStyleConfig {
    chinese_font: String,
    latin_font: String,
    font_size: f64,
    bold: bool,
    color: String,
    background_color: String,
}

#[derive(Clone)]
struct HorizontalRuleStyleConfig {
    border_style: String,
    border_color: String,
    border_width: f64,
    before_spacing: f64,
    after_spacing: f64,
}

#[derive(Clone, Copy)]
enum TaskListMarker {
    Checked,
    Unchecked,
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
    let input_kind = request
        .input_kind
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);

    if input_kind.as_deref() == Some("text") {
        return convert_text_input(runtime, request, output, started_at);
    }

    if input_path.exists() {
        return convert_existing_file(runtime, request, input_path, output, started_at);
    }

    if input_kind.as_deref() == Some("path") || has_supported_text_extension(&input_path) {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "INPUT_FILE_NOT_FOUND",
            "输入看起来是 Markdown/TXT 文件路径，但文件不存在。",
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

    if !has_supported_text_extension(&input_path) {
        return failure_result(
            request,
            output,
            started_at,
            Vec::new(),
            "UNSUPPORTED_INPUT_FILE",
            "当前阶段仅支持存在的 .md/.markdown/.txt 文件路径执行真实转换。",
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
    let staged_output_path = make_sibling_temp_path(&output_path, "output-staged", "docx");

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

    let mut pandoc_options = pandoc_document_options(&request);
    pandoc_options.resource_path = input_path.parent().map(Path::to_path_buf);

    let conversion = run_pandoc_to_docx_for(
        runtime,
        &pandoc_input_path,
        &staged_output_path,
        template_resolution.reference_docx_path.as_deref(),
        &pandoc_options,
    );

    if let Some(path) = temp_preprocessed_input {
        let _ = fs::remove_file(path);
    }

    match conversion {
        Ok(execution) if execution.success => {
            append_pandoc_success_messages(&execution, &mut warnings);
            if let Err(error) = normalize_docx(
                &staged_output_path,
                should_apply_default_template_postprocess(&request),
                heading_numbering_config(&request).as_ref(),
                &markdown_feature_config(&request),
                page_settings_config(&request).as_ref(),
                table_style_config(&request).as_ref(),
                image_style_config(&request).as_ref(),
                document_style_config(&request).as_ref(),
                block_style_config(&request).as_ref(),
            ) {
                let _ = fs::remove_file(&staged_output_path);
                return failure_result(
                    request,
                    output_string,
                    started_at,
                    warnings,
                    "DOCX_POSTPROCESS_FAILED",
                    &format!("调整 DOCX 样式失败：{error}"),
                );
            }
            if let Err(error) = validate_docx_package(&staged_output_path) {
                let _ = fs::remove_file(&staged_output_path);
                return failure_result(
                    request,
                    output_string,
                    started_at,
                    warnings,
                    "DOCX_VALIDATION_FAILED",
                    &error,
                );
            }
            match commit_staged_output(&staged_output_path, &output_path) {
                Ok(Some(warning)) => warnings.push(warning),
                Ok(None) => {}
                Err(error) => {
                    let _ = fs::remove_file(&staged_output_path);
                    return failure_result(
                        request,
                        output_string,
                        started_at,
                        warnings,
                        "OUTPUT_WRITE_FAILED",
                        &error,
                    );
                }
            }
            success_result(request, output_path, output_string, started_at, warnings)
        }
        Ok(execution) => {
            let _ = fs::remove_file(&staged_output_path);
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
            let _ = fs::remove_file(&staged_output_path);
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
    let staged_output_path = make_sibling_temp_path(&output_path, "output-staged", "docx");

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

    let mut pandoc_options = pandoc_document_options(&request);
    pandoc_options.resource_path = request
        .source_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| output_path.parent().map(Path::to_path_buf));

    match run_pandoc_to_docx_for(
        runtime,
        &temp_input_path,
        &staged_output_path,
        template_resolution.reference_docx_path.as_deref(),
        &pandoc_options,
    ) {
        Ok(execution) if execution.success => {
            let _ = fs::remove_file(&temp_input_path);
            append_pandoc_success_messages(&execution, &mut warnings);
            if let Err(error) = normalize_docx(
                &staged_output_path,
                should_apply_default_template_postprocess(&request),
                heading_numbering_config(&request).as_ref(),
                &markdown_feature_config(&request),
                page_settings_config(&request).as_ref(),
                table_style_config(&request).as_ref(),
                image_style_config(&request).as_ref(),
                document_style_config(&request).as_ref(),
                block_style_config(&request).as_ref(),
            ) {
                let _ = fs::remove_file(&staged_output_path);
                return failure_result(
                    request,
                    output_string,
                    started_at,
                    warnings,
                    "DOCX_POSTPROCESS_FAILED",
                    &format!("调整 DOCX 样式失败：{error}"),
                );
            }
            if let Err(error) = validate_docx_package(&staged_output_path) {
                let _ = fs::remove_file(&staged_output_path);
                return failure_result(
                    request,
                    output_string,
                    started_at,
                    warnings,
                    "DOCX_VALIDATION_FAILED",
                    &error,
                );
            }
            match commit_staged_output(&staged_output_path, &output_path) {
                Ok(Some(warning)) => warnings.push(warning),
                Ok(None) => {}
                Err(error) => {
                    let _ = fs::remove_file(&staged_output_path);
                    return failure_result(
                        request,
                        output_string,
                        started_at,
                        warnings,
                        "OUTPUT_WRITE_FAILED",
                        &error,
                    );
                }
            }
            success_result(request, output_path, output_string, started_at, warnings)
        }
        Ok(execution) => {
            let _ = fs::remove_file(&temp_input_path);
            let _ = fs::remove_file(&staged_output_path);
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
            let _ = fs::remove_file(&staged_output_path);
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

fn append_pandoc_success_messages(execution: &PandocExecution, warnings: &mut Vec<String>) {
    for detail in [execution.stderr.trim(), execution.stdout.trim()] {
        if !detail.is_empty() {
            warnings.push(format!("Pandoc：{detail}"));
        }
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
        "default-report" | "official-document" | "technical-spec" => {
            "templates/default-report/reference.docx"
        }
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

    default_built_in_heading_numbering_config(template_id)
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

fn table_style_config(request: &ConvertRequest) -> Option<TableStyleConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .and_then(|config| table_style_config_from_value(&config))
}

fn image_style_config(request: &ConvertRequest) -> Option<ImageStyleConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .and_then(|config| image_style_config_from_value(&config))
}

fn document_style_config(request: &ConvertRequest) -> Option<DocumentStyleConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .and_then(|config| document_style_config_from_value(&config))
}

fn block_style_config(request: &ConvertRequest) -> Option<BlockStyleConfig> {
    let template_id = request.template_id.as_deref().map(str::trim)?;
    if template_id.is_empty() {
        return None;
    }

    get_template_style_config(template_id.to_string())
        .ok()
        .flatten()
        .and_then(|config| block_style_config_from_value(&config))
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

    PandocDocumentOptions {
        toc,
        toc_depth,
        resource_path: None,
    }
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
    let read_page_number = |key: &str, default_value: u32| {
        settings
            .get(key)
            .and_then(|value| {
                value.as_u64().or_else(|| {
                    value
                        .as_f64()
                        .filter(|number| number.is_finite() && *number > 0.0)
                        .map(|number| number.round() as u64)
                })
            })
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
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
        header_enabled: settings
            .get("headerEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        header_text: settings
            .get("headerText")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        footer_enabled: settings
            .get("footerEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        footer_text: settings
            .get("footerText")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        footer_page_number_format: settings
            .get("footerPageNumberFormat")
            .and_then(Value::as_str)
            .unwrap_or("page")
            .to_string(),
        footer_start_page: read_page_number("footerStartPage", 1),
        toc_enabled: settings
            .get("tocEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        toc_depth: settings
            .get("tocDepth")
            .and_then(Value::as_str)
            .unwrap_or("1-3")
            .to_string(),
        toc_leader: settings
            .get("tocLeader")
            .and_then(Value::as_str)
            .unwrap_or("dot")
            .to_string(),
        toc_show_page_numbers: settings
            .get("tocShowPageNumbers")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn table_style_config_from_value(config: &Value) -> Option<TableStyleConfig> {
    let styles = config.get("styles")?;
    let table = styles.get("table")?;
    let header = styles.get("table-header").unwrap_or(table);
    let body = styles.get("table-body").unwrap_or(table);

    let read_table_number = |key: &str, default_value: f64| {
        table
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(default_value)
    };
    let table_width_percent = read_table_number("tableWidthPercent", 100.0).clamp(40.0, 100.0);
    let fit_to_page = table
        .get("fitToPageWidth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let content_width_twips = page_settings_config_from_value(config)
        .as_ref()
        .map(page_content_width_twips)
        .unwrap_or_else(default_content_width_twips);
    let width_twips = if fit_to_page {
        content_width_twips
    } else {
        ((f64::from(content_width_twips) * table_width_percent / 100.0).round() as u32).clamp(
            (f64::from(content_width_twips) * 0.4).round() as u32,
            content_width_twips,
        )
    };
    let column_width_percentages =
        if read_style_string(table, "columnWidthMode", "auto") == "custom" {
            Some([
                read_table_number("firstColumnWidth", 34.0),
                read_table_number("secondColumnWidth", 33.0),
                read_table_number("thirdColumnWidth", 33.0),
            ])
        } else {
            None
        };
    let border_width = read_table_number("borderWidth", 1.0);
    // 外边框加粗必须作用在读取之后：四向宽度前端总会写入合法值，
    // 把加粗量当作 read_table_number 的 default 会让这个开关永远走不到。
    let outer_border_strong = table
        .get("outerBorderStrong")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let outer_border_width = |key: &str| {
        let width = read_table_number(key, border_width);
        if outer_border_strong && width > 0.0 {
            width + 0.5
        } else {
            width
        }
    };

    Some(TableStyleConfig {
        width_twips,
        horizontal_align: read_style_string(table, "tableHorizontalAlign", "center"),
        column_width_percentages,
        layout: read_style_string(table, "tableLayout", "fixed"),
        border_style: read_style_string(table, "borderStyle", "solid"),
        border_color: read_style_color(table, "borderColor", "CBD5E1"),
        border_width,
        border_top_width: outer_border_width("borderTopWidth"),
        border_right_width: outer_border_width("borderRightWidth"),
        border_bottom_width: outer_border_width("borderBottomWidth"),
        border_left_width: outer_border_width("borderLeftWidth"),
        show_inner_vertical_border: table
            .get("showInnerVerticalBorder")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        show_inner_horizontal_border: table
            .get("showInnerHorizontalBorder")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        cell_padding_x: read_table_number("cellPaddingX", 10.0),
        cell_padding_y: read_table_number("cellPaddingY", 8.0),
        min_row_height: read_table_number("minRowHeight", 28.0),
        row_stripe: table
            .get("rowStripe")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        cell_wrap: table
            .get("cellWrap")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        header: table_cell_style_config(header, table, true),
        body: table_cell_style_config(body, table, false),
    })
}

fn image_style_config_from_value(config: &Value) -> Option<ImageStyleConfig> {
    let image = config.get("styles")?.get("image")?;
    Some(ImageStyleConfig {
        align: read_style_string(image, "imageAlign", "center"),
        width_mode: read_style_string(image, "imageWidthMode", "content"),
        width_percent: read_style_number(image, "imageWidthPercent", 100.0).clamp(20.0, 100.0),
    })
}

fn table_column_widths_from_percentages(table_width_twips: u32, percentages: &[f64]) -> Vec<u32> {
    let total = percentages
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .sum::<f64>();
    if total <= 0.0 {
        return Vec::new();
    }

    let mut widths = percentages
        .iter()
        .map(|value| ((table_width_twips as f64 * value.max(0.0) / total).round() as u32).max(1))
        .collect::<Vec<_>>();
    let used = widths
        .iter()
        .take(widths.len().saturating_sub(1))
        .sum::<u32>();
    if let Some(last) = widths.last_mut() {
        *last = table_width_twips.saturating_sub(used).max(1);
    }
    widths
}

fn table_cell_style_config(style: &Value, table: &Value, is_header: bool) -> TableCellStyleConfig {
    let font_size_key = if is_header {
        "headerFontSize"
    } else {
        "bodyFontSize"
    };
    let align_key = if is_header {
        "headerAlign"
    } else {
        "bodyAlign"
    };
    let vertical_align_key = if is_header {
        "headerVerticalAlign"
    } else {
        "bodyVerticalAlign"
    };
    let line_height_key = if is_header {
        "headerLineHeight"
    } else {
        "bodyLineHeight"
    };
    let background_key = if is_header {
        "headerBackgroundColor"
    } else {
        "bodyBackgroundColor"
    };
    let border_color_key = if is_header {
        "headerBorderColor"
    } else {
        "bodyBorderColor"
    };
    let border_width_key = if is_header {
        "headerBorderWidth"
    } else {
        "bodyBorderWidth"
    };

    TableCellStyleConfig {
        chinese_font: read_style_string(style, "chineseFont", "微软雅黑"),
        latin_font: read_style_string(style, "latinFont", "Times New Roman"),
        font_size: read_style_number(style, font_size_key, 10.5),
        bold: if is_header {
            style
                .get("headerBold")
                .or_else(|| table.get("headerBold"))
                .and_then(Value::as_bool)
                .unwrap_or(true)
        } else {
            false
        },
        color: read_style_color(style, "color", "111827"),
        background_color: read_style_fill(style, background_key, "FFFFFF"),
        horizontal_align: read_style_string(
            style,
            align_key,
            if is_header { "center" } else { "left" },
        ),
        vertical_align: read_style_string(style, vertical_align_key, "middle"),
        line_height: read_line_height_key(
            style,
            line_height_key,
            if is_header { 1.4 } else { 1.5 },
        ),
        border_color: read_style_color(style, border_color_key, "CBD5E1"),
        border_width: read_style_number(style, border_width_key, 1.0),
    }
}

fn document_style_config_from_value(config: &Value) -> Option<DocumentStyleConfig> {
    let styles = config.get("styles")?;
    let mut mapped_styles = HashMap::new();

    // 这几项在界面上没有独立入口，历史配置里可能整体缺失、也可能只写了一部分字段。
    // 直接 or_else 只能兜住「整体缺失」，残缺对象会让没写到的字段静默落回 Rust 默认值，
    // 所以这里改成字段级合并：先取基准样式，再用自身已有的字段覆盖。
    let body_text = merge_style_value(styles.get("normal"), styles.get("body-text"));
    let bullet_list = merge_style_value(styles.get("normal"), styles.get("bullet-list"));
    let numbered_list = merge_style_value(styles.get("normal"), styles.get("numbered-list"));

    for (style_id, style) in [
        ("title", styles.get("title")),
        ("heading-1", styles.get("heading-1")),
        ("heading-2", styles.get("heading-2")),
        ("heading-3", styles.get("heading-3")),
        ("heading-4", styles.get("heading-4")),
        ("heading-5", styles.get("heading-5")),
        ("heading-6", styles.get("heading-6")),
        ("normal", styles.get("normal")),
        ("body-text", body_text.as_ref()),
        ("caption", styles.get("caption")),
        (
            "table-caption",
            styles
                .get("table-caption")
                .or_else(|| styles.get("caption")),
        ),
        ("bullet-list", bullet_list.as_ref()),
        ("numbered-list", numbered_list.as_ref()),
        ("nested-list", styles.get("nested-list")),
    ] {
        if let Some(style) = style {
            mapped_styles.insert(
                style_id.to_string(),
                text_style_config_from_value(style_id, style),
            );
        }
    }

    let image_caption = styles
        .get("caption")
        .map(|style| caption_style_config_from_value("caption", style));
    let table_caption = styles
        .get("table-caption")
        .or_else(|| styles.get("caption"))
        .map(|style| caption_style_config_from_value("table-caption", style));

    (!mapped_styles.is_empty() || image_caption.is_some() || table_caption.is_some()).then_some(
        DocumentStyleConfig {
            styles: mapped_styles,
            image_caption,
            table_caption,
        },
    )
}

/// 用 `base` 作为基准、`override_value` 的已有字段逐个覆盖，产出一份完整的样式对象。
/// 任一侧缺失时退化为另一侧；两侧都没有则返回 None。
fn merge_style_value(base: Option<&Value>, override_value: Option<&Value>) -> Option<Value> {
    match (base.and_then(Value::as_object), override_value) {
        (Some(base_map), Some(override_value)) => match override_value.as_object() {
            Some(override_map) => {
                let mut merged = base_map.clone();
                for (key, value) in override_map {
                    merged.insert(key.clone(), value.clone());
                }
                Some(Value::Object(merged))
            }
            None => Some(override_value.clone()),
        },
        (Some(base_map), None) => Some(Value::Object(base_map.clone())),
        (None, Some(override_value)) => Some(override_value.clone()),
        (None, None) => None,
    }
}

fn caption_style_config_from_value(style_id: &str, style: &Value) -> CaptionStyleConfig {
    CaptionStyleConfig {
        text: text_style_config_from_value(style_id, style),
        position: read_style_string(style, "captionPosition", "below"),
        numbering: style
            .get("captionNumbering")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        number_format: read_style_string(
            style,
            "captionNumberFormat",
            if style_id == "table-caption" {
                "表 1"
            } else {
                "图 1"
            },
        ),
    }
}

fn text_style_config_from_value(style_id: &str, style: &Value) -> TextStyleConfig {
    let is_list = matches!(style_id, "bullet-list" | "numbered-list" | "nested-list");
    let number_format = read_style_string(style, "numberFormat", "1.");
    let list_marker_style = read_style_string(style, "listMarkerStyle", "disc");
    let nested_level2_marker_style = read_style_string(style, "nestedLevel2MarkerStyle", "circle");
    let nested_level3_marker_style = read_style_string(style, "nestedLevel3MarkerStyle", "square");
    let nested_level2_number_format = read_style_string(style, "nestedLevel2NumberFormat", "1)");
    let nested_level3_number_format = read_style_string(style, "nestedLevel3NumberFormat", "(1)");
    TextStyleConfig {
        chinese_font: read_style_string(style, "chineseFont", "微软雅黑"),
        latin_font: read_style_string(style, "latinFont", "Times New Roman"),
        font_size: read_style_number(style, "fontSize", 12.0),
        bold: read_style_bold(style),
        color: read_style_color(style, "color", "111827"),
        line_height: read_line_height(style, 1.5),
        before_spacing: read_spacing_points(style, "beforeSpacing", 0.0),
        after_spacing: read_spacing_points(style, "afterSpacing", 0.0),
        first_line_indent: read_style_indent(style, "firstLineIndent", 0.0),
        align: if matches!(style_id, "caption" | "table-caption") {
            read_style_string(
                style,
                "captionAlign",
                &read_style_string(style, "align", "center"),
            )
        } else {
            read_style_string(style, "align", "left")
        },
        is_list,
        list_numbering_mode: read_style_string(style, "listNumberingMode", "restart"),
        list_level_type_overrides: [
            read_optional_style_string(style, "listLevel1Type"),
            read_optional_style_string(style, "listLevel2Type"),
            read_optional_style_string(style, "listLevel3Type"),
            read_optional_style_string(style, "listLevel4Type"),
        ],
        list_level_marker_styles: [
            read_style_string(style, "listLevel1MarkerStyle", &list_marker_style),
            read_style_string(style, "listLevel2MarkerStyle", &nested_level2_marker_style),
            read_style_string(style, "listLevel3MarkerStyle", &nested_level3_marker_style),
            read_style_string(style, "listLevel4MarkerStyle", "dash"),
        ],
        list_level_number_formats: [
            read_style_string(style, "listLevel1NumberFormat", &number_format),
            read_style_string(
                style,
                "listLevel2NumberFormat",
                &nested_level2_number_format,
            ),
            read_style_string(
                style,
                "listLevel3NumberFormat",
                &nested_level3_number_format,
            ),
            read_style_string(style, "listLevel4NumberFormat", "I."),
        ],
        list_level_styles: [
            read_list_level_style_config(style, "listLevel1", 0.0),
            read_list_level_style_config(style, "listLevel2", 0.0),
            read_list_level_style_config(style, "listLevel3", 1.0),
            read_list_level_style_config(style, "listLevel4", 2.0),
        ],
    }
}

fn read_list_level_style_config(
    style: &Value,
    prefix: &str,
    level_offset: f64,
) -> ListLevelStyleConfig {
    let font_size = read_style_number(style, "fontSize", 12.0);
    let line_height = read_line_height(style, 1.5);
    let list_indent = read_style_indent(style, "listIndent", 2.0);
    let nested_indent_step = read_style_indent(style, "nestedIndentStep", 2.0);
    ListLevelStyleConfig {
        chinese_font: read_style_string(
            style,
            &format!("{prefix}ChineseFont"),
            &read_style_string(style, "chineseFont", "微软雅黑"),
        ),
        latin_font: read_style_string(
            style,
            &format!("{prefix}LatinFont"),
            &read_style_string(style, "latinFont", "Times New Roman"),
        ),
        font_size: read_style_number(style, &format!("{prefix}FontSize"), font_size),
        bold: read_style_bold_key(style, &format!("{prefix}FontWeight"))
            .unwrap_or_else(|| read_style_bold(style)),
        color: read_style_color(
            style,
            &format!("{prefix}Color"),
            &read_style_color(style, "color", "111827"),
        ),
        line_height: read_line_height_key(style, &format!("{prefix}LineHeight"), line_height),
        before_spacing: read_spacing_points(
            style,
            &format!("{prefix}BeforeSpacing"),
            read_spacing_points(style, "beforeSpacing", 0.0),
        ),
        after_spacing: read_spacing_points(
            style,
            &format!("{prefix}AfterSpacing"),
            read_spacing_points(style, "afterSpacing", 0.0),
        ),
        align: read_style_string(
            style,
            &format!("{prefix}Align"),
            &read_style_string(style, "align", "left"),
        ),
        indent: read_style_indent(
            style,
            &format!("{prefix}Indent"),
            list_indent + nested_indent_step * level_offset,
        ),
        text_indent: read_style_indent(
            style,
            &format!("{prefix}TextIndent"),
            read_style_indent(style, "listTextIndent", 1.0),
        ),
        wrap_mode: read_style_string(
            style,
            &format!("{prefix}WrapMode"),
            &read_style_string(style, "listWrapMode", "hanging"),
        ),
        numbering_mode: read_style_string(
            style,
            &format!("{prefix}NumberingMode"),
            &read_style_string(style, "listNumberingMode", "restart"),
        ),
    }
}

fn block_style_config_from_value(config: &Value) -> Option<BlockStyleConfig> {
    let styles = config.get("styles")?;
    let code = styles.get("source-code")?;
    let quote = styles.get("quote")?;
    let inline_code = styles.get("inline-code").unwrap_or(code);
    let empty = Value::Null;
    let horizontal_rule = styles.get("horizontal-rule").unwrap_or(&empty);

    Some(BlockStyleConfig {
        code: CodeBlockStyleConfig {
            chinese_font: read_style_string(code, "chineseFont", "Microsoft YaHei UI"),
            latin_font: read_style_string(code, "latinFont", "Consolas"),
            font_size: read_style_number(code, "fontSize", 9.0),
            bold: read_style_bold(code),
            color: read_style_color(code, "color", "111827"),
            background_color: read_style_fill(code, "backgroundColor", "F8FAFC"),
            border_color: read_style_color(code, "codeBorderColor", "E2E8F0"),
            line_height: read_line_height(code, 1.55),
            before_spacing: read_spacing_points(code, "beforeSpacing", 8.0),
            after_spacing: read_spacing_points(code, "afterSpacing", 8.0),
            padding_x: read_spacing_points(code, "codePaddingX", 12.0),
            padding_y: read_spacing_points(code, "codePaddingY", 10.0),
        },
        quote: QuoteBlockStyleConfig {
            chinese_font: read_style_string(quote, "chineseFont", "微软雅黑"),
            latin_font: read_style_string(quote, "latinFont", "Times New Roman"),
            font_size: read_style_number(quote, "fontSize", 10.5),
            bold: read_style_bold(quote),
            color: read_style_color(quote, "color", "475569"),
            background_color: read_style_color(quote, "backgroundColor", "F8FAFC"),
            border_color: read_style_color(quote, "quoteBorderColor", "94A3B8"),
            border_width: read_style_number(quote, "quoteBorderWidth", 4.0),
            line_height: read_line_height(quote, 1.7),
            before_spacing: read_spacing_points(quote, "beforeSpacing", 4.0),
            after_spacing: read_spacing_points(quote, "afterSpacing", 4.0),
        },
        inline_code: InlineCodeStyleConfig {
            chinese_font: read_style_string(inline_code, "chineseFont", "Microsoft YaHei UI"),
            latin_font: read_style_string(inline_code, "latinFont", "Consolas"),
            font_size: read_style_number(inline_code, "fontSize", 10.5),
            bold: read_style_bold(inline_code),
            color: read_style_color(inline_code, "color", "111827"),
            background_color: read_style_color(inline_code, "backgroundColor", "F1F5F9"),
        },
        horizontal_rule: HorizontalRuleStyleConfig {
            border_style: read_style_string(horizontal_rule, "borderStyle", "solid"),
            border_color: read_style_color(horizontal_rule, "borderColor", "CBD5E1"),
            border_width: read_style_number(horizontal_rule, "borderWidth", 1.0),
            before_spacing: read_spacing_points(horizontal_rule, "beforeSpacing", 12.0),
            after_spacing: read_spacing_points(horizontal_rule, "afterSpacing", 12.0),
        },
    })
}

fn read_line_height(style: &Value, default_value: f64) -> f64 {
    read_line_height_key(style, "lineHeight", default_value)
}

fn read_line_height_key(style: &Value, key: &str, default_value: f64) -> f64 {
    style
        .get(key)
        .and_then(|value| {
            value
                .as_str()
                .and_then(|text| text.trim().parse::<f64>().ok())
                .or_else(|| value.as_f64())
        })
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(default_value)
}

fn read_spacing_points(style: &Value, key: &str, default_value: f64) -> f64 {
    style
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(default_value)
}

fn read_style_indent(style: &Value, key: &str, default_value: f64) -> f64 {
    style
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(default_value)
}

fn read_style_string(style: &Value, key: &str, default_value: &str) -> String {
    style
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_value)
        .to_string()
}

fn read_optional_style_string(style: &Value, key: &str) -> Option<String> {
    style
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_style_number(style: &Value, key: &str, default_value: f64) -> f64 {
    style
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(default_value)
}

fn read_style_bold(style: &Value) -> bool {
    read_style_bold_key(style, "fontWeight").unwrap_or(false)
}

fn read_style_bold_key(style: &Value, key: &str) -> Option<bool> {
    style
        .get(key)
        .and_then(|value| {
            value
                .as_str()
                .and_then(|text| text.trim().parse::<u16>().ok())
                .or_else(|| value.as_u64().and_then(|number| u16::try_from(number).ok()))
        })
        .map(|weight| weight >= 600)
}

fn read_style_color(style: &Value, key: &str, default_value: &str) -> String {
    style
        .get(key)
        .and_then(Value::as_str)
        .and_then(normalize_hex_color)
        .unwrap_or_else(|| default_value.to_string())
}

fn read_style_fill(style: &Value, key: &str, default_value: &str) -> String {
    match style.get(key).and_then(Value::as_str).map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("transparent") => "transparent".to_string(),
        Some(value) => normalize_hex_color(value).unwrap_or_else(|| default_value.to_string()),
        None => default_value.to_string(),
    }
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let color = value.trim().trim_start_matches('#');
    if color.eq_ignore_ascii_case("transparent") {
        return None;
    }
    if color.len() == 3 && color.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Some(
            color
                .chars()
                .flat_map(|ch| [ch, ch])
                .collect::<String>()
                .to_ascii_uppercase(),
        );
    }
    (color.len() == 6 && color.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| color.to_ascii_uppercase())
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
        mappings: default_built_in_heading_mappings(),
    }
}

fn default_built_in_heading_numbering_config(template_id: &str) -> Option<HeadingNumberingConfig> {
    match template_id {
        "default-report" | "technical-spec" => Some(default_report_heading_numbering_config()),
        "official-document" => Some(HeadingNumberingConfig {
            formats: [
                None,
                Some("一、".to_string()),
                Some("1.1.1".to_string()),
                Some("1.1.1.1".to_string()),
                Some("1.1.1.1.1".to_string()),
                Some("1.1.1.1.1.1".to_string()),
            ],
            mappings: default_built_in_heading_mappings(),
        }),
        _ => None,
    }
}

fn heading_numbering_config_from_value(config: &Value) -> Option<HeadingNumberingConfig> {
    let styles = config.get("styles")?;
    let mut formats: [Option<String>; 6] = Default::default();
    let mappings = heading_mappings_from_value(config);

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

    (formats.iter().any(Option::is_some) || mappings != default_heading_mappings())
        .then_some(HeadingNumberingConfig { formats, mappings })
}

fn default_heading_mappings() -> [HeadingTarget; 6] {
    [
        HeadingTarget::Heading(1),
        HeadingTarget::Heading(2),
        HeadingTarget::Heading(3),
        HeadingTarget::Heading(4),
        HeadingTarget::Heading(5),
        HeadingTarget::Heading(6),
    ]
}

fn default_built_in_heading_mappings() -> [HeadingTarget; 6] {
    [
        HeadingTarget::Title,
        HeadingTarget::Heading(1),
        HeadingTarget::Heading(2),
        HeadingTarget::Heading(3),
        HeadingTarget::Heading(4),
        HeadingTarget::Heading(5),
    ]
}

fn heading_mappings_from_value(config: &Value) -> [HeadingTarget; 6] {
    let mut mappings = config
        .get("templateId")
        .and_then(Value::as_str)
        .is_some_and(is_built_in_template_id)
        .then_some(default_built_in_heading_mappings())
        .unwrap_or_else(default_heading_mappings);
    let rules = config.get("markdownRules");

    if rules
        .and_then(|value| value.get("headingMappingMode"))
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim() == "title-offset")
    {
        mappings = [
            HeadingTarget::Title,
            HeadingTarget::Heading(1),
            HeadingTarget::Heading(2),
            HeadingTarget::Heading(3),
            HeadingTarget::Heading(4),
            HeadingTarget::Heading(5),
        ];
    }

    let Some(saved_mappings) = rules.and_then(|value| value.get("headingMappings")) else {
        return mappings;
    };

    for source_level in 1..=6 {
        let key = format!("heading-{source_level}");
        let Some(target) = saved_mappings
            .get(&key)
            .and_then(Value::as_str)
            .and_then(parse_heading_target)
        else {
            continue;
        };
        mappings[source_level - 1] = target;
    }

    mappings
}

fn is_built_in_template_id(template_id: &str) -> bool {
    matches!(
        template_id.trim(),
        "default-report" | "official-document" | "technical-spec"
    )
}

fn parse_heading_target(value: &str) -> Option<HeadingTarget> {
    let value = value.trim();
    if value == "title" {
        return Some(HeadingTarget::Title);
    }

    value
        .strip_prefix("heading-")
        .and_then(|level| level.parse::<usize>().ok())
        .filter(|level| (1..=6).contains(level))
        .map(HeadingTarget::Heading)
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

fn has_supported_text_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown")
                || extension.eq_ignore_ascii_case("txt")
        })
}

fn make_temp_path(prefix: &str, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let process_id = std::process::id();

    std::env::temp_dir()
        .join("md-king")
        .join(format!("{prefix}-{process_id}-{timestamp}.{extension}"))
}

/// 把前端栅格化好的图片写进临时目录，返回绝对路径。
///
/// Mermaid 图在浏览器侧渲染成 SVG 再画进 canvas 得到 PNG——DOCX 不支持 SVG，
/// Pandoc 遇到 SVG 会直接跳过那张图。转换前需要把这些 PNG 落到磁盘上，
/// 才能在 Markdown 里用普通的图片语法引用它们。
pub fn write_temp_image(bytes: &[u8], extension: &str) -> Result<String, String> {
    let safe_extension = if extension.chars().all(|ch| ch.is_ascii_alphanumeric()) && !extension.is_empty() {
        extension
    } else {
        "png"
    };

    let path = make_temp_path("mermaid", safe_extension);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建临时目录失败：{error}"))?;
    }
    fs::write(&path, bytes).map_err(|error| format!("写入临时图片失败：{error}"))?;
    Ok(path.to_string_lossy().to_string())
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

fn validate_docx_package(path: &Path) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|error| format!("读取生成的 DOCX 失败：{error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("生成结果不是有效的 DOCX 包：{error}"))?;
    for required in [
        "[Content_Types].xml",
        "word/document.xml",
        "word/styles.xml",
    ] {
        archive
            .by_name(required)
            .map_err(|_| format!("生成的 DOCX 缺少必要内容：{required}"))?;
    }
    Ok(())
}

fn commit_staged_output(staged_path: &Path, output_path: &Path) -> Result<Option<String>, String> {
    if !staged_path.is_file() {
        return Err("转换完成但未找到临时 DOCX 输出。".to_string());
    }

    if !output_path.exists() {
        return fs::rename(staged_path, output_path)
            .map(|_| None)
            .map_err(|error| format!("写入输出文件失败：{error}"));
    }

    let backup_path = make_sibling_temp_path(output_path, "output-backup", "docx");
    fs::rename(output_path, &backup_path)
        .map_err(|error| format!("无法替换现有输出文件，请确认文件未被 Word/WPS 占用：{error}"))?;

    if let Err(error) = fs::rename(staged_path, output_path) {
        let restore_error = fs::rename(&backup_path, output_path).err();
        return Err(match restore_error {
            Some(restore_error) => format!(
                "写入新 DOCX 失败：{error}；恢复原文件也失败：{restore_error}。原文件备份位于 {}",
                backup_path.to_string_lossy()
            ),
            None => format!("写入新 DOCX 失败，已恢复原文件：{error}"),
        });
    }

    match fs::remove_file(&backup_path) {
        Ok(()) => Ok(None),
        Err(error) => Ok(Some(format!(
            "转换已完成，但清理旧文件备份失败：{}（{error}）",
            backup_path.to_string_lossy()
        ))),
    }
}

fn prepare_markdown_file_for_pandoc(
    input_path: &Path,
) -> Result<(PathBuf, Option<PathBuf>), ConvertResultPreparationError> {
    let original = fs::read_to_string(input_path).map_err(|error| {
        ConvertResultPreparationError(format!("读取 Markdown/TXT 文件失败：{error}"))
    })?;
    let prepared = preprocess_markdown_for_word(&original);
    let is_text_file = input_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
    if prepared == original && !is_text_file {
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
        if let Some(fence) = parse_markdown_fence_start(line) {
            if fence.is_math {
                let mut formula_lines = Vec::new();
                let mut closed = false;
                for content_line in lines.by_ref() {
                    if is_fence_end(content_line, fence.marker, fence.length) {
                        closed = true;
                        break;
                    }
                    formula_lines.push(content_line);
                }

                if !closed {
                    output.push(line.to_string());
                    output.extend(formula_lines.into_iter().map(str::to_string));
                    continue;
                }

                output.push("$$".to_string());
                output.extend(formula_lines.into_iter().map(str::to_string));
                output.push("$$".to_string());
                continue;
            }

            if let Some(language) = fence.language.as_deref() {
                output.push(format!("{CODE_LANGUAGE_MARKER_PREFIX}{language}"));
            }
            output.push(line.to_string());
            for content_line in lines.by_ref() {
                output.push(content_line.to_string());
                if is_fence_end(content_line, fence.marker, fence.length) {
                    break;
                }
            }
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

struct MarkdownFenceStart {
    marker: char,
    length: usize,
    language: Option<String>,
    is_math: bool,
}

fn parse_markdown_fence_start(line: &str) -> Option<MarkdownFenceStart> {
    let indent = line.chars().take_while(|ch| *ch == ' ').count();
    if indent > 3 {
        return None;
    }
    let trimmed = &line[indent..];
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed.chars().take_while(|ch| *ch == marker).count();
    if length < 3 {
        return None;
    }
    let info = &trimmed[length..];
    if marker == '`' && info.contains('`') {
        return None;
    }
    let language = parse_fence_language(info);
    let is_math = language
        .as_deref()
        .map(is_math_fence_language)
        .unwrap_or(false);

    Some(MarkdownFenceStart {
        marker,
        length,
        language,
        is_math,
    })
}

fn parse_fence_language(info: &str) -> Option<String> {
    let info = info.trim();
    if info.is_empty() {
        return None;
    }

    let normalized = if info.starts_with('{') && info.ends_with('}') {
        info.trim_start_matches('{').trim_end_matches('}')
    } else {
        info
    };

    normalized.split_whitespace().find_map(|token| {
        let token = token.trim().trim_start_matches('.');
        if token.is_empty() || token.starts_with('#') || token.contains('=') {
            return None;
        }
        let language: String = token
            .chars()
            .filter(|ch| ch.is_alphanumeric() || matches!(ch, '+' | '#' | '-' | '_' | '.'))
            .collect();
        (!language.is_empty()).then_some(language)
    })
}

fn is_math_fence_language(language: &str) -> bool {
    matches!(
        language.trim().to_ascii_lowercase().as_str(),
        "math" | "latex" | "tex" | "formula" | "equation" | "公式"
    )
}

fn is_fence_end(line: &str, marker: char, opening_length: usize) -> bool {
    let indent = line.chars().take_while(|ch| *ch == ' ').count();
    if indent > 3 {
        return false;
    }
    let trimmed = &line[indent..];
    let length = trimmed.chars().take_while(|ch| *ch == marker).count();
    length >= opening_length && trimmed[length..].trim().is_empty()
}

fn read_task_list_markers_from_docx(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
) -> HashMap<String, TaskListMarker> {
    let Ok(mut numbering_file) = archive.by_name("word/numbering.xml") else {
        return HashMap::new();
    };
    let mut data = Vec::new();
    if numbering_file.read_to_end(&mut data).is_err() {
        return HashMap::new();
    }
    let Ok(xml) = String::from_utf8(data) else {
        return HashMap::new();
    };
    task_list_markers_from_numbering_xml(&xml)
}

fn task_list_markers_from_numbering_xml(xml: &str) -> HashMap<String, TaskListMarker> {
    let abstract_num =
        Regex::new(r#"(?s)<w:abstractNum\s+w:abstractNumId="([^"]+)">.*?</w:abstractNum>"#)
            .expect("valid abstract numbering regex");
    let mut abstract_markers = HashMap::new();
    for captures in abstract_num.captures_iter(xml) {
        let Some(id) = captures.get(1).map(|value| value.as_str().to_string()) else {
            continue;
        };
        let block = captures.get(0).map(|value| value.as_str()).unwrap_or("");
        if block.contains(r#"<w:lvlText w:val="☒""#) {
            abstract_markers.insert(id, TaskListMarker::Checked);
        } else if block.contains(r#"<w:lvlText w:val="☐""#) {
            abstract_markers.insert(id, TaskListMarker::Unchecked);
        }
    }

    let num = Regex::new(
        r#"(?s)<w:num\s+w:numId="([^"]+)">.*?<w:abstractNumId\s+w:val="([^"]+)"\s*/>.*?</w:num>"#,
    )
    .expect("valid numbering instance regex");
    let mut markers = HashMap::new();
    for captures in num.captures_iter(xml) {
        let Some(num_id) = captures.get(1).map(|value| value.as_str().to_string()) else {
            continue;
        };
        let Some(abstract_id) = captures.get(2).map(|value| value.as_str()) else {
            continue;
        };
        if let Some(marker) = abstract_markers.get(abstract_id).copied() {
            markers.insert(num_id, marker);
        }
    }
    markers
}

fn normalize_docx(
    path: &Path,
    apply_default_template_style: bool,
    heading_numbering: Option<&HeadingNumberingConfig>,
    markdown_features: &MarkdownFeatureConfig,
    page_settings: Option<&PageSettingsConfig>,
    table_style: Option<&TableStyleConfig>,
    image_style: Option<&ImageStyleConfig>,
    document_style: Option<&DocumentStyleConfig>,
    block_style: Option<&BlockStyleConfig>,
) -> Result<(), String> {
    let original = fs::read(path).map_err(|error| format!("读取 DOCX 失败：{error}"))?;
    let reader = Cursor::new(original);
    let mut archive =
        ZipArchive::new(reader).map_err(|error| format!("打开 DOCX 包失败：{error}"))?;
    let mut output = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(&mut output);
    let mut has_numbering_xml = false;
    let mut has_document_rels_xml = false;
    let mut has_content_types_xml = false;
    let mut has_header_xml = false;
    let mut has_footer_xml = false;
    let header_footer = page_settings.filter(|settings| page_settings_has_header_footer(settings));
    let task_list_markers = read_task_list_markers_from_docx(&mut archive);

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
            let xml = mark_task_list_paragraphs(&xml, &task_list_markers);
            let xml = normalize_document_xml(
                &xml,
                apply_default_template_style,
                heading_numbering,
                markdown_features,
                table_style,
                document_style,
                block_style,
            );
            let xml = normalize_document_captions(&xml, document_style);
            let xml = apply_page_settings_to_document_xml(&xml, page_settings);
            data = normalize_document_images(&xml, page_settings, image_style).into_bytes();
        } else if name == "word/styles.xml"
            && (apply_default_template_style || document_style.is_some())
        {
            let xml = String::from_utf8(data)
                .map_err(|error| format!("解析 styles.xml 失败：{error}"))?;
            data = normalize_template_styles_xml(
                &xml,
                markdown_features,
                document_style,
                apply_default_template_style,
            )
            .into_bytes();
        } else if name == "word/numbering.xml" {
            has_numbering_xml = true;
            if let Some(heading_numbering) = heading_numbering {
                let xml = String::from_utf8(data)
                    .map_err(|error| format!("解析 numbering.xml 失败：{error}"))?;
                data = ensure_heading_numbering_xml(&xml, heading_numbering).into_bytes();
            }
        }
        if name == "[Content_Types].xml" {
            has_content_types_xml = true;
            if let Some(settings) = header_footer {
                let xml = String::from_utf8(data)
                    .map_err(|error| format!("解析 [Content_Types].xml 失败：{error}"))?;
                data = ensure_header_footer_content_types_xml(&xml, settings).into_bytes();
            }
        } else if name == "word/_rels/document.xml.rels" {
            has_document_rels_xml = true;
            if let Some(settings) = header_footer {
                let xml = String::from_utf8(data)
                    .map_err(|error| format!("解析 document.xml.rels 失败：{error}"))?;
                data = ensure_header_footer_relationships_xml(&xml, settings).into_bytes();
            }
        } else if name == "word/header-mdking.xml" {
            has_header_xml = true;
            if let Some(settings) =
                header_footer.filter(|settings| page_settings_has_header(settings))
            {
                data = create_header_xml(settings).into_bytes();
            }
        } else if name == "word/footer-mdking.xml" {
            has_footer_xml = true;
            if let Some(settings) =
                header_footer.filter(|settings| page_settings_has_footer(settings))
            {
                data = create_footer_xml(settings).into_bytes();
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

    if let Some(settings) = header_footer {
        if !has_content_types_xml {
            writer
                .start_file(
                    "[Content_Types].xml",
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| format!("写入 [Content_Types].xml 失败：{error}"))?;
            writer
                .write_all(create_header_footer_content_types_xml(settings).as_bytes())
                .map_err(|error| format!("写入 [Content_Types].xml 内容失败：{error}"))?;
        }

        if !has_document_rels_xml {
            writer
                .start_file(
                    "word/_rels/document.xml.rels",
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| format!("写入 document.xml.rels 失败：{error}"))?;
            writer
                .write_all(create_header_footer_relationships_xml(settings).as_bytes())
                .map_err(|error| format!("写入 document.xml.rels 内容失败：{error}"))?;
        }

        if page_settings_has_header(settings) && !has_header_xml {
            writer
                .start_file(
                    "word/header-mdking.xml",
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| format!("写入 header-mdking.xml 失败：{error}"))?;
            writer
                .write_all(create_header_xml(settings).as_bytes())
                .map_err(|error| format!("写入 header-mdking.xml 内容失败：{error}"))?;
        }

        if page_settings_has_footer(settings) && !has_footer_xml {
            writer
                .start_file(
                    "word/footer-mdking.xml",
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| format!("写入 footer-mdking.xml 失败：{error}"))?;
            writer
                .write_all(create_footer_xml(settings).as_bytes())
                .map_err(|error| format!("写入 footer-mdking.xml 内容失败：{error}"))?;
        }
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
    table_style: Option<&TableStyleConfig>,
    document_style: Option<&DocumentStyleConfig>,
    block_style: Option<&BlockStyleConfig>,
) -> String {
    let xml = force_table_width_percent(xml);
    let xml = if markdown_features.horizontal_rule {
        normalize_horizontal_rule_paragraphs(&xml, block_style.map(|style| &style.horizontal_rule))
    } else {
        remove_horizontal_rule_paragraphs(&xml)
    };
    let active_table_style = table_style.cloned().or_else(|| {
        apply_default_table_style.then(|| {
            // A built-in template has no saved style config yet. In that case,
            // retain the document's actual printable width instead of assuming A4.
            default_table_style_config(document_content_width_twips(&xml))
        })
    });
    let xml = if let Some(table_style) = active_table_style.as_ref() {
        normalize_table_cells(&xml, table_style)
    } else {
        xml
    };
    let xml = {
        let xml = normalize_code_and_quote_blocks(&xml, markdown_features, block_style);
        if markdown_features.inline_code {
            normalize_inline_code_runs(&xml, block_style.map(|style| &style.inline_code))
        } else {
            flatten_inline_code_runs(&xml)
        }
    };
    let has_list_style = document_style.is_some_and(|style| {
        style.styles.contains_key("bullet-list")
            || style.styles.contains_key("numbered-list")
            || style.styles.contains_key("nested-list")
    });
    let xml = if apply_default_table_style || has_list_style {
        normalize_list_markers(&xml, document_style)
    } else {
        xml
    };

    if let Some(heading_numbering) = heading_numbering {
        normalize_heading_numbering(&xml, heading_numbering)
    } else {
        xml
    }
}

fn normalize_document_captions(xml: &str, document_style: Option<&DocumentStyleConfig>) -> String {
    let Some(document_style) = document_style else {
        return xml.to_string();
    };
    let xml = document_style
        .image_caption
        .as_ref()
        .map(|style| normalize_image_captions(xml, style))
        .unwrap_or_else(|| xml.to_string());
    document_style
        .table_caption
        .as_ref()
        .map(|style| normalize_table_captions(&xml, style))
        .unwrap_or(xml)
}

fn normalize_image_captions(xml: &str, style: &CaptionStyleConfig) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#).expect("valid paragraph regex");
    let mut blocks = Vec::new();
    let mut cursor = 0;
    for matched in paragraph.find_iter(xml) {
        blocks.push((
            xml[cursor..matched.start()].to_string(),
            matched.as_str().to_string(),
        ));
        cursor = matched.end();
    }
    if blocks.is_empty() {
        return xml.to_string();
    }

    let mut output = String::new();
    let mut index = 0;
    let mut number = 0;
    while index < blocks.len() {
        let (gap, current) = &blocks[index];
        output.push_str(gap);
        let next_is_caption = blocks
            .get(index + 1)
            .is_some_and(|(_, next)| is_image_caption_paragraph(next));

        if current.contains("<w:drawing") && next_is_caption {
            let (caption_gap, caption) = &blocks[index + 1];
            number += 1;
            let caption = normalize_caption_paragraph(caption, style, number);
            if style.position.trim().eq_ignore_ascii_case("above") {
                output.push_str(&caption);
                output.push_str(caption_gap);
                output.push_str(current);
            } else {
                output.push_str(current);
                output.push_str(caption_gap);
                output.push_str(&caption);
            }
            index += 2;
            continue;
        }

        if is_image_caption_paragraph(current) {
            number += 1;
            output.push_str(&normalize_caption_paragraph(current, style, number));
        } else {
            output.push_str(current);
        }
        index += 1;
    }
    output.push_str(&xml[cursor..]);
    output
}

fn normalize_table_captions(xml: &str, style: &CaptionStyleConfig) -> String {
    let block = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>|<w:tbl>.*?</w:tbl>"#)
        .expect("valid document block regex");
    let mut blocks = Vec::new();
    let mut cursor = 0;
    for matched in block.find_iter(xml) {
        blocks.push((
            xml[cursor..matched.start()].to_string(),
            matched.as_str().to_string(),
        ));
        cursor = matched.end();
    }
    if blocks.is_empty() {
        return xml.to_string();
    }

    let mut output = String::new();
    let mut index = 0;
    let mut number = 0;
    while index < blocks.len() {
        let (gap, current) = &blocks[index];
        output.push_str(gap);
        let next_is_table = blocks
            .get(index + 1)
            .is_some_and(|(_, next)| next.starts_with("<w:tbl>"));
        let next_is_caption = blocks
            .get(index + 1)
            .is_some_and(|(_, next)| is_table_caption_paragraph(next));

        if is_table_caption_paragraph(current) && next_is_table {
            let (table_gap, table) = &blocks[index + 1];
            number += 1;
            let caption = normalize_caption_paragraph(current, style, number);
            if style.position.trim().eq_ignore_ascii_case("below") {
                output.push_str(table);
                output.push_str(table_gap);
                output.push_str(&caption);
            } else {
                output.push_str(&caption);
                output.push_str(table_gap);
                output.push_str(table);
            }
            index += 2;
            continue;
        }

        if current.starts_with("<w:tbl>") && next_is_caption {
            let (caption_gap, caption) = &blocks[index + 1];
            number += 1;
            let caption = normalize_caption_paragraph(caption, style, number);
            if style.position.trim().eq_ignore_ascii_case("above") {
                output.push_str(&caption);
                output.push_str(caption_gap);
                output.push_str(current);
            } else {
                output.push_str(current);
                output.push_str(caption_gap);
                output.push_str(&caption);
            }
            index += 2;
            continue;
        }

        if is_table_caption_paragraph(current) {
            number += 1;
            output.push_str(&normalize_caption_paragraph(current, style, number));
        } else {
            output.push_str(current);
        }
        index += 1;
    }
    output.push_str(&xml[cursor..]);
    output
}

fn is_image_caption_paragraph(paragraph_xml: &str) -> bool {
    capture_paragraph_style_id(paragraph_xml).is_some_and(|style_id| style_id == "ImageCaption")
}

fn is_table_caption_paragraph(paragraph_xml: &str) -> bool {
    capture_paragraph_style_id(paragraph_xml)
        .is_some_and(|style_id| matches!(style_id.as_str(), "Caption" | "TableCaption"))
}

fn normalize_caption_paragraph(
    paragraph_xml: &str,
    style: &CaptionStyleConfig,
    number: usize,
) -> String {
    let text = strip_caption_number_prefix(&paragraph_plain_text(paragraph_xml));
    let text = if style.numbering {
        format!(
            "{} {}",
            caption_number_label(&style.number_format, number),
            text.trim()
        )
    } else {
        text.trim().to_string()
    };
    let paragraph_properties = text_style_paragraph_properties_xml(&style.text);
    let run_properties = text_style_run_properties_xml(&style.text);
    let paragraph_start = Regex::new(r#"<w:p(\s[^>]*)?>"#).expect("valid paragraph start regex");
    let attributes = paragraph_start
        .captures(paragraph_xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str())
        .unwrap_or("");

    format!(
        r#"<w:p{attributes}>{paragraph_properties}<w:r><w:rPr>{run_properties}</w:rPr><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        escape_xml_text(&text)
    )
}

fn strip_caption_number_prefix(text: &str) -> String {
    let prefix = Regex::new(r#"^\s*(?:(?:图|表|Figure|Table)\s*)?\d+(?:-\d+)?[.、:：]?\s*"#)
        .expect("valid caption number prefix regex");
    prefix.replace(text, "").to_string()
}

fn caption_number_label(format: &str, number: usize) -> String {
    let number_pattern = Regex::new(r#"\d+(?:-\d+)?"#).expect("valid caption number regex");
    let Some(found) = number_pattern.find(format) else {
        return format!("{} {}", format.trim(), number).trim().to_string();
    };

    let current = found.as_str();
    let replacement = if let Some((prefix, _)) = current.rsplit_once('-') {
        format!("{prefix}-{number}")
    } else {
        number.to_string()
    };
    format!(
        "{}{}{}",
        &format[..found.start()],
        replacement,
        &format[found.end()..]
    )
}

fn normalize_document_images(
    xml: &str,
    page_settings: Option<&PageSettingsConfig>,
    image_style: Option<&ImageStyleConfig>,
) -> String {
    let content_width_twips = page_settings
        .map(page_content_width_twips)
        .unwrap_or_else(|| {
            document_content_width_twips(xml).unwrap_or_else(default_content_width_twips)
        });
    let width_mode = image_style
        .map(|style| style.width_mode.as_str())
        .unwrap_or("content");
    let width_percent = image_style
        .map(|style| style.width_percent)
        .unwrap_or(100.0)
        .clamp(20.0, 100.0);
    let target_width_emu = if width_mode == "custom" {
        ((f64::from(content_width_twips) * width_percent / 100.0).round() as u64) * 635
    } else {
        u64::from(content_width_twips) * 635
    };
    let align = image_style
        .map(|style| word_alignment_value(&style.align))
        .unwrap_or("center");
    let paragraph_re = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#).expect("valid paragraph regex");

    paragraph_re
        .replace_all(xml, |captures: &Captures| {
            let paragraph = &captures[0];
            if !paragraph.contains("<w:drawing") {
                return paragraph.to_string();
            }

            let paragraph = if width_mode == "original" {
                paragraph.to_string()
            } else {
                normalize_image_drawings(paragraph, target_width_emu)
            };
            ensure_image_paragraph_aligned(&paragraph, align)
        })
        .to_string()
}

fn normalize_image_drawings(xml: &str, target_width_emu: u64) -> String {
    let drawing_re =
        Regex::new(r#"(?s)<w:drawing\b[^>]*>.*?</w:drawing>"#).expect("valid drawing regex");

    drawing_re
        .replace_all(xml, |captures: &Captures| {
            let drawing = &captures[0];
            if !drawing.contains("<a:blip") {
                return drawing.to_string();
            }

            let (current_width, current_height) =
                drawing_extent(drawing).unwrap_or((target_width_emu, target_width_emu));
            let target_height = scale_dimension(current_height, target_width_emu, current_width);
            replace_drawing_extents(drawing, target_width_emu, target_height)
        })
        .to_string()
}

fn drawing_extent(xml: &str) -> Option<(u64, u64)> {
    let extent_re = Regex::new(r#"<(?:wp:extent|a:ext)\b([^>]*)/>"#).expect("valid extent regex");
    extent_re.captures(xml).and_then(|captures| {
        let attrs = captures.get(1)?.as_str();
        Some((numeric_attr(attrs, "cx")?, numeric_attr(attrs, "cy")?))
    })
}

fn replace_drawing_extents(xml: &str, width: u64, height: u64) -> String {
    let extent_re = Regex::new(r#"(<(?:wp:extent|a:ext)\b)([^>]*)/>"#).expect("valid extent regex");
    extent_re
        .replace_all(xml, |captures: &Captures| {
            let tag = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let attrs = captures.get(2).map(|value| value.as_str()).unwrap_or("");
            let attrs = replace_numeric_attr(attrs, "cx", width);
            let attrs = replace_numeric_attr(&attrs, "cy", height);
            format!("{tag}{attrs}/>")
        })
        .to_string()
}

fn ensure_image_paragraph_aligned(paragraph: &str, align: &str) -> String {
    let paragraph_properties_re = Regex::new(r#"(?s)<w:pPr\b[^>]*/>|<w:pPr\b[^>]*>.*?</w:pPr>"#)
        .expect("valid paragraph properties regex");
    if paragraph_properties_re.is_match(paragraph) {
        return paragraph_properties_re
            .replace(paragraph, |captures: &Captures| {
                align_paragraph_properties(&captures[0], align)
            })
            .to_string();
    }

    let paragraph_start_re = Regex::new(r#"<w:p\b[^>]*>"#).expect("valid paragraph start regex");
    paragraph_start_re
        .replace(paragraph, |captures: &Captures| {
            format!("{}<w:pPr><w:jc w:val=\"{align}\" /></w:pPr>", &captures[0])
        })
        .to_string()
}

fn align_paragraph_properties(properties: &str, align: &str) -> String {
    let self_closing_re = Regex::new(r#"(?s)^<w:pPr\b([^>]*)/>$"#)
        .expect("valid self closing paragraph properties regex");
    if let Some(captures) = self_closing_re.captures(properties) {
        let attrs = captures.get(1).map(|value| value.as_str()).unwrap_or("");
        return format!(r#"<w:pPr{attrs}><w:jc w:val="{align}" /></w:pPr>"#);
    }

    let jc_re = Regex::new(r#"(?s)<w:jc\b[^>]*/>"#).expect("valid paragraph alignment regex");
    let without_alignment = jc_re.replace_all(properties, "");
    without_alignment
        .replacen(
            "</w:pPr>",
            &format!(r#"<w:jc w:val="{align}" /></w:pPr>"#),
            1,
        )
        .to_string()
}

fn document_content_width_twips(xml: &str) -> Option<u32> {
    let section_re =
        Regex::new(r#"(?s)<w:sectPr\b[^>]*>.*?</w:sectPr>"#).expect("valid section regex");
    let section = section_re.find_iter(xml).last()?.as_str();
    let size_attrs = Regex::new(r#"<w:pgSz\b([^>]*)/>"#)
        .expect("valid page size regex")
        .captures(section)?
        .get(1)?
        .as_str()
        .to_string();
    let margin_attrs = Regex::new(r#"<w:pgMar\b([^>]*)/>"#)
        .expect("valid page margins regex")
        .captures(section)?
        .get(1)?
        .as_str()
        .to_string();
    let width = numeric_attr(&size_attrs, "w:w")?;
    let left = numeric_attr(&margin_attrs, "w:left").unwrap_or(0);
    let right = numeric_attr(&margin_attrs, "w:right").unwrap_or(0);
    width
        .saturating_sub(left)
        .saturating_sub(right)
        .try_into()
        .ok()
}

fn page_content_width_twips(page_settings: &PageSettingsConfig) -> u32 {
    let (mut width, mut height) = paper_size_twips(&page_settings.paper_size);
    if page_settings
        .orientation
        .trim()
        .eq_ignore_ascii_case("landscape")
    {
        std::mem::swap(&mut width, &mut height);
    }
    width
        .saturating_sub(cm_to_twips(page_settings.margin_left))
        .saturating_sub(cm_to_twips(page_settings.margin_right))
        .max(1)
}

fn default_content_width_twips() -> u32 {
    let (width, _) = paper_size_twips("A4");
    width
        .saturating_sub(cm_to_twips(3.18))
        .saturating_sub(cm_to_twips(3.18))
        .max(1)
}

fn scale_dimension(value: u64, target_width: u64, current_width: u64) -> u64 {
    if current_width == 0 {
        return value.max(1);
    }
    ((u128::from(value) * u128::from(target_width) / u128::from(current_width)) as u64).max(1)
}

fn numeric_attr(attrs: &str, name: &str) -> Option<u64> {
    let pattern = format!(r#"\b{}\s*=\s*"(\d+)""#, regex::escape(name));
    Regex::new(&pattern)
        .expect("valid numeric attribute regex")
        .captures(attrs)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u64>().ok())
}

fn replace_numeric_attr(attrs: &str, name: &str, value: u64) -> String {
    let pattern = format!(r#"\b{}\s*=\s*"\d+""#, regex::escape(name));
    let attr_re = Regex::new(&pattern).expect("valid numeric attribute regex");
    let replacement = format!(r#"{name}="{value}""#);
    if attr_re.is_match(attrs) {
        attr_re.replace(attrs, replacement).to_string()
    } else {
        format!(r#"{attrs} {replacement}"#)
    }
}

fn apply_page_settings_to_document_xml(
    xml: &str,
    page_settings: Option<&PageSettingsConfig>,
) -> String {
    let Some(page_settings) = page_settings else {
        return xml.to_string();
    };
    let xml = if page_settings_has_header_footer(page_settings) {
        ensure_word_relationship_namespace(xml)
    } else {
        xml.to_string()
    };
    let xml = normalize_toc_fields(&xml, page_settings);

    let section = Regex::new(r#"(?s)<w:sectPr\b[^>]*>.*?</w:sectPr>"#).expect("valid sectPr regex");
    if section.is_match(&xml) {
        return section
            .replace_all(&xml, |captures: &Captures| {
                normalize_section_page_settings(&captures[0], page_settings)
            })
            .to_string();
    }

    let insert_at = Regex::new(r#"</w:body>"#).expect("valid body closing regex");
    let section_xml = normalize_section_page_settings("<w:sectPr></w:sectPr>", page_settings);
    insert_at
        .replace(&xml, format!("{section_xml}</w:body>"))
        .to_string()
}

fn ensure_word_relationship_namespace(xml: &str) -> String {
    if xml.contains("xmlns:r=") {
        return xml.to_string();
    }

    xml.replacen(
        "<w:document",
        r#"<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#,
        1,
    )
}

fn normalize_toc_fields(xml: &str, page_settings: &PageSettingsConfig) -> String {
    if !page_settings.toc_enabled {
        return xml.to_string();
    }

    let instruction = toc_field_instruction(page_settings);
    let fld_simple = Regex::new(r#"<w:fldSimple\b([^>]*)\bw:instr="([^"]*TOC[^"]*)"([^>]*)>"#)
        .expect("valid TOC fldSimple regex");
    let xml = fld_simple
        .replace_all(xml, |captures: &Captures| {
            format!(
                r#"<w:fldSimple{}w:instr="{}"{}>"#,
                captures.get(1).map(|value| value.as_str()).unwrap_or(" "),
                escape_xml_text(&instruction),
                captures.get(3).map(|value| value.as_str()).unwrap_or("")
            )
        })
        .to_string();

    let instr_text = Regex::new(r#"(?s)<w:instrText\b([^>]*)>\s*TOC\b.*?</w:instrText>"#)
        .expect("valid TOC instrText regex");
    instr_text
        .replace_all(&xml, |captures: &Captures| {
            format!(
                r#"<w:instrText{}>{}</w:instrText>"#,
                captures.get(1).map(|value| value.as_str()).unwrap_or(""),
                escape_xml_text(&instruction)
            )
        })
        .to_string()
}

fn toc_field_instruction(page_settings: &PageSettingsConfig) -> String {
    let depth = parse_toc_depth(&page_settings.toc_depth).unwrap_or(3);
    let mut instruction = format!(r#"TOC \o "1-{depth}" \h \z \u"#);
    if !page_settings.toc_show_page_numbers {
        instruction.push_str(&format!(r#" \n "1-{depth}""#));
    } else {
        match page_settings.toc_leader.trim() {
            "space" => instruction.push_str(r#" \p " ""#),
            "cjk-dot" => instruction.push_str(r#" \p "…………""#),
            "dot-spaced" => instruction.push_str(r#" \p "· · ·""#),
            "dash" => instruction.push_str(r#" \p " - ""#),
            "line" => instruction.push_str(r#" \p " ___ ""#),
            _ => {}
        }
    }
    instruction
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
    let header_footer_re =
        Regex::new(r#"(?s)<w:(?:headerReference|footerReference|pgNumType)\b[^>]*/>"#)
            .expect("valid header footer section regex");
    let body = page_size_re.replace_all(body, "");
    let body = page_margins_re.replace_all(&body, "");
    let body = header_footer_re.replace_all(&body, "");
    let header_footer_refs = section_header_footer_references_xml(page_settings);

    format!("{start}{header_footer_refs}{page_size}{page_margins}{body}{end}")
}

fn page_settings_has_header_footer(page_settings: &PageSettingsConfig) -> bool {
    page_settings_has_header(page_settings) || page_settings_has_footer(page_settings)
}

fn page_settings_has_header(page_settings: &PageSettingsConfig) -> bool {
    page_settings.header_enabled && !page_settings.header_text.trim().is_empty()
}

fn page_settings_has_footer(page_settings: &PageSettingsConfig) -> bool {
    page_settings.footer_enabled
        && (!page_settings.footer_text.trim().is_empty()
            || page_settings.footer_page_number_format.trim() != "none")
}

fn section_header_footer_references_xml(page_settings: &PageSettingsConfig) -> String {
    let mut xml = String::new();
    if page_settings_has_header(page_settings) {
        xml.push_str(r#"<w:headerReference w:type="default" r:id="rIdMdKingHeader" />"#);
    }
    if page_settings_has_footer(page_settings) {
        xml.push_str(r#"<w:footerReference w:type="default" r:id="rIdMdKingFooter" />"#);
    }
    if page_settings_has_footer(page_settings)
        || (page_settings.toc_enabled && page_settings.toc_show_page_numbers)
    {
        xml.push_str(&format!(
            r#"<w:pgNumType w:start="{}" />"#,
            page_settings.footer_start_page.max(1)
        ));
    }
    xml
}

fn ensure_header_footer_content_types_xml(xml: &str, page_settings: &PageSettingsConfig) -> String {
    let mut output = xml.to_string();
    if page_settings_has_header(page_settings) && !output.contains("/word/header-mdking.xml") {
        output = output.replace(
            "</Types>",
            r#"<Override PartName="/word/header-mdking.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" /></Types>"#,
        );
    }
    if page_settings_has_footer(page_settings) && !output.contains("/word/footer-mdking.xml") {
        output = output.replace(
            "</Types>",
            r#"<Override PartName="/word/footer-mdking.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" /></Types>"#,
        );
    }
    output
}

fn create_header_footer_content_types_xml(page_settings: &PageSettingsConfig) -> String {
    let mut xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="xml" ContentType="application/xml" />"#.to_string();
    if page_settings_has_header(page_settings) {
        xml.push_str(r#"<Override PartName="/word/header-mdking.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" />"#);
    }
    if page_settings_has_footer(page_settings) {
        xml.push_str(r#"<Override PartName="/word/footer-mdking.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" />"#);
    }
    xml.push_str("</Types>");
    xml
}

fn ensure_header_footer_relationships_xml(xml: &str, page_settings: &PageSettingsConfig) -> String {
    let mut output = xml.to_string();
    if page_settings_has_header(page_settings)
        && !output.contains(r#"Id="rIdMdKingHeader""#)
        && !output.contains(r#"Target="header-mdking.xml""#)
    {
        output = output.replace(
            "</Relationships>",
            r#"<Relationship Id="rIdMdKingHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-mdking.xml" /></Relationships>"#,
        );
    }
    if page_settings_has_footer(page_settings)
        && !output.contains(r#"Id="rIdMdKingFooter""#)
        && !output.contains(r#"Target="footer-mdking.xml""#)
    {
        output = output.replace(
            "</Relationships>",
            r#"<Relationship Id="rIdMdKingFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer-mdking.xml" /></Relationships>"#,
        );
    }
    output
}

fn create_header_footer_relationships_xml(page_settings: &PageSettingsConfig) -> String {
    let mut xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#.to_string();
    if page_settings_has_header(page_settings) {
        xml.push_str(r#"<Relationship Id="rIdMdKingHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-mdking.xml" />"#);
    }
    if page_settings_has_footer(page_settings) {
        xml.push_str(r#"<Relationship Id="rIdMdKingFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer-mdking.xml" />"#);
    }
    xml.push_str("</Relationships>");
    xml
}

fn create_header_xml(page_settings: &PageSettingsConfig) -> String {
    let text = escape_xml_text(&page_settings.header_text);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center" /></w:pPr><w:r><w:rPr><w:color w:val="64748B" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:t>{text}</w:t></w:r></w:p></w:hdr>"#
    )
}

fn create_footer_xml(page_settings: &PageSettingsConfig) -> String {
    let text = page_settings.footer_text.trim();
    let text_xml = if text.is_empty() {
        String::new()
    } else {
        format!(
            r#"<w:r><w:rPr>{}</w:rPr><w:t>{}</w:t></w:r>"#,
            footer_run_style_xml(),
            escape_xml_text(text)
        )
    };
    let separator_xml =
        if !text_xml.is_empty() && page_settings.footer_page_number_format.trim() != "none" {
            format!(
                r#"<w:r><w:rPr>{}</w:rPr><w:t> · </w:t></w:r>"#,
                footer_run_style_xml()
            )
        } else {
            String::new()
        };
    let page_number_xml = footer_page_number_xml(&page_settings.footer_page_number_format);

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center" /></w:pPr>{text_xml}{separator_xml}{page_number_xml}</w:p></w:ftr>"#
    )
}

fn footer_page_number_xml(format: &str) -> String {
    match format.trim() {
        "none" => String::new(),
        "plain" | "plain-total" => page_field_xml(),
        "dash" => format!(
            r#"<w:r><w:rPr>{style}</w:rPr><w:t>- </w:t></w:r>{page}<w:r><w:rPr>{style}</w:rPr><w:t> -</w:t></w:r>"#,
            style = footer_run_style_xml(),
            page = page_field_xml()
        ),
        "page-total" => format!(
            r#"<w:r><w:rPr>{style}</w:rPr><w:t>第 </w:t></w:r>{page}<w:r><w:rPr>{style}</w:rPr><w:t> 页</w:t></w:r>"#,
            style = footer_run_style_xml(),
            page = page_field_xml()
        ),
        _ => format!(
            r#"<w:r><w:rPr>{style}</w:rPr><w:t>第 </w:t></w:r>{page}<w:r><w:rPr>{style}</w:rPr><w:t> 页</w:t></w:r>"#,
            style = footer_run_style_xml(),
            page = page_field_xml()
        ),
    }
}

fn page_field_xml() -> String {
    field_xml("PAGE")
}

fn field_xml(instruction: &str) -> String {
    format!(
        r#"<w:r><w:rPr>{style}</w:rPr><w:fldChar w:fldCharType="begin" /></w:r><w:r><w:rPr>{style}</w:rPr><w:instrText xml:space="preserve"> {instruction} </w:instrText></w:r><w:r><w:rPr>{style}</w:rPr><w:fldChar w:fldCharType="separate" /></w:r><w:r><w:rPr>{style}</w:rPr><w:t>1</w:t></w:r><w:r><w:rPr>{style}</w:rPr><w:fldChar w:fldCharType="end" /></w:r>"#,
        style = footer_run_style_xml(),
        instruction = instruction
    )
}

fn footer_run_style_xml() -> &'static str {
    r#"<w:color w:val="000000" /><w:sz w:val="18" /><w:szCs w:val="18" />"#
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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

#[cfg(test)]
fn normalize_default_report_styles_xml(
    xml: &str,
    markdown_features: &MarkdownFeatureConfig,
) -> String {
    normalize_template_styles_xml(xml, markdown_features, None, true)
}

fn normalize_template_styles_xml(
    xml: &str,
    markdown_features: &MarkdownFeatureConfig,
    document_style: Option<&DocumentStyleConfig>,
    apply_default_template_style: bool,
) -> String {
    let style = Regex::new(r#"(?s)<w:style\b.*?</w:style>"#).expect("valid style regex");
    style
        .replace_all(xml, |captures: &Captures| {
            normalize_template_style_xml(
                &captures[0],
                markdown_features,
                document_style,
                apply_default_template_style,
            )
        })
        .to_string()
}

fn normalize_template_style_xml(
    style_xml: &str,
    markdown_features: &MarkdownFeatureConfig,
    document_style: Option<&DocumentStyleConfig>,
    apply_default_template_style: bool,
) -> String {
    if let Some(template_style_id) =
        capture_style_id(style_xml).and_then(|style_id| template_style_id_for_word_style(&style_id))
    {
        if let Some(style) = document_style.and_then(|config| config.styles.get(template_style_id))
        {
            return normalize_text_style_xml(style_xml, style);
        }
    }

    // 用户没保存过样式时，标题仍要对齐前端展示的默认值。
    if let Some(style_id) = capture_style_id(style_xml) {
        if let Some((align, half_points)) = default_heading_style_overrides(&style_id) {
            return apply_default_heading_style(style_xml, align, half_points);
        }
    }

    if apply_default_template_style {
        return normalize_default_report_style_xml(style_xml, markdown_features);
    }

    style_xml.to_string()
}

fn template_style_id_for_word_style(style_id: &str) -> Option<&'static str> {
    match style_id {
        "Title" => Some("title"),
        "Heading1" => Some("heading-1"),
        "Heading2" => Some("heading-2"),
        "Heading3" => Some("heading-3"),
        "Heading4" => Some("heading-4"),
        "Heading5" => Some("heading-5"),
        "Heading6" => Some("heading-6"),
        "Normal" | "FirstParagraph" => Some("normal"),
        "BodyText" => Some("body-text"),
        "ImageCaption" => Some("caption"),
        "Caption" | "TableCaption" => Some("table-caption"),
        "ListParagraph" | "BulletList" => Some("bullet-list"),
        "NumberedList" => Some("numbered-list"),
        _ => None,
    }
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

/// 内置模板在「用户从未保存过样式配置」时的标题默认值。
///
/// 这些值必须和前端 createDefaultStyleDraft 保持一致。不补这一层的话，
/// reference.docx 里的原始定义会直接生效——那份文件里 Heading1 是
/// jc=center、sz=40，而模板界面上「一级标题」显示的是左对齐 22pt，
/// 用户改都没改就已经不一致了。
///
/// 只纠正对齐和字号两项，其余（keepNext、spacing、outlineLvl、字体、颜色）
/// 保留 reference.docx 的定义——整段替换 pPr 会把大纲级别一起丢掉，
/// 那会让 Word 的导航窗格失效。
fn default_heading_style_overrides(style_id: &str) -> Option<(&'static str, u32)> {
    match style_id {
        // (对齐, 字号的 half-point 值)
        "Heading1" => Some(("left", 44)),
        "Heading2" => Some(("left", 36)),
        "Heading3" => Some(("left", 32)),
        "Heading4" => Some(("left", 30)),
        "Heading5" => Some(("left", 28)),
        "Heading6" => Some(("left", 24)),
        _ => None,
    }
}

/// 把标题样式的对齐与字号纠正到前端默认值。
fn apply_default_heading_style(style_xml: &str, align: &str, half_points: u32) -> String {
    // 两种写法都要吃下：自闭合的 <w:pPr ... /> 和成对的 <w:pPr ...>...</w:pPr>。
    // 写成一个 [^>]*(?:/>|>...) 的形式在无属性的 <w:pPr> 上会失配。
    let paragraph_re = Regex::new(r#"(?s)<w:pPr\b[^>]*/>|<w:pPr\b[^>]*>.*?</w:pPr>"#)
        .expect("valid style paragraph regex");
    let aligned = if let Some(found) = paragraph_re.find(style_xml) {
        let replaced = align_paragraph_properties(found.as_str(), align);
        format!("{}{}{}", &style_xml[..found.start()], replaced, &style_xml[found.end()..])
    } else {
        style_xml.replace(
            "</w:style>",
            &format!(r#"<w:pPr><w:jc w:val="{align}" /></w:pPr></w:style>"#),
        )
    };

    // sz 和 szCs 要一起改：只改 sz 会让 Word 里的西文与中文字号不一致。
    let sz_re = Regex::new(r#"<w:sz w:val="\d+" />"#).expect("valid size regex");
    let sz_cs_re = Regex::new(r#"<w:szCs w:val="\d+" />"#).expect("valid complex size regex");
    let with_size = sz_re.replace(&aligned, format!(r#"<w:sz w:val="{half_points}" />"#).as_str());
    sz_cs_re
        .replace(&with_size, format!(r#"<w:szCs w:val="{half_points}" />"#).as_str())
        .to_string()
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

fn normalize_text_style_xml(style_xml: &str, style: &TextStyleConfig) -> String {
    let style_xml = ensure_style_paragraph_properties_xml(
        style_xml,
        &text_style_paragraph_properties_xml(style),
    );
    ensure_style_run_properties(&style_xml, &text_style_run_properties_xml(style))
}

fn ensure_style_paragraph_properties(style_xml: &str, first_line_indent: bool) -> String {
    let indent = if first_line_indent {
        r#"<w:ind w:firstLine="480" />"#
    } else {
        r#"<w:ind w:firstLine="0" />"#
    };
    let properties = format!(
        r#"<w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" /><w:jc w:val="both" />{indent}</w:pPr>"#
    );

    ensure_style_paragraph_properties_xml(style_xml, &properties)
}

fn ensure_style_paragraph_properties_xml(style_xml: &str, properties: &str) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid style paragraph regex");

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

fn text_style_paragraph_properties_xml(style: &TextStyleConfig) -> String {
    let before = points_to_twentieths(style.before_spacing);
    let after = points_to_twentieths(style.after_spacing);
    let line = line_height_twips(style.font_size, style.line_height);
    let align = word_alignment_value(&style.align);

    if style.is_list {
        let level_style = list_level_style(style, 0);
        let before = points_to_twentieths(level_style.before_spacing);
        let after = points_to_twentieths(level_style.after_spacing);
        let line = line_height_twips(level_style.font_size, level_style.line_height);
        let align = word_alignment_value(&level_style.align);
        let indent = list_indent_xml(style);
        return format!(
            r#"<w:pPr><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto" /><w:jc w:val="{align}" />{indent}</w:pPr>"#
        );
    }

    let first_line = (style.first_line_indent * 240.0).round().clamp(0.0, 2000.0) as u32;

    format!(
        r#"<w:pPr><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto" /><w:jc w:val="{align}" /><w:ind w:firstLine="{first_line}" /></w:pPr>"#
    )
}

fn list_indent_xml(style: &TextStyleConfig) -> String {
    list_indent_xml_for_level(style, 0)
}

fn list_level_style(style: &TextStyleConfig, level: usize) -> &ListLevelStyleConfig {
    &style.list_level_styles[list_level_index(level)]
}

fn list_indent_xml_for_level(style: &TextStyleConfig, level: usize) -> String {
    list_indent_xml_for_marker(style, level, "•")
}

fn list_indent_xml_for_marker(style: &TextStyleConfig, level: usize, marker: &str) -> String {
    let level_style = list_level_style(style, level);
    let marker_left = (level_style.indent * 240.0).round().clamp(0.0, 4000.0) as u32;

    if level_style.wrap_mode == "flat" {
        format!(r#"<w:ind w:left="{marker_left}" w:firstLine="0" />"#)
    } else {
        let hanging = list_marker_and_gap_twips(marker, level_style.text_indent);
        let text_left = marker_left.saturating_add(hanging).min(6000);
        format!(r#"<w:ind w:left="{text_left}" w:hanging="{hanging}" />"#)
    }
}

fn list_marker_and_gap_twips(marker: &str, gap_in_english_chars: f64) -> u32 {
    let marker_width = marker
        .chars()
        .map(|character| if character.is_ascii() { 120 } else { 240 })
        .sum::<u32>();
    let gap = (gap_in_english_chars * 120.0).round().clamp(0.0, 1200.0) as u32;
    marker_width.saturating_add(gap)
}

fn text_style_run_properties_xml(style: &TextStyleConfig) -> String {
    if style.is_list {
        return list_level_run_properties_xml(style, 0);
    }

    let size = font_size_half_points(style.font_size);
    let bold = bool_val(style.bold);
    format!(
        r#"<w:rFonts w:ascii="{}" w:hAnsi="{}" w:eastAsia="{}" /><w:color w:val="{}" /><w:sz w:val="{size}" /><w:szCs w:val="{size}" /><w:b w:val="{bold}" /><w:bCs w:val="{bold}" />"#,
        style.latin_font, style.latin_font, style.chinese_font, style.color
    )
}

fn list_level_run_properties_xml(style: &TextStyleConfig, level: usize) -> String {
    let level_style = list_level_style(style, level);
    let size = font_size_half_points(level_style.font_size);
    let bold = bool_val(level_style.bold);
    format!(
        r#"<w:rFonts w:ascii="{}" w:hAnsi="{}" w:eastAsia="{}" /><w:color w:val="{}" /><w:sz w:val="{size}" /><w:szCs w:val="{size}" /><w:b w:val="{bold}" /><w:bCs w:val="{bold}" />"#,
        level_style.latin_font, level_style.latin_font, level_style.chinese_font, level_style.color
    )
}

fn word_alignment_value(value: &str) -> &'static str {
    match value.trim() {
        "center" => "center",
        "right" => "right",
        "justify" => "both",
        _ => "left",
    }
}

fn remove_horizontal_rule_paragraphs(xml: &str) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#).expect("valid paragraph regex");
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
}

fn normalize_horizontal_rule_paragraphs(
    xml: &str,
    style: Option<&HorizontalRuleStyleConfig>,
) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#).expect("valid paragraph regex");
    paragraph
        .replace_all(xml, |captures: &Captures| {
            let paragraph_xml = &captures[0];
            if !is_horizontal_rule_paragraph(paragraph_xml) {
                return paragraph_xml.to_string();
            }

            let fallback = HorizontalRuleStyleConfig {
                border_style: "solid".to_string(),
                border_color: "CBD5E1".to_string(),
                border_width: 1.0,
                before_spacing: 12.0,
                after_spacing: 12.0,
            };
            normalize_horizontal_rule_paragraph_xml(paragraph_xml, style.unwrap_or(&fallback))
        })
        .to_string()
}

fn normalize_horizontal_rule_paragraph_xml(
    paragraph_xml: &str,
    style: &HorizontalRuleStyleConfig,
) -> String {
    let paragraph_start = Regex::new(r#"^<w:p\b[^>]*>"#).expect("valid paragraph start regex");
    let start = paragraph_start
        .find(paragraph_xml)
        .map(|matched| matched.as_str())
        .unwrap_or("<w:p>");
    let before = points_to_twentieths(style.before_spacing);
    let after = points_to_twentieths(style.after_spacing);
    let border = border_xml_with_space(
        &style.border_style,
        style.border_width,
        &style.border_color,
        1,
    );
    format!(
        r#"{start}<w:pPr><w:pStyle w:val="HorizontalRule" /><w:spacing w:before="{before}" w:after="{after}" /><w:pBdr><w:bottom {border} /></w:pBdr></w:pPr></w:p>"#
    )
}

fn normalize_inline_code_style_xml(style_xml: &str) -> String {
    ensure_style_run_properties(style_xml, inline_code_run_properties_xml())
}

fn inline_code_run_properties_xml() -> &'static str {
    r#"<w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei UI" w:hAnsi="Consolas" w:cs="Consolas" /><w:noProof /><w:color w:val="111827" /><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9" /><w:sz w:val="21" /><w:szCs w:val="21" /><w:b w:val="0" /><w:bCs w:val="0" /><w:i w:val="0" /><w:iCs w:val="0" />"#
}

fn normalize_inline_code_runs(xml: &str, style: Option<&InlineCodeStyleConfig>) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(xml, |captures: &Captures| {
        let run_xml = &captures[0];
        if run_xml.contains(r#"<w:rStyle w:val="VerbatimChar""#) {
            normalize_inline_code_run_xml(run_xml, style)
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

fn normalize_inline_code_run_xml(run_xml: &str, style: Option<&InlineCodeStyleConfig>) -> String {
    let properties = style
        .map(inline_code_run_properties_from_style)
        .unwrap_or_else(|| inline_code_run_properties_xml().to_string());
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

    insert_run_properties(run_xml, &properties)
}

fn extract_code_language_marker(paragraph_xml: &str) -> Option<String> {
    let text = paragraph_plain_text(paragraph_xml);
    text.trim()
        .strip_prefix(CODE_LANGUAGE_MARKER_PREFIX)
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .map(ToString::to_string)
}

fn paragraph_plain_text(paragraph_xml: &str) -> String {
    Regex::new(r#"(?s)<w:t(?:\s+[^>]*)?>(.*?)</w:t>"#)
        .expect("valid paragraph text regex")
        .captures_iter(paragraph_xml)
        .filter_map(|captures| captures.get(1))
        .map(|value| decode_basic_xml_entities(value.as_str()))
        .collect::<Vec<_>>()
        .join("")
}

fn decode_basic_xml_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn mark_task_list_paragraphs(
    xml: &str,
    task_list_markers: &HashMap<String, TaskListMarker>,
) -> String {
    if task_list_markers.is_empty() {
        return xml.to_string();
    }

    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    paragraph
        .replace_all(xml, |captures: &Captures| {
            mark_task_list_paragraph(&captures[0], task_list_markers)
        })
        .to_string()
}

fn mark_task_list_paragraph(
    paragraph_xml: &str,
    task_list_markers: &HashMap<String, TaskListMarker>,
) -> String {
    let Some(num_id) = capture_list_num_id(paragraph_xml) else {
        return paragraph_xml.to_string();
    };
    let Some(marker) = task_list_markers.get(&num_id).copied() else {
        return paragraph_xml.to_string();
    };
    if paragraph_plain_text(paragraph_xml)
        .trim_start()
        .starts_with(TASK_LIST_MARKER_PREFIX)
    {
        return paragraph_xml.to_string();
    }

    prefix_first_text_run(paragraph_xml, task_list_marker_prefix(marker))
}

fn task_list_marker_prefix(marker: TaskListMarker) -> &'static str {
    match marker {
        TaskListMarker::Checked => "MD_KING_TASK_LIST:checked:",
        TaskListMarker::Unchecked => "MD_KING_TASK_LIST:unchecked:",
    }
}

fn extract_task_list_marker(paragraph_xml: &str) -> Option<TaskListMarker> {
    let text = paragraph_plain_text(paragraph_xml);
    let trimmed = text.trim_start();
    if trimmed.starts_with("MD_KING_TASK_LIST:checked:") {
        Some(TaskListMarker::Checked)
    } else if trimmed.starts_with("MD_KING_TASK_LIST:unchecked:") {
        Some(TaskListMarker::Unchecked)
    } else {
        None
    }
}

fn strip_task_list_marker(paragraph_xml: &str) -> String {
    let text = Regex::new(r#"(<w:t(?:\s+[^>]*)?>)([^<]*)(</w:t>)"#).expect("valid text regex");
    text.replace(paragraph_xml, |captures: &Captures| {
        let stripped = captures[2]
            .replacen("MD_KING_TASK_LIST:checked:", "", 1)
            .replacen("MD_KING_TASK_LIST:unchecked:", "", 1);
        format!("{}{}{}", &captures[1], stripped, &captures[3])
    })
    .to_string()
}

fn task_list_marker_text(marker: TaskListMarker) -> &'static str {
    match marker {
        TaskListMarker::Checked => "☑",
        TaskListMarker::Unchecked => "☐",
    }
}

fn code_language_label_paragraph(language: &str, style: Option<&CodeBlockStyleConfig>) -> String {
    let label = escape_xml_text(&code_language_display_name(language));
    let properties = code_language_label_paragraph_properties_xml(style);
    let run_properties = code_language_label_run_properties_xml(style);

    format!(
        r#"<w:p><w:pPr>{properties}</w:pPr><w:r><w:rPr>{run_properties}</w:rPr><w:t>{label}</w:t></w:r></w:p>"#
    )
}

fn code_language_display_name(language: &str) -> String {
    match language.trim().to_ascii_lowercase().as_str() {
        "js" | "javascript" => "JavaScript".to_string(),
        "ts" | "typescript" => "TypeScript".to_string(),
        "tsx" => "TSX".to_string(),
        "jsx" => "JSX".to_string(),
        "py" | "python" => "Python".to_string(),
        "rs" | "rust" => "Rust".to_string(),
        "sh" | "bash" | "shell" => "Shell".to_string(),
        "ps1" | "powershell" => "PowerShell".to_string(),
        "csharp" | "c#" => "C#".to_string(),
        "cpp" | "c++" => "C++".to_string(),
        "html" => "HTML".to_string(),
        "css" => "CSS".to_string(),
        "json" => "JSON".to_string(),
        "yaml" | "yml" => "YAML".to_string(),
        "sql" => "SQL".to_string(),
        "java" => "Java".to_string(),
        "go" | "golang" => "Go".to_string(),
        value if value.is_empty() => "Code".to_string(),
        _ => language.to_string(),
    }
}

fn code_language_label_paragraph_properties_xml(style: Option<&CodeBlockStyleConfig>) -> String {
    let background = style
        .map(|value| value.background_color.as_str())
        .unwrap_or("F8FAFC");
    let border_color = style
        .map(|value| value.border_color.as_str())
        .unwrap_or("E2E8F0");
    let horizontal_padding =
        points_to_twentieths(style.map(|value| value.padding_x).unwrap_or(18.0));
    let border_space = (style.map(|value| value.padding_y).unwrap_or(10.0) / 2.0)
        .round()
        .clamp(0.0, 24.0) as u32;
    let border = border_xml_with_space("solid", 0.75, border_color, border_space);

    let shading = paragraph_shading_xml(background);
    format!(
        r#"<w:spacing w:before="120" w:after="0" w:line="220" w:lineRule="auto" /><w:jc w:val="right" /><w:ind w:left="{horizontal_padding}" w:right="{horizontal_padding}" w:firstLine="0" />{shading}<w:pBdr><w:top {border} /><w:left {border} /><w:right {border} /></w:pBdr>"#
    )
}

fn code_language_label_run_properties_xml(style: Option<&CodeBlockStyleConfig>) -> String {
    let latin_font = style
        .map(|value| value.latin_font.as_str())
        .unwrap_or("Consolas");
    let chinese_font = style
        .map(|value| value.chinese_font.as_str())
        .unwrap_or("Microsoft YaHei UI");
    let color = if is_dark_hex_color(
        style
            .map(|value| value.background_color.as_str())
            .unwrap_or("F8FAFC"),
    ) {
        "CBD5E1"
    } else {
        "64748B"
    };

    format!(
        r#"<w:rFonts w:ascii="{latin_font}" w:eastAsia="{chinese_font}" w:hAnsi="{latin_font}" w:cs="{latin_font}" /><w:noProof /><w:color w:val="{color}" /><w:b w:val="1" /><w:bCs w:val="1" /><w:sz w:val="16" /><w:szCs w:val="16" />"#
    )
}

fn normalize_code_and_quote_blocks(
    xml: &str,
    markdown_features: &MarkdownFeatureConfig,
    block_style: Option<&BlockStyleConfig>,
) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    let mut in_quote_list = false;
    let mut pending_code_language_label = false;
    paragraph
        .replace_all(xml, |captures: &Captures| {
            normalize_code_or_quote_paragraph(
                &captures[0],
                &mut in_quote_list,
                &mut pending_code_language_label,
                markdown_features,
                block_style,
            )
        })
        .to_string()
}

fn normalize_code_or_quote_paragraph(
    paragraph_xml: &str,
    in_quote_list: &mut bool,
    pending_code_language_label: &mut bool,
    markdown_features: &MarkdownFeatureConfig,
    block_style: Option<&BlockStyleConfig>,
) -> String {
    if let Some(language) = extract_code_language_marker(paragraph_xml) {
        *in_quote_list = false;
        *pending_code_language_label = markdown_features.code_block;
        return if markdown_features.code_block {
            code_language_label_paragraph(&language, block_style.map(|style| &style.code))
        } else {
            String::new()
        };
    }

    match capture_paragraph_style_id(paragraph_xml).as_deref() {
        Some("SourceCode") if markdown_features.code_block => {
            *in_quote_list = false;
            let connects_to_label = *pending_code_language_label;
            *pending_code_language_label = false;
            normalize_source_code_paragraph(
                paragraph_xml,
                block_style.map(|style| &style.code),
                connects_to_label,
            )
        }
        Some("SourceCode") => {
            *in_quote_list = false;
            *pending_code_language_label = false;
            flatten_special_block_paragraph(paragraph_xml, false)
        }
        Some("BlockText") if markdown_features.quote_block => {
            *in_quote_list = true;
            *pending_code_language_label = false;
            normalize_quote_paragraph(paragraph_xml, block_style.map(|style| &style.quote))
        }
        Some("BlockText") => {
            *in_quote_list = false;
            *pending_code_language_label = false;
            flatten_special_block_paragraph(paragraph_xml, true)
        }
        _ if markdown_features.quote_block
            && *in_quote_list
            && has_list_numbering(paragraph_xml) =>
        {
            *pending_code_language_label = false;
            normalize_quote_list_paragraph(paragraph_xml, block_style.map(|style| &style.quote))
        }
        _ => {
            *in_quote_list = false;
            *pending_code_language_label = false;
            paragraph_xml.to_string()
        }
    }
}

fn flatten_special_block_paragraph(paragraph_xml: &str, preserve_emphasis: bool) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let properties = r#"<w:pPr><w:pStyle w:val="Normal" /></w:pPr>"#;

    let paragraph_xml = if paragraph_properties.is_match(paragraph_xml) {
        paragraph_properties
            .replace(paragraph_xml, properties)
            .to_string()
    } else {
        paragraph_xml.replace("<w:p>", &format!("<w:p>{properties}"))
    };

    flatten_special_block_runs(&paragraph_xml, preserve_emphasis)
}

fn flatten_special_block_runs(paragraph_xml: &str, preserve_emphasis: bool) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        flatten_special_text_run_xml(&captures[0], preserve_emphasis)
    })
    .to_string()
}

fn flatten_special_text_run_xml(run_xml: &str, preserve_emphasis: bool) -> String {
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");
    if !run_properties.is_match(run_xml) {
        return run_xml.to_string();
    }

    run_properties
        .replace(run_xml, |captures: &Captures| {
            let removable_pattern = if preserve_emphasis {
                r#"(?s)<w:rStyle\b[^>]*/>|<w:shd\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs)\b[^>]*/>"#
            } else {
                r#"(?s)<w:rStyle\b[^>]*/>|<w:shd\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#
            };
            let removable = Regex::new(removable_pattern)
            .expect("valid special block run flatten regex");
            let inner = removable.replace_all(&captures[1], "");
            format!("<w:rPr>{inner}</w:rPr>")
        })
        .to_string()
}

fn normalize_source_code_paragraph(
    paragraph_xml: &str,
    style: Option<&CodeBlockStyleConfig>,
    connects_to_label: bool,
) -> String {
    let paragraph_xml = ensure_code_paragraph_properties(paragraph_xml, style, connects_to_label);
    normalize_code_runs(&paragraph_xml, style)
}

fn ensure_code_paragraph_properties(
    paragraph_xml: &str,
    style: Option<&CodeBlockStyleConfig>,
    omit_top_border: bool,
) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let properties = code_paragraph_properties_xml(style, !omit_top_border);
    if paragraph_properties.is_match(paragraph_xml) {
        return paragraph_properties
            .replace(paragraph_xml, |captures: &Captures| {
                let removable =
                    Regex::new(r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#)
                        .expect("valid code paragraph cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!(r#"<w:pPr>{inner}{properties}</w:pPr>"#)
            })
            .to_string();
    }

    insert_paragraph_properties(paragraph_xml, &properties)
}

fn normalize_code_runs(paragraph_xml: &str, style: Option<&CodeBlockStyleConfig>) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        normalize_code_run_xml(&captures[0], style)
    })
    .to_string()
}

fn normalize_code_run_xml(run_xml: &str, style: Option<&CodeBlockStyleConfig>) -> String {
    let token_style = syntax_token_run_style(run_xml);
    let has_token_style = token_style.is_some();
    let properties = code_run_properties_xml(style, token_style.as_deref());
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable = if has_token_style {
                    Regex::new(r#"<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#)
                        .expect("valid syntax highlighted code run cleanup regex")
                } else {
                    Regex::new(
                        r#"<w:rStyle\b[^>]*/>|<w:(?:rFonts|noProof|color|sz|szCs|b|bCs|i|iCs)\b[^>]*/>"#,
                    )
                    .expect("valid code run cleanup regex")
                };
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{properties}{inner}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, &properties)
}

fn syntax_token_run_style(run_xml: &str) -> Option<String> {
    Regex::new(r#"<w:rStyle\s+w:val="[^"]*Tok"\s*/>"#)
        .expect("valid syntax token run style regex")
        .captures(run_xml)
        .and_then(|captures| captures.get(0))
        .and_then(|style_xml| {
            Regex::new(r#"w:val="([^"]+)""#)
                .expect("valid syntax token style value regex")
                .captures(style_xml.as_str())
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().to_string())
        })
}

fn normalize_quote_paragraph(paragraph_xml: &str, style: Option<&QuoteBlockStyleConfig>) -> String {
    let paragraph_xml = ensure_quote_paragraph_properties(paragraph_xml, style);
    normalize_quote_runs(&paragraph_xml, style)
}

fn normalize_quote_list_paragraph(
    paragraph_xml: &str,
    style: Option<&QuoteBlockStyleConfig>,
) -> String {
    let paragraph_xml = ensure_quote_list_paragraph_properties(paragraph_xml, style);
    normalize_quote_runs(&paragraph_xml, style)
}

fn ensure_quote_paragraph_properties(
    paragraph_xml: &str,
    style: Option<&QuoteBlockStyleConfig>,
) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let properties = quote_paragraph_properties_xml(style, false);
    if paragraph_properties.is_match(paragraph_xml) {
        return paragraph_properties
            .replace(paragraph_xml, |captures: &Captures| {
                let removable =
                    Regex::new(r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#)
                        .expect("valid quote paragraph cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!(r#"<w:pPr>{inner}{properties}</w:pPr>"#)
            })
            .to_string();
    }

    insert_paragraph_properties(paragraph_xml, &properties)
}

fn ensure_quote_list_paragraph_properties(
    paragraph_xml: &str,
    style: Option<&QuoteBlockStyleConfig>,
) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let properties = quote_paragraph_properties_xml(style, true);
    if paragraph_properties.is_match(paragraph_xml) {
        return paragraph_properties
            .replace(paragraph_xml, |captures: &Captures| {
                let removable =
                    Regex::new(r#"(?s)<w:pBdr>.*?</w:pBdr>|<w:(?:shd|spacing|ind|jc)\b[^>]*/>"#)
                        .expect("valid quote list paragraph cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!(r#"<w:pPr>{inner}{properties}</w:pPr>"#)
            })
            .to_string();
    }

    insert_paragraph_properties(paragraph_xml, &properties)
}

fn normalize_quote_runs(paragraph_xml: &str, style: Option<&QuoteBlockStyleConfig>) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        normalize_quote_run_xml(&captures[0], style)
    })
    .to_string()
}

fn normalize_quote_run_xml(run_xml: &str, style: Option<&QuoteBlockStyleConfig>) -> String {
    let properties = quote_run_properties_xml(style);
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>(.*?)</w:rPr>"#).expect("valid run property regex");

    if run_properties.is_match(run_xml) {
        return run_properties
            .replace(run_xml, |captures: &Captures| {
                let removable = Regex::new(r#"<w:(?:rFonts|color|b|bCs|sz|szCs|i|iCs)\b[^>]*/>"#)
                    .expect("valid quote run cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:rPr>{properties}{inner}</w:rPr>")
            })
            .to_string();
    }

    insert_run_properties(run_xml, &properties)
}

fn code_paragraph_properties_xml(
    style: Option<&CodeBlockStyleConfig>,
    include_top_border: bool,
) -> String {
    let background = style
        .map(|value| value.background_color.as_str())
        .unwrap_or("F8FAFC");
    let border_color = style
        .map(|value| value.border_color.as_str())
        .unwrap_or("E2E8F0");
    let line = style
        .map(|value| line_height_twips(value.font_size, value.line_height))
        .unwrap_or(300);
    let before = if include_top_border {
        points_to_twentieths(style.map(|value| value.before_spacing).unwrap_or(6.0))
    } else {
        0
    };
    let after = points_to_twentieths(style.map(|value| value.after_spacing).unwrap_or(6.0));
    let horizontal_padding =
        points_to_twentieths(style.map(|value| value.padding_x).unwrap_or(18.0));
    let border_space = (style.map(|value| value.padding_y).unwrap_or(10.0) / 2.0)
        .round()
        .clamp(0.0, 24.0) as u32;
    let border = border_xml_with_space("solid", 0.75, border_color, border_space);
    let top_border = if include_top_border {
        format!(r#"<w:top {border} />"#)
    } else {
        String::new()
    };

    let shading = paragraph_shading_xml(background);
    format!(
        r#"<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto" /><w:ind w:left="{horizontal_padding}" w:right="{horizontal_padding}" w:firstLine="0" />{shading}<w:pBdr>{top_border}<w:left {border} /><w:bottom {border} /><w:right {border} /></w:pBdr>"#
    )
}

fn code_run_properties_xml(
    style: Option<&CodeBlockStyleConfig>,
    token_style: Option<&str>,
) -> String {
    let latin_font = style
        .map(|value| value.latin_font.as_str())
        .unwrap_or("Consolas");
    let chinese_font = style
        .map(|value| value.chinese_font.as_str())
        .unwrap_or("Microsoft YaHei UI");
    let color = style.map(|value| value.color.as_str()).unwrap_or("111827");
    let size = font_size_half_points(style.map(|value| value.font_size).unwrap_or(9.0));
    let bold = bool_val(style.is_some_and(|value| value.bold));
    let color_xml = if let Some(token_style) = token_style {
        format!(
            r#"<w:color w:val="{}" />"#,
            syntax_token_color(token_style, style)
        )
    } else {
        format!(r#"<w:color w:val="{color}" />"#)
    };

    format!(
        r#"<w:rFonts w:ascii="{latin_font}" w:eastAsia="{chinese_font}" w:hAnsi="{latin_font}" w:cs="{latin_font}" /><w:noProof />{color_xml}<w:b w:val="{bold}" /><w:bCs w:val="{bold}" /><w:i w:val="0" /><w:iCs w:val="0" /><w:sz w:val="{size}" /><w:szCs w:val="{size}" />"#
    )
}

fn syntax_token_color(token_style: &str, style: Option<&CodeBlockStyleConfig>) -> &'static str {
    let background = style
        .map(|value| value.background_color.as_str())
        .unwrap_or("F8FAFC");
    let dark = is_dark_hex_color(background);
    match token_style {
        "KeywordTok" | "ControlFlowTok" | "ImportTok" | "ExtensionTok" | "PreprocessorTok" => {
            if dark {
                "C084FC"
            } else {
                "7C3AED"
            }
        }
        "DataTypeTok" | "DecValTok" | "BaseNTok" | "FloatTok" | "ConstantTok" => {
            if dark {
                "FBBF24"
            } else {
                "B45309"
            }
        }
        "CharTok" | "StringTok" | "SpecialStringTok" | "VerbatimStringTok" => {
            if dark {
                "86EFAC"
            } else {
                "15803D"
            }
        }
        "CommentTok" | "DocumentationTok" | "AnnotationTok" | "CommentVarTok" => {
            if dark {
                "94A3B8"
            } else {
                "64748B"
            }
        }
        "FunctionTok" => {
            if dark {
                "67E8F9"
            } else {
                "0369A1"
            }
        }
        "OperatorTok" | "SpecialCharTok" | "VariableTok" | "AttributeTok" => {
            if dark {
                "F9A8D4"
            } else {
                "BE185D"
            }
        }
        "AlertTok" | "ErrorTok" => {
            if dark {
                "F87171"
            } else {
                "DC2626"
            }
        }
        _ => {
            if dark {
                "E2E8F0"
            } else {
                "111827"
            }
        }
    }
}

fn is_dark_hex_color(value: &str) -> bool {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return false;
    }
    let Ok(red) = u8::from_str_radix(&hex[0..2], 16) else {
        return false;
    };
    let Ok(green) = u8::from_str_radix(&hex[2..4], 16) else {
        return false;
    };
    let Ok(blue) = u8::from_str_radix(&hex[4..6], 16) else {
        return false;
    };
    let luminance = 0.2126 * f64::from(red) / 255.0
        + 0.7152 * f64::from(green) / 255.0
        + 0.0722 * f64::from(blue) / 255.0;
    luminance < 0.45
}

fn quote_paragraph_properties_xml(style: Option<&QuoteBlockStyleConfig>, is_list: bool) -> String {
    let background = style
        .map(|value| value.background_color.as_str())
        .unwrap_or("F8FAFC");
    let border_color = style
        .map(|value| value.border_color.as_str())
        .unwrap_or("94A3B8");
    let font_size = style.map(|value| value.font_size).unwrap_or(10.5);
    let line_height =
        style
            .map(|value| value.line_height)
            .unwrap_or(if is_list { 1.55 } else { 1.7 });
    let line = line_height_twips(font_size, line_height);
    let before = points_to_twentieths(
        style
            .map(|value| value.before_spacing)
            .unwrap_or(if is_list { 2.0 } else { 4.0 }),
    );
    let after = points_to_twentieths(
        style
            .map(|value| value.after_spacing)
            .unwrap_or(if is_list { 2.0 } else { 4.0 }),
    );
    let left = if is_list { 540 } else { 360 };
    let border_width = style.map(|value| value.border_width).unwrap_or(4.5);
    let border = border_xml_with_space("solid", border_width / 2.0, border_color, 6);

    format!(
        r#"<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto" /><w:ind w:left="{left}" w:right="240" w:firstLine="0" /><w:shd w:val="clear" w:color="auto" w:fill="{background}" /><w:pBdr><w:left {border} /></w:pBdr>"#
    )
}

fn quote_run_properties_xml(style: Option<&QuoteBlockStyleConfig>) -> String {
    let latin_font = style
        .map(|value| value.latin_font.as_str())
        .unwrap_or("Times New Roman");
    let chinese_font = style
        .map(|value| value.chinese_font.as_str())
        .unwrap_or("微软雅黑");
    let color = style.map(|value| value.color.as_str()).unwrap_or("475569");
    let size = font_size_half_points(style.map(|value| value.font_size).unwrap_or(10.5));
    let bold = bool_val(style.is_some_and(|value| value.bold));

    format!(
        r#"<w:rFonts w:ascii="{latin_font}" w:eastAsia="{chinese_font}" w:hAnsi="{latin_font}" /><w:color w:val="{color}" /><w:b w:val="{bold}" /><w:bCs w:val="{bold}" /><w:i /><w:iCs /><w:sz w:val="{size}" /><w:szCs w:val="{size}" />"#
    )
}

fn inline_code_run_properties_from_style(style: &InlineCodeStyleConfig) -> String {
    let size = font_size_half_points(style.font_size);
    let bold = bool_val(style.bold);
    format!(
        r#"<w:rFonts w:ascii="{}" w:eastAsia="{}" w:hAnsi="{}" w:cs="{}" /><w:noProof /><w:color w:val="{}" /><w:shd w:val="clear" w:color="auto" w:fill="{}" /><w:b w:val="{bold}" /><w:bCs w:val="{bold}" /><w:i w:val="0" /><w:iCs w:val="0" /><w:sz w:val="{size}" /><w:szCs w:val="{size}" />"#,
        style.latin_font,
        style.chinese_font,
        style.latin_font,
        style.latin_font,
        style.color,
        style.background_color
    )
}

fn bool_val(value: bool) -> &'static str {
    if value {
        "1"
    } else {
        "0"
    }
}

fn font_size_half_points(value: f64) -> u32 {
    (value * 2.0).round().clamp(12.0, 144.0) as u32
}

fn points_to_twentieths(value: f64) -> u32 {
    (value * 20.0).round().clamp(0.0, 2000.0) as u32
}

fn line_height_twips(font_size: f64, line_height: f64) -> u32 {
    (font_size * line_height * 20.0)
        .round()
        .clamp(120.0, 2000.0) as u32
}

fn insert_paragraph_properties(paragraph_xml: &str, properties: &str) -> String {
    let paragraph_start = Regex::new(r#"<w:p(\s[^>]*)?>"#).expect("valid paragraph start regex");
    paragraph_start
        .replace(paragraph_xml, |captures: &Captures| {
            let attributes = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            format!("<w:p{attributes}><w:pPr>{properties}</w:pPr>")
        })
        .to_string()
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

fn normalize_list_markers(xml: &str, document_style: Option<&DocumentStyleConfig>) -> String {
    let paragraph = Regex::new(r#"(?s)<w:p>.*?</w:p>"#).expect("valid paragraph regex");
    let mut ordered_counters: HashMap<String, usize> = HashMap::new();
    let mut list_level_ordered = [false; 4];

    paragraph
        .replace_all(xml, |captures: &Captures| {
            normalize_list_paragraph(
                &captures[0],
                &mut ordered_counters,
                &mut list_level_ordered,
                document_style,
            )
        })
        .to_string()
}

fn ordered_list_restart_enabled(document_style: Option<&DocumentStyleConfig>) -> bool {
    document_style
        .and_then(|style| style.styles.get("numbered-list"))
        .map(|style| style.list_numbering_mode != "continue")
        .unwrap_or(true)
}

fn ordered_list_level_restart_enabled(
    document_style: Option<&DocumentStyleConfig>,
    level: usize,
) -> bool {
    document_style
        .and_then(|style| {
            style
                .styles
                .get("nested-list")
                .or_else(|| style.styles.get("numbered-list"))
        })
        .map(|style| list_level_style(style, level).numbering_mode != "continue")
        .unwrap_or_else(|| ordered_list_restart_enabled(document_style))
}

fn clear_restart_ordered_counters(
    ordered_counters: &mut HashMap<String, usize>,
    document_style: Option<&DocumentStyleConfig>,
) {
    ordered_counters.retain(|key, _| {
        let level = key
            .rsplit_once(':')
            .and_then(|(_, level)| level.parse::<usize>().ok())
            .unwrap_or(0);
        !ordered_list_level_restart_enabled(document_style, level)
    });
}

fn normalize_list_paragraph(
    paragraph_xml: &str,
    ordered_counters: &mut HashMap<String, usize>,
    list_level_ordered: &mut [bool; 4],
    document_style: Option<&DocumentStyleConfig>,
) -> String {
    if capture_heading_style_id(paragraph_xml).is_some() {
        clear_restart_ordered_counters(ordered_counters, document_style);
        return paragraph_xml.to_string();
    }

    let numbering =
        Regex::new(r#"(?s)<w:numPr><w:ilvl w:val="(\d+)" /><w:numId w:val="(\d+)" /></w:numPr>"#)
            .expect("valid paragraph numbering regex");
    let Some(captures) = numbering.captures(paragraph_xml) else {
        clear_restart_ordered_counters(ordered_counters, document_style);
        return paragraph_xml.to_string();
    };

    let level = captures
        .get(1)
        .and_then(|value| value.as_str().parse::<usize>().ok())
        .unwrap_or(0);
    let num_id = captures.get(2).map(|value| value.as_str()).unwrap_or("");
    let task_marker = extract_task_list_marker(paragraph_xml);
    if num_id == "9100" {
        clear_restart_ordered_counters(ordered_counters, document_style);
        return paragraph_xml.to_string();
    }

    let raw_is_ordered = num_id.parse::<usize>().is_ok_and(|value| value >= 1003);
    let inferred_is_ordered = if task_marker.is_some() {
        false
    } else if document_style.is_none() && level > 0 {
        list_level_ordered
            .get(level.saturating_sub(1).min(3))
            .copied()
            .unwrap_or(raw_is_ordered)
    } else {
        raw_is_ordered
    };
    if !inferred_is_ordered && level == 0 {
        clear_restart_ordered_counters(ordered_counters, document_style);
    }
    list_level_ordered[level.min(3)] = inferred_is_ordered;
    let style_id = if level > 0 {
        "nested-list"
    } else if inferred_is_ordered {
        "numbered-list"
    } else {
        "bullet-list"
    };
    let list_style = document_style.and_then(|style| {
        if level > 0 {
            style.styles.get("nested-list").or_else(|| {
                style
                    .styles
                    .get(style_id)
                    .or_else(|| style.styles.get("bullet-list"))
            })
        } else {
            style
                .styles
                .get(style_id)
                .or_else(|| style.styles.get("bullet-list"))
                .or_else(|| style.styles.get("nested-list"))
        }
    });
    let marker_is_ordered = list_style
        .and_then(|style| list_level_type_override(style, level))
        .map(|value| value == "number")
        .unwrap_or(inferred_is_ordered)
        && task_marker.is_none();
    let marker = if let Some(task_marker) = task_marker {
        task_list_marker_text(task_marker).to_string()
    } else if marker_is_ordered {
        let counter_key = if inferred_is_ordered {
            format!("{num_id}:{level}")
        } else {
            format!("configured:{level}")
        };
        let counter = ordered_counters.entry(counter_key).or_insert(0);
        *counter += 1;
        ordered_list_marker(*counter, list_style, level)
    } else if level > 0 {
        let fallback = match level {
            1 => "circle",
            2 => "square",
            _ => "dash",
        };
        unordered_list_marker(list_style, fallback, level)
    } else {
        unordered_list_marker(list_style, "disc", level)
    };

    let without_numbering = numbering.replace(paragraph_xml, "").to_string();
    let without_numbering = strip_task_list_marker(&without_numbering);
    let with_indent = if let Some(style) = list_style {
        apply_list_paragraph_properties(&without_numbering, style, level, &marker)
    } else if without_numbering.contains("<w:pBdr>") {
        without_numbering
    } else {
        apply_default_list_paragraph_properties(&without_numbering, level, &marker)
    };
    let with_marker = prefix_first_text_run(&with_indent, &format!("{marker} "));
    list_style
        .map(|style| apply_list_level_run_style(&with_marker, style, level))
        .unwrap_or(with_marker)
}

fn list_level_index(level: usize) -> usize {
    level.min(3)
}

fn list_level_type_override(style: &TextStyleConfig, level: usize) -> Option<&str> {
    style.list_level_type_overrides[list_level_index(level)].as_deref()
}

fn unordered_list_marker(style: Option<&TextStyleConfig>, fallback: &str, level: usize) -> String {
    if style.is_none() && fallback == "circle" {
        return "◦".to_string();
    }

    let marker_style = style
        .map(|style| style.list_level_marker_styles[list_level_index(level)].as_str())
        .unwrap_or(fallback);

    match marker_style {
        "circle" => "○",
        "square" => "■",
        "triangle" => "▸",
        "dash" => "-",
        "check" => "✓",
        "bar" => "|",
        "double-bar" => "||",
        "triple-bar" => "|||",
        _ => "•",
    }
    .to_string()
}

fn ordered_list_marker(index: usize, style: Option<&TextStyleConfig>, level: usize) -> String {
    let format = style
        .map(|style| style.list_level_number_formats[list_level_index(level)].as_str())
        .unwrap_or("1.");

    match format {
        "1)" => format!("{index})"),
        "(1)" => format!("({index})"),
        "01." => format!("{index:02}."),
        "A." => format!("{}.", alphabetic_marker(index, false)),
        "A)" => format!("{})", alphabetic_marker(index, false)),
        "a." => format!("{}.", alphabetic_marker(index, true)),
        "a)" => format!("{})", alphabetic_marker(index, true)),
        "I." => format!("{}.", roman_number(index, false)),
        "I)" => format!("{})", roman_number(index, false)),
        "i." => format!("{}.", roman_number(index, true)),
        "i)" => format!("{})", roman_number(index, true)),
        "一、" => format!("{}、", chinese_number(index)),
        "（一）" => format!("（{}）", chinese_number(index)),
        _ => format!("{index}."),
    }
}

fn alphabetic_marker(mut value: usize, lowercase: bool) -> String {
    if value == 0 {
        return "A".to_string();
    }
    let mut chars = Vec::new();
    while value > 0 {
        value -= 1;
        let ch = (b'A' + (value % 26) as u8) as char;
        chars.push(ch);
        value /= 26;
    }
    let marker: String = chars.into_iter().rev().collect();
    if lowercase {
        marker.to_ascii_lowercase()
    } else {
        marker
    }
}

fn roman_number(mut value: usize, lowercase: bool) -> String {
    if value == 0 || value > 3999 {
        return value.to_string();
    }
    let mut output = String::new();
    for (number, roman) in [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ] {
        while value >= number {
            output.push_str(roman);
            value -= number;
        }
    }
    if lowercase {
        output.to_ascii_lowercase()
    } else {
        output
    }
}

fn chinese_number(value: usize) -> String {
    let digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if value <= 10 {
        return if value == 10 {
            "十".to_string()
        } else {
            digits[value].to_string()
        };
    }
    if value < 20 {
        return format!("十{}", digits[value - 10]);
    }
    if value < 100 {
        let tens = value / 10;
        let ones = value % 10;
        return format!(
            "{}十{}",
            digits[tens],
            if ones == 0 { "" } else { digits[ones] }
        );
    }
    value.to_string()
}

fn list_level_paragraph_properties_xml(
    style: &TextStyleConfig,
    level: usize,
    marker: &str,
) -> String {
    let level_style = list_level_style(style, level);
    let before = points_to_twentieths(level_style.before_spacing);
    let after = points_to_twentieths(level_style.after_spacing);
    let line = line_height_twips(level_style.font_size, level_style.line_height);
    let align = word_alignment_value(&level_style.align);
    let indent = list_indent_xml_for_marker(style, level, marker);
    format!(
        r#"<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto" /><w:jc w:val="{align}" />{indent}"#
    )
}

fn apply_default_list_paragraph_properties(
    paragraph_xml: &str,
    level: usize,
    marker: &str,
) -> String {
    let marker_left = ((2.0 + level.min(3) as f64 * 2.0) * 240.0).round() as u32;
    let hanging = list_marker_and_gap_twips(marker, 1.0);
    let text_left = marker_left.saturating_add(hanging);
    let properties = format!(
        r#"<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" /><w:jc w:val="left" /><w:ind w:left="{}" w:hanging="{hanging}" />"#,
        text_left
    );
    let existing_properties =
        Regex::new(r#"(?s)<w:pPr>.*?</w:pPr>"#).expect("valid paragraph properties regex");
    if existing_properties.is_match(paragraph_xml) {
        return existing_properties
            .replace(paragraph_xml, format!("<w:pPr>{properties}</w:pPr>"))
            .to_string();
    }

    insert_paragraph_properties(paragraph_xml, &properties)
}

fn apply_list_paragraph_properties(
    paragraph_xml: &str,
    style: &TextStyleConfig,
    level: usize,
    marker: &str,
) -> String {
    let properties = list_level_paragraph_properties_xml(style, level, marker);
    let existing_properties =
        Regex::new(r#"(?s)<w:pPr>.*?</w:pPr>"#).expect("valid paragraph properties regex");
    if existing_properties.is_match(paragraph_xml) {
        return existing_properties
            .replace(paragraph_xml, format!("<w:pPr>{properties}</w:pPr>"))
            .to_string();
    }

    insert_paragraph_properties(paragraph_xml, &properties)
}

fn apply_list_level_run_style(
    paragraph_xml: &str,
    style: &TextStyleConfig,
    level: usize,
) -> String {
    let properties = list_level_run_properties_xml(style, level);
    let run = Regex::new(r#"(?s)<w:r\b[^>]*>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(paragraph_xml, |captures: &Captures| {
        ensure_run_properties_xml(&captures[0], &properties)
    })
    .to_string()
}

fn ensure_run_properties_xml(run_xml: &str, properties: &str) -> String {
    let run_properties =
        Regex::new(r#"(?s)<w:rPr>.*?</w:rPr>"#).expect("valid run properties regex");
    let replacement = format!("<w:rPr>{properties}</w:rPr>");

    if run_properties.is_match(run_xml) {
        run_properties.replace(run_xml, replacement).to_string()
    } else {
        insert_run_properties(run_xml, properties)
    }
}

fn has_list_numbering(paragraph_xml: &str) -> bool {
    Regex::new(r#"(?s)<w:numPr><w:ilvl w:val="\d+" /><w:numId w:val="\d+" /></w:numPr>"#)
        .expect("valid paragraph numbering regex")
        .is_match(paragraph_xml)
}

fn capture_list_num_id(paragraph_xml: &str) -> Option<String> {
    Regex::new(r#"(?s)<w:numPr><w:ilvl w:val="\d+" /><w:numId w:val="(\d+)" /></w:numPr>"#)
        .expect("valid paragraph numbering regex")
        .captures(paragraph_xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
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

    let source_level = style_id
        .trim_start_matches("Heading")
        .parse::<usize>()
        .unwrap_or(1)
        .clamp(1, 6);
    let mut paragraph_xml = paragraph_xml.to_string();
    let level = match heading_numbering.mappings[source_level - 1] {
        HeadingTarget::Title => return replace_paragraph_style_id(&paragraph_xml, "Title"),
        HeadingTarget::Heading(level) => {
            if source_level != level {
                paragraph_xml =
                    replace_paragraph_style_id(&paragraph_xml, &format!("Heading{level}"));
            }
            level
        }
    };

    if heading_numbering.formats[level - 1].is_none() {
        return paragraph_xml;
    }

    let paragraph_xml = strip_manual_heading_number(&paragraph_xml);
    ensure_paragraph_numbering(&paragraph_xml, level)
}

fn replace_paragraph_style_id(paragraph_xml: &str, style_id: &str) -> String {
    let style =
        Regex::new(r#"<w:pStyle\s+w:val="[^"]+"\s*/>"#).expect("valid paragraph style regex");
    style
        .replace(paragraph_xml, format!(r#"<w:pStyle w:val="{style_id}" />"#))
        .to_string()
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

fn default_table_style_config(content_width_twips: Option<u32>) -> TableStyleConfig {
    TableStyleConfig {
        width_twips: content_width_twips.unwrap_or(8640),
        layout: "fixed".to_string(),
        horizontal_align: "center".to_string(),
        column_width_percentages: None,
        border_style: "solid".to_string(),
        border_color: "CBD5E1".to_string(),
        border_width: 1.0,
        border_top_width: 1.0,
        border_right_width: 1.0,
        border_bottom_width: 1.0,
        border_left_width: 1.0,
        show_inner_vertical_border: true,
        show_inner_horizontal_border: true,
        cell_padding_x: 10.0,
        cell_padding_y: 8.0,
        min_row_height: 28.0,
        row_stripe: false,
        cell_wrap: true,
        header: TableCellStyleConfig {
            chinese_font: "微软雅黑".to_string(),
            latin_font: "Times New Roman".to_string(),
            font_size: 10.5,
            bold: true,
            color: "111827".to_string(),
            background_color: "FFFFFF".to_string(),
            horizontal_align: "center".to_string(),
            vertical_align: "middle".to_string(),
            line_height: 1.4,
            border_color: "CBD5E1".to_string(),
            border_width: 1.0,
        },
        body: TableCellStyleConfig {
            chinese_font: "微软雅黑".to_string(),
            latin_font: "Times New Roman".to_string(),
            font_size: 10.5,
            bold: false,
            color: "111827".to_string(),
            background_color: "FFFFFF".to_string(),
            horizontal_align: "left".to_string(),
            vertical_align: "middle".to_string(),
            line_height: 1.5,
            border_color: "CBD5E1".to_string(),
            border_width: 1.0,
        },
    }
}

fn normalize_table_cells(xml: &str, style: &TableStyleConfig) -> String {
    let table = Regex::new(r#"(?s)<w:tbl>.*?</w:tbl>"#).expect("valid table regex");
    table
        .replace_all(xml, |captures: &Captures| {
            normalize_table_xml(&captures[0], style)
        })
        .to_string()
}

fn normalize_table_xml(table_xml: &str, style: &TableStyleConfig) -> String {
    let column_count = count_table_columns(table_xml).max(1);
    let table_xml = normalize_table_properties(table_xml, column_count, style);
    let row = Regex::new(r#"(?s)<w:tr>.*?</w:tr>"#).expect("valid table row regex");
    let mut row_index = 0usize;
    row.replace_all(&table_xml, |captures: &Captures| {
        let normalized =
            normalize_table_row_xml(&captures[0], row_index, row_index == 0, column_count, style);
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

fn normalize_table_properties(
    table_xml: &str,
    column_count: usize,
    style: &TableStyleConfig,
) -> String {
    let table_properties =
        Regex::new(r#"(?s)<w:tblPr>(.*?)</w:tblPr>"#).expect("valid table property regex");
    let table_grid =
        Regex::new(r#"(?s)<w:tblGrid>.*?</w:tblGrid>"#).expect("valid table grid regex");
    let grid = build_table_grid_xml(column_count, style);
    let layout = if style.layout.trim().eq_ignore_ascii_case("auto") {
        "autofit"
    } else {
        "fixed"
    };

    let table_xml = table_properties
        .replace(table_xml, |captures: &Captures| {
            let removable =
                Regex::new(r#"(?s)<w:tblBorders>.*?</w:tblBorders>|<w:(?:tblStyle|tblW|tblLayout|tblLook|jc)\b[^>]*/>"#)
                .expect("valid table layout cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            format!(
                r#"<w:tblPr>{inner}<w:tblW w:type="dxa" w:w="{}" /><w:tblLayout w:type="{layout}" />{}{}</w:tblPr>"#,
                style.width_twips,
                table_alignment_xml(&style.horizontal_align),
                table_borders_xml(style)
            )
        })
        .to_string();

    if table_grid.is_match(&table_xml) {
        table_grid.replace(&table_xml, grid).to_string()
    } else {
        table_xml.replace("</w:tblPr>", &format!("</w:tblPr>{grid}"))
    }
}

fn table_borders_xml(style: &TableStyleConfig) -> String {
    let top = border_xml(
        &style.border_style,
        style.border_top_width,
        &style.border_color,
    );
    let right = border_xml(
        &style.border_style,
        style.border_right_width,
        &style.border_color,
    );
    let bottom = border_xml(
        &style.border_style,
        style.border_bottom_width,
        &style.border_color,
    );
    let left = border_xml(
        &style.border_style,
        style.border_left_width,
        &style.border_color,
    );
    let inside_h = if style.show_inner_horizontal_border {
        border_xml(&style.border_style, style.border_width, &style.border_color)
    } else {
        border_xml("none", 0.0, &style.border_color)
    };
    let inside_v = if style.show_inner_vertical_border {
        border_xml(&style.border_style, style.border_width, &style.border_color)
    } else {
        border_xml("none", 0.0, &style.border_color)
    };

    format!(
        "<w:tblBorders><w:top {top} /><w:left {left} /><w:bottom {bottom} /><w:right {right} /><w:insideH {inside_h} /><w:insideV {inside_v} /></w:tblBorders>"
    )
}

fn table_alignment_xml(value: &str) -> String {
    format!(r#"<w:jc w:val="{}" />"#, word_horizontal_align(value))
}

fn border_xml(style: &str, width: f64, color: &str) -> String {
    border_xml_with_space(style, width, color, 0)
}

fn border_xml_with_space(style: &str, width: f64, color: &str, space: u32) -> String {
    // 宽度 <= 0 表示用户想要「无边框」，此前 width.max(0.5) 会把 0 抬成半磅细线。
    let value = if width <= 0.0 {
        "nil"
    } else {
        match style.trim() {
            "dashed" => "dashed",
            "dotted" => "dotted",
            "double" => "double",
            "none" => "nil",
            _ => "single",
        }
    };
    let size = if value == "nil" {
        0
    } else {
        ((width.max(0.5) * 8.0).round() as u32).clamp(1, 48)
    };
    format!(r#"w:val="{value}" w:sz="{size}" w:space="{space}" w:color="{color}""#)
}

fn build_table_grid_xml(column_count: usize, style: &TableStyleConfig) -> String {
    let widths = table_column_widths(column_count, style);
    let columns = widths
        .iter()
        .map(|width| format!(r#"<w:gridCol w:w="{width}" />"#))
        .collect::<Vec<_>>()
        .join("");
    format!("<w:tblGrid>{columns}</w:tblGrid>")
}

fn table_column_widths(column_count: usize, style: &TableStyleConfig) -> Vec<u32> {
    let count = column_count.max(1);
    if let Some(percentages) = style.column_width_percentages {
        let distribution = if count == 1 {
            vec![100.0]
        } else if count == 2 {
            vec![percentages[0], percentages[1]]
        } else {
            let remainder = percentages[2] / (count - 2) as f64;
            let mut values = vec![percentages[0], percentages[1]];
            values.extend((0..count - 2).map(|_| remainder));
            values
        };
        return table_column_widths_from_percentages(style.width_twips, &distribution);
    }

    let width = style.width_twips / count as u32;
    vec![width; count]
}

fn normalize_table_row_xml(
    row_xml: &str,
    row_index: usize,
    is_header: bool,
    column_count: usize,
    style: &TableStyleConfig,
) -> String {
    let row_xml = normalize_table_row_properties(row_xml, style);
    let cell = Regex::new(r#"(?s)<w:tc>.*?</w:tc>"#).expect("valid table cell regex");
    let mut cell_index = 0usize;
    cell.replace_all(&row_xml, |captures: &Captures| {
        let normalized = normalize_table_cell_xml(
            &captures[0],
            row_index,
            is_header,
            column_count,
            cell_index,
            style,
        );
        cell_index += 1;
        normalized
    })
    .to_string()
}

fn normalize_table_row_properties(row_xml: &str, style: &TableStyleConfig) -> String {
    let row_properties =
        Regex::new(r#"(?s)<w:trPr>(.*?)</w:trPr>"#).expect("valid table row property regex");
    let height = px_to_twips(style.min_row_height);
    let height_xml = format!(r#"<w:trHeight w:val="{height}" w:hRule="atLeast" />"#);

    if row_properties.is_match(row_xml) {
        return row_properties
            .replace(row_xml, |captures: &Captures| {
                let removable =
                    Regex::new(r#"<w:trHeight\b[^>]*/>"#).expect("valid row height cleanup regex");
                let inner = removable.replace_all(&captures[1], "");
                format!("<w:trPr>{inner}{height_xml}</w:trPr>")
            })
            .to_string();
    }

    row_xml.replace("<w:tr>", &format!("<w:tr><w:trPr>{height_xml}</w:trPr>"))
}

fn normalize_table_cell_xml(
    cell_xml: &str,
    row_index: usize,
    is_header: bool,
    column_count: usize,
    cell_index: usize,
    style: &TableStyleConfig,
) -> String {
    let cell_xml = normalize_table_cell_properties(
        cell_xml,
        row_index,
        is_header,
        column_count,
        cell_index,
        style,
    );
    let cell_xml = normalize_table_paragraphs(&cell_xml, is_header, style);
    normalize_table_runs(&cell_xml, is_header, style)
}

fn normalize_table_cell_properties(
    cell_xml: &str,
    row_index: usize,
    is_header: bool,
    column_count: usize,
    cell_index: usize,
    style: &TableStyleConfig,
) -> String {
    let cell_width = table_column_widths(column_count, style)
        .get(cell_index)
        .copied()
        .unwrap_or_else(|| style.width_twips / column_count.max(1) as u32);
    let cell_style = table_cell_style(style, is_header);
    let fill = cell_fill(style, cell_style, is_header, row_index);
    let cell_properties = format!(
        r#"<w:tcPr><w:tcW w:type="dxa" w:w="{cell_width}" /><w:vAlign w:val="{}" />{}{}{}{}</w:tcPr>"#,
        word_vertical_align(&cell_style.vertical_align),
        cell_margins_xml(style),
        cell_wrap_xml(style),
        cell_shading_xml(&fill),
        cell_borders_xml(
            &style.border_style,
            cell_style.border_width,
            &cell_style.border_color
        )
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
            let removable =
                Regex::new(r#"(?s)<w:tcBorders>.*?</w:tcBorders>|<w:tcMar>.*?</w:tcMar>|<w:(?:tcW|vAlign|shd|noWrap)\b[^>]*/>"#)
                    .expect("valid cell property cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            let extra = format!(
                r#"<w:tcW w:type="dxa" w:w="{cell_width}" /><w:vAlign w:val="{}" />{}{}{}{}"#,
                word_vertical_align(&cell_style.vertical_align),
                cell_margins_xml(style),
                cell_wrap_xml(style),
                cell_shading_xml(&fill),
                cell_borders_xml(
                    &style.border_style,
                    cell_style.border_width,
                    &cell_style.border_color
                )
            );
            format!("<w:tcPr>{inner}{extra}</w:tcPr>")
        })
        .to_string()
}

fn table_cell_style(style: &TableStyleConfig, is_header: bool) -> &TableCellStyleConfig {
    if is_header {
        &style.header
    } else {
        &style.body
    }
}

fn cell_shading_xml(fill: &str) -> String {
    if fill.eq_ignore_ascii_case("transparent") {
        return String::new();
    }
    format!(r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}" />"#)
}

fn paragraph_shading_xml(fill: &str) -> String {
    if fill.eq_ignore_ascii_case("transparent") {
        return String::new();
    }
    format!(r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}" />"#)
}

fn cell_fill(
    style: &TableStyleConfig,
    cell_style: &TableCellStyleConfig,
    is_header: bool,
    row_index: usize,
) -> String {
    if !is_header && style.row_stripe && row_index % 2 == 0 {
        return "F8FAFC".to_string();
    }
    cell_style.background_color.clone()
}

fn cell_margins_xml(style: &TableStyleConfig) -> String {
    let horizontal = px_to_twips(style.cell_padding_x);
    let vertical = px_to_twips(style.cell_padding_y);
    format!(
        r#"<w:tcMar><w:top w:w="{vertical}" w:type="dxa" /><w:left w:w="{horizontal}" w:type="dxa" /><w:bottom w:w="{vertical}" w:type="dxa" /><w:right w:w="{horizontal}" w:type="dxa" /></w:tcMar>"#
    )
}

fn px_to_twips(value: f64) -> u32 {
    (value * 15.0).round().clamp(0.0, 4000.0) as u32
}

fn cell_wrap_xml(style: &TableStyleConfig) -> &'static str {
    if style.cell_wrap {
        ""
    } else {
        "<w:noWrap />"
    }
}

fn cell_borders_xml(style: &str, width: f64, color: &str) -> String {
    let border = border_xml(style, width, color);
    format!(
        "<w:tcBorders><w:top {border} /><w:left {border} /><w:bottom {border} /><w:right {border} /></w:tcBorders>"
    )
}

fn normalize_table_paragraphs(cell_xml: &str, is_header: bool, style: &TableStyleConfig) -> String {
    let paragraph_properties =
        Regex::new(r#"(?s)<w:pPr>(.*?)</w:pPr>"#).expect("valid paragraph property regex");
    let cell_style = table_cell_style(style, is_header);
    let alignment = word_horizontal_align(&cell_style.horizontal_align);
    let line = line_height_twips(cell_style.font_size, cell_style.line_height);
    let output = paragraph_properties
        .replace_all(cell_xml, |captures: &Captures| {
            let removable = Regex::new(r#"<w:(?:jc|ind|spacing)\b[^>]*/>"#)
                .expect("valid paragraph cleanup regex");
            let inner = removable.replace_all(&captures[1], "");
            table_paragraph_properties_xml(&inner, alignment, line)
        })
        .to_string();
    let self_closing_properties =
        Regex::new(r#"<w:pPr\s*/>"#).expect("valid self closing paragraph property regex");
    let output = self_closing_properties
        .replace_all(&output, table_paragraph_properties_xml("", alignment, line))
        .to_string();

    if output.contains("<w:pPr") {
        return output;
    }

    let paragraph_start = Regex::new(r#"<w:p(?:\s[^>]*)?>"#).expect("valid paragraph start regex");
    paragraph_start
        .replace_all(&output, |captures: &Captures| {
            format!(
                "{}{}",
                &captures[0],
                table_paragraph_properties_xml("", alignment, line)
            )
        })
        .to_string()
}

fn table_paragraph_properties_xml(inner: &str, alignment: &str, line: u32) -> String {
    format!(
        r#"<w:pPr>{inner}<w:spacing w:line="{line}" w:lineRule="auto" /><w:ind w:left="0" w:right="0" w:firstLine="0" /><w:jc w:val="{alignment}" /></w:pPr>"#
    )
}

fn word_horizontal_align(value: &str) -> &'static str {
    match value.trim() {
        "center" => "center",
        "right" => "right",
        "justify" => "both",
        _ => "left",
    }
}

fn word_vertical_align(value: &str) -> &'static str {
    match value.trim() {
        "top" => "top",
        "bottom" => "bottom",
        _ => "center",
    }
}

fn normalize_table_runs(cell_xml: &str, is_header: bool, style: &TableStyleConfig) -> String {
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).expect("valid run regex");
    run.replace_all(cell_xml, |captures: &Captures| {
        normalize_table_run_xml(&captures[0], is_header, style)
    })
    .to_string()
}

fn normalize_table_run_xml(run_xml: &str, is_header: bool, style: &TableStyleConfig) -> String {
    let properties = table_run_properties(table_cell_style(style, is_header));
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

fn table_run_properties(style: &TableCellStyleConfig) -> String {
    let size = (style.font_size * 2.0).round().clamp(12.0, 144.0) as u32;
    let weight = if style.bold {
        "<w:b /><w:bCs />"
    } else {
        r#"<w:b w:val="0" /><w:bCs w:val="0" />"#
    };

    format!(
        r#"<w:rFonts w:ascii="{}" w:eastAsia="{}" w:hAnsi="{}" /><w:color w:val="{}" />{weight}<w:sz w:val="{size}" /><w:szCs w:val="{size}" />"#,
        style.latin_font, style.chinese_font, style.latin_font, style.color
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
        apply_conflict_strategy, apply_page_settings_to_document_xml,
        block_style_config_from_value, cell_shading_xml, commit_staged_output,
        create_heading_numbering_xml, default_heading_mappings, default_markdown_feature_config,
        default_report_heading_numbering_config, document_style_config_from_value,
        normalize_template_style_xml,
        footer_page_number_xml, has_supported_text_extension, heading_numbering_config_from_value,
        image_style_config_from_value, mark_task_list_paragraphs,
        markdown_feature_config_from_value, normalize_default_report_styles_xml,
        normalize_document_captions, normalize_document_images, normalize_document_xml,
        normalize_docx, normalize_template_styles_xml, page_content_width_twips,
        page_settings_config_from_value, pandoc_document_options_from_value, paragraph_shading_xml,
        prepare_markdown_file_for_pandoc, preprocess_markdown_for_word, read_style_bold_key,
        read_style_fill, table_column_widths, table_style_config_from_value,
        task_list_markers_from_numbering_xml, ConvertRequest, HeadingNumberingConfig,
        HeadingTarget, MarkdownFeatureConfig,
    };
    use serde_json::json;
    use std::fs;
    use std::io::{Cursor, Read, Write};
    use std::path::Path;
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    #[test]
    fn accepts_txt_input_and_stages_it_as_markdown() {
        assert!(has_supported_text_extension(Path::new("notes.txt")));
        assert!(!has_supported_text_extension(Path::new("notes.docx")));

        let input =
            std::env::temp_dir().join(format!("md-king-text-input-{}.txt", std::process::id()));
        fs::write(&input, "Plain text content").unwrap();

        let (prepared, temporary) = match prepare_markdown_file_for_pandoc(&input) {
            Ok(value) => value,
            Err(error) => panic!("TXT input preparation failed: {}", error.0),
        };
        assert_eq!(
            prepared.extension().and_then(|value| value.to_str()),
            Some("md")
        );
        assert_eq!(fs::read_to_string(&prepared).unwrap(), "Plain text content");

        if let Some(temporary) = temporary {
            let _ = fs::remove_file(temporary);
        }
        let _ = fs::remove_file(input);
    }

    #[test]
    fn maps_numeric_font_weights_to_word_bold() {
        assert_eq!(
            read_style_bold_key(&json!({ "fontWeight": "500" }), "fontWeight"),
            Some(false)
        );
        assert_eq!(
            read_style_bold_key(&json!({ "fontWeight": "600" }), "fontWeight"),
            Some(true)
        );
        assert_eq!(
            read_style_bold_key(&json!({ "fontWeight": "800" }), "fontWeight"),
            Some(true)
        );
    }

    #[test]
    fn normalizes_pandoc_table_xml_to_default_preview_style() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Table" /><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:trPr><w:tblHeader w:val="on" /></w:trPr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" /></w:rPr><w:t>模块</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:t>标题</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
            None,
            None,
            None,
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
        assert_eq!(output.matches(r#"<w:jc w:val="center" />"#).count(), 2);
    }

    #[test]
    fn derives_default_table_width_from_document_page_settings() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:tc><w:tcPr /><w:p><w:r><w:t>字段</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape" /><w:pgMar w:left="1440" w:right="1440" /></w:sectPr></w:body></w:document>"#;

        let output = normalize_document_xml(
            input,
            true,
            None,
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains(r#"<w:tblW w:type="dxa" w:w="13958" />"#));
        assert!(output.contains(r#"<w:gridCol w:w="13958" />"#));
    }

    #[test]
    fn normalizes_markdown_images_to_content_width_and_center_alignment() {
        let page_settings = page_settings_config_from_value(&json!({
            "pageSettings": {
                "paperSize": "A4",
                "orientation": "portrait",
                "marginLeft": 3.18,
                "marginRight": 3.18
            }
        }))
        .expect("page settings should parse");
        let target_width = u64::from(page_content_width_twips(&page_settings)) * 635;
        let target_height = target_width / 2;
        let input = r#"<w:document><w:body><w:p><w:pPr><w:jc w:val="left" /></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="1000" cy="500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="1000" cy="500"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"#;

        let output = normalize_document_images(input, Some(&page_settings), None);

        assert!(output.contains(r#"<w:jc w:val="center" />"#));
        assert!(!output.contains(r#"<w:jc w:val="left" />"#));
        assert!(output.contains(&format!(
            r#"<wp:extent cx="{target_width}" cy="{target_height}"/>"#
        )));
        assert!(output.contains(&format!(
            r#"<a:ext cx="{target_width}" cy="{target_height}"/>"#
        )));
    }

    #[test]
    fn applies_saved_image_style_to_markdown_images() {
        let page_settings = page_settings_config_from_value(&json!({
            "pageSettings": {
                "paperSize": "A4",
                "orientation": "portrait",
                "marginLeft": 3.18,
                "marginRight": 3.18
            }
        }))
        .expect("page settings should parse");
        let image_style = image_style_config_from_value(&json!({
            "styles": {
                "image": {
                    "imageAlign": "right",
                    "imageWidthMode": "custom",
                    "imageWidthPercent": 50
                }
            }
        }))
        .expect("image style should parse");
        let target_width =
            ((f64::from(page_content_width_twips(&page_settings)) * 0.5).round() as u64) * 635;
        let target_height = target_width / 2;
        let input = r#"<w:document><w:body><w:p><w:pPr><w:jc w:val="left" /></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="1000" cy="500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="1000" cy="500"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"#;

        let output = normalize_document_images(input, Some(&page_settings), Some(&image_style));

        assert!(output.contains(r#"<w:jc w:val="right" />"#));
        assert!(output.contains(&format!(
            r#"<wp:extent cx="{target_width}" cy="{target_height}"/>"#
        )));
        assert!(output.contains(&format!(
            r#"<a:ext cx="{target_width}" cy="{target_height}"/>"#
        )));
    }

    #[test]
    fn applies_saved_table_substyles_to_document_tables() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>字段</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>类型</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>说明</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>正文 A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>文本</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>第一行</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>正文 B</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>文本</w:t></w:r></w:p></w:tc><w:tc><w:tcPr /><w:p><w:pPr /><w:r><w:t>第二行</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let style = table_style_config_from_value(&json!({
            "styles": {
                "table": {
                    "fitToPageWidth": false,
                    "tableWidthPercent": 80,
                    "tableHorizontalAlign": "right",
                    "tableLayout": "fixed",
                    "columnWidthMode": "custom",
                    "firstColumnWidth": 20,
                    "secondColumnWidth": 30,
                    "thirdColumnWidth": 50,
                    "borderStyle": "dashed",
                    "borderColor": "#94A3B8",
                    "borderWidth": 1.5,
                    "borderTopWidth": 3,
                    "borderRightWidth": 2,
                    "borderBottomWidth": 1,
                    "borderLeftWidth": 4,
                    "showInnerVerticalBorder": true,
                    "showInnerHorizontalBorder": true,
                    "cellPaddingX": 16,
                    "cellPaddingY": 6,
                    "minRowHeight": 36,
                    "rowStripe": true,
                    "cellWrap": false
                },
                "table-header": {
                    "chineseFont": "黑体",
                    "latinFont": "Arial",
                    "headerFontSize": 12,
                    "headerLineHeight": "1.2",
                    "headerBold": true,
                    "color": "#1D4ED8",
                    "headerBackgroundColor": "#DBEAFE",
                    "headerAlign": "right",
                    "headerVerticalAlign": "top",
                    "headerBorderColor": "#2563EB",
                    "headerBorderWidth": 2
                },
                "table-body": {
                    "chineseFont": "宋体",
                    "latinFont": "Times New Roman",
                    "bodyFontSize": 10,
                    "bodyLineHeight": "1.8",
                    "color": "#334155",
                    "bodyBackgroundColor": "#FFFFFF",
                    "bodyAlign": "center",
                    "bodyVerticalAlign": "bottom",
                    "bodyBorderColor": "#CBD5E1",
                    "bodyBorderWidth": 1
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            Some(&style),
            None,
            None,
        );

        let widths = table_column_widths(3, &style);
        assert!(output.contains(&format!(
            r#"<w:tblW w:type="dxa" w:w="{}" />"#,
            style.width_twips
        )));
        assert!(output.contains(&format!(
            r#"<w:gridCol w:w="{}" /><w:gridCol w:w="{}" /><w:gridCol w:w="{}" />"#,
            widths[0], widths[1], widths[2]
        )));
        assert!(output.contains(&format!(r#"<w:tcW w:type="dxa" w:w="{}" />"#, widths[0])));
        assert!(output.contains(&format!(r#"<w:tcW w:type="dxa" w:w="{}" />"#, widths[1])));
        assert!(output.contains(&format!(r#"<w:tcW w:type="dxa" w:w="{}" />"#, widths[2])));
        assert!(output.contains(r#"<w:trHeight w:val="540" w:hRule="atLeast" />"#));
        assert!(output.contains(r#"<w:tcMar><w:top w:w="90" w:type="dxa" /><w:left w:w="240" w:type="dxa" /><w:bottom w:w="90" w:type="dxa" /><w:right w:w="240" w:type="dxa" /></w:tcMar>"#));
        assert!(output.contains(r#"<w:noWrap />"#));
        assert!(output.contains(r#"<w:spacing w:line="288" w:lineRule="auto" />"#));
        assert!(output.contains(r#"<w:spacing w:line="360" w:lineRule="auto" />"#));
        assert!(output.contains(r#"<w:tblLayout w:type="fixed" /><w:jc w:val="right" />"#));
        assert!(output.contains(r#"w:val="dashed" w:sz="12" w:space="0" w:color="94A3B8""#));
        assert!(
            output.contains(r#"<w:top w:val="dashed" w:sz="24" w:space="0" w:color="94A3B8" />"#)
        );
        assert!(
            output.contains(r#"<w:left w:val="dashed" w:sz="32" w:space="0" w:color="94A3B8" />"#)
        );
        assert!(output.contains(r#"<w:vAlign w:val="top" />"#));
        assert!(output.contains(r#"<w:vAlign w:val="bottom" />"#));
        assert!(output.contains(r#"w:fill="DBEAFE""#));
        assert!(output.contains(r#"w:fill="FFFFFF""#));
        assert!(output.contains(r#"w:fill="F8FAFC""#));
        assert!(output.contains(r#"<w:jc w:val="right" />"#));
        assert!(output.contains(r#"<w:jc w:val="center" />"#));
        assert!(
            output.contains(r#"<w:rFonts w:ascii="Arial" w:eastAsia="黑体" w:hAnsi="Arial" />"#)
        );
        assert!(output.contains(r#"<w:color w:val="1D4ED8" />"#));
        assert!(output.contains(r#"<w:sz w:val="24" /><w:szCs w:val="24" />"#));
        assert!(output.contains(
            r#"<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" />"#
        ));
        assert!(output.contains(r#"<w:color w:val="334155" />"#));
        assert!(output.contains(r#"<w:sz w:val="20" /><w:szCs w:val="20" />"#));
        assert!(output.contains(r#"w:color="2563EB""#));
    }

    #[test]
    fn table_width_uses_page_content_width_and_distributes_remaining_columns() {
        let config = json!({
            "pageSettings": {
                "paperSize": "A5",
                "orientation": "landscape",
                "marginLeft": 1.5,
                "marginRight": 2.0
            },
            "styles": {
                "table": {
                    "fitToPageWidth": true,
                    "columnWidthMode": "custom",
                    "firstColumnWidth": 20,
                    "secondColumnWidth": 30,
                    "thirdColumnWidth": 50
                }
            }
        });
        let page = page_settings_config_from_value(&config).expect("page settings should parse");
        let table = table_style_config_from_value(&config).expect("table style should parse");
        let widths = table_column_widths(4, &table);

        assert_eq!(table.width_twips, page_content_width_twips(&page));
        assert_eq!(widths.len(), 4);
        assert_eq!(widths.iter().sum::<u32>(), table.width_twips);
        assert!(widths[0] < widths[1]);
        assert!(widths[2].abs_diff(widths[3]) <= 1);
    }

    #[test]
    fn applies_image_and_table_caption_rules_to_docx_content() {
        let document_style = document_style_config_from_value(&json!({
            "styles": {
                "caption": {
                    "chineseFont": "微软雅黑",
                    "latinFont": "Arial",
                    "fontSize": 10,
                    "fontWeight": "400",
                    "color": "#334155",
                    "lineHeight": "1.4",
                    "beforeSpacing": 2,
                    "afterSpacing": 2,
                    "firstLineIndent": 0,
                    "captionAlign": "center",
                    "captionPosition": "above",
                    "captionNumbering": true,
                    "captionNumberFormat": "图 1-1"
                },
                "table-caption": {
                    "chineseFont": "微软雅黑",
                    "latinFont": "Arial",
                    "fontSize": 10,
                    "fontWeight": "400",
                    "color": "#334155",
                    "lineHeight": "1.4",
                    "beforeSpacing": 2,
                    "afterSpacing": 2,
                    "firstLineIndent": 0,
                    "captionAlign": "center",
                    "captionPosition": "below",
                    "captionNumbering": true,
                    "captionNumberFormat": "表 1"
                }
            }
        }))
        .expect("document style should parse");
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="CaptionedFigure" /></w:pPr><w:r><w:drawing><wp:inline /></w:drawing></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ImageCaption" /></w:pPr><w:r><w:t>流程图</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Caption" /></w:pPr><w:r><w:t>字段说明</w:t></w:r></w:p><w:tbl><w:tblPr /></w:tbl></w:body></w:document>"#;

        let output = normalize_document_captions(input, Some(&document_style));

        assert!(
            output.find("图 1-1 流程图").expect("image caption")
                < output.find("<w:drawing").expect("image")
        );
        assert!(
            output.find("<w:tbl>").expect("table")
                < output.find("表 1 字段说明").expect("table caption")
        );
        assert!(output.contains(r#"<w:jc w:val="center" />"#));
    }

    #[test]
    fn preserves_custom_table_cells_when_default_style_is_disabled() {
        let input = r#"<w:document><w:body><w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0" /></w:tblPr><w:tr><w:tc><w:tcPr /><w:p><w:pPr><w:pStyle w:val="Compact" /></w:pPr><w:r><w:t>自定义</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

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
    fn applies_saved_text_styles_to_word_style_definitions() {
        let input = r#"<w:styles><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:pPr><w:spacing w:after="120" /></w:pPr><w:rPr><w:rFonts w:eastAsia="微软雅黑" /><w:sz w:val="24" /></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2" /><w:pPr /><w:rPr /></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption" /><w:pPr /><w:rPr /></w:style></w:styles>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "normal": {
                    "chineseFont": "宋体",
                    "latinFont": "Times New Roman",
                    "fontSize": 12,
                    "fontWeight": "400",
                    "color": "#111827",
                    "lineHeight": "1.25",
                    "beforeSpacing": 0,
                    "afterSpacing": 0,
                    "firstLineIndent": 2,
                    "align": "justify"
                },
                "heading-2": {
                    "chineseFont": "黑体",
                    "latinFont": "Arial",
                    "fontSize": 16,
                    "fontWeight": "700",
                    "color": "#1D4ED8",
                    "lineHeight": "1.35",
                    "beforeSpacing": 12,
                    "afterSpacing": 6,
                    "firstLineIndent": 0,
                    "align": "left"
                },
                "caption": {
                    "chineseFont": "微软雅黑",
                    "latinFont": "Arial",
                    "fontSize": 10,
                    "fontWeight": "500",
                    "color": "#334155",
                    "lineHeight": "1.4",
                    "beforeSpacing": 4,
                    "afterSpacing": 4,
                    "firstLineIndent": 0,
                    "align": "center",
                    "captionAlign": "right"
                }
            }
        }))
        .unwrap();

        let output = normalize_template_styles_xml(
            input,
            &default_markdown_feature_config(),
            Some(&style),
            false,
        );

        assert!(output
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto" />"#));
        assert!(output.contains(r#"<w:jc w:val="both" />"#));
        assert!(output.contains(r#"<w:ind w:firstLine="480" />"#));
        assert!(output.contains(
            r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" />"#
        ));
        assert!(
            output.contains(r#"<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体" />"#)
        );
        assert!(output.contains(r#"<w:color w:val="1D4ED8" />"#));
        assert!(output.contains(r#"<w:b w:val="1" />"#));
        assert!(output.contains(r#"<w:jc w:val="right" />"#));
        assert!(output.contains(r#"<w:sz w:val="20" />"#));
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
        let normalized_document = normalize_document_xml(
            document,
            true,
            Some(&config),
            &inline_enabled,
            None,
            None,
            None,
        );

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
            None,
            None,
            None,
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
    fn applies_saved_code_quote_and_inline_code_styles() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r><w:t>let value = 1;</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="BlockText" /></w:pPr><w:r><w:t>引用内容</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rStyle w:val="VerbatimChar" /></w:rPr><w:t>inline()</w:t></w:r></w:p></w:body></w:document>"#;
        let style = block_style_config_from_value(&json!({
            "styles": {
                "source-code": {
                    "chineseFont": "宋体",
                    "latinFont": "Cascadia Mono",
                    "fontSize": 11,
                    "fontWeight": "700",
                    "color": "#E0F2FE",
                    "backgroundColor": "#0F172A",
                    "codeBorderColor": "#38BDF8",
                    "lineHeight": "1.8",
                    "beforeSpacing": 12,
                    "afterSpacing": 14,
                    "codePaddingX": 18,
                    "codePaddingY": 12
                },
                "quote": {
                    "chineseFont": "仿宋",
                    "latinFont": "Times New Roman",
                    "fontSize": 12,
                    "fontWeight": "700",
                    "color": "#7C2D12",
                    "backgroundColor": "#FFEDD5",
                    "quoteBorderColor": "#F97316",
                    "quoteBorderWidth": 6,
                    "lineHeight": "1.6",
                    "beforeSpacing": 6,
                    "afterSpacing": 8
                },
                "inline-code": {
                    "chineseFont": "Microsoft YaHei UI",
                    "latinFont": "Consolas",
                    "fontSize": 10,
                    "fontWeight": "700",
                    "color": "#C026D3",
                    "backgroundColor": "#FDF4FF"
                }
            }
        }))
        .unwrap();
        let features = MarkdownFeatureConfig {
            inline_code: true,
            code_block: true,
            quote_block: true,
            horizontal_rule: false,
        };

        let output =
            normalize_document_xml(input, false, None, &features, None, None, Some(&style));

        assert!(output.contains(r#"<w:rFonts w:ascii="Cascadia Mono" w:eastAsia="宋体""#));
        assert!(output.contains(r#"<w:b w:val="1" />"#));
        assert!(output.contains(r#"<w:color w:val="E0F2FE" />"#));
        assert!(output.contains(r#"w:fill="0F172A""#));
        assert!(output.contains(r#"w:color="38BDF8""#));
        assert!(output.contains(
            r#"<w:spacing w:before="240" w:after="280" w:line="396" w:lineRule="auto" />"#
        ));
        assert!(output.contains(r#"<w:ind w:left="360" w:right="360" w:firstLine="0" />"#));
        assert!(output.contains(r#"w:fill="FFEDD5""#));
        assert!(output.contains(r#"w:color="F97316""#));
        assert!(output.contains(r#"<w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋""#));
        assert!(output.contains(r#"<w:color w:val="7C2D12" />"#));
        assert!(output.contains(r#"<w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei UI""#));
        assert!(output.contains(r#"<w:color w:val="C026D3" />"#));
        assert!(output.contains(r#"w:fill="FDF4FF""#));
    }

    #[test]
    fn preserves_transparent_fill_as_no_docx_shading() {
        let style = json!({ "backgroundColor": "transparent" });

        assert_eq!(
            read_style_fill(&style, "backgroundColor", "F8FAFC"),
            "transparent"
        );
        assert!(paragraph_shading_xml("transparent").is_empty());
        assert!(cell_shading_xml("transparent").is_empty());
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
            None,
            None,
            None,
        );

        assert_eq!(output.matches(r#"<w:color w:val="111827" />"#).count(), 3);
        assert_eq!(output.matches(r#"<w:rFonts w:ascii="Consolas""#).count(), 3);
        assert!(output.contains(r#"<w:r w:rsidRPr="00112233"><w:rPr><w:rFonts"#));
        assert!(!output.contains(r#"<w:rStyle w:val="VerbatimChar""#));
    }

    #[test]
    fn preserves_syntax_token_styles_inside_code_blocks() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r><w:rPr><w:rStyle w:val="KeywordTok" /></w:rPr><w:t>function</w:t></w:r><w:r><w:rPr><w:rStyle w:val="NormalTok" /></w:rPr><w:t> value</w:t></w:r><w:r><w:rPr><w:rStyle w:val="StringTok" /></w:rPr><w:t>"ok"</w:t></w:r></w:p></w:body></w:document>"#;
        let config = default_report_heading_numbering_config();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains(r#"<w:rStyle w:val="KeywordTok" />"#));
        assert!(output.contains(r#"<w:rStyle w:val="StringTok" />"#));
        assert!(output.contains(r#"<w:color w:val="7C3AED" />"#));
        assert!(output.contains(r#"<w:color w:val="15803D" />"#));
        assert!(output.contains(r#"<w:rFonts w:ascii="Consolas""#));
    }

    #[test]
    fn renders_code_language_marker_as_label_paragraph() {
        let input = r#"<w:document><w:body><w:p><w:r><w:t>MD_KING_CODE_LANG:python</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="SourceCode" /></w:pPr><w:r><w:t>print("ok")</w:t></w:r></w:p></w:body></w:document>"#;
        let output = normalize_document_xml(
            input,
            true,
            None,
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains("<w:t>Python</w:t>"));
        assert!(!output.contains("MD_KING_CODE_LANG"));
        assert!(output.contains(r#"<w:jc w:val="right" />"#));
        assert!(output.contains(r#"<w:pStyle w:val="SourceCode" />"#));
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
        let output =
            normalize_document_xml(input, true, Some(&config), &features, None, None, None);

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
        assert_eq!(output.matches("<w:i />").count(), 1);
    }

    #[test]
    fn removes_horizontal_rules_by_default_and_keeps_them_when_enabled() {
        let input = r#"<w:document><w:body><w:p w14:paraId="1111"><w:pPr><w:pStyle w:val="HorizontalRule" /><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr></w:p><w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t" /></w:pict></w:r></w:p><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr><w:r><w:drawing><wp:inline /></w:drawing></w:r></w:p><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr><m:oMathPara><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara></w:p><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto" /></w:pBdr></w:pPr><w:fldSimple w:instr="PAGE" /></w:p><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>"#;
        let config = default_report_heading_numbering_config();
        let removed = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(removed.contains("<w:t>正文</w:t>"));
        assert!(removed.contains("<w:drawing>"));
        assert!(removed.contains("<m:oMathPara>"));
        assert!(removed.contains("<w:fldSimple"));
        assert!(!removed.contains(r#"<w:pStyle w:val="HorizontalRule" />"#));
        assert!(!removed.contains(r#"o:hr="t""#));

        let kept = normalize_document_xml(
            input,
            true,
            Some(&config),
            &MarkdownFeatureConfig {
                horizontal_rule: true,
                ..default_markdown_feature_config()
            },
            None,
            None,
            None,
        );

        assert!(
            kept.contains(r#"<w:p w14:paraId="1111"><w:pPr><w:pStyle w:val="HorizontalRule" />"#)
        );
        assert!(kept.contains(r#"<w:spacing w:before="240" w:after="240" />"#));
        assert!(kept.contains(r#"w:val="single" w:sz="8" w:space="1" w:color="CBD5E1""#));
        assert!(!kept.contains(r#"o:hr="t""#));
    }

    #[test]
    fn applies_saved_horizontal_rule_style() {
        let value = json!({
            "styles": {
                "source-code": {},
                "quote": {},
                "horizontal-rule": {
                    "borderStyle": "dashed",
                    "borderColor": "123ABC",
                    "borderWidth": 1.5,
                    "beforeSpacing": 5,
                    "afterSpacing": 7
                }
            }
        });
        let block_style = block_style_config_from_value(&value).expect("block style should parse");
        let input = r#"<w:document><w:body><w:p><w:r><w:pict><v:rect o:hr="t" /></w:pict></w:r></w:p></w:body></w:document>"#;
        let output = normalize_document_xml(
            input,
            false,
            None,
            &MarkdownFeatureConfig {
                horizontal_rule: true,
                ..default_markdown_feature_config()
            },
            None,
            None,
            Some(&block_style),
        );

        assert!(output.contains(r#"<w:spacing w:before="100" w:after="140" />"#));
        assert!(output.contains(r#"w:val="dashed" w:sz="12" w:space="1" w:color="123ABC""#));
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
                "tocDepth": "1-4",
                "tocLeader": "space",
                "tocShowPageNumbers": false
            }
        });

        let options = pandoc_document_options_from_value(&value);
        let page_settings = page_settings_config_from_value(&value).unwrap();

        assert!(options.toc);
        assert_eq!(options.toc_depth, Some(4));
        assert_eq!(page_settings.toc_leader, "space");
        assert!(!page_settings.toc_show_page_numbers);

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
    fn applies_toc_field_options_and_page_number_start() {
        let input = r#"<w:document><w:body><w:p><w:fldSimple w:instr="TOC \o &quot;1-3&quot; \h \z \u"><w:r><w:t>目录</w:t></w:r></w:fldSimple></w:p><w:sectPr><w:pgSz w:w="1" w:h="2" /></w:sectPr></w:body></w:document>"#;
        let settings = page_settings_config_from_value(&json!({
            "pageSettings": {
                "paperSize": "A4",
                "orientation": "portrait",
                "footerEnabled": false,
                "footerStartPage": 4,
                "tocEnabled": true,
                "tocDepth": "1-4",
                "tocLeader": "space",
                "tocShowPageNumbers": true
            }
        }))
        .unwrap();

        let output = apply_page_settings_to_document_xml(input, Some(&settings));

        assert!(output.contains(r#"TOC \o &quot;1-4&quot; \h \z \u \p &quot; &quot;"#));
        assert!(output.contains(r#"<w:pgNumType w:start="4" />"#));

        let pandoc_toc = r#"<w:document><w:body><w:sdt><w:sdtContent><w:p><w:r><w:instrText xml:space="preserve">TOC \o &quot;1-3&quot; \h \z \u</w:instrText></w:r></w:p></w:sdtContent></w:sdt><w:sectPr /></w:body></w:document>"#;
        let output = apply_page_settings_to_document_xml(pandoc_toc, Some(&settings));
        assert!(output.contains(r#"<w:instrText xml:space="preserve">TOC \o &quot;1-4&quot; \h \z \u \p &quot; &quot;</w:instrText>"#));
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
    fn renders_plain_page_number_without_total_pages() {
        let output = footer_page_number_xml("plain-total");

        assert!(output.contains("PAGE"));
        assert!(output.contains(r#"<w:color w:val="000000" />"#));
        assert!(!output.contains("NUMPAGES"));
        assert!(!output.contains("<w:t> 共 </w:t>"));
        assert!(!output.contains("<w:t> / </w:t>"));
        assert!(!output.contains("<w:t>- </w:t>"));
        assert!(!output.contains("<w:t> -</w:t>"));
    }

    #[test]
    fn writes_header_and_footer_parts_into_docx_package() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "md-king-header-footer-test-{}.docx",
            std::process::id()
        ));
        let document_xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p /><w:sectPr><w:pgSz w:w="1" w:h="2" /></w:sectPr></w:body></w:document>"#;
        let content_types_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="xml" ContentType="application/xml" /><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" /></Types>"#;
        let rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#;

        {
            let file = fs::File::create(&path).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("[Content_Types].xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content_types_xml.as_bytes()).unwrap();
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(document_xml.as_bytes()).unwrap();
            writer
                .start_file("word/_rels/document.xml.rels", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(rels_xml.as_bytes()).unwrap();
            writer.finish().unwrap();
        }

        let settings = page_settings_config_from_value(&json!({
            "pageSettings": {
                "paperSize": "A4",
                "orientation": "portrait",
                "headerEnabled": true,
                "headerText": "项目 & 周报",
                "footerEnabled": true,
                "footerText": "内部资料",
                "footerPageNumberFormat": "page-total",
                "footerStartPage": 3
            }
        }))
        .unwrap();

        normalize_docx(
            &path,
            false,
            None,
            &default_markdown_feature_config(),
            Some(&settings),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let file = fs::File::open(&path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();
        let mut rels = String::new();
        archive
            .by_name("word/_rels/document.xml.rels")
            .unwrap()
            .read_to_string(&mut rels)
            .unwrap();
        let mut header = String::new();
        archive
            .by_name("word/header-mdking.xml")
            .unwrap()
            .read_to_string(&mut header)
            .unwrap();
        let mut footer = String::new();
        archive
            .by_name("word/footer-mdking.xml")
            .unwrap()
            .read_to_string(&mut footer)
            .unwrap();

        assert!(document.contains(
            r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
        ));
        assert!(
            document.contains(r#"<w:headerReference w:type="default" r:id="rIdMdKingHeader" />"#)
        );
        assert!(
            document.contains(r#"<w:footerReference w:type="default" r:id="rIdMdKingFooter" />"#)
        );
        assert!(document.contains(r#"<w:pgNumType w:start="3" />"#));
        assert!(rels.contains(r#"Target="header-mdking.xml""#));
        assert!(rels.contains(r#"Target="footer-mdking.xml""#));
        assert!(header.contains("项目 &amp; 周报"));
        assert!(footer.contains("内部资料"));
        assert!(footer.contains("PAGE"));
        assert!(!footer.contains("NUMPAGES"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn converts_formula_fenced_code_to_math_blocks_for_pandoc() {
        let input = "正文\n\n```math\nE = mc^2\n```\n\n```latex\n\\frac{a}{b}\n```\n\n```公式\nx + y\n```\n\n```rust\nlet value = 1;\n```\n";

        let output = preprocess_markdown_for_word(input);

        assert!(output.contains("$$\nE = mc^2\n$$"));
        assert!(output.contains("$$\n\\frac{a}{b}\n$$"));
        assert!(output.contains("$$\nx + y\n$$"));
        assert!(output.contains("MD_KING_CODE_LANG:rust\n```rust\nlet value = 1;\n```"));
    }

    #[test]
    fn respects_markdown_fence_length_and_closing_rules() {
        let input = "````math\na\n```\nb\n````\n\n```math\nc\n```not-close\nd\n```\n\n    ```math\ne\n    ```\n\n```math\nunclosed\n";
        let output = preprocess_markdown_for_word(input);

        assert!(output.contains("$$\na\n```\nb\n$$"));
        assert!(output.contains("$$\nc\n```not-close\nd\n$$"));
        assert!(output.contains("    ```math\ne\n    ```"));
        assert!(output.ends_with("```math\nunclosed\n"));
    }

    #[test]
    fn adds_word_heading_numbering_and_removes_typed_prefixes() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>总述</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2" /></w:pPr><w:r><w:t>1. 背景</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading3" /></w:pPr><w:r><w:t>1.1.1 细节</w:t></w:r></w:p></w:body></w:document>"#;

        let mut config = default_report_heading_numbering_config();
        config.mappings = default_heading_mappings();
        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains(
            r#"<w:pStyle w:val="Heading1" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="9100" />"#
        ));
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
            None,
            None,
            None,
        );

        assert!(output.contains("<w:t>• 无序列表 A</w:t>"));
        assert!(output.contains("<w:t>◦ 嵌套列表 B.1</w:t>"));
        assert!(output.contains("<w:t>1. 有序列表第一项</w:t>"));
        assert!(output.contains(r#"<w:ind w:left="840" w:hanging="360" />"#));
        assert!(output.contains(r#"<w:ind w:left="1320" w:hanging="360" />"#));
        assert!(!output.contains("<w:numPr>"));
    }

    #[test]
    fn renders_task_list_markers_from_numbering_xml() {
        let numbering = r#"<w:numbering><w:abstractNum w:abstractNumId="992"><w:lvl w:ilvl="0"><w:lvlText w:val="☐" /></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="993"><w:lvl w:ilvl="0"><w:lvlText w:val="☒" /></w:lvl></w:abstractNum><w:num w:numId="1001"><w:abstractNumId w:val="993" /></w:num><w:num w:numId="1002"><w:abstractNumId w:val="992" /></w:num></w:numbering>"#;
        let markers = task_list_markers_from_numbering_xml(numbering);
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1001" /></w:numPr></w:pPr><w:r><w:t>已完成</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>未完成</w:t></w:r></w:p></w:body></w:document>"#;
        let input = mark_task_list_paragraphs(input, &markers);
        let output = normalize_document_xml(
            &input,
            true,
            None,
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains("<w:t>☑ 已完成</w:t>"));
        assert!(output.contains("<w:t>☐ 未完成</w:t>"));
        assert!(!output.contains("MD_KING_TASK_LIST"));
        assert!(!output.contains("<w:numPr>"));
    }

    #[test]
    fn applies_saved_list_markers_and_indents_to_document_xml() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1001" /></w:numPr></w:pPr><w:r><w:t>无序列表 A</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>有序列表第一项</w:t></w:r></w:p></w:body></w:document>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "bullet-list": {
                    "listMarkerStyle": "triangle",
                    "listIndent": 2,
                    "listTextIndent": 1,
                    "listWrapMode": "hanging"
                },
                "numbered-list": {
                    "numberFormat": "（一）",
                    "listIndent": 1,
                    "listTextIndent": 1.25,
                    "listWrapMode": "flat"
                },
                "nested-list": {
                    "listLevel1Type": "bullet",
                    "listMarkerStyle": "square",
                    "listIndent": 4,
                    "listTextIndent": 1
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            Some(&style),
            None,
        );

        assert!(output.contains("<w:t>▸ 无序列表 A</w:t>"));
        assert!(output.contains("<w:t>（一） 有序列表第一项</w:t>"));
        assert!(output.contains(r#"<w:ind w:left="840" w:hanging="360" />"#));
        assert!(output.contains(r#"<w:ind w:left="240" w:firstLine="0" />"#));
        assert!(!output.contains("<w:numPr>"));
    }

    #[test]
    fn applies_nested_list_level_styles_to_document_xml() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>二级无序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="2" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>三级无序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>二级有序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="2" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>三级有序</w:t></w:r></w:p></w:body></w:document>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "nested-list": {
                    "nestedLevel2MarkerStyle": "triangle",
                    "nestedLevel3MarkerStyle": "check",
                    "nestedLevel2NumberFormat": "1)",
                    "nestedLevel3NumberFormat": "(1)",
                    "listIndent": 4,
                    "listTextIndent": 1.5,
                    "nestedIndentStep": 2,
                    "listWrapMode": "hanging"
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            Some(&style),
            None,
        );

        assert!(output.contains("<w:t>▸ 二级无序</w:t>"));
        assert!(output.contains("<w:t>✓ 三级无序</w:t>"));
        assert!(output.contains("<w:t>1) 二级有序</w:t>"));
        assert!(output.contains("<w:t>(1) 三级有序</w:t>"));
        assert!(output.contains(r#"<w:ind w:left="1380" w:hanging="420" />"#));
        assert!(output.contains(r#"<w:ind w:left="1860" w:hanging="420" />"#));
    }

    #[test]
    fn applies_per_level_mixed_list_type_overrides() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1001" /></w:numPr></w:pPr><w:r><w:t>一级原始无序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>二级原始无序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="2" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>三级原始有序</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="3" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>四级原始有序</w:t></w:r></w:p></w:body></w:document>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "nested-list": {
                    "listLevel1Type": "number",
                    "listLevel1NumberFormat": "A.",
                    "listLevel2Type": "bullet",
                    "listLevel2MarkerStyle": "triple-bar",
                    "listLevel3Type": "number",
                    "listLevel3NumberFormat": "i)",
                    "listLevel4Type": "bullet",
                    "listLevel4MarkerStyle": "check",
                    "listIndent": 2,
                    "listTextIndent": 1.5,
                    "nestedIndentStep": 2,
                    "listWrapMode": "hanging"
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            Some(&style),
            None,
        );

        assert!(output.contains("<w:t>A. 一级原始无序</w:t>"));
        assert!(output.contains("<w:t>||| 二级原始无序</w:t>"));
        assert!(output.contains("<w:t>i) 三级原始有序</w:t>"));
        assert!(output.contains("<w:t>✓ 四级原始有序</w:t>"));
    }

    #[test]
    fn applies_per_level_list_text_styles_to_document_xml() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1002" /></w:numPr></w:pPr><w:r><w:t>二级列表文字</w:t></w:r></w:p></w:body></w:document>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "nested-list": {
                    "listLevel2ChineseFont": "黑体",
                    "listLevel2LatinFont": "Arial",
                    "listLevel2FontSize": 14,
                    "listLevel2FontWeight": "700",
                    "listLevel2Color": "#EF4444",
                    "listLevel2LineHeight": "2",
                    "listLevel2BeforeSpacing": 12,
                    "listLevel2AfterSpacing": 8,
                    "listLevel2Align": "center",
                    "listLevel2Indent": 3,
                    "listLevel2TextIndent": 1,
                    "listLevel2WrapMode": "flat"
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            Some(&style),
            None,
        );

        assert!(output.contains(
            r#"<w:spacing w:before="240" w:after="160" w:line="560" w:lineRule="auto" />"#
        ));
        assert!(output.contains(r#"<w:jc w:val="center" />"#));
        assert!(output.contains(r#"<w:ind w:left="720" w:firstLine="0" />"#));
        assert!(
            output.contains(r#"<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体" />"#)
        );
        assert!(output.contains(r#"<w:color w:val="EF4444" />"#));
        assert!(output.contains(r#"<w:sz w:val="28" />"#));
        assert!(output.contains(r#"<w:b w:val="1" />"#));
        assert!(output.contains("<w:t>○ 二级列表文字</w:t>"));
    }

    #[test]
    fn restarts_ordered_list_numbering_after_normal_paragraph_by_default() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>第一组第一项</w:t></w:r></w:p><w:p><w:r><w:t>普通正文</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>第二组第一项</w:t></w:r></w:p></w:body></w:document>"#;

        let output = normalize_document_xml(
            input,
            true,
            None,
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains("<w:t>1. 第一组第一项</w:t>"));
        assert!(output.contains("<w:t>1. 第二组第一项</w:t>"));
        assert!(!output.contains("<w:t>2. 第二组第一项</w:t>"));
    }

    #[test]
    fn can_continue_ordered_list_numbering_across_paragraphs_when_configured() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>第一组第一项</w:t></w:r></w:p><w:p><w:r><w:t>普通正文</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Compact" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1003" /></w:numPr></w:pPr><w:r><w:t>第二组第一项</w:t></w:r></w:p></w:body></w:document>"#;
        let style = document_style_config_from_value(&json!({
            "styles": {
                "numbered-list": {
                    "numberFormat": "1.",
                    "listNumberingMode": "continue"
                }
            }
        }))
        .unwrap();

        let output = normalize_document_xml(
            input,
            false,
            None,
            &default_markdown_feature_config(),
            None,
            Some(&style),
            None,
        );

        assert!(output.contains("<w:t>1. 第一组第一项</w:t>"));
        assert!(output.contains("<w:t>2. 第二组第一项</w:t>"));
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
            mappings: default_heading_mappings(),
        };
        let numbering = create_heading_numbering_xml(&config);

        assert!(numbering.contains(r#"<w:numFmt w:val="chineseCountingThousand" />"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="%2、" />"#));
        assert!(numbering.contains(r#"<w:lvlText w:val="第%3章" />"#));
    }

    #[test]
    fn reads_heading_numbering_from_saved_template_style_config() {
        let value = json!({
            "markdownRules": {
                "headingMappings": {
                    "heading-1": "title",
                    "heading-2": "heading-1",
                    "heading-3": "heading-4"
                }
            },
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
        assert_eq!(config.mappings[0], HeadingTarget::Title);
        assert_eq!(config.mappings[1], HeadingTarget::Heading(1));
        assert_eq!(config.mappings[2], HeadingTarget::Heading(4));
    }

    #[test]
    fn maps_markdown_title_to_word_title_and_offsets_heading_levels() {
        let input = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>项目报告</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2" /></w:pPr><w:r><w:t>1. 项目概览</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading3" /></w:pPr><w:r><w:t>1.1 核心结论</w:t></w:r></w:p></w:body></w:document>"#;
        let mut config = default_report_heading_numbering_config();
        config.mappings = [
            HeadingTarget::Title,
            HeadingTarget::Heading(1),
            HeadingTarget::Heading(2),
            HeadingTarget::Heading(3),
            HeadingTarget::Heading(4),
            HeadingTarget::Heading(5),
        ];

        let output = normalize_document_xml(
            input,
            true,
            Some(&config),
            &default_markdown_feature_config(),
            None,
            None,
            None,
        );

        assert!(output.contains(r#"<w:pStyle w:val="Title" /></w:pPr><w:r><w:t>项目报告</w:t>"#));
        assert!(output.contains(
            r#"<w:pStyle w:val="Heading1" /><w:numPr><w:ilvl w:val="0" /><w:numId w:val="9100" />"#
        ));
        assert!(output.contains(
            r#"<w:pStyle w:val="Heading2" /><w:numPr><w:ilvl w:val="1" /><w:numId w:val="9100" />"#
        ));
        assert!(output.contains("<w:t>项目概览</w:t>"));
        assert!(output.contains("<w:t>核心结论</w:t>"));
        assert!(!output.contains("<w:t>1. 项目概览</w:t>"));
        assert!(!output.contains("<w:t>1.1 核心结论</w:t>"));
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

        let mut config = default_report_heading_numbering_config();
        config.mappings = default_heading_mappings();
        let inline_enabled = MarkdownFeatureConfig {
            inline_code: true,
            ..default_markdown_feature_config()
        };
        normalize_docx(
            &path,
            true,
            Some(&config),
            &inline_enabled,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

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
        normalize_docx(
            &path,
            true,
            Some(&config),
            &inline_enabled,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

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
            input_kind: None,
            source_path: None,
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
    fn staged_output_replaces_existing_file_only_at_commit() {
        let dir = std::env::temp_dir();
        let output = dir.join(format!("md-king-output-commit-{}.docx", std::process::id()));
        let staged = dir.join(format!("md-king-output-staged-{}.docx", std::process::id()));
        let _ = fs::remove_file(&output);
        let _ = fs::remove_file(&staged);
        fs::write(&output, b"old document").unwrap();
        fs::write(&staged, b"new document").unwrap();

        commit_staged_output(&staged, &output).expect("staged output should commit");

        assert_eq!(fs::read(&output).unwrap(), b"new document");
        assert!(!staged.exists());
        let _ = fs::remove_file(output);
    }

    #[test]
    fn conflict_strategy_ask_rejects_existing_output_path() {
        let path =
            std::env::temp_dir().join(format!("md-king-conflict-ask-{}.docx", std::process::id()));
        let _ = fs::remove_file(&path);
        fs::write(&path, b"existing").unwrap();

        let request = ConvertRequest {
            input: "# title".to_string(),
            input_kind: None,
            source_path: None,
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
    /// reference.docx 里 Heading1 是 jc=center、sz=40，而模板界面上
    /// 「一级标题」显示的是左对齐 22pt。不补默认值的话，用户什么都没改
    /// 就已经预览左对齐、导出居中了。
    #[test]
    fn heading_styles_fall_back_to_frontend_defaults() {
        let heading1 = r#"<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1" /><w:pPr><w:keepNext /><w:outlineLvl w:val="0" /><w:jc w:val="center" /></w:pPr><w:rPr><w:sz w:val="40" /><w:szCs w:val="40" /></w:rPr></w:style>"#;
        let features = default_markdown_feature_config();

        let normalized = normalize_template_style_xml(heading1, &features, None, false);

        assert!(normalized.contains(r#"<w:jc w:val="left" />"#), "对齐应纠正为左对齐");
        assert!(!normalized.contains(r#"<w:jc w:val="center" />"#), "不应残留居中");
        assert!(normalized.contains(r#"<w:sz w:val="44" />"#), "字号应纠正为 22pt");
        assert!(normalized.contains(r#"<w:szCs w:val="44" />"#), "复杂文本字号要一起改");
        // 大纲级别不能被顺手抹掉，否则 Word 的导航窗格会失效。
        assert!(normalized.contains(r#"<w:outlineLvl w:val="0" />"#), "应保留大纲级别");
        assert!(normalized.contains("<w:keepNext />"), "应保留段中不分页");
    }

}
