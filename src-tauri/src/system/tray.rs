use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window};

use crate::core::config::load_config;

const TRAY_ID: &str = "md-king-tray";
const MENU_SHOW_ID: &str = "show-main";
const MENU_QUIT_ID: &str = "quit-app";

pub fn sync_tray(app: &AppHandle, enable: bool) -> Result<(), String> {
    if enable {
        create_tray(app)
    } else {
        let _ = app.remove_tray_by_id(TRAY_ID);
        Ok(())
    }
}

pub fn hide_main_window_to_tray(window: &Window) -> bool {
    if window.label() != "main" || !load_config().enable_tray {
        return false;
    }

    let _ = window.hide();
    true
}

fn create_tray(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    let show = MenuItem::with_id(app, MENU_SHOW_ID, "显示 MD King", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let quit = MenuItem::with_id(app, MENU_QUIT_ID, "退出", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let menu = Menu::with_items(app, &[&show, &quit])
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("MD King")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW_ID => show_main_window(app),
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .build(app)
        .map(|_| ())
        .map_err(|error| format!("创建系统托盘失败：{error}"))
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        show_window(&window);
        let _ = window.emit("updater://check-on-open", ());
    }
}

fn show_window(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
