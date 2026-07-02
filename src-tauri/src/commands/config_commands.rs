use crate::core::config::{load_config, save_config as save_config_core, AppConfig, AppStatus};

#[tauri::command]
pub fn get_app_status() -> AppStatus {
    AppStatus {
        name: "md-king".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        description: env!("CARGO_PKG_DESCRIPTION").to_string(),
        tauri_version: "2".to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
pub fn get_app_config() -> AppConfig {
    load_config()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<AppConfig, String> {
    save_config_core(config)
}
