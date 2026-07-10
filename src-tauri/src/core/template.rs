use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

use crate::core::config::{load_config, save_config};
use crate::core::template_style::save_template_style_config;
use crate::storage::paths::{templates_dir, templates_path};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub reference_docx_path: String,
    pub preview_image_path: Option<String>,
    pub tags: Vec<String>,
    pub is_built_in: bool,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTemplateRequest {
    pub name: String,
    pub description: Option<String>,
    pub reference_docx_path: String,
    pub tags: Vec<String>,
    pub is_default: Option<bool>,
}

pub fn built_in_templates() -> Vec<Template> {
    vec![
        Template {
            id: "default-report".to_string(),
            name: "默认报告模板".to_string(),
            description: Some("适合 AI 生成的通用报告、方案和说明文档。".to_string()),
            reference_docx_path: "".to_string(),
            preview_image_path: None,
            tags: vec!["系统".to_string(), "内置".to_string()],
            is_built_in: true,
            is_default: true,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        },
        Template {
            id: "official-document".to_string(),
            name: "正式公文模板".to_string(),
            description: Some("适合正式材料的标题层级、正文缩进和页边距样式。".to_string()),
            reference_docx_path: "".to_string(),
            preview_image_path: None,
            tags: vec!["系统".to_string(), "内置".to_string()],
            is_built_in: true,
            is_default: false,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        },
        Template {
            id: "technical-spec".to_string(),
            name: "技术文档模板".to_string(),
            description: Some("强化代码块、表格、列表和引用样式，适合技术方案。".to_string()),
            reference_docx_path: "".to_string(),
            preview_image_path: None,
            tags: vec!["系统".to_string(), "内置".to_string()],
            is_built_in: true,
            is_default: false,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        },
    ]
}

pub fn list_templates() -> Vec<Template> {
    let mut templates = built_in_templates();
    templates.extend(load_user_templates());
    normalize_default_template(templates)
}

pub fn find_template(template_id: &str) -> Option<Template> {
    list_templates()
        .into_iter()
        .find(|template| template.id == template_id)
}

pub enum TemplateSelectorError {
    NotFound(String),
    AmbiguousName { name: String, ids: Vec<String> },
}

pub fn resolve_template_selector_for_cli(
    selector: &str,
) -> Result<Template, TemplateSelectorError> {
    let selector = selector.trim();
    let templates = list_templates();

    if let Some(template) = templates.iter().find(|template| template.id == selector) {
        return Ok(template.clone());
    }

    let matches: Vec<Template> = templates
        .into_iter()
        .filter(|template| template.name == selector)
        .collect();

    match matches.len() {
        0 => Err(TemplateSelectorError::NotFound(selector.to_string())),
        1 => Ok(matches[0].clone()),
        _ => Err(TemplateSelectorError::AmbiguousName {
            name: selector.to_string(),
            ids: matches.into_iter().map(|template| template.id).collect(),
        }),
    }
}

pub fn import_template(request: ImportTemplateRequest) -> Result<Template, String> {
    let source_path = PathBuf::from(request.reference_docx_path.trim());
    if !source_path.exists() || !source_path.is_file() {
        return Err("reference.docx 文件不存在。".to_string());
    }
    if !is_docx_file(&source_path) {
        return Err("仅支持导入 .docx 文件作为 reference.docx。".to_string());
    }

    let name = request.name.trim();
    if name.is_empty() {
        return Err("模板名称不能为空。".to_string());
    }

    let now = now_millis();
    let id = format!("user-{}-{}", slugify(name), now);
    let template_dir = templates_dir()
        .map_err(|error| format!("创建模板目录失败：{error}"))?
        .join(&id);
    fs::create_dir_all(&template_dir).map_err(|error| format!("创建模板目录失败：{error}"))?;
    let reference_path = template_dir.join("reference.docx");
    fs::copy(&source_path, &reference_path)
        .map_err(|error| format!("复制 reference.docx 失败：{error}"))?;

    let created_at = now.to_string();
    let template = Template {
        id,
        name: name.to_string(),
        description: request
            .description
            .and_then(|value| normalize_optional(&value)),
        reference_docx_path: reference_path.to_string_lossy().to_string(),
        preview_image_path: None,
        tags: normalize_tags(request.tags),
        is_built_in: false,
        is_default: request.is_default.unwrap_or(false),
        created_at: created_at.clone(),
        updated_at: created_at,
    };

    let mut user_templates = load_user_templates();
    if template.is_default {
        for item in &mut user_templates {
            item.is_default = false;
        }
    }
    user_templates.push(template.clone());
    save_user_templates(user_templates)?;
    if template.is_default {
        let mut config = load_config();
        config.default_template_id = template.id.clone();
        save_config(config)?;
    }

    if let Some(style_config) =
        extract_template_style_config_from_docx(&reference_path, &template.id)
    {
        let _ = save_template_style_config(style_config);
    }

    Ok(template)
}

pub fn save_user_templates(templates: Vec<Template>) -> Result<Vec<Template>, String> {
    let path = templates_path().map_err(|error| format!("获取模板路径失败：{error}"))?;
    let user_templates: Vec<Template> = templates
        .into_iter()
        .filter(|template| !template.is_built_in)
        .collect();
    let content = serde_json::to_string_pretty(&user_templates)
        .map_err(|error| format!("序列化模板失败：{error}"))?;
    fs::write(path, content).map_err(|error| format!("写入模板失败：{error}"))?;
    Ok(user_templates)
}

fn load_user_templates() -> Vec<Template> {
    let Ok(path) = templates_path() else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };

    serde_json::from_str(&content).unwrap_or_default()
}

fn normalize_default_template(mut templates: Vec<Template>) -> Vec<Template> {
    let default_template_id = load_config().default_template_id;
    if templates
        .iter()
        .any(|template| template.id == default_template_id)
    {
        for template in &mut templates {
            template.is_default = template.id == default_template_id;
        }
        return templates;
    }

    let mut has_default = false;
    for template in &mut templates {
        if template.is_default && !has_default {
            has_default = true;
        } else {
            template.is_default = false;
        }
    }

    if !has_default {
        if let Some(first) = templates.first_mut() {
            first.is_default = true;
        }
    }

    templates
}

fn is_docx_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("docx"))
}

fn extract_template_style_config_from_docx(path: &Path, template_id: &str) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let mut archive = ZipArchive::new(Cursor::new(bytes)).ok()?;
    let styles_xml = read_zip_text(&mut archive, "word/styles.xml").unwrap_or_default();
    let document_xml = read_zip_text(&mut archive, "word/document.xml").unwrap_or_default();

    let mut styles = Map::new();
    if let Some(style) = extract_word_style(&styles_xml, &["normal"]) {
        styles.insert("normal".to_string(), style.clone());
        styles.insert("body-text".to_string(), with_style_id(style, "body-text"));
    }

    for level in 1..=6 {
        if let Some(style) = extract_word_style(&styles_xml, &[&format!("heading{level}")]) {
            styles.insert(
                format!("heading-{level}"),
                with_style_id(style, &format!("heading-{level}")),
            );
        }
    }

    let mut config = Map::new();
    config.insert("templateId".to_string(), json!(template_id));
    if !styles.is_empty() {
        config.insert("styles".to_string(), Value::Object(styles));
    }
    if let Some(page_settings) = extract_page_settings(&document_xml) {
        config.insert("pageSettings".to_string(), page_settings);
    }
    config.insert("updatedAt".to_string(), json!(now_millis().to_string()));

    Some(Value::Object(config))
}

fn read_zip_text<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut content = String::new();
    file.read_to_string(&mut content).ok()?;
    Some(content)
}

fn with_style_id(value: Value, style_id: &str) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    object.insert("styleId".to_string(), json!(style_id));
    Value::Object(object)
}

fn extract_word_style(styles_xml: &str, targets: &[&str]) -> Option<Value> {
    let normalized_targets: Vec<String> = targets
        .iter()
        .map(|value| normalize_style_name(value))
        .collect();
    for style_block in collect_style_blocks(styles_xml) {
        let open_tag = style_block.split('>').next().unwrap_or_default();
        let style_id = attr(open_tag, "w:styleId").or_else(|| attr(open_tag, "styleId"));
        let name_tag = find_tag(style_block, "w:name");
        let style_name = name_tag
            .as_deref()
            .and_then(|tag| attr(tag, "w:val").or_else(|| attr(tag, "val")));
        let normalized_style_id = style_id.as_deref().map(normalize_style_name);
        let normalized_style_name = style_name.as_deref().map(normalize_style_name);
        let matched = normalized_style_id
            .as_ref()
            .is_some_and(|value| normalized_targets.contains(value))
            || normalized_style_name
                .as_ref()
                .is_some_and(|value| normalized_targets.contains(value));
        if !matched {
            continue;
        }

        let mut style = Map::new();
        if let Some(fonts_tag) = find_tag(style_block, "w:rFonts") {
            if let Some(font) =
                attr(&fonts_tag, "w:eastAsia").or_else(|| attr(&fonts_tag, "eastAsia"))
            {
                style.insert("chineseFont".to_string(), json!(font));
            }
            if let Some(font) = attr(&fonts_tag, "w:ascii")
                .or_else(|| attr(&fonts_tag, "w:hAnsi"))
                .or_else(|| attr(&fonts_tag, "ascii"))
            {
                style.insert("latinFont".to_string(), json!(font));
            }
        }
        if let Some(size_tag) = find_tag(style_block, "w:sz") {
            if let Some(size) = attr(&size_tag, "w:val").and_then(|value| value.parse::<f64>().ok())
            {
                style.insert(
                    "fontSize".to_string(),
                    json!((size / 2.0 * 10.0).round() / 10.0),
                );
            }
        }
        if has_enabled_tag(style_block, "w:b") {
            style.insert("fontWeight".to_string(), json!("700"));
        }
        if let Some(color_tag) = find_tag(style_block, "w:color") {
            if let Some(color) =
                attr(&color_tag, "w:val").filter(|value| !value.eq_ignore_ascii_case("auto"))
            {
                style.insert("color".to_string(), json!(format!("#{color}")));
            }
        }
        if let Some(jc_tag) = find_tag(style_block, "w:jc") {
            if let Some(align) = attr(&jc_tag, "w:val").and_then(|value| map_word_align(&value)) {
                style.insert("align".to_string(), json!(align));
            }
        }
        if let Some(spacing_tag) = find_tag(style_block, "w:spacing") {
            if let Some(before) =
                attr(&spacing_tag, "w:before").and_then(|value| value.parse::<f64>().ok())
            {
                style.insert(
                    "beforeSpacing".to_string(),
                    json!((before / 20.0 * 10.0).round() / 10.0),
                );
            }
            if let Some(after) =
                attr(&spacing_tag, "w:after").and_then(|value| value.parse::<f64>().ok())
            {
                style.insert(
                    "afterSpacing".to_string(),
                    json!((after / 20.0 * 10.0).round() / 10.0),
                );
            }
            if let Some(line) =
                attr(&spacing_tag, "w:line").and_then(|value| value.parse::<f64>().ok())
            {
                let line_rule =
                    attr(&spacing_tag, "w:lineRule").unwrap_or_else(|| "auto".to_string());
                if line_rule == "auto" {
                    style.insert(
                        "lineHeight".to_string(),
                        json!(format!("{:.2}", line / 240.0)),
                    );
                }
            }
        }
        if let Some(indent_tag) = find_tag(style_block, "w:ind") {
            if let Some(first_line) =
                attr(&indent_tag, "w:firstLine").and_then(|value| value.parse::<f64>().ok())
            {
                style.insert(
                    "firstLineIndent".to_string(),
                    json!((first_line / 240.0 * 10.0).round() / 10.0),
                );
            }
        }

        return Some(Value::Object(style));
    }
    None
}

fn collect_style_blocks(styles_xml: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut rest = styles_xml;
    while let Some(start) = rest.find("<w:style ") {
        rest = &rest[start..];
        let Some(end) = rest.find("</w:style>") else {
            break;
        };
        let end_index = end + "</w:style>".len();
        blocks.push(&rest[..end_index]);
        rest = &rest[end_index..];
    }
    blocks
}

fn find_tag(xml: &str, tag_name: &str) -> Option<String> {
    let needle = format!("<{tag_name}");
    let start = xml.find(&needle)?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    Some(rest[..=end].to_string())
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!("{name}=\"");
    let start = tag.find(&pattern)? + pattern.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(xml_unescape(&rest[..end]))
}

fn has_enabled_tag(xml: &str, tag_name: &str) -> bool {
    let Some(tag) = find_tag(xml, tag_name) else {
        return false;
    };
    !attr(&tag, "w:val").is_some_and(|value| value == "0" || value.eq_ignore_ascii_case("false"))
}

fn normalize_style_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn map_word_align(value: &str) -> Option<&'static str> {
    match value {
        "center" => Some("center"),
        "right" => Some("right"),
        "both" | "distribute" => Some("justify"),
        "left" | "start" => Some("left"),
        _ => None,
    }
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn extract_page_settings(document_xml: &str) -> Option<Value> {
    let sect_start = document_xml.rfind("<w:sectPr")?;
    let sect = &document_xml[sect_start..];
    let mut page = Map::new();

    if let Some(pg_size) = find_tag(sect, "w:pgSz") {
        let width = attr(&pg_size, "w:w").and_then(|value| value.parse::<f64>().ok());
        let height = attr(&pg_size, "w:h").and_then(|value| value.parse::<f64>().ok());
        let orientation = attr(&pg_size, "w:orient").unwrap_or_default();
        if orientation == "landscape" || width.zip(height).is_some_and(|(w, h)| w > h) {
            page.insert("orientation".to_string(), json!("landscape"));
        } else {
            page.insert("orientation".to_string(), json!("portrait"));
        }
        if let Some(size) = width.zip(height).and_then(|(w, h)| infer_paper_size(w, h)) {
            page.insert("paperSize".to_string(), json!(size));
        }
    }

    if let Some(margin) = find_tag(sect, "w:pgMar") {
        insert_cm_margin(&mut page, "marginTop", attr(&margin, "w:top"));
        insert_cm_margin(&mut page, "marginBottom", attr(&margin, "w:bottom"));
        insert_cm_margin(&mut page, "marginLeft", attr(&margin, "w:left"));
        insert_cm_margin(&mut page, "marginRight", attr(&margin, "w:right"));
    }

    if page.is_empty() {
        None
    } else {
        Some(Value::Object(page))
    }
}

fn insert_cm_margin(page: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(cm) = value
        .and_then(|value| value.parse::<f64>().ok())
        .map(|twips| (twips / 1440.0 * 2.54 * 100.0).round() / 100.0)
    {
        page.insert(key.to_string(), json!(cm));
    }
}

fn infer_paper_size(width_twips: f64, height_twips: f64) -> Option<&'static str> {
    let (short, long) = if width_twips <= height_twips {
        (width_twips, height_twips)
    } else {
        (height_twips, width_twips)
    };
    let candidates = [
        ("A3", 16838.0, 23811.0),
        ("A4", 11906.0, 16838.0),
        ("A5", 8391.0, 11906.0),
        ("Letter", 12240.0, 15840.0),
        ("Legal", 12240.0, 20160.0),
    ];
    candidates
        .iter()
        .find(|(_, w, h)| (short - *w).abs() < 120.0 && (long - *h).abs() < 120.0)
        .map(|(name, _, _)| *name)
}

fn normalize_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if !tag.is_empty() && !normalized.iter().any(|item: &String| item == tag) {
            normalized.push(tag.to_string());
        }
    }
    normalized
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "template".to_string()
    } else {
        slug.to_string()
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
