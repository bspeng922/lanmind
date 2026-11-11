use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tempfile::{Builder, NamedTempFile};
use uuid::Uuid;

const MAX_CHUNK: usize = 4 * 1024 * 1024;

struct OutputState {
    temporary: NamedTempFile,
    target: PathBuf,
    hasher: Sha256,
    bytes: u64,
}
static OUTPUTS: OnceLock<Mutex<HashMap<String, OutputState>>> = OnceLock::new();

fn outputs() -> &'static Mutex<HashMap<String, OutputState>> {
    OUTPUTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn deactivate() {
    if let Ok(mut items) = outputs().lock() {
        items.clear();
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputInfo {
    pub output_id: String,
}

#[tauri::command]
pub fn optical_output_begin(target_path: String) -> Result<OutputInfo, String> {
    let target = PathBuf::from(target_path);
    if target.exists() {
        return Err("OUTPUT_EXISTS_CONFIRM_REQUIRED".into());
    }
    let output_id = Uuid::new_v4().simple().to_string();
    // Keep staging on the destination filesystem so publication also works on another drive.
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temporary = Builder::new()
        .prefix(".lanmind-optical-")
        .suffix(".part")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?.insert(
        output_id.clone(),
        OutputState {
            temporary,
            target,
            hasher: Sha256::new(),
            bytes: 0,
        },
    );
    Ok(OutputInfo { output_id })
}

#[tauri::command]
pub fn optical_output_write(output_id: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > MAX_CHUNK {
        return Err("CHUNK_TOO_LARGE".into());
    }
    let mut items = outputs().lock().map_err(|_| "OUTPUT_LOCK_FAILED")?;
    let state = items
        .get_mut(&output_id)
        .ok_or_else(|| "OUTPUT_NOT_FOUND".to_string())?;
    state
        .temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    state.hasher.update(&bytes);
    state.bytes += bytes.len() as u64;
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputResult {
    pub bytes: u64,
    pub sha256: String,
}

#[tauri::command]
pub fn optical_output_finalize(output_id: String) -> Result<OutputResult, String> {
    let state = outputs()
        .lock()
        .map_err(|_| "OUTPUT_LOCK_FAILED")?
        .remove(&output_id)
        .ok_or_else(|| "OUTPUT_NOT_FOUND".to_string())?;
    state
        .temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    state
        .temporary
        .persist_noclobber(&state.target)
        .map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                "OUTPUT_EXISTS_CONFIRM_REQUIRED".into()
            } else {
                error.error.to_string()
            }
        })?;
    let digest = state.hasher.finalize();
    Ok(OutputResult {
        bytes: state.bytes,
        sha256: digest.iter().map(|byte| format!("{byte:02x}")).collect(),
    })
}

#[tauri::command]
pub fn optical_output_abort(output_id: String) -> Result<(), String> {
    outputs()
        .lock()
        .map_err(|_| "OUTPUT_LOCK_FAILED")?
        .remove(&output_id);
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn outputs_stage_beside_destination_clean_up_and_never_overwrite_existing_files() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("received.bin");
        let begin = || {
            optical_output_begin(target.to_string_lossy().into_owned())
                .unwrap()
                .output_id
        };
        let temporary_for = |id: &str| {
            outputs()
                .lock()
                .unwrap()
                .get(id)
                .unwrap()
                .temporary
                .path()
                .to_path_buf()
        };
        let id = begin();
        let temporary = temporary_for(&id);
        assert_eq!(temporary.parent(), target.parent());
        optical_output_write(id.clone(), vec![1, 2, 3]).unwrap();
        optical_output_abort(id).unwrap();
        assert!(!temporary.exists());
        assert!(!target.exists());

        let id = begin();
        let temporary = temporary_for(&id);
        deactivate();
        assert!(!temporary.exists());
        assert!(!target.exists());
        assert!(optical_output_finalize(id).is_err());

        let id = begin();
        let temporary = temporary_for(&id);
        std::fs::write(&target, b"existing file").unwrap();
        assert_eq!(
            optical_output_finalize(id).unwrap_err(),
            "OUTPUT_EXISTS_CONFIRM_REQUIRED"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"existing file");
        assert!(!temporary.exists());
        std::fs::remove_file(&target).unwrap();

        let id = begin();
        let temporary = temporary_for(&id);
        optical_output_write(id.clone(), b"received bytes".to_vec()).unwrap();
        let result = optical_output_finalize(id).unwrap();
        assert_eq!(result.bytes, 14);
        assert_eq!(
            result.sha256,
            format!("{:x}", Sha256::digest(b"received bytes"))
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"received bytes");
        assert!(!temporary.exists());
    }
}
