//! Local plugin installation and LAN distribution are independent of workspace sync.
pub mod package;
pub(crate) mod runtime;
mod store;
mod transport;
use crate::{db::Database, AppState};
use package::*;
pub use runtime::{is_plugin_window as runtime_window, serve_resource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
pub use store::Installed;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
pub use transport::routes;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub node_id: String,
    pub display_name: String,
    pub address: String,
    pub port: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPackage {
    pub metadata: SignedMetadata,
    pub sha256: String,
    pub size_bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub protocol_version: u32,
    pub items: Vec<CatalogPackage>,
    pub next_offset: Option<usize>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPackage {
    pub plugin_key: String,
    pub publisher_id: String,
    pub manifest: Manifest,
    pub metadata: SignedMetadata,
    pub sha256: String,
    pub size_bytes: u64,
    pub compatible: bool,
    pub sources: Vec<Source>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub plugin_key: String,
    pub state: String,
    pub received: u64,
    pub total: u64,
    pub source: Option<String>,
    pub error: Option<String>,
}
struct RunningJob {
    job: Job,
    cancel: CancellationToken,
}
pub struct Runtime {
    pub root: PathBuf,
    pub db: Arc<Mutex<Database>>,
    operation: Arc<tokio::sync::Mutex<()>>,
    jobs: Mutex<Vec<RunningJob>>,
    market: Mutex<Vec<MarketPackage>>,
    pub(super) shares: Mutex<HashMap<String, CancellationToken>>,
    sessions: Mutex<HashMap<String, runtime::Session>>,
    permissions: Mutex<HashMap<String, runtime::PermissionRequest>>,
}
impl Runtime {
    pub fn new(root: PathBuf, db: Arc<Mutex<Database>>) -> Result<Arc<Self>> {
        directory(&root)?;
        for part in ["packages", "releases", "staging", "profiles"] {
            directory(&root.join(part))?;
        }
        db.lock()
            .map_err(|_| fail("STORAGE"))?
            .initialize_plugins()?;
        let this = Arc::new(Self {
            root,
            db,
            operation: Arc::new(tokio::sync::Mutex::new(())),
            jobs: Mutex::new(Vec::new()),
            market: Mutex::new(Vec::new()),
            shares: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            permissions: Mutex::new(HashMap::new()),
        });
        // Only disposable staging directories are removed during crash recovery.
        for part in ["staging", "profiles"] {
            for item in io(fs::read_dir(this.root.join(part)))? {
                let item = io(item)?;
                let _ = remove_managed(&this.root, &item.path());
            }
        }
        let installed = this
            .db
            .lock()
            .map_err(|_| fail("STORAGE"))?
            .installed_plugins()?;
        for mut plugin in installed {
            let path = this.package_path(&plugin.sha256)?;
            let valid = file_digest(&path).ok().as_deref() == Some(&plugin.sha256)
                && inspect(&path, None, &CancellationToken::new())
                    .ok()
                    .is_some_and(|v| {
                        v.plugin_key == plugin.plugin_key
                            && v.metadata.manifest == plugin.metadata.manifest
                    });
            if !valid {
                plugin.available = false;
                plugin.enabled = false;
                plugin.shared = false;
            } else {
                plugin.available = true;
            }
            this.db
                .lock()
                .map_err(|_| fail("STORAGE"))?
                .save_plugin(&plugin)?;
        }
        this.cleanup_unreferenced();
        Ok(this)
    }
    fn cleanup_unreferenced(&self) {
        let Ok(records) = self
            .db
            .lock()
            .map_err(|_| fail("STORAGE"))
            .and_then(|db| db.installed_plugins())
        else {
            return;
        };
        let keep: std::collections::HashSet<_> = records
            .into_iter()
            .flat_map(|p| std::iter::once(p.sha256).chain(p.previous_sha256))
            .collect();
        for part in ["packages", "releases"] {
            let Ok(entries) = fs::read_dir(self.root.join(part)) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let hash = if part == "packages" {
                    name.strip_suffix(".lmpk").unwrap_or_default()
                } else {
                    &name
                };
                if valid_hash(hash) && !keep.contains(hash) {
                    let _ = remove_managed(&self.root, &entry.path());
                }
            }
        }
    }
    pub fn package_path(&self, hash: &str) -> Result<PathBuf> {
        if !valid_hash(hash) {
            return Err(fail("ARGUMENTS"));
        }
        Ok(self.root.join("packages").join(format!("{hash}.lmpk")))
    }
    pub fn snapshot(&self) -> Result<Value> {
        let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
        let installed = db.installed_plugins()?;
        let sharing = db.setting("pluginSharingEnabled")?.as_deref() != Some("false");
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| fail("STATE"))?
            .iter()
            .map(|t| t.job.clone())
            .collect::<Vec<_>>();
        Ok(json!({"installed":installed,"sharing":sharing,"jobs":jobs}))
    }
    pub fn notify(&self, app: &AppHandle) {
        let _ = app.emit_to("main", "plugins://changed", ());
    }
    fn job_update(&self, app: &AppHandle, id: &str, change: impl FnOnce(&mut Job)) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(task) = jobs.iter_mut().find(|t| t.job.id == id) {
                change(&mut task.job);
                let _ = app.emit_to("main", "plugins://progress", &task.job);
            }
        }
    }
    fn begin_job(
        &self,
        key: String,
    ) -> Result<(String, CancellationToken, tokio::sync::OwnedMutexGuard<()>)> {
        let gate = self
            .operation
            .clone()
            .try_lock_owned()
            .map_err(|_| fail("BUSY"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = CancellationToken::new();
        let mut jobs = self.jobs.lock().map_err(|_| fail("STATE"))?;
        if jobs.len() >= 20 {
            jobs.remove(0);
        }
        jobs.push(RunningJob {
            job: Job {
                id: id.clone(),
                plugin_key: key,
                state: "queued".into(),
                received: 0,
                total: 0,
                source: None,
                error: None,
            },
            cancel: cancel.clone(),
        });
        Ok((id, cancel, gate))
    }
    fn finish_job(&self, app: &AppHandle, id: &str, result: Result<()>) {
        self.job_update(app, id, |j| match result {
            Ok(()) => {
                j.state = "installed".into();
                j.received = j.total;
            }
            Err(e) => {
                j.state = if e == fail("CANCELLED") {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                j.error = Some(e);
            }
        });
        self.notify(app);
    }
    fn install_staged(
        &self,
        app: &AppHandle,
        id: &str,
        archive: &Path,
        cancel: &CancellationToken,
        expected: Option<&MarketPackage>,
    ) -> Result<()> {
        if cancel.is_cancelled() {
            return Err(fail("CANCELLED"));
        }
        let staging = self.root.join("staging").join(id);
        directory(&staging)?;
        let extraction = staging.join("unpacked");
        directory(&extraction)?;
        let result = (|| {
            self.job_update(app, id, |j| j.state = "verifying".into());
            let hash = file_digest(archive)?;
            let verified = inspect(archive, Some(&extraction), cancel)?;
            if !verified.manifest.compatible() {
                return Err(fail("INCOMPATIBLE"));
            }
            if expected.is_some_and(|p| {
                p.sha256 != hash
                    || p.plugin_key != verified.plugin_key
                    || p.metadata.manifest != verified.metadata.manifest
            }) {
                return Err(fail("HASH"));
            }
            let size = io(fs::metadata(archive))?.len();
            let old = self
                .db
                .lock()
                .map_err(|_| fail("STORAGE"))?
                .installed_plugin(&verified.plugin_key)
                .ok();
            if let Some(old) = &old {
                let before = semver::Version::parse(&old.manifest.version)
                    .map_err(|_| fail("INVALID_PACKAGE"))?;
                let after = semver::Version::parse(&verified.manifest.version)
                    .map_err(|_| fail("INVALID_PACKAGE"))?;
                if after < before {
                    return Err(fail("DOWNGRADE"));
                }
                if after == before && old.sha256 != hash {
                    return Err(fail("VERSION_COLLISION"));
                }
            }
            if cancel.is_cancelled() {
                return Err(fail("CANCELLED"));
            }
            if crate::app_interface_locked(app) {
                return Err("APP_LOCKED".into());
            }
            self.job_update(app, id, |j| {
                j.state = "installing".into();
                j.plugin_key = verified.plugin_key.clone();
                j.total = size;
            });
            let package = self.package_path(&hash)?;
            if package.exists() && file_digest(&package)? != hash {
                remove_managed(&self.root, &package)?;
            }
            if !package.exists() {
                let copy = staging.join("verified.lmpk");
                io(fs::copy(archive, &copy))?;
                if file_digest(&copy)? != hash {
                    return Err(fail("HASH"));
                }
                io(fs::rename(copy, &package))?;
            }
            let release = self.root.join("releases").join(&hash);
            // Reinstalling repairs extracted resources without trusting old files.
            if release.exists() {
                self.close_plugin(app, &verified.plugin_key);
                remove_managed(&self.root, &release)?;
            }
            io(fs::rename(&extraction, &release))?;
            let plugin = Installed {
                previous_sha256: old.as_ref().and_then(|p| {
                    if p.sha256 != hash {
                        Some(p.sha256.clone())
                    } else {
                        p.previous_sha256.clone()
                    }
                }),
                plugin_key: verified.plugin_key.clone(),
                publisher_id: verified.publisher_id,
                manifest: verified.manifest,
                metadata: verified.metadata,
                sha256: hash,
                size_bytes: size,
                enabled: old.as_ref().is_none_or(|p| p.enabled),
                shared: old.as_ref().is_none_or(|p| p.shared),
                available: true,
                installed_at: chrono::Utc::now().to_rfc3339(),
            };
            {
                let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
                db.workspace_transaction("plugin_install", || {
                    db.save_plugin(&plugin)?;
                    let capabilities=serde_json::to_string(&plugin.manifest.capabilities).map_err(|_|fail("STORAGE"))?;
                    db.conn.execute("DELETE FROM plugin_grants WHERE plugin_key=? AND capability NOT IN (SELECT value FROM json_each(?))",rusqlite::params![plugin.plugin_key,capabilities]).map_err(|_|fail("STORAGE"))?;
                    let scope = db.workspace_context()?;
                    db.plugin_audit(&plugin, &scope, "install", None, id, "ok")
                })?;
            }
            self.close_plugin(app, &plugin.plugin_key);
            if let Some(old) = old {
                if old.sha256 != plugin.sha256 {
                    self.cancel_share(&old.sha256);
                }
                if let Some(previous) = old
                    .previous_sha256
                    .filter(|h| Some(h) != plugin.previous_sha256.as_ref() && h != &plugin.sha256)
                {
                    let _ = remove_managed(&self.root, &self.root.join("releases").join(&previous));
                    let _ = remove_managed(&self.root, &self.package_path(&previous)?);
                }
            }
            self.cleanup_unreferenced();
            Ok(())
        })();
        // Once the database commit succeeds, a disposable staging-directory
        // cleanup failure must not report an otherwise completed install as failed.
        let _ = remove_managed(&self.root, &staging);
        result
    }
    pub fn import(self: &Arc<Self>, app: AppHandle, path: PathBuf) -> Result<String> {
        let (id, cancel, gate) = self.begin_job(String::new())?;
        self.notify(&app);
        let this = self.clone();
        let job_id = id.clone();
        tauri::async_runtime::spawn(async move {
            let worker = this.clone();
            let worker_app = app.clone();
            let worker_id = job_id.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let staging = worker.root.join("staging").join(&worker_id);
                directory(&staging)?;
                let copy = staging.join("download.lmpk");
                if io(fs::metadata(&path))?.len() > MAX_PACKAGE {
                    return Err(fail("PACKAGE_TOO_LARGE"));
                }
                io(fs::copy(path, &copy))?;
                worker.install_staged(&worker_app, &worker_id, &copy, &cancel, None)
            })
            .await
            .unwrap_or_else(|_| Err(fail("IO")));
            let _ = remove_managed(&this.root, &this.root.join("staging").join(&job_id));
            drop(gate);
            this.finish_job(&app, &job_id, result);
        });
        Ok(id)
    }
    pub fn cancel_share(&self, hash: &str) {
        if let Ok(mut shares) = self.shares.lock() {
            if let Some(token) = shares.remove(hash) {
                token.cancel();
            }
        }
    }
    pub fn cancel_job(&self, id: &str) -> Result<()> {
        let jobs = self.jobs.lock().map_err(|_| fail("STATE"))?;
        if let Some(job) = jobs.iter().find(|j| {
            j.job.id == id && !matches!(j.job.state.as_str(), "installed" | "failed" | "cancelled")
        }) {
            job.cancel.cancel();
        }
        Ok(())
    }
    pub fn set_sharing(&self, enabled: bool) -> Result<()> {
        let mut shares = self.shares.lock().map_err(|_| fail("STATE"))?;
        self.db
            .lock()
            .map_err(|_| fail("STORAGE"))?
            .save_local_setting(
                "pluginSharingEnabled",
                if enabled { "true" } else { "false" },
            )?;
        if !enabled {
            for (_, token) in shares.drain() {
                token.cancel();
            }
        }
        Ok(())
    }
    pub fn set_flags(
        &self,
        app: &AppHandle,
        key: &str,
        enabled: Option<bool>,
        shared: Option<bool>,
    ) -> Result<()> {
        let _gate = self
            .operation
            .clone()
            .try_lock_owned()
            .map_err(|_| fail("BUSY"))?;
        let mut shares = self.shares.lock().map_err(|_| fail("STATE"))?;
        let mut p = {
            self.db
                .lock()
                .map_err(|_| fail("STORAGE"))?
                .installed_plugin(key)?
        };
        if enabled == Some(true) && (!p.available || !p.manifest.compatible()) {
            return Err(fail("INCOMPATIBLE"));
        }
        if let Some(v) = enabled {
            p.enabled = v;
        }
        if let Some(v) = shared {
            p.shared = v;
        }
        self.db
            .lock()
            .map_err(|_| fail("STORAGE"))?
            .save_plugin(&p)?;
        if !p.shared {
            if let Some(token) = shares.remove(&p.sha256) {
                token.cancel();
            }
        }
        drop(shares);
        if !p.enabled {
            self.close_plugin(app, key);
        }
        self.notify(app);
        Ok(())
    }
    pub fn uninstall(&self, app: &AppHandle, key: &str, clear_data: bool) -> Result<()> {
        let _gate = self
            .operation
            .clone()
            .try_lock_owned()
            .map_err(|_| fail("BUSY"))?;
        let mut shares = self.shares.lock().map_err(|_| fail("STATE"))?;
        let p = {
            self.db
                .lock()
                .map_err(|_| fail("STORAGE"))?
                .installed_plugin(key)?
        };
        self.close_plugin(app, key);
        {
            let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
            db.workspace_transaction("plugin_uninstall", || {
                let scope = db.workspace_context()?;
                db.plugin_audit(&p, &scope, "uninstall", None, "uninstall", "ok")?;
                db.conn
                    .execute("DELETE FROM plugin_installs WHERE plugin_key=?", [key])
                    .map_err(|_| fail("STORAGE"))?;
                db.conn
                    .execute("DELETE FROM plugin_grants WHERE plugin_key=?", [key])
                    .map_err(|_| fail("STORAGE"))?;
                if clear_data {
                    db.conn
                        .execute("DELETE FROM plugin_storage WHERE plugin_key=?", [key])
                        .map_err(|_| fail("STORAGE"))?;
                }
                Ok(())
            })?;
        }
        if let Some(token) = shares.remove(&p.sha256) {
            token.cancel();
        }
        drop(shares);
        let _ = remove_managed(&self.root, &self.root.join("releases").join(&p.sha256));
        let _ = remove_managed(&self.root, &self.package_path(&p.sha256)?);
        if let Some(previous) = p.previous_sha256 {
            let _ = remove_managed(&self.root, &self.root.join("releases").join(&previous));
            let _ = remove_managed(&self.root, &self.package_path(&previous)?);
        }
        self.cleanup_unreferenced();
        self.notify(app);
        Ok(())
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key].as_str().ok_or_else(|| fail("ARGUMENTS"))
}
#[tauri::command]
pub async fn plugin_api(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    action: String,
    payload: Value,
) -> Result<Value> {
    if window.label() != "main" {
        return Err(fail("WINDOW"));
    }
    if crate::app_interface_locked(&app) {
        return Err("APP_LOCKED".into());
    }
    let rt = state.file_server.plugins.clone();
    match action.as_str() {
        "list" => rt.snapshot(),
        "market" => {
            let peers = state
                .network
                .lock()
                .map_err(|_| fail("STATE"))?
                .snapshot()
                .peers;
            Ok(json!(rt.refresh_market(peers).await?))
        }
        "install" => {
            let id = rt.download(
                app.clone(),
                text(&payload, "pluginKey")?,
                text(&payload, "sha256")?,
            )?;
            Ok(json!({"jobId":id}))
        }
        "import" => {
            let id = rt.import(app.clone(), PathBuf::from(text(&payload, "path")?))?;
            Ok(json!({"jobId":id}))
        }
        "cancel" => {
            rt.cancel_job(text(&payload, "jobId")?)?;
            Ok(Value::Null)
        }
        "sharing" => {
            rt.set_sharing(
                payload["enabled"]
                    .as_bool()
                    .ok_or_else(|| fail("ARGUMENTS"))?,
            )?;
            rt.notify(&app);
            Ok(Value::Null)
        }
        "flags" => {
            rt.set_flags(
                &app,
                text(&payload, "pluginKey")?,
                payload["enabled"].as_bool(),
                payload["shared"].as_bool(),
            )?;
            Ok(Value::Null)
        }
        "uninstall" => {
            rt.uninstall(
                &app,
                text(&payload, "pluginKey")?,
                payload["clearData"].as_bool().unwrap_or(false),
            )?;
            Ok(Value::Null)
        }
        "open" => rt.open(
            &app,
            text(&payload, "pluginKey")?,
            payload["theme"].clone(),
            payload["locale"].as_str().unwrap_or("zh-CN"),
        ),
        "appearance" => {
            rt.appearance(
                &app,
                payload["theme"].clone(),
                payload["locale"].as_str().unwrap_or("zh-CN"),
            )?;
            Ok(Value::Null)
        }
        "details" => {
            let db = rt.db.lock().map_err(|_| fail("STORAGE"))?;
            let scope = db.workspace_context()?;
            db.plugin_details(
                text(&payload, "pluginKey")?,
                &scope,
                payload["offset"].as_u64().unwrap_or(0),
            )
        }
        "pendingPermissions" => Ok(json!(rt.pending_permissions()?)),
        "permissionDecision" => {
            rt.decide(
                &app,
                text(&payload, "requestId")?,
                payload["allow"]
                    .as_bool()
                    .ok_or_else(|| fail("ARGUMENTS"))?,
            )?;
            Ok(Value::Null)
        }
        "revoke" => {
            rt.revoke(
                &app,
                text(&payload, "pluginKey")?,
                text(&payload, "capability")?,
            )?;
            Ok(Value::Null)
        }
        _ => Err(fail("METHOD")),
    }
}

#[cfg(test)]
mod tests;
