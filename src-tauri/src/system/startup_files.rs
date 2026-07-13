use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

const OPEN_FILES_EVENT: &str = "open-files://available";

#[derive(Default)]
pub struct PendingOpenFiles(Mutex<Vec<String>>);

pub fn queue_open_files(app: &AppHandle, args: Vec<String>) -> bool {
    let paths = supported_document_paths(args);
    if paths.is_empty() {
        return false;
    }

    if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
        for path in paths {
            if !pending
                .iter()
                .any(|current| current.eq_ignore_ascii_case(&path))
            {
                pending.push(path);
            }
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit(OPEN_FILES_EVENT, ());
    true
}

pub fn has_existing_file_argument(args: &[String]) -> bool {
    args.iter().map(PathBuf::from).any(|path| path.is_file())
}

#[tauri::command]
pub fn take_open_files(state: State<'_, PendingOpenFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

fn supported_document_paths(args: Vec<String>) -> Vec<String> {
    if args.iter().any(|arg| arg == "--convert") {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    args.into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_supported_document(path))
        .filter_map(|path| {
            let value = path.to_string_lossy().to_string();
            seen.insert(value.to_ascii_lowercase()).then_some(value)
        })
        .collect()
}

fn is_supported_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{has_existing_file_argument, is_supported_document, supported_document_paths};
    use std::fs;
    use std::path::Path;

    #[test]
    fn accepts_markdown_and_text_extensions_only() {
        assert!(is_supported_document(Path::new("demo.md")));
        assert!(is_supported_document(Path::new("demo.MARKDOWN")));
        assert!(is_supported_document(Path::new("demo.txt")));
        assert!(!is_supported_document(Path::new("demo.docx")));
        assert!(!is_supported_document(Path::new("demo.pdf")));
    }

    #[test]
    fn filters_missing_and_unsupported_startup_files() {
        let dir =
            std::env::temp_dir().join(format!("md-king-startup-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let markdown = dir.join("demo.md");
        let text = dir.join("notes.txt");
        let docx = dir.join("ignored.docx");
        fs::write(&markdown, "# Demo").unwrap();
        fs::write(&text, "Notes").unwrap();
        fs::write(&docx, "Not a real DOCX").unwrap();

        let paths = supported_document_paths(vec![
            markdown.to_string_lossy().to_string(),
            text.to_string_lossy().to_string(),
            docx.to_string_lossy().to_string(),
            dir.join("missing.md").to_string_lossy().to_string(),
        ]);

        assert_eq!(paths.len(), 2);
        assert!(paths.iter().any(|path| path.ends_with("demo.md")));
        assert!(paths.iter().any(|path| path.ends_with("notes.txt")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ignores_files_owned_by_explicit_context_conversion() {
        let paths = supported_document_paths(vec![
            "--convert".to_string(),
            r"C:\Docs\demo.md".to_string(),
        ]);

        assert!(paths.is_empty());
    }

    #[test]
    fn detects_existing_file_arguments() {
        let path = std::env::temp_dir().join(format!(
            "md-king-startup-argument-{}.docx",
            std::process::id()
        ));
        fs::write(&path, "ignored").unwrap();

        assert!(has_existing_file_argument(&[path
            .to_string_lossy()
            .to_string()]));
        assert!(!has_existing_file_argument(&["--help".to_string()]));
        let _ = fs::remove_file(path);
    }
}
