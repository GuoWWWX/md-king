use crate::core::config::{load_config, save_config as save_config_core, AppConfig, AppStatus};
use crate::system::context_menu::sync_context_menu;
use crate::system::quick_paste::sync_quick_paste;
use crate::system::tray::sync_tray;
use tauri::AppHandle;

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
pub fn save_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    sync_context_menu(config.enable_context_menu)?;
    sync_tray(&app, config.enable_tray)?;
    sync_quick_paste(&app, &config)?;
    save_config_core(config)
}
