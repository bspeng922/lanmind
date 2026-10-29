//! One scoped IPC boundary for the versioned AI subsystem.
use crate::{ai_runtime::scoped, ai_types::*, workspace_scope::WorkspaceContext, AppState};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;
fn string<'a>(p: &'a Value, k: &str) -> AiResult<&'a str> {
    p[k].as_str()
        .ok_or_else(|| AiError::new("INVALID_ARGUMENTS", format!("缺少 {k}")))
}
fn revision(p: &Value) -> AiResult<i64> {
    p["revision"]
        .as_i64()
        .ok_or_else(|| AiError::new("INVALID_ARGUMENTS", "缺少 revision"))
}
#[tauri::command]
pub async fn ai_api(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    workspace_context: WorkspaceContext,
    action: String,
    payload: Value,
) -> AiResult<Value> {
    scoped(&state.db, &workspace_context, |db| {
        db.require_feature("ai")?;
        if action.starts_with("wiki.") { db.require_feature("wiki")?; }
        Ok(())
    })?;
    if state.app_lock.status()?.locked {
        return Err(AiError::new("APP_LOCKED", "请先解锁应用"));
    }
    let scope = &workspace_context;
    match action.as_str() {
        "wiki.polish.start" => crate::wiki_polish::start(window, &state, workspace_context.clone(), serde_json::from_value(payload)?),
        "wiki.polish.cancel" => {
            state.ai.wiki_polish.cancel(scope, string(&payload, "requestId")?)?;
            Ok(Value::Null)
        }
        "bootstrap" => scoped(&state.db, scope, |db| {
            db.ai_import_legacy_cache(&payload)?;
            Ok(
                json!({"schemaVersion":2,"catalog":db.ai_catalog()?,"conversations":db.ai_conversations()?,"extensions":db.ai_extensions()?,"schedules":schedules(db)?,"roots":state.ai.roots.list(scope)?}),
            )
        }),
        "catalog" => scoped(&state.db, scope, |db| Ok(json!(db.ai_catalog()?))),
        "connection.save" => {
            let draft: ConnectionDraft = serde_json::from_value(payload)?;
            let previous = scoped(&state.db, scope, |db| {
                Ok(db
                    .ai_catalog()?
                    .connections
                    .into_iter()
                    .find(|c| Some(&c.id) == draft.id.as_ref()))
            })?;
            let saved = scoped(&state.db, scope, |db| db.save_ai_connection(draft))?;
            if previous
                .as_ref()
                .is_some_and(|c| c.config_revision != saved.config_revision)
            {
                state.ai.cancel_connection(&saved.id);
            } else if !saved.bound
                || previous.as_ref().is_some_and(|c| {
                    c.models.iter().any(|m| {
                        m.enabled && !saved.models.iter().any(|new| new.id == m.id && new.enabled)
                    })
                })
            {
                state.ai.cancel_binding(scope, &saved.id);
            }
            let _ = tauri::Emitter::emit(&app, "ai://catalog", json!({"userId":scope.user_id}));
            Ok(json!(saved))
        }
        "connection.delete" => {
            let id = string(&payload, "id")?;
            scoped(&state.db, scope, |db| {
                db.ai_delete_connection(id, revision(&payload)?)
            })?;
            state.ai.cancel_connection(id);
            Ok(Value::Null)
        }
        "default.set" => scoped(&state.db, scope, |db| {
            db.ai_set_default(
                string(&payload, "purpose")?,
                &serde_json::from_value::<ModelRef>(payload["modelRef"].clone())?,
            )?;
            Ok(Value::Null)
        }),
        "connection.discover" => {
            let config = scoped(&state.db, scope, |db| {
                db.ai_connection_config(string(&payload, "id")?)
            })?;
            let models = crate::ai_provider::discover(&config).await?;
            scoped(&state.db, scope, |_| Ok(json!(models)))
        }
        "model.test" => {
            let reference: ModelRef = serde_json::from_value(payload["modelRef"].clone())?;
            let (conn, _, config) = scoped(&state.db, scope, |db| {
                db.ai_resolve_model("chat", Some(&reference))
            })?;
            let tools = payload["tools"] == true;
            let started = std::time::Instant::now();
            let cancel = CancellationToken::new();
            let result=tokio::time::timeout(std::time::Duration::from_secs(90),async{
                let parameters=ModelParameters{temperature:Some(0.0),max_output_tokens:Some(128),..Default::default()};
                let streamed = if tools{
                    let nonce=id("probe");let mut messages=vec![json!({"role":"user","content":format!("Call the lanmind_echo tool exactly once with value {nonce}, then repeat its returned value in your final answer.")})];
                    let spec=json!({"type":"function","function":{"name":"lanmind_echo","description":"Harmless local capability test.","parameters":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}}});
                    let first=crate::ai_provider::complete(&config,&parameters,&messages,&[spec.clone()],&cancel,|_|Ok(())).await?;
                    if first.calls.len()!=1 || first.calls[0]["function"]["name"]!="lanmind_echo"{return Err(AiError::new("CAPABILITY_TEST_FAILED","模型没有返回原生工具调用，请检查服务端工具解析配置"));}
                    let args:Value=serde_json::from_str(first.calls[0]["function"]["arguments"].as_str().unwrap())?;
                    if args["value"]!=nonce{return Err(AiError::new("CAPABILITY_TEST_FAILED","工具参数回传不正确"));}
                    messages.push(json!({"role":"assistant","content":null,"tool_calls":first.calls}));messages.push(json!({"role":"tool","tool_call_id":first.calls[0]["id"],"content":json!({"value":nonce}).to_string()}));
                    let final_answer=crate::ai_provider::complete(&config,&parameters,&messages,&[],&cancel,|_|Ok(())).await?;
                    if !final_answer.calls.is_empty()||!final_answer.text.contains(&nonce){return Err(AiError::new("CAPABILITY_TEST_FAILED","模型未能继续读取工具结果"));}
                    first.streamed && final_answer.streamed
                }else{crate::ai_provider::complete(&config,&parameters,&[json!({"role":"user","content":"Reply with OK."})],&[],&cancel,|_|Ok(())).await?.streamed};
                Ok::<_,AiError>(streamed)
            }).await.map_err(|_|AiError::new("PROVIDER_TIMEOUT","模型测试超时"))?;
            let verified = result.is_ok();
            scoped(&state.db, scope, |db| {
                db.ai_update_capabilities(
                    &reference,
                    conn.config_revision,
                    if tools { Some(verified) } else { None },
                    result.as_ref().ok().copied(),
                )
            })?;
            result?;
            Ok(
                json!({"success":true,"latencyMs":started.elapsed().as_millis(),"toolsVerified":tools}),
            )
        }
        "conversations" => scoped(&state.db, scope, |db| Ok(json!(db.ai_conversations()?))),
        "conversations.search" => scoped(&state.db, scope, |db| {
            db.ai_search_conversations(string(&payload, "query")?)
        }),
        "conversation.create" => scoped(&state.db, scope, |db| {
            Ok(json!(db.ai_create_conversation()?))
        }),
        "conversation.view" => scoped(&state.db, scope, |db| db.ai_view(string(&payload, "id")?)),
        "conversation.share" => scoped(&state.db, scope, |db| db.ai_share_conversation(string(&payload, "id")?)),
        "conversation.poll" => scoped(&state.db, scope, |db| {
            let id = string(&payload, "id")?;
            let conv = db.ai_conversation(id)?;
            let latest = db.ai_runs_for_conversation(id)?.into_iter().next();
            if payload["knownRevision"].as_i64() == Some(conv.revision)
                && payload["knownRunId"].as_str() == latest.as_ref().map(|r| r.id.as_str())
                && payload["knownRunSeq"].as_u64() == latest.as_ref().map(|r| r.seq)
            {
                Ok(Value::Null)
            } else {
                db.ai_view(id)
            }
        }),
        "conversation.patch" => scoped(&state.db, scope, |db| {
            Ok(json!(db.ai_patch_conversation(
                string(&payload, "id")?,
                revision(&payload)?,
                payload["patch"].clone()
            )?))
        }),
        "conversation.delete" => scoped(&state.db, scope, |db| {
            db.ai_delete_conversation(string(&payload, "id")?)?;
            Ok(Value::Null)
        }),
        "message.patch" => scoped(&state.db, scope, |db| {
            let conversation_id = string(&payload, "conversationId")?;
            let id = string(&payload, "id")?;
            let mut message = db.ai_message(conversation_id, id)?;
            if let Some(content) = payload["content"].as_str() {
                message.content = content.to_string();
            }
            db.ai_put_message_in(scope, conversation_id, &message)?;
            Ok(json!(message))
        }),
        "run.start" => Ok(json!(state.ai.start(
            app.clone(),
            workspace_context,
            serde_json::from_value(payload)?,
            false
        )?)),
        "run.cancel" => {
            state.ai.cancel(scope, string(&payload, "id")?)?;
            Ok(Value::Null)
        }
        "run.decide" => {
            state.ai.decide(
                scope,
                string(&payload, "id")?,
                string(&payload, "approvalId")?,
                payload["decision"].clone(),
            )?;
            Ok(Value::Null)
        }
        "run.get" => scoped(&state.db, scope, |db| {
            Ok(json!(db.ai_run_in(scope, string(&payload, "id")?)?))
        }),
        "root.grant" => state.ai.roots.grant(
            workspace_context,
            string(&payload, "path")?,
            payload["allowCreate"] == true,
        ),
        "roots" => Ok(json!(state.ai.roots.list(scope)?)),
        "document.extract" => {
            use base64::Engine;
            let data = string(&payload, "data")?;
            if data.len() > 27_000_000 {
                return Err(AiError::new("FILE_LIMIT", "附件最多 20 MB"));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| AiError::new("INVALID_DATA", "附件编码无效"))?;
            let name = string(&payload, "name")?.to_string();
            let text =
                tokio::task::spawn_blocking(move || crate::ai_documents::extract(&name, &bytes))
                    .await
                    .map_err(|_| AiError::new("DOCUMENT_ERROR", "文档处理失败"))??;
            scoped(&state.db, scope, |_| Ok(json!(text)))
        }
        "root.revoke" => {
            state.ai.roots.revoke(scope, string(&payload, "id")?)?;
            state.ai.cancel_runs();
            Ok(Value::Null)
        }
        "file.open" => {
            let root = state.ai.roots.get(scope, string(&payload, "rootId")?)?;
            let path = string(&payload, "path")?;
            root.read_bytes(path, 20_000_000)?;
            let target = root.path.join(crate::ai_files::safe_relative(path)?);
            crate::show_item_in_folder(target.to_string_lossy().into_owned())?;
            Ok(Value::Null)
        }
        "file.restore" => {
            let artifact = &payload["artifact"];
            let run_id = string(&payload, "runId")?;
            scoped(&state.db, scope, |db| {
                let run = db.ai_run_in(scope, run_id)?;
                if !run.artifacts.contains(artifact) {
                    return Err(AiError::new("PERMISSION_DENIED", "恢复记录不属于此运行"));
                }
                Ok(())
            })?;
            let root = state.ai.roots.get(scope, string(&payload, "rootId")?)?;
            if root.path.to_string_lossy() != artifact["rootPath"].as_str().unwrap_or("") {
                return Err(AiError::new("ROOT_NOT_AUTHORIZED", "请选择原文件所在目录"));
            }
            let backup_dir = app
                .path()
                .app_data_dir()
                .map_err(|_| "应用数据目录不可用")?
                .join("ai-backups");
            root.restore(
                string(artifact, "path")?,
                string(artifact, "afterHash")?,
                string(artifact, "backupId")?,
                &backup_dir,
            )
        }
        "extensions" => scoped(&state.db, scope, |db| Ok(json!(db.ai_extensions()?))),
        "skill.import" => {
            let draft = crate::ai_extensions::import_skill(string(&payload, "path")?)?;
            scoped(&state.db, scope, |db| {
                Ok(json!(db.ai_save_extension(draft)?))
            })
        }
        "extension.save" => {
            let saved = scoped(&state.db, scope, |db| {
                db.ai_save_extension(serde_json::from_value(payload)?)
            })?;
            if saved.kind == "mcp" || !saved.enabled {
                state.ai.cancel_extension(scope, &saved.id);
            }
            Ok(json!(saved))
        }
        "extension.delete" => {
            let id = string(&payload, "id")?;
            scoped(&state.db, scope, |db| {
                db.ai_delete_extension(id, revision(&payload)?)
            })?;
            state.ai.cancel_extension(scope, id);
            Ok(Value::Null)
        }
        "mcp.discover" => {
            let (extension, secret) = scoped(&state.db, scope, |db| {
                let id = string(&payload, "id")?;
                Ok((db.ai_extension(id)?, db.ai_extension_secret(id)?))
            })?;
            if extension.kind != "mcp" {
                return Err(AiError::new("INVALID_CONFIGURATION", "请选择 MCP 连接"));
            }
            let session = crate::ai_mcp_client::McpSession::connect(
                extension,
                secret,
                &CancellationToken::new(),
            )
            .await?;
            scoped(&state.db, scope, |_| {
                Ok(json!(session.tools.values().collect::<Vec<_>>()))
            })
        }
        "schedules" => scoped(&state.db, scope, |db| Ok(json!(schedules(db)?))),
        "schedule.save" => scoped(&state.db, scope, |db| {
            Ok(json!(save_schedule(db, payload)?))
        }),
        "schedule.delete" => scoped(&state.db, scope, |db| {
            let ctx = db.workspace_context()?;
            if db.conn.execute("DELETE FROM ai_schedules WHERE workspace_id=? AND user_id=? AND id=? AND json_extract(payload_json,'$.revision')=?",params![ctx.workspace_id,ctx.user_id,string(&payload,"id")?,revision(&payload)?])?!=1{return Err(AiError::new("CONFIG_CONFLICT","定时任务已修改"));}
            Ok(Value::Null)
        }),
        "schedule.runs" => scoped(&state.db, scope, |db| {
            let id = string(&payload, "id")?;
            let ctx = db.workspace_context()?;
            let pattern = format!("schedule:{}%", id);
            let last_run_id = payload["lastRunId"].as_str().unwrap_or("");
            let mut stmt = db.conn.prepare(
                "SELECT payload_json FROM ai_runs WHERE workspace_id=? AND user_id=? AND (client_request_id LIKE ? OR id=?) ORDER BY rowid DESC LIMIT 100",
            )?;
            let rows: Vec<Value> = stmt
                .query_map(params![ctx.workspace_id, ctx.user_id, pattern, last_run_id], |r| {
                    r.get::<_, String>(0)
                })?
                .filter_map(|r| r.ok())
                .filter_map(|json_str| {
                    let mut run_val: Value = serde_json::from_str(&json_str).ok()?;
                    if let (Some(conv_id), Some(user_msg_id)) = (
                        run_val["conversationId"].as_str(),
                        run_val["userMessageId"].as_str(),
                    ) {
                        if let Ok(msg) = db.ai_message(conv_id, user_msg_id) {
                            run_val["inputText"] = json!(msg.content);
                        }
                    }
                    if let (Some(conv_id), Some(asst_msg_id)) = (
                        run_val["conversationId"].as_str(),
                        run_val["assistantMessageId"].as_str(),
                    ) {
                        if let Ok(msg) = db.ai_message(conv_id, asst_msg_id) {
                            run_val["outputText"] = json!(msg.content);
                        }
                    }
                    Some(run_val)
                })
                .collect();
            Ok(json!(rows))
        }),
        "schedule.run_now" => {
            let schedule_id = string(&payload, "id")?;
            let schedule = scoped(&state.db, scope, |db| {
                schedules(db)?
                    .into_iter()
                    .find(|s| s.id == schedule_id)
                    .ok_or_else(|| AiError::new("SCHEDULE_NOT_FOUND", "定时任务不存在"))
            })?;
            let conv = scoped(&state.db, scope, |db| {
                let conv = db.ai_create_conversation()?;
                let _ = db.ai_patch_conversation(
                    &conv.id,
                    conv.revision,
                    json!({"title": format!("{} (手动触发)", schedule.name)}),
                );
                db.ai_conversation(&conv.id)
            })?;
            let request = RunRequest {
                client_request_id: format!("schedule:{}:manual:{}", schedule.id, id("run")),
                conversation_id: conv.id,
                branch_id: conv.branch_id,
                expected_head_message_id: conv.head_message_id,
                expected_conversation_version: conv.revision,
                input: RunInput::NewMessage {
                    client_message_id: id("scheduled-message"),
                    text: schedule.prompt.clone(),
                },
                model_ref: Some(schedule.model_ref.clone()),
                mode: "workspace".into(),
                skill_ids: schedule.skill_ids.clone(),
                root_ids: vec![],
                mcp_ids: vec![],
                parameters: None,
            };
            let run = state.ai.start(app.clone(), scope.clone(), request, false)?;
            let _ = scoped(&state.db, scope, |db| {
                if let Ok(Some(mut latest)) = schedules(db).map(|list| list.into_iter().find(|s| s.id == schedule.id)) {
                    latest.last_run_id = Some(run.id.clone());
                    latest.revision += 1;
                    let _ = db.conn.execute(
                        "UPDATE ai_schedules SET payload_json=? WHERE workspace_id=? AND user_id=? AND id=?",
                        params![serde_json::to_string(&latest)?, scope.workspace_id, scope.user_id, latest.id],
                    );
                }
                Ok(())
            });
            Ok(json!(run))
        }
        _ => Err(AiError::new("UNKNOWN_ACTION", "未知 AI 操作")),
    }
}
impl crate::db::Database {
    pub(crate) fn ai_connection_config(&self, id: &str) -> AiResult<crate::models::LlmConfig> {
        let connection = self
            .ai_catalog()?
            .connections
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AiError::new("MODEL_UNAVAILABLE", "连接不存在"))?;
        let ctx = self.workspace_context()?;
        let secret:Option<String>=self.conn.query_row("SELECT protected_secret FROM ai_model_connections WHERE user_id=? AND id=? AND deleted=0",params![ctx.user_id,id],|r|r.get(0))?;
        Ok(crate::models::LlmConfig {
            generation_parameters: None,
            protocol: "openai".into(),
            base_url: connection.base_url,
            api_key: secret
                .map(|s| crate::ai_secrets::reveal(&s))
                .transpose()?
                .unwrap_or_default(),
            model_name: String::new(),
        })
    }
}
fn schedules(db: &crate::db::Database) -> AiResult<Vec<AiSchedule>> {
    let ctx = db.workspace_context()?;
    let mut stmt=db.conn.prepare("SELECT payload_json FROM ai_schedules WHERE workspace_id=? AND user_id=? ORDER BY next_run_at")?;
    let rows = stmt
        .query_map(params![ctx.workspace_id, ctx.user_id], |r| {
            r.get::<_, String>(0)
        })?
        .map(|r| Ok(serde_json::from_str::<AiSchedule>(&r?)?))
        .collect();
    rows
}
fn save_schedule(db: &crate::db::Database, payload: Value) -> AiResult<AiSchedule> {
    let mut schedule: AiSchedule = serde_json::from_value(payload)?;
    if schedule.name.trim().is_empty()
        || schedule.prompt.trim().is_empty()
        || schedule.prompt.len() > 100_000
        || !["once", "hourly", "daily", "weekly"].contains(&schedule.frequency.as_str())
    {
        return Err(AiError::new(
            "INVALID_CONFIGURATION",
            "定时任务名称、提示词或频率无效",
        ));
    }
    let date = chrono::DateTime::parse_from_rfc3339(&schedule.next_run_at)
        .map_err(|_| AiError::new("INVALID_CONFIGURATION", "请选择有效的执行时间"))?;
    schedule.next_run_at = date
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    // A paused task must remain editable even when its provider is disabled or removed.
    if schedule.enabled {
        db.ai_resolve_model("agent", Some(&schedule.model_ref))?;
    }
    let old = schedules(db)?.into_iter().find(|s| s.id == schedule.id);
    if old
        .as_ref()
        .is_some_and(|s| s.revision != schedule.revision)
    {
        return Err(AiError::new("CONFIG_CONFLICT", "定时任务已修改"));
    }
    if old.is_none() {
        schedule.id = id("schedule");
        schedule.last_run_id = None;
        schedule.last_error = None;
    }
    schedule.revision = old.map_or(1, |s| s.revision + 1);
    let ctx = db.workspace_context()?;
    db.conn.execute("INSERT INTO ai_schedules VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,id) DO UPDATE SET payload_json=excluded.payload_json,next_run_at=excluded.next_run_at,enabled=excluded.enabled",params![ctx.workspace_id,ctx.user_id,schedule.id,serde_json::to_string(&schedule)?,schedule.next_run_at,schedule.enabled])?;
    Ok(schedule)
}
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            let state = app.state::<AppState>();
            if state.app_lock.status().is_ok_and(|s| s.locked) {
                continue;
            }
            let prepared = (|| -> AiResult<_> {
                let db = state.db.lock().map_err(|_| "数据库暂时不可用")?;
                let scope = db.workspace_context()?;
                db.require_feature("ai")?;
                let due = schedules(&db)?
                    .into_iter()
                    .filter(|s| s.enabled && s.next_run_at <= now())
                    .take(5)
                    .collect::<Vec<_>>();
                Ok((scope, due))
            })();
            let Ok((scope, due)) = prepared else {
                continue;
            };
            for mut schedule in due {
                // Claim/advance before launch. A crash never replays an old scheduled write.
                let claimed = scoped(&state.db, &scope, |db| {
                    db.require_feature("ai")?;
                    let current:Option<String>=db.conn.query_row("SELECT payload_json FROM ai_schedules WHERE workspace_id=? AND user_id=? AND id=? AND enabled=1 AND next_run_at=?",params![scope.workspace_id,scope.user_id,schedule.id,schedule.next_run_at],|r|r.get(0)).optional()?;
                    if current.is_none() {
                        return Ok(None);
                    }
                    let step = match schedule.frequency.as_str() {
                        "hourly" => chrono::Duration::hours(1),
                        "daily" => chrono::Duration::days(1),
                        "weekly" => chrono::Duration::weeks(1),
                        _ => chrono::Duration::zero(),
                    };
                    schedule.enabled = schedule.frequency != "once";
                    schedule.next_run_at = (chrono::Utc::now() + step)
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                    schedule.revision += 1;
                    db.conn.execute("UPDATE ai_schedules SET next_run_at=?,enabled=?,payload_json=? WHERE workspace_id=? AND user_id=? AND id=?",params![schedule.next_run_at,schedule.enabled,serde_json::to_string(&schedule)?,scope.workspace_id,scope.user_id,schedule.id])?;
                    let conversation = db.ai_create_conversation()?;
                    let _ = db.ai_patch_conversation(
                        &conversation.id,
                        conversation.revision,
                        json!({"title":schedule.name}),
                    );
                    Ok(Some(db.ai_conversation(&conversation.id)?))
                });
                let Ok(Some(conv)) = claimed else {
                    continue;
                };
                let request = RunRequest {
                    client_request_id: format!("schedule:{}:{}", schedule.id, schedule.revision),
                    conversation_id: conv.id,
                    branch_id: conv.branch_id,
                    expected_head_message_id: conv.head_message_id,
                    expected_conversation_version: conv.revision,
                    input: RunInput::NewMessage {
                        client_message_id: id("scheduled-message"),
                        text: schedule.prompt.clone(),
                    },
                    model_ref: Some(schedule.model_ref.clone()),
                    mode: "workspace".into(),
                    skill_ids: schedule.skill_ids.clone(),
                    root_ids: vec![],
                    mcp_ids: vec![],
                    parameters: None,
                };
                let result = state.ai.start(app.clone(), scope.clone(), request, true);
                let _ = scoped(&state.db, &scope, |db| {
                    let mut latest = schedules(db)?
                        .into_iter()
                        .find(|s| s.id == schedule.id)
                        .ok_or("定时任务已删除")?;
                    match &result {
                        Ok(run) => {
                            latest.last_run_id = Some(run.id.clone());
                            latest.last_error =
                                db.ai_run_in(&scope, &run.id)?.error.map(|e| e.message);
                        }
                        Err(error) => latest.last_error = Some(error.message.clone()),
                    }
                    latest.revision += 1;
                    db.conn.execute("UPDATE ai_schedules SET payload_json=? WHERE workspace_id=? AND user_id=? AND id=?",params![serde_json::to_string(&latest)?,scope.workspace_id,scope.user_id,latest.id])?;
                    Ok(())
                });
            }
        }
    });
}

#[cfg(test)]
mod schedule_tests {
    use super::*;

    #[test]
    fn paused_schedule_can_be_saved_with_an_unavailable_model_but_not_enabled() {
        let db = crate::db::Database::open(std::path::Path::new(":memory:")).unwrap();
        let saved = save_schedule(&db, json!({
            "id": "", "name": "Paused review", "prompt": "Review tasks",
            "frequency": "daily", "nextRunAt": "2026-10-24T08:00:00.000Z",
            "enabled": false, "revision": 0, "skillIds": [],
            "lastRunId": null, "lastError": null,
            "modelRef": { "connectionId": "unavailable", "modelEntryId": "unavailable" }
        })).unwrap();
        assert!(!saved.enabled);
        assert_eq!(schedules(&db).unwrap().len(), 1);
        let mut enable = serde_json::to_value(&saved).unwrap();
        enable["enabled"] = json!(true);
        assert!(save_schedule(&db, enable).is_err());
        assert!(!schedules(&db).unwrap()[0].enabled);
        assert_eq!(schedules(&db).unwrap()[0].prompt, "Review tasks");
    }
}
