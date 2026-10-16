use chrono::Utc;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::core::config::{load_config, AppConfig};
use crate::core::convert::{convert_markdown, ConvertRequest};
use crate::storage::paths::app_data_dir;

static QUICK_PASTE_RUNNING: AtomicBool = AtomicBool::new(false);

const QUICK_PASTE_EVENT: &str = "quick-paste://status";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickPasteEvent {
    level: String,
    message: String,
}

pub fn sync_quick_paste(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();

    if !config.enable_quick_paste {
        return Ok(());
    }

    let shortcut = config.quick_paste_shortcut.trim();
    if shortcut.is_empty() {
        return Err("快捷粘贴快捷键不能为空。".to_string());
    }
    if Shortcut::from_str(shortcut).is_err() {
        return Err(
            "快捷粘贴快捷键格式不正确，请使用类似 Ctrl+Alt+V 或 Ctrl+Alt+Shift+V 的格式。"
                .to_string(),
        );
    }

    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }

            #[cfg(windows)]
            let target_window = unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize
            };
            #[cfg(not(windows))]
            let target_window = 0;
            let app = app.clone();
            std::thread::spawn(move || handle_quick_paste(app, target_window));
        })
        .map_err(|_| {
            format!(
                "快捷键「{shortcut}」注册失败，可能已被系统或其他软件占用，请换一个组合后再保存。"
            )
        })?;

    Ok(())
}

fn handle_quick_paste(app: AppHandle, target_window: isize) {
    if QUICK_PASTE_RUNNING.swap(true, Ordering::SeqCst) {
        emit_status(&app, "info", "快捷粘贴正在处理中，请稍候。");
        return;
    }

    emit_status(&app, "info", "正在把剪贴板 Markdown 转为 Word/WPS 格式...");
    let result = quick_paste_inner(&app, target_window);
    QUICK_PASTE_RUNNING.store(false, Ordering::SeqCst);

    match result {
        Ok(()) => emit_status(
            &app,
            "success",
            "已按模板格式粘贴到当前 Word/WPS 光标位置。",
        ),
        Err(error) => emit_status(&app, "error", &error),
    }
}

fn quick_paste_inner(app: &AppHandle, target_window: isize) -> Result<(), String> {
    let markdown = read_clipboard_text()?;
    if markdown.trim().is_empty() {
        return Err("剪贴板里没有可粘贴的 Markdown 文本。".to_string());
    }

    let config = load_config();
    let template_id = config
        .quick_paste_template_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(config.default_template_id.as_str())
        .to_string();

    let work_dir = quick_paste_dir()?;
    let stem = format!("quick-paste-{}", Utc::now().timestamp_millis());
    let input_path = work_dir.join(format!("{stem}.md"));
    let output_path = work_dir.join(format!("{stem}.docx"));
    fs::write(&input_path, markdown).map_err(|error| format!("写入临时 Markdown 失败：{error}"))?;

    let request = quick_paste_request(&input_path, &output_path, template_id);
    let convert_result = convert_markdown(app, request);
    let _ = fs::remove_file(&input_path);

    if !convert_result.ok {
        return Err(convert_result
            .message
            .unwrap_or_else(|| "剪贴板 Markdown 转换失败。".to_string()));
    }

    let insert_result = insert_docx_into_word_or_wps(&output_path, target_window);
    let _ = fs::remove_file(&output_path);
    insert_result
}

fn quick_paste_request(input_path: &Path, output_path: &Path, template_id: String) -> ConvertRequest {
    ConvertRequest {
        input: input_path.to_string_lossy().to_string(),
        input_kind: Some("path".to_string()),
        source_path: None,
        output: Some(output_path.to_string_lossy().to_string()),
        template_id: Some(template_id),
        open_after_convert: Some(false),
        overwrite: Some(true),
        conflict_strategy: Some("overwrite".to_string()),
        heading_numbering: None,
        toc_page_numbers: None,
        update_fields: Some("none".to_string()),
        toc_depth: None,
        toc_position: Some("none".to_string()),
        body_page_start: None,
        front_page_number: None,
        mermaid_format: None,
        mermaid_scale: None,
        image_policy: None,
        no_compress_pictures: None,
        lint_only: None,
        strict: None,
    }
}

fn emit_status(app: &AppHandle, level: &str, message: &str) {
    let _ = app.emit(
        QUICK_PASTE_EVENT,
        QuickPasteEvent {
            level: level.to_string(),
            message: message.to_string(),
        },
    );
}

fn quick_paste_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败：{error}"))?
        .join("quick-paste");
    fs::create_dir_all(&dir).map_err(|error| format!("创建快捷粘贴临时目录失败：{error}"))?;
    Ok(dir)
}

pub(crate) fn read_clipboard_text() -> Result<String, String> {
    #[cfg(windows)]
    {
        let script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference='Stop'; try { $text=Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Write([string]$text) } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
        let encoded = encode_powershell_command(script);
        let output = hidden_powershell_command()
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                &encoded,
            ])
            .output()
            .map_err(|error| format!("读取剪贴板失败：{error}"))?;

        if !output.status.success() {
            return Err(format!(
                "读取剪贴板失败：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    #[cfg(not(windows))]
    {
        Err("快捷粘贴当前先支持 Windows 桌面端。".to_string())
    }
}

fn insert_docx_into_word_or_wps(path: &Path, target_window: isize) -> Result<(), String> {
    #[cfg(windows)]
    {
        let script = insert_docx_script(path, target_window);
        let encoded = encode_powershell_command(&script);
        let output = hidden_powershell_command()
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                &encoded,
            ])
            .output()
            .map_err(|error| format!("调用 Word/WPS 插入失败：{error}"))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if message.is_empty() {
            "插入 Word/WPS 失败，请先打开 Word/WPS 文档并把光标放到插入位置。".to_string()
        } else {
            message
        });
    }

    #[cfg(not(windows))]
    {
        let _ = (path, target_window);
        Err("快捷粘贴当前先支持 Windows 桌面端。".to_string())
    }
}

#[cfg(windows)]
fn hidden_powershell_command() -> Command {
    let mut command = Command::new("powershell.exe");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(windows)]
fn insert_docx_script(path: &Path, target_window: isize) -> String {
    let escaped_path = path.to_string_lossy().replace('\'', "''");
    include_str!("quick_paste_insert.ps1")
        .replace("__MD_KING_TARGET_WINDOW__", &target_window.to_string())
        .replace("__MD_KING_DOCX_PATH__", &escaped_path)
}

#[cfg(windows)]
fn encode_powershell_command(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    let mut output = String::with_capacity((bytes.len() + 2) / 3 * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;

        output.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::quick_paste_request;
    use std::path::Path;
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_quick_paste_shortcut_is_parseable() {
        assert!(Shortcut::from_str("Ctrl+Alt+V").is_ok());
    }

    #[test]
    fn quick_paste_overrides_template_toc_without_changing_selected_template() {
        let request = quick_paste_request(
            Path::new("input.md"),
            Path::new("output.docx"),
            "default-report".to_string(),
        );
        assert_eq!(request.toc_position.as_deref(), Some("none"));
        assert_eq!(request.template_id.as_deref(), Some("default-report"));
        assert_eq!(request.open_after_convert, Some(false));
        assert_eq!(request.update_fields.as_deref(), Some("none"));
    }

    #[cfg(windows)]
    #[test]
    fn powershell_reports_chinese_errors_as_utf8() {
        let path = std::env::temp_dir().join(format!(
            "md-king-missing-{}-{}.docx",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        assert!(!path.exists());
        let error = super::insert_docx_into_word_or_wps(&path, 0).unwrap_err();
        assert_eq!(error, "插入 Word/WPS 失败：待插入的临时文档已不存在，请重新复制 Markdown 后再试。");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "opens an isolated visible Word/WPS test window; requires Office installed"]
    fn inserts_into_the_target_office_window_and_preserves_errors() {
        use base64::Engine;
        let insert_script = base64::engine::general_purpose::STANDARD
            .encode(include_str!("quick_paste_insert.ps1").as_bytes());
        let script = include_str!("../../tests/quick_paste_office.ps1")
            .replace("__INSERT_SCRIPT_BASE64__", &insert_script);
        let encoded = super::encode_powershell_command(&script);
        let output = super::hidden_powershell_command()
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-EncodedCommand",
                &encoded,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
