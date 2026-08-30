use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

use crate::core::config::{load_config, save_config};
use crate::core::template_style::{
    reset_template_style_config, reset_template_style_configs, save_template_style_config,
};
use crate::storage::atomic::write_atomic;
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInspection {
    pub template_id: String,
    pub name: String,
    pub resolved_template_path: Option<String>,
    pub template_sha256: Option<String>,
    pub is_built_in: bool,
}

pub fn built_in_templates() -> Vec<Template> {
    vec![
        Template {
            id: "default-report".to_string(),
            name: "默认报告模板".to_string(),
            description: Some("适合 AI 生成的通用报告、方案和说明文档。".to_string()),
            reference_docx_path: built_in_template_path_string("default-report"),
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
            reference_docx_path: built_in_template_path_string("official-document"),
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
            reference_docx_path: built_in_template_path_string("technical-spec"),
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

pub fn inspect_template_for_cli(
    selector: &str,
) -> Result<TemplateInspection, TemplateSelectorError> {
    let template = resolve_template_selector_for_cli(selector)?;
    let path = (!template.reference_docx_path.trim().is_empty())
        .then(|| PathBuf::from(template.reference_docx_path.trim()))
        .filter(|path| path.is_file());
    let template_sha256 = path.as_deref().and_then(|path| template_sha256(path).ok());
    Ok(TemplateInspection {
        template_id: template.id,
        name: template.name,
        resolved_template_path: path.map(|path| path.to_string_lossy().to_string()),
        template_sha256,
        is_built_in: template.is_built_in,
    })
}

pub fn template_sha256(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|error| format!("读取模板文件失败：{error}"))?;
    let mut digest = Sha256::new();
    digest.update(data);
    Ok(format!("{:x}", digest.finalize()))
}

pub fn resolve_built_in_reference_docx_path(template_id: &str) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = std::env::var_os("MD_KING_TEMPLATES_DIR").map(PathBuf::from) {
        roots.push(root);
    }
    if let Ok(root) = templates_dir() {
        roots.push(root);
    }
    if let Ok(root) = std::env::current_dir() {
        roots.push(root.join("templates"));
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        roots.push(exe_dir.join("templates"));
        roots.push(exe_dir.join("resources").join("templates"));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("templates"),
    );

    resolve_built_in_reference_docx_path_from_roots(template_id, &roots)
}

fn resolve_built_in_reference_docx_path_from_roots(
    template_id: &str,
    roots: &[PathBuf],
) -> Option<PathBuf> {
    for candidate_id in [template_id, "default-report"] {
        for root in roots {
            let path = root.join(candidate_id).join("reference.docx");
            if path.is_file() {
                return Some(path.canonicalize().unwrap_or(path));
            }
        }
    }
    None
}

fn built_in_template_path_string(template_id: &str) -> String {
    resolve_built_in_reference_docx_path(template_id)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

pub fn import_template(request: ImportTemplateRequest) -> Result<Template, String> {
    let source_path = PathBuf::from(request.reference_docx_path.trim());
    if !source_path.exists() || !source_path.is_file() {
        return Err("reference.docx 文件不存在。".to_string());
    }
    if !is_docx_file(&source_path) {
        return Err("仅支持导入 .docx 文件作为 reference.docx。".to_string());
    }
    validate_reference_docx(&source_path)?;

    let name = request.name.trim();
    if name.is_empty() {
        return Err("模板名称不能为空。".to_string());
    }
    let original_user_templates = load_user_templates_checked()?;

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

    let style_config = extract_template_style_config_from_docx(&reference_path, &template.id)
        .ok_or_else(|| "无法从 DOCX 读取 Word 样式或页面设置。".to_string());
    let style_config = match style_config {
        Ok(config) => config,
        Err(error) => {
            let _ = fs::remove_dir_all(&template_dir);
            return Err(error);
        }
    };
    if let Err(error) = save_template_style_config(style_config) {
        let _ = fs::remove_dir_all(&template_dir);
        return Err(format!("保存导入的模板样式失败：{error}"));
    }

    let mut user_templates = original_user_templates.clone();
    if template.is_default {
        for item in &mut user_templates {
            item.is_default = false;
        }
    }
    user_templates.push(template.clone());
    if let Err(error) = save_user_templates(user_templates) {
        let _ = reset_template_style_config(template.id.clone());
        let _ = fs::remove_dir_all(&template_dir);
        return Err(error);
    }
    if template.is_default {
        let mut config = load_config();
        config.default_template_id = template.id.clone();
        if let Err(error) = save_config(config) {
            let _ = save_user_templates(original_user_templates);
            let _ = reset_template_style_config(template.id.clone());
            let _ = fs::remove_dir_all(&template_dir);
            return Err(error);
        }
    }

    Ok(template)
}

pub fn save_user_templates(templates: Vec<Template>) -> Result<Vec<Template>, String> {
    let previous_templates = load_user_templates_checked()?;
    let path = templates_path().map_err(|error| format!("获取模板路径失败：{error}"))?;
    let user_templates: Vec<Template> = templates
        .into_iter()
        .filter(|template| !template.is_built_in)
        .collect();
    let content = serde_json::to_string_pretty(&user_templates)
        .map_err(|error| format!("序列化模板失败：{error}"))?;
    write_atomic(&path, &content).map_err(|error| format!("写入模板失败：{error}"))?;

    let retained_ids: HashSet<&str> = user_templates
        .iter()
        .map(|template| template.id.as_str())
        .collect();
    let removed_templates: Vec<&Template> = previous_templates
        .iter()
        .filter(|template| !retained_ids.contains(template.id.as_str()))
        .collect();
    for removed in &removed_templates {
        remove_user_template_directory(removed);
    }
    let removed_ids: Vec<String> = removed_templates
        .iter()
        .map(|template| template.id.clone())
        .collect();
    // 模板列表已经写盘成功，这里失败只是残留了几条用不到的样式配置，
    // 不能因此把整个保存判为失败、让前端回滚。但也不能完全咽下去：
    // 样式文件损坏时正是靠这条日志才知道后续保存为什么会一直报错。
    if let Err(error) = reset_template_style_configs(&removed_ids) {
        eprintln!("清理已删除模板的样式配置失败：{error}");
    }

    Ok(user_templates)
}

fn remove_user_template_directory(template: &Template) {
    let mut components = Path::new(&template.id).components();
    let safe_id =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if safe_id {
        if let Ok(root) = templates_dir() {
            let template_dir = root.join(&template.id);
            if template_dir.is_dir() {
                let _ = fs::remove_dir_all(template_dir);
            }
        }
    }
}

fn load_user_templates() -> Vec<Template> {
    load_user_templates_checked().unwrap_or_default()
}

fn load_user_templates_checked() -> Result<Vec<Template>, String> {
    let Ok(path) = templates_path() else {
        return Err("获取模板路径失败。".to_string());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取模板列表失败：{error}"))?;

    serde_json::from_str(&content).map_err(|error| {
        format!(
            "模板列表文件已损坏，为避免覆盖原数据，本次保存已取消：{}（{error}）",
            path.to_string_lossy()
        )
    })
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

fn validate_reference_docx(path: &Path) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| format!("读取参考 DOCX 失败：{error}"))?;
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("参考文件不是有效的 DOCX 包：{error}"))?;
    for required in [
        "[Content_Types].xml",
        "word/document.xml",
        "word/styles.xml",
    ] {
        archive
            .by_name(required)
            .map_err(|_| format!("参考 DOCX 缺少必要内容：{required}"))?;
    }
    Ok(())
}

fn extract_template_style_config_from_docx(path: &Path, template_id: &str) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    let mut archive = ZipArchive::new(Cursor::new(bytes)).ok()?;
    let styles_xml = read_zip_text(&mut archive, "word/styles.xml").unwrap_or_default();
    let document_xml = read_zip_text(&mut archive, "word/document.xml").unwrap_or_default();
    let theme_xml = read_zip_text(&mut archive, "word/theme/theme1.xml").unwrap_or_default();
    let theme_fonts = extract_theme_fonts(&theme_xml);
    let header_text = read_zip_text_by_prefix(&mut archive, "word/header")
        .and_then(|xml| extract_document_text(&xml));
    let footer_text = read_zip_text_by_prefix(&mut archive, "word/footer")
        .and_then(|xml| extract_document_text(&xml));

    let mut styles = Map::new();
    if let Some(style) = extract_word_style(&styles_xml, &["normal"], &theme_fonts) {
        styles.insert("normal".to_string(), style.clone());
        styles.insert("body-text".to_string(), with_style_id(style, "body-text"));
    }

    for level in 1..=6 {
        if let Some(style) =
            extract_word_style(&styles_xml, &[&format!("heading{level}")], &theme_fonts)
        {
            styles.insert(
                format!("heading-{level}"),
                with_style_id(style, &format!("heading-{level}")),
            );
        }
    }

    if let Some(style) = extract_word_style(
        &styles_xml,
        &["listparagraph", "bulletlist", "numberedlist"],
        &theme_fonts,
    ) {
        styles.insert(
            "bullet-list".to_string(),
            with_list_style(style.clone(), "bullet-list"),
        );
        styles.insert(
            "numbered-list".to_string(),
            with_list_style(style.clone(), "numbered-list"),
        );
        styles.insert(
            "nested-list".to_string(),
            with_list_style(style, "nested-list"),
        );
    }

    if let Some(style) = extract_word_style(&styles_xml, &["imagecaption", "caption"], &theme_fonts)
    {
        styles.insert(
            "caption".to_string(),
            with_style_id(style.clone(), "caption"),
        );
        styles.insert(
            "table-caption".to_string(),
            with_style_id(style, "table-caption"),
        );
    }

    if let Some(style) =
        extract_word_style(&styles_xml, &["tablenormal", "tablegrid"], &theme_fonts)
    {
        styles.insert("table".to_string(), with_style_id(style.clone(), "table"));
        styles.insert(
            "table-header".to_string(),
            with_table_header_style(style.clone()),
        );
        styles.insert("table-body".to_string(), with_table_body_style(style));
    }

    let mut config = Map::new();
    config.insert("templateId".to_string(), json!(template_id));
    if !styles.is_empty() {
        config.insert("styles".to_string(), Value::Object(styles));
    }
    if let Some(page_settings) = extract_page_settings(&document_xml, header_text, footer_text) {
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

fn read_zip_text_by_prefix<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    prefix: &str,
) -> Option<String> {
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).ok()?;
        let name = file.name().to_string();
        if !name.starts_with(prefix) || !name.ends_with(".xml") {
            continue;
        }
        let mut content = String::new();
        file.read_to_string(&mut content).ok()?;
        return Some(content);
    }
    None
}

fn with_style_id(value: Value, style_id: &str) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    object.insert("styleId".to_string(), json!(style_id));
    Value::Object(object)
}

fn with_list_style(value: Value, style_id: &str) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    let list_indent = object
        .get("listIndent")
        .and_then(Value::as_f64)
        .unwrap_or(2.0);
    let text_indent = object
        .get("listTextIndent")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    for level in 1..=4 {
        let prefix = format!("listLevel{level}");
        for (source, target) in [
            ("chineseFont", "ChineseFont"),
            ("latinFont", "LatinFont"),
            ("fontSize", "FontSize"),
            ("fontWeight", "FontWeight"),
            ("color", "Color"),
            ("lineHeight", "LineHeight"),
            ("beforeSpacing", "BeforeSpacing"),
            ("afterSpacing", "AfterSpacing"),
            ("align", "Align"),
        ] {
            if let Some(value) = object.get(source).cloned() {
                object.insert(format!("{prefix}{target}"), value);
            }
        }
        object.insert(
            format!("{prefix}Indent"),
            json!(list_indent + (level - 1) as f64 * 2.0),
        );
        object.insert(format!("{prefix}TextIndent"), json!(text_indent));
    }
    object.insert("styleId".to_string(), json!(style_id));
    Value::Object(object)
}

fn with_table_header_style(value: Value) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    if let Some(size) = object.get("fontSize").cloned() {
        object.insert("headerFontSize".to_string(), size);
    }
    if let Some(weight) = object.get("fontWeight").and_then(Value::as_str) {
        object.insert(
            "headerBold".to_string(),
            json!(weight.parse::<u32>().unwrap_or(400) >= 700),
        );
    }
    object.insert("styleId".to_string(), json!("table-header"));
    Value::Object(object)
}

fn with_table_body_style(value: Value) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    if let Some(size) = object.get("fontSize").cloned() {
        object.insert("bodyFontSize".to_string(), size);
    }
    object.insert("styleId".to_string(), json!("table-body"));
    Value::Object(object)
}

fn extract_word_style(
    styles_xml: &str,
    targets: &[&str],
    theme_fonts: &ThemeFonts,
) -> Option<Value> {
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

        let mut visited = HashSet::new();
        return Some(Value::Object(extract_word_style_with_inheritance(
            styles_xml,
            style_block,
            theme_fonts,
            &mut visited,
        )));
    }
    None
}

fn extract_word_style_with_inheritance(
    styles_xml: &str,
    style_block: &str,
    theme_fonts: &ThemeFonts,
    visited: &mut HashSet<String>,
) -> Map<String, Value> {
    let open_tag = style_block.split('>').next().unwrap_or_default();
    let style_id = attr(open_tag, "w:styleId").or_else(|| attr(open_tag, "styleId"));
    let visit_key = style_id
        .as_deref()
        .map(normalize_style_name)
        .unwrap_or_else(|| style_block.len().to_string());
    if !visited.insert(visit_key) {
        return Map::new();
    }

    let mut style = find_tag(style_block, "w:basedOn")
        .and_then(|tag| attr(&tag, "w:val").or_else(|| attr(&tag, "val")))
        .and_then(|base| find_style_block(styles_xml, &normalize_style_name(&base)))
        .map(|base| extract_word_style_with_inheritance(styles_xml, base, theme_fonts, visited))
        .unwrap_or_default();
    style.extend(extract_word_style_direct(style_block, theme_fonts));
    style
}

fn find_style_block<'a>(styles_xml: &'a str, target: &str) -> Option<&'a str> {
    collect_style_blocks(styles_xml)
        .into_iter()
        .find(|style_block| {
            let open_tag = style_block.split('>').next().unwrap_or_default();
            let style_id = attr(open_tag, "w:styleId").or_else(|| attr(open_tag, "styleId"));
            let style_name = find_tag(style_block, "w:name")
                .as_deref()
                .and_then(|tag| attr(tag, "w:val").or_else(|| attr(tag, "val")));
            style_id.as_deref().map(normalize_style_name).as_deref() == Some(target)
                || style_name.as_deref().map(normalize_style_name).as_deref() == Some(target)
        })
}

fn extract_word_style_direct(style_block: &str, theme_fonts: &ThemeFonts) -> Map<String, Value> {
    let mut style = Map::new();
    if let Some(fonts_tag) = find_tag(style_block, "w:rFonts") {
        if let Some(font) = attr(&fonts_tag, "w:eastAsia").or_else(|| attr(&fonts_tag, "eastAsia"))
        {
            style.insert("chineseFont".to_string(), json!(font));
        } else if let Some(font) =
            attr(&fonts_tag, "w:eastAsiaTheme").and_then(|value| theme_fonts.resolve(&value, true))
        {
            style.insert("chineseFont".to_string(), json!(font));
        }
        if let Some(font) = attr(&fonts_tag, "w:ascii")
            .or_else(|| attr(&fonts_tag, "w:hAnsi"))
            .or_else(|| attr(&fonts_tag, "ascii"))
        {
            style.insert("latinFont".to_string(), json!(font));
        } else if let Some(font) = attr(&fonts_tag, "w:asciiTheme")
            .or_else(|| attr(&fonts_tag, "w:hAnsiTheme"))
            .and_then(|value| theme_fonts.resolve(&value, false))
        {
            style.insert("latinFont".to_string(), json!(font));
        }
    }
    if let Some(size_tag) = find_tag(style_block, "w:sz") {
        if let Some(size) = attr(&size_tag, "w:val").and_then(|value| value.parse::<f64>().ok()) {
            style.insert(
                "fontSize".to_string(),
                json!((size / 2.0 * 10.0).round() / 10.0),
            );
        }
    }
    if find_tag(style_block, "w:b").is_some() {
        style.insert(
            "fontWeight".to_string(),
            json!(if has_enabled_tag(style_block, "w:b") {
                "700"
            } else {
                "400"
            }),
        );
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
        if let Some(line) = attr(&spacing_tag, "w:line").and_then(|value| value.parse::<f64>().ok())
        {
            let line_rule = attr(&spacing_tag, "w:lineRule").unwrap_or_else(|| "auto".to_string());
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
        if let Some(left) = attr(&indent_tag, "w:left").and_then(|value| value.parse::<f64>().ok())
        {
            style.insert(
                "listIndent".to_string(),
                json!((left / 240.0 * 10.0).round() / 10.0),
            );
        }
        if let Some(hanging) =
            attr(&indent_tag, "w:hanging").and_then(|value| value.parse::<f64>().ok())
        {
            style.insert(
                "listTextIndent".to_string(),
                json!((hanging / 240.0 * 10.0).round() / 10.0),
            );
        }
    }

    style
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

#[derive(Default)]
struct ThemeFonts {
    minor_latin: Option<String>,
    major_latin: Option<String>,
    minor_east_asia: Option<String>,
    major_east_asia: Option<String>,
}

impl ThemeFonts {
    fn resolve(&self, key: &str, east_asia: bool) -> Option<String> {
        let major = key.to_ascii_lowercase().starts_with("major");
        match (major, east_asia) {
            (true, true) => self
                .major_east_asia
                .clone()
                .or_else(|| self.major_latin.clone()),
            (true, false) => self.major_latin.clone(),
            (false, true) => self
                .minor_east_asia
                .clone()
                .or_else(|| self.minor_latin.clone()),
            (false, false) => self.minor_latin.clone(),
        }
    }
}

fn extract_theme_fonts(theme_xml: &str) -> ThemeFonts {
    ThemeFonts {
        minor_latin: extract_theme_font(theme_xml, "a:minorFont", "a:latin"),
        major_latin: extract_theme_font(theme_xml, "a:majorFont", "a:latin"),
        minor_east_asia: extract_theme_font(theme_xml, "a:minorFont", "a:ea"),
        major_east_asia: extract_theme_font(theme_xml, "a:majorFont", "a:ea"),
    }
}

fn extract_theme_font(theme_xml: &str, section_tag: &str, font_tag: &str) -> Option<String> {
    let start = theme_xml.find(&format!("<{section_tag}"))?;
    let section = &theme_xml[start..];
    let end = section.find(&format!("</{section_tag}>"))? + format!("</{section_tag}>").len();
    let font = find_tag(&section[..end], font_tag)?;
    attr(&font, "typeface").filter(|value| !value.trim().is_empty())
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

fn extract_document_text(xml: &str) -> Option<String> {
    let mut text = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:t") {
        rest = &rest[start..];
        let content_start = rest.find('>')? + 1;
        let content = &rest[content_start..];
        let end = content.find("</w:t>")?;
        text.push_str(&xml_unescape(&content[..end]));
        rest = &content[end + "</w:t>".len()..];
    }
    normalize_optional(&text)
}

fn extract_page_settings(
    document_xml: &str,
    header_text: Option<String>,
    footer_text: Option<String>,
) -> Option<Value> {
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

    if let Some(text) = header_text {
        page.insert("headerEnabled".to_string(), json!(true));
        page.insert("headerText".to_string(), json!(text));
    }
    if let Some(text) = footer_text {
        page.insert("footerEnabled".to_string(), json!(true));
        page.insert("footerText".to_string(), json!(text));
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

#[cfg(test)]
mod tests {
    use super::{
        extract_page_settings, extract_theme_fonts, extract_word_style,
        resolve_built_in_reference_docx_path_from_roots, template_sha256, validate_reference_docx,
    };
    use std::fs;

    #[test]
    fn resolves_based_on_styles_and_theme_fonts() {
        let theme = r#"<a:theme><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Aptos" /><a:ea typeface="等线" /></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#;
        let styles = r#"<w:styles><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:pPr><w:spacing w:before="120" w:after="80" /><w:ind w:firstLine="480" /></w:pPr><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" /><w:sz w:val="24" /><w:color w:val="112233" /></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1" /><w:basedOn w:val="Normal" /><w:rPr><w:b /></w:rPr></w:style></w:styles>"#;

        let style = extract_word_style(styles, &["heading1"], &extract_theme_fonts(theme))
            .expect("heading style should be extracted");
        let object = style.as_object().expect("style should be an object");

        assert_eq!(
            object.get("chineseFont").and_then(|value| value.as_str()),
            Some("等线")
        );
        assert_eq!(
            object.get("latinFont").and_then(|value| value.as_str()),
            Some("Aptos")
        );
        assert_eq!(
            object.get("fontSize").and_then(|value| value.as_f64()),
            Some(12.0)
        );
        assert_eq!(
            object.get("fontWeight").and_then(|value| value.as_str()),
            Some("700")
        );
        assert_eq!(
            object
                .get("firstLineIndent")
                .and_then(|value| value.as_f64()),
            Some(2.0)
        );
    }

    #[test]
    fn imports_page_header_and_footer_text() {
        let document = r#"<w:document><w:body><w:sectPr><w:pgSz w:w="11906" w:h="16838" /><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" /></w:sectPr></w:body></w:document>"#;
        let page = extract_page_settings(
            document,
            Some("项目报告".to_string()),
            Some("内部资料".to_string()),
        )
        .expect("page settings should be extracted");
        let object = page.as_object().expect("page should be an object");

        assert_eq!(
            object.get("paperSize").and_then(|value| value.as_str()),
            Some("A4")
        );
        assert_eq!(
            object.get("headerText").and_then(|value| value.as_str()),
            Some("项目报告")
        );
        assert_eq!(
            object.get("footerText").and_then(|value| value.as_str()),
            Some("内部资料")
        );
    }

    #[test]
    fn rejects_files_that_only_have_a_docx_extension() {
        let path = std::env::temp_dir().join(format!(
            "md-king-invalid-reference-{}.docx",
            std::process::id()
        ));
        fs::write(&path, b"not a zip package").expect("invalid fixture should be written");

        let error = validate_reference_docx(&path).expect_err("invalid docx should be rejected");

        assert!(error.contains("不是有效的 DOCX 包"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn computes_reference_docx_sha256() {
        let path = std::env::temp_dir().join(format!(
            "md-king-template-sha256-{}-{}.docx",
            std::process::id(),
            super::now_millis()
        ));
        fs::write(&path, b"abc").expect("hash fixture should be written");

        assert_eq!(
            template_sha256(&path).expect("hash should be computed"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn resolves_specific_template_before_default_fallback_across_roots() {
        let fixture_root = std::env::temp_dir().join(format!(
            "md-king-template-roots-{}-{}",
            std::process::id(),
            super::now_millis()
        ));
        let first_root = fixture_root.join("first");
        let second_root = fixture_root.join("second");
        let fallback = first_root.join("default-report").join("reference.docx");
        let specific = second_root.join("official-document").join("reference.docx");
        fs::create_dir_all(fallback.parent().expect("fallback parent"))
            .expect("fallback directory should be created");
        fs::create_dir_all(specific.parent().expect("specific parent"))
            .expect("specific directory should be created");
        fs::write(&fallback, b"fallback").expect("fallback fixture should be written");
        fs::write(&specific, b"specific").expect("specific fixture should be written");

        let resolved = resolve_built_in_reference_docx_path_from_roots(
            "official-document",
            &[first_root, second_root],
        )
        .expect("specific template should resolve");

        assert_eq!(
            fs::read(resolved).expect("resolved template should be readable"),
            b"specific"
        );
        let _ = fs::remove_dir_all(fixture_root);
    }
}
