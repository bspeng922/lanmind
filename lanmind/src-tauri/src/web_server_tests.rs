use super::*;

#[tokio::test]
async fn disabled_features_block_shares_without_stopping_task_access() {
    let (url, db, server) = server(false).await;
    let client = reqwest::Client::new();
    let cookie = login_cookie(&client, &url).await;
    {
        let db = db.lock().unwrap();
        db.set_feature_enabled("wiki", false).unwrap();
        db.set_feature_enabled("ai", false).unwrap();
    }
    for path in ["/api/public/wiki", "/api/public/wiki/missing", "/api/public/ai/missing", "/api/wiki/assets/missing"] {
        assert_eq!(client.get(format!("{url}{path}")).send().await.unwrap().status(), StatusCode::SERVICE_UNAVAILABLE);
    }
    assert_eq!(client.get(format!("{url}/api/tasks")).header(header::COOKIE, &cookie).send().await.unwrap().status(), StatusCode::OK);
    db.lock().unwrap().set_feature_enabled("wiki", true).unwrap();
    assert_ne!(client.get(format!("{url}/api/public/wiki")).send().await.unwrap().status(), StatusCode::SERVICE_UNAVAILABLE);
    server.abort();
}

#[tokio::test]
async fn browser_sessions_cannot_follow_a_desktop_switch() {
    let (url,db,server)=server(false).await;
    let client=reqwest::Client::new();
    let cookie=login_cookie(&client,&url).await;
    assert_eq!(client.get(format!("{url}/api/tasks")).header(header::COOKIE,&cookie).send().await.unwrap().status(),StatusCode::OK);
    {
        let db=db.lock().unwrap();let user=db.current_user_id().unwrap();
        let b=db.create_workspace("B",None,None,&user).unwrap();db.switch_workspace(&b.id,&user).unwrap();
    }
    assert_eq!(client.get(format!("{url}/api/tasks")).header(header::COOKIE,&cookie).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
    server.abort();
}

async fn server(read_only: bool) -> (String, Arc<Mutex<Database>>, tokio::task::JoinHandle<()>) {
    let db = Arc::new(Mutex::new(Database::open(std::path::Path::new(":memory:")).unwrap()));
    let state = WebAppState {
        authorization: db.lock().unwrap().workspace_context().unwrap(),
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
        (reqwest::Method::POST, "/api/task-recycle/trash", json!({"id":"missing"})),
        (reqwest::Method::POST, "/api/task-recycle/restore", json!({"selection":[]})),
        (reqwest::Method::POST, "/api/task-recycle/purge", json!({"selection":[]})),
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
async fn task_recycle_network_roundtrip_uses_authenticated_user() {
    let (url,db,server)=server(false).await;let client=reqwest::Client::new();let cookie=login_cookie(&client,&url).await;
    let task={let db=db.lock().unwrap();let user=db.current_user_id().unwrap();db.create_task(json!({"title":"web recycle","description":"body","priority":"P3","status":"todo","assigneeId":user,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[]}),&user).unwrap()};
    let endpoint=format!("{url}/api/task-recycle");
    assert_eq!(client.post(format!("{endpoint}/list")).json(&json!({})).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
    let trash=client.post(format!("{endpoint}/trash")).header(header::COOKIE,&cookie).json(&json!({"id":task.id,"deletedBy":"forged","expectedVersion":task.version})).send().await.unwrap();assert_eq!(trash.status(),StatusCode::OK);
    let list:Value=client.post(format!("{endpoint}/list")).header(header::COOKIE,&cookie).json(&json!({})).send().await.unwrap().json().await.unwrap();
    assert_eq!(list["total"],1);assert_eq!(list["items"][0]["meta"]["deletedBy"],task.creator_id);
    let sel=json!([{"id":task.id,"deletionId":list["items"][0]["meta"]["deletionId"]}]);
    let response=client.post(format!("{endpoint}/restore")).header(header::COOKIE,&cookie).json(&json!({"selection":sel,"confirmed":true})).send().await.unwrap();assert_eq!(response.status(),StatusCode::OK);
    assert!(db.lock().unwrap().tasks(None).unwrap().iter().any(|t|t.id==task.id));
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

#[tokio::test]
async fn public_wiki_reads_without_session_cookie() {
    let (url, db, server) = server(false).await;
    let client = reqwest::Client::new();
    let (ws, user) = {
        let db = db.lock().unwrap();
        let ws = db.workspace_context().unwrap().workspace_id;
        let user = db.current_user_id().unwrap();
        (ws, user)
    };
    let page_id = "test-public-wiki-doc";
    db.lock().unwrap().write_wiki_page(&json!({
        "id": page_id,
        "title": "公开知识库文档",
        "content": "# 测试正文\n\n局域网可读。",
        "workspaceId": ws,
        "parentId": null,
        "projectId": null,
    }), None, &user).unwrap();

    // 1. Fetch specific document without cookie/session
    let response = client.get(format!("{url}/api/public/wiki/{page_id}")).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let doc: Value = response.json().await.unwrap();
    assert_eq!(doc["id"], page_id);
    assert_eq!(doc["title"], "公开知识库文档");
    assert_eq!(doc["content"], "# 测试正文\n\n局域网可读。");

    // 2. Fetch public wiki documents list without cookie/session
    let response = client.get(format!("{url}/api/public/wiki")).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let list: Value = response.json().await.unwrap();
    assert!(list["documents"].as_array().unwrap().iter().any(|d| d["id"] == page_id));

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

#[tokio::test]
async fn wiki_assets_upload_and_serve_roundtrip() {
    let temp = std::env::temp_dir().join(format!("lanmind_test_{}", uuid::Uuid::new_v4()));
    let storage_root = temp.join("storage").join("projects");
    tokio::fs::create_dir_all(&storage_root).await.unwrap();

    let db = Arc::new(Mutex::new(Database::open(std::path::Path::new(":memory:")).unwrap()));
    let state = WebAppState {
        authorization: db.lock().unwrap().workspace_context().unwrap(),
        db: db.clone(),
        password_hash: Arc::new(hash_password("correct-password").unwrap()),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        login_failures: Arc::new(Mutex::new(HashMap::new())),
        storage_root,
        app: None,
        read_only: false,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server_task = tokio::spawn(async move {
        axum::serve(listener, app_router(state).into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
    });

    let client = reqwest::Client::new();
    let asset_name = "asset_test_123_test.png";
    let fake_png_bytes = b"\x89PNG\r\n\x1a\nfakeimagebytes";
    assert_eq!(client.post(format!("{url}/api/public/wiki/assets/{asset_name}")).body(fake_png_bytes.to_vec()).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let cookie = login_cookie(&client, &url).await;

    // 1. Upload via /api/public/wiki/assets/{name}
    let upload_res = client
        .post(format!("{url}/api/public/wiki/assets/{asset_name}"))
        .header(header::COOKIE, &cookie)
        .body(fake_png_bytes.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(upload_res.status(), StatusCode::OK);

    // 2. Fetch via /assets/{name}
    let fetch_res = client
        .get(format!("{url}/assets/{asset_name}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetch_res.status(), StatusCode::OK);
    assert_eq!(fetch_res.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
    let downloaded = fetch_res.bytes().await.unwrap();
    assert_eq!(downloaded.as_ref(), fake_png_bytes);

    let unicode_name = "asset_中文_100%说明(一).txt";
    let encoded: String = unicode_name.as_bytes().iter().map(|byte| format!("%{byte:02X}")).collect();
    let upload = client.post(format!("{url}/api/wiki/assets/{encoded}")).header(header::COOKIE, &cookie).body("附件原文").send().await.unwrap();
    assert_eq!(upload.status(), StatusCode::OK);
    let fetched = client.get(format!("{url}/assets/{encoded}")).send().await.unwrap();
    assert_eq!(fetched.status(), StatusCode::OK);
    assert!(fetched.headers()[header::CONTENT_DISPOSITION].to_str().unwrap().contains("filename*=UTF-8''"));
    assert_eq!(fetched.text().await.unwrap(), "附件原文");
    for bad in ["..%5csecret.txt", "%2fsecret.txt", "C%3Asecret.txt"] {
        assert_eq!(client.post(format!("{url}/api/wiki/assets/{bad}")).header(header::COOKIE, &cookie).body("bad").send().await.unwrap().status(), StatusCode::BAD_REQUEST);
    }

    server_task.abort();
    let _ = tokio::fs::remove_dir_all(&temp).await;
}

#[tokio::test]
async fn ai_shares_expose_only_the_selected_snapshot_and_reject_other_workspaces() {
    let (url, db, server) = server(false).await;
    let (workspace, conv_id, share_id) = {
        let db = db.lock().unwrap();
        let scope = db.workspace_context().unwrap();
        let mut conversation = db.ai_create_conversation().unwrap();
        conversation.title = "对话分享测试".into();
        let mut parent: Option<String> = None;
        for (id, role, text, protocol) in [
            ("user", "user", "用户问题", Value::Null),
            ("tool", "assistant", "内部协议与密钥", json!({"secret":"must-not-share"})),
            ("assistant", "assistant", "**公开回答**", Value::Null),
        ] {
            let message = serde_json::from_value::<crate::ai_types::AiMessage>(json!({
                "id":id,"role":role,"content":text,"createdAt":"2026-10-26T00:00:00Z",
                "branchId":conversation.branch_id,"parentMessageId":parent,"runId":null,"userMessageId":null,
                "status":"completed","error":null,"modelLabel":null,"protocol":protocol,
            })).unwrap();
            db.ai_put_message_in(&scope, &conversation.id, &message).unwrap();
            parent = Some(id.into());
        }
        conversation.head_message_id = parent;
        db.ai_put_conversation_in(&scope, &conversation).unwrap();
        let share = db.ai_share_conversation(&conversation.id).unwrap();
        (scope.workspace_id, conversation.id, share["shareId"].as_str().unwrap().to_string())
    };
    let client = reqwest::Client::new();
    let response = client.get(format!("{url}/api/public/ai/{share_id}?workspace={workspace}")).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let snapshot: Value = response.json().await.unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 2);
    assert_eq!(snapshot["messages"][1]["content"], "**公开回答**");
    assert!(!snapshot.to_string().contains("must-not-share"));
    assert!(snapshot.get("runs").is_none());
    assert!(!client.get(format!("{url}/api/public/ai/{conv_id}")).send().await.unwrap().status().is_success());
    assert_eq!(client.get(format!("{url}/api/public/ai/{share_id}?workspace=other")).send().await.unwrap().status(), StatusCode::NOT_FOUND);
    assert_eq!(client.get(format!("{url}/api/public/wiki?workspace=other")).send().await.unwrap().status(), StatusCode::NOT_FOUND);
    {
        let db = db.lock().unwrap();
        let mut conversation = db.ai_conversation(&conv_id).unwrap(); conversation.title = "后续修改".into();
        db.ai_put_conversation_in(&db.workspace_context().unwrap(), &conversation).unwrap();
        assert_eq!(db.ai_shared_conversation(&share_id).unwrap()["title"], "对话分享测试");
        db.ai_delete_conversation(&conv_id).unwrap();
    }
    assert!(!client.get(format!("{url}/api/public/ai/{share_id}")).send().await.unwrap().status().is_success());
    server.abort();
}

