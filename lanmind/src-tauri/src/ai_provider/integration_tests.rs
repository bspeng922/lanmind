use super::*;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Fixture {
    requests: Mutex<Vec<Value>>,
    headers: Mutex<Vec<HeaderMap>>,
    cursors: Mutex<Vec<Option<String>>>,
}
async fn messages(
    State(state): State<Arc<Fixture>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    state.requests.lock().unwrap().push(body.clone());
    state.headers.lock().unwrap().push(headers);
    match body["model"].as_str().unwrap() {
        "hang" => tokio::time::sleep(Duration::from_secs(60)).await,
        "error" => return (StatusCode::UNAUTHORIZED, Json(json!({"error":{"message":"private-error-detail"}}))).into_response(),
        "json" => return Json(json!({"type":"message","content":[{"type":"text","text":"JSON 回复"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":2}})).into_response(),
        _ => {},
    }
    let use_tool = body["tools"].as_array().is_some_and(|v| !v.is_empty());
    let block = if use_tool {
        json!({"type":"tool_use","id":"fixture-call","name":"lanmind_echo","input":{"value":"42"}})
    } else {
        json!({"type":"text","text":"你好，42。"})
    };
    let events = vec![
        json!({"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}),
        json!({"type":"content_block_start","index":0,"content_block":block}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"message_delta","delta":{"stop_reason":if use_tool {"tool_use"} else {"end_turn"}},"usage":{"output_tokens":5}}),
        json!({"type":"message_stop"}),
    ];
    let source: String = events
        .iter()
        .map(|v| format!("event: {}\ndata: {v}\n\n", v["type"].as_str().unwrap()))
        .collect();
    let chunks: Vec<Result<Vec<u8>, std::convert::Infallible>> = source
        .as_bytes()
        .chunks(3)
        .map(|chunk| Ok(chunk.to_vec()))
        .collect();
    (
        [("content-type", "text/event-stream")],
        Body::from_stream(futures_util::stream::iter(chunks)),
    )
        .into_response()
}
async fn models(
    State(state): State<Arc<Fixture>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    state.headers.lock().unwrap().push(headers);
    state
        .cursors
        .lock()
        .unwrap()
        .push(query.get("after_id").cloned());
    assert_eq!(query.get("limit").map(String::as_str), Some("100"));
    Json(if query.get("after_id").is_none() {
        json!({"data":[{"id":"claude-z"}],"has_more":true,"last_id":"claude-z"})
    } else {
        json!({"data":[{"id":"claude-a"},{"id":"claude-z"}],"has_more":false,"last_id":"claude-a"})
    })
}
fn echo_tool() -> Value {
    json!({"type":"function","function":{"name":"lanmind_echo","description":"Returns the supplied value unchanged.","parameters":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}}})
}

#[tokio::test]
async fn anthropic_http_auth_pagination_tool_round_trip_json_and_cancellation() {
    let state = Arc::new(Fixture::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/proxy/v1/messages", post(messages))
        .route("/proxy/v1/models", get(models))
        .with_state(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let mut config = LlmConfig {
        protocol: "anthropic".into(),
        base_url: format!("http://{address}/proxy/v1"),
        api_key: "fixture-only-key".into(),
        model_name: "claude-fixture".into(),
        generation_parameters: None,
    };
    assert_eq!(
        discover(&config).await.unwrap(),
        vec!["claude-a", "claude-z"]
    );
    assert_eq!(
        *state.cursors.lock().unwrap(),
        vec![None, Some("claude-z".into())]
    );
    let mut history = vec![
        json!({"role":"system","content":"Remember the code"}),
        json!({"role":"user","content":"code=42"}),
    ];
    let first = complete(
        &config,
        &Default::default(),
        &history,
        &[echo_tool()],
        &CancellationToken::new(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert!(first.streamed);
    assert_eq!(first.calls[0]["id"], "fixture-call");
    history.push(json!({"role":"assistant","content":null,"tool_calls":first.calls}));
    history.push(json!({"role":"tool","tool_call_id":"fixture-call","content":"42"}));
    let mut emitted = String::new();
    let result = complete(
        &config,
        &Default::default(),
        &history,
        &[],
        &CancellationToken::new(),
        |text| {
            emitted.push_str(text);
            Ok(())
        },
    )
    .await
    .unwrap();
    assert_eq!(result.text, "你好，42。");
    assert_eq!(emitted, result.text);
    assert_eq!(result.finish, "stop");
    assert_eq!(
        result.usage,
        Some(json!({"input_tokens":10,"output_tokens":5}))
    );
    let received = state.requests.lock().unwrap()[1].clone();
    assert_eq!(received["system"], "Remember the code");
    assert_eq!(
        received["messages"][2]["content"][0],
        json!({"type":"tool_result","tool_use_id":"fixture-call","content":"42"})
    );
    for headers in state.headers.lock().unwrap().iter() {
        assert_eq!(headers["x-api-key"], "fixture-only-key");
        assert_eq!(headers["anthropic-version"], "2023-06-01");
        assert!(headers.get("authorization").is_none());
    }
    config.model_name = "json".into();
    let json = complete(
        &config,
        &Default::default(),
        &history,
        &[],
        &CancellationToken::new(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(json.text, "JSON 回复");
    assert!(!json.streamed);
    config.model_name = "error".into();
    let error = complete(
        &config,
        &Default::default(),
        &history,
        &[],
        &CancellationToken::new(),
        |_| Ok(()),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "AUTHENTICATION_FAILED");
    assert!(!error.message.contains("private-error-detail"));
    config.model_name = "hang".into();
    let cancel = CancellationToken::new();
    let child = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        child.cancel();
    });
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        complete(&config, &Default::default(), &history, &[], &cancel, |_| {
            Ok(())
        }),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap_err().code, "CANCELLED");
    server.abort();
}

#[test]
fn anthropic_registry_routes_saved_and_legacy_models_without_exposing_credentials() {
    let db = crate::db::Database::open(std::path::Path::new(":memory:")).unwrap();
    // Windows can exercise DPAPI without an interactive system keychain.
    let key = if cfg!(windows) { "fixture-only-key" } else { "" };
    let saved = db.save_ai_connection(serde_json::from_value(json!({"name":"Anthropic gateway","providerType":"anthropic-compatible","baseUrl":"http://fixture:3000/v1/messages","credentialChange":{"action":"replace","value":key},"models":[{"id":"","remoteModelId":"claude-fixture","displayName":"Claude","parameters":{}}]})).unwrap()).unwrap();
    let reference = ModelRef {
        connection_id: saved.id.clone(),
        model_entry_id: saved.models[0].id.clone(),
    };
    let (_, _, config) = db.ai_resolve_model("chat", Some(&reference)).unwrap();
    assert_eq!(config.protocol, "anthropic");
    assert_eq!(config.base_url, "http://fixture:3000/v1");
    assert_eq!(config.api_key, key);
    assert_eq!(
        db.ai_connection_config(&saved.id).unwrap().protocol,
        "anthropic"
    );
    assert!(!serde_json::to_string(&db.ai_catalog().unwrap())
        .unwrap()
        .contains("fixture-only-key"));

    let legacy = crate::db::Database::open(std::path::Path::new(":memory:")).unwrap();
    legacy.save_llm_config(json!({"protocol":"anthropic","baseUrl":"http://fixture:3000","modelName":"legacy-claude","apiKey":key})).unwrap();
    let catalog = legacy.ai_catalog().unwrap();
    assert_eq!(catalog.connections[0].provider_type, "anthropic-compatible");
    assert_eq!(legacy.ai_config_for("chat").unwrap().protocol, "anthropic");
    assert_eq!(
        legacy.ai_config_for("chat").unwrap().api_key,
        key
    );
}

async fn bearer_models(
    State(state): State<Arc<Fixture>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let authorized = headers.get("authorization").and_then(|value| value.to_str().ok()) == Some("Bearer fixture-catalog-key");
    state.headers.lock().unwrap().push(headers);
    if !authorized {
        return (StatusCode::UNAUTHORIZED, "private upstream error").into_response();
    }
    state.cursors.lock().unwrap().push(query.get("after_id").cloned());
    Json(if query.contains_key("after_id") {
        json!({"data":[{"id":"claude-a"}],"has_more":false})
    } else {
        json!({"data":[{"id":"claude-z"}],"has_more":true,"last_id":"claude-z"})
    }).into_response()
}

#[tokio::test]
async fn anthropic_discovery_uses_bearer_catalog_fallback_and_preserves_messages_auth() {
    let state = Arc::new(Fixture::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/v1/models", get(bearer_models))
        .route("/v1/messages", post(messages))
        .with_state(state.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
    let config = LlmConfig {
        protocol: "anthropic".into(), base_url: format!("http://{address}/v1"),
        api_key: "fixture-catalog-key".into(), model_name: "claude-fixture".into(), generation_parameters: None,
    };
    assert_eq!(discover(&config).await.unwrap(), vec!["claude-a", "claude-z"]);
    assert_eq!(*state.cursors.lock().unwrap(), vec![None, Some("claude-z".into())]);
    complete(&config, &Default::default(), &[json!({"role":"user","content":"Hello"})], &[], &CancellationToken::new(), |_| Ok(())).await.unwrap();
    let headers = state.headers.lock().unwrap();
    assert_eq!(headers.len(), 4);
    assert_eq!(headers[0]["x-api-key"], "fixture-catalog-key");
    assert!(headers[0].get("authorization").is_none());
    for request in &headers[1..3] {
        assert_eq!(request["authorization"], "Bearer fixture-catalog-key");
        assert!(request.get("x-api-key").is_none());
    }
    assert_eq!(headers[3]["x-api-key"], "fixture-catalog-key");
    assert!(headers[3].get("authorization").is_none());
    server.abort();
}

#[test]
fn discovery_preview_uses_unsaved_settings_without_writing_credentials_or_connections() {
    let db = crate::db::Database::open(std::path::Path::new(":memory:")).unwrap();
    let key = if cfg!(windows) { "fixture-saved-key" } else { "" };
    let saved = db.save_ai_connection(serde_json::from_value(json!({
        "name":"Saved", "providerType":"openai-compatible", "baseUrl":"http://saved.invalid/v1",
        "credentialChange":{"action":"replace","value":key}
    })).unwrap()).unwrap();
    let before = serde_json::to_value(db.ai_catalog().unwrap()).unwrap();
    let draft = |id: Option<&str>, change: Value| serde_json::from_value(json!({
        "id":id, "name":"Unsaved", "providerType":"anthropic-compatible",
        "baseUrl":"http://preview.invalid/v1/messages", "credentialChange":change
    })).unwrap();
    let preview = db.ai_connection_preview_config(draft(Some(&saved.id), json!({"action":"replace","value":" fixture-preview-key "}))).unwrap();
    assert_eq!(preview.protocol, "anthropic");
    assert_eq!(preview.base_url, "http://preview.invalid/v1");
    assert_eq!(preview.api_key, "fixture-preview-key");
    assert_eq!(db.ai_connection_preview_config(draft(Some(&saved.id), json!({"action":"keep"}))).unwrap().api_key, key);
    assert!(db.ai_connection_preview_config(draft(Some(&saved.id), json!({"action":"clear"}))).unwrap().api_key.is_empty());
    assert_eq!(db.ai_connection_preview_config(draft(None, json!({"action":"replace","value":"temporary-key"}))).unwrap().api_key, "temporary-key");
    assert!(db.ai_connection_preview_config(draft(Some("missing-connection"), json!({"action":"keep"}))).is_err());
    assert_eq!(serde_json::to_value(db.ai_catalog().unwrap()).unwrap(), before);
    assert_eq!(db.ai_connection_config(&saved.id).unwrap().api_key, key);
}

#[tokio::test]
async fn discovery_errors_distinguish_auth_missing_endpoint_html_and_invalid_request() {
    async fn status(axum::extract::Path(code): axum::extract::Path<u16>) -> Response {
        (StatusCode::from_u16(code).unwrap(), "private-upstream-detail").into_response()
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/status/{code}/models", get(status))
        .route("/html/models", get(|| async { ([("content-type", "text/html")], "<html>private-upstream-detail</html>") }));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
    let mut config = LlmConfig {
        protocol: "openai".into(), base_url: String::new(), api_key: "fixture-private-key".into(),
        model_name: String::new(), generation_parameters: None,
    };
    for (status, code, hint) in [(401, "AUTHENTICATION_FAILED", "鉴权"), (403, "AUTHENTICATION_FAILED", "鉴权"),
        (404, "PROVIDER_ERROR", "手动添加"), (405, "PROVIDER_ERROR", "手动添加"), (502, "PROVIDER_ERROR", "HTTP 502")]
    {
        config.base_url = format!("http://{address}/status/{status}");
        let error = discover(&config).await.unwrap_err();
        assert_eq!(error.code, code);
        assert!(error.message.contains(hint));
        assert!(!error.message.contains("private-upstream-detail"));
        assert!(!error.message.contains("fixture-private-key"));
    }
    config.base_url = format!("http://{address}/html");
    let error = discover(&config).await.unwrap_err();
    assert_eq!(error.code, "INVALID_RESPONSE");
    assert!(error.message.contains("网页"));
    config.api_key = "invalid\nprivate-key".into();
    assert_eq!(discover(&config).await.unwrap_err().code, "INVALID_CONFIGURATION");
    server.abort();
}

#[tokio::test]
#[ignore = "Requires explicit live gateway configuration and uses API quota"]
async fn anthropic_live_gateway_stream_and_tool_round_trip() {
    let config = LlmConfig {
        protocol: "anthropic".into(),
        base_url: crate::ai_models::normalize_base_url(
            &std::env::var("LANMIND_ANTHROPIC_TEST_URL").expect("Set LANMIND_ANTHROPIC_TEST_URL"),
            "anthropic-compatible",
        )
        .unwrap(),
        api_key: std::env::var("LANMIND_ANTHROPIC_TEST_KEY")
            .expect("Set LANMIND_ANTHROPIC_TEST_KEY"),
        model_name: std::env::var("LANMIND_ANTHROPIC_TEST_MODEL")
            .expect("Set LANMIND_ANTHROPIC_TEST_MODEL"),
        generation_parameters: None,
    };
    assert!(discover(&config)
        .await
        .unwrap()
        .contains(&config.model_name));
    let parameters = ModelParameters {
        max_output_tokens: Some(256),
        ..Default::default()
    };
    let cancel = CancellationToken::new();
    let mut emitted = String::new();
    let chat = complete(&config, &parameters, &[json!({"role":"system","content":"Follow the user's instructions precisely and keep replies brief."}),json!({"role":"user","content":"Reply with exactly: LanMind 42"})], &[], &cancel, |s| { emitted.push_str(s); Ok(()) }).await.unwrap();
    assert!(chat.streamed);
    assert!(chat.text.contains("LanMind 42"));
    assert_eq!(chat.text, emitted);
    let nonce = id("probe");
    let mut history = vec![
        json!({"role":"user","content":format!("Call lanmind_echo exactly once with value {nonce}. Then repeat its returned value in your final answer. You must call the tool before answering.")}),
    ];
    let first = complete(
        &config,
        &parameters,
        &history,
        &[echo_tool()],
        &cancel,
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert!(first.streamed);
    assert_eq!(first.calls.len(), 1);
    assert_eq!(first.calls[0]["function"]["name"], "lanmind_echo");
    let arguments: Value =
        serde_json::from_str(first.calls[0]["function"]["arguments"].as_str().unwrap()).unwrap();
    assert_eq!(arguments["value"], nonce);
    history.push(json!({"role":"assistant","content":first.text,"tool_calls":first.calls}));
    history.push(json!({"role":"tool","tool_call_id":first.calls[0]["id"],"content":json!({"value":nonce}).to_string()}));
    let result = complete(&config, &parameters, &history, &[], &cancel, |_| Ok(()))
        .await
        .unwrap();
    assert!(result.streamed);
    assert!(result.calls.is_empty());
    assert!(result.text.contains(&nonce));
}
