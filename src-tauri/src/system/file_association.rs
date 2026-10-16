#[cfg(windows)]
const LEGACY_FILE_CLASS: &str = "Markdown 文档";

#[cfg(windows)]
const LEGACY_BACKUP_VALUES: [&str; 2] = ["Markdown 文档_backup", "Markdown_backup"];

#[cfg(windows)]
const MARKDOWN_PROG_ID: &str = "md-king.Markdown";

#[cfg(windows)]
const MARKDOWN_EXTENSIONS: [&str; 2] = [".md", ".markdown"];

#[cfg(windows)]
pub fn register_markdown_open_with() -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = std::env::current_exe()
        .map_err(|error| format!("读取 Markdown 打开程序路径失败：{error}"))?;
    let icon = exe.with_file_name("markdown.ico");
    if !icon.is_file() {
        return Err(format!("Markdown 文档图标不存在：{}", icon.display()));
    }
    register_markdown_open_with_at(&RegKey::predef(HKEY_CURRENT_USER), &exe, &icon)
        .map_err(|error| format!("注册 Markdown 打开方式失败：{error}"))?;
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn register_markdown_open_with() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn register_markdown_open_with_at(
    root: &winreg::RegKey,
    exe: &std::path::Path,
    icon: &std::path::Path,
) -> std::io::Result<()> {
    let command = format!(r#""{}" "%1""#, exe.display());
    let document_icon = format!(r#""{}",0"#, icon.display());
    let application_icon = format!(r#""{}",0"#, exe.display());
    let (classes, _) = root.create_subkey(r"Software\Classes")?;
    let (prog_id, _) = classes.create_subkey(MARKDOWN_PROG_ID)?;
    prog_id.set_value("", &"Markdown 文档")?;
    for (path, name, value) in [
        ("DefaultIcon", "", document_icon.as_str()),
        (r"shell\open\command", "", command.as_str()),
        ("Application", "ApplicationName", "md-king"),
        ("Application", "ApplicationIcon", application_icon.as_str()),
    ] {
        prog_id.create_subkey(path)?.0.set_value(name, &value)?;
    }
    let (application, _) = classes.create_subkey(r"Applications\md-king.exe")?;
    application.set_value("FriendlyAppName", &"md-king")?;
    application
        .create_subkey("DefaultIcon")?
        .0
        .set_value("", &document_icon)?;
    application
        .create_subkey(r"shell\open\command")?
        .0
        .set_value("", &command)?;
    let (supported_types, _) = application.create_subkey("SupportedTypes")?;
    for extension in MARKDOWN_EXTENSIONS {
        supported_types.set_value(extension, &"")?;
        // Offer md-king as a candidate; the user chooses the default in Windows.
        classes
            .create_subkey(format!(r"{extension}\OpenWithProgids"))?
            .0
            .set_value(MARKDOWN_PROG_ID, &"")?;
    }
    Ok(())
}

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
    use super::{is_legacy_md_king_command, register_markdown_open_with_at, MARKDOWN_PROG_ID};
    use std::path::Path;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    #[test]
    fn recognizes_only_md_king_open_commands() {
        assert!(is_legacy_md_king_command(r#"G:\md-king\md-king.exe "%1""#));
        assert!(!is_legacy_md_king_command(r#"C:\Tools\Typora.exe "%1""#));
    }

    #[test]
    fn registers_open_with_and_document_icon_without_changing_defaults() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let test_path = format!(
            r"Software\md-king\Tests\FileAssociation-{}",
            std::process::id()
        );
        let (root, _) = hkcu.create_subkey(&test_path).unwrap();
        let (extension, _) = root.create_subkey(r"Software\Classes\.md").unwrap();
        extension.set_value("", &"OtherEditor.Markdown").unwrap();
        extension
            .create_subkey("OpenWithProgids")
            .unwrap()
            .0
            .set_value("OtherEditor.Markdown", &"")
            .unwrap();
        let choice_path =
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice";
        let (choice, _) = root.create_subkey(choice_path).unwrap();
        choice.set_value("ProgId", &"OtherEditor.Markdown").unwrap();
        choice.set_value("Hash", &"unchanged-user-choice").unwrap();
        let exe = Path::new(r"G:\工具 软件\md-king\md-king.exe");
        let icon = Path::new(r"G:\工具 软件\md-king\markdown.ico");

        register_markdown_open_with_at(&root, exe, icon).unwrap();
        register_markdown_open_with_at(&root, exe, icon).unwrap();

        let classes = root.open_subkey(r"Software\Classes").unwrap();
        for extension in [".md", ".markdown"] {
            let candidates = classes
                .open_subkey(format!(r"{extension}\OpenWithProgids"))
                .unwrap();
            assert_eq!(
                candidates.get_value::<String, _>(MARKDOWN_PROG_ID).unwrap(),
                ""
            );
            assert_eq!(
                classes
                    .open_subkey(r"Applications\md-king.exe\SupportedTypes")
                    .unwrap()
                    .get_value::<String, _>(extension)
                    .unwrap(),
                ""
            );
        }
        let expected_command = r#""G:\工具 软件\md-king\md-king.exe" "%1""#;
        for handler in [MARKDOWN_PROG_ID, r"Applications\md-king.exe"] {
            assert_eq!(
                classes
                    .open_subkey(format!(r"{handler}\shell\open\command"))
                    .unwrap()
                    .get_value::<String, _>("")
                    .unwrap(),
                expected_command
            );
            assert_eq!(
                classes
                    .open_subkey(format!(r"{handler}\DefaultIcon"))
                    .unwrap()
                    .get_value::<String, _>("")
                    .unwrap(),
                r#""G:\工具 软件\md-king\markdown.ico",0"#
            );
        }
        assert_eq!(
            extension.get_value::<String, _>("").unwrap(),
            "OtherEditor.Markdown"
        );
        assert!(classes
            .open_subkey(".markdown")
            .unwrap()
            .get_value::<String, _>("")
            .is_err());
        assert!(extension
            .open_subkey("OpenWithProgids")
            .unwrap()
            .get_value::<String, _>("OtherEditor.Markdown")
            .is_ok());
        assert_eq!(
            choice.get_value::<String, _>("ProgId").unwrap(),
            "OtherEditor.Markdown"
        );
        assert_eq!(
            choice.get_value::<String, _>("Hash").unwrap(),
            "unchanged-user-choice"
        );
        hkcu.delete_subkey_all(test_path).unwrap();
    }
}
