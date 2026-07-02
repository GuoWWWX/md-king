use serde::{Deserialize, Serialize};
use std::fs;

use crate::storage::paths::history_path;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub input_path: String,
    pub output_path: Option<String>,
    pub template_id: Option<String>,
    pub status: String,
    pub duration_ms: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

pub fn list_history_items() -> Vec<HistoryItem> {
    let Ok(path) = history_path() else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };

    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_history_items(items: Vec<HistoryItem>) -> Result<Vec<HistoryItem>, String> {
    let path = history_path().map_err(|error| format!("获取历史路径失败：{error}"))?;
    let content = serde_json::to_string_pretty(&items).map_err(|error| format!("序列化历史失败：{error}"))?;
    fs::write(path, content).map_err(|error| format!("写入历史失败：{error}"))?;
    Ok(items)
}

pub fn clear_history_items() -> Result<Vec<HistoryItem>, String> {
    save_history_items(Vec::new())
}
