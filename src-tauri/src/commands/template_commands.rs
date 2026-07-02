use crate::core::template::{import_template as import_template_core, list_templates as list_templates_core, save_user_templates, ImportTemplateRequest, Template};
use crate::core::template_style::{get_template_style_config as get_template_style_config_core, reset_template_style_config as reset_template_style_config_core, save_template_style_config as save_template_style_config_core, TemplateStyleConfig};

#[tauri::command]
pub fn list_templates() -> Vec<Template> {
    list_templates_core()
}

#[tauri::command]
pub fn import_template(request: ImportTemplateRequest) -> Result<Template, String> {
    import_template_core(request)
}

#[tauri::command]
pub fn save_templates(templates: Vec<Template>) -> Result<Vec<Template>, String> {
    save_user_templates(templates)?;
    Ok(list_templates_core())
}

#[tauri::command]
pub fn get_template_style_config(template_id: String) -> Result<Option<TemplateStyleConfig>, String> {
    get_template_style_config_core(template_id)
}

#[tauri::command]
pub fn save_template_style_config(config: TemplateStyleConfig) -> Result<TemplateStyleConfig, String> {
    save_template_style_config_core(config)
}

#[tauri::command]
pub fn reset_template_style_config(template_id: String) -> Result<(), String> {
    reset_template_style_config_core(template_id)
}
