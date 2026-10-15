use crate::core::update::{installer_arguments, release_directory, verify_installer, verify_manifest, UpdateManifest};
use crate::core::update_download::download_installer;
use crate::storage::paths::app_data_dir;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static VERIFIED_INSTALLER: Mutex<Option<(PathBuf, UpdateManifest)>> = Mutex::new(None);

struct DownloadGuard;
impl Drop for DownloadGuard {
    fn drop(&mut self) { DOWNLOADING.store(false, Ordering::SeqCst); }
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
        let cache = app_data_dir().map_err(|e| e.to_string())?.join("update-download");
        // Starting a download invalidates the previous launch permission; detection alone does not.
        *VERIFIED_INSTALLER.lock().map_err(|e| e.to_string())? = None;
        let path = download_installer(&download_url, &cache, &manifest, &CANCEL_DOWNLOAD, |progress| {
            let _ = app.emit("update-download-progress", progress);
        })?;
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("下载已被用户取消".into());
        }
        let mut verified = VERIFIED_INSTALLER.lock().map_err(|e| e.to_string())?;
        *verified = Some((path.clone(), manifest));
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|e| format!("下载任务调度失败: {e}"))?
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
