use tauri::AppHandle;

use crate::core::convert::{
    convert_markdown as convert_markdown_core, ConvertRequest, ConvertResult,
};

#[tauri::command]
pub fn convert_markdown(app: AppHandle, request: ConvertRequest) -> ConvertResult {
    convert_markdown_core(&app, request)
}
