use super::update::{verify_installer, DeltaManifest, UpdateManifest};
use super::update_download::{download_installer, prepare_download, DownloadProgress};
use crate::storage::atomic::write_atomic_durable;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

fn cancelled(flag: &AtomicBool) -> Result<(), String> {
    if flag.load(Ordering::SeqCst) {
        Err("下载已被用户取消".into())
    } else {
        Ok(())
    }
}

fn matches(bytes: &[u8], size: u64, hash: &str) -> bool {
    bytes.len() as u64 == size && format!("{:x}", Sha256::digest(bytes)).eq_ignore_ascii_case(hash)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadPlan {
    pub size: u64,
    pub remaining: u64,
    pub is_delta: bool,
}

fn cached_manifest(cache: &Path) -> Option<UpdateManifest> {
    fs::read(cache.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn patch_manifest(manifest: &UpdateManifest, delta: &DeltaManifest) -> UpdateManifest {
    let mut patch = manifest.clone();
    patch.asset = delta.asset.clone();
    patch.size = delta.size;
    patch.sha256 = delta.sha256.clone();
    patch.delta = None;
    patch
}

fn verified_base(
    cache: &Path,
    base: &Path,
    current_version: &str,
    delta: &DeltaManifest,
) -> Option<(Vec<u8>, bool)> {
    if !cfg!(windows)
        || delta.base_version.trim_start_matches('v') != current_version.trim_start_matches('v')
    {
        return None;
    }
    for (path, from_download) in [
        (base.to_path_buf(), false),
        (cache.join("installer.exe"), true),
    ] {
        if !fs::metadata(&path).is_ok_and(|metadata| metadata.len() == delta.base_size) {
            continue;
        }
        if let Ok(source) = fs::read(path) {
            if matches(&source, delta.base_size, &delta.base_sha256) {
                return Some((source, from_download));
            }
        }
    }
    None
}

// Call only with a manifest that has passed signature and origin validation.
pub fn plan_download(
    cache: &Path,
    base: &Path,
    current_version: &str,
    manifest: &UpdateManifest,
) -> UpdateDownloadPlan {
    let cached = cached_manifest(cache);
    let patch = manifest.delta.as_ref().and_then(|delta| {
        (cached.as_ref() != Some(manifest)
            && verified_base(cache, base, current_version, delta).is_some())
        .then(|| patch_manifest(manifest, delta))
    });
    let chosen = patch.as_ref().unwrap_or(manifest);
    let is_delta = patch.is_some();
    let file = cache.join(if is_delta {
        "update.patch"
    } else {
        "installer.exe"
    });
    let offset = if cached.as_ref() == Some(chosen) {
        fs::metadata(&file)
            .ok()
            .map(|metadata| metadata.len())
            .filter(|size| *size <= chosen.size)
            .filter(|size| {
                *size != chosen.size
                    || fs::read(&file)
                        .is_ok_and(|bytes| matches(&bytes, chosen.size, &chosen.sha256))
            })
            .unwrap_or(0)
    } else {
        0
    };
    UpdateDownloadPlan {
        size: chosen.size,
        remaining: chosen.size - offset,
        is_delta,
    }
}

// The parent manifest and its delta entry must already have passed signature/origin validation.
pub fn download_with_delta(
    url: &str,
    cache: &Path,
    base: &Path,
    current_version: &str,
    manifest: &UpdateManifest,
    cancel: &AtomicBool,
    mut emit: impl FnMut(DownloadProgress),
) -> Result<PathBuf, String> {
    cancelled(cancel)?;
    // Keep resuming a full download/reconstruction instead of switching back to the patch.
    let cached = cached_manifest(cache);
    if cached.as_ref() == Some(manifest) {
        return download_installer(url, cache, manifest, cancel, emit);
    }
    if let Some((delta, (source, from_download))) = manifest.delta.as_ref().and_then(|delta| {
        verified_base(cache, base, current_version, delta).map(|source| (delta, source))
    }) {
        // Starting the patch clears the download cache. Preserve a verified cached base first
        // so a cancelled or interrupted transfer can still resume as a delta.
        let retained = !from_download
            || base.parent().is_some_and(|parent| {
                fs::create_dir_all(parent)
                    .and_then(|_| write_atomic_durable(base, &source))
                    .is_ok()
            });
        if retained {
            let patch_manifest = patch_manifest(manifest, delta);
            let directory = url.rsplit_once('/').ok_or("更新下载地址无效。")?.0;
            let patch_url = format!("{directory}/{}", delta.asset);
            let patch_path =
                match download_installer(&patch_url, cache, &patch_manifest, cancel, &mut emit) {
                    Ok(path) => Some(path),
                    // Keep interrupted transfers for resumption. Only failed integrity checks fall back.
                    Err(error)
                        if error.contains("SHA-256")
                            || error.contains("大小超过签名清单")
                            || error.contains("更新文件不存在") =>
                    {
                        None
                    }
                    Err(error) => return Err(error),
                };
            if let Some(patch_path) = patch_path {
                cancelled(cancel)?;
                emit(DownloadProgress {
                    version: manifest.version.clone(),
                    percent: 100.0,
                    transferred: delta.size,
                    total: delta.size,
                    speed_bytes_per_sec: 0.0,
                    is_delta: true,
                    applying_delta: true,
                });
                let restored: Result<PathBuf, String> = (|| {
                    let patch = fs::read(patch_path).map_err(|e| e.to_string())?;
                    if !matches(&patch, delta.size, &delta.sha256) {
                        return Err("增量包校验失败。".into());
                    }
                    let bytes = apply_patch(&source, &patch, manifest.size)?;
                    if !matches(&bytes, manifest.size, &manifest.sha256) {
                        return Err("还原的安装包校验失败。".into());
                    }
                    cancelled(cancel)?;
                    let path = prepare_download(cache, manifest)?;
                    write_atomic_durable(&path, &bytes).map_err(|e| e.to_string())?;
                    verify_installer(&path, manifest)?;
                    Ok(path)
                })();
                cancelled(cancel)?;
                if let Ok(path) = restored {
                    return Ok(path);
                }
            }
        }
    }
    cancelled(cancel)?;
    download_installer(url, cache, manifest, cancel, emit)
}

#[cfg(windows)]
fn apply_patch(source: &[u8], patch: &[u8], expected_size: u64) -> Result<Vec<u8>, String> {
    use std::mem::MaybeUninit;
    use windows_sys::Win32::System::ApplicationInstallationAndServicing::*;
    let mut header = MaybeUninit::<DELTA_HEADER_INFO>::uninit();
    // Input slices stay live and immutable throughout these synchronous calls.
    if unsafe { GetDeltaInfoB(input(patch), header.as_mut_ptr()) } == 0 {
        return Err(format!(
            "无法读取增量包：{}",
            std::io::Error::last_os_error()
        ));
    }
    let header = unsafe { header.assume_init() };
    if header.TargetSize as u64 != expected_size || header.FileType != 1 {
        return Err("增量包目标大小或格式与签名清单不一致。".into());
    }
    let size = usize::try_from(expected_size).map_err(|_| "增量包目标过大。")?;
    let mut target = Vec::new();
    target
        .try_reserve_exact(size)
        .map_err(|_| "内存不足，无法还原增量更新。")?;
    target.resize(size, 0);
    // Apply into our bounded buffer, rather than allowing the patch to choose an allocation size.
    if unsafe {
        ApplyDeltaProvidedB(
            0,
            input(source),
            input(patch),
            target.as_mut_ptr().cast(),
            target.len(),
        )
    } == 0
    {
        return Err(format!(
            "还原增量包失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(target)
}

#[cfg(windows)]
fn input(
    bytes: &[u8],
) -> windows_sys::Win32::System::ApplicationInstallationAndServicing::DELTA_INPUT {
    use windows_sys::Win32::System::ApplicationInstallationAndServicing::{
        DELTA_INPUT, DELTA_INPUT_0,
    };
    DELTA_INPUT {
        Anonymous: DELTA_INPUT_0 {
            lpcStart: bytes.as_ptr().cast(),
        },
        uSize: bytes.len(),
        Editable: 0,
    }
}

#[cfg(not(windows))]
fn apply_patch(_: &[u8], _: &[u8], _: u64) -> Result<Vec<u8>, String> {
    Err("当前平台不支持此增量包。".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicU64;
    use std::thread;
    use windows_sys::Win32::System::ApplicationInstallationAndServicing::*;

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Cache(PathBuf);
    impl Cache {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mdking-delta-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Cache {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_patch(source: &[u8], target: &[u8]) -> Vec<u8> {
        let mut output = DELTA_OUTPUT::default();
        assert_ne!(
            unsafe {
                CreateDeltaB(
                    1,
                    0x20000,
                    0,
                    input(source),
                    input(target),
                    DELTA_INPUT::default(),
                    DELTA_INPUT::default(),
                    DELTA_INPUT::default(),
                    std::ptr::null(),
                    0,
                    &mut output,
                )
            },
            0
        );
        let bytes =
            unsafe { std::slice::from_raw_parts(output.lpStart.cast(), output.uSize) }.to_vec();
        unsafe {
            DeltaFree(output.lpStart);
        }
        bytes
    }

    fn serve(responses: Vec<Vec<u8>>) -> (String, thread::JoinHandle<Vec<String>>) {
        serve_status(responses.into_iter().map(|body| ("200 OK", body)).collect())
    }

    fn serve_status(
        responses: Vec<(&'static str, Vec<u8>)>,
    ) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/setup.exe", listener.local_addr().unwrap());
        let worker = thread::spawn(move || {
            responses
                .into_iter()
                .map(|(status, body)| {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                        .unwrap();
                    let mut request = Vec::new();
                    while !request.ends_with(b"\r\n\r\n") {
                        let mut byte = [0];
                        assert_eq!(stream.read(&mut byte).unwrap(), 1);
                        request.push(byte[0]);
                    }
                    write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .unwrap();
                    stream.write_all(&body).unwrap();
                    String::from_utf8(request).unwrap()
                })
                .collect()
        });
        (url, worker)
    }

    fn fixture() -> (Vec<u8>, Vec<u8>, Vec<u8>, UpdateManifest) {
        use super::super::update::DeltaManifest;
        let source = vec![b'a'; 4096];
        let mut target = source.clone();
        target[100] = b'b';
        let patch = make_patch(&source, &target);
        let hash = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        let manifest = UpdateManifest {
            version: "v1.1.18".into(),
            asset: "setup.exe".into(),
            size: target.len() as u64,
            sha256: hash(&target),
            delta: Some(DeltaManifest {
                base_version: "v1.1.17".into(),
                base_size: source.len() as u64,
                base_sha256: hash(&source),
                asset: "update.patch".into(),
                size: patch.len() as u64,
                sha256: hash(&patch),
            }),
        };
        (source, target, patch, manifest)
    }

    #[test]
    fn patch_roundtrip_and_header_size_validation() {
        let (source, target, patch, _) = fixture();
        assert_eq!(
            apply_patch(&source, &patch, target.len() as u64).unwrap(),
            target
        );
        assert!(apply_patch(&source, &patch, 1).is_err());
        assert!(apply_patch(&source, b"broken", target.len() as u64).is_err());
    }

    #[test]
    fn downloads_only_delta_and_restores_exact_verified_installer() {
        let cache = Cache::new();
        let (source, target, patch, manifest) = fixture();
        let base = cache.0.join("base.exe");
        fs::write(&base, source).unwrap();
        let (url, server) = serve(vec![patch]);
        let mut applying = false;
        let path = download_with_delta(
            &url,
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |event| applying |= event.applying_delta,
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), target);
        assert!(server.join().unwrap()[0].starts_with("GET /update.patch "));
        assert!(applying);
        assert!(cache.0.join("base.exe").exists());
        // Restarting after a successful reconstruction must not download its patch again.
        assert!(download_with_delta(
            "http://127.0.0.1:1/setup.exe",
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_ok());
    }

    #[test]
    fn reuses_verified_installer_from_download_cache_and_retains_it_for_retry() {
        let cache = Cache::new();
        let (source, target, patch, manifest) = fixture();
        let download = cache.0.join("download");
        fs::create_dir_all(&download).unwrap();
        fs::write(download.join("installer.exe"), &source).unwrap();
        let base = cache.0.join("update-base/installer.exe");
        fs::create_dir_all(base.parent().unwrap()).unwrap();
        fs::write(&base, vec![b'x'; source.len()]).unwrap();
        let partial = patch[..patch.len() / 2].to_vec();
        let (url, server) = serve(vec![partial.clone()]);
        assert!(download_with_delta(
            &url,
            &download,
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
        assert!(server.join().unwrap()[0].starts_with("GET /update.patch "));
        assert_eq!(fs::read(&base).unwrap(), source);
        assert_eq!(fs::read(download.join("update.patch")).unwrap(), partial);

        let (url, server) = serve(vec![patch]);
        let path = download_with_delta(
            &url,
            &download,
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), target);
        assert!(server.join().unwrap()[0]
            .to_lowercase()
            .contains(&format!("range: bytes={}-", partial.len())));
    }

    #[test]
    fn modified_download_cache_installer_does_not_qualify_as_delta_base() {
        let cache = Cache::new();
        let (source, target, _, manifest) = fixture();
        let download = cache.0.join("download");
        fs::create_dir_all(&download).unwrap();
        fs::write(download.join("installer.exe"), vec![b'x'; source.len()]).unwrap();
        let base = cache.0.join("update-base/installer.exe");
        let (url, server) = serve(vec![target.clone()]);
        let path = download_with_delta(
            &url,
            &download,
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), target);
        assert!(server.join().unwrap()[0].starts_with("GET /setup.exe "));
        assert!(!base.exists());
    }

    #[test]
    fn download_plan_matches_available_base_and_retained_progress() {
        let cache = Cache::new();
        let (source, target, patch, manifest) = fixture();
        let download = cache.0.join("download");
        fs::create_dir_all(&download).unwrap();
        let base = cache.0.join("base.exe");
        assert_eq!(
            plan_download(&download, &base, "1.1.17", &manifest),
            UpdateDownloadPlan {
                size: target.len() as u64,
                remaining: target.len() as u64,
                is_delta: false
            }
        );
        fs::write(download.join("installer.exe"), &source).unwrap();
        assert_eq!(
            plan_download(&download, &base, "1.1.17", &manifest),
            UpdateDownloadPlan {
                size: patch.len() as u64,
                remaining: patch.len() as u64,
                is_delta: true
            }
        );
        assert!(!plan_download(&download, &base, "1.1.16", &manifest).is_delta);

        fs::write(&base, source).unwrap();
        let partial = patch.len() / 2;
        fs::write(download.join("update.patch"), &patch[..partial]).unwrap();
        fs::write(
            download.join("manifest.json"),
            serde_json::to_vec(&patch_manifest(&manifest, manifest.delta.as_ref().unwrap()))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            plan_download(&download, &base, "1.1.17", &manifest).remaining,
            (patch.len() - partial) as u64
        );

        fs::write(download.join("installer.exe"), &target).unwrap();
        fs::write(
            download.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert_eq!(
            plan_download(&download, &base, "1.1.17", &manifest),
            UpdateDownloadPlan {
                size: target.len() as u64,
                remaining: 0,
                is_delta: false
            }
        );
    }

    #[test]
    fn missing_wrong_version_or_modified_base_uses_full_download() {
        for scenario in ["missing", "version", "modified"] {
            let cache = Cache::new();
            let (source, target, _, manifest) = fixture();
            let base = cache.0.join("base.exe");
            if scenario != "missing" {
                fs::write(
                    &base,
                    if scenario == "modified" {
                        vec![b'x'; source.len()]
                    } else {
                        source
                    },
                )
                .unwrap();
            }
            let (url, server) = serve(vec![target.clone()]);
            let version = if scenario == "version" {
                "1.1.16"
            } else {
                "1.1.17"
            };
            let path = download_with_delta(
                &url,
                &cache.0.join("download"),
                &base,
                version,
                &manifest,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap();
            assert_eq!(fs::read(path).unwrap(), target);
            assert!(server.join().unwrap()[0].starts_with("GET /setup.exe "));
        }
    }

    #[test]
    fn invalid_delta_falls_back_to_full_package() {
        let cache = Cache::new();
        let (source, target, patch, manifest) = fixture();
        let base = cache.0.join("base.exe");
        fs::write(&base, source).unwrap();
        let (url, server) = serve(vec![vec![0; patch.len()], target.clone()]);
        let path = download_with_delta(
            &url,
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), target);
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[test]
    fn unavailable_or_unusable_delta_automatically_uses_full_package() {
        for missing in [false, true] {
            let cache = Cache::new();
            let (source, target, patch, mut manifest) = fixture();
            let base = cache.0.join("base.exe");
            fs::write(&base, source).unwrap();
            let invalid = vec![0; patch.len()];
            // Even a signed patch with a matching digest may be unusable; never install it directly.
            manifest.delta.as_mut().unwrap().sha256 = format!("{:x}", Sha256::digest(&invalid));
            let first = if missing {
                ("404 Not Found", vec![])
            } else {
                ("200 OK", invalid)
            };
            let (url, server) = serve_status(vec![first, ("200 OK", target.clone())]);
            let path = download_with_delta(
                &url,
                &cache.0.join("download"),
                &base,
                "1.1.17",
                &manifest,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap();
            assert_eq!(fs::read(path).unwrap(), target);
            assert_eq!(server.join().unwrap().len(), 2);
        }
    }

    #[test]
    fn cancellation_during_reconstruction_keeps_delta_for_retry() {
        let cache = Cache::new();
        let (source, _, patch, manifest) = fixture();
        let base = cache.0.join("base.exe");
        fs::write(&base, source).unwrap();
        let (url, server) = serve(vec![patch.clone()]);
        let cancel = AtomicBool::new(false);
        let result = download_with_delta(
            &url,
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &cancel,
            |event| {
                if event.applying_delta {
                    cancel.store(true, Ordering::SeqCst);
                }
            },
        );
        assert!(result.unwrap_err().contains("已被用户取消"));
        server.join().unwrap();
        assert_eq!(
            fs::read(cache.0.join("download/update.patch")).unwrap(),
            patch
        );
    }

    #[test]
    fn interrupted_patch_is_retained_and_next_attempt_requests_remaining_bytes() {
        let cache = Cache::new();
        let (source, target, patch, manifest) = fixture();
        let base = cache.0.join("base.exe");
        fs::write(&base, source).unwrap();
        let partial = patch[..patch.len() / 2].to_vec();
        let (url, server) = serve(vec![partial.clone()]);
        assert!(download_with_delta(
            &url,
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
        server.join().unwrap();
        assert_eq!(
            fs::read(cache.0.join("download/update.patch")).unwrap(),
            partial
        );
        let (url, server) = serve(vec![patch]);
        let path = download_with_delta(
            &url,
            &cache.0.join("download"),
            &base,
            "1.1.17",
            &manifest,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), target);
        assert!(server.join().unwrap()[0]
            .to_lowercase()
            .contains(&format!("range: bytes={}-", partial.len())));
    }
}
