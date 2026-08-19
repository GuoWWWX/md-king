use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::core::convert::{
    convert_markdown as convert_markdown_core, ConvertRequest, ConvertResult,
};

#[tauri::command]
pub async fn convert_markdown(
    app: AppHandle,
    request: ConvertRequest,
) -> Result<ConvertResult, String> {
    tauri::async_runtime::spawn_blocking(move || convert_markdown_core(&app, request))
        .await
        .map_err(|error| format!("转换后台任务异常：{error}"))
}

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_file() || !is_supported_text_path(&path) {
        return Err("请选择存在的 .md、.markdown 或 .txt 文件。".to_string());
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
        .unwrap_or(path);
    let path = percent_decode(path);
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

/// 还原 Markdown 图片链接里的百分号转义。
///
/// 此前只 `replace("%20", " ")`，于是「中文名.png」这类被编辑器写成 `%E4%B8%AD...`
/// 的路径找不到文件——预览缺图，导出却正常（Pandoc 自己会解码），两边对不上。
///
/// 逐字节解码而不是逐字符：一个中文字在 UTF-8 里是三个 `%XX`，必须先把字节收齐
/// 再整体转字符串。遇到不成对的 `%`（比如 Windows 路径里真的有个百分号）就原样保留，
/// 解码结果不是合法 UTF-8 时整体退回原字符串，宁可不解码也不要给出一个错的路径。
fn percent_decode(input: &str) -> String {
    if !input.contains('%') {
        return input.to_string();
    }

    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded).unwrap_or_else(|_| input.to_string())
}

fn is_supported_text_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
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

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_spaces_and_multibyte_sequences() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("%E4%B8%AD%E6%96%87.png"), "中文.png");
        assert_eq!(percent_decode("plain.png"), "plain.png");
    }

    #[test]
    fn keeps_malformed_escapes_verbatim() {
        // 结尾的孤立 % 和非十六进制的 %ZZ 都要原样留下，不能吞掉字符。
        assert_eq!(percent_decode("100%.png"), "100%.png");
        assert_eq!(percent_decode("a%ZZb.png"), "a%ZZb.png");
        assert_eq!(percent_decode("tail%2"), "tail%2");
        // 解码后不是合法 UTF-8 时整体退回，避免给出一个错的路径。
        assert_eq!(percent_decode("bad%FF.png"), "bad%FF.png");
    }
}

/// 接收前端栅格化好的图片（base64），落到临时目录后返回路径。
/// Mermaid 图走这条路：DOCX 不支持 SVG，必须先转成 PNG 再交给 Pandoc。
#[tauri::command]
pub fn write_temp_image(data_base64: String, extension: Option<String>) -> Result<String, String> {
    // 前端可能直接把整个 data URL 传过来，容错地剥掉前缀。
    let payload = data_base64
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&data_base64);

    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("图片数据解码失败：{error}"))?;

    if bytes.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20 MB，无法写入。".to_string());
    }

    crate::core::convert::write_temp_image(&bytes, extension.as_deref().unwrap_or("png"))
}

#[cfg(test)]
mod temp_image_tests {
    use super::*;

    #[test]
    fn writes_temp_image_and_rejects_bad_payload() {
        // 带 data URL 前缀也要能吃下：前端有时直接把 canvas.toDataURL 的结果传过来。
        let png_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+AVjKAAAAAElFTkSuQmCC";
        let path = write_temp_image(png_1x1.to_string(), Some("png".to_string()))
            .expect("valid base64 should be written");
        assert!(std::path::Path::new(&path).is_file());
        assert!(path.ends_with(".png"));
        let _ = std::fs::remove_file(&path);

        // 非法 base64 必须拒绝，不能落一个坏文件让 Pandoc 去踩。
        assert!(write_temp_image("not-base64!!".to_string(), None).is_err());

        // 扩展名只放行字母数字，防止路径注入。
        let path = write_temp_image(png_1x1.to_string(), Some("../evil".to_string()))
            .expect("bad extension should fall back to png");
        assert!(path.ends_with(".png"));
        let _ = std::fs::remove_file(&path);
    }
}
