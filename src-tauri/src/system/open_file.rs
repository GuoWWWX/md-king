use std::path::Path;

pub fn open_path(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|error| error.to_string())
}
