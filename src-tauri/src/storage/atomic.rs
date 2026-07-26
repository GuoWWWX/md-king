use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 同一进程内的写入序号，和 pid、毫秒时间戳一起构成临时文件名的唯一后缀。
/// 只靠时间戳不够：毫秒精度下并发写很容易撞在同一个值上。
static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

/// 先写同目录临时文件再 rename 替换，避免写到一半被中断（崩溃、断电、被杀进程）
/// 留下半个 JSON。rename 本身是原子的，读方要么看到旧内容要么看到新内容。
///
/// 注意这里只解决「写坏」，不解决「并发覆盖」：两个进程同时读-改-写时，
/// 后写的仍然会赢。调用方需要在写前重新读盘来缩小这个窗口。
pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let temp_path = temp_path_for(path);
    if let Err(error) = fs::write(&temp_path, content) {
        // 磁盘满、配额超限正是写到一半失败的典型场景，这时临时文件已经存在了。
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

/// 面向用户文档的原子写：比 [`write_atomic`] 多一次 `sync_all`。
///
/// 配置、历史这类文件丢了还能重建，用户的 .md 丢一次就是真丢了。不 fsync 的话，
/// 断电时可能出现「目录项已更新、文件数据还没落盘」——rename 成功了，内容却是空的，
/// 比没写还糟。
pub fn write_atomic_durable(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp_path = temp_path_for(path);
    let write_result = (|| {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

/// 为目标文件构造同目录的临时文件路径。
///
/// 必须保留原文件名（而不是用 `with_extension` 把扩展名换掉）：后者会让同目录下的
/// `notes.md` 和 `notes.txt` 生成同一个临时路径，两次保存互相覆盖。用户 vault 里
/// 同名不同扩展名的文件是常态，这一定会撞。
///
/// 前导点让临时文件在资源管理器和应用自己的文件树里天然隐藏。
fn temp_path_for(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!(
        ".{name}.mk-tmp-{}-{}-{}",
        std::process::id(),
        timestamp_suffix(),
        WRITE_SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

/// 给损坏文件备份取唯一后缀。
pub fn timestamp_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{temp_path_for, write_atomic, write_atomic_durable};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mk-atomic-{}-{}-{}",
            tag,
            std::process::id(),
            super::timestamp_suffix()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    fn leftovers(dir: &Path, keep: &[&str]) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| !keep.contains(&name.as_str()))
            .collect()
    }

    #[test]
    fn replaces_existing_file_without_leaving_temp_files() {
        let dir = scratch_dir("replace");
        let path = dir.join("data.json");
        fs::write(&path, "old").expect("seed file should be written");

        write_atomic(&path, "new").expect("atomic write should succeed");

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(
            leftovers(&dir, &["data.json"]).is_empty(),
            "temp file should be renamed away"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn temp_path_keeps_full_file_name_so_siblings_do_not_collide() {
        // 回归测试：曾经用 with_extension 生成临时路径，同目录的 a.md 与 a.txt
        // 会得到同一个临时文件名，两次保存互相覆盖。
        let dir = Path::new("C:/vault");
        let markdown_temp = temp_path_for(&dir.join("a.md"));
        let text_temp = temp_path_for(&dir.join("a.txt"));

        assert_ne!(markdown_temp, text_temp);
        assert!(markdown_temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".a.md."));
        assert!(text_temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".a.txt."));
    }

    #[test]
    fn temp_paths_are_unique_within_the_same_millisecond() {
        // 毫秒时间戳挡不住并发；序号才是唯一性的来源。
        let path = Path::new("C:/vault/notes.md");
        let first = temp_path_for(path);
        let second = temp_path_for(path);

        assert_ne!(first, second);
    }

    #[test]
    fn does_not_leave_temp_file_when_write_fails() {
        let dir = scratch_dir("write-fail");
        // 目标路径的父目录不存在，File::create / fs::write 必定失败。
        let path = dir.join("missing-dir").join("data.json");

        assert!(write_atomic(&path, "payload").is_err());
        assert!(write_atomic_durable(&path, b"payload").is_err());
        assert!(
            leftovers(&dir, &[]).is_empty(),
            "failed writes should not leave temp files behind"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn durable_write_replaces_content_and_cleans_up() {
        let dir = scratch_dir("durable");
        let path = dir.join("notes.md");
        fs::write(&path, "old").expect("seed file should be written");

        write_atomic_durable(&path, "新内容\r\n".as_bytes()).expect("durable write should succeed");

        assert_eq!(fs::read(&path).unwrap(), "新内容\r\n".as_bytes());
        assert!(
            leftovers(&dir, &["notes.md"]).is_empty(),
            "temp file should be renamed away"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
