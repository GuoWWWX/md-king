use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::storage::atomic::write_atomic;
use crate::storage::paths::config_path;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub version: String,
    pub description: String,
    pub tauri_version: String,
    pub platform: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub pandoc_path: Option<String>,
    pub use_bundled_pandoc: bool,
    pub default_template_id: String,
    pub default_output_dir: Option<String>,
    pub open_after_convert: bool,
    pub enable_context_menu: bool,
    pub enable_floating_ball: bool,
    pub enable_tray: bool,
    #[serde(default = "default_enable_quick_paste")]
    pub enable_quick_paste: bool,
    #[serde(default = "default_quick_paste_shortcut")]
    pub quick_paste_shortcut: String,
    #[serde(default)]
    pub quick_paste_template_id: Option<String>,
    pub cli_default_json: bool,
    pub log_level: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_conflict_strategy")]
    pub default_conflict_strategy: String,
    #[serde(default = "default_keep_conversion_log")]
    pub keep_conversion_log: bool,
    /// vault 相关字段全部 `#[serde(default)]`：老版本写下的 config.json 没有这几个键，
    /// 缺了默认值会让整份配置反序列化失败、被静默重置成出厂设置。
    #[serde(default)]
    pub vault_root: Option<String>,
    #[serde(default)]
    pub recent_vaults: Vec<String>,
    #[serde(default = "default_auto_save")]
    pub auto_save: bool,
    #[serde(default = "default_auto_save_delay_ms")]
    pub auto_save_delay_ms: u64,
    #[serde(default = "default_page_zoom_percent")]
    pub page_zoom_percent: u32,
    #[serde(default)]
    pub file_tree_width: Option<u32>,
    #[serde(default)]
    pub last_opened_file: Option<String>,
}

/// 最近打开的目录保留几条。
pub const MAX_RECENT_VAULTS: usize = 10;

/// 自动保存防抖的上下限。太短会把每个按键都变成一次磁盘写，
/// 太长则失去「自动」的意义，用户切走时改动还没落盘。
const MIN_AUTO_SAVE_DELAY_MS: u64 = 300;
const MAX_AUTO_SAVE_DELAY_MS: u64 = 10_000;

/// 页面缩放范围：避免过小影响可读性，也避免过大导致工作区横向溢出。
const MIN_PAGE_ZOOM_PERCENT: u32 = 80;
const MAX_PAGE_ZOOM_PERCENT: u32 = 120;

/// 文件树面板宽度的上下限，和前端拖拽分隔条的约束保持一致。
const MIN_FILE_TREE_WIDTH: u32 = 180;
const MAX_FILE_TREE_WIDTH: u32 = 520;

pub fn default_config() -> AppConfig {
    AppConfig {
        pandoc_path: None,
        use_bundled_pandoc: true,
        default_template_id: "default-report".to_string(),
        default_output_dir: default_output_dir(),
        open_after_convert: true,
        enable_context_menu: false,
        enable_floating_ball: false,
        enable_tray: false,
        enable_quick_paste: false,
        quick_paste_shortcut: default_quick_paste_shortcut(),
        quick_paste_template_id: None,
        cli_default_json: true,
        log_level: "info".to_string(),
        language: default_language(),
        theme_mode: default_theme_mode(),
        accent_color: default_accent_color(),
        default_conflict_strategy: default_conflict_strategy(),
        keep_conversion_log: default_keep_conversion_log(),
        vault_root: None,
        recent_vaults: Vec::new(),
        auto_save: default_auto_save(),
        auto_save_delay_ms: default_auto_save_delay_ms(),
        page_zoom_percent: default_page_zoom_percent(),
        file_tree_width: None,
        last_opened_file: None,
    }
}

fn default_output_dir() -> Option<String> {
    let base = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|path| path.join("Documents"))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents")))?;
    Some(base.join("MD King").to_string_lossy().to_string())
}

fn is_legacy_relative_default_output_dir(value: &str) -> bool {
    value
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .eq_ignore_ascii_case("documents/md king")
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_theme_mode() -> String {
    "light".to_string()
}

fn default_accent_color() -> String {
    "blue".to_string()
}

fn default_conflict_strategy() -> String {
    "overwrite".to_string()
}

fn default_keep_conversion_log() -> bool {
    true
}

fn default_enable_quick_paste() -> bool {
    false
}

fn default_quick_paste_shortcut() -> String {
    "Ctrl+Alt+V".to_string()
}

fn default_auto_save() -> bool {
    true
}

fn default_auto_save_delay_ms() -> u64 {
    1000
}

fn default_page_zoom_percent() -> u32 {
    100
}

pub fn load_config() -> AppConfig {
    let Ok(path) = config_path() else {
        return default_config();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return default_config();
    };

    serde_json::from_str(&content)
        .map(normalize_config)
        .unwrap_or_else(|_| default_config())
}

pub fn save_config(config: AppConfig) -> Result<AppConfig, String> {
    let path = config_path().map_err(|error| format!("获取配置路径失败：{error}"))?;
    let config = normalize_config(config);
    let content = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("序列化配置失败：{error}"))?;
    write_atomic(&path, &content).map_err(|error| format!("写入配置失败：{error}"))?;
    Ok(config)
}

fn normalize_config(mut config: AppConfig) -> AppConfig {
    let normalized_path = config
        .pandoc_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string);

    let is_legacy_default =
        matches!(normalized_path.as_deref(), Some("pandoc")) && !config.use_bundled_pandoc;
    if is_legacy_default {
        config.pandoc_path = None;
        config.use_bundled_pandoc = true;
    } else {
        config.pandoc_path = normalized_path;
    }

    config.log_level = match config.log_level.as_str() {
        "error" | "warn" | "info" | "debug" => config.log_level,
        _ => "info".to_string(),
    };
    config.language = match config.language.as_str() {
        "zh" | "en" => config.language,
        _ => default_language(),
    };
    config.theme_mode = match config.theme_mode.as_str() {
        "system" | "light" | "dark" => config.theme_mode,
        _ => default_theme_mode(),
    };
    config.accent_color = match config.accent_color.as_str() {
        "indigo" | "blue" | "emerald" | "sky" | "slate" | "rose" | "amber" => config.accent_color,
        _ => default_accent_color(),
    };
    config.default_conflict_strategy = match config.default_conflict_strategy.as_str() {
        "overwrite" | "rename" | "ask" => config.default_conflict_strategy,
        _ => default_conflict_strategy(),
    };
    config.quick_paste_shortcut = config.quick_paste_shortcut.trim().to_string();
    if config.quick_paste_shortcut.is_empty() {
        config.quick_paste_shortcut = default_quick_paste_shortcut();
    }
    config.quick_paste_template_id = config
        .quick_paste_template_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let output_dir = config
        .default_output_dir
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if output_dir.is_empty() || is_legacy_relative_default_output_dir(output_dir) {
        config.default_output_dir = default_output_dir();
    }

    normalize_vault_fields(&mut config);

    config
}

/// vault 相关字段的清洗。
///
/// 这里要处理的是「配置写下之后世界变了」的情况：目录被删、被移动到别的盘、
/// 或者用户手改了 config.json。启动时如果直接信任这些值，前端会拿一个不存在的
/// 根目录去列文件，第一次进转换页就报错，而用户没有任何自救入口。
fn normalize_vault_fields(config: &mut AppConfig) {
    config.vault_root = config
        .vault_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| std::path::Path::new(value).is_dir())
        .map(str::to_string);

    // Windows 路径不区分大小写，`D:\notes` 和 `d:\Notes` 是同一个目录，
    // 按原样去重会让最近列表里出现视觉上重复的条目。
    let mut seen: Vec<String> = Vec::with_capacity(MAX_RECENT_VAULTS);
    for item in std::mem::take(&mut config.recent_vaults) {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() || seen.len() >= MAX_RECENT_VAULTS {
            continue;
        }
        if seen
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&trimmed))
        {
            continue;
        }
        seen.push(trimmed);
    }
    config.recent_vaults = seen;

    config.auto_save_delay_ms = config
        .auto_save_delay_ms
        .clamp(MIN_AUTO_SAVE_DELAY_MS, MAX_AUTO_SAVE_DELAY_MS);

    config.page_zoom_percent = config
        .page_zoom_percent
        .clamp(MIN_PAGE_ZOOM_PERCENT, MAX_PAGE_ZOOM_PERCENT);

    config.file_tree_width = config
        .file_tree_width
        .map(|width| width.clamp(MIN_FILE_TREE_WIDTH, MAX_FILE_TREE_WIDTH));

    // 这个值会被直接拼进 vault 根目录再打开，必须在这里就掐掉绝对路径和向上穿越，
    // 而不是指望调用方记得校验。
    config.last_opened_file = config
        .last_opened_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| {
            let unified = value.replace('\\', "/");
            !unified.starts_with('/')
                && !unified.contains(':')
                && !unified.split('/').any(|segment| segment == "..")
        })
        .map(|value| value.replace('\\', "/"));
}

#[cfg(test)]
mod tests {
    use super::{default_config, normalize_config, AppConfig, MAX_RECENT_VAULTS};

    fn config_with(mutate: impl FnOnce(&mut AppConfig)) -> AppConfig {
        let mut config = default_config();
        mutate(&mut config);
        normalize_config(config)
    }

    #[test]
    fn drops_a_vault_root_that_no_longer_exists() {
        let config = config_with(|config| {
            config.vault_root = Some(r"D:\definitely\not\here\mk-vault".to_string());
        });
        assert!(config.vault_root.is_none());

        let existing = std::env::temp_dir();
        let config = config_with(|config| {
            config.vault_root = Some(existing.to_string_lossy().to_string());
        });
        assert!(config.vault_root.is_some());
    }

    #[test]
    fn deduplicates_and_truncates_recent_vaults() {
        let mut inputs = vec![
            r"D:\Notes".to_string(),
            r"d:\notes".to_string(),
            "  ".to_string(),
        ];
        inputs.extend((0..MAX_RECENT_VAULTS + 5).map(|index| format!(r"D:\v{index}")));

        let config = config_with(|config| config.recent_vaults = inputs);

        assert_eq!(config.recent_vaults.len(), MAX_RECENT_VAULTS);
        assert_eq!(config.recent_vaults[0], r"D:\Notes");
        assert_eq!(config.recent_vaults[1], r"D:\v0");
    }

    #[test]
    fn normalizes_page_zoom_to_supported_range() {
        let minimum = config_with(|config| config.page_zoom_percent = 1);
        assert_eq!(minimum.page_zoom_percent, 80);

        let maximum = config_with(|config| config.page_zoom_percent = 999);
        assert_eq!(maximum.page_zoom_percent, 120);

        let unchanged = config_with(|config| config.page_zoom_percent = 115);
        assert_eq!(unchanged.page_zoom_percent, 115);
    }

    #[test]
    fn clamps_auto_save_delay_and_file_tree_width() {
        let low = config_with(|config| {
            config.auto_save_delay_ms = 10;
            config.file_tree_width = Some(20);
        });
        assert_eq!(low.auto_save_delay_ms, 300);
        assert_eq!(low.file_tree_width, Some(180));

        let high = config_with(|config| {
            config.auto_save_delay_ms = 999_999;
            config.file_tree_width = Some(4000);
        });
        assert_eq!(high.auto_save_delay_ms, 10_000);
        assert_eq!(high.file_tree_width, Some(520));
    }

    #[test]
    fn migrates_legacy_relative_default_output_directory() {
        let config = config_with(|config| {
            config.default_output_dir = Some(r"Documents\MD King".to_string());
        });

        assert_eq!(
            config.default_output_dir,
            default_config().default_output_dir
        );
    }

    #[test]
    fn drops_a_last_opened_file_that_escapes_the_vault() {
        for candidate in [
            r"..\..\secret.md",
            "sub/../../secret.md",
            r"C:\secret.md",
            "/etc/passwd",
        ] {
            let config =
                config_with(|config| config.last_opened_file = Some(candidate.to_string()));
            assert!(config.last_opened_file.is_none(), "{candidate}");
        }

        let config =
            config_with(|config| config.last_opened_file = Some(r"docs\guide.md".to_string()));
        assert_eq!(config.last_opened_file.as_deref(), Some("docs/guide.md"));
    }

    #[test]
    fn keeps_old_configs_loadable_without_the_vault_keys() {
        // 回归测试：新字段忘了加 #[serde(default)] 的话，老 config.json 会整份解析失败，
        // 用户的模板、输出目录、快捷键设置会被一次性重置。
        let legacy = r#"{
            "pandocPath": null,
            "useBundledPandoc": true,
            "defaultTemplateId": "official-document",
            "defaultOutputDir": "D:\\out",
            "openAfterConvert": true,
            "enableContextMenu": false,
            "enableFloatingBall": false,
            "enableTray": false,
            "cliDefaultJson": true,
            "logLevel": "info"
        }"#;

        let config: AppConfig =
            serde_json::from_str(legacy).expect("legacy config should still parse");
        let config = normalize_config(config);

        assert_eq!(config.default_template_id, "official-document");
        assert!(config.auto_save);
        assert_eq!(config.auto_save_delay_ms, 1000);
        assert_eq!(config.page_zoom_percent, 100);
        assert!(config.recent_vaults.is_empty());
        assert!(config.vault_root.is_none());
    }
}
