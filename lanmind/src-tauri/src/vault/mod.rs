mod crypto;
mod generator;
mod import_export;
mod model;
pub(crate) mod sharing;
mod ssh;
mod storage;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub use storage::Runtime;
use tauri::{AppHandle, Emitter, Manager};

pub fn path(root: &std::path::Path, user: &str) -> std::path::PathBuf {
    root.join("vault")
        .join(format!("{:x}.sqlite", Sha256::digest(user.as_bytes())))
}
pub fn publish(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        if let Ok(status) = state.vault.status() {
            if status["locked"] == true {
                clear_clipboard(None);
            }
            let _ = app.emit("vault://state", status);
        }
    }
}
pub fn lock(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.vault.lock();
    }
    publish(app);
}
pub fn spawn_timer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let state = app.state::<crate::AppState>();
            let scope = state
                .db
                .lock()
                .ok()
                .and_then(|db| db.workspace_context().ok())
                .map(|c| format!("{}:{}", c.workspace_id, c.revision))
                .unwrap_or_default();
            let locked = state.app_lock.status().map(|s| s.locked).unwrap_or(true);
            if state.vault.tick(&scope, locked) {
                publish(&app);
            }
        }
    });
}
#[tauri::command]
pub async fn vault_api(
    app: AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    payload: Value,
    session_version: Option<u64>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("VAULT_WINDOW".into());
    }
    let value = tauri::async_runtime::spawn_blocking(move || {
        dispatch(&app, &action, payload, session_version)
    })
    .await
    .map_err(|_| "VAULT_STORAGE")?;
    value
}
fn dispatch(
    app: &AppHandle,
    action: &str,
    payload: Value,
    version: Option<u64>,
) -> Result<Value, String> {
    let state = app.state::<crate::AppState>();
    if action == "lock" {
        lock(app);
        return state.vault.status();
    }
    if crate::app_interface_locked(app) {
        lock(app);
        return Err("APP_LOCKED".into());
    }
    {
        let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
        db.require_feature("vault")?;
    }
    let expected = version.unwrap_or(u64::MAX);
    let result = match action {
        "status" => state.vault.status(),
        "create" | "unlock" => {
            let password =
                zeroize::Zeroizing::new(storage::text(&payload, "password")?.to_string());
            let status = if action == "create" {
                state.vault.create(&password)?
            } else {
                state.vault.unlock(&password)?
            };
            let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
            state.vault.publish_key(
                status["sessionVersion"].as_u64().ok_or("VAULT_STORAGE")?,
                &db,
            )?;
            Ok(status)
        }
        "activity" => state.vault.activity(expected),
        "destroy" => state
            .vault
            .destroy(storage::text(&payload, "currentPassword")?, expected),
        "importPreview" => state.vault.import(payload, expected, false),
        "import" => state.vault.import(payload, expected, true),
        "export" => state.vault.export(payload, expected),
        "readSshFile" => state.vault.with(expected, |_, _, _| {
            use std::io::Read;
            let path = storage::text(&payload, "path")?;
            let mut file = std::fs::File::open(path).map_err(|_| "VAULT_FILE")?;
            if file.metadata().map_err(|_| "VAULT_FILE")?.len() > 128 * 1024 {
                return Err("VAULT_FILE_SIZE".into());
            }
            let mut value = zeroize::Zeroizing::new(String::new());
            (&mut file)
                .take(128 * 1024 + 1)
                .read_to_string(&mut value)
                .map_err(|_| "VAULT_FILE")?;
            if value.len() > 128 * 1024 {
                return Err("VAULT_FILE_SIZE".into());
            }
            Ok(json!(&*value))
        }),
        "copy" => state.vault.with(expected, |_, _, c| {
            let entry = c
                .entries
                .iter()
                .find(|e| e.id == payload["id"] && e.deleted_at.is_none())
                .ok_or("VAULT_NOT_FOUND")?;
            let value = match storage::text(&payload, "field")? {
                "username" => &entry.username,
                "password" => &entry.password,
                "publicKey" => &entry.public_key,
                "privateKey" => &entry.private_key,
                "keyPassphrase" => &entry.key_passphrase,
                "fingerprint" => &entry.fingerprint,
                _ => return Err("VAULT_INVALID".into()),
            };
            copy(value)?;
            Ok(Value::Null)
        }),
        "copyGenerated" => state.vault.with(expected, |_, _, _| {
            copy(storage::text(&payload, "value")?)?;
            Ok(Value::Null)
        }),
        "openUrl" => state.vault.with(expected, |_, _, _| {
            open_url(storage::text(&payload, "url")?)?;
            Ok(Value::Null)
        }),
        "recipient" => {
            state.vault.with(expected, |_, _, _| Ok(()))?;
            let recipient = storage::text(&payload, "userId")?;
            {
                let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
                db.require_feature("chat")?;
                db.require_workspace_member(recipient)?;
            }
            let info = state
                .network
                .lock()
                .map_err(|_| "VAULT_STORAGE")?
                .vault_recipient(recipient)?;
            let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
            sharing::verify_public(&db, &info)?;
            state.vault.with(expected, |_, _, _| Ok(()))?;
            let previous = db
                .setting(&format!("vaultVerified:{recipient}"))?
                .and_then(|raw| serde_json::from_str::<sharing::PublicInfo>(&raw).ok());
            let mut result = json!(info);
            result["knownFingerprint"] = json!(previous.map(|p| p.fingerprint));
            Ok(result)
        }
        "share" => {
            let scope = state
                .db
                .lock()
                .map_err(|_| "VAULT_STORAGE")?
                .workspace_context()?;
            let recipient: sharing::PublicInfo = storage::parse(payload["recipient"].clone())?;
            let mut message = {
                let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
                db.require_feature("chat")?;
                state.vault.share(payload, expected, &db)?
            };
            let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
            db.require_feature("chat")?;
            if db.workspace_context()? != scope {
                return Err("VAULT_RECIPIENT".into());
            }
            message["senderName"] = json!(db
                .users()?
                .into_iter()
                .find(|u| u.id == scope.user_id)
                .map(|u| u.nickname)
                .unwrap_or_default());
            let result = state
                .vault
                .with(expected, |_, _, _| db.save_vault_share(message, &recipient))?;
            let _ = app.emit("chat://message", &result);
            Ok(json!({"id":result.id}))
        }
        "receive" | "saveShare" => {
            let db = state.db.lock().map_err(|_| "VAULT_STORAGE")?;
            db.require_feature("chat")?;
            state
                .vault
                .receive(payload, expected, &db, action == "saveShare")
        }
        _ => state.vault.execute(action, payload, expected),
    };
    if matches!(action, "create" | "unlock" | "activity" | "destroy") {
        publish(app);
    }
    if result.is_ok()
        && !matches!(
            action,
            "status"
                | "list"
                | "search"
                | "get"
                | "activity"
                | "generate"
                | "generateSsh"
                | "recipient"
                | "receive"
                | "importPreview"
                | "copy"
                | "copyGenerated"
                | "openUrl"
                | "clone"
                | "readSshFile"
        )
    {
        let _ = app.emit("vault://changed", json!({"sessionVersion":expected}));
    }
    if matches!(result,Err(ref error) if error=="VAULT_LOCKED") {
        publish(app);
    }
    result
}
static CLIPBOARD_OWNER: std::sync::Mutex<Option<(u64, Vec<u8>)>> = std::sync::Mutex::new(None);
static CLIPBOARD_VERSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn clear_clipboard(expected: Option<u64>) {
    let Ok(mut owner) = CLIPBOARD_OWNER.lock() else {
        return;
    };
    let Some((version, hash)) = owner.as_ref() else {
        return;
    };
    if expected.is_some_and(|expected| expected != *version) {
        return;
    }
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            let text = zeroize::Zeroizing::new(text);
            if Sha256::digest(text.as_bytes()).as_slice() == hash.as_slice() {
                let _ = clipboard.clear();
            }
        }
    }
    *owner = None;
}
fn copy(value: &str) -> Result<(), String> {
    // Serialize clipboard writes with the expiry timer so an old timer cannot clear a new copy.
    let mut owner = CLIPBOARD_OWNER.lock().map_err(|_| "VAULT_CLIPBOARD")?;
    let mut clipboard = arboard::Clipboard::new().map_err(|_| "VAULT_CLIPBOARD")?;
    clipboard.set_text(value).map_err(|_| "VAULT_CLIPBOARD")?;
    let version = CLIPBOARD_VERSION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *owner = Some((version, Sha256::digest(value.as_bytes()).to_vec()));
    drop(owner);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        clear_clipboard(Some(version));
    });
    Ok(())
}
fn open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("VAULT_INVALID".into());
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|e| format!("VAULT_BROWSER: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("VAULT_BROWSER: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("VAULT_BROWSER: {e}"))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests;
