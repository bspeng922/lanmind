//! Plugin windows have no general app IPC or Tauri plugin capabilities.
use super::*;
use crate::workspace_scope::WorkspaceContext;
use rusqlite::params;
use std::collections::HashSet;
use tauri::{WebviewUrl, WebviewWindowBuilder};

pub const WINDOW_PREFIX: &str = "web-plugin-";
#[derive(Clone)]
pub(super) struct Session {
    pub plugin_key: String,
    pub sha256: String,
    pub scope: WorkspaceContext,
    pub locale: String,
    pub theme: Value,
    pub denied: HashSet<String>,
    pub requests: HashSet<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionNotice {
    pub request_id: String,
    pub plugin_key: String,
    pub name: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub user_id: String,
    pub capabilities: Vec<String>,
    pub created_at: String,
}
pub(super) struct PermissionRequest {
    notice: PermissionNotice,
    label: String,
    scope: WorkspaceContext,
    sha256: String,
    decision: tokio::sync::watch::Sender<Option<bool>>,
}
pub fn is_plugin_window(label: &str) -> bool {
    label.starts_with(WINDOW_PREFIX)
}
pub fn method_capabilities(method: &str) -> Result<Vec<&'static str>> {
    Ok(match method {
        "context.get" | "storage.get" | "storage.set" | "storage.delete" => vec![],
        "tasks.list" | "tasks.get" | "projects.list" | "states.list" => vec!["tasks.read"],
        "tasks.create" | "tasks.update" => vec!["tasks.read", "tasks.write"],
        "wiki.list" | "wiki.get" => vec!["wiki.read"],
        "wiki.create" | "wiki.update" => vec!["wiki.read", "wiki.write"],
        _ => return Err(fail("METHOD")),
    })
}
fn business_method(method: &str) -> Result<&'static str> {
    Ok(match method {
        "tasks.list" => "list_tasks",
        "tasks.get" => "get_task",
        "tasks.create" => "create_task",
        "tasks.update" => "update_task",
        "projects.list" => "list_projects",
        "states.list" => "list_states",
        "wiki.list" => "list_wiki_pages",
        "wiki.get" => "get_wiki_page",
        "wiki.create" => "create_wiki_page",
        "wiki.update" => "update_wiki_page",
        _ => return Err(fail("METHOD")),
    })
}
fn business_error(error: String) -> String {
    if error.starts_with("VERSION_CONFLICT") || error.starts_with("任务版本冲突") {
        fail("VERSION_CONFLICT")
    } else if error.starts_with("FEATURE_DISABLED") {
        fail("FEATURE_DISABLED")
    } else if error.starts_with("INVALID_ARGUMENTS") {
        fail("ARGUMENTS")
    } else {
        fail("BUSINESS")
    }
}
fn validate_session(db: &Database, session: &Session) -> Result<Installed> {
    db.validate_workspace_context(&session.scope)
        .map_err(|_| fail("SESSION"))?;
    let p = db.installed_plugin(&session.plugin_key)?;
    if !p.enabled || !p.available || p.sha256 != session.sha256 || !p.manifest.compatible() {
        return Err(fail("SESSION"));
    }
    let member = db
        .workspace_members(&session.scope.workspace_id)?
        .into_iter()
        .any(|m| m.user_id == session.scope.user_id && m.status == "member");
    if !member {
        return Err(fail("SESSION"));
    }
    Ok(p)
}
impl Runtime {
    fn session(&self, label: &str) -> Result<Session> {
        self.sessions
            .lock()
            .map_err(|_| fail("STATE"))?
            .get(label)
            .cloned()
            .ok_or_else(|| fail("SESSION"))
    }
    pub fn close_plugin(&self, app: &AppHandle, key: &str) {
        let labels: Vec<_> = self
            .sessions
            .lock()
            .map(|mut sessions| {
                let labels = sessions
                    .iter()
                    .filter(|(_, s)| s.plugin_key == key)
                    .map(|(label, _)| label.clone())
                    .collect::<Vec<_>>();
                for label in &labels {
                    sessions.remove(label);
                }
                labels
            })
            .unwrap_or_default();
        for label in labels {
            self.close_session(app, &label);
        }
    }
    pub fn close_all(&self, app: &AppHandle) {
        let labels = self
            .sessions
            .lock()
            .map(|mut sessions| sessions.drain().map(|(k, _)| k).collect::<Vec<_>>())
            .unwrap_or_default();
        for label in labels {
            self.close_session(app, &label);
        }
    }
    pub fn close_session(&self, app: &AppHandle, label: &str) {
        self.forget_session(app, label);
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
    fn forget_session(&self, app: &AppHandle, label: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(label);
        }
        if let Ok(mut pending) = self.permissions.lock() {
            pending.retain(|_, p| {
                if p.label == label {
                    let _ = p.decision.send(Some(false));
                    false
                } else {
                    true
                }
            });
        }
        let _ = app.emit_to("main", "plugins://permission-request", ());
    }
    pub fn pending_permissions(&self) -> Result<Vec<PermissionNotice>> {
        let mut requests = self
            .permissions
            .lock()
            .map_err(|_| fail("STATE"))?
            .values()
            .map(|p| p.notice.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(requests)
    }
    pub fn open(
        self: &Arc<Self>,
        app: &AppHandle,
        key: &str,
        theme: Value,
        locale: &str,
    ) -> Result<Value> {
        let _gate = self
            .operation
            .clone()
            .try_lock_owned()
            .map_err(|_| fail("BUSY"))?;
        let p = self
            .db
            .lock()
            .map_err(|_| fail("STORAGE"))?
            .installed_plugin(key)?;
        if !p.enabled || !p.available {
            return Err(fail("DISABLED"));
        }
        if !p.manifest.compatible() {
            return Err(fail("INCOMPATIBLE"));
        }
        self.close_plugin(app, key);
        let hash = p.sha256.clone();
        let archive = self.package_path(&hash)?;
        if file_digest(&archive)? != hash {
            return Err(fail("HASH"));
        }
        let release = self.root.join("releases").join(&hash);
        // Verify extracted files on every launch; application code is immutable.
        if !release.is_dir() {
            directory(&release)?;
            inspect(&archive, Some(&release), &CancellationToken::new())?;
        }
        for (relative, expected) in &p.manifest.files {
            let file = release.join(relative);
            if !io(file.canonicalize())?.starts_with(io(release.canonicalize())?)
                || file_digest(&file)? != *expected
            {
                return Err(fail("HASH"));
            }
        }
        let scope = self
            .db
            .lock()
            .map_err(|_| fail("STORAGE"))?
            .workspace_context()?;
        let label = format!("{WINDOW_PREFIX}{}", uuid::Uuid::new_v4().simple());
        let token = label
            .strip_prefix(WINDOW_PREFIX)
            .unwrap_or_default()
            .to_string();
        let session = Session {
            plugin_key: key.into(),
            sha256: hash,
            scope,
            locale: locale.chars().take(30).collect(),
            theme: sanitize_theme(theme),
            denied: HashSet::new(),
            requests: HashSet::new(),
        };
        let url = resource_url(&token, &p.manifest.entry)?;
        let profile = self.root.join("profiles").join(&token);
        directory(&profile)?;
        self.sessions
            .lock()
            .map_err(|_| fail("STATE"))?
            .insert(label.clone(), session);
        let native_label = label.clone();
        let native_app = app.clone();
        let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
            .title(p.manifest.name(locale))
            .inner_size(1080., 760.)
            .min_inner_size(560., 400.)
            .incognito(true)
            .data_directory(profile.clone())
            .initialization_script_for_all_frames(include_str!("isolation.js"))
            .initialization_script(include_str!("sdk.js"))
            .disable_drag_drop_handler()
            .on_navigation(move |url| allowed_navigation(url, &token))
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false);
        match builder.build() {
            Ok(window) => {
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        let state = native_app.state::<AppState>();
                        state
                            .file_server
                            .plugins
                            .forget_session(&native_app, &native_label);
                        if let Some(token) = native_label.strip_prefix(WINDOW_PREFIX) {
                            let rt = &state.file_server.plugins;
                            let _ = remove_managed(&rt.root, &rt.root.join("profiles").join(token));
                        }
                    }
                });
                Ok(json!({"window":label}))
            }
            Err(_) => {
                self.close_session(app, &label);
                let _ = remove_managed(&self.root, &profile);
                Err(fail("RUNTIME"))
            }
        }
    }
    pub fn appearance(&self, app: &AppHandle, theme: Value, locale: &str) -> Result<()> {
        let theme = sanitize_theme(theme);
        let mut sessions = self.sessions.lock().map_err(|_| fail("STATE"))?;
        for (label, session) in sessions.iter_mut() {
            session.theme = theme.clone();
            session.locale = locale.chars().take(30).collect();
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.eval("window.dispatchEvent(new Event('lanmind:appearance')); ");
            }
        }
        Ok(())
    }
    pub fn decide(&self, app: &AppHandle, id: &str, allow: bool) -> Result<()> {
        let pending = self
            .permissions
            .lock()
            .map_err(|_| fail("STATE"))?
            .remove(id)
            .ok_or_else(|| fail("SESSION"))?;
        let result = (|| {
            let session = self.session(&pending.label)?;
            if session.scope != pending.scope || session.sha256 != pending.sha256 {
                return Err(fail("SESSION"));
            }
            let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
            let plugin = validate_session(&db, &session)?;
            db.workspace_transaction("plugin_grant", || {
                for capability in &pending.notice.capabilities {
                    if !plugin.manifest.capabilities.contains(capability) {
                        return Err(fail("PERMISSION"));
                    }
                    if allow {
                        db.conn
                            .execute(
                                "INSERT OR IGNORE INTO plugin_grants VALUES(?,?,?,?)",
                                params![
                                    plugin.plugin_key,
                                    session.scope.workspace_id,
                                    session.scope.user_id,
                                    capability
                                ],
                            )
                            .map_err(|_| fail("STORAGE"))?;
                    }
                    db.plugin_audit(
                        &plugin,
                        &session.scope,
                        if allow { "grant" } else { "deny" },
                        Some(capability),
                        id,
                        "ok",
                    )?;
                }
                Ok(())
            })?;
            Ok(())
        })();
        if !allow {
            if let Ok(mut sessions) = self.sessions.lock() {
                if let Some(session) = sessions.get_mut(&pending.label) {
                    session
                        .denied
                        .extend(pending.notice.capabilities.iter().cloned());
                }
            }
        }
        let _ = pending.decision.send(Some(allow && result.is_ok()));
        self.notify(app);
        let _ = app.emit_to("main", "plugins://permission-request", ());
        result
    }
    pub fn revoke(&self, app: &AppHandle, key: &str, capability: &str) -> Result<()> {
        if !CAPABILITIES.contains(&capability) {
            return Err(fail("ARGUMENTS"));
        }
        {
            let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
            let p = db.installed_plugin(key)?;
            let scope = db.workspace_context()?;
            db.workspace_transaction("plugin_revoke",||{
                let write=if capability.ends_with(".read"){Some(capability.replace(".read",".write"))}else{None};
                db.conn.execute("DELETE FROM plugin_grants WHERE plugin_key=? AND workspace_id=? AND user_id=? AND (capability=? OR capability=?)",params![key,scope.workspace_id,scope.user_id,capability,write]).map_err(|_|fail("STORAGE"))?;
                db.plugin_audit(&p,&scope,"revoke",Some(capability),"revoke","ok")
            })?;
        }
        self.close_plugin(app, key);
        self.notify(app);
        Ok(())
    }
    async fn authorize(&self, app: &AppHandle, label: &str, required: &[&str]) -> Result<()> {
        if required.is_empty() {
            return Ok(());
        }
        let session = self.session(label)?;
        let (plugin, missing, workspace_name) = {
            let db = self.db.lock().map_err(|_| fail("STORAGE"))?;
            let p = validate_session(&db, &session)?;
            if required
                .iter()
                .any(|c| !p.manifest.capabilities.iter().any(|v| v == c))
            {
                return Err(fail("PERMISSION"));
            }
            let grants = db.plugin_grants(&p.plugin_key, &session.scope)?;
            let missing: Vec<String> = required
                .iter()
                .filter(|c| !grants.iter().any(|g| g == **c))
                .map(|s| s.to_string())
                .collect();
            (p, missing, db.workspace()?.1)
        };
        if missing.is_empty() {
            return Ok(());
        }
        if missing.iter().any(|c| session.denied.contains(c)) {
            return Err(fail("PERMISSION_DENIED"));
        }
        let (id, mut receiver) = {
            let mut pending = self.permissions.lock().map_err(|_| fail("STATE"))?;
            if let Some((id, request)) = pending
                .iter()
                .find(|(_, p)| p.label == label && p.notice.capabilities == missing)
            {
                (id.clone(), request.decision.subscribe())
            } else {
                if pending.len() >= 32 {
                    return Err(fail("BUSY"));
                }
                let id = uuid::Uuid::new_v4().to_string();
                let (decision, receiver) = tokio::sync::watch::channel(None);
                let notice = PermissionNotice {
                    request_id: id.clone(),
                    plugin_key: plugin.plugin_key.clone(),
                    name: plugin.manifest.name(&session.locale),
                    workspace_id: session.scope.workspace_id.clone(),
                    workspace_name,
                    user_id: session.scope.user_id.clone(),
                    capabilities: missing,
                    created_at: chrono::Utc::now().to_rfc3339(),
                };
                pending.insert(
                    id.clone(),
                    PermissionRequest {
                        notice,
                        label: label.into(),
                        scope: session.scope.clone(),
                        sha256: session.sha256.clone(),
                        decision,
                    },
                );
                (id, receiver)
            }
        };
        let _ = app.emit_to("main", "plugins://permission-request", ());
        crate::show_main_window(app);
        let wait = async {
            loop {
                if let Some(allow) = *receiver.borrow_and_update() {
                    return allow;
                }
                if receiver.changed().await.is_err() {
                    return false;
                }
            }
        };
        let allow = tokio::time::timeout(std::time::Duration::from_secs(300), wait)
            .await
            .unwrap_or(false);
        if let Ok(mut pending) = self.permissions.lock() {
            pending.remove(&id);
        }
        let _ = app.emit_to("main", "plugins://permission-request", ());
        if allow {
            Ok(())
        } else {
            Err(fail("PERMISSION_DENIED"))
        }
    }
}
pub(super) fn resource_url(token: &str, entry: &str) -> Result<tauri::Url> {
    let mut url: tauri::Url = format!("lanmind-plugin://localhost/{token}/")
        .parse()
        .map_err(|_| fail("PATH"))?;
    url.path_segments_mut()
        .map_err(|_| fail("PATH"))?
        .pop_if_empty()
        .extend(entry.split('/'));
    Ok(url)
}
pub fn allowed_navigation(url: &tauri::Url, token: &str) -> bool {
    let local = match url.scheme() {
        "lanmind-plugin" => url.host_str() == Some("localhost"),
        "http" => url.host_str() == Some("lanmind-plugin.localhost"),
        _ => false,
    };
    local
        && url.path().starts_with(&format!("/{token}/"))
        && url.query().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}
fn sanitize_theme(theme: Value) -> Value {
    let mut colors = serde_json::Map::new();
    for name in [
        "--bg-canvas",
        "--bg-surface",
        "--bg-card",
        "--text-main",
        "--text-sub",
        "--text-quiet",
        "--border-main",
        "--accent",
    ] {
        if let Some(value) = theme["colors"][name]
            .as_str()
            .filter(|v| v.len() < 100 && !v.contains([';', '{', '}', '<', '>']))
        {
            colors.insert(name.into(), json!(value));
        }
    }
    json!({"id":if theme["id"]=="light"{"light"}else{"dark"},"colors":colors})
}
pub fn serve_resource(
    app: &AppHandle,
    label: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let resource = (|| -> Result<(Vec<u8>, String)> {
        if !is_plugin_window(label) || !matches!(request.method().as_str(), "GET" | "HEAD") {
            return Err(fail("PATH"));
        }
        let state = app.state::<AppState>();
        let rt = &state.file_server.plugins;
        let session = rt.session(label)?;
        if state.app_lock.status().map_err(|_| fail("STATE"))?.locked {
            return Err(fail("SESSION"));
        }
        let plugin = {
            let db = rt.db.lock().map_err(|_| fail("STORAGE"))?;
            validate_session(&db, &session)?
        };
        let token = label
            .strip_prefix(WINDOW_PREFIX)
            .ok_or_else(|| fail("PATH"))?;
        let encoded = request
            .uri()
            .path()
            .strip_prefix(&format!("/{token}/"))
            .ok_or_else(|| fail("PATH"))?;
        let path = percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .map_err(|_| fail("PATH"))?;
        if !safe_relative(&path) || !plugin.manifest.files.contains_key(path.as_ref()) {
            return Err(fail("PATH"));
        }
        let root = rt.root.join("releases").join(&plugin.sha256);
        let file = root.join(path.as_ref());
        if !io(file.canonicalize())?.starts_with(io(root.canonicalize())?) {
            return Err(fail("PATH"));
        }
        let bytes = io(fs::read(&file))?;
        if digest(&bytes) != plugin.manifest.files[path.as_ref()] {
            return Err(fail("HASH"));
        }
        let mime = match file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
        {
            "html" => "text/html; charset=utf-8",
            "js" | "mjs" => "text/javascript; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "json" => "application/json",
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "woff" => "font/woff",
            "woff2" => "font/woff2",
            _ => "application/octet-stream",
        };
        Ok((
            if request.method() == tauri::http::Method::HEAD {
                Vec::new()
            } else {
                bytes
            },
            mime.into(),
        ))
    })();
    match resource{
        Ok((body,mime))=>tauri::http::Response::builder().header("Content-Type",mime).header("X-Content-Type-Options","nosniff").header("Cache-Control","no-store")
            .header("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            .header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), bluetooth=(), hid=(), clipboard-read=(), clipboard-write=()")
            .body(body).unwrap(),
        Err(_)=>tauri::http::Response::builder().status(403).body(Vec::new()).unwrap(),
    }
}
#[tauri::command]
pub async fn plugin_bridge(
    app: AppHandle,
    window: tauri::WebviewWindow,
    method: String,
    payload: Value,
    request_id: String,
) -> Result<Value> {
    let label = window.label().to_string();
    if !is_plugin_window(&label) {
        return Err(fail("WINDOW"));
    }
    if request_id.is_empty()
        || request_id.len() > 128
        || payload.to_string().len() > 2 * 1024 * 1024
    {
        return Err(fail("ARGUMENTS"));
    }
    let required = method_capabilities(&method)?;
    if crate::app_interface_locked(&app) {
        return Err("APP_LOCKED".into());
    }
    let state = app.state::<AppState>();
    let rt = state.file_server.plugins.clone();
    {
        let mut sessions = rt.sessions.lock().map_err(|_| fail("STATE"))?;
        let session = sessions.get_mut(&label).ok_or_else(|| fail("SESSION"))?;
        if session.requests.len() >= 4096 {
            return Err(fail("SESSION_LIMIT"));
        }
        if !session.requests.insert(request_id.clone()) {
            return Err(fail("DUPLICATE_REQUEST"));
        }
    }
    rt.authorize(&app, &label, &required).await?;
    if crate::app_interface_locked(&app) {
        return Err("APP_LOCKED".into());
    }
    let session = rt.session(&label)?;
    let db = rt.db.lock().map_err(|_| fail("STORAGE"))?;
    let result = execute_authorized(
        &db,
        &session,
        &method,
        payload,
        &format!("{label}:{request_id}"),
    );
    drop(db);
    if result.is_ok() && (method.ends_with(".create") || method.ends_with(".update")) {
        if method.starts_with("tasks.") {
            crate::emit_tasks_changed(&app, "plugin", None);
        }
        let _ = app.emit(
            "sync://operation",
            json!({"source":"plugin","workspaceId":session.scope.workspace_id}),
        );
    }
    result
}

pub(super) fn execute_authorized(
    db: &Database,
    session: &Session,
    method: &str,
    payload: Value,
    request_id: &str,
) -> Result<Value> {
    let required = method_capabilities(method)?;
    let plugin = validate_session(db, session)?;
    if required.iter().any(|c| {
        !plugin
            .manifest
            .capabilities
            .iter()
            .any(|declared| declared == c)
    }) {
        return Err(fail("PERMISSION"));
    }
    let grants = db.plugin_grants(&plugin.plugin_key, &session.scope)?;
    if required.iter().any(|c| !grants.iter().any(|g| g == c)) {
        return Err(fail("PERMISSION"));
    }
    if method == "context.get" {
        return Ok(
            json!({"sdkVersion":1,"pluginKey":plugin.plugin_key,"workspaceId":session.scope.workspace_id,"workspaceName":db.workspace()?.1,"userId":session.scope.user_id,"locale":session.locale,"theme":session.theme}),
        );
    }
    if method.starts_with("storage.") {
        return db.plugin_storage_call(&plugin.plugin_key, &session.scope, &method, &payload);
    }
    let business = business_method(method)?;
    let write = method.ends_with(".create") || method.ends_with(".update");
    let result = db.workspace_transaction("plugin_business", || {
        let value = crate::mcp::ai_execute(db, &session.scope.user_id, business, payload.clone())
            .map_err(business_error)?;
        if write {
            let target = value["task"]["id"]
                .as_str()
                .or_else(|| value["page"]["id"].as_str());
            db.plugin_audit(&plugin, &session.scope, &method, target, request_id, "ok")?;
        }
        Ok(value)
    });
    if result.is_err() && write {
        let _ = db.plugin_audit(
            &plugin,
            &session.scope,
            &method,
            None,
            &request_id,
            "rejected",
        );
    }
    result
}
