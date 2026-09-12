use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    start_line: usize,
    source: String,
    attributes: MermaidAttributes,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct MermaidAttributes {
    width_percent: Option<u32>,
    compact: bool,
    caption: Option<String>,
}

/// Render Mermaid fences before Pandoc sees the Markdown. This is deliberately
/// in the Rust core so CLI, batch conversion, floating conversion and the main
/// editor all share the same fallback and diagnostics.
pub fn preprocess_mermaid_for_word(
    markdown: &str,
    mermaid_script: Option<&Path>,
    scale: u32,
    format: &str,
) -> MermaidPreprocessResult {
    let prefer_svg = !format.trim().eq_ignore_ascii_case("png");
    replace_mermaid_fences(markdown, prefer_svg, |source, block_index, attributes| {
        let script = mermaid_script
            .ok_or_else(|| "未找到内置 Mermaid 运行时资源，已保留源码".to_string())?;
        render_mermaid_image(
            script,
            source,
            block_index,
            scale,
            attributes.compact,
            prefer_svg,
        )
    })
}

fn replace_mermaid_fences<F>(
    markdown: &str,
    warn_png_fallback: bool,
    mut render: F,
) -> MermaidPreprocessResult
where
    F: FnMut(&str, usize, MermaidAttributes) -> Result<PathBuf, String>,
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
        let title = mermaid_title(&block.source);
        let (node_count, edge_count) = mermaid_complexity(&block.source);
        let context = format!(
            "第 {} 行，图名“{}”，约 {} 个节点/{} 条边",
            block.start_line, title, node_count, edge_count
        );
        if block_number > MAX_MERMAID_BLOCKS {
            failed += 1;
            warnings.push(format!(
                "Mermaid 第 {block_number} 个代码块（{context}）未渲染：阶段=数量限制；单个文档最多处理 {MAX_MERMAID_BLOCKS} 张图"
            ));
            output.push_str(&markdown[block.start..block.end]);
            cursor = block.end;
            continue;
        }

        match render(&block.source, block_number, block.attributes.clone()) {
            Ok(image_path) => {
                let markdown_path = encode_markdown_image_path(&image_path);
                if let Some(width) = block.attributes.width_percent {
                    output.push_str(&format!(
                        "![]({markdown_path} \"MD_KING_MERMAID_WIDTH_{width}\"){{ width={width}% }}\n\n"
                    ));
                } else {
                    output.push_str(&format!("![]({markdown_path})\n\n"));
                }
                if let Some(caption) = block.attributes.caption.as_deref() {
                    output.push_str("::: {custom-style=\"Image Caption\"}\n");
                    output.push_str(caption);
                    output.push_str("\n:::\n\n");
                }
                if warn_png_fallback
                    && image_path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
                {
                    warnings.push(format!(
                        "Mermaid 第 {block_number} 个代码块（{context}）未能保留为 SVG，已回退为高清 PNG。"
                    ));
                }
                if let Some((width, height)) = rendered_image_dimensions(&image_path) {
                    let aspect_ratio = width / height;
                    if !(0.2..=5.0).contains(&aspect_ratio) {
                        warnings.push(format!(
                            "Mermaid 第 {block_number} 个代码块（{context}）尺寸为 {:.0}×{:.0}，按页面等比例缩放后文字可能过小；建议拆分图或使用 layout=compact。",
                            width, height
                        ));
                    }
                }
                if let Some(parent) = image_path.parent() {
                    cleanup_paths.push(parent.to_path_buf());
                }
                rendered += 1;
            }
            Err(error) => {
                failed += 1;
                warnings.push(format!(
                    "Mermaid 第 {block_number} 个代码块（{context}）渲染失败：{error}"
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
    let mut consumed_caption_lines = HashSet::new();
    let mut index = 0;

    while index < lines.len() {
        let (line_start, line_end, line) = lines[index];
        let Some((marker, fence_len, attributes)) = mermaid_fence_start(line) else {
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
            let mut attributes = attributes;
            let mut block_start = line_start;
            let mut block_end = close_end;
            let mut next_index = closing + 1;
            if let Some((caption, caption_start)) = preceding_markdown_caption(&lines, index)
                .filter(|_| index.checked_sub(1).is_some_and(|line| !consumed_caption_lines.contains(&line)))
            {
                if attributes.caption.is_none()
                    || attributes.caption.as_deref() == Some(caption.as_str())
                {
                    attributes.caption.get_or_insert(caption);
                    block_start = caption_start;
                    consumed_caption_lines.insert(index - 1);
                }
            }
            if let Some((caption, caption_end, caption_line)) =
                following_markdown_caption(&lines, closing)
            {
                if attributes.caption.is_none()
                    || attributes.caption.as_deref() == Some(caption.as_str())
                {
                    attributes.caption.get_or_insert(caption);
                    block_end = caption_end;
                    next_index = caption_line + 1;
                    consumed_caption_lines.insert(caption_line);
                }
            }
            blocks.push(MermaidBlock {
                start: block_start,
                end: block_end,
                start_line: index + 1,
                source: markdown[source_start..close_start].to_string(),
                attributes,
            });
            index = next_index;
        } else {
            index += 1;
        }
    }

    blocks
}

fn preceding_markdown_caption(
    lines: &[(usize, usize, &str)],
    opening_line: usize,
) -> Option<(String, usize)> {
    let (line_start, _, line) = *lines.get(opening_line.checked_sub(1)?)?;
    markdown_caption_text(line).map(|caption| (caption.to_string(), line_start))
}

fn following_markdown_caption(
    lines: &[(usize, usize, &str)],
    closing_line: usize,
) -> Option<(String, usize, usize)> {
    let candidate = closing_line + 1;
    let (_, line_end, line) = *lines.get(candidate)?;
    if let Some(caption) = markdown_caption_text(line) {
        return Some((caption.to_string(), line_end, candidate));
    }
    None
}

fn markdown_caption_text(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if let Some(caption) = trimmed
        .strip_prefix("**")
        .and_then(|value| value.strip_suffix("**"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(caption);
    }

    None
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

fn mermaid_fence_start(line: &str) -> Option<(char, usize, MermaidAttributes)> {
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
    if !language.eq_ignore_ascii_case("mermaid") {
        return None;
    }
    let width_percent = regex::Regex::new(r#"(?i)\bwidth\s*=\s*[\"']?(\d+(?:\.\d+)?)%"#)
        .expect("valid Mermaid width regex")
        .captures(rest)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .map(|value| value.round().clamp(20.0, 100.0) as u32);
    let compact = regex::Regex::new(r#"(?i)\blayout\s*=\s*[\"']?compact(?:[\"'\s}]|$)"#)
        .expect("valid Mermaid layout regex")
        .is_match(rest);
    let caption = regex::Regex::new(
        r#"(?i)\bcaption\s*=\s*(?:\"((?:\\.|[^\"])*)\"|'((?:\\.|[^'])*)'|([^\s}]+))"#,
    )
    .expect("valid Mermaid caption regex")
    .captures(rest)
    .and_then(|captures| {
        captures
            .get(1)
            .or_else(|| captures.get(2))
            .or_else(|| captures.get(3))
    })
    .map(|value| {
        regex::Regex::new(r#"\\([\\\"'])"#)
            .expect("valid Mermaid caption escape regex")
            .replace_all(value.as_str(), "$1")
            .trim()
            .to_string()
    })
    .filter(|value| !value.is_empty());
    Some((
        marker,
        fence_len,
        MermaidAttributes {
            width_percent,
            compact,
            caption,
        },
    ))
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

fn render_mermaid_image(
    mermaid_script: &Path,
    source: &str,
    block_index: usize,
    scale: u32,
    compact: bool,
    prefer_svg: bool,
) -> Result<PathBuf, String> {
    render_mermaid_with_retry(|| {
        render_mermaid_image_once(
            mermaid_script,
            source,
            block_index,
            scale,
            compact,
            prefer_svg,
        )
    })
}

fn render_mermaid_with_retry<F>(mut render: F) -> Result<PathBuf, String>
where
    F: FnMut() -> Result<PathBuf, String>,
{
    let started = Instant::now();
    let mut retries = 0;
    loop {
        match render() {
            Ok(path) => return Ok(path),
            Err(error) if retries == 0 && retryable_mermaid_error(&error) => {
                retries += 1;
            }
            Err(error) => {
                return Err(format!(
                    "{error}；耗时={}ms；重试={retries}次",
                    started.elapsed().as_millis()
                ))
            }
        }
    }
}

fn render_mermaid_image_once(
    mermaid_script: &Path,
    source: &str,
    block_index: usize,
    scale: u32,
    compact: bool,
    prefer_svg: bool,
) -> Result<PathBuf, String> {
    if !mermaid_script.is_file() {
        return Err(format!(
            "阶段=环境检查；内置 Mermaid 运行时不存在：{}",
            mermaid_script.to_string_lossy()
        ));
    }
    let browser = find_headless_browser().ok_or_else(|| {
        "阶段=环境检查；未找到 Microsoft Edge 或 Google Chrome，无法生成 Mermaid 图片"
            .to_string()
    })?;
    let work_dir = unique_temp_dir(&format!("mermaid-{block_index}"));
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("阶段=页面准备；创建 Mermaid 临时目录失败：{error}"))?;
    let result = (|| {
        let html_path = work_dir.join("render.html");
        let svg_path = work_dir.join("diagram.svg");
        let image_path = work_dir.join("diagram.png");
        let inspect_profile = work_dir.join("profile-inspect");
        let capture_profile = work_dir.join("profile-capture");
        let html = renderer_html(mermaid_script, source, compact, prefer_svg);
        fs::write(&html_path, html)
            .map_err(|error| format!("阶段=页面准备；写入 Mermaid 渲染页面失败：{error}"))?;

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
        )
        .map_err(|error| format!("阶段=语法与布局检查；{error}"))?;
        let dom = String::from_utf8_lossy(&inspect.stdout);
        if dom.contains("data-state=\"error\"") {
            let detail = extract_html_attribute(&dom, "data-error")
                .unwrap_or_else(|| "Mermaid 语法或渲染错误".to_string());
            let stage = extract_html_attribute(&dom, "data-stage")
                .map(|value| mermaid_stage_label(&value))
                .unwrap_or("语法与布局检查");
            return Err(format!("阶段={stage}；{}", html_unescape(&detail)));
        }
        let width = extract_html_attribute(&dom, "data-width")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0)
            .ok_or_else(|| {
                format!(
                    "阶段=布局计算；{}",
                    browser_failure("Mermaid 渲染未返回有效宽度", &inspect)
                )
            })?;
        let height = extract_html_attribute(&dom, "data-height")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0)
            .ok_or_else(|| {
                format!(
                    "阶段=布局计算；{}",
                    browser_failure("Mermaid 渲染未返回有效高度", &inspect)
                )
            })?;
        let mut svg_output = None;
        if prefer_svg {
            if let Some(svg_base64) = extract_html_attribute(&dom, "data-svg-base64") {
                if let Ok(svg_bytes) = BASE64_STANDARD.decode(svg_base64) {
                    if let Ok(svg) = String::from_utf8(svg_bytes) {
                        if validate_svg(&svg)
                            && svg_has_office_compatible_edges(&svg)
                            && svg_has_office_compatible_text_rows(&svg)
                        {
                            fs::write(&svg_path, svg.as_bytes())
                                .map_err(|error| {
                                    format!("阶段=SVG写入；写入 Mermaid SVG 失败：{error}")
                                })?;
                            svg_output = Some(svg_path.clone());
                        }
                    }
                }
            }
        }

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
        )
        .map_err(|error| format!("阶段=PNG回退生成；{error}"))?;
        if !capture.status.success() || !image_path.is_file() {
            return Err(format!(
                "阶段=PNG回退生成；{}",
                browser_failure("Mermaid 截图生成失败", &capture)
            ));
        }
        Ok(svg_output.unwrap_or(image_path))
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&work_dir);
    }
    result
}

fn retryable_mermaid_error(error: &str) -> bool {
    !error.contains("阶段=语法校验")
        && !error.contains("阶段=环境检查")
        && !error.contains("阶段=页面准备")
        && !error.contains("阶段=SVG写入")
}

fn mermaid_stage_label(stage: &str) -> &'static str {
    match stage.trim() {
        "syntax" => "语法校验",
        "layout" => "布局计算",
        "style-inline" => "样式固化",
        "serialize" => "SVG序列化",
        _ => "语法与布局检查",
    }
}

fn renderer_html(
    mermaid_script: &Path,
    source: &str,
    compact: bool,
    prefer_svg: bool,
) -> String {
    let source_json = serde_json::to_string(source)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    let script_url = file_url(mermaid_script);
    let node_spacing = if compact { 20 } else { 40 };
    let rank_spacing = if compact { 25 } else { 40 };
    // PNG 由浏览器直接截图，保留 Mermaid 原生 HTML 标签可获得最完整的
    // Markdown 标签、自动换行和水平/垂直居中效果。仅在显式导出 SVG 时关闭
    // HTML 标签，避免 Word/WPS 无法显示 foreignObject。
    let html_labels = if prefer_svg { "false" } else { "true" };
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
    mermaid.initialize({{startOnLoad:false,theme:'default',securityLevel:'strict',htmlLabels:{html_labels},fontFamily:'Microsoft YaHei, Segoe UI Emoji, sans-serif',fontSize:14,markdownAutoWrap:true,themeVariables:{{fontSize:'14px'}},themeCSS:'.nodeLabel{{display:inline-block;max-width:160px;white-space:normal!important;overflow-wrap:anywhere;word-break:break-word;line-height:1.25;text-align:center}}.nodeLabel p{{margin:0}}.edgeLabel,.edgeLabel *,.edgeLabel p,.edgeLabel span,.edgeLabel foreignObject,.edgeLabel foreignObject>div{{background:transparent!important;background-color:transparent!important}}.edgeLabel rect{{fill:transparent!important;stroke:none!important}}.edgeLabel text,.edgeLabel tspan{{fill:#fff!important;paint-order:normal;stroke:none!important}}.edgeLabel span,.edgeLabel p{{color:#fff!important;text-shadow:none!important}}',flowchart:{{htmlLabels:{html_labels},useMaxWidth:false,wrappingWidth:160,nodeSpacing:{node_spacing},rankSpacing:{rank_spacing},padding:8}}}});
    document.body.dataset.stage='syntax';
    await mermaid.parse(source);
    document.body.dataset.stage='layout';
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
    // Office 兼容处理会重写多行文本坐标。它只应影响序列化出的 SVG，
    // 不能污染随后用于 PNG 截图的 Mermaid 原生 DOM，否则多行文字会贴到
    // 节点上边缘。先保留原生副本，序列化完成后再放回页面截图。
    const pngSvg=svg.cloneNode(true);
    const officeSvgProperties=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','color','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline'];
    const inlineOfficeRule=rule=>{{
      if(rule.cssRules){{for(const child of rule.cssRules) inlineOfficeRule(child);return;}}
      if(!rule.selectorText||!rule.style) return;
      let elements;
      try{{elements=document.querySelectorAll(rule.selectorText);}}catch(_error){{return;}}
      for(const element of elements){{
        if(element!==svg&&!svg.contains(element)) continue;
        for(const property of officeSvgProperties){{
          const value=rule.style.getPropertyValue(property);
          if(value) element.setAttribute(property,value);
        }}
      }}
    }};
    document.body.dataset.stage='style-inline';
    for(const styleElement of svg.querySelectorAll('style')){{
      const sheet=styleElement.sheet;
      if(!sheet) continue;
      try{{for(const rule of sheet.cssRules) inlineOfficeRule(rule);}}catch(_error){{}}
    }}
    for(const element of svg.querySelectorAll('[style]')){{
      for(const property of officeSvgProperties){{
        const value=element.style.getPropertyValue(property);
        if(value){{element.setAttribute(property,value);element.style.removeProperty(property);}}
      }}
      if(!element.getAttribute('style')) element.removeAttribute('style');
    }}
    const normalizeOfficeTextRows=text=>{{
      const rows=Array.from(text.children).filter(child=>child.tagName.toLowerCase()==='tspan'&&child.classList.contains('row'));
      if(rows.length===0) return;
      const fontSize=parseFloat(getComputedStyle(text).fontSize)||16;
      const lineHeight=fontSize*1.25;
      const baseline=fontSize*0.35;
      text.setAttribute('y','0');
      rows.forEach((row,index)=>{{
        const content=row.textContent||'';
        row.textContent=content;
        row.setAttribute('x','0');
        row.setAttribute('y',String((index-(rows.length-1)/2)*lineHeight+baseline));
        row.removeAttribute('dy');
      }});
    }};
    for(const text of svg.querySelectorAll('text')) normalizeOfficeTextRows(text);
    for(const element of svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text,tspan')){{
      const computed=getComputedStyle(element);
      for(const property of officeSvgProperties){{
        const current=element.getAttribute(property);
        if(current&&current!=='inherit'&&current!=='currentColor'&&!current.includes('var(')) continue;
        const value=computed.getPropertyValue(property).trim();
        if(value&&value!=='normal') element.setAttribute(property,value);
      }}
    }}
    for(const edge of svg.querySelectorAll('path.flowchart-link,.edgePath path')){{
      if(!edge.hasAttribute('stroke')) edge.setAttribute('stroke','#333333');
      if(!edge.hasAttribute('stroke-width')) edge.setAttribute('stroke-width','1px');
      if(!edge.hasAttribute('fill')) edge.setAttribute('fill','none');
    }}
    document.body.dataset.stage='serialize';
    const serialized=new XMLSerializer().serializeToString(svg);
    const bytes=new TextEncoder().encode(serialized); let binary='';
    for(let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    host.replaceChildren(pngSvg);
    document.documentElement.style.width=width+'px'; document.documentElement.style.height=height+'px';
    document.body.style.width=width+'px'; document.body.style.height=height+'px';
    document.body.dataset.width=String(width); document.body.dataset.height=String(height); document.body.dataset.svgBase64=btoa(binary); document.body.dataset.state='ready';
  }}catch(error){{document.body.dataset.state='error';document.body.dataset.error=String(error&&error.message?error.message:error)}}
}})();
</script></body></html>"#
    )
}

fn validate_svg(svg: &str) -> bool {
    if !svg.trim_start().starts_with("<svg") || !svg.contains("</svg>") {
        return false;
    }
    let mut reader = quick_xml::Reader::from_str(svg);
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Eof) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

fn rendered_image_dimensions(path: &Path) -> Option<(f64, f64)> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "svg" => {
            let svg = fs::read_to_string(path).ok()?;
            let view_box = regex::Regex::new(
                r#"(?i)\bviewBox\s*=\s*\"[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\""#,
            )
            .ok()?
            .captures(&svg);
            if let Some(captures) = view_box {
                let width = captures.get(1)?.as_str().parse::<f64>().ok()?;
                let height = captures.get(2)?.as_str().parse::<f64>().ok()?;
                return (width > 0.0 && height > 0.0).then_some((width, height));
            }
            let width = numeric_svg_attribute(&svg, "width")?;
            let height = numeric_svg_attribute(&svg, "height")?;
            (width > 0.0 && height > 0.0).then_some((width, height))
        }
        "png" => {
            let bytes = fs::read(path).ok()?;
            if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
                return None;
            }
            let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?) as f64;
            let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?) as f64;
            (width > 0.0 && height > 0.0).then_some((width, height))
        }
        _ => None,
    }
}

fn numeric_svg_attribute(svg: &str, name: &str) -> Option<f64> {
    let pattern = format!(r#"(?i)\b{}\s*=\s*\"([\d.]+)"#, regex::escape(name));
    regex::Regex::new(&pattern)
        .ok()?
        .captures(svg)?
        .get(1)?
        .as_str()
        .parse::<f64>()
        .ok()
}

fn find_headless_browser() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("MD_KING_BROWSER").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    candidates
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn run_browser(browser: &Path, args: &[String]) -> Result<Output, String> {
    let mut command = Command::new(browser);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 Mermaid 无头浏览器失败：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Mermaid 无头浏览器标准输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Mermaid 无头浏览器错误输出。".to_string())?;
    // Mermaid 的 SVG（尤其包含多组 classDef 时）会使 --dump-dom 输出超过管道缓冲区。
    // 必须在浏览器仍在运行时并发读取，否则浏览器会阻塞在写 stdout，外层误判为布局超时。
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::BufReader::new(stdout).read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::BufReader::new(stderr).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return collect_browser_output(status, stdout_reader, stderr_reader),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
            Ok(None) => {
                #[cfg(windows)]
                {
                    let _ = Command::new("taskkill")
                        .args(["/PID", &child.id().to_string(), "/T", "/F"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("Mermaid 无头浏览器运行超过 30 秒，已终止本次渲染".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("检查 Mermaid 无头浏览器状态失败：{error}"));
            }
        }
    }
}

fn svg_has_office_compatible_edges(svg: &str) -> bool {
    let edge = regex::Regex::new(
        r#"(?i)<path\b[^>]*\bclass="[^"]*\bflowchart-link\b[^"]*"[^>]*>"#,
    )
    .expect("valid Mermaid edge regex");
    let stroke = regex::Regex::new(r#"(?i)\bstroke="([^"]+)""#)
        .expect("valid Mermaid edge stroke regex");

    let compatible = edge.find_iter(svg).all(|edge| {
        stroke
            .captures(edge.as_str())
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().trim().to_ascii_lowercase())
            .is_some_and(|value| {
                value != "none"
                    && value != "transparent"
                    && value != "rgba(0, 0, 0, 0)"
                    && value != "rgba(0,0,0,0)"
            })
    });
    compatible
}

fn svg_has_office_compatible_text_rows(svg: &str) -> bool {
    let nested_row = regex::Regex::new(
        r#"(?is)<tspan\b[^>]*\bclass="[^"]*\brow\b[^"]*"[^>]*>\s*<tspan\b"#,
    )
    .expect("valid nested Mermaid text row regex");
    if nested_row.is_match(svg) {
        return false;
    }

    let row = regex::Regex::new(
        r#"(?i)<tspan\b[^>]*\bclass="[^"]*\brow\b[^"]*"[^>]*>"#,
    )
    .expect("valid Mermaid text row regex");
    let x = regex::Regex::new(r#"(?i)\bx="[^"]+""#).expect("valid Mermaid text x regex");
    let y = regex::Regex::new(r#"(?i)\by="[^"]+""#).expect("valid Mermaid text y regex");
    let dy = regex::Regex::new(r#"(?i)\bdy="[^"]+""#).expect("valid Mermaid text dy regex");

    let compatible = row.find_iter(svg).all(|row| {
        let row = row.as_str();
        x.is_match(row) && y.is_match(row) && !dy.is_match(row)
    });
    compatible
}

fn collect_browser_output(
    status: ExitStatus,
    stdout_reader: thread::JoinHandle<Vec<u8>>,
    stderr_reader: thread::JoinHandle<Vec<u8>>,
) -> Result<Output, String> {
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取 Mermaid 无头浏览器标准输出时发生异常。".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取 Mermaid 无头浏览器错误输出时发生异常。".to_string())?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn mermaid_title(source: &str) -> String {
    let title = regex::Regex::new(r#"(?im)^\s*(?:title|accTitle)\s*:\s*(.+?)\s*$"#)
        .expect("valid Mermaid title regex")
        .captures(source)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名");
    title.chars().take(60).collect()
}

fn mermaid_complexity(source: &str) -> (usize, usize) {
    let node_re = regex::Regex::new(r#"(?m)\b([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[|\(|\{)"#)
        .expect("valid Mermaid node regex");
    let nodes = node_re
        .captures_iter(source)
        .filter_map(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .collect::<HashSet<_>>()
        .len();
    let edge_re = regex::Regex::new(r#"-->|==>|-\.->|---|~~~"#)
        .expect("valid Mermaid edge regex");
    (nodes, edge_re.find_iter(source).count())
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

    const CLASSDEF_BRANCHING_FLOWCHART: &str = r#"flowchart LR
    A[商密服务异常] --> B{功能是否依赖密码服务}
    B -->|否| C[保持基础生产通信]
    B -->|是| D{是否满足受控连续条件}
    D -->|是| E[受保护缓存或本地连续运行]
    D -->|否| F[高风险操作失败关闭]
    C --> G[告警并记录影响]
    E --> G
    F --> G
    G --> H[恢复校验并重新认证]

    classDef crypto fill:#F4CCCC,stroke:#C00000,color:#9C0006,stroke-width:2px;
    classDef decision fill:#FFF2CC,stroke:#BF9000,color:#7F6000,stroke-width:1.5px;
    classDef production fill:#FBE5D6,stroke:#C55A11,color:#843C0C,stroke-width:1.5px;
    classDef action fill:#FCE4D6,stroke:#ED7D31,color:#843C0C,stroke-width:1.5px;
    class A crypto;
    class B,D decision;
    class C production;
    class E,F,G,H action;
"#;
    const LONG_CHINESE_LABEL_LR: &str =
        "flowchart LR\n  A[核心生产业务交换机] --> B[操作员站、工程师站与生产服务器]\n";
    const LONG_CHINESE_LABEL_TB: &str =
        "flowchart TB\n  A[安全管理平台] --> B[跨安全域访问控制、审计记录与异常处置服务器]\n";

    #[test]
    fn replaces_case_insensitive_mermaid_fences_and_keeps_other_code() {
        let markdown = "正文\n\n```Mermaid\nflowchart LR\n A --> B\n```\n\n## 后续标题\n\n```rust\nfn main() {}\n```\n";
        let result = replace_mermaid_fences(markdown, true, |source, index, attributes| {
            assert_eq!(index, 1);
            assert_eq!(source, "flowchart LR\n A --> B\n");
            assert_eq!(attributes, MermaidAttributes::default());
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
        let markdown = "正文\n\n~~~mermaid\ngraph TD\n A --> B\n~~~";
        let result = replace_mermaid_fences(markdown, true, |_source, _index, _attributes| {
            Err("阶段=语法校验；syntax error；耗时=12ms；重试=0次".to_string())
        });
        assert_eq!(result.markdown, markdown);
        assert_eq!(result.rendered, 0);
        assert_eq!(result.failed, 1);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("Mermaid 第 1 个代码块"));
        assert!(result.warnings[0].contains("第 3 行"));
        assert!(result.warnings[0].contains("图名“未命名”"));
        assert!(result.warnings[0].contains("约 0 个节点/1 条边"));
        assert!(result.warnings[0].contains("阶段=语法校验"));
        assert!(result.warnings[0].contains("重试=0次"));
    }

    #[test]
    fn retries_a_retryable_browser_failure_once_with_fresh_state() {
        let mut attempts = 0;
        let result = render_mermaid_with_retry(|| {
            attempts += 1;
            if attempts == 1 {
                Err("阶段=布局计算；浏览器状态异常".to_string())
            } else {
                Ok(PathBuf::from(r"C:\Temp\diagram.svg"))
            }
        })
        .unwrap();

        assert_eq!(attempts, 2);
        assert_eq!(result, PathBuf::from(r"C:\Temp\diagram.svg"));
    }

    #[test]
    fn does_not_retry_a_mermaid_syntax_error() {
        let mut attempts = 0;
        let error = render_mermaid_with_retry(|| {
            attempts += 1;
            Err("阶段=语法校验；Parse error".to_string())
        })
        .unwrap_err();

        assert_eq!(attempts, 1);
        assert!(error.contains("阶段=语法校验"));
        assert!(error.contains("耗时="));
        assert!(error.contains("重试=0次"));
    }

    #[test]
    fn requested_png_is_not_reported_as_svg_fallback() {
        let markdown = "```mermaid\ngraph TD\nA-->B\n```";
        let result = replace_mermaid_fences(markdown, false, |_source, _index, _attributes| {
            Ok(PathBuf::from(r"C:\Temp\diagram.png"))
        });

        assert_eq!(result.rendered, 1);
        assert!(result.warnings.is_empty());
        assert!(result.markdown.contains("diagram.png"));
    }

    #[test]
    fn supports_fence_attributes_and_ignores_unclosed_blocks() {
        let markdown = "```mermaid {width=80% layout=compact caption=\"图9-1 商密服务异常下的受控处置流程\"}\ngraph LR\n A-->B\n```\n\n```mermaid\nunclosed";
        let blocks = find_mermaid_blocks(markdown);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].source, "graph LR\n A-->B\n");
        assert_eq!(blocks[0].attributes.width_percent, Some(80));
        assert!(blocks[0].attributes.compact);
        assert_eq!(
            blocks[0].attributes.caption.as_deref(),
            Some("图9-1 商密服务异常下的受控处置流程")
        );

        let result = replace_mermaid_fences(markdown, true, |_source, _index, _attributes| {
            Ok(PathBuf::from(r"C:\Temp\diagram.svg"))
        });
        assert!(result.markdown.contains(
            r#"![](C:/Temp/diagram.svg "MD_KING_MERMAID_WIDTH_80"){ width=80% }"#
        ));
        assert!(result.markdown.contains(
            "::: {custom-style=\"Image Caption\"}\n图9-1 商密服务异常下的受控处置流程\n:::"
        ));
        assert!(!result.markdown.contains("caption="));
    }

    #[test]
    fn converts_adjacent_bold_captions_before_and_after_without_duplicate_text() {
        let markdown = "**图9-1 前置题注**\n```mermaid\ngraph LR\n A-->B\n```\n\n正文\n\n```mermaid\ngraph TB\n C-->D\n```\n**图9-2 后置题注**\n\n结尾";
        let blocks = find_mermaid_blocks(markdown);
        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[0].attributes.caption.as_deref(),
            Some("图9-1 前置题注")
        );
        assert_eq!(
            blocks[1].attributes.caption.as_deref(),
            Some("图9-2 后置题注")
        );

        let result = replace_mermaid_fences(markdown, false, |_source, _index, _attributes| {
            Ok(PathBuf::from(r"C:\Temp\diagram.png"))
        });
        assert_eq!(result.markdown.matches("图9-1 前置题注").count(), 1);
        assert_eq!(result.markdown.matches("图9-2 后置题注").count(), 1);
        assert!(result.markdown.ends_with("\n\n结尾"));
    }

    #[test]
    fn does_not_attach_bold_text_across_a_blank_line() {
        let markdown = "```mermaid\ngraph LR\n A-->B\n```\n\n**普通加粗正文**";
        let blocks = find_mermaid_blocks(markdown);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].attributes.caption, None);
    }

    #[test]
    fn renderer_page_escapes_script_terminators_from_user_source() {
        let html = renderer_html(
            Path::new(r"C:\runtime\mermaid.min.js"),
            "A[</script>]",
            true,
            true,
        );
        assert!(!html.contains("A[</script>]"));
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(html.contains("securityLevel:'strict'"));
        assert!(html.contains("htmlLabels:false"));
        assert!(html.contains("fontSize:14"));
        assert!(html.contains("markdownAutoWrap:true"));
        assert!(html.contains("wrappingWidth:160"));
        assert!(html.contains("white-space:normal!important"));
        assert!(html.contains("overflow-wrap:anywhere"));
        assert!(html.contains("word-break:break-word"));
        assert!(html.contains(".edgeLabel,.edgeLabel *"));
        assert!(html.contains("background:transparent!important"));
        assert!(html.contains("fill:transparent!important"));
        assert!(html.contains("padding:8"));
        assert!(html.contains("nodeSpacing:20"));
        assert!(html.contains("rankSpacing:25"));
        assert!(html.contains("dataset.stage='syntax'"));
        assert!(html.contains("await mermaid.parse(source)"));
        assert!(html.contains("dataset.stage='layout'"));
        assert!(html.contains("dataset.stage='style-inline'"));
        assert!(html.contains("dataset.stage='serialize'"));
        assert!(html.contains("inlineOfficeRule=rule=>"));
        assert!(html.contains("document.querySelectorAll(rule.selectorText)"));
        assert!(html.contains("svg.querySelectorAll('style')"));
        assert!(html.contains("getComputedStyle(element)"));
        assert!(html.contains("normalizeOfficeTextRows=text=>"));
        assert!(html.contains("row.removeAttribute('dy')"));
        assert!(html.contains("path.flowchart-link,.edgePath path"));
        assert!(!html.contains("for(const sheet of document.styleSheets)"));
        assert!(html.contains("element.setAttribute(property,value)"));
        assert!(html.contains("element.style.removeProperty(property)"));
        assert!(html.contains("dataset.svgBase64"));
    }

    #[test]
    fn keeps_classdef_branching_flowchart_as_a_renderer_regression_sample() {
        let (nodes, edges) = mermaid_complexity(CLASSDEF_BRANCHING_FLOWCHART);
        assert_eq!((nodes, edges), (8, 9));
        assert_eq!(mermaid_title(CLASSDEF_BRANCHING_FLOWCHART), "未命名");

        let html = renderer_html(
            Path::new(r"C:\runtime\mermaid.min.js"),
            CLASSDEF_BRANCHING_FLOWCHART,
            false,
            false,
        );
        assert!(html.contains("classDef crypto"));
        assert!(html.contains("classDef action"));
        assert!(html.contains("flowchart LR"));
        assert!(html.contains("htmlLabels:true"));
        assert!(html.contains("const pngSvg=svg.cloneNode(true)"));
        assert!(html.contains("host.replaceChildren(pngSvg)"));
        assert!(html.contains("svg.querySelectorAll('style')"));
    }

    #[test]
    fn rejects_svg_edges_that_rely_only_on_embedded_css() {
        let css_only = r#"<svg xmlns="http://www.w3.org/2000/svg"><style>.flowchart-link{stroke:#333;fill:none}</style><path class="flowchart-link" d="M0 0 L10 10" /></svg>"#;
        let inlined = r#"<svg xmlns="http://www.w3.org/2000/svg"><path class="flowchart-link" d="M0 0 L10 10" stroke="rgb(51, 51, 51)" stroke-width="1px" fill="none" /></svg>"#;

        assert!(!svg_has_office_compatible_edges(css_only));
        assert!(svg_has_office_compatible_edges(inlined));
    }

    #[test]
    fn keeps_long_chinese_labels_wrapped_for_lr_and_tb_layouts() {
        for (source, label) in [
            (LONG_CHINESE_LABEL_LR, "操作员站、工程师站与生产服务器"),
            (LONG_CHINESE_LABEL_TB, "跨安全域访问控制、审计记录与异常处置服务器"),
        ] {
            let html = renderer_html(
                Path::new(r"C:\runtime\mermaid.min.js"),
                source,
                false,
                false,
            );
            assert!(html.contains("fontSize:14"));
            assert!(html.contains("markdownAutoWrap:true"));
            assert!(html.contains("wrappingWidth:160"));
            assert!(html.contains("white-space:normal!important"));
            assert!(html.contains("overflow-wrap:anywhere"));
            assert!(html.contains("word-break:break-word"));
            assert!(html.contains("padding:8"));
            assert!(html.contains("htmlLabels:true"));
            assert!(html.contains("normalizeOfficeTextRows=text=>"));
            assert!(html.contains("host.replaceChildren(pngSvg)"));
            assert!(html.contains(label));
        }
    }

    #[test]
    fn rejects_nested_or_relative_mermaid_text_rows_for_office() {
        let nested = r#"<svg><text><tspan class="text-outer-tspan row" x="0" y="-0.1em" dy="1.1em"><tspan class="text-inner-tspan">操作员站、工程师站与生产服务器</tspan></tspan></text></svg>"#;
        let flattened = r#"<svg><text y="0"><tspan class="text-outer-tspan row" x="0" y="-4.4">操作员站、工程师站与生产</tspan><tspan class="text-outer-tspan row" x="0" y="15.6">服务器</tspan></text></svg>"#;

        assert!(!svg_has_office_compatible_text_rows(nested));
        assert!(svg_has_office_compatible_text_rows(flattened));
    }

    #[test]
    fn reads_svg_dimensions_from_view_box() {
        let dir = unique_temp_dir("mermaid-dimensions-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("diagram.svg");
        fs::write(
            &path,
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240"></svg>"#,
        )
        .unwrap();

        assert_eq!(rendered_image_dimensions(&path), Some((1200.0, 240.0)));

        let _ = fs::remove_dir_all(dir);
    }
}
