use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::core::convert::{
    convert_markdown as convert_markdown_core, ConvertRequest, ConvertResult,
};

#[tauri::command]
pub fn convert_markdown(app: AppHandle, request: ConvertRequest) -> ConvertResult {
    convert_markdown_core(&app, request)
}

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_file() || !is_markdown_path(&path) {
        return Err("请选择存在的 .md 或 .markdown 文件。".to_string());
    }

    let metadata =
        fs::metadata(&path).map_err(|error| format!("读取 Markdown 文件失败：{error}"))?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("Markdown 文件超过 20 MB，无法载入编辑区。".to_string());
    }

    fs::read_to_string(&path).map_err(|error| format!("读取 Markdown 文件失败：{error}"))
}

#[tauri::command]
pub fn load_preview_image(path: String, source_path: Option<String>) -> Result<String, String> {
    let image_path = resolve_preview_image_path(&path, source_path.as_deref())?;
    let mime = image_mime_type(&image_path)
        .ok_or_else(|| "预览仅支持 PNG、JPG、GIF、WebP、BMP 和 SVG 图片。".to_string())?;
    let metadata = fs::metadata(&image_path).map_err(|error| format!("读取图片失败：{error}"))?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20 MB，已跳过预览。".to_string());
    }
    let bytes = fs::read(&image_path).map_err(|error| format!("读取图片失败：{error}"))?;

    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn resolve_preview_image_path(path: &str, source_path: Option<&str>) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("图片路径不能为空。".to_string());
    }

    let path = path
        .strip_prefix("file:///")
        .or_else(|| path.strip_prefix("file://"))
        .unwrap_or(path)
        .replace("%20", " ");
    let candidate = PathBuf::from(path);
    let resolved = if candidate.is_absolute() {
        candidate
    } else if let Some(source_path) = source_path.map(PathBuf::from) {
        source_path
            .parent()
            .map(|parent| parent.join(&candidate))
            .unwrap_or(candidate)
    } else {
        candidate
    };

    resolved
        .is_file()
        .then_some(resolved)
        .ok_or_else(|| "图片文件不存在。".to_string())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        })
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}
