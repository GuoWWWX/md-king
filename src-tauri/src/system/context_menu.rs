use std::path::{Path, PathBuf};
use std::thread;

use chrono::Utc;
use tauri::AppHandle;

use crate::core::config::load_config;
use crate::core::convert::{convert_markdown, ConvertRequest};
use crate::core::history::{list_history_items, save_history_items, HistoryItem};
use crate::storage::paths::app_data_dir;

#[cfg(windows)]
const FILE_MENU_PATHS: [&str; 2] = [
    r"Software\Classes\SystemFileAssociations\.md\shell\MDKingConvert",
    r"Software\Classes\SystemFileAssociations\.markdown\shell\MDKingConvert",
];

#[cfg(windows)]
const BACKGROUND_MENU_PATHS: [&str; 2] = [
    r"Software\Classes\Directory\Background\shell\MDKingOpen",
    r"Software\Classes\DesktopBackground\Shell\MDKingOpen",
];

#[cfg(windows)]
pub fn sync_context_menu(enable: bool) -> Result<(), String> {
    if enable {
        register_context_menu()
    } else {
        unregister_context_menu()
    }
}

#[cfg(not(windows))]
pub fn sync_context_menu(_enable: bool) -> Result<(), String> {
    Ok(())
}

pub fn handle_startup_context_action(app: AppHandle) {
    let Some(input_path) = context_markdown_arg(std::env::args().skip(1).collect()) else {
        return;
    };

    thread::spawn(move || {
        write_context_log(&format!("start convert: {}", input_path.to_string_lossy()));
        let config = load_config();
        let output = context_output_path(&input_path, config.default_output_dir.as_deref());
        let request = ConvertRequest {
            input: input_path.to_string_lossy().to_string(),
            input_kind: Some("path".to_string()),
            source_path: None,
            output,
            template_id: Some(config.default_template_id),
            open_after_convert: Some(config.open_after_convert),
            overwrite: None,
            conflict_strategy: Some(config.default_conflict_strategy),
        };
        let result = convert_markdown(&app, request);
        write_context_log(&format!(
            "finish convert: ok={}, error={:?}, message={:?}, output={:?}",
            result.ok, result.error_code, result.message, result.output
        ));
        let now = Utc::now().to_rfc3339();
        let mut history = list_history_items();
        history.insert(
            0,
            HistoryItem {
                id: format!("context-{}", Utc::now().timestamp_millis()),
                input_path: result.input.clone(),
                output_path: result.output.clone(),
                template_id: result.template_id.clone(),
                status: if result.ok { "success" } else { "failed" }.to_string(),
                duration_ms: Some(result.duration_ms),
                error_code: result.error_code.clone(),
                error_message: if result.ok {
                    None
                } else {
                    result.message.clone()
                },
                created_at: now.clone(),
                finished_at: Some(now),
            },
        );
        history.truncate(20);
        if let Err(error) = save_history_items(history) {
            write_context_log(&format!("save history failed: {error}"));
        }
        app.exit(0);
    });
}

fn write_context_log(message: &str) {
    let Ok(dir) = app_data_dir() else {
        return;
    };
    let path = dir.join("context-menu.log");
    let line = format!("{} {message}\n", Utc::now().to_rfc3339());
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(line.as_bytes())
        });
}

fn context_markdown_arg(args: Vec<String>) -> Option<PathBuf> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--convert" {
            return iter
                .next()
                .map(PathBuf::from)
                .filter(|path| is_markdown_path(path));
        }
    }
    None
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn context_output_path(input_path: &Path, default_output_dir: Option<&str>) -> Option<String> {
    let output_dir = default_output_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let stem = input_path.file_stem()?.to_str()?;
    Some(
        PathBuf::from(output_dir)
            .join(format!("{stem}.docx"))
            .to_string_lossy()
            .to_string(),
    )
}

#[cfg(windows)]
fn register_context_menu() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = std::env::current_exe().map_err(|error| format!("获取当前程序路径失败：{error}"))?;
    let exe = exe.to_string_lossy().to_string();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    for path in FILE_MENU_PATHS {
        let (key, _) = hkcu
            .create_subkey(path)
            .map_err(|error| format!("写入右键菜单失败：{error}"))?;
        key.set_value("", &"用 MD King 转换为 Word")
            .map_err(|error| format!("写入右键菜单名称失败：{error}"))?;
        key.set_value("Icon", &exe)
            .map_err(|error| format!("写入右键菜单图标失败：{error}"))?;

        let (command_key, _) = hkcu
            .create_subkey(format!(r"{path}\command"))
            .map_err(|error| format!("写入右键菜单命令失败：{error}"))?;
        command_key
            .set_value("", &format!("\"{exe}\" --convert \"%1\""))
            .map_err(|error| format!("写入右键菜单命令失败：{error}"))?;
    }

    for path in BACKGROUND_MENU_PATHS {
        let (key, _) = hkcu
            .create_subkey(path)
            .map_err(|error| format!("写入桌面右键菜单失败：{error}"))?;
        key.set_value("", &"打开 MD King")
            .map_err(|error| format!("写入桌面右键菜单名称失败：{error}"))?;
        key.set_value("Icon", &exe)
            .map_err(|error| format!("写入桌面右键菜单图标失败：{error}"))?;

        let (command_key, _) = hkcu
            .create_subkey(format!(r"{path}\command"))
            .map_err(|error| format!("写入桌面右键菜单命令失败：{error}"))?;
        command_key
            .set_value("", &format!("\"{exe}\""))
            .map_err(|error| format!("写入桌面右键菜单命令失败：{error}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn unregister_context_menu() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for path in FILE_MENU_PATHS.into_iter().chain(BACKGROUND_MENU_PATHS) {
        match hkcu.delete_subkey_all(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("移除右键菜单失败：{error}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{context_markdown_arg, context_output_path};
    use std::path::Path;

    #[test]
    fn reads_explicit_convert_argument() {
        let path = context_markdown_arg(vec![
            "--convert".to_string(),
            r"C:\Docs\demo.md".to_string(),
        ])
        .expect("expected markdown path");

        assert_eq!(path.to_string_lossy(), r"C:\Docs\demo.md");
    }

    #[test]
    fn ignores_plain_markdown_argument() {
        let path = context_markdown_arg(vec![r"C:\Docs\demo.markdown".to_string()]);

        assert!(path.is_none());
    }

    #[test]
    fn builds_context_output_inside_default_output_dir() {
        let output = context_output_path(
            Path::new(r"C:\Docs\demo.md"),
            Some(r"C:\Users\gyx\Documents\MD King"),
        )
        .expect("expected output path");

        assert_eq!(output, r"C:\Users\gyx\Documents\MD King\demo.docx");
    }
}
