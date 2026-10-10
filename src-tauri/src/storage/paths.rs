use std::env;
use std::fs;
use std::io;
use std::path::PathBuf;

pub fn app_data_dir_hint() -> &'static str {
    "md-king"
}

pub fn app_data_dir() -> io::Result<PathBuf> {
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .unwrap_or_else(env::temp_dir);
    let dir = base.join(app_data_dir_hint());
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn config_path() -> io::Result<PathBuf> {
    Ok(app_data_dir()?.join("config.json"))
}

pub fn history_path() -> io::Result<PathBuf> {
    // 转换历史属于应用运行数据，跟随安装目录保存，卸载时由安装器一并清理。
    // current_exe 在已安装桌面端和 CLI 中都指向实际程序目录；测试或异常环境
    // 无法解析时回退到旧的应用数据目录，避免历史功能因路径解析失败而不可用。
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            return Ok(parent.join("history.json"));
        }
    }
    Ok(app_data_dir()?.join("history.json"))
}

pub fn templates_path() -> io::Result<PathBuf> {
    Ok(app_data_dir()?.join("templates.json"))
}

pub fn template_styles_path() -> io::Result<PathBuf> {
    Ok(app_data_dir()?.join("template-styles.json"))
}

pub fn templates_dir() -> io::Result<PathBuf> {
    let dir = app_data_dir()?.join("templates");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}
