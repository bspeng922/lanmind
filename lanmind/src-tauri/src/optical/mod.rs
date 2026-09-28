pub mod output;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_CHUNK: usize = 4 * 1024 * 1024;

static SOURCES: OnceLock<Mutex<std::collections::HashMap<String, PathBuf>>> = OnceLock::new();

fn sources() -> &'static Mutex<std::collections::HashMap<String, PathBuf>> {
    SOURCES.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn optical_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?.join("optical");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub source_id: String,
    pub size: u64,
}

#[tauri::command]
pub fn optical_source_open(path: String) -> Result<SourceInfo, String> {
    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() { return Err("SOURCE_NOT_FILE".into()); }
    let source_id = Uuid::new_v4().simple().to_string();
    sources().lock().map_err(|_| "SOURCE_LOCK_FAILED")?.insert(source_id.clone(), path);
    Ok(SourceInfo { source_id, size: metadata.len() })
}

#[tauri::command]
pub fn optical_source_read_range(source_id: String, offset: u64, length: u32) -> Result<Vec<u8>, String> {
    let length = usize::try_from(length).map_err(|_| "INVALID_RANGE")?;
    if length > MAX_CHUNK { return Err("CHUNK_TOO_LARGE".into()); }
    let path = sources().lock().map_err(|_| "SOURCE_LOCK_FAILED")?.get(&source_id).cloned().ok_or_else(|| "SOURCE_NOT_FOUND".to_string())?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
    let mut bytes = vec![0u8; length];
    let count = file.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(count);
    Ok(bytes)
}

#[tauri::command]
pub fn optical_source_close(source_id: String) -> Result<(), String> {
    sources().lock().map_err(|_| "SOURCE_LOCK_FAILED")?.remove(&source_id);
    Ok(())
}

#[tauri::command]
pub fn optical_cache_create(app: AppHandle, session_id: Option<String>) -> Result<String, String> {
    let id = session_id.filter(|value| value.len() <= 96 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')).unwrap_or_else(|| Uuid::new_v4().simple().to_string());
    let path = optical_root(&app)?.join("cache").join(&id);
    std::fs::create_dir_all(path.join("blocks")).map_err(|error| error.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn optical_cache_load(app: AppHandle, session_id: String) -> Result<bool, String> {
    let path = optical_root(&app)?.join("cache").join(safe_component(&session_id)?);
    Ok(path.is_dir())
}

fn safe_component(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 96 || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') { return Err("INVALID_OPAQUE_ID".into()); }
    Ok(value.to_string())
}

fn safe_key(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 240 || value.starts_with('/') || value.contains("..") || value.contains('\\') || value.contains("//") || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._/-".contains(&byte)) { return Err("INVALID_CACHE_KEY".into()); }
    Ok(value.to_string())
}

fn cache_path(app: &AppHandle, cache_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(optical_root(app)?.join("cache").join(safe_component(cache_id)?).join(safe_key(key)?))
}

#[tauri::command]
pub fn optical_cache_read(app: AppHandle, cache_id: String, key: String) -> Result<Option<Vec<u8>>, String> {
    let path = cache_path(&app, &cache_id, &key)?;
    match std::fs::read(path) { Ok(bytes) => Ok(Some(bytes)), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None), Err(error) => Err(error.to_string()) }
}

#[tauri::command]
pub fn optical_cache_write(app: AppHandle, cache_id: String, key: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > MAX_CHUNK { return Err("CHUNK_TOO_LARGE".into()); }
    let path = cache_path(&app, &cache_id, &key)?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let temporary = path.with_extension("part");
    std::fs::write(temporary, bytes).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn optical_cache_commit(app: AppHandle, cache_id: String, key: String) -> Result<(), String> {
    let path = cache_path(&app, &cache_id, &key)?;
    let temporary = path.with_extension("part");
    if !temporary.exists() { return Err("CACHE_PART_NOT_FOUND".into()); }
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn optical_cache_delete(app: AppHandle, cache_id: String, key: Option<String>) -> Result<(), String> {
    let root = optical_root(&app)?.join("cache").join(safe_component(&cache_id)?);
    if let Some(key) = key {
        let path = root.join(safe_key(&key)?);
        match std::fs::remove_file(path) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(error.to_string()) }
    } else {
        match std::fs::remove_dir_all(root) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(error.to_string()) }
    }
}

#[tauri::command]
pub fn optical_cache_keys(app: AppHandle, cache_id: String, prefix: String) -> Result<Vec<String>, String> {
    let root = optical_root(&app)?.join("cache").join(safe_component(&cache_id)?);
    let prefix = safe_key(&prefix)?;
    let mut output = Vec::new();
    fn walk(root: &std::path::Path, current: &std::path::Path, prefix: &str, output: &mut Vec<String>) -> Result<(), String> {
        if !current.exists() { return Ok(()); }
        for entry in std::fs::read_dir(current).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() { walk(root, &path, prefix, output)?; }
            else if path.extension().and_then(|value| value.to_str()) != Some("part") {
                let relative = path.strip_prefix(root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
                if relative.starts_with(prefix) { output.push(relative); }
            }
        }
        Ok(())
    }
    walk(&root, &root, &prefix, &mut output)?;
    output.sort();
    Ok(output)
}
