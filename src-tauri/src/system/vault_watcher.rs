use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const VAULT_CHANGED_EVENT: &str = "vault://changed";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultChangedPayload {
    pub root: String,
}

#[derive(Default)]
pub struct VaultWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

/// 替换当前仓库监听器。监听器只负责把一批文件系统事件合并成一个通知，
/// 目录列表仍由前端按现有边界和跳过规则重新读取。
pub fn watch_vault(
    state: &VaultWatcherState,
    app: &AppHandle,
    root: &Path,
    display_root: String,
) -> Result<(), String> {
    let (event_tx, event_rx) = mpsc::channel::<()>();
    let app = app.clone();
    let payload = VaultChangedPayload { root: display_root };

    std::thread::spawn(move || {
        while event_rx.recv().is_ok() {
            let deadline = Instant::now() + Duration::from_millis(350);
            loop {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    break;
                };
                if event_rx.recv_timeout(remaining).is_err() {
                    break;
                }
            }
            let _ = app.emit(VAULT_CHANGED_EVENT, payload.clone());
        }
    });

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            // 监听缓冲区溢出等错误也需要触发一次完整扫描，避免文件树停留在旧状态。
            let _ = result;
            let _ = event_tx.send(());
        },
        Config::default(),
    )
    .map_err(|error| format!("创建目录监听失败：{error}"))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("监听目录失败：{error}"))?;

    let mut current = state
        .watcher
        .lock()
        .map_err(|_| "目录监听状态已损坏。".to_string())?;
    *current = Some(watcher);
    Ok(())
}
