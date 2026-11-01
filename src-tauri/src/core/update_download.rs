use super::update::{verify_installer, UpdateManifest};
use crate::storage::atomic::write_atomic;
use crate::system::update_http;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub version: String,
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
    pub speed_bytes_per_sec: f64,
    pub is_delta: bool,
    pub applying_delta: bool,
}

// Called only after verifying the release's signed manifest, when the user starts downloading.
pub(crate) fn prepare_download(cache: &Path, manifest: &UpdateManifest) -> Result<PathBuf, String> {
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let path = cache.join(if manifest.asset.ends_with(".patch") { "update.patch" } else { "installer.exe" });
    let metadata_path = cache.join("manifest.json");
    let previous = fs::read(&metadata_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<UpdateManifest>(&bytes).ok());
    if previous.as_ref() != Some(manifest) {
        remove_partial(&cache.join("installer.exe"))?;
        remove_partial(&cache.join("update.patch"))?;
        write_atomic(
            &metadata_path,
            &serde_json::to_string(manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn remove_partial(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("清理旧更新文件失败：{error}")),
    }
}

fn clear_cached_files(cache: &Path) -> Result<(), String> {
    // Keep the manifest until the other files are gone so failed cleanup can be retried.
    for name in ["update.patch", "installer.exe", "manifest.json"] {
        remove_partial(&cache.join(name))?;
    }
    Ok(())
}

fn cache_manifest(cache: &Path) -> Option<UpdateManifest> {
    fs::read(cache.join("manifest.json")).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

pub(crate) fn clear_completed_download(cache: &Path, base: &Path, current_version: &str) -> Result<bool, String> {
    let Some(manifest) = cache_manifest(cache) else { return Ok(false) };
    if manifest.asset.ends_with(".patch")
        || manifest.version.trim_start_matches('v') != current_version.trim_start_matches('v')
        || verify_installer(base, &manifest).is_err()
    {
        return Ok(false);
    }
    clear_cached_files(cache)?;
    Ok(true)
}

fn version_parts(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.trim_start_matches('v').split('.');
    let result = [parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?];
    parts.next().is_none().then_some(result)
}

// The new target version must come from a verified manifest. Never remove the
// installed version's cached installer: it may be the base for a delta update.
pub(crate) fn clear_superseded_download(cache: &Path, current_version: &str, target_version: &str) -> Result<bool, String> {
    let Some(manifest) = cache_manifest(cache) else { return Ok(false) };
    let Some((current, pending, target)) = version_parts(current_version)
        .zip(version_parts(&manifest.version))
        .zip(version_parts(target_version))
        .map(|((current, pending), target)| (current, pending, target)) else { return Ok(false) };
    if !(current < pending && pending < target) { return Ok(false); }
    clear_cached_files(cache)?;
    Ok(true)
}

pub fn download_installer(
    url: &str,
    cache: &Path,
    manifest: &UpdateManifest,
    cancelled: &AtomicBool,
    mut emit: impl FnMut(DownloadProgress),
) -> Result<PathBuf, String> {
    let check_cancelled = || {
        if cancelled.load(Ordering::SeqCst) {
            Err("下载已被用户取消".to_string())
        } else {
            Ok(())
        }
    };
    check_cancelled()?;
    let path = prepare_download(cache, manifest)?;
    let mut offset = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.to_string()),
    };
    if offset > manifest.size {
        remove_partial(&path)?;
        offset = 0;
    }
    let progress = |transferred, speed_bytes_per_sec| DownloadProgress {
        version: manifest.version.clone(),
        percent: transferred as f64 / manifest.size as f64 * 100.0,
        transferred,
        total: manifest.size,
        speed_bytes_per_sec,
        is_delta: manifest.asset.ends_with(".patch"),
        applying_delta: false,
    };
    emit(progress(offset, 0.0));
    check_cancelled()?;
    if offset < manifest.size {
        // Bound stalled reads without imposing a time limit on the whole large download.
        let range = (offset > 0).then(|| format!("bytes={offset}-"));
        let response = update_http::get(url, range.as_deref(), None, Duration::from_secs(15))?;
        check_cancelled()?;
        match response.status {
            206 if response.content_range.as_deref()
                == Some(
                    format!("bytes {offset}-{}/{}", manifest.size - 1, manifest.size).as_str(),
                ) => {}
            200 => {
                offset = 0;
            } // The server ignored Range; replace rather than append its full response.
            404 | 410 => return Err("更新文件不存在，请重试或下载完整安装包。".into()),
            _ => return Err("服务器返回的下载范围无效，已保留原有下载进度。".into()),
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(offset == 0)
            .append(offset > 0)
            .open(&path)
            .map_err(|e| format!("无法写入安装包：{e}"))?;
        emit(progress(offset, 0.0));
        let mut reader = response.body;
        let mut transferred = offset;
        let mut buffer = [0u8; 64 * 1024];
        let start = Instant::now();
        let mut last_emit = Instant::now();
        let result: Result<(), String> = (|| {
            loop {
                check_cancelled()?;
                let count = reader
                    .read(&mut buffer)
                    .map_err(|e| format!("下载数据读取中断: {e}"))?;
                if count == 0 {
                    break;
                }
                if transferred + count as u64 > manifest.size {
                    return Err("安装包大小超过签名清单，已终止下载。".into());
                }
                file.write_all(&buffer[..count])
                    .map_err(|e| format!("写入安装包失败: {e}"))?;
                transferred += count as u64;
                if last_emit.elapsed().as_millis() >= 100 || transferred == manifest.size {
                    emit(progress(
                        transferred,
                        (transferred - offset) as f64 / start.elapsed().as_secs_f64().max(0.001),
                    ));
                    last_emit = Instant::now();
                }
            }
            check_cancelled()?;
            if transferred < manifest.size {
                return Err("下载数据读取中断，已保留进度，请继续下载。".into());
            }
            Ok(())
        })();
        // Report the actual durable progress even when a read fails or cancellation arrives.
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        emit(progress(transferred, 0.0));
        result?;
    }
    check_cancelled()?;
    if let Err(error) = verify_installer(&path, manifest) {
        remove_partial(&path)?;
        emit(progress(0, 0.0));
        return Err(error);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicU64;
    use std::thread;

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Cache(PathBuf);
    impl Cache {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mdking-resume-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn partial(&self, manifest: &UpdateManifest, bytes: &[u8]) -> PathBuf {
            let path = prepare_download(&self.0, manifest).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Cache {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn manifest() -> UpdateManifest {
        UpdateManifest {
            version: "v1.1.17".into(),
            asset: "setup.exe".into(),
            size: 6,
            sha256: format!("{:x}", Sha256::digest(b"abcdef")),
            delta: None,
        }
    }
    fn serve(response: &'static str) -> (String, thread::JoinHandle<String>) {
        serve_delayed(response, 0)
    }
    fn serve_delayed(
        response: &'static str,
        delay_ms: u64,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/setup.exe", listener.local_addr().unwrap());
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                if stream.read(&mut byte).unwrap() == 0 {
                    break;
                }
                request.push(byte[0]);
            }
            let (headers, body) = response.split_once("\r\n\r\n").unwrap();
            write!(stream, "{headers}\r\n\r\n").unwrap();
            if delay_ms > 0 {
                thread::sleep(Duration::from_millis(delay_ms));
            }
            stream.write_all(body.as_bytes()).unwrap();
            String::from_utf8(request).unwrap()
        });
        (url, worker)
    }

    #[test]
    fn resumes_same_signed_release_with_range_and_verifies_whole_file() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let (url, server) = serve("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-5/6\r\nContent-Length: 3\r\nConnection: close\r\n\r\ndef");
        let mut progress = Vec::new();
        assert_eq!(
            download_installer(
                &url,
                &cache.0,
                &manifest,
                &AtomicBool::new(false),
                |event| progress.push(event.transferred)
            )
            .unwrap(),
            path
        );
        assert!(server
            .join()
            .unwrap()
            .to_lowercase()
            .contains("range: bytes=3-"));
        assert_eq!(fs::read(path).unwrap(), b"abcdef");
        assert_eq!(progress[0], 3);
        assert_eq!(*progress.last().unwrap(), 6);
    }

    #[test]
    fn full_response_restarts_instead_of_appending_to_partial() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let (url, server) =
            serve("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef");
        download_installer(&url, &cache.0, &manifest, &AtomicBool::new(false), |_| {}).unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(path).unwrap(), b"abcdef");
    }

    #[test]
    fn wrong_range_cannot_corrupt_existing_partial() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let (url, server) = serve("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 2-5/6\r\nContent-Length: 4\r\nConnection: close\r\n\r\ncdef");
        assert!(
            download_installer(&url, &cache.0, &manifest, &AtomicBool::new(false), |_| {}).is_err()
        );
        server.join().unwrap();
        assert_eq!(fs::read(path).unwrap(), b"abc");
    }

    #[test]
    fn network_interruption_retains_actual_bytes_for_next_attempt() {
        let cache = Cache::new();
        let manifest = manifest();
        let (url, server) = serve("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabc");
        let mut transferred = 0;
        assert!(download_installer(
            &url,
            &cache.0,
            &manifest,
            &AtomicBool::new(false),
            |event| transferred = event.transferred
        )
        .is_err());
        server.join().unwrap();
        assert_eq!(transferred, 3);
        assert_eq!(fs::read(cache.0.join("installer.exe")).unwrap(), b"abc");
        let (url, server) = serve("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-5/6\r\nContent-Length: 3\r\nConnection: close\r\n\r\ndef");
        download_installer(&url, &cache.0, &manifest, &AtomicBool::new(false), |_| {}).unwrap();
        assert!(server
            .join()
            .unwrap()
            .to_lowercase()
            .contains("range: bytes=3-"));
    }

    #[test]
    fn cancellation_preserves_partial_and_switching_release_clears_it_only_on_start() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let cancelled = AtomicBool::new(false);
        let error = download_installer(
            "http://127.0.0.1:1",
            &cache.0,
            &manifest,
            &cancelled,
            |_| cancelled.store(true, Ordering::SeqCst),
        );
        assert!(error.unwrap_err().contains("下载已被用户取消"));
        assert_eq!(fs::read(&path).unwrap(), b"abc");
        let mut newer = manifest.clone();
        newer.version = "v1.1.18".into();
        // Merely knowing a newer manifest has no effect; starting it resets the cache.
        assert_eq!(fs::read(&path).unwrap(), b"abc");
        let (url, server) =
            serve("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef");
        download_installer(&url, &cache.0, &newer, &AtomicBool::new(false), |_| {}).unwrap();
        assert!(!server.join().unwrap().to_lowercase().contains("range:"));
        assert_eq!(fs::read(path).unwrap(), b"abcdef");
    }

    #[test]
    fn cancellation_during_transfer_flushes_partial_and_can_resume() {
        let cache = Cache::new();
        let manifest = manifest();
        let cancelled = AtomicBool::new(false);
        let (url, server) = serve_delayed(
            "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc",
            150,
        );
        let result = download_installer(&url, &cache.0, &manifest, &cancelled, |event| {
            if event.transferred == 3 {
                cancelled.store(true, Ordering::SeqCst);
            }
        });
        assert!(result.unwrap_err().contains("下载已被用户取消"));
        server.join().unwrap();
        assert_eq!(fs::read(cache.0.join("installer.exe")).unwrap(), b"abc");
        let (url, server) = serve("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-5/6\r\nContent-Length: 3\r\nConnection: close\r\n\r\ndef");
        download_installer(&url, &cache.0, &manifest, &AtomicBool::new(false), |_| {}).unwrap();
        assert!(server
            .join()
            .unwrap()
            .to_lowercase()
            .contains("range: bytes=3-"));
    }

    #[test]
    fn tampered_resumed_bytes_fail_hash_and_are_cleared_for_retry() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let (url, server) = serve("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-5/6\r\nContent-Length: 3\r\nConnection: close\r\n\r\nxyz");
        let result = download_installer(&url, &cache.0, &manifest, &AtomicBool::new(false), |_| {});
        server.join().unwrap();
        assert!(result.unwrap_err().contains("SHA-256"));
        assert!(!path.exists());
    }

    #[test]
    fn changed_manifest_and_corrupt_complete_file_are_never_reused() {
        let cache = Cache::new();
        let manifest = manifest();
        let path = cache.partial(&manifest, b"abc");
        let mut changed = manifest.clone();
        changed.sha256 = "f".repeat(64);
        prepare_download(&cache.0, &changed).unwrap();
        assert!(!path.exists());
        cache.partial(&manifest, b"xxxxxx");
        assert!(download_installer(
            "http://127.0.0.1:1",
            &cache.0,
            &manifest,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
        assert!(!path.exists());
        cache.partial(&manifest, b"abcdef");
        // A fully cached package still has to pass SHA-256, and needs no network request.
        assert!(download_installer(
            "http://127.0.0.1:1",
            &cache.0,
            &manifest,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_ok());
    }

    #[test]
    fn installed_update_removes_checkpoint_only_after_matching_base_is_present() {
        let cache = Cache::new();
        let manifest = manifest();
        let installer = cache.partial(&manifest, b"abcdef");
        fs::write(cache.0.join("update.patch"), b"stale").unwrap();
        let base = cache.0.join("base.exe");
        fs::write(&base, b"wrong!").unwrap();
        assert!(!clear_completed_download(&cache.0, &base, "1.1.17").unwrap());
        assert!(installer.exists());
        fs::write(&base, b"abcdef").unwrap();
        assert!(!clear_completed_download(&cache.0, &base, "1.1.16").unwrap());
        assert!(clear_completed_download(&cache.0, &base, "1.1.17").unwrap());
        assert_eq!(fs::read(base).unwrap(), b"abcdef");
        for file in ["installer.exe", "update.patch", "manifest.json"] {
            assert!(!cache.0.join(file).exists(), "{file} remains");
        }
    }

    #[cfg(windows)]
    #[test]
    fn completed_checkpoint_cleanup_can_retry_while_installer_is_running() {
        use std::os::windows::fs::OpenOptionsExt;
        let cache = Cache::new();
        let manifest = manifest();
        let installer = cache.partial(&manifest, b"abcdef");
        let base = cache.0.join("base.exe");
        fs::write(&base, b"abcdef").unwrap();
        let lock = OpenOptions::new().read(true).share_mode(1).open(installer).unwrap();
        assert!(clear_completed_download(&cache.0, &base, "1.1.17").is_err());
        assert!(cache.0.join("manifest.json").exists());
        drop(lock);
        assert!(clear_completed_download(&cache.0, &base, "1.1.17").unwrap());
    }

    #[test]
    fn a_signed_newer_target_discards_only_superseded_partial_progress() {
        let cache = Cache::new();
        let pending = manifest();
        let installer = cache.partial(&pending, b"abc");
        assert!(!clear_superseded_download(&cache.0, "1.1.17", "1.1.18").unwrap());
        assert!(installer.exists(), "current installer can be a delta base");
        assert!(!clear_superseded_download(&cache.0, "1.1.16", "1.1.17").unwrap());
        assert!(!clear_superseded_download(&cache.0, "1.1.16", "1.1.16").unwrap());
        assert!(clear_superseded_download(&cache.0, "1.1.16", "1.1.18").unwrap());
        assert!(!installer.exists());
        assert!(!cache.0.join("manifest.json").exists());
    }
}
