use super::update::{verify_installer, UpdateManifest};
use super::update_download::{download_installer, prepare_download, DownloadProgress};
use crate::storage::atomic::write_atomic_durable;
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
    let cached = fs::read(cache.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<UpdateManifest>(&bytes).ok());
    if cached.as_ref() == Some(manifest) {
        return download_installer(url, cache, manifest, cancel, emit);
    }
    let eligible = manifest.delta.as_ref().filter(|delta| {
        cfg!(windows)
            && delta.base_version.trim_start_matches('v') == current_version.trim_start_matches('v')
            && fs::metadata(base).is_ok_and(|metadata| metadata.len() == delta.base_size)
    });
    if let Some(delta) = eligible {
        if let Ok(source) = fs::read(base) {
            if matches(&source, delta.base_size, &delta.base_sha256) {
                let mut patch_manifest = manifest.clone();
                patch_manifest.asset = delta.asset.clone();
                patch_manifest.size = delta.size;
                patch_manifest.sha256 = delta.sha256.clone();
                patch_manifest.delta = None;
                let directory = url.rsplit_once('/').ok_or("更新下载地址无效。")?.0;
                let patch_url = format!("{directory}/{}", delta.asset);
                let patch_path =
                    match download_installer(&patch_url, cache, &patch_manifest, cancel, &mut emit)
                    {
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
