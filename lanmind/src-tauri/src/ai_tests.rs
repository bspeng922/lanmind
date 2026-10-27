use crate::{ai_types::*, db::Database};
use serde_json::{json, Value};
use std::path::Path;
fn database() -> Database {
    Database::open(Path::new(":memory:")).unwrap()
}
fn connection(db: &Database, url: &str) -> AiConnection {
    db.save_ai_connection(serde_json::from_value(json!({"name":url,"providerType":"vllm","baseUrl":url,"models":[{"id":"","remoteModelId":"same-model","displayName":"Friendly model","enabled":true,"parameters":{}}]})).unwrap()).unwrap()
}
fn request(conv: &AiConversation, reference: &ModelRef, text: &str) -> RunRequest {
    RunRequest {
        client_request_id: id("client"),
        conversation_id: conv.id.clone(),
        branch_id: conv.branch_id.clone(),
        expected_head_message_id: conv.head_message_id.clone(),
        expected_conversation_version: conv.revision,
        input: RunInput::NewMessage {
            client_message_id: id("user"),
            text: text.into(),
        },
        model_ref: Some(reference.clone()),
        mode: "chat".into(),
        skill_ids: vec![],
        root_ids: vec![],
        mcp_ids: vec![],
        parameters: None,
    }
}
fn finish(db: &Database, run: &AiRun, text: &str) {
    let scope = db.workspace_context().unwrap();
    let mut run = run.clone();
    run.status = "completed".into();
    db.ai_put_run_in(&scope, &run).unwrap();
    let mut message = db
        .ai_message(&run.conversation_id, &run.assistant_message_id)
        .unwrap();
    message.content = text.into();
    message.status = "completed".into();
    db.ai_put_message_in(&scope, &run.conversation_id, &message)
        .unwrap();
}

#[test]
fn ai_search_handles_expanding_unicode_lowercase_and_private_scope() {
    let db = database();
    let c = connection(&db, "http://127.0.0.1:1111/v1");
    let reference = ModelRef {
        connection_id: c.id,
        model_entry_id: c.models[0].id.clone(),
    };
    let conv = db.ai_create_conversation().unwrap();
    let (run, _, _) = db
        .ai_prepare_run(&request(&conv, &reference, "question"))
        .unwrap();
    finish(&db, &run, &format!("{}İ中文搜索🙂ĞATEWAY", "a".repeat(50)));
    let matches = db.ai_search_conversations("ğateway").unwrap();
    assert_eq!(matches.as_array().unwrap().len(), 1);
    assert!(matches[0]["snippet"]
        .as_str()
        .unwrap()
        .contains("中文搜索🙂ĞATEWAY"));
    assert_eq!(
        db.ai_search_conversations("中文搜索")
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let scope = db.workspace_context().unwrap();
    let ws = db
        .create_workspace("private search", None, None, &scope.user_id)
        .unwrap();
    db.switch_workspace(&ws.id, &scope.user_id).unwrap();
    assert!(db
        .ai_search_conversations("中文搜索")
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn ai_workspace_deletion_cleans_foreign_keys_and_keeps_local_connections() {
    let db = database();
    let c = connection(&db, "http://127.0.0.1:1111/v1");
    let reference = ModelRef {
        connection_id: c.id.clone(),
        model_entry_id: c.models[0].id.clone(),
    };
    let conv = db.ai_create_conversation().unwrap();
    let (run, _, _) = db
        .ai_prepare_run(&request(&conv, &reference, "work"))
        .unwrap();
    finish(&db, &run, "done");
    db.ai_set_default("chat", &reference).unwrap();
    let scope = db.workspace_context().unwrap();
    let _ = db
        .create_workspace("remaining", None, None, &scope.user_id)
        .unwrap();
    db.delete_workspace(&scope.workspace_id, &scope.user_id)
        .unwrap();
    assert!(db.ai_run_in(&scope, &run.id).is_err());
    assert!(db.ai_conversations().unwrap().is_empty());
    let catalog = db.ai_catalog().unwrap();
    assert!(catalog
        .connections
        .iter()
        .any(|connection| connection.id == c.id && !connection.bound));
    assert_eq!(
        db.conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
}

#[test]
fn ai_workspace_dissolution_cleans_runs_shares_and_bindings_and_keeps_global_connections() {
    let db = database();
    let c = connection(&db, "http://127.0.0.1:1111/v1");
    let reference = ModelRef { connection_id: c.id.clone(), model_entry_id: c.models[0].id.clone() };
    let conversation = db.ai_create_conversation().unwrap();
    let (run, _, _) = db.ai_prepare_run(&request(&conversation, &reference, "work")).unwrap();
    finish(&db, &run, "done");
    db.ai_set_default("chat", &reference).unwrap();
    db.ai_share_conversation(&conversation.id).unwrap();
    let scope = db.workspace_context().unwrap();
    let ws = db.workspace_record().unwrap();
    db.dissolve_workspace(&ws.id, &scope.user_id, &ws.name).unwrap();
    assert!(db.ai_run_in(&scope, &run.id).is_err());
    assert!(db.ai_conversations().unwrap().is_empty());
    for table in ["ai_conversation_shares", "ai_runs", "ai_messages", "ai_conversations", "ai_model_defaults", "ai_model_bindings", "ai_connection_bindings"] {
        let count: i64 = db.conn.query_row(&format!("SELECT count(*) FROM {table} WHERE workspace_id=?"), [&scope.workspace_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "{table} retained dissolved data");
    }
    assert!(db.ai_catalog().unwrap().connections.iter().any(|item| item.id == c.id && !item.bound));
    assert_eq!(db.conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[cfg(windows)]
#[test]
fn ai_sealed_checkpoint_restores_final_content_in_original_scope_without_resurrection() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let c = connection(&db, "http://127.0.0.1:1111/v1");
    let reference = ModelRef {
        connection_id: c.id,
        model_entry_id: c.models[0].id.clone(),
    };
    let conv = db.ai_create_conversation().unwrap();
    let (mut run, mut message, _) = db
        .ai_prepare_run(&request(&conv, &reference, "work"))
        .unwrap();
    let scope = db.workspace_context().unwrap();
    run.status = "completed".into();
    run.seq = 12;
    message.status = "completed".into();
    message.content = "recovered 中文 final".into();
    let sealed =
        crate::ai_secrets::protect(&json!({"scope":scope,"run":run,"message":message}).to_string())
            .unwrap();
    let path = directory.path().join(format!("{}.sealed", run.id));
    std::fs::write(&path, &sealed).unwrap();
    let ws = db
        .create_workspace("other", None, None, &scope.user_id)
        .unwrap();
    db.switch_workspace(&ws.id, &scope.user_id).unwrap();
    db.install_ai_schema().unwrap();
    assert_eq!(
        crate::ai_runtime::recover_checkpoints(&db, directory.path()).unwrap(),
        1
    );
    assert_eq!(db.ai_run_in(&scope, &run.id).unwrap().status, "completed");
    assert!(db.ai_conversations().unwrap().is_empty());
    db.switch_workspace(&scope.workspace_id, &scope.user_id)
        .unwrap();
    assert_eq!(
        db.ai_message(&conv.id, &message.id).unwrap().content,
        "recovered 中文 final"
    );
    db.ai_delete_conversation(&conv.id).unwrap();
    std::fs::write(&path, &sealed).unwrap();
    assert_eq!(
        crate::ai_runtime::recover_checkpoints(&db, directory.path()).unwrap(),
        0
    );
    assert!(db.ai_conversations().unwrap().is_empty());
    assert!(!path.exists());
}

#[test]
fn ai_models_route_duplicate_remote_ids_and_keep_workspace_bindings_private() {
    let db = database();
    let a = connection(&db, "http://127.0.0.1:1111/v1");
    let b = connection(&db, "http://127.0.0.1:2222/v1");
    let a_ref = ModelRef {
        connection_id: a.id.clone(),
        model_entry_id: a.models[0].id.clone(),
    };
    let b_ref = ModelRef {
        connection_id: b.id.clone(),
        model_entry_id: b.models[0].id.clone(),
    };
    assert_eq!(
        db.ai_resolve_model("chat", Some(&a_ref))
            .unwrap()
            .2
            .base_url,
        a.base_url
    );
    assert_eq!(
        db.ai_resolve_model("chat", Some(&b_ref))
            .unwrap()
            .2
            .base_url,
        b.base_url
    );
    let user = db.current_user_id().unwrap();
    let origin = db.workspace_context().unwrap();
    let ws = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&ws.id, &user).unwrap();
    assert!(db.ai_resolve_model("chat", Some(&a_ref)).is_err());
    let unbound = db
        .ai_catalog()
        .unwrap()
        .connections
        .into_iter()
        .find(|c| c.id == a.id)
        .unwrap();
    assert!(!unbound.bound);
    let mut draft = serde_json::to_value(&unbound).unwrap();
    for key in [
        "revision",
        "configRevision",
        "hasCredential",
        "referenceCount",
    ] {
        draft.as_object_mut().unwrap().remove(key);
    }
    draft["expectedRevision"] = json!(unbound.revision);
    draft["bound"] = json!(true);
    draft["models"][0]["enabled"] = json!(true);
    db.save_ai_connection(serde_json::from_value(draft).unwrap())
        .unwrap();
    assert_eq!(
        db.ai_resolve_model("chat", Some(&a_ref))
            .unwrap()
            .2
            .base_url,
        a.base_url
    );
    db.switch_workspace(&origin.workspace_id, &user).unwrap();
    assert!(db.ai_resolve_model("chat", Some(&a_ref)).is_ok());
}
#[test]
fn ai_runs_are_idempotent_keep_multiround_history_and_branch_without_duplicate_user() {
    let db = database();
    let c = connection(&db, "http://127.0.0.1:1111/v1");
    let r = ModelRef {
        connection_id: c.id,
        model_entry_id: c.models[0].id.clone(),
    };
    let conv = db.ai_create_conversation().unwrap();
    let first = request(&conv, &r, "Remember: my code is 42");
    let (run, _, created) = db.ai_prepare_run(&first).unwrap();
    assert!(created);
    let repeated = db.ai_prepare_run(&first).unwrap();
    assert!(!repeated.2);
    assert_eq!(repeated.0.id, run.id);
    assert_eq!(db.ai_all_messages(&conv.id).unwrap().len(), 2);
    let mut conflict = first.clone();
    conflict.input = RunInput::NewMessage {
        client_message_id: id("user"),
        text: "different".into(),
    };
    assert_eq!(
        db.ai_prepare_run(&conflict).unwrap_err().code,
        "REQUEST_ID_CONFLICT"
    );
    let current = db.ai_conversation(&conv.id).unwrap();
    assert_eq!(
        db.ai_prepare_run(&request(&current, &r, "overlap"))
            .unwrap_err()
            .code,
        "RUN_BUSY"
    );
    finish(&db, &run, "Stored 42");
    let second = request(
        &db.ai_conversation(&conv.id).unwrap(),
        &r,
        "What is my code?",
    );
    let (run2, _, _) = db.ai_prepare_run(&second).unwrap();
    finish(&db, &run2, "42");
    let chain = db
        .ai_message_chain(
            &conv.id,
            db.ai_conversation(&conv.id)
                .unwrap()
                .head_message_id
                .as_deref(),
        )
        .unwrap();
    assert_eq!(chain.len(), 4);
    assert!(chain[0].content.contains("42"));
    assert_eq!(chain[1].content, "Stored 42");
    let mut retry = request(&db.ai_conversation(&conv.id).unwrap(), &r, "");
    retry.input = RunInput::Retry {
        user_message_id: run2.user_message_id.clone(),
        run_id: run2.id.clone(),
    };
    let (new_run, _, _) = db.ai_prepare_run(&retry).unwrap();
    assert_ne!(new_run.branch_id, run2.branch_id);
    let all = db.ai_all_messages(&conv.id).unwrap();
    assert_eq!(all.iter().filter(|m| m.role == "user").count(), 2);
    assert_eq!(all.iter().filter(|m| m.role == "assistant").count(), 3);
    assert_eq!(db.ai_conversation(&conv.id).unwrap().message_count, 4);
    let selected = db
        .ai_message_chain(
            &conv.id,
            db.ai_conversation(&conv.id)
                .unwrap()
                .head_message_id
                .as_deref(),
        )
        .unwrap();
    assert!(!selected.iter().any(|m| m.id == run2.assistant_message_id));
}
#[test]
fn ai_migration_preserves_legacy_and_rejects_old_snapshot_writers_and_cache_resurrection() {
    let db = database();
    let legacy = json!({"index":{"conversations":[{"id":"old","title":"History","createdAt":"2026-01-01T00:00:00Z"}]},"messages":{"old":[{"id":"u","role":"user","content":"原始中文"},{"id":"a","role":"assistant","content":"完整回答"}]}});
    db.save_private_data("ai", &legacy).unwrap();
    db.ai_import_legacy_cache(&legacy).unwrap();
    db.ai_import_legacy_cache(&legacy).unwrap();
    assert_eq!(db.ai_all_messages("old").unwrap().len(), 2);
    assert_eq!(db.ai_message("old", "u").unwrap().content, "原始中文");
    assert!(db
        .save_private_data("ai", &json!({"index":{"conversations":[]},"messages":{}}))
        .unwrap_err()
        .contains("AI_STORAGE_VERSION"));
    db.ai_delete_conversation("old").unwrap();
    db.ai_import_legacy_cache(&legacy).unwrap();
    assert!(db.ai_conversations().unwrap().is_empty());
}
#[test]
fn ai_terminal_recovery_writes_only_to_original_owner_and_never_resumes_runs() {
    let db = database();
    let c = connection(&db, "http://127.0.0.1:1111");
    let r = ModelRef {
        connection_id: c.id,
        model_entry_id: c.models[0].id.clone(),
    };
    let conv = db.ai_create_conversation().unwrap();
    let (mut run, _, _) = db.ai_prepare_run(&request(&conv, &r, "work")).unwrap();
    let original = db.workspace_context().unwrap();
    run.tool_calls.push(ToolCall {
        preview: None,
        id: "call".into(),
        name: "external_write".into(),
        arguments: json!({}),
        status: "running".into(),
        result: None,
        approval_id: None,
        summary: String::new(),
    });
    db.ai_put_run_in(&original, &run).unwrap();
    let ws = db
        .create_workspace("B", None, None, &original.user_id)
        .unwrap();
    db.switch_workspace(&ws.id, &original.user_id).unwrap();
    assert!(db.ai_conversations().unwrap().is_empty());
    db.install_ai_schema().unwrap();
    let recovered = db.ai_run_in(&original, &run.id).unwrap();
    assert_eq!(recovered.status, "interrupted");
    assert_eq!(recovered.tool_calls[0].status, "outcome_unknown");
    assert!(db.ai_conversations().unwrap().is_empty());
}
#[cfg(windows)]
#[test]
fn ai_credentials_are_protected_not_returned_or_left_in_legacy_json() {
    let db = database();
    db.save_llm_config(
        json!({"baseUrl":"http://local/v1","modelName":"local","apiKey":"private-key-for-test"}),
    )
    .unwrap();
    let catalog = db.ai_catalog().unwrap();
    let serialized = serde_json::to_string(&catalog).unwrap();
    assert!(!serialized.contains("private-key-for-test"));
    let c = &catalog.connections[0];
    assert!(c.has_credential);
    let r = ModelRef {
        connection_id: c.id.clone(),
        model_entry_id: c.models[0].id.clone(),
    };
    assert_eq!(
        db.ai_resolve_model("chat", Some(&r)).unwrap().2.api_key,
        "private-key-for-test"
    );
    let raw: String = db
        .conn
        .query_row(
            "SELECT payload_json FROM llm_connections LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!raw.contains("private-key-for-test"));
}

#[tokio::test]
async fn ai_provider_fixture_receives_full_history_and_cancels_a_hanging_request() {
    use axum::{extract::State, response::IntoResponse, routing::post, Router};
    use std::sync::{Arc, Mutex};
    let received = Arc::new(Mutex::new(Vec::<Value>::new()));
    let saved = received.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router=Router::new().route("/v1/chat/completions",post(|State(state):State<Arc<Mutex<Vec<Value>>>>,axum::Json(body):axum::Json<Value>|async move{
        state.lock().unwrap().push(body.clone());if body["model"]=="hang"{tokio::time::sleep(std::time::Duration::from_secs(60)).await;}
        ([("content-type","text/event-stream")],"data: {\"choices\":[{\"delta\":{\"content\":\"记住了42\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").into_response()
    })).with_state(saved);
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let mut config = crate::models::LlmConfig {
        generation_parameters: None,
        protocol: "openai".into(),
        base_url: format!("http://{address}/v1"),
        api_key: "fixture-only".into(),
        model_name: "model".into(),
    };
    let history = vec![
        json!({"role":"user","content":"code=42"}),
        json!({"role":"assistant","content":"remembered"}),
        json!({"role":"user","content":"what is the code?"}),
    ];
    let result = crate::ai_provider::complete(
        &config,
        &Default::default(),
        &history,
        &[],
        &tokio_util::sync::CancellationToken::new(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(result.text, "记住了42");
    assert_eq!(received.lock().unwrap()[0]["messages"], json!(history));
    config.model_name = "hang".into();
    let cancel = tokio_util::sync::CancellationToken::new();
    let copy = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        copy.cancel();
    });
    let start = std::time::Instant::now();
    let result =
        crate::ai_provider::complete(&config, &Default::default(), &history, &[], &cancel, |_| {
            Ok(())
        })
        .await;
    assert_eq!(result.unwrap_err().code, "CANCELLED");
    assert!(start.elapsed() < std::time::Duration::from_secs(2));
    server.abort();
}
