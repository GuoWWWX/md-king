use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::core::config::load_config;

const BUNDLED_PANDOC_RESOURCE_PATH: &str = "pandoc/windows/pandoc.exe";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error_code: Option<String>,
    pub message: Option<String>,
}

pub struct PandocExecution {
    pub success: bool,
    pub status_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Default)]
pub struct PandocDocumentOptions {
    pub toc: bool,
    pub toc_depth: Option<u8>,
    pub resource_path: Option<PathBuf>,
}

struct ResolvedPandocPath {
    path: PathBuf,
    source: PandocSource,
}

#[derive(Clone, Copy)]
enum PandocSource {
    Bundled,
    Custom,
    System,
}

pub fn check_pandoc_available(app: &AppHandle) -> PandocStatus {
    let resolved = resolve_pandoc_path(app);
    check_resolved_pandoc_available(resolved)
}

pub fn check_pandoc_available_cli() -> PandocStatus {
    let resolved = resolve_pandoc_path_cli();
    check_resolved_pandoc_available(resolved)
}

fn check_resolved_pandoc_available(resolved: ResolvedPandocPath) -> PandocStatus {
    match run_pandoc_version_with_retry(&resolved.path) {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().map(str::to_string);
            let source_label = resolved.source.label();

            PandocStatus {
                available: true,
                version,
                path: Some(resolved.path.to_string_lossy().to_string()),
                error_code: None,
                message: Some(format!("已检测到{source_label}Pandoc。")),
            }
        }
        Ok(output) => PandocStatus {
            available: false,
            version: None,
            path: Some(resolved.path.to_string_lossy().to_string()),
            error_code: Some("PANDOC_EXIT_FAILED".to_string()),
            message: Some(format_process_output(
                output.status.code(),
                &resolved.path,
                &String::from_utf8_lossy(&output.stdout),
                &String::from_utf8_lossy(&output.stderr),
            )),
        },
        Err(error) => PandocStatus {
            available: false,
            version: None,
            path: Some(resolved.path.to_string_lossy().to_string()),
            error_code: Some("PANDOC_NOT_FOUND".to_string()),
            message: Some(format!(
                "未检测到{}Pandoc：{error}",
                resolved.source.label()
            )),
        },
    }
}

fn run_pandoc_version_with_retry(path: &Path) -> io::Result<Output> {
    let mut last_output = pandoc_command(path).arg("--version").output()?;
    for _ in 0..2 {
        if !is_retryable_pandoc_start_failure(&last_output) {
            return Ok(last_output);
        }
        thread::sleep(Duration::from_millis(900));
        last_output = pandoc_command(path).arg("--version").output()?;
    }
    Ok(last_output)
}

fn pandoc_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn is_retryable_pandoc_start_failure(output: &Output) -> bool {
    matches!(output.status.code(), Some(-1073741502))
        && output.stdout.is_empty()
        && output.stderr.is_empty()
}

pub fn run_pandoc_to_docx(
    app: &AppHandle,
    input_path: &Path,
    output_path: &Path,
    reference_docx_path: Option<&Path>,
    options: &PandocDocumentOptions,
) -> io::Result<PandocExecution> {
    let resolved = resolve_pandoc_path(app);
    run_resolved_pandoc_to_docx(
        &resolved.path,
        input_path,
        output_path,
        reference_docx_path,
        options,
    )
}

pub fn run_pandoc_to_docx_cli(
    input_path: &Path,
    output_path: &Path,
    reference_docx_path: Option<&Path>,
    options: &PandocDocumentOptions,
) -> io::Result<PandocExecution> {
    let resolved = resolve_pandoc_path_cli();
    run_resolved_pandoc_to_docx(
        &resolved.path,
        input_path,
        output_path,
        reference_docx_path,
        options,
    )
}

fn run_resolved_pandoc_to_docx(
    pandoc_path: &Path,
    input_path: &Path,
    output_path: &Path,
    reference_docx_path: Option<&Path>,
    options: &PandocDocumentOptions,
) -> io::Result<PandocExecution> {
    let mut command = pandoc_command(pandoc_path);
    let input_arg = absolutize_path(input_path);
    let output_arg = absolutize_path(output_path);

    if let Some(input_dir) = input_arg
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        command.current_dir(input_dir);
    }

    command
        .arg(input_arg)
        .arg("--from")
        .arg("markdown+tex_math_dollars+tex_math_single_backslash+wikilinks_title_after_pipe")
        .arg("--highlight-style=tango")
        .arg("-o")
        .arg(output_arg);

    if let Some(reference_docx_path) = reference_docx_path {
        command
            .arg("--reference-doc")
            .arg(absolutize_path(reference_docx_path));
    }
    for arg in pandoc_document_option_args(options) {
        command.arg(arg);
    }

    let output = command.output()?;

    Ok(PandocExecution {
        success: output.status.success(),
        status_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn pandoc_document_option_args(options: &PandocDocumentOptions) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(resource_path) = options.resource_path.as_ref() {
        args.push(format!(
            "--resource-path={}",
            absolutize_path(resource_path).to_string_lossy()
        ));
    }
    if !options.toc {
        return args;
    }

    args.push("--toc".to_string());
    if let Some(depth) = options.toc_depth.filter(|depth| (1..=6).contains(depth)) {
        args.push(format!("--toc-depth={depth}"));
    }
    args
}

fn format_process_output(
    status_code: Option<i32>,
    program_path: &Path,
    stdout: &str,
    stderr: &str,
) -> String {
    let detail = stderr.trim();
    if !detail.is_empty() {
        return detail.to_string();
    }

    let stdout = stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }

    format!(
        "{} 退出但没有输出错误详情，状态码：{}",
        program_path.to_string_lossy(),
        status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    )
}

fn absolutize_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|current_dir| current_dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };

    strip_windows_extended_path_prefix(&absolute)
}

fn strip_windows_extended_path_prefix(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();

    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }

    if let Some(stripped) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    path.to_path_buf()
}

fn resolve_pandoc_path(app: &AppHandle) -> ResolvedPandocPath {
    let config = load_config();

    if let Some(custom_path) = config
        .pandoc_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return ResolvedPandocPath {
            path: strip_windows_extended_path_prefix(Path::new(custom_path)),
            source: PandocSource::Custom,
        };
    }

    if config.use_bundled_pandoc {
        if let Some(bundled_path) = bundled_pandoc_path(app) {
            return ResolvedPandocPath {
                path: strip_windows_extended_path_prefix(&bundled_path),
                source: PandocSource::Bundled,
            };
        }
    }

    ResolvedPandocPath {
        path: PathBuf::from("pandoc"),
        source: PandocSource::System,
    }
}

fn resolve_pandoc_path_cli() -> ResolvedPandocPath {
    let config = load_config();

    if let Some(custom_path) = config
        .pandoc_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return ResolvedPandocPath {
            path: strip_windows_extended_path_prefix(Path::new(custom_path)),
            source: PandocSource::Custom,
        };
    }

    if config.use_bundled_pandoc {
        if let Some(bundled_path) = bundled_pandoc_path_cli() {
            return ResolvedPandocPath {
                path: strip_windows_extended_path_prefix(&bundled_path),
                source: PandocSource::Bundled,
            };
        }
    }

    ResolvedPandocPath {
        path: PathBuf::from("pandoc"),
        source: PandocSource::System,
    }
}

fn bundled_pandoc_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve(BUNDLED_PANDOC_RESOURCE_PATH, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists() && path.is_file())
        .or_else(|| {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pandoc")
                .join("windows")
                .join("pandoc.exe");
            dev_path.exists().then_some(dev_path)
        })
}

fn bundled_pandoc_path_cli() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));

    exe_dir
        .as_ref()
        .map(|dir| dir.join(BUNDLED_PANDOC_RESOURCE_PATH))
        .filter(|path| path.exists() && path.is_file())
        .or_else(|| {
            exe_dir
                .as_ref()
                .map(|dir| dir.join("pandoc.exe"))
                .filter(|path| path.exists() && path.is_file())
        })
        .or_else(|| {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pandoc")
                .join("windows")
                .join("pandoc.exe");
            dev_path.exists().then_some(dev_path)
        })
}

impl PandocSource {
    fn label(self) -> &'static str {
        match self {
            PandocSource::Bundled => "内置",
            PandocSource::Custom => "自定义路径的",
            PandocSource::System => "系统",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        pandoc_document_option_args, strip_windows_extended_path_prefix, PandocDocumentOptions,
    };
    use std::path::Path;

    #[test]
    fn builds_toc_arguments_from_document_options() {
        let args = pandoc_document_option_args(&PandocDocumentOptions {
            toc: true,
            toc_depth: Some(3),
            resource_path: None,
        });

        assert_eq!(args, vec!["--toc", "--toc-depth=3"]);
        assert!(pandoc_document_option_args(&PandocDocumentOptions::default()).is_empty());
    }

    #[test]
    fn builds_resource_path_argument_from_document_options() {
        let args = pandoc_document_option_args(&PandocDocumentOptions {
            toc: false,
            toc_depth: None,
            resource_path: Some(Path::new(r"C:\docs\assets").to_path_buf()),
        });

        assert_eq!(args, vec![r"--resource-path=C:\docs\assets"]);
    }

    #[test]
    fn strips_windows_extended_path_prefixes_for_pandoc() {
        assert_eq!(
            strip_windows_extended_path_prefix(Path::new(r"\\?\C:\Users\gyx\file.docx"))
                .to_string_lossy(),
            r"C:\Users\gyx\file.docx"
        );
        assert_eq!(
            strip_windows_extended_path_prefix(Path::new(r"\\?\UNC\server\share\file.docx"))
                .to_string_lossy(),
            r"\\server\share\file.docx"
        );
    }

    #[test]
    fn strips_windows_extended_path_prefix_from_pandoc_executable() {
        let path = strip_windows_extended_path_prefix(Path::new(
            r"\\?\D:\Code\Project\AI\md-king\pandoc.exe",
        ));

        assert_eq!(
            path.to_string_lossy(),
            r"D:\Code\Project\AI\md-king\pandoc.exe"
        );
    }
}
