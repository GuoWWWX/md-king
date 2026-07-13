use std::path::Path;
use std::process::Command;

pub fn open_path(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|error| error.to_string())
}

pub fn reveal_path(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    if !path.is_file() {
        return Err("生成的 DOCX 文件不存在。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_path(path.parent().unwrap_or(path))
    }
}
