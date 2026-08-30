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

            let app = app.clone();
            std::thread::spawn(move || handle_quick_paste(app));
        })
        .map_err(|_| {
            format!(
                "快捷键「{shortcut}」注册失败，可能已被系统或其他软件占用，请换一个组合后再保存。"
            )
        })?;

    Ok(())
}

fn handle_quick_paste(app: AppHandle) {
    if QUICK_PASTE_RUNNING.swap(true, Ordering::SeqCst) {
        emit_status(&app, "info", "快捷粘贴正在处理中，请稍候。");
        return;
    }

    emit_status(&app, "info", "正在把剪贴板 Markdown 转为 Word/WPS 格式...");
    let result = quick_paste_inner(&app);
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

fn quick_paste_inner(app: &AppHandle) -> Result<(), String> {
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

    let request = ConvertRequest {
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
        update_fields: None,
    };
    let convert_result = convert_markdown(app, request);
    let _ = fs::remove_file(&input_path);

    if !convert_result.ok {
        return Err(convert_result
            .message
            .unwrap_or_else(|| "剪贴板 Markdown 转换失败。".to_string()));
    }

    insert_docx_into_word_or_wps(&output_path)?;
    let _ = fs::remove_file(&output_path);
    Ok(())
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

fn read_clipboard_text() -> Result<String, String> {
    #[cfg(windows)]
    {
        let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw";
        let output = hidden_powershell_command()
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
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

fn insert_docx_into_word_or_wps(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let script = insert_docx_script(path);
        let encoded = encode_powershell_command(&script);
        let output = hidden_powershell_command()
            .args([
                "-NoProfile",
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
        let _ = path;
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
fn insert_docx_script(path: &Path) -> String {
    let escaped_path = path.to_string_lossy().replace('\'', "''");
    format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
  $path = '{escaped_path}'
  $progIds = @('Word.Application', 'KWPS.Application', 'WPS.Application', 'kwps.Application', 'wps.Application')
  foreach ($progId in $progIds) {{
    try {{
      $office = [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
      if ($null -ne $office) {{
        $selection = $office.Selection
        if ($null -eq $selection) {{
          throw '未找到当前光标位置'
        }}
        $selection.InsertFile($path)
        exit 0
      }}
    }} catch {{
      $null = $_
    }}
  }}
  throw '没有找到正在运行的 Word/WPS，请先打开文档并把光标放到插入位置。'
}} catch {{
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}}
"#
    )
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
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_quick_paste_shortcut_is_parseable() {
        assert!(Shortcut::from_str("Ctrl+Alt+V").is_ok());
    }
}
