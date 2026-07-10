use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
}

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
    }
}

fn default_output_dir() -> Option<String> {
    let base = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|path| path.join("Documents"))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents")))?;
    Some(base.join("MD King").to_string_lossy().to_string())
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
    fs::write(path, content).map_err(|error| format!("写入配置失败：{error}"))?;
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
    if config
        .default_output_dir
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        config.default_output_dir = default_output_dir();
    }

    config
}
