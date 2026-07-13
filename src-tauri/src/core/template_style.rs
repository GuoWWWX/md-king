use serde_json::Value;
use std::collections::HashMap;
use std::fs;

use crate::storage::paths::template_styles_path;

pub type TemplateStyleConfig = Value;

pub fn get_template_style_config(
    template_id: String,
) -> Result<Option<TemplateStyleConfig>, String> {
    let configs = load_template_style_configs()?;
    Ok(configs.get(template_id.trim()).cloned())
}

pub fn save_template_style_config(
    config: TemplateStyleConfig,
) -> Result<TemplateStyleConfig, String> {
    let template_id = config
        .get("templateId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "模板样式配置缺少 templateId。".to_string())?;

    let mut configs = load_template_style_configs()?;
    configs.insert(template_id.to_string(), config.clone());
    write_template_style_configs(&configs)?;
    Ok(config)
}

pub fn reset_template_style_config(template_id: String) -> Result<(), String> {
    let template_id = template_id.trim();
    if template_id.is_empty() {
        return Err("模板 ID 不能为空。".to_string());
    }

    let mut configs = load_template_style_configs()?;
    configs.remove(template_id);
    write_template_style_configs(&configs)
}

fn load_template_style_configs() -> Result<HashMap<String, TemplateStyleConfig>, String> {
    let path = template_styles_path().map_err(|error| format!("获取模板样式路径失败：{error}"))?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取模板样式失败：{error}"))?;

    serde_json::from_str(&content).map_err(|error| {
        format!(
            "模板样式文件已损坏，为避免覆盖原数据，本次操作已取消：{}（{error}）",
            path.to_string_lossy()
        )
    })
}

fn write_template_style_configs(
    configs: &HashMap<String, TemplateStyleConfig>,
) -> Result<(), String> {
    let path = template_styles_path().map_err(|error| format!("获取模板样式路径失败：{error}"))?;
    let content = serde_json::to_string_pretty(configs)
        .map_err(|error| format!("序列化模板样式失败：{error}"))?;
    fs::write(path, content).map_err(|error| format!("写入模板样式失败：{error}"))
}
