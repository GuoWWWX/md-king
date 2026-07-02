mod commands;
mod core;
mod storage;
mod system;

use commands::{
    check_pandoc, clear_history, convert_markdown, get_app_config, get_app_status,
    import_template, list_history, list_templates, open_output_path, reset_template_style_config, save_app_config,
    save_history, save_template_style_config, save_templates, get_template_style_config,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = storage::paths::app_data_dir_hint();
    let _ = core::errors::AppError::new("INIT", "placeholder");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_app_config,
            save_app_config,
            check_pandoc,
            list_templates,
            import_template,
            save_templates,
            get_template_style_config,
            save_template_style_config,
            reset_template_style_config,
            list_history,
            save_history,
            clear_history,
            open_output_path,
            convert_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
