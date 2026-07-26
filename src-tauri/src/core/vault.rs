use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::storage::atomic::write_atomic_durable;

/// 一次遍历最多返回的条目数。超过就截断并置 `truncated`，让前端降级成逐层懒加载。
/// 没有这道闸时，用户误选 `C:\` 会把整棵盘符树读进内存再序列化成 JSON，直接卡死。
pub const MAX_VAULT_ENTRIES: usize = 20_000;

/// 相对路径与遍历的最大层数。既防深层目录把遍历拖垮，也顺带挡住构造超长路径的尝试。
pub const MAX_VAULT_DEPTH: usize = 12;

/// 单个文件的大小上限。编辑器要把整份内容读成 String 再送进 WebView，
/// 超过这个量级已经不是「能不能编辑」而是「会不会把渲染进程拖死」的问题。
pub const MAX_VAULT_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// 这些目录里几乎不会有用户想编辑的 Markdown，却常常包含成千上万个文件。
/// 不跳过的话，一个装了依赖的项目目录会瞬间吃掉全部条目配额。
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".obsidian",
    ".vscode",
    ".idea",
    ".trash",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    "$RECYCLE.BIN",
];

/// 只有白名单里的扩展名可读可写。这是「打开目录」这个能力的边界之一：
/// 即使路径校验被绕过，也写不到 .exe / .dll / .docx 上去。
const ALLOWED_EXT: &[&str] = &["md", "markdown", "txt"];

/// Windows 设备名。这些名字在任何目录下都会被解析成设备而不是文件，
/// 带扩展名的形式（`CON.md`）同样有效，所以要比较第一个点之前的部分。
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub const CODE_CONFLICT: &str = "CONFLICT";
pub const CODE_NOT_UTF8: &str = "NOT_UTF8";
pub const CODE_OUT_OF_VAULT: &str = "OUT_OF_VAULT";
pub const CODE_TOO_LARGE: &str = "TOO_LARGE";
pub const CODE_EXISTS: &str = "EXISTS";
pub const CODE_LOCKED: &str = "LOCKED";
pub const CODE_NOT_FOUND: &str = "NOT_FOUND";
pub const CODE_INVALID_NAME: &str = "INVALID_NAME";

pub const EOL_LF: &str = "lf";
pub const EOL_CRLF: &str = "crlf";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    /// 相对 vault 根目录的路径，统一用 `/` 分隔。前端所有引用都以它为键。
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub has_children: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultListing {
    pub root: String,
    pub entries: Vec<VaultEntry>,
    pub truncated: bool,
    pub skipped_dirs: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileContent {
    pub path: String,
    /// 已归一化为 `\n`，BOM 已剥离。编辑器内部只处理这一种形态。
    pub content: String,
    pub eol: String,
    pub has_bom: bool,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteResult {
    pub path: String,
    pub modified_ms: u64,
    pub size: u64,
}

/// 错误一律是 `CODE|中文提示`：前端要按 code 分流 UI（冲突弹窗、只读黄条、普通 toast），
/// 只给一句话没法区分。
fn vault_err(code: &str, message: &str) -> String {
    format!("{code}|{message}")
}

fn out_of_vault() -> String {
    vault_err(CODE_OUT_OF_VAULT, "该路径超出了当前打开的目录范围。")
}

/// 把打开的目录规范化成比较基准。
///
/// Windows 上 `canonicalize` 返回 `\\?\C:\...`，内部一律保存这个形式：
/// 8.3 短名、盘符大小写、相对路径这三种写法都会被它折叠成同一个串，
/// 否则 `starts_with` 边界判断可以被任意一种改写绕过。
pub fn canonical_root(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(vault_err(CODE_NOT_FOUND, "请先选择一个目录。"));
    }

    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(vault_err(CODE_NOT_FOUND, "目录不存在或已被移动。"));
    }

    fs::canonicalize(&path)
        .map_err(|error| vault_err(CODE_NOT_FOUND, &format!("无法访问该目录：{error}")))
}

/// 规范形式只用于内部比较，给前端看要剥掉 `\\?\`，否则界面上会出现一串奇怪前缀。
pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();

    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }
    if let Some(stripped) = value.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }

    value.to_string()
}

/// 把校验通过的相对路径还原成 `/` 分隔的字符串。
fn to_relative_string(relative: &Path) -> String {
    relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 纯语法层校验：不碰文件系统，只判断这个相对路径本身是否可接受。
///
/// 关键在于用 `Path::components()` 而不是字符串匹配 ".."：后者挡不住 `....//x.md`
/// 这类变形，而 `components()` 会如实告诉我们每一段到底是什么。
fn validate_relative_path(relative: &str) -> Result<PathBuf, String> {
    // 只吃掉前导空白（复制粘贴常带）。尾部空白不能一起 trim 掉：`a.md ` 和 `a.md`
    // 在 Windows 上是同一个文件，静默改写等于替用户操作了另一个文件，
    // 这正是下面尾随空格规则要挡住的事，得让它走到那条规则上去。
    let raw = relative.trim_start();
    if raw.is_empty() {
        return Err(vault_err(CODE_INVALID_NAME, "路径不能为空。"));
    }

    // 前端传 `a/b`，从资源管理器粘贴过来的是 `a\b`，统一成 `/` 后再交给 Path 解析，
    // 这样在非 Windows 平台上跑测试时 `..\..\x` 也能被正确识别成向上穿越。
    let unified = raw.replace('\\', "/");
    if unified.starts_with("//") {
        return Err(vault_err(CODE_OUT_OF_VAULT, "不支持网络共享路径。"));
    }

    let candidate = Path::new(&unified);
    if candidate.is_absolute() {
        return Err(vault_err(
            CODE_OUT_OF_VAULT,
            "只能访问当前打开目录内的相对路径。",
        ));
    }

    let mut normalized = PathBuf::new();
    let mut depth = 0usize;
    for component in candidate.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => {
                let name = part.to_str().ok_or_else(|| {
                    vault_err(CODE_INVALID_NAME, "路径中包含无法识别的字符。")
                })?;
                validate_component(name)?;
                depth += 1;
                // 必须逐段 push：`\\?\` 前缀的路径不会把 `/` 当分隔符，
                // 一次性 push "a/b.md" 会拼出 Windows 打不开的 `\\?\C:\vault\a/b.md`。
                normalized.push(name);
            }
            _ => return Err(out_of_vault()),
        }
    }

    if depth == 0 {
        return Err(vault_err(CODE_INVALID_NAME, "路径不能为空。"));
    }
    if depth > MAX_VAULT_DEPTH {
        return Err(vault_err(
            CODE_OUT_OF_VAULT,
            &format!("目录层级超过 {MAX_VAULT_DEPTH} 层，已停止访问。"),
        ));
    }

    Ok(normalized)
}

/// 单段名称的校验。目录名和文件名走同一套：一个叫 `CON` 的目录和一个叫 `CON.md`
/// 的文件同样打不开，末尾带点的目录名同样会被 Windows 静默改名。
fn validate_component(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能为空。"));
    }

    // 冒号既可能是盘符（`a:stream.md` 会被解析成 a 盘），也可能是 NTFS 备用数据流
    // （`note.md:hidden`）——后者能把内容写进一个在资源管理器里完全看不见的位置。
    if name.contains(':') {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能包含冒号。"));
    }
    if name
        .chars()
        .any(|value| matches!(value, '<' | '>' | '"' | '|' | '?' | '*') || (value as u32) < 0x20)
    {
        return Err(vault_err(
            CODE_INVALID_NAME,
            r#"名称不能包含 < > " | ? * 和控制字符。"#,
        ));
    }

    // Windows 在创建时会悄悄去掉末尾的空格和点，导致「请求的名字」和「盘上的名字」
    // 对不上——后续的乐观锁比对和树选中态都会跟着错位。点之前的主干同理。
    let stem = name.split('.').next().unwrap_or(name);
    if name.ends_with(' ') || name.ends_with('.') || stem.ends_with(' ') {
        return Err(vault_err(
            CODE_INVALID_NAME,
            "名称不能以空格或点结尾。",
        ));
    }

    if WINDOWS_RESERVED_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return Err(vault_err(
            CODE_INVALID_NAME,
            "该名称是 Windows 保留的设备名，无法使用。",
        ));
    }

    Ok(())
}

/// 把相对路径解析成真实路径，任何一层不过就整体拒绝。
///
/// 第七道闸（canonicalize 后比对前缀）是唯一能挡住 junction 的：`mklink /J` 普通用户
/// 就能建，一个指向 `C:\Windows` 的目录链接在语法上完全合法，只有让系统真正解析一次
/// 才能看出它落在哪里。
pub fn resolve_in_vault(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = validate_relative_path(relative)?;
    let joined = root.join(&normalized);

    // 新建文件时 joined 本身还不存在，但它的某一层父目录可能就是那个链接，
    // 所以要往上找到第一个真实存在的祖先再解析。
    let mut probe = joined.as_path();
    let existing = loop {
        if probe.exists() {
            break probe;
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => return Err(out_of_vault()),
        }
    };

    let canonical = fs::canonicalize(existing).map_err(|_| out_of_vault())?;
    if !canonical.starts_with(root) {
        return Err(out_of_vault());
    }

    Ok(joined)
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn is_allowed_file(path: &Path) -> bool {
    extension_of(path).is_some_and(|extension| ALLOWED_EXT.contains(&extension.as_str()))
}

fn ensure_allowed_file(path: &Path) -> Result<(), String> {
    if is_allowed_file(path) {
        return Ok(());
    }
    Err(vault_err(
        CODE_INVALID_NAME,
        "只能操作 .md、.markdown 和 .txt 文件。",
    ))
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Windows 的隐藏属性是标准库就能读的，不必为此引入新依赖。
fn is_hidden(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

/// 文件被占用（PowerShell 打开着、杀软扫描中）是自动保存最常见的失败原因，
/// 它和「文件没了」需要完全不同的前端处理：前者重试，后者提示重新打开。
fn io_error_message(action: &str, error: &std::io::Error) -> String {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => CODE_NOT_FOUND,
        _ => CODE_LOCKED,
    };
    vault_err(code, &format!("{action}失败：{error}"))
}

fn platform_default_eol() -> &'static str {
    if cfg!(windows) {
        EOL_CRLF
    } else {
        EOL_LF
    }
}

fn normalize_eol(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        EOL_CRLF => EOL_CRLF,
        EOL_LF => EOL_LF,
        _ => platform_default_eol(),
    }
}

/// 用第一个换行符定调：它是 `\r\n` 就整份当 CRLF。混合换行的文件按第一个走，
/// 写回时会被统一——这比保留混合状态更符合用户预期。
fn detect_eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(0) => EOL_LF,
        Some(index) => {
            if text.as_bytes()[index - 1] == b'\r' {
                EOL_CRLF
            } else {
                EOL_LF
            }
        }
        None => platform_default_eol(),
    }
}

fn normalize_newlines(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn restore_newlines(text: &str, eol: &str) -> String {
    if eol == EOL_CRLF {
        // 进来的内容已经归一化成 `\n`，直接替换不会产生 `\r\r\n`。
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

fn dir_has_visible_children(path: &Path) -> bool {
    let Ok(read) = fs::read_dir(path) else {
        return false;
    };

    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.file_type().is_symlink() || is_hidden(&meta) {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if meta.is_dir() {
            if SKIP_DIRS
                .iter()
                .any(|skip| name.eq_ignore_ascii_case(skip))
            {
                continue;
            }
            return true;
        }
        if is_allowed_file(Path::new(name)) {
            return true;
        }
    }

    false
}

/// 排序键：逐段的 (是否文件, 小写名, 原名)。
type SortKey = Vec<(u8, String, String)>;

/// 目录在前、同级按名称排。键做成「逐段 (是否文件, 小写名, 原名)」的向量后，
/// 向量自带的字典序恰好等价于「父目录先于子目录、同级目录先于文件」的深度优先序，
/// 不用手写比较函数。
fn sort_key(entry: &VaultEntry) -> SortKey {
    let segments: Vec<&str> = entry.path.split('/').collect();
    let last_index = segments.len().saturating_sub(1);

    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let is_dir = index < last_index || entry.is_dir;
            (
                if is_dir { 0 } else { 1 },
                segment.to_lowercase(),
                (*segment).to_string(),
            )
        })
        .collect()
}

pub fn list_entries(
    root: &Path,
    dir: Option<&str>,
    recursive: bool,
) -> Result<VaultListing, String> {
    walk_vault(root, dir, recursive, MAX_VAULT_ENTRIES)
}

/// 手写显式栈而不是引 `walkdir`：跳过规则、深度上限、条目上限和「不跟随链接」
/// 这四件事需要在同一个循环里协同判断，用回调式 API 反而更难写对。
fn walk_vault(
    root: &Path,
    dir: Option<&str>,
    recursive: bool,
    max_entries: usize,
) -> Result<VaultListing, String> {
    let (start_abs, start_rel, start_depth) = match dir.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => {
            let absolute = resolve_in_vault(root, value)?;
            if !absolute.is_dir() {
                return Err(vault_err(CODE_NOT_FOUND, "目录不存在或已被删除。"));
            }
            let normalized = validate_relative_path(value)?;
            let depth = normalized.components().count();
            (absolute, to_relative_string(&normalized), depth)
        }
        None => (root.to_path_buf(), String::new(), 0),
    };

    let mut stack = vec![(start_abs, start_rel, start_depth)];
    let mut entries: Vec<VaultEntry> = Vec::new();
    let mut skipped_dirs = 0usize;
    let mut truncated = false;

    while let Some((dir_abs, dir_rel, depth)) = stack.pop() {
        let read = match fs::read_dir(&dir_abs) {
            Ok(read) => read,
            Err(_) => {
                // 权限不足的子目录不该让整次列目录失败，记一笔跳过继续走。
                skipped_dirs += 1;
                continue;
            }
        };

        for entry in read.flatten() {
            if entries.len() >= max_entries {
                truncated = true;
                break;
            }

            // 用 DirEntry::metadata 而不是 fs::metadata：前者不跟随链接，
            // 才能把 junction 识别成链接本身而不是它指向的目录。
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                skipped_dirs += 1;
                continue;
            }
            if is_hidden(&meta) {
                if meta.is_dir() {
                    skipped_dirs += 1;
                }
                continue;
            }

            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                if meta.is_dir() {
                    skipped_dirs += 1;
                }
                continue;
            }

            let child_rel = if dir_rel.is_empty() {
                name.to_string()
            } else {
                format!("{dir_rel}/{name}")
            };

            if meta.is_dir() {
                if SKIP_DIRS
                    .iter()
                    .any(|skip| name.eq_ignore_ascii_case(skip))
                {
                    skipped_dirs += 1;
                    continue;
                }

                entries.push(VaultEntry {
                    path: child_rel.clone(),
                    name: name.to_string(),
                    is_dir: true,
                    size: 0,
                    modified_ms: modified_ms(&meta),
                    has_children: false,
                });

                if recursive && depth + 1 < MAX_VAULT_DEPTH {
                    stack.push((entry.path(), child_rel, depth + 1));
                }
                continue;
            }

            if !is_allowed_file(Path::new(name)) {
                continue;
            }

            entries.push(VaultEntry {
                path: child_rel,
                name: name.to_string(),
                is_dir: false,
                size: meta.len(),
                modified_ms: modified_ms(&meta),
                has_children: false,
            });
        }

        if truncated {
            break;
        }
    }

    fill_has_children(root, &mut entries, recursive, truncated);

    let mut keyed: Vec<(SortKey, VaultEntry)> = entries
        .into_iter()
        .map(|entry| (sort_key(&entry), entry))
        .collect();
    keyed.sort_by(|left, right| left.0.cmp(&right.0));

    Ok(VaultListing {
        root: display_path(root),
        entries: keyed.into_iter().map(|(_, entry)| entry).collect(),
        truncated,
        skipped_dirs,
    })
}

/// 递归模式下子目录已经在结果里，用「谁是别人的父」反推即可，不必额外开目录句柄；
/// 只有被深度或上限截断的那部分才需要真的探一次。
fn fill_has_children(root: &Path, entries: &mut [VaultEntry], recursive: bool, truncated: bool) {
    if recursive {
        let parents: HashSet<&str> = entries
            .iter()
            .filter_map(|entry| entry.path.rsplit_once('/').map(|(parent, _)| parent))
            .collect();
        let known: Vec<bool> = entries
            .iter()
            .map(|entry| parents.contains(entry.path.as_str()))
            .collect();

        let mut probes: Vec<usize> = Vec::new();
        for (index, entry) in entries.iter().enumerate() {
            if !entry.is_dir || known[index] {
                continue;
            }
            let depth = entry.path.matches('/').count() + 1;
            if truncated || depth >= MAX_VAULT_DEPTH {
                probes.push(index);
            }
        }

        for (index, entry) in entries.iter_mut().enumerate() {
            entry.has_children = known[index];
        }
        for index in probes {
            let path = root.join(entries[index].path.replace('/', std::path::MAIN_SEPARATOR_STR));
            entries[index].has_children = dir_has_visible_children(&path);
        }
        return;
    }

    for entry in entries.iter_mut() {
        if !entry.is_dir {
            continue;
        }
        let path = root.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        entry.has_children = dir_has_visible_children(&path);
    }
}

pub fn read_file(root: &Path, relative: &str) -> Result<VaultFileContent, String> {
    let absolute = resolve_in_vault(root, relative)?;
    ensure_allowed_file(&absolute)?;

    let meta = fs::metadata(&absolute).map_err(|error| io_error_message("读取文件", &error))?;
    if meta.is_dir() {
        return Err(vault_err(CODE_NOT_FOUND, "该路径是目录，无法作为文件打开。"));
    }
    if meta.len() > MAX_VAULT_FILE_BYTES {
        return Err(vault_err(
            CODE_TOO_LARGE,
            "文件超过 20 MB，已跳过载入以免拖垮编辑器。",
        ));
    }

    let bytes = fs::read(&absolute).map_err(|error| io_error_message("读取文件", &error))?;
    let text = String::from_utf8(bytes).map_err(|_| {
        vault_err(
            CODE_NOT_UTF8,
            "该文件不是 UTF-8 编码，暂不支持编辑。",
        )
    })?;

    // BOM 不剥掉会变成编辑器第一行行首的不可见字符：用户看不见它，
    // 却会让「以 # 开头」的标题判定失败，也会被一起转换进 Word。
    let (text, has_bom) = match text.strip_prefix('\u{FEFF}') {
        Some(stripped) => (stripped.to_string(), true),
        None => (text, false),
    };
    let eol = detect_eol(&text);

    Ok(VaultFileContent {
        path: to_relative_string(&validate_relative_path(relative)?),
        content: normalize_newlines(&text),
        eol: eol.to_string(),
        has_bom,
        modified_ms: modified_ms(&meta),
        size: meta.len(),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn write_file(
    root: &Path,
    relative: &str,
    content: &str,
    eol: &str,
    has_bom: bool,
    expected_modified_ms: Option<u64>,
    allow_empty: bool,
) -> Result<VaultWriteResult, String> {
    let absolute = resolve_in_vault(root, relative)?;
    ensure_allowed_file(&absolute)?;

    let existing = fs::metadata(&absolute).ok();
    if let Some(meta) = existing.as_ref() {
        if meta.is_dir() {
            return Err(vault_err(CODE_NOT_FOUND, "该路径是目录，无法写入。"));
        }
    }

    // 乐观锁：外部程序（Obsidian、git checkout、同步盘）改过这个文件时，
    // 自动保存必须停下来问用户，静默覆盖等于替他做了一次不可撤销的决定。
    if let Some(expected) = expected_modified_ms {
        match existing.as_ref() {
            Some(meta) if modified_ms(meta) != expected => {
                return Err(vault_err(
                    CODE_CONFLICT,
                    "文件已被其他程序修改，请选择保留哪一份。",
                ));
            }
            None => {
                return Err(vault_err(
                    CODE_CONFLICT,
                    "文件已被移动或删除，无法直接保存。",
                ));
            }
            _ => {}
        }
    }

    // 编辑器状态异常（载入失败、组件重挂）时内容可能变成空串，
    // 这时候把一份有内容的文档写成 0 字节是最不可逆的一类事故。
    if !allow_empty && content.is_empty() {
        if let Some(meta) = existing.as_ref() {
            if meta.len() > 0 {
                return Err(vault_err(
                    CODE_CONFLICT,
                    "当前内容为空但磁盘文件非空，已阻止覆盖。",
                ));
            }
        }
    }

    let restored = restore_newlines(content, normalize_eol(eol));
    let mut bytes = Vec::with_capacity(restored.len() + 3);
    if has_bom {
        bytes.extend_from_slice("\u{FEFF}".as_bytes());
    }
    bytes.extend_from_slice(restored.as_bytes());

    if bytes.len() as u64 > MAX_VAULT_FILE_BYTES {
        return Err(vault_err(CODE_TOO_LARGE, "内容超过 20 MB，无法保存。"));
    }

    write_atomic_durable(&absolute, &bytes)
        .map_err(|error| io_error_message("保存文件", &error))?;

    let meta = fs::metadata(&absolute).map_err(|error| io_error_message("保存文件", &error))?;

    Ok(VaultWriteResult {
        path: to_relative_string(&validate_relative_path(relative)?),
        modified_ms: modified_ms(&meta),
        size: meta.len(),
    })
}

pub fn create_entry(
    root: &Path,
    parent_dir: Option<&str>,
    name: &str,
    is_dir: bool,
) -> Result<VaultEntry, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能为空。"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能包含路径分隔符。"));
    }

    // 用户在新建框里通常只写标题，不写扩展名；默认补 .md 比报一次「扩展名不合法」友好。
    let name = if is_dir || extension_of(Path::new(name)).is_some() {
        name.to_string()
    } else {
        format!("{name}.md")
    };

    let relative = match parent_dir.map(str::trim).filter(|value| !value.is_empty()) {
        Some(parent) => format!("{}/{}", parent.replace('\\', "/").trim_end_matches('/'), name),
        None => name.clone(),
    };

    let absolute = resolve_in_vault(root, &relative)?;
    if !is_dir {
        ensure_allowed_file(&absolute)?;
    }
    if absolute.exists() {
        return Err(vault_err(CODE_EXISTS, "同名文件或目录已存在。"));
    }

    if is_dir {
        fs::create_dir_all(&absolute).map_err(|error| io_error_message("新建目录", &error))?;
    } else {
        let parent = absolute
            .parent()
            .ok_or_else(|| vault_err(CODE_NOT_FOUND, "上级目录不存在。"))?;
        if !parent.is_dir() {
            return Err(vault_err(CODE_NOT_FOUND, "上级目录不存在。"));
        }
        write_atomic_durable(&absolute, b"")
            .map_err(|error| io_error_message("新建文件", &error))?;
    }

    entry_at(root, &relative)
}

pub fn rename_entry(root: &Path, relative: &str, new_name: &str) -> Result<VaultEntry, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能为空。"));
    }
    if new_name.contains('/') || new_name.contains('\\') {
        return Err(vault_err(CODE_INVALID_NAME, "名称不能包含路径分隔符。"));
    }

    let source_relative = validate_relative_path(relative)?;
    let source = resolve_in_vault(root, relative)?;
    let meta = fs::metadata(&source).map_err(|error| io_error_message("重命名", &error))?;

    // 重命名时省略扩展名是常见操作，沿用原扩展名而不是让文件掉出白名单变成不可读。
    let new_name = if meta.is_dir() || extension_of(Path::new(new_name)).is_some() {
        new_name.to_string()
    } else {
        match extension_of(&source) {
            Some(extension) => format!("{new_name}.{extension}"),
            None => new_name.to_string(),
        }
    };

    let parent_relative = source_relative
        .parent()
        .map(to_relative_string)
        .unwrap_or_default();
    let target_relative = if parent_relative.is_empty() {
        new_name.clone()
    } else {
        format!("{parent_relative}/{new_name}")
    };

    let target = resolve_in_vault(root, &target_relative)?;
    if !meta.is_dir() {
        ensure_allowed_file(&target)?;
    }

    // 只改大小写时 target.exists() 必然为真（Windows 不区分大小写），
    // 这时它指的就是源文件本身，不能当成冲突。
    if target != source && target.exists() {
        return Err(vault_err(CODE_EXISTS, "同名文件或目录已存在。"));
    }

    fs::rename(&source, &target).map_err(|error| io_error_message("重命名", &error))?;

    entry_at(root, &target_relative)
}

pub fn delete_entry(root: &Path, relative: &str, recursive: bool) -> Result<(), String> {
    let absolute = resolve_in_vault(root, relative)?;
    let meta = fs::metadata(&absolute).map_err(|error| io_error_message("删除", &error))?;

    if meta.is_dir() {
        if !recursive && dir_has_visible_children(&absolute) {
            return Err(vault_err(
                CODE_EXISTS,
                "该目录不为空，请确认后再删除。",
            ));
        }
        if recursive {
            fs::remove_dir_all(&absolute).map_err(|error| io_error_message("删除目录", &error))?;
        } else {
            fs::remove_dir(&absolute).map_err(|error| io_error_message("删除目录", &error))?;
        }
        return Ok(());
    }

    ensure_allowed_file(&absolute)?;
    fs::remove_file(&absolute).map_err(|error| io_error_message("删除文件", &error))
}

/// 增删改之后回一条最新的条目，前端可以就地更新树而不必整棵重拉。
fn entry_at(root: &Path, relative: &str) -> Result<VaultEntry, String> {
    let normalized = validate_relative_path(relative)?;
    let absolute = resolve_in_vault(root, relative)?;
    let meta = fs::metadata(&absolute).map_err(|error| io_error_message("读取条目", &error))?;
    let path = to_relative_string(&normalized);
    let name = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();

    Ok(VaultEntry {
        path,
        name,
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified_ms: modified_ms(&meta),
        has_children: meta.is_dir() && dir_has_visible_children(&absolute),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SCRATCH_SEQ: AtomicU64 = AtomicU64::new(0);

    struct Scratch {
        root: PathBuf,
        canonical: PathBuf,
    }

    impl Scratch {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "mk-vault-{}-{}-{}",
                tag,
                std::process::id(),
                SCRATCH_SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).expect("scratch dir should be created");
            let canonical = fs::canonicalize(&root).expect("scratch dir should canonicalize");
            Self { root, canonical }
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.join(relative);
            fs::create_dir_all(&path).expect("dir should be created");
            path
        }

        fn file(&self, relative: &str, contents: &[u8]) -> PathBuf {
            let path = self.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("parent dir should be created");
            }
            fs::write(&path, contents).expect("file should be written");
            path
        }

        fn join(&self, relative: &str) -> PathBuf {
            let mut path = self.root.clone();
            for segment in relative.split('/') {
                path.push(segment);
            }
            path
        }

        /// 测试一律拿规范形式当 vault 根：命令层也是这么做的，
        /// 用未规范化的临时目录路径会让 `starts_with` 比对假性失败。
        fn vault(&self) -> &Path {
            &self.canonical
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn error_code(message: &str) -> &str {
        message.split('|').next().unwrap_or_default()
    }

    fn paths(listing: &VaultListing) -> Vec<String> {
        listing
            .entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect()
    }

    #[test]
    fn accepts_plain_relative_paths_inside_the_vault() {
        let scratch = Scratch::new("accept");
        scratch.file("notes/a.md", b"hi");

        let resolved =
            resolve_in_vault(scratch.vault(), "notes/a.md").expect("plain path should resolve");
        assert!(resolved.starts_with(scratch.vault()));
        assert!(resolved.ends_with("a.md"));

        // 反斜杠写法和 `./` 前缀都应该被折叠成同一个结果。
        assert_eq!(
            resolve_in_vault(scratch.vault(), r"notes\a.md").unwrap(),
            resolved
        );
        assert_eq!(
            resolve_in_vault(scratch.vault(), "./notes/a.md").unwrap(),
            resolved
        );
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let scratch = Scratch::new("traversal");
        scratch.dir("sub");

        for candidate in [
            r"..\..\Windows\System32\drivers\etc\hosts",
            "sub/../../out.md",
            "../out.md",
            "..",
        ] {
            let error = resolve_in_vault(scratch.vault(), candidate)
                .expect_err(&format!("{candidate} should be rejected"));
            assert_eq!(error_code(&error), CODE_OUT_OF_VAULT, "{candidate}");
        }
    }

    #[test]
    fn rejects_dot_segments_that_only_look_like_names() {
        // `....//x.md` 骗得过「过滤 ..」的字符串写法：它的第一段是合法的 Normal 组件，
        // 只有末尾点的规则能把它拦下来。
        let scratch = Scratch::new("dots");

        let error = resolve_in_vault(scratch.vault(), "....//x.md")
            .expect_err("dot-only segment should be rejected");
        assert_eq!(error_code(&error), CODE_INVALID_NAME);

        assert!(resolve_in_vault(scratch.vault(), ".../x.md").is_err());
    }

    #[test]
    fn rejects_absolute_and_unc_paths() {
        let scratch = Scratch::new("absolute");

        for candidate in [
            r"C:\abs.md",
            "C:/abs.md",
            r"\\server\share\x.md",
            "//server/share/x.md",
            "/etc/passwd",
        ] {
            let error = resolve_in_vault(scratch.vault(), candidate)
                .expect_err(&format!("{candidate} should be rejected"));
            assert_eq!(error_code(&error), CODE_OUT_OF_VAULT, "{candidate}");
        }
    }

    #[test]
    fn rejects_alternate_data_stream_and_drive_relative_paths() {
        let scratch = Scratch::new("stream");
        scratch.dir("sub");

        assert!(resolve_in_vault(scratch.vault(), "a:stream.md").is_err());
        let error = resolve_in_vault(scratch.vault(), "sub/notes.md:hidden")
            .expect_err("alternate data stream should be rejected");
        assert_eq!(error_code(&error), CODE_INVALID_NAME);
    }

    #[test]
    fn rejects_windows_reserved_device_names() {
        let scratch = Scratch::new("reserved");

        for candidate in ["CON.md", "nul.markdown", "COM1.txt", "lpt9.md", "aux", "CON/a.md"] {
            let error = resolve_in_vault(scratch.vault(), candidate)
                .expect_err(&format!("{candidate} should be rejected"));
            assert_eq!(error_code(&error), CODE_INVALID_NAME, "{candidate}");
        }

        // 只是以保留名开头的普通文件名不该被误伤。
        assert!(resolve_in_vault(scratch.vault(), "console.md").is_ok());
        assert!(resolve_in_vault(scratch.vault(), "nullable.txt").is_ok());
    }

    #[test]
    fn rejects_names_ending_with_space_or_dot() {
        let scratch = Scratch::new("trailing");

        for candidate in ["a .md", "a.md.", "sub /x.md", "sub./x.md", "a.md "] {
            let error = resolve_in_vault(scratch.vault(), candidate)
                .expect_err(&format!("{candidate} should be rejected"));
            assert_eq!(error_code(&error), CODE_INVALID_NAME, "{candidate}");
        }

        assert!(resolve_in_vault(scratch.vault(), "a b.md").is_ok());
    }

    #[test]
    fn rejects_paths_deeper_than_the_limit() {
        let scratch = Scratch::new("depth");

        let ok = (0..MAX_VAULT_DEPTH - 1)
            .map(|index| format!("d{index}"))
            .collect::<Vec<_>>()
            .join("/");
        assert!(resolve_in_vault(scratch.vault(), &format!("{ok}/a.md")).is_ok());

        let deep = (0..MAX_VAULT_DEPTH + 1)
            .map(|index| format!("d{index}"))
            .collect::<Vec<_>>()
            .join("/");
        let error = resolve_in_vault(scratch.vault(), &format!("{deep}/a.md"))
            .expect_err("too deep path should be rejected");
        assert_eq!(error_code(&error), CODE_OUT_OF_VAULT);
    }

    #[test]
    fn rejects_file_extensions_outside_the_whitelist() {
        let scratch = Scratch::new("extension");
        scratch.file("evil.exe", b"MZ");
        scratch.file("report.docx", b"PK");
        scratch.file("keep.md", b"# hi");

        for candidate in ["evil.exe", "report.docx", "noext"] {
            let error = read_file(scratch.vault(), candidate)
                .expect_err(&format!("{candidate} should be rejected"));
            assert_eq!(error_code(&error), CODE_INVALID_NAME, "{candidate}");
        }

        assert!(read_file(scratch.vault(), "keep.md").is_ok());
        let error = write_file(
            scratch.vault(),
            "evil.exe",
            "payload",
            EOL_LF,
            false,
            None,
            true,
        )
        .expect_err("writing outside the whitelist should be rejected");
        assert_eq!(error_code(&error), CODE_INVALID_NAME);
    }

    #[test]
    fn walk_skips_noise_directories_and_unsupported_files() {
        let scratch = Scratch::new("skip");
        scratch.file(".git/config", b"x");
        scratch.file("node_modules/pkg/readme.md", b"x");
        scratch.file("target/debug/log.md", b"x");
        scratch.file(".obsidian/app.json", b"{}");
        scratch.file("docs/guide.md", b"x");
        scratch.file("docs/image.png", b"x");
        scratch.file("root.txt", b"x");

        let listing = list_entries(scratch.vault(), None, true).expect("walk should succeed");
        let found = paths(&listing);

        assert!(found.iter().all(|path| !path.starts_with(".git")));
        assert!(found.iter().all(|path| !path.starts_with("node_modules")));
        assert!(found.iter().all(|path| !path.starts_with("target")));
        assert!(found.iter().all(|path| !path.starts_with(".obsidian")));
        assert!(found.iter().all(|path| !path.ends_with(".png")));
        assert!(found.contains(&"docs/guide.md".to_string()));
        assert!(found.contains(&"root.txt".to_string()));
        assert!(listing.skipped_dirs >= 4);
        assert!(!listing.truncated);
    }

    #[test]
    fn walk_puts_directories_first_and_marks_children() {
        let scratch = Scratch::new("order");
        scratch.file("beta.md", b"x");
        scratch.file("alpha/inner.md", b"x");
        scratch.dir("zeta-empty");

        let listing = list_entries(scratch.vault(), None, true).expect("walk should succeed");
        assert_eq!(
            paths(&listing),
            vec![
                "alpha".to_string(),
                "alpha/inner.md".to_string(),
                "zeta-empty".to_string(),
                "beta.md".to_string(),
            ]
        );

        let alpha = &listing.entries[0];
        assert!(alpha.is_dir && alpha.has_children);
        let empty = &listing.entries[2];
        assert!(empty.is_dir && !empty.has_children);
    }

    #[test]
    fn walk_can_list_a_single_level_for_the_degraded_path() {
        let scratch = Scratch::new("shallow");
        scratch.file("docs/guide.md", b"x");
        scratch.file("docs/deep/inner.md", b"x");
        scratch.file("root.md", b"x");

        let listing = list_entries(scratch.vault(), None, false).expect("walk should succeed");
        assert_eq!(paths(&listing), vec!["docs".to_string(), "root.md".to_string()]);
        assert!(listing.entries[0].has_children);

        let nested =
            list_entries(scratch.vault(), Some("docs"), false).expect("walk should succeed");
        assert_eq!(
            paths(&nested),
            vec!["docs/deep".to_string(), "docs/guide.md".to_string()]
        );
    }

    #[test]
    fn walk_reports_truncation_once_the_limit_is_reached() {
        let scratch = Scratch::new("truncate");
        for index in 0..8 {
            scratch.file(&format!("note-{index}.md"), b"x");
        }

        let listing = walk_vault(scratch.vault(), None, true, 3).expect("walk should succeed");
        assert!(listing.truncated);
        assert_eq!(listing.entries.len(), 3);

        let full = list_entries(scratch.vault(), None, true).expect("walk should succeed");
        assert!(!full.truncated);
        assert_eq!(full.entries.len(), 8);
    }

    #[test]
    fn reads_crlf_files_and_reports_the_detected_eol() {
        let scratch = Scratch::new("crlf-read");
        scratch.file("win.md", b"line1\r\nline2\r\n");
        scratch.file("unix.md", b"line1\nline2\n");

        let win = read_file(scratch.vault(), "win.md").expect("read should succeed");
        assert_eq!(win.eol, EOL_CRLF);
        assert_eq!(win.content, "line1\nline2\n");
        assert!(!win.has_bom);

        let unix = read_file(scratch.vault(), "unix.md").expect("read should succeed");
        assert_eq!(unix.eol, EOL_LF);
        assert_eq!(unix.content, "line1\nline2\n");
    }

    #[test]
    fn writes_back_the_original_eol() {
        let scratch = Scratch::new("crlf-write");
        let path = scratch.file("win.md", b"line1\r\n");

        let loaded = read_file(scratch.vault(), "win.md").expect("read should succeed");
        write_file(
            scratch.vault(),
            "win.md",
            &format!("{}line2\n", loaded.content),
            &loaded.eol,
            loaded.has_bom,
            Some(loaded.modified_ms),
            false,
        )
        .expect("write should succeed");

        assert_eq!(fs::read(&path).unwrap(), b"line1\r\nline2\r\n");
    }

    #[test]
    fn strips_and_restores_the_byte_order_mark() {
        let scratch = Scratch::new("bom");
        let path = scratch.file("bom.md", "\u{FEFF}# 标题\r\n".as_bytes());

        let loaded = read_file(scratch.vault(), "bom.md").expect("read should succeed");
        assert!(loaded.has_bom);
        assert_eq!(loaded.content, "# 标题\n");
        assert_eq!(loaded.eol, EOL_CRLF);

        write_file(
            scratch.vault(),
            "bom.md",
            "# 标题\n正文\n",
            &loaded.eol,
            loaded.has_bom,
            None,
            false,
        )
        .expect("write should succeed");

        assert_eq!(
            fs::read(&path).unwrap(),
            "\u{FEFF}# 标题\r\n正文\r\n".as_bytes()
        );
    }

    #[test]
    fn refuses_to_edit_non_utf8_files() {
        let scratch = Scratch::new("gbk");
        // GBK 编码的「中文」，在 UTF-8 里是非法字节序列。
        scratch.file("gbk.md", &[0xd6, 0xd0, 0xce, 0xc4]);

        let error = read_file(scratch.vault(), "gbk.md").expect_err("non utf-8 should be rejected");
        assert_eq!(error_code(&error), CODE_NOT_UTF8);
    }

    #[test]
    fn rejects_files_over_the_size_limit() {
        let scratch = Scratch::new("large");
        let path = scratch.file("big.md", b"");
        let file = fs::File::options()
            .write(true)
            .open(&path)
            .expect("file should open");
        file.set_len(MAX_VAULT_FILE_BYTES + 1)
            .expect("file should grow");
        drop(file);

        let error = read_file(scratch.vault(), "big.md").expect_err("large file should be rejected");
        assert_eq!(error_code(&error), CODE_TOO_LARGE);
    }

    #[test]
    fn write_detects_a_stale_modified_timestamp() {
        let scratch = Scratch::new("conflict");
        scratch.file("note.md", b"original");

        let loaded = read_file(scratch.vault(), "note.md").expect("read should succeed");
        let error = write_file(
            scratch.vault(),
            "note.md",
            "mine",
            &loaded.eol,
            false,
            Some(loaded.modified_ms.saturating_sub(5_000)),
            false,
        )
        .expect_err("stale timestamp should be rejected");
        assert_eq!(error_code(&error), CODE_CONFLICT);
        assert_eq!(fs::read(scratch.join("note.md")).unwrap(), b"original");

        // 带上正确的时间戳就应该放行。
        write_file(
            scratch.vault(),
            "note.md",
            "mine",
            &loaded.eol,
            false,
            Some(loaded.modified_ms),
            false,
        )
        .expect("matching timestamp should succeed");
    }

    #[test]
    fn write_refuses_to_empty_a_non_empty_file_unless_allowed() {
        let scratch = Scratch::new("empty");
        scratch.file("note.md", b"content");

        let error = write_file(scratch.vault(), "note.md", "", EOL_LF, false, None, false)
            .expect_err("empty content should be rejected");
        assert_eq!(error_code(&error), CODE_CONFLICT);
        assert_eq!(fs::read(scratch.join("note.md")).unwrap(), b"content");

        write_file(scratch.vault(), "note.md", "", EOL_LF, false, None, true)
            .expect("explicit allow_empty should succeed");
        assert!(fs::read(scratch.join("note.md")).unwrap().is_empty());
    }

    #[test]
    fn create_rename_and_delete_round_trip() {
        let scratch = Scratch::new("crud");
        scratch.dir("docs");

        let created = create_entry(scratch.vault(), Some("docs"), "新建笔记", false)
            .expect("create should succeed");
        assert_eq!(created.path, "docs/新建笔记.md");
        assert!(!created.is_dir);

        let duplicated = create_entry(scratch.vault(), Some("docs"), "新建笔记.md", false)
            .expect_err("duplicate should be rejected");
        assert_eq!(error_code(&duplicated), CODE_EXISTS);

        let renamed = rename_entry(scratch.vault(), "docs/新建笔记.md", "改名后")
            .expect("rename should succeed");
        assert_eq!(renamed.path, "docs/改名后.md");
        assert!(scratch.join("docs/改名后.md").is_file());

        let folder =
            create_entry(scratch.vault(), None, "归档", true).expect("dir create should succeed");
        assert!(folder.is_dir);
        assert!(!folder.has_children);

        let non_empty = delete_entry(scratch.vault(), "docs", false)
            .expect_err("non-empty dir should need recursive");
        assert_eq!(error_code(&non_empty), CODE_EXISTS);

        delete_entry(scratch.vault(), "docs/改名后.md", false).expect("delete should succeed");
        delete_entry(scratch.vault(), "docs", false).expect("empty dir delete should succeed");
        assert!(!scratch.join("docs").exists());
    }

    #[test]
    fn create_and_rename_reject_names_that_escape_the_vault() {
        let scratch = Scratch::new("crud-guard");
        scratch.file("note.md", b"x");

        assert!(create_entry(scratch.vault(), None, "../escape.md", false).is_err());
        assert!(create_entry(scratch.vault(), Some(".."), "escape.md", false).is_err());
        assert!(create_entry(scratch.vault(), None, "CON.md", false).is_err());
        assert!(rename_entry(scratch.vault(), "note.md", "../escape.md").is_err());
        assert!(rename_entry(scratch.vault(), "note.md", "CON").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_paths_that_escape_through_a_junction() {
        let scratch = Scratch::new("junction");
        let outside = Scratch::new("junction-outside");
        fs::write(outside.join("secret.md"), b"secret").expect("outside file should be written");

        let link = scratch.join("link");
        let created = std::process::Command::new("cmd")
            .args([
                "/c",
                "mklink",
                "/J",
                &link.to_string_lossy(),
                &outside.root.to_string_lossy(),
            ])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);

        if !created {
            eprintln!("跳过 junction 用例：当前环境无法创建目录链接。");
            return;
        }

        // 语法上完全合法的一条路径，只有真的解析一次才知道它落在 vault 之外。
        let error = resolve_in_vault(scratch.vault(), "link/secret.md")
            .expect_err("junction escape should be rejected");
        assert_eq!(error_code(&error), CODE_OUT_OF_VAULT);
        assert_eq!(
            error_code(&read_file(scratch.vault(), "link/secret.md").unwrap_err()),
            CODE_OUT_OF_VAULT
        );

        // 遍历也不能把链接目标当成 vault 的一部分列出来。
        let listing = list_entries(scratch.vault(), None, true).expect("walk should succeed");
        assert!(paths(&listing).is_empty());
        assert!(listing.skipped_dirs >= 1);
    }

    /// 默认跳过：要落地两万多个文件，在机械盘上要跑好几分钟，不适合放进常规回归。
    /// 需要时用 `cargo test -- --ignored real_vault_hits_the_entry_ceiling` 单独跑。
    #[test]
    #[ignore = "需要创建 25000 个文件，手动执行"]
    fn real_vault_hits_the_entry_ceiling_without_exhausting_memory() {
        let scratch = Scratch::new("ceiling");
        for group in 0..50 {
            let depth = group % 10 + 1;
            let dir = (0..depth)
                .map(|level| format!("lvl{level}"))
                .collect::<Vec<_>>()
                .join("/");
            for index in 0..500 {
                scratch.file(&format!("{dir}/n{group}-{index}.md"), b"x");
            }
        }

        let listing = list_entries(scratch.vault(), None, true).expect("walk should succeed");
        assert!(listing.truncated);
        assert_eq!(listing.entries.len(), MAX_VAULT_ENTRIES);
    }
}


