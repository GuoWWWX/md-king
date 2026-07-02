use tauri::AppHandle;

use crate::core::pandoc::{check_pandoc_available, PandocStatus};
use crate::system::open_file::open_path;

#[tauri::command]
pub fn check_pandoc(app: AppHandle) -> PandocStatus {
    check_pandoc_available(&app)
}

#[tauri::command]
pub fn open_output_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("打开路径不能为空。".to_string());
    }

    open_path(trimmed)
}
