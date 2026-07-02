use crate::core::history::{clear_history_items, list_history_items, save_history_items, HistoryItem};

#[tauri::command]
pub fn list_history() -> Vec<HistoryItem> {
    list_history_items()
}

#[tauri::command]
pub fn save_history(history: Vec<HistoryItem>) -> Result<Vec<HistoryItem>, String> {
    save_history_items(history)
}

#[tauri::command]
pub fn clear_history() -> Result<Vec<HistoryItem>, String> {
    clear_history_items()
}
