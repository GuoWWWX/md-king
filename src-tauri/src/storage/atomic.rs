use std::fs;
use std::path::Path;

/// 先写同目录临时文件再 rename 替换，避免写到一半被中断（崩溃、断电、被杀进程）
/// 留下半个 JSON。rename 本身是原子的，读方要么看到旧内容要么看到新内容。
///
/// 注意这里只解决「写坏」，不解决「并发覆盖」：两个进程同时读-改-写时，
/// 后写的仍然会赢。调用方需要在写前重新读盘来缩小这个窗口。
pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let temp_path = path.with_extension(format!("tmp-{}", timestamp_suffix()));
    fs::write(&temp_path, content)?;
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

/// 给临时文件、损坏文件备份取唯一后缀，避免同一毫秒内的并发写互相踩。
pub fn timestamp_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::write_atomic;
    use std::fs;

    #[test]
    fn replaces_existing_file_without_leaving_temp_files() {
        let dir = std::env::temp_dir().join(format!("mk-atomic-{}", super::timestamp_suffix()));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join("data.json");
        fs::write(&path, "old").expect("seed file should be written");

        write_atomic(&path, "new").expect("atomic write should succeed");

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name() != "data.json")
            .collect();
        assert!(leftovers.is_empty(), "temp file should be renamed away");

        let _ = fs::remove_dir_all(&dir);
    }
}
