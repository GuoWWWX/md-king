mod commands;
mod core;
mod storage;
mod system;

pub use core::convert::{convert_markdown_cli, ConvertRequest, ConvertResult};
pub use core::template::{
    list_templates as list_templates_for_cli, resolve_template_selector_for_cli, Template,
    TemplateSelectorError,
};

use commands::{
    append_history, check_pandoc, clear_history, convert_markdown, get_app_config, get_app_status,
    get_template_style_config, get_template_style_configs, import_template, list_history,
    list_templates, load_preview_image, open_output_path, read_markdown_file,
    reset_template_style_config, reveal_output_path, save_app_config, save_history,
    save_template_style_config, save_templates,
};
use core::config::load_config;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = storage::paths::app_data_dir_hint();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let _ = system::startup_files::queue_open_files(app, args);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(system::startup_files::PendingOpenFiles::default())
        .setup(|app| {
            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon);
                }
            }
            let config = load_config();
            system::context_menu::sync_context_menu(config.enable_context_menu)?;
            system::tray::sync_tray(app.handle(), config.enable_tray)?;
            system::quick_paste::sync_quick_paste(app.handle(), &config)?;
            let startup_args: Vec<String> = std::env::args().skip(1).collect();
            let has_file_argument =
                system::startup_files::has_existing_file_argument(&startup_args);
            let queued_files =
                system::startup_files::queue_open_files(app.handle(), startup_args.clone());
            if has_file_argument
                && !queued_files
                && !startup_args.iter().any(|arg| arg == "--convert")
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                app.handle().exit(0);
                return Ok(());
            }
            system::context_menu::handle_startup_context_action(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if system::tray::hide_main_window_to_tray(window) {
                    api.prevent_close();
                    return;
                }

                if window.label() == "main" {
                    api.prevent_close();
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_app_config,
            save_app_config,
            check_pandoc,
            list_templates,
            import_template,
            save_templates,
            get_template_style_config,
            get_template_style_configs,
            save_template_style_config,
            reset_template_style_config,
            list_history,
            save_history,
            append_history,
            clear_history,
            open_output_path,
            reveal_output_path,
            system::startup_files::take_open_files,
            read_markdown_file,
            load_preview_image,
            convert_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
