use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;

use crate::storage::atomic::{timestamp_suffix, write_atomic};
use crate::storage::paths::history_path;

pub const MAX_HISTORY_ITEMS: usize = 10_000;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulated: Option<bool>,
}

pub fn list_history_items() -> Vec<HistoryItem> {
    let Ok(path) = history_path() else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };

    match serde_json::from_str(&content) {
        Ok(items) => items,
        Err(error) => {
            // 解析失败时绝不能返回空列表：调用方随后的任何一次保存都会用新数组
            // 整体覆盖，把仍然可读的原始内容永久抹掉。先把损坏文件改名留档。
            let backup = path.with_extension(format!("corrupt-{}.json", timestamp_suffix()));
            let _ = fs::rename(&path, &backup);
            eprintln!("历史记录解析失败（{error}），已备份到 {}", backup.display());
            Vec::new()
        }
    }
}

pub fn save_history_items(mut items: Vec<HistoryItem>) -> Result<Vec<HistoryItem>, String> {
    items.truncate(MAX_HISTORY_ITEMS);
    let path = history_path().map_err(|error| format!("获取历史路径失败：{error}"))?;
    let content =
        serde_json::to_string_pretty(&items).map_err(|error| format!("序列化历史失败：{error}"))?;
    write_atomic(&path, &content).map_err(|error| format!("写入历史失败：{error}"))?;
    Ok(items)
}

/// 把新记录插到现有历史最前面。相比前端上传整份数组，这里每次都重新读盘，
/// 避免并发窗口（另一个页面/悬浮球窗口/右键菜单进程）的写入被旧快照覆盖。
pub fn append_history_items(items: Vec<HistoryItem>) -> Result<Vec<HistoryItem>, String> {
    let existing = list_history_items();
    let new_ids: HashSet<String> = items.iter().map(|item| item.id.clone()).collect();
    let mut merged = items;
    merged.extend(
        existing
            .into_iter()
            .filter(|item| !new_ids.contains(&item.id)),
    );
    save_history_items(merged)
}

pub fn clear_history_items() -> Result<Vec<HistoryItem>, String> {
    save_history_items(Vec::new())
}
