use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const RELEASE_BASE: &str = "https://github.com/GuoWWWX/md-king/releases/download";
const PUBLIC_KEY: &str = include_str!("../../update-public-key.txt");

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct UpdateManifest {
    pub version: String,
    pub asset: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<DeltaManifest>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeltaManifest {
    pub base_version: String,
    pub base_size: u64,
    pub base_sha256: String,
    pub asset: String,
    pub size: u64,
    pub sha256: String,
}

pub fn delta_asset_name(base_version: &str, version: &str) -> Result<String, String> {
    release_directory(base_version)?;
    release_directory(version)?;
    Ok(format!("md-king_{}_to_{}_x64.patch", base_version.trim_start_matches('v'), version.trim_start_matches('v')))
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit())
}

pub fn release_directory(version: &str) -> Result<String, String> {
    let normalized = version.strip_prefix('v').unwrap_or(version);
    let parts: Vec<&str> = normalized.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit())) {
        return Err("更新版本号必须为 vX.Y.Z。".into());
    }
    Ok(format!("{RELEASE_BASE}/v{normalized}"))
}

pub fn verify_manifest(bytes: &[u8], signature: &str, version: &str, url: &str) -> Result<UpdateManifest, String> {
    let public_key = STANDARD.decode(PUBLIC_KEY.trim()).map_err(|_| "更新公钥配置无效。")?;
    verify_manifest_with_key(bytes, signature, version, url, &public_key)
}

fn verify_manifest_with_key(bytes: &[u8], signature: &str, version: &str, url: &str, key: &[u8]) -> Result<UpdateManifest, String> {
    let signature = STANDARD.decode(signature.trim()).map_err(|_| "更新签名格式无效。")?;
    UnparsedPublicKey::new(&ED25519, key).verify(bytes, &signature)
        .map_err(|_| "更新清单签名校验失败，已阻止下载和安装。")?;
    let manifest: UpdateManifest = serde_json::from_slice(bytes).map_err(|_| "更新清单格式无效。")?;
    let normalized = version.trim_start_matches('v');
    let expected_asset = format!("md-king_{normalized}_x64-setup.exe");
    if manifest.version != format!("v{normalized}") || manifest.asset != expected_asset
        || url != format!("{}/{}", release_directory(version)?, expected_asset)
        || manifest.size == 0 || !valid_hash(&manifest.sha256) {
        return Err("安装包来源、版本或校验信息与签名清单不一致。".into());
    }
    if let Some(delta) = &manifest.delta {
        if !delta.base_version.starts_with('v') || delta.base_version == manifest.version || delta.base_size == 0
            || !valid_hash(&delta.base_sha256) || !valid_hash(&delta.sha256)
            || delta.size == 0 || delta.size >= manifest.size
            || delta.asset != delta_asset_name(&delta.base_version, &manifest.version)? {
            return Err("增量更新信息无效。".into());
        }
    }
    Ok(manifest)
}

pub fn verify_installer(path: &Path, manifest: &UpdateManifest) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取安装包：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() != manifest.size {
        return Err("安装包大小校验失败，已阻止安装。".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| format!("安装包校验失败：{e}"))?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != manifest.sha256.to_lowercase() {
        return Err("安装包 SHA-256 校验失败，文件可能已损坏或被替换。".into());
    }
    Ok(())
}

pub fn installer_arguments(silent: bool, install_dir: &Path) -> Vec<String> {
    let mut args = Vec::new();
    if silent { args.push("/S".into()); }
    args.extend(["/UPDATE".into(), "/R".into()]);
    // NSIS requires /D to be last. Keep the existing custom installation directory.
    args.push(format!("/D={}", install_dir.display()));
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::{rand::SystemRandom, signature::{Ed25519KeyPair, KeyPair}};

    #[test]
    fn rejects_modified_manifest_and_wrong_release_origin() {
        let keys = Ed25519KeyPair::from_pkcs8(Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap().as_ref()).unwrap();
        let bytes = br#"{"version":"v1.1.9","asset":"md-king_1.1.9_x64-setup.exe","size":3,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
        let sig = STANDARD.encode(keys.sign(bytes).as_ref());
        let url = format!("{RELEASE_BASE}/v1.1.9/md-king_1.1.9_x64-setup.exe");
        assert!(verify_manifest_with_key(bytes, &sig, "v1.1.9", &url, keys.public_key().as_ref()).is_ok());
        assert!(verify_manifest_with_key(bytes, &sig, "v1.1.9", "https://example.com/setup.exe", keys.public_key().as_ref()).is_err());
        assert!(verify_manifest_with_key(bytes, &sig, "v1.1.10", &url, keys.public_key().as_ref()).is_err());
        let mut modified = bytes.to_vec();
        modified[15] ^= 1;
        assert!(verify_manifest_with_key(&modified, &sig, "v1.1.9", &url, keys.public_key().as_ref()).is_err());
        assert!(release_directory("../../other").is_err());
    }

    #[test]
    fn rechecks_downloaded_file_before_execution() {
        let path = std::env::temp_dir().join(format!("mdking-update-test-{}.exe", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        let manifest = UpdateManifest { version: "v1.1.9".into(), asset: "setup.exe".into(), size: 3, sha256: format!("{:x}", Sha256::digest(b"abc")), delta: None };
        assert!(verify_installer(&path, &manifest).is_ok());
        std::fs::write(&path, b"xyz").unwrap();
        assert!(verify_installer(&path, &manifest).is_err());
        std::fs::write(&path, b"ab").unwrap();
        assert!(verify_installer(&path, &manifest).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn silent_updates_restart_and_preserve_custom_install_directory() {
        assert_eq!(installer_arguments(true, Path::new("G:\\md-king")), ["/S", "/UPDATE", "/R", "/D=G:\\md-king"]);
        assert_eq!(installer_arguments(false, Path::new("G:\\md-king")), ["/UPDATE", "/R", "/D=G:\\md-king"]);
    }

    #[test]
    fn delta_metadata_is_signed_and_restricted_to_the_release_asset() {
        let keys = Ed25519KeyPair::from_pkcs8(Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap().as_ref()).unwrap();
        let mut manifest = serde_json::json!({ "version":"v1.1.18", "asset":"md-king_1.1.18_x64-setup.exe", "size":4096, "sha256":"a".repeat(64),
            "delta": { "base_version":"v1.1.17", "base_size":4096, "base_sha256":"b".repeat(64), "asset":"md-king_1.1.17_to_1.1.18_x64.patch", "size":128, "sha256":"c".repeat(64) } });
        let url = format!("{RELEASE_BASE}/v1.1.18/md-king_1.1.18_x64-setup.exe");
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let sig = STANDARD.encode(keys.sign(&bytes).as_ref());
        assert!(verify_manifest_with_key(&bytes, &sig, "v1.1.18", &url, keys.public_key().as_ref()).unwrap().delta.is_some());
        manifest["delta"]["asset"] = "../../other.patch".into();
        let modified = serde_json::to_vec(&manifest).unwrap();
        assert!(verify_manifest_with_key(&modified, &sig, "v1.1.18", &url, keys.public_key().as_ref()).is_err());
        let bad_sig = STANDARD.encode(keys.sign(&modified).as_ref());
        assert!(verify_manifest_with_key(&modified, &bad_sig, "v1.1.18", &url, keys.public_key().as_ref()).is_err());
    }
}
