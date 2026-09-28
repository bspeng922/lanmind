use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_CHUNK: usize = 4 * 1024 * 1024;

struct OutputState { temporary: PathBuf, target: PathBuf, file: File, hasher: Sha256, bytes: u64 }
static OUTPUTS: OnceLock<Mutex<HashMap<String, OutputState>>> = OnceLock::new();

fn outputs() -> &'static Mutex<HashMap<String, OutputState>> { OUTPUTS.get_or_init(|| Mutex::new(HashMap::new())) }

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("optical").join("outputs");
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputInfo { pub output_id: String }

#[tauri::command]
pub fn optical_output_begin(app: AppHandle, target_path: String) -> Result<OutputInfo, String> {
    let target = PathBuf::from(target_path);
    if target.exists() { return Err("OUTPUT_EXISTS_CONFIRM_REQUIRED".into()); }
    let output_id = Uuid::new_v4().simple().to_string();
    let temporary = root(&app)?.join(format!("{output_id}.part"));
    let file = OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|error| error.to_string())?;
    outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.insert(output_id.clone(), OutputState { temporary, target, file, hasher: Sha256::new(), bytes: 0 });
    Ok(OutputInfo { output_id })
}

#[tauri::command]
pub fn optical_output_write(output_id: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > MAX_CHUNK { return Err("CHUNK_TOO_LARGE".into()); }
    let mut state = outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.remove(&output_id).ok_or_else(|| "OUTPUT_NOT_FOUND".to_string())?;
    let result = (|| { state.file.write_all(&bytes).map_err(|error| error.to_string())?; state.hasher.update(&bytes); state.bytes += bytes.len() as u64; Ok(()) })();
    outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.insert(output_id, state);
    result
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputResult { pub bytes: u64, pub sha256: String }

#[tauri::command]
pub fn optical_output_finalize(output_id: String) -> Result<OutputResult, String> {
    let state = outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.remove(&output_id).ok_or_else(|| "OUTPUT_NOT_FOUND".to_string())?;
    state.file.sync_all().map_err(|error| error.to_string())?;
    drop(state.file);
    if state.target.exists() { let _ = std::fs::remove_file(&state.temporary); return Err("OUTPUT_EXISTS_CONFIRM_REQUIRED".into()); }
    if let Err(error) = std::fs::rename(&state.temporary, &state.target) { let _ = std::fs::remove_file(&state.temporary); return Err(error.to_string()); }
    let digest = state.hasher.finalize();
    Ok(OutputResult { bytes: state.bytes, sha256: digest.iter().map(|byte| format!("{byte:02x}")).collect() })
}

#[tauri::command]
pub fn optical_output_abort(output_id: String) -> Result<(), String> {
    if let Some(state) = outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.remove(&output_id) { let _ = std::fs::remove_file(state.temporary); }
    Ok(())
}
