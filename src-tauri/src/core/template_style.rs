use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::{Mutex, OnceLock, RwLock};

use crate::storage::atomic::write_atomic;
use crate::storage::paths::template_styles_path;

pub type TemplateStyleConfig = Value;

/// 缓存只是读取加速层，不是权威数据源：权威在磁盘文件上。
/// 所有写入都必须先重新读盘再合并（见 mutate_template_style_configs），
/// 否则另一个进程写入的配置会被本进程的陈旧快照整份覆盖掉。
static TEMPLATE_STYLE_CONFIGS_CACHE: OnceLock<
    RwLock<Option<HashMap<String, TemplateStyleConfig>>>,
> = OnceLock::new();

/// 串行化「读盘 → 改 → 写盘」，避免两个 Tauri 命令并发时各自读到同一份旧内容、
/// 后写的把先写的抹掉。
static TEMPLATE_STYLE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn template_style_configs_cache() -> &'static RwLock<Option<HashMap<String, TemplateStyleConfig>>> {
    TEMPLATE_STYLE_CONFIGS_CACHE.get_or_init(|| RwLock::new(None))
}

fn template_style_write_lock() -> &'static Mutex<()> {
    TEMPLATE_STYLE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

/// 填充缓存。返回后调用方可以拿读锁直接查，只克隆真正要用的那一项——
/// 一次转换会连着调用七八次读取（见 convert.rs 的 page_settings_config 等），
/// 克隆整份 map 不划算。
fn ensure_template_style_configs_cached() -> Result<(), String> {
    {
        let guard = template_style_configs_cache()
            .read()
            .map_err(|_| "模板样式缓存读取失败。".to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        // 显式结束这个块，确保读锁在下面取写锁之前释放：RwLock 不可重入。
    }

    let loaded = load_template_style_configs_from_disk()?;
    let mut guard = template_style_configs_cache()
        .write()
        .map_err(|_| "模板样式缓存写入失败。".to_string())?;
    // 另一个线程可能已经在我们读盘期间填好了，以先到的为准。
    if guard.is_none() {
        *guard = Some(loaded);
    }
    Ok(())
}

fn store_template_style_configs(configs: Option<HashMap<String, TemplateStyleConfig>>) {
    if let Ok(mut guard) = template_style_configs_cache().write() {
        *guard = configs;
    }
}

/// 所有写入的统一入口：拿写锁 → 重新读盘 → 交给 `mutate` 修改 → 原子写盘 → 刷新缓存。
///
/// `mutate` 返回 false 表示无实际改动，跳过写盘（缓存仍更新为刚读到的盘上最新值）。
/// 写盘失败时清空缓存而不是回滚到修改前：此刻盘上究竟是新是旧无法确定，
/// 让下次读取重新读盘，比留一份可能对不上的快照安全。
fn mutate_template_style_configs<F>(mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut HashMap<String, TemplateStyleConfig>) -> bool,
{
    let _write_guard = template_style_write_lock()
        .lock()
        .map_err(|_| "模板样式写入锁已损坏。".to_string())?;

    let mut configs = load_template_style_configs_from_disk()?;
    if !mutate(&mut configs) {
        store_template_style_configs(Some(configs));
        return Ok(());
    }

    match write_template_style_configs(&configs) {
        Ok(()) => {
            store_template_style_configs(Some(configs));
            Ok(())
        }
        Err(error) => {
            store_template_style_configs(None);
            Err(error)
        }
    }
}

pub fn get_template_style_config(
    template_id: String,
) -> Result<Option<TemplateStyleConfig>, String> {
    ensure_template_style_configs_cached()?;
    let guard = template_style_configs_cache()
        .read()
        .map_err(|_| "模板样式缓存读取失败。".to_string())?;
    Ok(guard
        .as_ref()
        .and_then(|configs| configs.get(template_id.trim()).cloned()))
}

pub fn get_template_style_configs(
    template_ids: Vec<String>,
) -> Result<HashMap<String, TemplateStyleConfig>, String> {
    ensure_template_style_configs_cached()?;
    let requested: HashSet<String> = template_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    let guard = template_style_configs_cache()
        .read()
        .map_err(|_| "模板样式缓存读取失败。".to_string())?;
    Ok(guard
        .as_ref()
        .map(|configs| {
            configs
                .iter()
                .filter(|(id, _)| requested.contains(id.as_str()))
                .map(|(id, config)| (id.clone(), config.clone()))
                .collect()
        })
        .unwrap_or_default())
}

pub fn save_template_style_config(
    config: TemplateStyleConfig,
) -> Result<TemplateStyleConfig, String> {
    let template_id = config
        .get("templateId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "模板样式配置缺少 templateId。".to_string())?
        .to_string();

    let stored = config.clone();
    mutate_template_style_configs(move |configs| {
        configs.insert(template_id, config);
        true
    })?;
    Ok(stored)
}

pub fn reset_template_style_config(template_id: String) -> Result<(), String> {
    let template_id = template_id.trim();
    if template_id.is_empty() {
        return Err("模板 ID 不能为空。".to_string());
    }

    reset_template_style_configs(&[template_id.to_string()])
}

pub fn reset_template_style_configs(template_ids: &[String]) -> Result<(), String> {
    if template_ids.is_empty() {
        return Ok(());
    }
    mutate_template_style_configs(|configs| {
        let mut removed = false;
        for template_id in template_ids {
            if configs.remove(template_id.trim()).is_some() {
                removed = true;
            }
        }
        removed
    })
}

fn load_template_style_configs_from_disk() -> Result<HashMap<String, TemplateStyleConfig>, String> {
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
    write_atomic(&path, &content).map_err(|error| format!("写入模板样式失败：{error}"))
}
