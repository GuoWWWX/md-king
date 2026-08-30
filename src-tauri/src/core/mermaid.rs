use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const MAX_MERMAID_BLOCKS: usize = 100;

pub struct MermaidPreprocessResult {
    pub markdown: String,
    pub warnings: Vec<String>,
    pub cleanup_paths: Vec<PathBuf>,
    pub rendered: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MermaidBlock {
    start: usize,
    end: usize,
    source: String,
}

/// Render Mermaid fences before Pandoc sees the Markdown. This is deliberately
/// in the Rust core so CLI, batch conversion, floating conversion and the main
/// editor all share the same fallback and diagnostics.
pub fn preprocess_mermaid_for_word(
    markdown: &str,
    mermaid_script: Option<&Path>,
    scale: u32,
) -> MermaidPreprocessResult {
    replace_mermaid_fences(markdown, |source, block_index| {
        let script = mermaid_script
            .ok_or_else(|| "未找到内置 Mermaid 运行时资源，已保留源码".to_string())?;
        render_mermaid_png(script, source, block_index, scale)
    })
}

fn replace_mermaid_fences<F>(markdown: &str, mut render: F) -> MermaidPreprocessResult
where
    F: FnMut(&str, usize) -> Result<PathBuf, String>,
{
    let blocks = find_mermaid_blocks(markdown);
    if blocks.is_empty() {
        return MermaidPreprocessResult {
            markdown: markdown.to_string(),
            warnings: Vec::new(),
            cleanup_paths: Vec::new(),
            rendered: 0,
            failed: 0,
        };
    }

    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    let mut warnings = Vec::new();
    let mut cleanup_paths = Vec::new();
    let mut rendered = 0;
    let mut failed = 0;

    for (index, block) in blocks.iter().enumerate() {
        output.push_str(&markdown[cursor..block.start]);
        let block_number = index + 1;
        if block_number > MAX_MERMAID_BLOCKS {
            failed += 1;
            warnings.push(format!(
                "Mermaid 第 {block_number} 个代码块未渲染：单个文档最多处理 {MAX_MERMAID_BLOCKS} 张图"
            ));
            output.push_str(&markdown[block.start..block.end]);
            cursor = block.end;
            continue;
        }

        match render(&block.source, block_number) {
            Ok(image_path) => {
                let markdown_path = encode_markdown_image_path(&image_path);
                output.push_str(&format!("![]({markdown_path})\n\n"));
                if let Some(parent) = image_path.parent() {
                    cleanup_paths.push(parent.to_path_buf());
                }
                rendered += 1;
            }
            Err(error) => {
                failed += 1;
                warnings.push(format!(
                    "Mermaid 第 {block_number} 个代码块渲染失败：{error}"
                ));
                output.push_str(&markdown[block.start..block.end]);
            }
        }
        cursor = block.end;
    }

    output.push_str(&markdown[cursor..]);
    cleanup_paths.sort();
    cleanup_paths.dedup();

    MermaidPreprocessResult {
        markdown: output,
        warnings,
        cleanup_paths,
        rendered,
        failed,
    }
}

fn find_mermaid_blocks(markdown: &str) -> Vec<MermaidBlock> {
    let lines = lines_with_offsets(markdown);
    let mut blocks = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let (line_start, line_end, line) = lines[index];
        let Some((marker, fence_len)) = mermaid_fence_start(line) else {
            index += 1;
            continue;
        };

        let source_start = line_end;
        let mut closing = index + 1;
        let mut found_end = None;
        while closing < lines.len() {
            let (close_start, close_end, close_line) = lines[closing];
            if is_fence_close(close_line, marker, fence_len) {
                found_end = Some((close_start, close_end));
                break;
            }
            closing += 1;
        }

        if let Some((close_start, close_end)) = found_end {
            blocks.push(MermaidBlock {
                start: line_start,
                end: close_end,
                source: markdown[source_start..close_start].to_string(),
            });
            index = closing + 1;
        } else {
            index += 1;
        }
    }

    blocks
}

fn lines_with_offsets(markdown: &str) -> Vec<(usize, usize, &str)> {
    let mut result = Vec::new();
    let mut offset = 0;
    for part in markdown.split_inclusive('\n') {
        let end = offset + part.len();
        result.push((offset, end, part.trim_end_matches(['\r', '\n'])));
        offset = end;
    }
    if offset < markdown.len() || markdown.is_empty() {
        result.push((offset, markdown.len(), &markdown[offset..]));
    }
    result
}

fn mermaid_fence_start(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches([' ', '\t']);
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let fence_len = trimmed.chars().take_while(|value| *value == marker).count();
    if fence_len < 3 {
        return None;
    }
    let rest = trimmed[fence_len..].trim();
    let language = rest
        .split_whitespace()
        .next()?
        .trim_matches('{')
        .trim_start_matches('.');
    language
        .eq_ignore_ascii_case("mermaid")
        .then_some((marker, fence_len))
}

fn is_fence_close(line: &str, marker: char, minimum_len: usize) -> bool {
    let trimmed = line.trim();
    let count = trimmed.chars().take_while(|value| *value == marker).count();
    count >= minimum_len && trimmed[count..].trim().is_empty()
}

fn encode_markdown_image_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::with_capacity(normalized.len());
    for value in normalized.chars() {
        if matches!(value, ' ' | '(' | ')' | '[' | ']') {
            encoded.push('\\');
        }
        encoded.push(value);
    }
    encoded
}

fn render_mermaid_png(
    mermaid_script: &Path,
    source: &str,
    block_index: usize,
    scale: u32,
) -> Result<PathBuf, String> {
    if !mermaid_script.is_file() {
        return Err(format!(
            "内置 Mermaid 运行时不存在：{}",
            mermaid_script.to_string_lossy()
        ));
    }
    let browser = find_headless_browser().ok_or_else(|| {
        "未找到 Microsoft Edge 或 Google Chrome，无法生成 Mermaid 图片".to_string()
    })?;
    let work_dir = unique_temp_dir(&format!("mermaid-{block_index}"));
    fs::create_dir_all(&work_dir).map_err(|error| format!("创建 Mermaid 临时目录失败：{error}"))?;
    let result = (|| {
        let html_path = work_dir.join("render.html");
        let image_path = work_dir.join("diagram.png");
        let inspect_profile = work_dir.join("profile-inspect");
        let capture_profile = work_dir.join("profile-capture");
        let html = renderer_html(mermaid_script, source);
        fs::write(&html_path, html)
            .map_err(|error| format!("写入 Mermaid 渲染页面失败：{error}"))?;

        let page_url = file_url(&html_path);
        let inspect = run_browser(
            &browser,
            &[
                "--headless=new".to_string(),
                "--disable-gpu".to_string(),
                "--hide-scrollbars".to_string(),
                "--allow-file-access-from-files".to_string(),
                "--no-first-run".to_string(),
                "--disable-extensions".to_string(),
                format!("--user-data-dir={}", inspect_profile.to_string_lossy()),
                "--virtual-time-budget=10000".to_string(),
                "--dump-dom".to_string(),
                page_url.clone(),
            ],
        )?;
        let dom = String::from_utf8_lossy(&inspect.stdout);
        if dom.contains("data-state=\"error\"") {
            let detail = extract_html_attribute(&dom, "data-error")
                .unwrap_or_else(|| "Mermaid 语法或渲染错误".to_string());
            return Err(html_unescape(&detail));
        }
        let width = extract_html_attribute(&dom, "data-width")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0)
            .ok_or_else(|| browser_failure("Mermaid 渲染未返回有效宽度", &inspect))?;
        let height = extract_html_attribute(&dom, "data-height")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0)
            .ok_or_else(|| browser_failure("Mermaid 渲染未返回有效高度", &inspect))?;
        let viewport_width = width.ceil().clamp(32.0, 16_000.0) as u32;
        let viewport_height = height.ceil().clamp(32.0, 16_000.0) as u32;
        let scale = scale.clamp(1, 4);
        let capture = run_browser(
            &browser,
            &[
                "--headless=new".to_string(),
                "--disable-gpu".to_string(),
                "--hide-scrollbars".to_string(),
                "--allow-file-access-from-files".to_string(),
                "--no-first-run".to_string(),
                "--disable-extensions".to_string(),
                format!("--user-data-dir={}", capture_profile.to_string_lossy()),
                "--virtual-time-budget=10000".to_string(),
                format!("--window-size={viewport_width},{viewport_height}"),
                format!("--force-device-scale-factor={scale}"),
                format!("--screenshot={}", image_path.to_string_lossy()),
                page_url,
            ],
        )?;
        if !capture.status.success() || !image_path.is_file() {
            return Err(browser_failure("Mermaid 截图生成失败", &capture));
        }
        Ok(image_path)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&work_dir);
    }
    result
}

fn renderer_html(mermaid_script: &Path, source: &str) -> String {
    let source_json = serde_json::to_string(source)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    let script_url = file_url(mermaid_script);
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;overflow:hidden;background:#fff;width:max-content;height:max-content}}
#diagram,svg{{display:block;margin:0!important;padding:0!important;max-width:none!important}}
</style></head><body data-state="loading"><div id="diagram"></div>
<script id="source" type="application/json">{source_json}</script>
<script src="{script_url}"></script><script>
(async()=>{{
  try{{
    const source=JSON.parse(document.getElementById('source').textContent);
    mermaid.initialize({{startOnLoad:false,theme:'default',securityLevel:'strict',fontFamily:'Microsoft YaHei, Segoe UI Emoji, sans-serif',flowchart:{{htmlLabels:true,useMaxWidth:false}}}});
    const rendered=await mermaid.render('mdking-mermaid',source);
    const host=document.getElementById('diagram'); host.innerHTML=rendered.svg;
    const svg=host.querySelector('svg');
    if(!svg) throw new Error('Mermaid 未生成 SVG');
    let view=svg.viewBox&&svg.viewBox.baseVal;
    let width=view&&view.width>0?view.width:svg.getBoundingClientRect().width;
    let height=view&&view.height>0?view.height:svg.getBoundingClientRect().height;
    width=Math.max(1,Math.ceil(width)); height=Math.max(1,Math.ceil(height));
    svg.setAttribute('width',String(width)); svg.setAttribute('height',String(height));
    svg.style.width=width+'px'; svg.style.height=height+'px';
    document.documentElement.style.width=width+'px'; document.documentElement.style.height=height+'px';
    document.body.style.width=width+'px'; document.body.style.height=height+'px';
    document.body.dataset.width=String(width); document.body.dataset.height=String(height); document.body.dataset.state='ready';
  }}catch(error){{document.body.dataset.state='error';document.body.dataset.error=String(error&&error.message?error.message:error)}}
}})();
</script></body></html>"#
    )
}

fn find_headless_browser() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("MD_KING_BROWSER").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    candidates
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn run_browser(browser: &Path, args: &[String]) -> Result<Output, String> {
    let mut command = Command::new(browser);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .output()
        .map_err(|error| format!("启动 Mermaid 无头浏览器失败：{error}"))
}

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir()
        .join("md-king")
        .join(format!("{prefix}-{}-{timestamp}", std::process::id()))
}

fn file_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded = normalized
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23");
    format!("file:///{}", encoded.trim_start_matches('/'))
}

fn extract_html_attribute(html: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"\b{}="([^"]*)""#, regex::escape(name));
    regex::Regex::new(&pattern)
        .ok()?
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_string())
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn browser_failure(prefix: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.lines().last().unwrap_or_default().trim();
    if detail.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}：{detail}")
    }
}

pub fn cleanup_mermaid_paths(paths: &[PathBuf]) {
    for path in paths {
        if path
            .parent()
            .is_some_and(|parent| parent.ends_with("md-king"))
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("mermaid-"))
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_case_insensitive_mermaid_fences_and_keeps_other_code() {
        let markdown = "正文\n\n```Mermaid\nflowchart LR\n A --> B\n```\n\n## 后续标题\n\n```rust\nfn main() {}\n```\n";
        let result = replace_mermaid_fences(markdown, |source, index| {
            assert_eq!(index, 1);
            assert_eq!(source, "flowchart LR\n A --> B\n");
            Ok(PathBuf::from(r"C:\Temp\diagram one.png"))
        });
        assert_eq!(result.rendered, 1);
        assert_eq!(result.failed, 0);
        assert!(result.markdown.contains("![](C:/Temp/diagram\\ one.png)"));
        assert!(result
            .markdown
            .contains("diagram\\ one.png)\n\n\n## 后续标题"));
        assert!(result.markdown.contains("```rust"));
        assert!(!result.markdown.to_ascii_lowercase().contains("```mermaid"));
    }

    #[test]
    fn preserves_source_and_reports_block_number_when_rendering_fails() {
        let markdown = "~~~mermaid\ngraph TD\n A --> B\n~~~";
        let result =
            replace_mermaid_fences(markdown, |_source, _index| Err("syntax error".to_string()));
        assert_eq!(result.markdown, markdown);
        assert_eq!(result.rendered, 0);
        assert_eq!(result.failed, 1);
        assert_eq!(
            result.warnings,
            vec!["Mermaid 第 1 个代码块渲染失败：syntax error"]
        );
    }

    #[test]
    fn supports_fence_attributes_and_ignores_unclosed_blocks() {
        let markdown = "```mermaid {width=100%}\ngraph LR\n A-->B\n```\n\n```mermaid\nunclosed";
        let blocks = find_mermaid_blocks(markdown);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].source, "graph LR\n A-->B\n");
    }

    #[test]
    fn renderer_page_escapes_script_terminators_from_user_source() {
        let html = renderer_html(Path::new(r"C:\runtime\mermaid.min.js"), "A[</script>]");
        assert!(!html.contains("A[</script>]"));
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(html.contains("securityLevel:'strict'"));
    }
}
