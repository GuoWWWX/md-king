use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::config::{load_config, save_config};
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
            tags: vec!["报告".to_string(), "通用".to_string(), "内置".to_string()],
            is_built_in: true,
            is_default: true,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        },
        Template {
            id: "official-document".to_string(),
            name: "正式公文模板".to_string(),
            description: Some("为正式材料预留的标题层级、正文缩进和页边距样式。".to_string()),
            reference_docx_path: "".to_string(),
            preview_image_path: None,
            tags: vec!["公文".to_string(), "正式".to_string(), "内置".to_string()],
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
            tags: vec!["技术".to_string(), "代码".to_string(), "内置".to_string()],
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
