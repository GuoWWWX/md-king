use crate::core::update::{installer_arguments, release_directory, verify_installer, verify_manifest, UpdateManifest};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static VERIFIED_INSTALLER: Mutex<Option<(PathBuf, UpdateManifest)>> = Mutex::new(None);

struct DownloadGuard;
impl Drop for DownloadGuard {
    fn drop(&mut self) { DOWNLOADING.store(false, Ordering::SeqCst); }
}

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
    tauri::async_runtime::spawn_blocking(move || {
        let response = ureq::get(&format!("https://api.github.com/repos/{repo_name}/releases/latest"))
            .set("User-Agent", "md-king-updater")
            .set("Accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(15)).call();
        match response {
            Ok(resp) => resp.into_string().map_err(|e| format!("读取 Release 响应失败: {e}")),
            Err(ureq::Error::Status(404, _)) => Ok("null".into()),
            Err(e) => Err(format!("请求 GitHub Release 失败: {e}")),
        }
    }).await.map_err(|e| format!("异步任务执行失败: {e}"))?
}

fn fetch_update_metadata(url: &str) -> Result<Vec<u8>, String> {
    let response = ureq::get(url).set("User-Agent", "md-king-updater")
        .timeout(Duration::from_secs(30)).call()
        .map_err(|e| format!("读取更新签名清单失败: {e}"))?;
    let mut bytes = Vec::new();
    response.into_reader().take(64 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 { return Err("更新清单过大。".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn download_update_installer(app: AppHandle, download_url: String, version: String) -> Result<String, String> {
    if DOWNLOADING.swap(true, Ordering::SeqCst) { return Err("已有更新正在下载。".into()); }
    let guard = DownloadGuard;
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let directory = release_directory(&version)?;
        let manifest_bytes = fetch_update_metadata(&format!("{directory}/update-manifest.json"))?;
        let signature_bytes = fetch_update_metadata(&format!("{directory}/update-manifest.sig"))?;
        let signature = std::str::from_utf8(&signature_bytes).map_err(|_| "更新签名格式无效。")?;
        let manifest = verify_manifest(&manifest_bytes, signature, &version, &download_url)?;
        let mut random = [0u8; 16];
        SystemRandom::new().fill(&mut random).map_err(|_| "无法创建更新临时目录。")?;
        let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let temp_dir = std::env::temp_dir().join(format!("md-king-update-{name}"));
        std::fs::create_dir(&temp_dir).map_err(|e| e.to_string())?;
        let path = temp_dir.join(&manifest.asset);
        let result = download_file_with_progress(&app, &download_url, &path, manifest.size)
            .and_then(|_| verify_installer(&path, &manifest));
        if let Err(error) = result {
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_dir(&temp_dir);
            return Err(error);
        }
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_dir(&temp_dir);
            return Err("下载已被用户取消".into());
        }
        let mut verified = VERIFIED_INSTALLER.lock().map_err(|e| e.to_string())?;
        if let Some((previous, _)) = verified.replace((path.clone(), manifest)) {
            let _ = std::fs::remove_file(&previous);
            if let Some(dir) = previous.parent() { let _ = std::fs::remove_dir(dir); }
        }
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|e| format!("下载任务调度失败: {e}"))?
}

fn download_file_with_progress(app: &AppHandle, url: &str, path: &PathBuf, total: u64) -> Result<(), String> {
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) { return Err("下载已被用户取消".into()); }
    let response = ureq::get(url).set("User-Agent", "md-king-updater")
        .timeout(Duration::from_secs(60)).call().map_err(|e| format!("发起下载连接失败: {e}"))?;
    let mut reader = response.into_reader();
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut transferred = 0u64;
    let start = Instant::now();
    let mut last_emit = Instant::now();
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) { return Err("下载已被用户取消".into()); }
        let count = reader.read(&mut buffer).map_err(|e| format!("下载数据读取中断: {e}"))?;
        if count == 0 { break; }
        transferred += count as u64;
        if transferred > total { return Err("安装包大小超过签名清单，已终止下载。".into()); }
        file.write_all(&buffer[..count]).map_err(|e| format!("写入安装包失败: {e}"))?;
        if last_emit.elapsed().as_millis() >= 100 || transferred == total {
            let _ = app.emit("update-download-progress", DownloadProgressPayload {
                percent: transferred as f64 / total as f64 * 100.0,
                transferred, total,
                speed_bytes_per_sec: transferred as f64 / start.elapsed().as_secs_f64().max(0.001),
            });
            last_emit = Instant::now();
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn launch_update_installer(app: AppHandle, installer_path: String, silent: Option<bool>) -> Result<(), String> {
    let verified = VERIFIED_INSTALLER.lock().map_err(|e| e.to_string())?;
    let (path, manifest) = verified.as_ref().ok_or("尚未下载并校验安装包，已阻止安装。")?;
    if path != &PathBuf::from(&installer_path) { return Err("只允许启动本次已验签的安装包。".into()); }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let install_dir = executable.parent().ok_or("无法确定当前安装目录。")?;
    // Deny write/delete sharing while validating and launching the installer.
    #[cfg(windows)]
    let _locked_file = {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new().read(true).share_mode(1).open(path).map_err(|e| e.to_string())?
    };
    verify_installer(path, manifest)?;
    std::process::Command::new(path).args(installer_arguments(silent.unwrap_or(true), install_dir))
        .spawn().map_err(|e| format!("启动安装程序失败: {e}"))?;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        app.exit(0);
    });
    Ok(())
}
