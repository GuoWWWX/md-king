use crate::core::config::{load_config, save_config, MAX_RECENT_VAULTS};
use crate::core::vault::{
    canonical_root, create_entry, delete_entry, display_path, list_entries, read_file,
    move_entry, rename_entry, write_file, copy_entry, VaultEntry, VaultFileContent, VaultListing, VaultWriteResult,
};

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
pub fn open_vault(path: String) -> Result<VaultListing, String> {
    let root = resolve_root(&path)?;
    let listing = list_entries(&root, None, true)?;
    remember_vault(&display_path(&root));
    Ok(listing)
}

#[tauri::command]
pub fn list_vault_entries(
    root: String,
    dir: Option<String>,
    recursive: bool,
) -> Result<VaultListing, String> {
    let root = resolve_root(&root)?;
    list_entries(&root, dir.as_deref(), recursive)
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
