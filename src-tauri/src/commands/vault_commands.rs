use crate::core::config::{load_config, save_config, MAX_RECENT_VAULTS};
use crate::core::vault::{
    canonical_root, copy_entry, copy_external_file, create_entry, delete_entry, display_path,
    entry_absolute_path, import_image_data, import_image_from_path, list_entries, move_entry,
    read_file, rename_entry, search_files, write_file, VaultEntry, VaultFileContent,
    VaultImageImport, VaultListing, VaultSearchOptions, VaultSearchResponse, VaultWriteResult,
};
use crate::system::vault_watcher::VaultWatcherState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use std::io::Write;
use tauri::{AppHandle, State};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 每个命令都自己重新规范化一次 root，而不是信任前端传回来的字符串。
///
/// 前端拿到的是剥掉 `\\?\` 的展示形式，直接拿它当边界基准会让所有 `starts_with`
/// 比较失去意义——必须回到 `canonicalize` 的规范形式才能保证同一个目录只有一种写法。
fn resolve_root(raw: &str) -> Result<std::path::PathBuf, String> {
    canonical_root(raw)
}

/// 打开目录：列出内容，并把它记进最近使用列表。
///
/// 记录的是规范化后的展示路径，避免同一个目录因为大小写或短名不同在列表里出现多条。
#[tauri::command]
pub async fn open_vault(
    app: AppHandle,
    watcher_state: State<'_, VaultWatcherState>,
    path: String,
) -> Result<VaultListing, String> {
    let root = resolve_root(&path)?;
    let listing_root = root.clone();
    let listing = tauri::async_runtime::spawn_blocking(move || list_entries(&listing_root, None, true))
        .await
        .map_err(|error| format!("LOCKED|打开目录任务失败：{error}"))??;
    remember_vault(&display_path(&root));
    if let Err(error) = crate::system::vault_watcher::watch_vault(
        &watcher_state,
        &app,
        &root,
        listing.root.clone(),
    ) {
        eprintln!("Failed to watch vault: {error}");
    }
    Ok(listing)
}

#[tauri::command]
pub async fn list_vault_entries(
    root: String,
    dir: Option<String>,
    recursive: bool,
) -> Result<VaultListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_root(&root)?;
        list_entries(&root, dir.as_deref(), recursive)
    })
    .await
    .map_err(|error| format!("LOCKED|读取目录任务失败：{error}"))?
}

#[tauri::command]
pub async fn read_vault_file(root: String, path: String) -> Result<VaultFileContent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_root(&root)?;
        read_file(&root, &path)
    })
    .await
    .map_err(|error| format!("LOCKED|读取文件任务失败：{error}"))?
}

#[tauri::command]
pub async fn search_vault(
    root: String,
    query: String,
    options: VaultSearchOptions,
) -> Result<VaultSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_root(&root)?;
        search_files(&root, &query, &options)
    })
    .await
    .map_err(|error| format!("LOCKED|搜索文件任务失败：{error}"))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn write_vault_file(
    root: String,
    path: String,
    content: String,
    eol: String,
    has_bom: bool,
    expected_modified_ms: Option<u64>,
    allow_empty: bool,
) -> Result<VaultWriteResult, String> {
    let root = resolve_root(&root)?;
    write_file(
        &root,
        &path,
        &content,
        &eol,
        has_bom,
        expected_modified_ms,
        allow_empty,
    )
}

#[tauri::command]
pub fn create_vault_entry(
    root: String,
    parent_dir: Option<String>,
    name: String,
    is_dir: bool,
) -> Result<VaultEntry, String> {
    let root = resolve_root(&root)?;
    create_entry(&root, parent_dir.as_deref(), &name, is_dir)
}

#[tauri::command]
pub fn rename_vault_entry(
    root: String,
    path: String,
    new_name: String,
) -> Result<VaultEntry, String> {
    let root = resolve_root(&root)?;
    rename_entry(&root, &path, &new_name)
}

#[tauri::command]
pub fn move_vault_entry(
    root: String,
    path: String,
    target_dir: String,
) -> Result<VaultEntry, String> {
    let root = resolve_root(&root)?;
    move_entry(&root, &path, &target_dir)
}

#[tauri::command]
pub fn delete_vault_entry(root: String, path: String, recursive: bool) -> Result<(), String> {
    let root = resolve_root(&root)?;
    delete_entry(&root, &path, recursive)
}

/// 把目录置顶写进 `recent_vaults`。
///
/// 写配置失败（磁盘满、配置被占用）不该让「打开目录」这个操作整体失败——
/// 用户要的是看到文件树，最近列表只是便利功能，这里刻意吞掉错误。
fn remember_vault(root: &str) {
    let mut config = load_config();
    if config.vault_root.as_deref() == Some(root)
        && config.recent_vaults.first().map(String::as_str) == Some(root)
    {
        return;
    }

    let mut recent = Vec::with_capacity(MAX_RECENT_VAULTS);
    recent.push(root.to_string());
    for item in config.recent_vaults.iter() {
        if recent.len() >= MAX_RECENT_VAULTS {
            break;
        }
        if !item.eq_ignore_ascii_case(root) {
            recent.push(item.clone());
        }
    }

    config.vault_root = Some(root.to_string());
    config.recent_vaults = recent;
    let _ = save_config(config);
}

/// 只移除最近打开记录，不触碰磁盘目录，也不关闭当前已打开的仓库。
#[tauri::command]
pub fn remove_recent_vault(root: String) -> Result<(), String> {
    let mut config = load_config();
    let before = config.recent_vaults.len();
    config
        .recent_vaults
        .retain(|item| !item.eq_ignore_ascii_case(root.trim()));
    if config.recent_vaults.len() == before {
        return Ok(());
    }
    save_config(config).map(|_| ())
}

#[tauri::command]
pub fn copy_vault_entry(
    root: String,
    source_path: String,
    target_dir: String,
) -> Result<VaultEntry, String> {
    let root = resolve_root(&root)?;
    copy_entry(&root, &source_path, &target_dir)
}

#[tauri::command]
pub fn copy_external_vault_file(
    root: String,
    source_path: String,
    target_dir: String,
) -> Result<VaultEntry, String> {
    let root = resolve_root(&root)?;
    copy_external_file(&root, std::path::Path::new(&source_path), &target_dir)
}

#[tauri::command]
pub fn import_vault_image_from_path(
    root: String,
    markdown_path: String,
    source_path: String,
) -> Result<VaultImageImport, String> {
    let root = resolve_root(&root)?;
    import_image_from_path(&root, &markdown_path, &source_path)
}

#[tauri::command]
pub fn import_vault_image_data(
    root: String,
    markdown_path: String,
    data_base64: String,
    extension: String,
) -> Result<VaultImageImport, String> {
    let root = resolve_root(&root)?;
    import_image_data(&root, &markdown_path, &data_base64, &extension)
}

#[tauri::command]
pub fn paste_clipboard_image(root: String, target_dir: String) -> Result<Option<VaultEntry>, String> {
    let root = resolve_root(&root)?;
    #[cfg(windows)]
    {
        let script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image=[System.Windows.Forms.Clipboard]::GetImage(); if ($null -ne $image) { $stream=New-Object System.IO.MemoryStream; try { $image.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png); if ($stream.Length -gt 20971520) { throw '图片超过 20 MB，无法导入。' }; [Console]::Write([Convert]::ToBase64String($stream.ToArray())) } finally { $stream.Dispose(); $image.Dispose() } }";
        let output = hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output().map_err(|error| format!("读取剪贴板图片失败：{error}"))?;
        if !output.status.success() {
            return Err(format!("读取剪贴板图片失败：{}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let data = String::from_utf8_lossy(&output.stdout);
        if data.trim().is_empty() { return Ok(None); }
        return crate::core::vault::paste_image_data(&root, &target_dir, &data).map(Some);
    }
    #[cfg(not(windows))]
    {
        let _ = (root, target_dir);
        Err("图片剪贴板当前仅支持 Windows。".to_string())
    }
}

#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); [System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [Console]::WriteLine($_) }";
        let output = hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|error| format!("读取剪贴板失败：{error}"))?;
        if !output.status.success() {
            return Err(format!(
                "读取剪贴板失败：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        return Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string)
            .collect());
    }

    #[cfg(not(windows))]
    {
        Err("从文件管理器粘贴文档当前仅支持 Windows。".to_string())
    }
}

#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let script = format!(
            "$ErrorActionPreference='Stop'; Set-Clipboard -Value {}",
            powershell_single_quoted(&text)
        );
        let output = hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|error| format!("写入剪贴板失败：{error}"))?;
        if output.status.success() {
            return Ok(());
        }

        // PowerShell 的 Set-Clipboard 在部分 WebView/系统会话中会无声失败，
        // 使用系统自带 clip.exe 作为可靠回退，覆盖文件树右键菜单的所有入口。
        use std::process::Stdio;
        let mut clip = Command::new("clip.exe")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| format!("写入剪贴板失败：{error}"))?;
        clip.stdin
            .take()
            .ok_or_else(|| "写入剪贴板失败：无法打开剪贴板输入".to_string())?
            .write_all(text.as_bytes())
            .map_err(|error| format!("写入剪贴板失败：{error}"))?;
        let fallback = clip
            .wait_with_output()
            .map_err(|error| format!("写入剪贴板失败：{error}"))?;
        if fallback.status.success() {
            return Ok(());
        }
        return Err(format!("写入剪贴板失败：{}", String::from_utf8_lossy(&output.stderr).trim()));
    }

    #[cfg(not(windows))]
    {
        let _ = text;
        Err("文本复制剪贴板当前仅支持 Windows。".to_string())
    }
}

#[tauri::command]
pub fn set_vault_entry_clipboard(root: String, paths: Vec<String>) -> Result<(), String> {
    let root = resolve_root(&root)?;
    if paths.is_empty() {
        return Err("没有可复制的文件或文件夹。".to_string());
    }
    let absolutes = paths
        .iter()
        .map(|path| entry_absolute_path(&root, path))
        .collect::<Result<Vec<_>, _>>()?;

    #[cfg(windows)]
    {
        let escaped_paths = absolutes
            .iter()
            .map(|path| powershell_single_quoted(&display_path(path)))
            .collect::<Vec<_>>()
            .join(", ");
        let script = format!(
            "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $files=New-Object System.Collections.Specialized.StringCollection; $files.AddRange([string[]]@({escaped_paths})); [System.Windows.Forms.Clipboard]::SetFileDropList($files)"
        );
        let output = hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|error| format!("写入剪贴板失败：{error}"))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(format!(
            "写入剪贴板失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    #[cfg(not(windows))]
    {
        let _ = absolutes;
        Err("文件复制剪贴板当前仅支持 Windows。".to_string())
    }
}

#[cfg(windows)]
fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(windows)]
fn hidden_powershell_command() -> Command {
    let mut command = Command::new("powershell.exe");
    command.arg("-Sta");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    #[ignore = "writes the real Windows clipboard; run explicitly with clipboard backup"]
    fn windows_clipboard_file_and_image_roundtrip() {
        use super::*;
        use std::fs;
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("mdking-clipboard-{}-{unique}", std::process::id()));
        fs::create_dir_all(directory.join("vault/目标")).unwrap();
        fs::create_dir_all(directory.join("vault/已移动")).unwrap();
        fs::create_dir_all(directory.join("external")).unwrap();
        let root = directory.join("vault").to_string_lossy().to_string();
        fs::write(directory.join("vault/说明.md"), "markdown").unwrap();
        set_vault_entry_clipboard(root.clone(), vec!["说明.md".into()]).unwrap();
        let paths = read_clipboard_file_paths().unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0], display_path(&fs::canonicalize(directory.join("vault/说明.md")).unwrap()));
        assert_eq!(fs::canonicalize(&paths[0]).unwrap(), fs::canonicalize(directory.join("vault/说明.md")).unwrap());
        let copied = copy_vault_entry(root.clone(), "说明.md".into(), "目标".into()).unwrap();
        assert_eq!(copied.path, "目标/说明.md");
        let moved = move_vault_entry(root.clone(), "目标/说明.md".into(), "已移动".into()).unwrap();
        assert_eq!(moved.path, "已移动/说明.md");
        assert!(!directory.join("vault/目标/说明.md").exists());
        for name in ["外部.txt", "外部.md", "外部.png"] {
            let source = directory.join("external").join(name);
            fs::write(&source, b"external").unwrap();
            let script = format!("Add-Type -AssemblyName System.Windows.Forms; $files=New-Object System.Collections.Specialized.StringCollection; $files.Add({}) > $null; [System.Windows.Forms.Clipboard]::SetFileDropList($files)", powershell_single_quoted(&source.to_string_lossy()));
            assert!(hidden_powershell_command().args(["-NoProfile", "-Command", &script]).status().unwrap().success());
            let paths = read_clipboard_file_paths().unwrap();
            assert_eq!(paths.len(), 1);
            let entry = copy_external_vault_file(root.clone(), paths[0].clone(), "目标".into()).unwrap();
            assert_eq!(fs::read(directory.join("vault").join(entry.path)).unwrap(), b"external");
        }
        let script = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image=New-Object System.Drawing.Bitmap 2,2; try { $image.SetPixel(0,0,[System.Drawing.Color]::Red); [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }";
        assert!(hidden_powershell_command().args(["-NoProfile", "-Command", script]).status().unwrap().success());
        assert!(read_clipboard_file_paths().unwrap().is_empty());
        let entry = paste_clipboard_image(root, "目标".into()).unwrap().unwrap();
        let image = fs::read(directory.join("vault").join(entry.path)).unwrap();
        assert!(image.starts_with(b"\x89PNG\r\n\x1a\n"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn quotes_text_for_powershell_clipboard_command() {
        assert_eq!(
            super::powershell_single_quoted("C:\\用户\\O'Brien.md"),
            "'C:\\用户\\O''Brien.md'"
        );
    }
}

#[tauri::command]
pub fn show_in_explorer(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return Err("文件或目录不存在。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开资源管理器：{}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开访达：{}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux 上尝试使用 xdg-open 打开父目录
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("无法打开文件管理器：{}", e))?;
        }
    }

    Ok(())
}
