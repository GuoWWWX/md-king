use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
    pub speed_bytes_per_sec: f64,
}

#[tauri::command]
pub fn cancel_update_download() -> Result<(), String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn fetch_latest_release(repo: Option<String>) -> Result<String, String> {
    let repo_name = repo.unwrap_or_else(|| "GuoWWWX/md-king".to_string());
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo_name);

    tauri::async_runtime::spawn_blocking(move || {
        let resp = ureq::get(&url)
            .set("User-Agent", "md-king-updater")
            .set("Accept", "application/vnd.github.v3+json")
            .timeout(std::time::Duration::from_secs(15))
            .call()
            .map_err(|e| format!("请求 GitHub Release 失败: {e}"))?;

        let body = resp
            .into_string()
            .map_err(|e| format!("读取 Release 响应失败: {e}"))?;

        Ok(body)
    })
    .await
    .map_err(|e| format!("异步任务执行失败: {e}"))?
}

#[tauri::command]
pub async fn download_update_installer(
    app: AppHandle,
    download_url: String,
    version: String,
) -> Result<String, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let temp_dir = std::env::temp_dir();
    let safe_version = version.trim_start_matches('v').replace(|c: char| !c.is_alphanumeric() && c != '.', "_");
    let file_name = format!("md-king-setup-{safe_version}.exe");
    let target_path = temp_dir.join(file_name);

    let target_path_clone = target_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        download_file_with_progress(&app, &download_url, &target_path_clone)
    })
    .await
    .map_err(|e| format!("下载任务调度失败: {e}"))??;

    Ok(target_path.to_string_lossy().to_string())
}

fn download_file_with_progress(
    app: &AppHandle,
    url: &str,
    target_path: &PathBuf,
) -> Result<(), String> {
    let response = ureq::get(url)
        .set("User-Agent", "md-king-updater")
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| format!("发起下载连接失败: {e}"))?;

    let total_bytes: u64 = response
        .header("content-length")
        .and_then(|val| val.parse::<u64>().ok())
        .unwrap_or(0);

    let mut reader = response.into_reader();
    let mut file = File::create(target_path)
        .map_err(|e| format!("无法创建临时安装包文件 {}: {e}", target_path.display()))?;

    let mut buffer = [0u8; 64 * 1024]; // 64KB 缓冲区
    let mut transferred: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit_time = Instant::now();

    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            drop(file);
            let _ = std::fs::remove_file(target_path);
            return Err("下载已被用户取消".to_string());
        }

        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|e| format!("下载数据读取中断: {e}"))?;

        if bytes_read == 0 {
            break;
        }

        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("写入安装包数据失败: {e}"))?;

        transferred += bytes_read as u64;

        let now = Instant::now();
        // 限制进度派发频率为至少每 100ms 一次，避免阻塞 IPC
        if now.duration_since(last_emit_time).as_millis() >= 100 || transferred == total_bytes {
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            let speed = if elapsed_secs > 0.0 {
                transferred as f64 / elapsed_secs
            } else {
                0.0
            };

            let percent = if total_bytes > 0 {
                ((transferred as f64 / total_bytes as f64) * 100.0).min(100.0)
            } else {
                0.0
            };

            let payload = DownloadProgressPayload {
                percent,
                transferred,
                total: total_bytes,
                speed_bytes_per_sec: speed,
            };

            let _ = app.emit("update-download-progress", payload);
            last_emit_time = now;
        }
    }

    file.flush()
        .map_err(|e| format!("刷新文件缓存失败: {e}"))?;

    // 发射 100% 完成事件
    let final_payload = DownloadProgressPayload {
        percent: 100.0,
        transferred,
        total: if total_bytes > 0 { total_bytes } else { transferred },
        speed_bytes_per_sec: 0.0,
    };
    let _ = app.emit("update-download-progress", final_payload);

    Ok(())
}

#[tauri::command]
pub fn launch_update_installer(
    app: AppHandle,
    installer_path: String,
    silent: Option<bool>,
) -> Result<(), String> {
    let path = PathBuf::from(&installer_path);
    if !path.exists() {
        return Err(format!("安装程序文件不存在: {installer_path}"));
    }

    let is_silent = silent.unwrap_or(false);

    let mut command = std::process::Command::new(&path);
    if is_silent {
        command.arg("/S");
    }

    command
        .spawn()
        .map_err(|e| format!("启动安装程序失败: {e}"))?;

    // 稍等 200ms 后退出当前应用，释放文件句柄让安装程序正常覆盖
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
    });

    Ok(())
}
