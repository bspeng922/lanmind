//! Incremental, workspace-private conversation and run persistence.
use crate::{ai_types::*, db::Database, workspace_scope::WorkspaceContext};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

impl Database {
    pub(crate) fn ai_existing_request(&self, request: &RunRequest) -> AiResult<Option<AiRun>> {
        let scope = self.workspace_context()?;
        let old:Option<(String,String)>=self.conn.query_row("SELECT payload_json,request_hash FROM ai_runs WHERE workspace_id=? AND user_id=? AND client_request_id=?",params![scope.workspace_id,scope.user_id,request.client_request_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        match old {
            None => Ok(None),
            Some((raw, fingerprint)) => {
                if fingerprint != hash(serde_json::to_vec(request)?) {
                    return Err(AiError::new(
                        "REQUEST_ID_CONFLICT",
                        "请求 ID 已用于其他内容",
                    ));
                }
                Ok(Some(serde_json::from_str(&raw)?))
            }
        }
    }
    pub(crate) fn migrate_ai_messages(&self) -> AiResult<()> {
        let ctx = self.workspace_context()?;
        let done:bool=self.conn.query_row("SELECT COALESCE((SELECT messages_migrated FROM ai_storage_versions WHERE workspace_id=? AND user_id=?),0)",params![ctx.workspace_id,ctx.user_id],|r|r.get(0))?;
        if done {
            return Ok(());
        }
        self.conn.execute_batch("SAVEPOINT ai_message_migration")?;
        let result = (|| -> AiResult<()> {
            let mut stmt=self.conn.prepare("SELECT id,payload_json FROM ai_conversations WHERE workspace_id=? AND user_id=? ORDER BY rowid")?;
            let rows = stmt
                .query_map(params![ctx.workspace_id, ctx.user_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (conv_id, raw) in rows {
                let value: Value = serde_json::from_str(&raw)?;
                if value.get("revision").is_some() {
                    continue;
                }
                let branch_id = format!("branch-legacy-{}", hash(&conv_id));
                self.conn.execute(
                    "INSERT OR IGNORE INTO ai_branches VALUES(?,?,?,?,NULL,NULL)",
                    params![ctx.workspace_id, ctx.user_id, conv_id, branch_id],
                )?;
                let mut stmt=self.conn.prepare("SELECT payload_json FROM ai_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? ORDER BY rowid")?;
                let messages = stmt
                    .query_map(params![ctx.workspace_id, ctx.user_id, conv_id], |r| {
                        r.get::<_, String>(0)
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                let mut parent = None;
                let mut user_id = None;
                let mut count = 0;
                for raw in messages {
                    let m: Value = serde_json::from_str(&raw)?;
                    let Some(message_id) = m["id"].as_str() else {
                        continue;
                    };
                    let role = m["role"].as_str().unwrap_or("user");
                    if !matches!(role, "user" | "assistant") {
                        continue;
                    }
                    if role == "user" {
                        user_id = Some(message_id.to_string());
                    }
                    let message = AiMessage {
                        id: message_id.into(),
                        role: role.into(),
                        content: m["content"].as_str().unwrap_or("").into(),
                        created_at: m["createdAt"].as_str().unwrap_or(&now()).into(),
                        branch_id: branch_id.clone(),
                        parent_message_id: parent.clone(),
                        run_id: None,
                        user_message_id: user_id.clone(),
                        status: if m["error"].is_string() {
                            "failed"
                        } else {
                            "completed"
                        }
                        .into(),
                        error: m["error"].as_str().map(str::to_string),
                        model_label: None,
                        model_content: None,
                        protocol: None,
                    };
                    self.ai_put_message_in(&ctx, &conv_id, &message)?;
                    parent = Some(message_id.to_string());
                    count += 1;
                }
                let created = value["createdAt"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(now);
                let conv = AiConversation {
                    id: conv_id,
                    title: value["title"].as_str().unwrap_or("").into(),
                    title_locked: value["titleLocked"].as_bool().unwrap_or(false),
                    pinned: value["pinned"].as_bool().unwrap_or(false),
                    created_at: created.clone(),
                    updated_at: value["updatedAt"].as_str().unwrap_or(&created).into(),
                    message_count: count,
                    revision: 1,
                    branch_id,
                    head_message_id: parent,
                    models: Default::default(),
                };
                self.ai_put_conversation_in(&ctx, &conv)?;
            }
            self.conn.execute("INSERT INTO ai_storage_versions(workspace_id,user_id,messages_migrated) VALUES(?,?,1) ON CONFLICT(workspace_id,user_id) DO UPDATE SET messages_migrated=1",params![ctx.workspace_id,ctx.user_id])?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_message_migration")?;
                Ok(())
            }
            Err(e) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO ai_message_migration; RELEASE ai_message_migration",
                );
                Err(e)
            }
        }
    }

    pub(crate) fn ai_import_legacy_cache(&self, payload: &Value) -> AiResult<()> {
        let ctx = self.workspace_context()?;
        let imported: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_cache_imports WHERE workspace_id=? AND user_id=?)",
            params![ctx.workspace_id, ctx.user_id],
            |r| r.get(0),
        )?;
        if imported {
            return Ok(());
        }
        self.conn.execute_batch("SAVEPOINT ai_cache_import")?;
        let result = (|| -> AiResult<()> {
            self.conn.execute(
                "INSERT INTO ai_cache_imports VALUES(?,?,?)",
                params![ctx.workspace_id, ctx.user_id, hash(payload.to_string())],
            )?;
            let Some(conversations) = payload["index"]["conversations"].as_array() else {
                return self.migrate_ai_messages();
            };
            if conversations.len() > 10_000 {
                return Err(AiError::new("INVALID_DATA", "旧会话数量超出迁移限制"));
            }
            for summary in conversations {
                let Some(id) = summary["id"].as_str().filter(|id| !id.is_empty()) else {
                    continue;
                };
                let exists:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_conversations WHERE workspace_id=? AND user_id=? AND id=?)",params![ctx.workspace_id,ctx.user_id,id],|r|r.get(0))?;
                // Existing SQLite content always wins over renderer caches.
                if exists {
                    continue;
                }
                self.conn.execute(
                    "INSERT INTO ai_conversations VALUES(?,?,?,?)",
                    params![ctx.workspace_id, ctx.user_id, id, summary.to_string()],
                )?;
                for message in payload["messages"][id].as_array().into_iter().flatten() {
                    let Some(message_id) = message["id"].as_str() else {
                        continue;
                    };
                    self.conn.execute(
                        "INSERT OR IGNORE INTO ai_messages VALUES(?,?,?,?,?)",
                        params![
                            ctx.workspace_id,
                            ctx.user_id,
                            id,
                            message_id,
                            message.to_string()
                        ],
                    )?;
                }
            }
            self.conn.execute("INSERT INTO ai_storage_versions(workspace_id,user_id,messages_migrated) VALUES(?,?,0) ON CONFLICT(workspace_id,user_id) DO UPDATE SET messages_migrated=0",params![ctx.workspace_id,ctx.user_id])?;
            self.migrate_ai_messages()?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_cache_import")?;
                Ok(())
            }
            Err(e) => {
                let _ = self
                    .conn
                    .execute_batch("ROLLBACK TO ai_cache_import; RELEASE ai_cache_import");
                Err(e)
            }
        }
    }

    pub(crate) fn ai_conversations(&self) -> AiResult<Vec<AiConversation>> {
        self.migrate_ai_messages()?;
        let ctx = self.workspace_context()?;
        let mut stmt = self.conn.prepare(
            "SELECT payload_json FROM ai_conversations WHERE workspace_id=? AND user_id=?",
        )?;
        let mut rows = stmt
            .query_map(params![ctx.workspace_id, ctx.user_id], |r| {
                r.get::<_, String>(0)
            })?
            .map(|r| Ok(serde_json::from_str::<AiConversation>(&r?)?))
            .collect::<AiResult<Vec<_>>>()?;
        rows.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        Ok(rows)
    }
    pub(crate) fn ai_search_conversations(&self, query: &str) -> AiResult<Value> {
        if query.len() > 500 {
            return Err(AiError::new("INVALID_ARGUMENTS", "搜索词过长"));
        }
        let query = query.trim().to_lowercase();
        let ctx = self.workspace_context()?;
        let mut matches = Vec::new();
        for conv in self.ai_conversations()? {
            if conv.title.to_lowercase().contains(&query) {
                matches.push(json!({"conversation":conv,"scope":"title","snippet":""}));
            } else {
                // SQLite's built-in lower() only handles ASCII. Match in Rust so
                // Unicode case folding and snippet offsets use the same string.
                let mut stmt = self.conn.prepare("SELECT json_extract(payload_json,'$.content') FROM ai_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? AND json_extract(payload_json,'$.protocol') IS NULL ORDER BY rowid")?;
                let content = stmt
                    .query_map(params![ctx.workspace_id, ctx.user_id, conv.id], |r| {
                        r.get::<_, String>(0)
                    })?;
                for text in content {
                    let text = text?;
                    let lower = text.to_lowercase();
                    let Some(byte) = lower.find(&query) else {
                        continue;
                    };
                    let chars = text.chars().collect::<Vec<_>>();
                    let mut lowered_bytes = 0;
                    let position = text
                        .chars()
                        .take_while(|ch| {
                            if lowered_bytes >= byte {
                                return false;
                            }
                            lowered_bytes += ch.to_lowercase().map(char::len_utf8).sum::<usize>();
                            true
                        })
                        .count();
                    let offset = position.saturating_sub(30);
                    let snippet = chars.into_iter().skip(offset).take(140).collect::<String>();
                    matches.push(json!({"conversation":conv,"scope":"message","snippet":snippet}));
                    break;
                }
            }
            if matches.len() >= 200 {
                break;
            }
        }
        Ok(json!(matches))
    }
    pub(crate) fn ai_conversation(&self, id: &str) -> AiResult<AiConversation> {
        let ctx = self.workspace_context()?;
        self.ai_conversation_in(&ctx, id)
    }
    pub(crate) fn ai_conversation_in(
        &self,
        scope: &WorkspaceContext,
        id: &str,
    ) -> AiResult<AiConversation> {
        let raw:Option<String>=self.conn.query_row("SELECT payload_json FROM ai_conversations WHERE workspace_id=? AND user_id=? AND id=?",params![scope.workspace_id,scope.user_id,id],|r|r.get(0)).optional()?;
        serde_json::from_str(
            &raw.ok_or_else(|| AiError::new("CONVERSATION_NOT_FOUND", "会话不存在或无权访问"))?,
        )
        .map_err(Into::into)
    }
    pub(crate) fn ai_create_conversation(&self) -> AiResult<AiConversation> {
        self.migrate_ai_messages()?;
        let ctx = self.workspace_context()?;
        let time = now();
        let conv = AiConversation {
            id: id("conversation"),
            title: String::new(),
            title_locked: false,
            pinned: false,
            created_at: time.clone(),
            updated_at: time,
            message_count: 0,
            revision: 1,
            branch_id: id("branch"),
            head_message_id: None,
            models: Default::default(),
        };
        self.ai_put_conversation_in(&ctx, &conv)?;
        self.conn.execute(
            "INSERT INTO ai_branches VALUES(?,?,?,?,NULL,NULL)",
            params![ctx.workspace_id, ctx.user_id, conv.id, conv.branch_id],
        )?;
        Ok(conv)
    }
    pub(crate) fn ai_put_conversation_in(
        &self,
        scope: &WorkspaceContext,
        conv: &AiConversation,
    ) -> AiResult<()> {
        self.conn.execute("INSERT INTO ai_conversations VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id,id) DO UPDATE SET payload_json=excluded.payload_json",params![scope.workspace_id,scope.user_id,conv.id,serde_json::to_string(conv)?])?;
        Ok(())
    }
    pub(crate) fn ai_put_message_in(
        &self,
        scope: &WorkspaceContext,
        conversation_id: &str,
        message: &AiMessage,
    ) -> AiResult<()> {
        self.conn.execute("INSERT INTO ai_messages VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,user_id,conversation_id,id) DO UPDATE SET payload_json=excluded.payload_json",params![scope.workspace_id,scope.user_id,conversation_id,message.id,serde_json::to_string(message)?])?;
        Ok(())
    }
    pub(crate) fn ai_message(&self, conversation_id: &str, id: &str) -> AiResult<AiMessage> {
        let ctx = self.workspace_context()?;
        let raw:Option<String>=self.conn.query_row("SELECT payload_json FROM ai_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? AND id=?",params![ctx.workspace_id,ctx.user_id,conversation_id,id],|r|r.get(0)).optional()?;
        serde_json::from_str(
            &raw.ok_or_else(|| AiError::new("MESSAGE_NOT_FOUND", "消息不存在或无权访问"))?,
        )
        .map_err(Into::into)
    }
    pub(crate) fn ai_all_messages(&self, conversation_id: &str) -> AiResult<Vec<AiMessage>> {
        let ctx = self.workspace_context()?;
        self.ai_conversation(conversation_id)?;
        let mut stmt=self.conn.prepare("SELECT payload_json FROM ai_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? ORDER BY rowid")?;
        let rows = stmt
            .query_map(
                params![ctx.workspace_id, ctx.user_id, conversation_id],
                |r| r.get::<_, String>(0),
            )?
            .map(|r| Ok(serde_json::from_str::<AiMessage>(&r?)?))
            .collect();
        rows
    }
    pub(crate) fn ai_message_chain(
        &self,
        conversation_id: &str,
        head: Option<&str>,
    ) -> AiResult<Vec<AiMessage>> {
        let mut messages = self
            .ai_all_messages(conversation_id)?
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect::<std::collections::HashMap<_, _>>();
        let mut chain = Vec::new();
        let mut current = head.map(str::to_string);
        while let Some(id) = current {
            let message = messages
                .remove(&id)
                .ok_or_else(|| AiError::new("INVALID_DATA", "消息引用损坏或存在循环"))?;
            current = message.parent_message_id.clone();
            chain.push(message);
        }
        chain.reverse();
        Ok(chain)
    }
    pub(crate) fn ai_runs_for_conversation(&self, id: &str) -> AiResult<Vec<AiRun>> {
        let ctx = self.workspace_context()?;
        self.ai_conversation(id)?;
        let mut stmt=self.conn.prepare("SELECT payload_json FROM ai_runs WHERE workspace_id=? AND user_id=? AND conversation_id=? ORDER BY rowid DESC LIMIT 100")?;
        let rows = stmt
            .query_map(params![ctx.workspace_id, ctx.user_id, id], |r| {
                r.get::<_, String>(0)
            })?
            .map(|r| Ok(serde_json::from_str::<AiRun>(&r?)?))
            .collect();
        rows
    }
    pub(crate) fn ai_view(&self, id: &str) -> AiResult<Value> {
        let conversation = self.ai_conversation(id)?;
        let messages = self.ai_message_chain(id, conversation.head_message_id.as_deref())?;
        let alternatives = self
            .ai_all_messages(id)?
            .into_iter()
            .filter(|m| m.role == "assistant" && m.protocol.is_none())
            .collect::<Vec<_>>();
        Ok(
            json!({"conversation":conversation,"messages":messages,"alternatives":alternatives,"runs":self.ai_runs_for_conversation(id)?}),
        )
    }
    pub(crate) fn ai_patch_conversation(
        &self,
        id: &str,
        revision: i64,
        patch: Value,
    ) -> AiResult<AiConversation> {
        let mut conv = self.ai_conversation(id)?;
        if conv.revision != revision {
            return Err(AiError::new(
                "CONVERSATION_CONFLICT",
                "会话已修改，请刷新后重试",
            ));
        }
        if let Some(title) = patch["title"].as_str() {
            conv.title = title.chars().take(120).collect();
            conv.title_locked = true;
        }
        if let Some(pinned) = patch["pinned"].as_bool() {
            conv.pinned = pinned;
        }
        if let Some(head) = patch["headMessageId"].as_str() {
            if self.ai_runs_for_conversation(id)?.iter().any(AiRun::active) {
                return Err(AiError::new("RUN_BUSY", "请先停止当前运行再切换回答版本"));
            }
            let message = self.ai_message(id, head)?;
            conv.branch_id = message.branch_id;
            conv.head_message_id = Some(head.into());
            conv.message_count = self
                .ai_message_chain(id, Some(head))?
                .iter()
                .filter(|m| m.protocol.is_none())
                .count();
        }
        conv.revision += 1;
        conv.updated_at = now();
        self.ai_put_conversation_in(&self.workspace_context()?, &conv)?;
        Ok(conv)
    }
    pub(crate) fn ai_delete_conversation(&self, id: &str) -> AiResult<()> {
        if self.ai_runs_for_conversation(id)?.iter().any(AiRun::active) {
            return Err(AiError::new("RUN_BUSY", "请先停止当前运行再删除会话"));
        }
        let ctx = self.workspace_context()?;
        self.conn
            .execute_batch("SAVEPOINT ai_conversation_delete")?;
        let result = (|| -> AiResult<()> {
            for table in [
                "ai_runs",
                "ai_client_messages",
                "ai_messages",
                "ai_branches",
            ] {
                self.conn.execute(&format!("DELETE FROM {table} WHERE workspace_id=? AND user_id=? AND conversation_id=?"),params![ctx.workspace_id,ctx.user_id,id])?;
            }
            self.conn.execute(
                "DELETE FROM ai_conversations WHERE workspace_id=? AND user_id=? AND id=?",
                params![ctx.workspace_id, ctx.user_id, id],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_conversation_delete")?;
                Ok(())
            }
            Err(e) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO ai_conversation_delete; RELEASE ai_conversation_delete",
                );
                Err(e)
            }
        }
    }
    pub(crate) fn ai_run_in(&self, scope: &WorkspaceContext, id: &str) -> AiResult<AiRun> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_json FROM ai_runs WHERE workspace_id=? AND user_id=? AND id=?",
                params![scope.workspace_id, scope.user_id, id],
                |r| r.get(0),
            )
            .optional()?;
        serde_json::from_str(
            &raw.ok_or_else(|| AiError::new("RUN_NOT_FOUND", "运行不存在或无权访问"))?,
        )
        .map_err(Into::into)
    }
    pub(crate) fn ai_put_run_in(&self, scope: &WorkspaceContext, run: &AiRun) -> AiResult<()> {
        self.conn.execute("UPDATE ai_runs SET status=?,payload_json=? WHERE workspace_id=? AND user_id=? AND id=?",params![run.status,serde_json::to_string(run)?,scope.workspace_id,scope.user_id,run.id])?;
        Ok(())
    }
    pub(crate) fn ai_prepare_run(
        &self,
        request: &RunRequest,
    ) -> AiResult<(AiRun, AiMessage, bool)> {
        self.migrate_ai_messages()?;
        let scope = self.workspace_context()?;
        let fingerprint = hash(serde_json::to_vec(request)?);
        if let Some((raw,old_hash))=self.conn.query_row("SELECT payload_json,request_hash FROM ai_runs WHERE workspace_id=? AND user_id=? AND client_request_id=?",params![scope.workspace_id,scope.user_id,request.client_request_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()? {
            if old_hash!=fingerprint{return Err(AiError::new("REQUEST_ID_CONFLICT","请求 ID 已用于其他内容"));}
            let run:AiRun=serde_json::from_str(&raw)?;let message=self.ai_message(&run.conversation_id,&run.assistant_message_id)?;return Ok((run,message,false));
        }
        let mut conv = self.ai_conversation(&request.conversation_id)?;
        if conv.revision != request.expected_conversation_version
            || conv.head_message_id != request.expected_head_message_id
            || conv.branch_id != request.branch_id
        {
            return Err(AiError::new(
                "CONVERSATION_CONFLICT",
                "会话或回答分支已变化，请刷新后发送",
            ));
        }
        if self
            .ai_runs_for_conversation(&conv.id)?
            .iter()
            .any(AiRun::active)
        {
            return Err(AiError::new("RUN_BUSY", "此会话仍有正在执行的运行"));
        }
        if !["chat", "workspace", "files"].contains(&request.mode.as_str()) {
            return Err(AiError::new("INVALID_DATA", "未知的运行模式"));
        }
        let purpose = if request.mode == "chat" {
            "chat"
        } else {
            "agent"
        };
        let selected = request
            .model_ref
            .as_ref()
            .or_else(|| conv.models.get(purpose));
        let (connection, model, _) = self.ai_resolve_model(purpose, selected)?;
        if purpose == "agent"
            && (model.capabilities.tools != Some(true)
                || model.capabilities.config_revision != Some(connection.config_revision))
        {
            return Err(AiError::new(
                "CAPABILITY_REQUIRED",
                "请先在模型设置中通过工具调用测试",
            ));
        }
        let model_ref = ModelRef {
            connection_id: connection.id.clone(),
            model_entry_id: model.id.clone(),
        };
        let run_id = id("run");
        let time = now();
        let label = format!("{} · {}", model.display_name, connection.name);
        let mut new_user = None;
        let user_message = match &request.input {
            RunInput::NewMessage {
                client_message_id,
                text,
            } => {
                if text.trim().is_empty() || text.len() > 2_000_000 || client_message_id.is_empty()
                {
                    return Err(AiError::new("INVALID_DATA", "消息不能为空或超出长度限制"));
                }
                let exists:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_client_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? AND client_message_id=?)",params![scope.workspace_id,scope.user_id,conv.id,client_message_id],|r|r.get(0))?;
                if exists {
                    return Err(AiError::new(
                        "REQUEST_ID_CONFLICT",
                        "这条消息已提交，请恢复原运行",
                    ));
                }
                let message = AiMessage {
                    id: id("message"),
                    role: "user".into(),
                    content: text.trim().into(),
                    created_at: time.clone(),
                    branch_id: conv.branch_id.clone(),
                    parent_message_id: conv.head_message_id.clone(),
                    run_id: Some(run_id.clone()),
                    user_message_id: None,
                    status: "completed".into(),
                    error: None,
                    model_label: None,
                    model_content: None,
                    protocol: None,
                };
                new_user = Some(message.clone());
                message
            }
            RunInput::Retry {
                user_message_id,
                run_id: old_run_id,
            } => {
                let old = self.ai_run_in(&scope, old_run_id)?;
                if old.conversation_id != conv.id || old.user_message_id != *user_message_id {
                    return Err(AiError::new("INVALID_DATA", "重试消息与原运行不一致"));
                }
                let original = self.ai_message(&conv.id, user_message_id)?;
                if original.role != "user" {
                    return Err(AiError::new("INVALID_DATA", "只能重新生成用户问题的回答"));
                }
                conv.branch_id = id("branch");
                original
            }
            RunInput::Continue { run_id: old_run_id } => {
                let old = self.ai_run_in(&scope, old_run_id)?;
                if old.conversation_id != conv.id || old.active() {
                    return Err(AiError::new("RUN_BUSY", "此运行不能继续"));
                }
                let message = AiMessage {
                    id: id("message"),
                    role: "user".into(),
                    content: "请根据已确认的执行结果继续。不要重复执行已完成或结果未知的写操作。"
                        .into(),
                    created_at: time.clone(),
                    branch_id: conv.branch_id.clone(),
                    parent_message_id: conv.head_message_id.clone(),
                    run_id: Some(run_id.clone()),
                    user_message_id: None,
                    status: "completed".into(),
                    error: None,
                    model_label: None,
                    model_content: None,
                    protocol: None,
                };
                new_user = Some(message.clone());
                message
            }
        };
        let assistant = AiMessage {
            id: id("message"),
            role: "assistant".into(),
            content: String::new(),
            created_at: time.clone(),
            branch_id: conv.branch_id.clone(),
            parent_message_id: Some(user_message.id.clone()),
            run_id: Some(run_id.clone()),
            user_message_id: Some(user_message.id.clone()),
            status: "running".into(),
            error: None,
            model_label: Some(label.clone()),
            model_content: None,
            protocol: None,
        };
        let run = AiRun {
            id: run_id.clone(),
            conversation_id: conv.id.clone(),
            branch_id: conv.branch_id.clone(),
            user_message_id: user_message.id.clone(),
            assistant_message_id: assistant.id.clone(),
            status: "queued".into(),
            mode: request.mode.clone(),
            model_ref: model_ref.clone(),
            model_label: label,
            config_revision: connection.config_revision,
            created_at: time.clone(),
            updated_at: time.clone(),
            finish_reason: None,
            error: None,
            seq: 0,
            tool_calls: vec![],
            artifacts: vec![],
            usage: None,
            context: Value::Null,
        };
        conv.models.insert(purpose.into(), model_ref);
        conv.head_message_id = Some(assistant.id.clone());
        conv.updated_at = time;
        conv.revision += 1;
        if !conv.title_locked && conv.title.is_empty() {
            conv.title = user_message
                .content
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("")
                .chars()
                .take(40)
                .collect();
        }
        self.conn.execute_batch("SAVEPOINT ai_start_run")?;
        let result = (|| -> AiResult<()> {
            self.conn.execute(
                "INSERT OR IGNORE INTO ai_branches VALUES(?,?,?,?,?,?)",
                params![
                    scope.workspace_id,
                    scope.user_id,
                    conv.id,
                    conv.branch_id,
                    request.branch_id,
                    user_message.id
                ],
            )?;
            if let Some(message) = &new_user {
                self.ai_put_message_in(&scope, &conv.id, message)?;
                conv.message_count += 1;
            }
            self.ai_put_message_in(&scope, &conv.id, &assistant)?;
            conv.message_count = self
                .ai_message_chain(&conv.id, Some(&assistant.id))?
                .iter()
                .filter(|m| m.protocol.is_none())
                .count();
            self.ai_put_conversation_in(&scope, &conv)?;
            self.conn.execute(
                "INSERT INTO ai_runs VALUES(?,?,?,?,?,?,?,?)",
                params![
                    scope.workspace_id,
                    scope.user_id,
                    run_id,
                    conv.id,
                    request.client_request_id,
                    fingerprint,
                    serde_json::to_string(&run)?,
                    run.status
                ],
            )?;
            if let RunInput::NewMessage {
                client_message_id, ..
            } = &request.input
            {
                self.conn.execute(
                    "INSERT INTO ai_client_messages VALUES(?,?,?,?,?)",
                    params![
                        scope.workspace_id,
                        scope.user_id,
                        conv.id,
                        client_message_id,
                        run_id
                    ],
                )?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_start_run")?;
                Ok((run, assistant, true))
            }
            Err(e) => {
                let _ = self
                    .conn
                    .execute_batch("ROLLBACK TO ai_start_run; RELEASE ai_start_run");
                Err(e)
            }
        }
    }
}
