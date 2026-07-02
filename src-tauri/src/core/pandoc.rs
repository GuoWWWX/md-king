use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::core::config::load_config;

const BUNDLED_PANDOC_RESOURCE_PATH: &str = "pandoc/windows/pandoc.exe";

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
    match Command::new(&resolved.path).arg("--version").output() {
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
            message: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
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

pub fn run_pandoc_to_docx(
    app: &AppHandle,
    input_path: &Path,
    output_path: &Path,
    reference_docx_path: Option<&Path>,
) -> io::Result<PandocExecution> {
    let resolved = resolve_pandoc_path(app);
    let mut command = Command::new(&resolved.path);
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
        .arg("markdown+tex_math_dollars+tex_math_single_backslash")
        .arg("-o")
        .arg(output_arg);

    if let Some(reference_docx_path) = reference_docx_path {
        command
            .arg("--reference-doc")
            .arg(absolutize_path(reference_docx_path));
    }

    let output = command.output()?;

    Ok(PandocExecution {
        success: output.status.success(),
        status_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn absolutize_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|current_dir| current_dir.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        }
    })
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
            path: PathBuf::from(custom_path),
            source: PandocSource::Custom,
        };
    }

    if config.use_bundled_pandoc {
        if let Some(bundled_path) = bundled_pandoc_path(app) {
            return ResolvedPandocPath {
                path: bundled_path,
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

impl PandocSource {
    fn label(self) -> &'static str {
        match self {
            PandocSource::Bundled => "内置",
            PandocSource::Custom => "自定义路径的",
            PandocSource::System => "系统",
        }
    }
}
