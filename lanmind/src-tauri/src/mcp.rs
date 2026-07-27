//! Authenticated LAN MCP endpoint backed by the desktop source of truth.

use crate::db::Database;
use crate::models::{McpConfig, McpStatus, RecurrenceRule, Subtask, Task};
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use chrono::{Datelike, Local, NaiveDate, NaiveDateTime};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ServerHandler,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone)]
pub struct McpRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    db: Arc<Mutex<Database>>,
    app: AppHandle,
    token: Arc<Mutex<String>>,
    state: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    running: bool,
    port: u16,
    cancellation: Option<CancellationToken>,
    server_task: Option<tauri::async_runtime::JoinHandle<()>>,
    error: Option<String>,
    generation: u64,
}

#[derive(Clone)]
struct AuthState {
    token: Arc<Mutex<String>>,
}

impl McpRuntime {
    pub fn new(db: Arc<Mutex<Database>>, app: AppHandle) -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                db,
                app,
                token: Arc::new(Mutex::new(String::new())),
                state: Mutex::new(RuntimeState::default()),
            }),
        }
    }

    pub async fn apply(&self, config: McpConfig) -> Result<(), String> {
        let token_changed = {
            let mut token = self.inner.token.lock().map_err(|_| "MCP 鉴权状态不可用")?;
            let changed = *token != config.token;
            *token = config.token.clone();
            changed
        };
        if !config.enabled {
            self.stop(config.port).await?;
            return Ok(());
        }

        let same_running_port = {
            let state = self.inner.state.lock().map_err(|_| "MCP 状态不可用")?;
            state.running && state.port == config.port
        };
        if same_running_port && !token_changed {
            return Ok(());
        }
        if same_running_port {
            self.stop(config.port).await?;
        }

        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("无法监听 MCP 端口 {}: {error}", config.port);
                if let Ok(mut state) = self.inner.state.lock() {
                    if !state.running {
                        state.port = config.port;
                        state.error = Some(message.clone());
                    }
                }
                return Err(message);
            }
        };
        let cancellation = CancellationToken::new();
        let service: StreamableHttpService<LanMindMcp, LocalSessionManager> =
            StreamableHttpService::new(
                {
                    let db = self.inner.db.clone();
                    let app = self.inner.app.clone();
                    move || Ok(LanMindMcp::new(db.clone(), Some(app.clone())))
                },
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_sse_keep_alive(None)
                    .with_json_response(true)
                    .with_allowed_hosts([
                        "localhost".to_string(),
                        "127.0.0.1".to_string(),
                        local_ip_address::local_ip()
                            .map(|address| address.to_string())
                            .unwrap_or_else(|_| "127.0.0.1".into()),
                    ])
                    .with_max_request_body_bytes(1024 * 1024)
                    .with_cancellation_token(cancellation.child_token()),
            );
        let router =
            Router::new()
                .nest_service("/mcp", service)
                .layer(middleware::from_fn_with_state(
                    AuthState {
                        token: self.inner.token.clone(),
                    },
                    authenticate,
                ));

        let (generation, previous_cancellation, previous_task) = {
            let mut state = self.inner.state.lock().map_err(|_| "MCP 状态不可用")?;
            let previous_cancellation = state.cancellation.replace(cancellation.clone());
            let previous_task = state.server_task.take();
            state.running = true;
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
            let result = axum::serve(listener, router)
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

    async fn stop(&self, port: u16) -> Result<(), String> {
        let (cancellation, server_task) = {
            let mut state = self.inner.state.lock().map_err(|_| "MCP 状态不可用")?;
            let cancellation = state.cancellation.take();
            let server_task = state.server_task.take();
            state.running = false;
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

    pub fn status(&self, config: McpConfig) -> McpStatus {
        let (running, error) = self
            .inner
            .state
            .lock()
            .map(|state| (state.running, state.error.clone()))
            .unwrap_or_else(|_| (false, Some("MCP 状态不可用".into())));
        let ip = local_ip_address::local_ip()
            .map(|address| address.to_string())
            .unwrap_or_else(|_| "127.0.0.1".into());
        McpStatus {
            enabled: config.enabled,
            port: config.port,
            token: config.token,
            running,
            endpoint: format!("http://{ip}:{}/mcp", config.port),
            error,
        }
    }
}

async fn authenticate(
    State(state): State<AuthState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    authorized(&state, &request)?;
    Ok(next.run(request).await)
}

fn authorized(state: &AuthState, request: &Request<Body>) -> Result<(), StatusCode> {
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| StatusCode::FORBIDDEN)?;
        let host = request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let origin_authority = origin
            .strip_prefix("http://")
            .or_else(|| origin.strip_prefix("https://"))
            .and_then(|value| value.split('/').next())
            .unwrap_or_default();
        if origin_authority != host {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let expected = state
        .token
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let authorized = supplied.is_some_and(|supplied| {
        supplied.len() == expected.len()
            && bool::from(supplied.as_bytes().ct_eq(expected.as_bytes()))
    });
    authorized.then_some(()).ok_or(StatusCode::UNAUTHORIZED)
}

#[derive(Clone)]
struct LanMindMcp {
    db: Arc<Mutex<Database>>,
    app: Option<AppHandle>,
    tool_router: ToolRouter<Self>,
}

impl LanMindMcp {
    fn new(db: Arc<Mutex<Database>>, app: Option<AppHandle>) -> Self {
        Self {
            db,
            app,
            tool_router: Self::tool_router(),
        }
    }

    fn read<T>(
        &self,
        operation: impl FnOnce(&Database, &str) -> Result<T, String>,
    ) -> Result<T, String> {
        let db = self
            .db
            .lock()
            .map_err(|_| "本地数据库正在被其他操作占用".to_string())?;
        let user_id = db.current_user_id()?;
        operation(&db, &user_id)
    }

    fn changed(&self) {
        if let Some(app) = self.app.as_ref() {
            let _ = app.emit("sync://operation", json!({"source":"mcp"}));
        }
    }
}

fn ok(value: Value) -> CallToolResult {
    CallToolResult::structured(value)
}

fn tool_error(message: impl Into<String>) -> CallToolResult {
    CallToolResult::structured_error(json!({"error": message.into()}))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct GetTaskRequest {
    task_id: String,
}

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ListTasksRequest {
    keyword: Option<String>,
    project_id: Option<String>,
    assignee_id: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    due_from: Option<String>,
    due_to: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreateSubtaskRequest {
    id: Option<String>,
    title: String,
    #[serde(default)]
    completed: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    description: String,
    priority: Option<String>,
    status: Option<String>,
    due_date: Option<String>,
    reminder_time: Option<String>,
    recurrence: Option<String>,
    recurrence_rule: Option<RecurrenceRule>,
    assignee_id: Option<String>,
    project_id: Option<String>,
    is_shared: Option<bool>,
    #[serde(default)]
    shared_with: Vec<String>,
    #[serde(default)]
    subtasks: Vec<CreateSubtaskRequest>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskRequest {
    task_id: String,
    expected_version: i64,
    /// Partial Task object. Omitted fields are unchanged; null clears nullable fields.
    patch: Value,
}

fn validate_enum(value: &str, allowed: &[&str], label: &str) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{label} 无效，可选值为 {}", allowed.join(", ")))
    }
}

fn valid_due_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
        || NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").is_ok()
}

fn validate_task(task: &Task) -> Result<(), String> {
    if task.title.trim().is_empty() {
        return Err("任务标题不能为空".into());
    }
    validate_enum(&task.priority, &["P1", "P2", "P3", "P4"], "优先级")?;
    validate_enum(
        &task.status,
        &["todo", "in_progress", "completed", "blocked"],
        "状态",
    )?;
    let recurrence = task.recurrence.as_deref().unwrap_or("none");
    validate_enum(
        recurrence,
        &["none", "daily", "weekly", "monthly", "yearly"],
        "循环类型",
    )?;
    if let Some(due_date) = task.due_date.as_deref() {
        if !valid_due_date(due_date) {
            return Err("到期日期必须是 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm".into());
        }
    }
    if let Some(reminder) = task.reminder_time.as_deref() {
        if NaiveDateTime::parse_from_str(reminder, "%Y-%m-%dT%H:%M").is_err() {
            return Err("提醒时间必须是 YYYY-MM-DDTHH:mm".into());
        }
    }
    if recurrence != "none" && task.due_date.is_none() {
        return Err("循环任务必须提供首次到期日期".into());
    }
    if let Some(rule) = task.recurrence_rule.as_ref() {
        if rule.interval == 0 {
            return Err("循环间隔必须大于 0".into());
        }
        if rule.days_of_week.iter().any(|day| !(1..=7).contains(day)) {
            return Err("循环星期必须在 1（周一）到 7（周日）之间".into());
        }
        if rule
            .day_of_month
            .is_some_and(|day| !(1..=31).contains(&day))
        {
            return Err("循环日期必须在 1 到 31 之间".into());
        }
        if rule
            .month_of_year
            .is_some_and(|month| !(1..=12).contains(&month))
        {
            return Err("循环月份必须在 1 到 12 之间".into());
        }
    }
    Ok(())
}

fn create_task_value(request: CreateTaskRequest, current_user_id: &str) -> Result<Value, String> {
    let due_date = request.due_date.clone();
    let project_id = request.project_id;
    let is_shared = request.is_shared.unwrap_or(project_id.is_some());
    let recurrence = request.recurrence.unwrap_or_else(|| "none".into());
    let rule = request.recurrence_rule.or_else(|| {
        if recurrence == "none" {
            return None;
        }
        let due = due_date.as_deref().and_then(|value| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")
                .ok()
                .or_else(|| {
                    NaiveDate::parse_from_str(value, "%Y-%m-%d")
                        .ok()?
                        .and_hms_opt(0, 0, 0)
                })
        })?;
        Some(RecurrenceRule {
            interval: 1,
            days_of_week: if recurrence == "weekly" {
                vec![due.weekday().number_from_monday() as u8]
            } else {
                Vec::new()
            },
            day_of_month: matches!(recurrence.as_str(), "monthly" | "yearly")
                .then_some(due.day() as u8),
            month_of_year: (recurrence == "yearly").then_some(due.month() as u8),
            time_of_day: due_date
                .as_deref()
                .and_then(|value| value.split_once('T').map(|(_, time)| time.to_string())),
        })
    });
    let subtasks: Vec<Subtask> = request
        .subtasks
        .into_iter()
        .map(|subtask| Subtask {
            id: subtask
                .id
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| format!("subtask-{}", Uuid::new_v4().simple())),
            title: subtask.title,
            completed: subtask.completed,
        })
        .collect();
    let value = json!({
        // `Task` is also used as the validation contract below, so the draft
        // must carry an id even though the database replaces it with its
        // authoritative id in `create_task_inner`.  Omitting it made every
        // MCP create_task call fail with `missing field id` before reaching
        // the database.
        "id": format!("mcp-draft-{}", Uuid::new_v4().simple()),
        "title": request.title.trim(),
        "description": request.description,
        "priority": request.priority.unwrap_or_else(|| "P4".into()),
        "status": request.status.unwrap_or_else(|| "todo".into()),
        "dueDate": due_date,
        "reminderTime": request.reminder_time,
        "recurrence": recurrence,
        "recurrenceRule": rule,
        "assigneeId": request.assignee_id.unwrap_or_else(|| current_user_id.to_string()),
        "projectId": project_id,
        "isShared": is_shared,
        "sharedWith": request.shared_with,
        "subtasks": subtasks,
        "tags": request.tags,
        "creatorId": current_user_id,
        "createdAt": Local::now().to_rfc3339(),
        "updatedAt": Local::now().to_rfc3339(),
        "version": 0,
    });
    let task: Task =
        serde_json::from_value(value.clone()).map_err(|error| format!("任务数据无效: {error}"))?;
    validate_task(&task)?;
    Ok(value)
}

fn validated_patch(current: &Task, patch: Value) -> Result<Value, String> {
    let patch = patch
        .as_object()
        .cloned()
        .ok_or_else(|| "patch 必须是 JSON 对象".to_string())?;
    let allowed: HashSet<&str> = [
        "title",
        "description",
        "priority",
        "status",
        "dueDate",
        "reminderTime",
        "recurrence",
        "recurrenceRule",
        "assigneeId",
        "projectId",
        "isShared",
        "sharedWith",
        "subtasks",
        "tags",
    ]
    .into_iter()
    .collect();
    if let Some(field) = patch.keys().find(|field| !allowed.contains(field.as_str())) {
        return Err(format!("不允许修改字段 {field}"));
    }
    let mut merged = serde_json::to_value(current).map_err(|error| error.to_string())?;
    let merged_map = merged.as_object_mut().expect("Task serializes as object");
    for (key, value) in &patch {
        merged_map.insert(key.clone(), value.clone());
    }
    let task: Task =
        serde_json::from_value(merged).map_err(|error| format!("任务更新无效: {error}"))?;
    validate_task(&task)?;
    Ok(Value::Object(patch))
}

#[tool_router(router = tool_router)]
impl LanMindMcp {
    #[tool(
        description = "Get the active LanMind workspace, current desktop user, local date/time, and timezone offset."
    )]
    fn get_context(&self) -> CallToolResult {
        match self.read(|db, user_id| {
            let (workspace_id, workspace_name) = db.workspace()?;
            let current_user = db.users()?.into_iter().find(|user| user.id == user_id);
            Ok(json!({
                "workspaceId": workspace_id,
                "workspaceName": workspace_name,
                "currentUser": current_user,
                "localDateTime": Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
                "timezoneOffset": Local::now().format("%:z").to_string(),
            }))
        }) {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(description = "List users known to this LanMind desktop for task assignment.")]
    fn list_users(&self) -> CallToolResult {
        match self
            .read(|db, _| serde_json::to_value(db.users()?).map_err(|error| error.to_string()))
        {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "List projects visible to the current desktop user, including membership status."
    )]
    fn list_projects(&self) -> CallToolResult {
        match self.read(|db, user_id| {
            serde_json::to_value(db.projects(Some(user_id))?).map_err(|error| error.to_string())
        }) {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "List visible tasks with optional filters and pagination. Default limit is 100; maximum is 200."
    )]
    fn list_tasks(&self, Parameters(request): Parameters<ListTasksRequest>) -> CallToolResult {
        match self.read(|db, user_id| {
            if let Some(status) = request.status.as_deref() {
                validate_enum(
                    status,
                    &["todo", "in_progress", "completed", "blocked"],
                    "状态",
                )?;
            }
            if let Some(priority) = request.priority.as_deref() {
                validate_enum(priority, &["P1", "P2", "P3", "P4"], "优先级")?;
            }
            for date in [request.due_from.as_deref(), request.due_to.as_deref()]
                .into_iter()
                .flatten()
            {
                if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                    return Err("到期日期筛选必须是 YYYY-MM-DD".into());
                }
            }
            let keyword = request.keyword.as_deref().map(str::to_lowercase);
            let mut tasks = db.tasks(Some(user_id))?;
            tasks.retain(|task| {
                let searchable = format!(
                    "{} {} {}",
                    task.title,
                    task.description,
                    task.tags.join(" ")
                )
                .to_lowercase();
                let due = task.due_date.as_deref().and_then(|value| value.get(..10));
                keyword
                    .as_ref()
                    .is_none_or(|keyword| searchable.contains(keyword))
                    && request
                        .project_id
                        .as_ref()
                        .is_none_or(|id| task.project_id.as_ref() == Some(id))
                    && request
                        .assignee_id
                        .as_ref()
                        .is_none_or(|id| &task.assignee_id == id)
                    && request
                        .status
                        .as_ref()
                        .is_none_or(|value| &task.status == value)
                    && request
                        .priority
                        .as_ref()
                        .is_none_or(|value| &task.priority == value)
                    && request
                        .due_from
                        .as_deref()
                        .is_none_or(|from| due.is_some_and(|due| due >= from))
                    && request
                        .due_to
                        .as_deref()
                        .is_none_or(|to| due.is_some_and(|due| due <= to))
            });
            let total = tasks.len();
            let offset = request.offset.unwrap_or(0).min(total);
            let limit = request.limit.unwrap_or(100).clamp(1, 200);
            let items: Vec<Task> = tasks.into_iter().skip(offset).take(limit).collect();
            Ok(json!({"items": items, "total": total, "offset": offset, "limit": limit}))
        }) {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(description = "Get one visible task by its exact task ID.")]
    fn get_task(&self, Parameters(request): Parameters<GetTaskRequest>) -> CallToolResult {
        match self.read(|db, user_id| {
            let task = db
                .tasks(Some(user_id))?
                .into_iter()
                .find(|task| task.id == request.task_id)
                .ok_or_else(|| "任务不存在或当前用户无权读取".to_string())?;
            serde_json::to_value(task).map_err(|error| error.to_string())
        }) {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "List overdue, blocked, imminent, and high-priority risk warnings visible to the current user."
    )]
    fn list_risk_warnings(&self) -> CallToolResult {
        match self.read(|db, user_id| {
            serde_json::to_value(db.risks(Some(user_id))?).map_err(|error| error.to_string())
        }) {
            Ok(value) => ok(value),
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "Create a LanMind task as the current desktop user. Dates use local YYYY-MM-DD or YYYY-MM-DDTHH:mm."
    )]
    fn create_task(&self, Parameters(request): Parameters<CreateTaskRequest>) -> CallToolResult {
        let result = self.read(|db, user_id| {
            let value = create_task_value(request, user_id)?;
            let assignee_id = value
                .get("assigneeId")
                .and_then(Value::as_str)
                .ok_or_else(|| "负责人不能为空".to_string())?;
            if !db.users()?.iter().any(|user| user.id == assignee_id) {
                return Err("负责人不是本机已知用户，请先调用 list_users 获取可用用户 ID".into());
            }
            db.create_task(value, user_id)
        });
        match result {
            Ok(task) => {
                self.changed();
                ok(json!({"task": task}))
            }
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        description = "Update a task as the current desktop user using optimistic expectedVersion and a partial patch. Completing a recurring task also returns nextTask."
    )]
    fn update_task(&self, Parameters(request): Parameters<UpdateTaskRequest>) -> CallToolResult {
        let result = self.read(|db, user_id| {
            let current = db
                .tasks(Some(user_id))?
                .into_iter()
                .find(|task| task.id == request.task_id)
                .ok_or_else(|| "任务不存在或当前用户无权读取".to_string())?;
            let patch = validated_patch(&current, request.patch)?;
            if let Some(assignee_id) = patch.get("assigneeId").and_then(Value::as_str) {
                if !db.users()?.iter().any(|user| user.id == assignee_id) {
                    return Err(
                        "负责人不是本机已知用户，请先调用 list_users 获取可用用户 ID".into(),
                    );
                }
            }
            db.update_task_with_recurrence(
                &request.task_id,
                patch,
                user_id,
                Some(request.expected_version),
            )
        });
        match result {
            Ok(updated) => {
                self.changed();
                ok(serde_json::to_value(updated)
                    .unwrap_or_else(|error| json!({"error": error.to_string()})))
            }
            Err(error) => tool_error(error),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LanMindMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("LanMind task collaboration server. All operations use the active desktop user's identity and permissions.")
    }
}

#[path = "mcp_tests.rs"]
#[cfg(test)]
mod tests;

