#[cfg(windows)]
const LEGACY_FILE_CLASS: &str = "Markdown 文档";

#[cfg(windows)]
const LEGACY_BACKUP_VALUES: [&str; 2] = ["Markdown 文档_backup", "Markdown_backup"];

#[cfg(windows)]
pub fn release_legacy_file_associations() -> Result<bool, String> {
    use std::io::ErrorKind;

    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let command_path = format!(r"Software\Classes\{}\shell\open\command", LEGACY_FILE_CLASS);
    let command = match hkcu
        .open_subkey(command_path)
        .and_then(|key| key.get_value::<String, _>(""))
    {
        Ok(command) => command,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("读取旧 Markdown 文件关联失败：{error}")),
    };
    if !is_legacy_md_king_command(&command) {
        return Ok(false);
    }

    let mut changed = false;
    for extension in ["md", "markdown"] {
        let extension_path = format!(r"Software\Classes\.{extension}");
        let key = match hkcu.open_subkey_with_flags(&extension_path, KEY_READ | KEY_WRITE) {
            Ok(key) => key,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("读取 .{extension} 文件关联失败：{error}")),
        };
        let current = key.get_value::<String, _>("").unwrap_or_default();
        if current != LEGACY_FILE_CLASS {
            continue;
        }

        let previous = LEGACY_BACKUP_VALUES.iter().find_map(|name| {
            key.get_value::<String, _>(*name)
                .ok()
                .filter(|value| value != LEGACY_FILE_CLASS)
        });
        match previous.as_deref() {
            Some(value) if !value.is_empty() => key
                .set_value("", &value)
                .map_err(|error| format!("恢复 .{extension} 文件关联失败：{error}"))?,
            _ => match key.delete_value("") {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("撤销 .{extension} 文件关联失败：{error}"));
                }
            },
        }
        for backup_name in LEGACY_BACKUP_VALUES {
            match key.delete_value(backup_name) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("清理 .{extension} 关联备份失败：{error}"));
                }
            }
        }
        changed = true;
    }

    if changed {
        let class_path = format!(r"Software\Classes\{LEGACY_FILE_CLASS}");
        match hkcu.delete_subkey_all(class_path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("清理旧 Markdown 文件类型失败：{error}")),
        }
        // 通知资源管理器重新读取扩展名关联与图标。
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }

    Ok(changed)
}

#[cfg(not(windows))]
pub fn release_legacy_file_associations() -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
fn is_legacy_md_king_command(command: &str) -> bool {
    command.to_ascii_lowercase().contains("md-king.exe")
}

#[cfg(all(test, windows))]
mod tests {
    use super::is_legacy_md_king_command;

    #[test]
    fn recognizes_only_md_king_open_commands() {
        assert!(is_legacy_md_king_command(r#"G:\md-king\md-king.exe "%1""#));
        assert!(!is_legacy_md_king_command(r#"C:\Tools\Typora.exe "%1""#));
    }
}
