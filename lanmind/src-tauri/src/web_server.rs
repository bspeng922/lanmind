//! Password-protected browser access using the current desktop user's permissions.

use crate::db::Database;
use crate::file_server::sanitize_filename;
use crate::models::{WebConfig, WebStatus};
use argon2::{
    password_hash::{rand_core::OsRng as PasswordOsRng, PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use axum::{
    body::Body,
    extract::{ConnectInfo, Path as AxumPath, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use tauri::Emitter;

const SESSION_COOKIE: &str = "lanmind_session";
const SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const LOGIN_WINDOW: Duration = Duration::from_secs(5 * 60);
const MAX_LOGIN_FAILURES: u8 = 8;

#[derive(Clone)]
pub struct WebRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    db: Arc<Mutex<Database>>,
    storage_root: PathBuf,
    app: tauri::AppHandle,
    state: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    running: bool,
    bind_address: String,
    port: u16,
    cancellation: Option<CancellationToken>,
    server_task: Option<tauri::async_runtime::JoinHandle<()>>,
    error: Option<String>,
    generation: u64,
}

#[derive(Clone)]
struct WebAppState {
    db: Arc<Mutex<Database>>,
    password_hash: Arc<String>,
    sessions: Arc<Mutex<HashMap<String, Instant>>>,
    login_failures: Arc<Mutex<HashMap<IpAddr, LoginFailures>>>,
    storage_root: PathBuf,
    app: Option<tauri::AppHandle>,
    read_only: bool,
}

struct LoginFailures {
    count: u8,
    started_at: Instant,
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = crate::i18n::describe_message(&self.1)
            .and_then(|message| serde_json::to_value(message).ok()).unwrap_or_else(|| json!({}));
        body["error"] = json!(self.1);
        (self.0, Json(body)).into_response()
    }
}

impl WebRuntime {
    pub fn new(db: Arc<Mutex<Database>>, storage_root: PathBuf, app: tauri::AppHandle) -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                db,
                storage_root,
                app,
                state: Mutex::new(RuntimeState::default()),
            }),
        }
    }

    pub async fn apply(&self, config: WebConfig) -> Result<(), String> {
        if !config.enabled {
            self.stop(&config.bind_address, config.port).await?;
            return Ok(());
        }
        if config.password_hash.trim().is_empty() {
            return Err("启用 Web 服务前必须设置访问密码".into());
        }

        let was_running = self
            .inner
            .state
            .lock()
            .map_err(|_| "Web 服务状态不可用")?
            .running;
        if was_running {
            self.stop(&config.bind_address, config.port).await?;
        }

        let listener = tokio::net::TcpListener::bind((config.bind_address.as_str(), config.port))
            .await
            .map_err(|error| format!("无法监听 Web 服务端口 {}: {error}", config.port))?;
        let cancellation = CancellationToken::new();
        let app_state = WebAppState {
            db: self.inner.db.clone(),
            password_hash: Arc::new(config.password_hash.clone()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            login_failures: Arc::new(Mutex::new(HashMap::new())),
            storage_root: self.inner.storage_root.clone(),
            app: Some(self.inner.app.clone()),
            read_only: config.read_only,
        };

        let router = app_router(app_state);

        let (generation, previous_cancellation, previous_task) = {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| "Web 服务状态不可用")?;
            let previous_cancellation = state.cancellation.replace(cancellation.clone());
            let previous_task = state.server_task.take();
            state.running = true;
            state.bind_address = config.bind_address.clone();
            state.port = config.port;
            state.error = None;
            state.generation = state.generation.wrapping_add(1);
            (state.generation, previous_cancellation, previous_task)
        };
        if let Some(previous) = previous_cancellation {
            previous.cancel();
        }
        if let Some(previous_task) = previous_task {
            let _ = previous_task.await;
        }

        let inner = self.inner.clone();
        let server_task = tauri::async_runtime::spawn(async move {
            let result = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move { cancellation.cancelled_owned().await })
            .await;
            if let Ok(mut state) = inner.state.lock() {
                if state.generation == generation {
                    state.running = false;
                    state.cancellation = None;
                    state.error = result.err().map(|error| error.to_string());
                }
            }
        });
        if let Ok(mut state) = self.inner.state.lock() {
            if state.generation == generation && state.running {
                state.server_task = Some(server_task);
            }
        }
        Ok(())
    }

    async fn stop(&self, bind_address: &str, port: u16) -> Result<(), String> {
        let (cancellation, server_task) = {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| "Web 服务状态不可用")?;
            let cancellation = state.cancellation.take();
            let server_task = state.server_task.take();
            state.running = false;
            state.bind_address = bind_address.to_string();
            state.port = port;
            state.error = None;
            state.generation = state.generation.wrapping_add(1);
            (cancellation, server_task)
        };
        if let Some(cancellation) = cancellation {
            cancellation.cancel();
        }
        if let Some(server_task) = server_task {
            let _ = server_task.await;
        }
        Ok(())
    }

    pub fn status(&self, config: WebConfig) -> WebStatus {
        let (running, error) = self
            .inner
            .state
            .lock()
            .map(|state| (state.running, state.error.clone()))
            .unwrap_or_else(|_| (false, Some("Web 服务状态不可用".into())));
        let host = if config.bind_address == "0.0.0.0" {
            local_ip_address::local_ip()
                .map(|address| address.to_string())
                .unwrap_or_else(|_| "127.0.0.1".into())
        } else {
            config.bind_address.clone()
        };
        WebStatus {
            read_only: config.read_only,
            enabled: config.enabled,
            bind_address: config.bind_address,
            port: config.port,
            password_configured: !config.password_hash.trim().is_empty(),
            running,
            endpoint: format!("http://{host}:{}", config.port),
            error,
        }
    }
}

fn app_router(state: WebAppState) -> Router {
    let protected = Router::new()
        .route("/api/session/logout", post(logout))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/projects", get(projects))
        .route("/api/tasks", get(tasks).post(create_task))
        .route("/api/tasks/save-with-children", post(save_task))
        .route("/api/tasks/{task_id}", axum::routing::put(update_task).delete(delete_task))
        .route("/api/tasks/{task_id}/comments", get(task_comments).post(create_comment))
        .route("/api/task-comments/{comment_id}", axum::routing::delete(delete_comment))
        .route("/api/tasks/{task_id}/activity", get(task_activity))
        .route("/api/projects/{project_id}/files/{file_id}", get(project_file))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_session));
    Router::new().route("/", get(index)).route("/network.html", get(index))
        .route("/assets/{*path}", get(asset)).route("/api/session", post(login))
        .merge(protected).layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024)).with_state(state)
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let password = password.trim();
    if !(8..=128).contains(&password.chars().count()) {
        return Err("访问密码长度必须在 8 到 128 个字符之间".into());
    }
    let salt = SaltString::generate(&mut PasswordOsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("无法保存访问密码: {error}"))
}

async fn index(State(state): State<WebAppState>) -> Response {
    asset_response(&state, "network.html")
}

async fn asset(State(state): State<WebAppState>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.contains("..") || !path.starts_with("assets/") { return StatusCode::NOT_FOUND.into_response(); }
    asset_response(&state, path)
}

fn asset_response(state: &WebAppState, path: &str) -> Response {
    let Some(asset) = state.app.as_ref().and_then(|app| app.asset_resolver().get(path.to_string())) else { return (StatusCode::NOT_FOUND, "网络伺服页面未构建").into_response(); };
    let mut response = Response::new(Body::from(asset.bytes));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_str(&asset.mime_type).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob: https: http:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ),
    );
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    response
}

async fn login(
    State(state): State<WebAppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    ensure_same_origin(&headers)?;
    if payload.password.chars().count() > 128 {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "访问密码不正确".into()));
    }
    check_login_limit(&state, remote.ip())?;
    let password_hash = state.password_hash.to_string();
    let password = payload.password;
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&password_hash)
            .ok()
            .is_some_and(|hash| Argon2::default().verify_password(password.as_bytes(), &hash).is_ok())
    })
    .await
    .unwrap_or(false);
    if !valid {
        record_login_failure(&state, remote.ip());
        return Err(ApiError(StatusCode::UNAUTHORIZED, "访问密码不正确".into()));
    }
    if let Ok(mut failures) = state.login_failures.lock() {
        failures.remove(&remote.ip());
    }

    let token = random_token();
    state
        .sessions
        .lock()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "会话服务暂不可用".into()))?
        .insert(token.clone(), Instant::now() + SESSION_TTL);
    let mut response = Json(json!({ "authenticated": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}",
            SESSION_TTL.as_secs()
        ))
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "无法创建会话".into()))?,
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn logout(State(state): State<WebAppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token(&headers) {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.remove(token);
        }
    }
    let mut response = Json(json!({ "authenticated": false })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "lanmind_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        ),
    );
    response
}

async fn require_session(
    State(state): State<WebAppState>,
    request: Request,
    next: Next,
) -> Response {
    if ensure_same_origin(request.headers()).is_err() || !has_valid_session(&state, request.headers()) {
        return ApiError(StatusCode::UNAUTHORIZED, "请先登录".into()).into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn bootstrap(State(state): State<WebAppState>) -> Result<Json<Value>, ApiError> {
    read(&state, |db, user_id| {
        let (workspace_id, workspace_name) = db.workspace()?;
        let current_user = db
            .users()?
            .into_iter()
            .find(|user| user.id == user_id)
            .ok_or_else(|| "当前桌面用户不存在".to_string())?;
        let projects = db.projects(Some(user_id))?;
        let tasks = db.tasks(Some(user_id))?;
        let mut visible_user_ids = HashSet::from([user_id.to_string()]);
        for project in &projects {
            visible_user_ids.insert(project.created_by.clone());
            visible_user_ids.extend(project.admins.iter().cloned());
            visible_user_ids.extend(project.members.iter().cloned());
        }
        for task in &tasks {
            visible_user_ids.insert(task.creator_id.clone());
            visible_user_ids.insert(task.assignee_id.clone());
            visible_user_ids.extend(task.shared_with.iter().cloned());
        }
        let users = db
            .users()?
            .into_iter()
            .filter(|user| visible_user_ids.contains(&user.id))
            .collect::<Vec<_>>();
        Ok(json!({
            "workspaceId": workspace_id,
            "workspaceName": workspace_name,
            "currentUser": current_user,
            "users": users,
            "projects": projects,
            "readOnly": state.read_only
        }))
    })
    .map(Json)
}

async fn projects(State(state): State<WebAppState>) -> Result<Json<Value>, ApiError> {
    read(&state, |db, user_id| serde_json::to_value(db.projects(Some(user_id))?).map_err(|error| error.to_string()))
        .map(Json)
}

async fn tasks(State(state): State<WebAppState>) -> Result<Json<Value>, ApiError> {
    read(&state, |db, user_id| serde_json::to_value(db.tasks(Some(user_id))?).map_err(|error| error.to_string()))
        .map(Json)
}

fn write<T>(state: &WebAppState, operation: impl FnOnce(&Database, &str) -> Result<T, String>) -> Result<T, ApiError> {
    if state.read_only { return Err(ApiError(StatusCode::FORBIDDEN, "网络伺服当前为只读模式".into())); }
    let result = read(state, operation)?;
    if let Some(app) = &state.app { let _ = app.emit("tasks://changed", json!({"reason": "network"})); }
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    id: Option<String>,
    task: Value,
    #[serde(default)]
    child_tasks: Vec<Value>,
    #[serde(default)]
    detached_child_ids: Vec<String>,
    expected_version: Option<i64>,
}

async fn save_task(State(state): State<WebAppState>, Json(payload): Json<SaveRequest>) -> Result<Json<Value>, ApiError> {
    write(&state, |db, user| serde_json::to_value(db.save_task_with_children(payload.id.as_deref(), payload.task, payload.child_tasks, payload.detached_child_ids, user, payload.expected_version)?).map_err(|e| e.to_string())).map(Json)
}
async fn create_task(State(state): State<WebAppState>, Json(task): Json<Value>) -> Result<Json<Value>, ApiError> {
    write(&state, |db, user| serde_json::to_value(db.create_task(task, user)?).map_err(|e| e.to_string())).map(Json)
}
async fn update_task(State(state): State<WebAppState>, AxumPath(id): AxumPath<String>, Json(updates): Json<Value>) -> Result<Json<Value>, ApiError> {
    write(&state, |db, user| serde_json::to_value(db.update_task_with_recurrence(&id, updates, user, None)?.task).map_err(|e| e.to_string())).map(Json)
}
async fn delete_task(State(state): State<WebAppState>, AxumPath(id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    write(&state, |db, user| Ok(json!({"success": db.delete_task_and_detach_children(&id, user)?}))).map(Json)
}
async fn create_comment(State(state): State<WebAppState>, AxumPath(id): AxumPath<String>, Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    let content = payload.get("content").and_then(Value::as_str).unwrap_or_default();
    let reply_to_comment_id = payload.get("replyToCommentId").and_then(Value::as_str);
    write(&state, |db, user| serde_json::to_value(db.create_task_comment_reply(&id, content, user, reply_to_comment_id)?).map_err(|e| e.to_string())).map(Json)
}
async fn delete_comment(State(state): State<WebAppState>, AxumPath(id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    write(&state, |db, user| Ok(json!({"success": db.delete_task_comment(&id, user)?}))).map(Json)
}

async fn task_comments(
    State(state): State<WebAppState>,
    AxumPath(task_id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    read(&state, |db, user_id| serde_json::to_value(db.task_comments(&task_id, user_id)?).map_err(|error| error.to_string()))
        .map(Json)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityPageQuery {
    page: Option<i64>,
    page_size: Option<i64>,
    snapshot: Option<i64>,
}

async fn task_activity(
    State(state): State<WebAppState>,
    AxumPath(task_id): AxumPath<String>,
    Query(query): Query<ActivityPageQuery>,
) -> Result<Json<Value>, ApiError> {
    read(&state, |db, user_id| {
        if let Some(page) = query.page {
            serde_json::to_value(db.task_activity_page(&task_id, user_id, page, query.page_size.unwrap_or(20), query.snapshot)?)
        } else {
            serde_json::to_value(db.task_activity(&task_id, user_id)?)
        }.map_err(|error| error.to_string())
    })
        .map(Json)
}

async fn project_file(
    State(state): State<WebAppState>,
    AxumPath((project_id, file_id)): AxumPath<(String, String)>,
) -> Result<Response, ApiError> {
    let file = read(&state, |db, user_id| {
        if !db
            .projects(Some(user_id))?
            .iter()
            .any(|project| project.id == project_id)
        {
            return Err("没有查看该项目文件的权限".into());
        }
        db.project_file_by_id(&file_id)?
            .filter(|file| file.project_id == project_id)
            .ok_or_else(|| "文件不存在".into())
    })?;
    let path = state
        .storage_root
        .join(sanitize_filename(&project_id))
        .join(sanitize_filename(&file_id));
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, "文件尚未下载到本机".into()))?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&file.mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=lanmind-file"),
    );
    Ok(response)
}

fn read<T>(
    state: &WebAppState,
    operation: impl FnOnce(&Database, &str) -> Result<T, String>,
) -> Result<T, ApiError> {
    let db = state
        .db
        .lock()
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "本地数据库正忙".into()))?;
    let user_id = db
        .current_user_id()
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    operation(&db, &user_id).map_err(|error| ApiError(StatusCode::FORBIDDEN, error))
}

fn ensure_same_origin(headers: &HeaderMap) -> Result<(), ApiError> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(());
    };
    let origin = origin
        .to_str()
        .map_err(|_| ApiError(StatusCode::FORBIDDEN, "请求来源无效".into()))?;
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let authority = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .and_then(|value| value.split('/').next())
        .unwrap_or_default();
    if authority == host {
        Ok(())
    } else {
        Err(ApiError(StatusCode::FORBIDDEN, "请求来源无效".into()))
    }
}

fn has_valid_session(state: &WebAppState, headers: &HeaderMap) -> bool {
    let Some(token) = session_token(headers) else {
        return false;
    };
    let Ok(mut sessions) = state.sessions.lock() else {
        return false;
    };
    let now = Instant::now();
    sessions.retain(|_, expires_at| *expires_at > now);
    sessions.get(token).is_some_and(|expires_at| *expires_at > now)
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|cookie| cookie.strip_prefix(&format!("{SESSION_COOKIE}=")))
}

fn check_login_limit(state: &WebAppState, ip: IpAddr) -> Result<(), ApiError> {
    let mut failures = state
        .login_failures
        .lock()
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "登录服务暂不可用".into()))?;
    let now = Instant::now();
    failures.retain(|_, item| now.duration_since(item.started_at) < LOGIN_WINDOW);
    if failures.get(&ip).is_some_and(|item| item.count >= MAX_LOGIN_FAILURES) {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "尝试次数过多，请稍后再试".into(),
        ));
    }
    Ok(())
}

fn record_login_failure(state: &WebAppState, ip: IpAddr) {
    if let Ok(mut failures) = state.login_failures.lock() {
        let item = failures.entry(ip).or_insert(LoginFailures {
            count: 0,
            started_at: Instant::now(),
        });
        item.count = item.count.saturating_add(1);
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}



#[cfg(test)]
mod tests {
    use super::*;

    async fn server(read_only: bool) -> (String, Arc<Mutex<Database>>, tokio::task::JoinHandle<()>) {
        let db = Arc::new(Mutex::new(Database::open(std::path::Path::new(":memory:")).unwrap()));
        let state = WebAppState {
            db: db.clone(), password_hash: Arc::new(hash_password("correct-password").unwrap()),
            sessions: Arc::new(Mutex::new(HashMap::new())), login_failures: Arc::new(Mutex::new(HashMap::new())),
            storage_root: PathBuf::new(), app: None, read_only,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app_router(state).into_make_service_with_connect_info::<SocketAddr>()).await.unwrap(); });
        (address, db, task)
    }

    async fn login_cookie(client: &reqwest::Client, url: &str) -> String {
        let response = client.post(format!("{url}/api/session")).json(&json!({"password": "correct-password"})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap().split(';').next().unwrap().to_string()
    }

    #[tokio::test]
    async fn read_only_network_rejects_writes_and_requires_a_same_origin_session() {
        let (url, db, server) = server(true).await;
        let client = reqwest::Client::new();
        assert_eq!(client.get(format!("{url}/api/tasks")).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let cookie = login_cookie(&client, &url).await;
        let boot: Value = client.get(format!("{url}/api/bootstrap")).header(header::COOKIE, &cookie).send().await.unwrap().json().await.unwrap();
        assert_eq!(boot["readOnly"], true);
        for (method, path, payload) in [
            (reqwest::Method::POST, "/api/tasks", json!({})),
            (reqwest::Method::POST, "/api/tasks/save-with-children", json!({"task": {}})),
            (reqwest::Method::PUT, "/api/tasks/missing", json!({"title": "越权"})),
            (reqwest::Method::DELETE, "/api/tasks/missing", json!({})),
            (reqwest::Method::POST, "/api/tasks/missing/comments", json!({"content": "越权", "replyToCommentId": "original"})),
            (reqwest::Method::DELETE, "/api/task-comments/missing", json!({})),
        ] {
            assert_eq!(client.request(method, format!("{url}{path}")).header(header::COOKIE, &cookie).json(&payload).send().await.unwrap().status(), StatusCode::FORBIDDEN);
        }
        assert_eq!(client.get(format!("{url}/api/tasks")).header(header::COOKIE, &cookie).header(header::ORIGIN, "http://outside.example").send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
        assert!(db.lock().unwrap().tasks(None).unwrap().is_empty());
        server.abort();
    }

    #[tokio::test]
    async fn editable_network_saves_atomic_task_family_as_the_local_user() {
        let (url, db, server) = server(false).await;
        let client = reqwest::Client::new();
        let cookie = login_cookie(&client, &url).await;
        let operator = db.lock().unwrap().current_user_id().unwrap();
        let draft = json!({"title": "网络主任务", "description": "说明", "priority": "P3", "status": "todo", "creatorId": "forged-user", "assigneeId": operator, "projectId": null, "isShared": false, "sharedWith": [], "subtasks": [], "tags": [], "attachments": [{"id": "image", "name": "图片.png", "size": 1, "type": "image/png", "dataUrl": "data:image/png;base64,AQ==", "addedAt": "2026-09-30T00:00:00Z"}]});
        let response = client.post(format!("{url}/api/tasks/save-with-children")).header(header::COOKIE, &cookie).header("x-user-id", "forged-user").json(&json!({"task": draft, "childTasks": [{"title": "网络子任务", "description": "", "priority": "P4", "status": "todo", "assigneeId": operator, "dueDate": null}]})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let parent: Value = response.json().await.unwrap();
        assert_eq!(parent["creatorId"], operator);
        assert_eq!(parent["attachments"][0]["name"], "图片.png");
        let id = parent["id"].as_str().unwrap();
        let response = client.put(format!("{url}/api/tasks/{id}")).header(header::COOKIE, &cookie).json(&json!({"status": "completed"})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(db.lock().unwrap().tasks(None).unwrap().len(), 2);
        let response = client.post(format!("{url}/api/tasks/{id}/comments")).header(header::COOKIE, &cookie).json(&json!({"content": "网络评论"})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = client.delete(format!("{url}/api/tasks/{id}")).header(header::COOKIE, &cookie).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let remaining = db.lock().unwrap().tasks(None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert!(remaining[0].parent_task_id.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn network_comment_reply_uses_server_snapshot_and_rejects_invalid_quotes() {
        let (url, db, server) = server(false).await;
        let client = reqwest::Client::new();
        let cookie = login_cookie(&client, &url).await;
        let (task, other, original, operator) = {
            let db = db.lock().unwrap();
            let operator = db.current_user_id().unwrap();
            let draft = json!({"title":"网络引用任务", "description":"", "priority":"P3", "status":"todo", "creatorId":operator, "assigneeId":operator, "isShared":false, "sharedWith":[], "subtasks":[], "tags":[]});
            let task = db.create_task(draft.clone(), &operator).unwrap();
            let other = db.create_task(draft, &operator).unwrap();
            let original = db.create_task_comment(&task.id, "真实原文", &operator).unwrap();
            (task, other, original, operator)
        };
        let response = client.post(format!("{url}/api/tasks/{}/comments", task.id)).header(header::COOKIE, &cookie)
            .json(&json!({"content":"网络引用回复", "replyToCommentId":original.id, "authorId":"forged", "replyTo":{"commentId":"forged", "authorId":"forged", "content":"伪造原文"}})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let reply: Value = response.json().await.unwrap();
        assert_eq!(reply["authorId"], operator);
        assert_eq!(reply["replyTo"]["commentId"], original.id);
        assert_eq!(reply["replyTo"]["authorId"], operator);
        assert_eq!(reply["replyTo"]["content"], "真实原文");
        for (task_id, quote_id) in [(other.id.as_str(), original.id.as_str()), (task.id.as_str(), "missing")] {
            let response = client.post(format!("{url}/api/tasks/{task_id}/comments")).header(header::COOKIE, &cookie)
                .json(&json!({"content":"无效回复", "replyToCommentId":quote_id})).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            let error: Value = response.json().await.unwrap();
            assert_eq!(error["error"], "引用的评论不存在、已删除或不属于当前任务");
        }
        db.lock().unwrap().delete_task_comment(&original.id, &operator).unwrap();
        let response = client.post(format!("{url}/api/tasks/{}/comments", task.id)).header(header::COOKIE, &cookie)
            .json(&json!({"content":"过期引用", "replyToCommentId":original.id})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let error: Value = response.json().await.unwrap();
        assert_eq!(error["error"], "引用的评论不存在、已删除或不属于当前任务");
        let comments: Value = client.get(format!("{url}/api/tasks/{}/comments", task.id)).header(header::COOKIE, &cookie).send().await.unwrap().json().await.unwrap();
        assert_eq!(comments.as_array().unwrap().len(), 1);
        assert_eq!(comments[0]["replyTo"]["content"], "真实原文");
        server.abort();
    }

    #[test]
    fn hashes_passwords_without_storing_plaintext() {
        let hash = hash_password("correct horse battery staple").expect("password should hash");
        assert!(!hash.contains("correct horse"));
        let parsed = PasswordHash::new(&hash).expect("hash should parse");
        assert!(Argon2::default()
            .verify_password(b"correct horse battery staple", &parsed)
            .is_ok());
        assert!(Argon2::default()
            .verify_password(b"wrong password", &parsed)
            .is_err());
    }

    #[test]
    fn rejects_short_passwords() {
        assert!(hash_password("short").is_err());
    }
}
