use super::*;
use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[test]
fn date_validation_accepts_only_supported_local_formats() {
    assert!(valid_due_date("2026-08-05"));
    assert!(valid_due_date("2026-08-05T09:30"));
    assert!(!valid_due_date("2026/08/05"));
    assert!(!valid_due_date("2026-02-30"));
}

#[test]
fn patch_rejects_immutable_fields() {
    let task: Task = serde_json::from_value(json!({
        "id":"task-1","title":"Task","description":"","priority":"P4","status":"todo",
        "dueDate":null,"recurrence":"none","recurrenceRule":null,"reminderTime":null,
        "creatorId":"user@pc","assigneeId":"user@pc","projectId":null,"isShared":false,
        "sharedWith":[],"subtasks":[],"tags":[],"createdAt":"now","updatedAt":"now","version":1
    }))
    .unwrap();
    assert!(validated_patch(&task, json!({"title":"Updated"})).is_ok());
    assert!(validated_patch(&task, json!({"creatorId":"attacker"})).is_err());
    assert!(validated_patch(&task, json!({"createdAt":"2026-01-01"})).is_err());
    assert!(validated_patch(&task, json!({"version":99})).is_err());
}

#[test]
fn bearer_middleware_rejects_missing_or_incorrect_tokens() {
    let state = AuthState {
        token: Arc::new(Mutex::new("test-token".into())),
    };
    for authorization in [None, Some("Bearer wrong-token")] {
        let mut request = Request::builder().uri("/mcp");
        if let Some(value) = authorization {
            request = request.header(header::AUTHORIZATION, value);
        }
        let request = request.body(Body::empty()).unwrap();
        assert_eq!(authorized(&state, &request), Err(StatusCode::UNAUTHORIZED));
    }
    let request = Request::builder()
        .uri("/mcp")
        .header(header::AUTHORIZATION, "Bearer test-token")
        .body(Body::empty())
        .unwrap();
    assert_eq!(authorized(&state, &request), Ok(()));
}

#[test]
fn create_payload_is_a_valid_task_draft_without_database_id_error() {
    let value = create_task_value(
        CreateTaskRequest {
            title: "Smoke task".into(),
            description: String::new(),
            priority: None,
            status: None,
            due_date: None,
            reminder_time: None,
            recurrence: None,
            recurrence_rule: None,
            assignee_id: None,
            project_id: None,
            is_shared: None,
            shared_with: Vec::new(),
            subtasks: Vec::new(),
            tags: Vec::new(),
        },
        "user@test-device",
    )
    .expect("MCP create payload should validate");
    assert!(value.get("id").and_then(Value::as_str).is_some());
}

struct TestHarness {
    client: Client,
    endpoint: String,
    token: String,
    session_id: Option<String>,
    cancellation: CancellationToken,
    server: tokio::task::JoinHandle<()>,
    request_id: i64,
}

impl TestHarness {
    async fn start() -> Self {
        let token = "mcp-full-test-token".to_string();
        let db = Arc::new(Mutex::new(
            Database::open(Path::new(":memory:")).expect("in-memory db open failed"),
        ));
        let service: StreamableHttpService<LanMindMcp, LocalSessionManager> =
            StreamableHttpService::new(
                {
                    let db = db.clone();
                    move || Ok(LanMindMcp::new(db.clone(), None))
                },
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_json_response(true)
                    .with_allowed_hosts(["127.0.0.1".to_string(), "localhost".to_string()]),
            );
        let router = Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn_with_state(
                AuthState {
                    token: Arc::new(Mutex::new(token.clone())),
                },
                authenticate,
            ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let address = listener.local_addr().expect("listener address");
        let cancellation = CancellationToken::new();
        let server = tokio::spawn({
            let shutdown = cancellation.clone();
            async move {
                let _ = axum::serve(listener, router)
                    .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
                    .await;
            }
        });

        let client = Client::new();
        let endpoint = format!("http://{address}/mcp");
        let mut harness = Self {
            client,
            endpoint,
            token,
            session_id: None,
            cancellation,
            server,
            request_id: 1,
        };

        // Initialize MCP session
        let body = harness
            .post(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": "mcp-full-test", "version": "1.0.0" }
                }
            }))
            .await;
        assert!(body.get("result").is_some(), "initialize failed: {body}");

        let _ = harness
            .post(json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .await;

        harness
    }

    async fn post(&mut self, request: Value) -> Value {
        let mut builder = self
            .client
            .post(&self.endpoint)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .json(&request);
        if let Some(ref session_id) = self.session_id {
            builder = builder.header("mcp-session-id", session_id);
        }
        let response = builder.send().await.expect("MCP request failed");
        if let Some(sid) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            self.session_id = Some(sid.to_string());
        }
        let raw = response.text().await.expect("MCP body unreadable");
        if raw.trim().is_empty() {
            Value::Null
        } else if let Ok(json) = serde_json::from_str::<Value>(&raw) {
            json
        } else {
            let json_str = raw
                .lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .map(str::trim)
                .find(|s| !s.is_empty())
                .unwrap_or("{}");
            serde_json::from_str(json_str).unwrap_or(Value::Null)
        }
    }

    async fn call_tool(&mut self, name: &str, arguments: Value) -> Value {
        self.request_id += 1;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        });
        self.post(payload).await
    }

    async fn shutdown(self) {
        self.cancellation.cancel();
        let _ = self.server.await;
    }
}

#[tokio::test]
async fn full_mcp_tools_and_all_parameters_test() {
    let mut h = TestHarness::start().await;

    // 1. Tool discovery
    let listed = h
        .post(json!({
            "jsonrpc": "2.0",
            "id": 999,
            "method": "tools/list",
            "params": {}
        }))
        .await;
    let tool_names = listed["result"]["tools"]
        .as_array()
        .expect("tools list")
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect::<HashSet<_>>();
    assert_eq!(tool_names.len(), 8);
    for name in [
        "get_context",
        "list_users",
        "list_projects",
        "list_tasks",
        "get_task",
        "list_risk_warnings",
        "create_task",
        "update_task",
    ] {
        assert!(tool_names.contains(name), "missing tool: {name}");
    }

    // 2. Test get_context
    let ctx_res = h.call_tool("get_context", json!({})).await;
    assert_eq!(ctx_res["result"]["isError"], false);
    let ctx = &ctx_res["result"]["structuredContent"];
    assert!(ctx["workspaceId"].is_string());
    assert_eq!(ctx["workspaceName"], "我的工作区");
    assert!(ctx["currentUser"]["id"].is_string());
    assert!(ctx["localDateTime"].is_string());
    assert!(ctx["timezoneOffset"].is_string());

    let current_user_id = ctx["currentUser"]["id"].as_str().unwrap().to_string();

    // 3. Test list_users
    let users_res = h.call_tool("list_users", json!({})).await;
    assert_eq!(users_res["result"]["isError"], false);
    let users = users_res["result"]["structuredContent"]
        .as_array()
        .expect("users array");
    assert!(!users.is_empty());
    assert!(users.iter().any(|u| u["id"] == current_user_id));

    // 4. Test list_projects
    let projects_res = h.call_tool("list_projects", json!({})).await;
    assert_eq!(projects_res["result"]["isError"], false);
    assert!(projects_res["result"]["structuredContent"].is_array());

    // 5. Test create_task validation errors
    // 5.1 Empty title
    let err_empty_title = h.call_tool("create_task", json!({"title": "   "})).await;
    assert_eq!(err_empty_title["result"]["isError"], true);

    // 5.2 Invalid priority
    let err_prio = h
        .call_tool(
            "create_task",
            json!({"title": "Task", "priority": "P9"}),
        )
        .await;
    assert_eq!(err_prio["result"]["isError"], true);

    // 5.3 Invalid status
    let err_status = h
        .call_tool(
            "create_task",
            json!({"title": "Task", "status": "unknown"}),
        )
        .await;
    assert_eq!(err_status["result"]["isError"], true);

    // 5.4 Invalid due_date format
    let err_date = h
        .call_tool(
            "create_task",
            json!({"title": "Task", "dueDate": "2026/12/31"}),
        )
        .await;
    assert_eq!(err_date["result"]["isError"], true);

    // 5.5 Recurring task without dueDate
    let err_recur_no_due = h
        .call_tool(
            "create_task",
            json!({"title": "Task", "recurrence": "daily"}),
        )
        .await;
    assert_eq!(err_recur_no_due["result"]["isError"], true);

    // 5.6 Unknown assigneeId
    let err_unknown_assignee = h
        .call_tool(
            "create_task",
            json!({"title": "Task", "assigneeId": "ghost@nowhere"}),
        )
        .await;
    assert_eq!(err_unknown_assignee["result"]["isError"], true);

    // 6. Test create_task with ALL parameters populated
    let create_all_args = json!({
        "title": " Complete MCP Full Test Task ",
        "description": "Comprehensive parameter validation description",
        "priority": "P1",
        "status": "todo",
        "dueDate": "2026-10-15T18:30",
        "reminderTime": "2026-10-15T18:00",
        "recurrence": "weekly",
        "recurrenceRule": {
            "interval": 2,
            "daysOfWeek": [1, 3, 5],
            "dayOfMonth": null,
            "monthOfYear": null,
            "timeOfDay": "18:30"
        },
        "assigneeId": current_user_id,
        "projectId": null,
        "isShared": false,
        "sharedWith": [],
        "subtasks": [
            { "title": "Subtask Alpha", "completed": false },
            { "id": "custom-sub-2", "title": "Subtask Beta", "completed": true }
        ],
        "tags": ["automated", "mcp-test", "p1-core"]
    });

    let created_res = h.call_tool("create_task", create_all_args).await;
    assert_eq!(
        created_res["result"]["isError"], false,
        "create_task failed: {created_res}"
    );
    let created_task = &created_res["result"]["structuredContent"]["task"];
    let task_id = created_task["id"].as_str().unwrap().to_string();
    assert_eq!(created_task["title"], "Complete MCP Full Test Task");
    assert_eq!(
        created_task["description"],
        "Comprehensive parameter validation description"
    );
    assert_eq!(created_task["priority"], "P1");
    assert_eq!(created_task["status"], "todo");
    assert_eq!(created_task["dueDate"], "2026-10-15T18:30");
    assert_eq!(created_task["reminderTime"], "2026-10-15T18:00");
    assert_eq!(created_task["recurrence"], "weekly");
    assert_eq!(created_task["recurrenceRule"]["interval"], 2);
    assert_eq!(
        created_task["recurrenceRule"]["daysOfWeek"],
        json!([1, 3, 5])
    );
    assert_eq!(created_task["recurrenceRule"]["timeOfDay"], "18:30");
    assert_eq!(created_task["assigneeId"], current_user_id);
    assert_eq!(created_task["isShared"], false);
    assert_eq!(created_task["subtasks"].as_array().unwrap().len(), 2);
    assert_eq!(created_task["subtasks"][1]["id"], "custom-sub-2");
    assert_eq!(created_task["subtasks"][1]["completed"], true);
    assert_eq!(
        created_task["tags"],
        json!(["automated", "mcp-test", "p1-core"])
    );
    let mut version = created_task["version"].as_i64().unwrap();

    // 7. Test get_task by exact taskId
    let get_res = h.call_tool("get_task", json!({"taskId": task_id})).await;
    assert_eq!(get_res["result"]["isError"], false);
    assert_eq!(get_res["result"]["structuredContent"]["id"], task_id);
    assert_eq!(
        get_res["result"]["structuredContent"]["title"],
        "Complete MCP Full Test Task"
    );

    // 7.1 Non-existent get_task
    let get_err = h
        .call_tool("get_task", json!({"taskId": "non-existent-task-id"}))
        .await;
    assert_eq!(get_err["result"]["isError"], true);

    // 8. Create a second task to verify list_tasks filtering and pagination
    let second_res = h
        .call_tool(
            "create_task",
            json!({
                "title": "Second Routine Task",
                "description": "Daily chores",
                "priority": "P3",
                "status": "in_progress",
                "dueDate": "2026-11-20",
                "tags": ["routine"]
            }),
        )
        .await;
    assert_eq!(second_res["result"]["isError"], false);
    let second_id = second_res["result"]["structuredContent"]["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 9. Test list_tasks with every parameter
    // 9.1 list_tasks default
    let list_all = h.call_tool("list_tasks", json!({})).await;
    assert_eq!(list_all["result"]["isError"], false);
    assert_eq!(list_all["result"]["structuredContent"]["total"], 2);

    // 9.2 Filter by keyword (in title, description, or tags)
    let list_kw_tag = h
        .call_tool("list_tasks", json!({"keyword": "automated"}))
        .await;
    assert_eq!(list_kw_tag["result"]["structuredContent"]["total"], 1);
    assert_eq!(
        list_kw_tag["result"]["structuredContent"]["items"][0]["id"],
        task_id
    );

    let list_kw_desc = h
        .call_tool("list_tasks", json!({"keyword": "chores"}))
        .await;
    assert_eq!(list_kw_desc["result"]["structuredContent"]["total"], 1);
    assert_eq!(
        list_kw_desc["result"]["structuredContent"]["items"][0]["id"],
        second_id
    );

    // 9.3 Filter by priority
    let list_p1 = h.call_tool("list_tasks", json!({"priority": "P1"})).await;
    assert_eq!(list_p1["result"]["structuredContent"]["total"], 1);
    let list_p4 = h.call_tool("list_tasks", json!({"priority": "P4"})).await;
    assert_eq!(list_p4["result"]["structuredContent"]["total"], 0);

    // 9.4 Filter by status
    let list_progress = h
        .call_tool("list_tasks", json!({"status": "in_progress"}))
        .await;
    assert_eq!(list_progress["result"]["structuredContent"]["total"], 1);
    assert_eq!(
        list_progress["result"]["structuredContent"]["items"][0]["id"],
        second_id
    );

    // 9.5 Filter by dueDate range: dueFrom and dueTo
    let list_oct = h
        .call_tool(
            "list_tasks",
            json!({
                "dueFrom": "2026-10-01",
                "dueTo": "2026-10-31"
            }),
        )
        .await;
    assert_eq!(list_oct["result"]["structuredContent"]["total"], 1);
    assert_eq!(
        list_oct["result"]["structuredContent"]["items"][0]["id"],
        task_id
    );

    let list_nov = h
        .call_tool(
            "list_tasks",
            json!({
                "dueFrom": "2026-11-01",
                "dueTo": "2026-11-30"
            }),
        )
        .await;
    assert_eq!(list_nov["result"]["structuredContent"]["total"], 1);
    assert_eq!(
        list_nov["result"]["structuredContent"]["items"][0]["id"],
        second_id
    );

    // 9.6 Pagination: limit & offset
    let list_page1 = h
        .call_tool("list_tasks", json!({"limit": 1, "offset": 0}))
        .await;
    assert_eq!(list_page1["result"]["structuredContent"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(list_page1["result"]["structuredContent"]["total"], 2);

    let list_page2 = h
        .call_tool("list_tasks", json!({"limit": 1, "offset": 1}))
        .await;
    assert_eq!(list_page2["result"]["structuredContent"]["items"].as_array().unwrap().len(), 1);
    assert_ne!(
        list_page1["result"]["structuredContent"]["items"][0]["id"],
        list_page2["result"]["structuredContent"]["items"][0]["id"]
    );

    // 9.7 Invalid filters error handling
    let err_filter_prio = h
        .call_tool("list_tasks", json!({"priority": "INVALID"}))
        .await;
    assert_eq!(err_filter_prio["result"]["isError"], true);

    let err_filter_date = h
        .call_tool("list_tasks", json!({"dueFrom": "invalid-date"}))
        .await;
    assert_eq!(err_filter_date["result"]["isError"], true);

    // 10. Test update_task
    // 10.1 Optimistic locking failure (wrong expectedVersion)
    let err_version = h
        .call_tool(
            "update_task",
            json!({
                "taskId": task_id,
                "expectedVersion": 99999999999i64,
                "patch": { "title": "Conflict" }
            }),
        )
        .await;
    assert_eq!(err_version["result"]["isError"], true);

    // 10.2 Reject immutable field in patch
    let err_patch_field = h
        .call_tool(
            "update_task",
            json!({
                "taskId": task_id,
                "expectedVersion": version,
                "patch": { "creatorId": "hacker" }
            }),
        )
        .await;
    assert_eq!(err_patch_field["result"]["isError"], true);

    // 10.3 Successful patch updating various fields
    let update_patch = json!({
        "taskId": task_id,
        "expectedVersion": version,
        "patch": {
            "title": "MCP Full Test Task Updated Title",
            "priority": "P2",
            "tags": ["updated", "mcp-verified"]
        }
    });
    let update_res = h.call_tool("update_task", update_patch).await;
    assert_eq!(
        update_res["result"]["isError"], false,
        "update_task failed: {update_res}"
    );
    let updated_task = &update_res["result"]["structuredContent"]["task"];
    assert_eq!(
        updated_task["title"],
        "MCP Full Test Task Updated Title"
    );
    assert_eq!(updated_task["priority"], "P2");
    assert_eq!(
        updated_task["tags"],
        json!(["updated", "mcp-verified"])
    );
    version = updated_task["version"].as_i64().unwrap();

    // 10.4 Recurring task completion returns derived nextTask!
    // We update status to completed on the recurring weekly task
    let complete_recurring = json!({
        "taskId": task_id,
        "expectedVersion": version,
        "patch": {
            "status": "completed"
        }
    });
    let complete_res = h.call_tool("update_task", complete_recurring).await;
    assert_eq!(
        complete_res["result"]["isError"], false,
        "recurring completion failed: {complete_res}"
    );
    let complete_body = &complete_res["result"]["structuredContent"];
    assert_eq!(complete_body["task"]["status"], "completed");
    // nextTask must be generated because task is recurring (weekly)
    let next_task = &complete_body["nextTask"];
    assert!(
        !next_task.is_null(),
        "Recurring task completion should return nextTask"
    );
    assert_eq!(next_task["status"], "todo");
    assert_ne!(next_task["id"], task_id);
    assert!(next_task["dueDate"].as_str().is_some());

    // 11. Test list_risk_warnings
    // Create an overdue task
    let _overdue = h
        .call_tool(
            "create_task",
            json!({
                "title": "Overdue Critical Risk",
                "priority": "P1",
                "status": "todo",
                "dueDate": "2020-01-01"
            }),
        )
        .await;
    let risks_res = h.call_tool("list_risk_warnings", json!({})).await;
    assert_eq!(risks_res["result"]["isError"], false);
    let risks = risks_res["result"]["structuredContent"]
        .as_array()
        .expect("risk array");
    assert!(
        !risks.is_empty(),
        "Overdue task should trigger risk warnings"
    );

    h.shutdown().await;
}
