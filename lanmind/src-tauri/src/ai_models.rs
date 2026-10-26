//! Local model registry and workspace bindings. Legacy data is migrated lazily,
//! once per owning workspace/user, without exposing credentials to renderers.
use crate::ai_types::*;
use crate::db::Database;
use crate::models::LlmConfig;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

pub fn normalize_base_url(raw: &str, provider: &str) -> AiResult<String> {
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| AiError::new("INVALID_URL", "请输入完整的 HTTP 或 HTTPS 模型地址"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AiError::new(
            "INVALID_URL",
            "模型地址只支持 HTTP/HTTPS；鉴权请使用凭据输入框",
        ));
    }
    let path = url.path().trim_end_matches('/');
    let path = path
        .strip_suffix("/chat/completions")
        .or_else(|| path.strip_suffix("/models"))
        .unwrap_or(path);
    let path = if path.is_empty()
        && (provider != "openai-compatible" || url.host_str() == Some("api.openai.com"))
    {
        "/v1".to_string()
    } else if provider == "ollama" && path.ends_with("/api/chat") {
        format!("{}/v1", path.trim_end_matches("/api/chat"))
    } else {
        path.to_string()
    };
    url.set_path(&path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn http_client() -> AiResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AiError::new("NETWORK_ERROR", "无法创建模型连接"))
}

impl Database {
    pub(crate) fn install_ai_schema(&self) -> AiResult<()> {
        self.conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS ai_model_connections(
                user_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,
                protected_secret TEXT,revision INTEGER NOT NULL,config_revision INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,id));
            CREATE TABLE IF NOT EXISTS ai_model_entries(
                user_id TEXT NOT NULL,id TEXT NOT NULL,connection_id TEXT NOT NULL,remote_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,PRIMARY KEY(user_id,id),UNIQUE(user_id,connection_id,remote_id),
                UNIQUE(user_id,id,connection_id),
                FOREIGN KEY(user_id,connection_id) REFERENCES ai_model_connections(user_id,id));
            CREATE TABLE IF NOT EXISTS ai_connection_bindings(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,connection_id TEXT NOT NULL,
                enabled INTEGER NOT NULL,PRIMARY KEY(workspace_id,user_id,connection_id),
                FOREIGN KEY(user_id,connection_id) REFERENCES ai_model_connections(user_id,id));
            CREATE TABLE IF NOT EXISTS ai_model_bindings(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,connection_id TEXT NOT NULL,
                model_entry_id TEXT NOT NULL,enabled INTEGER NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(workspace_id,user_id,model_entry_id),
                FOREIGN KEY(workspace_id,user_id,connection_id) REFERENCES ai_connection_bindings(workspace_id,user_id,connection_id),
                FOREIGN KEY(user_id,model_entry_id,connection_id) REFERENCES ai_model_entries(user_id,id,connection_id));
            CREATE TABLE IF NOT EXISTS ai_model_defaults(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,purpose TEXT NOT NULL,
                model_entry_id TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,purpose),
                FOREIGN KEY(workspace_id,user_id,model_entry_id) REFERENCES ai_model_bindings(workspace_id,user_id,model_entry_id));
            CREATE TABLE IF NOT EXISTS ai_storage_versions(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,models_migrated INTEGER NOT NULL DEFAULT 0,
                messages_migrated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,user_id));
            CREATE TABLE IF NOT EXISTS ai_cache_imports(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,source_hash TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
            CREATE TABLE IF NOT EXISTS ai_migration_backups(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,protected_payload TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,kind));
            CREATE TABLE IF NOT EXISTS ai_branches(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,id TEXT NOT NULL,
                parent_branch_id TEXT,fork_message_id TEXT,PRIMARY KEY(workspace_id,user_id,conversation_id,id),
                FOREIGN KEY(workspace_id,user_id,conversation_id) REFERENCES ai_conversations(workspace_id,user_id,id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS ai_conversation_shares(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,
                PRIMARY KEY(workspace_id,user_id,id),
                FOREIGN KEY(workspace_id,user_id,conversation_id) REFERENCES ai_conversations(workspace_id,user_id,id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS ai_runs(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,conversation_id TEXT NOT NULL,
                client_request_id TEXT NOT NULL,request_hash TEXT NOT NULL,payload_json TEXT NOT NULL,
                status TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,id),
                UNIQUE(workspace_id,user_id,client_request_id),
                FOREIGN KEY(workspace_id,user_id,conversation_id) REFERENCES ai_conversations(workspace_id,user_id,id));
            CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_active_conversation ON ai_runs(workspace_id,user_id,conversation_id)
                WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling');
            CREATE TABLE IF NOT EXISTS ai_client_messages(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,client_message_id TEXT NOT NULL,
                run_id TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,conversation_id,client_message_id));
            CREATE TABLE IF NOT EXISTS ai_tool_operations(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,argument_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,id));
            CREATE TABLE IF NOT EXISTS ai_extensions(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,protected_secret TEXT,PRIMARY KEY(workspace_id,user_id,id));
            CREATE TABLE IF NOT EXISTS ai_schedules(
                workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,
                next_run_at TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(workspace_id,user_id,id));
            CREATE INDEX IF NOT EXISTS idx_ai_schedules_due ON ai_schedules(workspace_id,user_id,enabled,next_run_at);
        "#)?;
        // A process restart never resumes an unconfirmed side effect.
        let mut statement = self.conn.prepare("SELECT workspace_id,user_id,id,payload_json FROM ai_runs WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling')")?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for (workspace, user, id, raw) in rows {
            let mut run: AiRun = serde_json::from_str(&raw)?;
            run.status = "interrupted".into();
            run.updated_at = now();
            for call in &mut run.tool_calls {
                if call.status == "running" {
                    call.status = "outcome_unknown".into();
                } else if call.status == "waiting_approval" {
                    call.status = "cancelled".into();
                }
            }
            self.conn.execute("UPDATE ai_runs SET status='interrupted',payload_json=? WHERE workspace_id=? AND user_id=? AND id=?", params![serde_json::to_string(&run)?,workspace,user,id])?;
            self.conn.execute("UPDATE ai_messages SET payload_json=json_set(payload_json,'$.status','interrupted') WHERE workspace_id=? AND user_id=? AND conversation_id=? AND id=?",params![workspace,user,run.conversation_id,run.assistant_message_id])?;
        }
        Ok(())
    }

    pub(crate) fn migrate_ai_models(&self) -> AiResult<()> {
        self.conn.execute_batch("SAVEPOINT ai_model_migration")?;
        let result = self.migrate_ai_models_inner();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_model_migration")?;
                Ok(())
            }
            Err(e) => {
                let _ = self
                    .conn
                    .execute_batch("ROLLBACK TO ai_model_migration; RELEASE ai_model_migration");
                Err(e)
            }
        }
    }
    fn migrate_ai_models_inner(&self) -> AiResult<()> {
        let ctx = self.workspace_context()?;
        let done:bool=self.conn.query_row("SELECT COALESCE((SELECT models_migrated FROM ai_storage_versions WHERE workspace_id=? AND user_id=?),0)",params![ctx.workspace_id,ctx.user_id],|r|r.get(0))?;
        if done {
            return Ok(());
        }
        let raw:Option<String>=self.conn.query_row("SELECT payload_json FROM workspace_llm_bindings WHERE workspace_id=? AND user_id=?",params![ctx.workspace_id,ctx.user_id],|r|r.get(0)).optional()?;
        let raw = if raw.is_some() {
            raw
        } else if self.setting("workspaceOriginalId")?.as_deref() == Some(&ctx.workspace_id)
            && self.setting("workspaceOriginalUserId")?.as_deref() == Some(&ctx.user_id)
        {
            self.conn
                .query_row("SELECT payload_json FROM llm_config WHERE id=1", [], |r| {
                    r.get(0)
                })
                .optional()?
        } else {
            None
        };
        if let Some(raw) = raw {
            let mut value: Value = serde_json::from_str(&raw)?;
            let old_id = value["connectionId"].as_str().map(str::to_string);
            if let Some(connection) = old_id.as_deref() {
                let secret: Option<String> = self
                    .conn
                    .query_row(
                        "SELECT payload_json FROM llm_connections WHERE user_id=? AND id=?",
                        params![ctx.user_id, connection],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(secret) = secret {
                    value["apiKey"] = serde_json::from_str::<Value>(&secret)?["apiKey"].clone();
                }
            }
            let base = value["baseUrl"].as_str().unwrap_or("");
            let model = value["modelName"].as_str().unwrap_or("");
            let key = value["apiKey"].as_str().unwrap_or("");
            let backup = if key.is_empty() {
                format!("metadata:{}", value)
            } else {
                crate::ai_secrets::protect(&value.to_string())?
            };
            self.conn.execute(
                "INSERT OR IGNORE INTO ai_migration_backups VALUES(?,?,'models',?)",
                params![ctx.workspace_id, ctx.user_id, backup],
            )?;
            // An untouched installation has no configured model, not a fictitious cloud connection.
            if !base.is_empty()
                && !model.is_empty()
                && (!key.is_empty()
                    || base != "https://api.openai.com/v1"
                    || model != "gpt-4o-mini")
            {
                let conn_id = format!(
                    "legacy-{}",
                    old_id.unwrap_or_else(|| hash(format!("{}:{}", ctx.user_id, ctx.workspace_id)))
                );
                let model_id = format!("model-{}", hash(format!("{conn_id}:{model}")));
                let exists: bool = self.conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM ai_model_connections WHERE user_id=? AND id=?)",
                    params![ctx.user_id, conn_id],
                    |r| r.get(0),
                )?;
                if !exists {
                    let dto = AiConnection {
                        id: conn_id.clone(),
                        name: "已有模型连接".into(),
                        provider_type: "openai-compatible".into(),
                        base_url: normalize_base_url(base, "openai-compatible")?,
                        enabled: true,
                        revision: 1,
                        config_revision: 1,
                        has_credential: !key.is_empty(),
                        bound: true,
                        reference_count: 1,
                        parameters: Default::default(),
                        models: vec![],
                    };
                    let secret = if key.is_empty() {
                        None
                    } else {
                        Some(crate::ai_secrets::protect(key)?)
                    };
                    self.conn.execute(
                        "INSERT INTO ai_model_connections VALUES(?,?,?,?,1,1,0)",
                        params![ctx.user_id, conn_id, serde_json::to_string(&dto)?, secret],
                    )?;
                }
                let model = AiModel {
                    id: model_id.clone(),
                    remote_model_id: model.into(),
                    display_name: model.into(),
                    enabled: true,
                    missing: false,
                    capabilities: Default::default(),
                    parameters: Default::default(),
                };
                self.conn.execute(
                    "INSERT OR IGNORE INTO ai_model_entries VALUES(?,?,?,?,?)",
                    params![
                        ctx.user_id,
                        model_id,
                        conn_id,
                        model.remote_model_id,
                        serde_json::to_string(&model)?
                    ],
                )?;
                self.conn.execute(
                    "INSERT OR IGNORE INTO ai_connection_bindings VALUES(?,?,?,1)",
                    params![ctx.workspace_id, ctx.user_id, conn_id],
                )?;
                self.conn.execute(
                    "INSERT OR IGNORE INTO ai_model_bindings VALUES(?,?,?,?,1,0)",
                    params![ctx.workspace_id, ctx.user_id, conn_id, model_id],
                )?;
                for purpose in ["chat", "quick_parse", "report"] {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO ai_model_defaults VALUES(?,?,?,?)",
                        params![ctx.workspace_id, ctx.user_id, purpose, model_id],
                    )?;
                }
            }
        }
        // Legacy readers must never return a migrated credential to a renderer.
        self.conn.execute("UPDATE workspace_llm_bindings SET payload_json=json_set(payload_json,'$.apiKey','') WHERE workspace_id=? AND user_id=?",params![ctx.workspace_id,ctx.user_id])?;
        self.conn.execute("UPDATE llm_connections SET payload_json=json_set(payload_json,'$.apiKey','') WHERE user_id=? AND id IN (SELECT substr(id,8) FROM ai_model_connections WHERE user_id=? AND id LIKE 'legacy-%')",params![ctx.user_id,ctx.user_id])?;
        if self.setting("workspaceOriginalId")?.as_deref() == Some(&ctx.workspace_id)
            && self.setting("workspaceOriginalUserId")?.as_deref() == Some(&ctx.user_id)
        {
            self.conn.execute(
                "UPDATE llm_config SET payload_json=json_set(payload_json,'$.apiKey','')",
                [],
            )?;
        }
        self.conn.execute("INSERT INTO ai_storage_versions(workspace_id,user_id,models_migrated) VALUES(?,?,1) ON CONFLICT(workspace_id,user_id) DO UPDATE SET models_migrated=1",params![ctx.workspace_id,ctx.user_id])?;
        Ok(())
    }

    pub(crate) fn ai_catalog(&self) -> AiResult<ModelCatalog> {
        self.migrate_ai_models()?;
        let ctx = self.workspace_context()?;
        let mut statement=self.conn.prepare("SELECT id,payload_json,protected_secret,revision,config_revision FROM ai_model_connections WHERE user_id=? AND deleted=0 ORDER BY rowid")?;
        let rows = statement
            .query_map([&ctx.user_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut connections = Vec::new();
        for (id, raw, secret, revision, config_revision) in rows {
            let mut connection: AiConnection = serde_json::from_str(&raw)?;
            connection.revision = revision;
            connection.config_revision = config_revision;
            connection.has_credential = secret.is_some();
            connection.bound=self.conn.query_row("SELECT COALESCE((SELECT enabled FROM ai_connection_bindings WHERE workspace_id=? AND user_id=? AND connection_id=?),0)",params![ctx.workspace_id,ctx.user_id,id],|r|r.get(0))?;
            connection.reference_count=self.conn.query_row("SELECT count(*) FROM ai_connection_bindings WHERE user_id=? AND connection_id=? AND enabled=1",params![ctx.user_id,id],|r|r.get(0))?;
            let mut stmt=self.conn.prepare("SELECT m.payload_json,COALESCE(b.enabled,0) FROM ai_model_entries m LEFT JOIN ai_model_bindings b ON b.user_id=m.user_id AND b.model_entry_id=m.id AND b.workspace_id=? WHERE m.user_id=? AND m.connection_id=? ORDER BY COALESCE(b.sort_order,999),m.rowid")?;
            let models = stmt
                .query_map(params![ctx.workspace_id, ctx.user_id, id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            connection.models = models
                .into_iter()
                .map(|(raw, enabled)| {
                    let mut m: AiModel = serde_json::from_str(&raw)?;
                    m.enabled = enabled;
                    Ok(m)
                })
                .collect::<AiResult<_>>()?;
            connections.push(connection);
        }
        let mut defaults = std::collections::HashMap::new();
        let mut stmt=self.conn.prepare("SELECT d.purpose,m.connection_id,d.model_entry_id FROM ai_model_defaults d JOIN ai_model_entries m ON m.user_id=d.user_id AND m.id=d.model_entry_id WHERE d.workspace_id=? AND d.user_id=?")?;
        for row in stmt.query_map(params![ctx.workspace_id, ctx.user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                ModelRef {
                    connection_id: r.get(1)?,
                    model_entry_id: r.get(2)?,
                },
            ))
        })? {
            let (purpose, model) = row?;
            defaults.insert(purpose, model);
        }
        Ok(ModelCatalog {
            schema_version: 2,
            connections,
            defaults,
        })
    }

    pub(crate) fn save_ai_connection(&self, draft: ConnectionDraft) -> AiResult<AiConnection> {
        self.migrate_ai_models()?;
        draft.parameters.validate()?;
        if draft.name.trim().is_empty()
            || draft.name.chars().count() > 80
            || draft.models.len() > 500
        {
            return Err(AiError::new(
                "INVALID_CONFIGURATION",
                "请输入连接名称，且每个连接最多配置 500 个模型",
            ));
        }
        if !["ollama", "vllm", "sglang", "openai-compatible"]
            .contains(&draft.provider_type.as_str())
        {
            return Err(AiError::new(
                "INVALID_CONFIGURATION",
                "不支持的模型服务类型",
            ));
        }
        let ctx = self.workspace_context()?;
        let catalog = self.ai_catalog()?;
        let existing = draft
            .id
            .as_ref()
            .and_then(|id| catalog.connections.iter().find(|c| &c.id == id));
        if draft.id.is_some() && existing.is_none() {
            return Err(AiError::new("MODEL_UNAVAILABLE", "连接不存在或无权修改"));
        }
        if let Some(existing) = existing {
            if draft.expected_revision != Some(existing.revision) {
                return Err(AiError::new(
                    "CONFIG_CONFLICT",
                    "连接已被其他窗口修改，请刷新后重试",
                ));
            }
        }
        let conn_id = draft.id.clone().unwrap_or_else(|| id("connection"));
        let base_url = normalize_base_url(&draft.base_url, &draft.provider_type)?;
        let old_secret: Option<String> = self
            .conn
            .query_row(
                "SELECT protected_secret FROM ai_model_connections WHERE user_id=? AND id=?",
                params![ctx.user_id, conn_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let credential_changed = !matches!(draft.credential_change, CredentialChange::Keep);
        let protected_secret = match &draft.credential_change {
            CredentialChange::Keep => old_secret,
            CredentialChange::Clear => None,
            CredentialChange::Replace { value } => {
                if value.len() > 16_384 {
                    return Err(AiError::new("INVALID_CONFIGURATION", "凭据过长"));
                }
                if value.trim().is_empty() {
                    None
                } else {
                    Some(crate::ai_secrets::protect(value.trim())?)
                }
            }
        };
        let changed = existing.is_none_or(|c| {
            c.base_url != base_url
                || c.provider_type != draft.provider_type
                || c.parameters != draft.parameters
                || c.enabled != draft.enabled
        }) || credential_changed;
        let revision = existing.map_or(1, |c| c.revision + 1);
        let config_revision = existing.map_or(1, |c| c.config_revision + i64::from(changed));
        let dto = AiConnection {
            id: conn_id.clone(),
            name: draft.name.trim().into(),
            provider_type: draft.provider_type,
            base_url,
            enabled: draft.enabled,
            revision,
            config_revision,
            has_credential: protected_secret.is_some(),
            bound: draft.bound,
            reference_count: 0,
            parameters: draft.parameters,
            models: vec![],
        };
        let mut seen = std::collections::HashSet::new();
        let mut models = Vec::new();
        for mut model in draft.models {
            model.remote_model_id = model.remote_model_id.trim().to_string();
            if model.remote_model_id.is_empty()
                || model.remote_model_id.len() > 512
                || !seen.insert(model.remote_model_id.clone())
            {
                return Err(AiError::new(
                    "INVALID_CONFIGURATION",
                    "模型 ID 不能为空或重复",
                ));
            }
            model.parameters.validate()?;
            let old = existing.and_then(|c| {
                c.models
                    .iter()
                    .find(|m| m.remote_model_id == model.remote_model_id)
            });
            model.id = old.map_or_else(|| id("model"), |m| m.id.clone());
            model.capabilities = old
                .filter(|old| !changed && old.parameters == model.parameters)
                .map(|m| m.capabilities.clone())
                .unwrap_or_default();
            if model.display_name.trim().is_empty() {
                model.display_name = model.remote_model_id.clone();
            }
            models.push(model);
        }
        self.conn.execute_batch("SAVEPOINT ai_connection_save")?;
        let result = (|| -> AiResult<()> {
            self.conn.execute("INSERT INTO ai_model_connections VALUES(?,?,?,?,?,?,0) ON CONFLICT(user_id,id) DO UPDATE SET payload_json=excluded.payload_json,protected_secret=excluded.protected_secret,revision=excluded.revision,config_revision=excluded.config_revision",params![ctx.user_id,conn_id,serde_json::to_string(&dto)?,protected_secret,revision,config_revision])?;
            self.conn.execute("INSERT INTO ai_connection_bindings VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id,connection_id) DO UPDATE SET enabled=excluded.enabled",params![ctx.workspace_id,ctx.user_id,conn_id,dto.bound])?;
            self.conn.execute("UPDATE ai_model_bindings SET enabled=0 WHERE workspace_id=? AND user_id=? AND connection_id=?",params![ctx.workspace_id,ctx.user_id,conn_id])?;
            for (sort, model) in models.iter().enumerate() {
                self.conn.execute("INSERT INTO ai_model_entries VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload_json=excluded.payload_json",params![ctx.user_id,model.id,conn_id,model.remote_model_id,serde_json::to_string(model)?])?;
                self.conn.execute("INSERT INTO ai_model_bindings VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,model_entry_id) DO UPDATE SET enabled=excluded.enabled,sort_order=excluded.sort_order",params![ctx.workspace_id,ctx.user_id,conn_id,model.id,model.enabled,sort])?;
            }
            if !catalog.defaults.contains_key("chat") {
                if let Some(model) = models
                    .iter()
                    .find(|m| m.enabled && dto.enabled && dto.bound)
                {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO ai_model_defaults VALUES(?,?,'chat',?)",
                        params![ctx.workspace_id, ctx.user_id, model.id],
                    )?;
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE ai_connection_save")?;
            }
            Err(error) => {
                let _ = self
                    .conn
                    .execute_batch("ROLLBACK TO ai_connection_save; RELEASE ai_connection_save");
                return Err(error);
            }
        }
        self.ai_catalog()?
            .connections
            .into_iter()
            .find(|c| c.id == conn_id)
            .ok_or_else(|| AiError::new("STORAGE_UNAVAILABLE", "保存后的连接不存在"))
    }

    pub(crate) fn ai_resolve_model(
        &self,
        purpose: &str,
        explicit: Option<&ModelRef>,
    ) -> AiResult<(AiConnection, AiModel, LlmConfig)> {
        let catalog = self.ai_catalog()?;
        let reference = explicit
            .or_else(|| catalog.defaults.get(purpose))
            .or_else(|| catalog.defaults.get("chat"))
            .ok_or_else(|| {
                AiError::new("MODEL_NOT_CONFIGURED", "请先在设置中添加并启用模型连接")
            })?;
        let connection = catalog
            .connections
            .into_iter()
            .find(|c| c.id == reference.connection_id && c.enabled && c.bound)
            .ok_or_else(|| {
                AiError::new(
                    "MODEL_UNAVAILABLE",
                    "连接已停用或未绑定当前工作区，请重新选择",
                )
            })?;
        let model = connection
            .models
            .iter()
            .find(|m| m.id == reference.model_entry_id && m.enabled)
            .cloned()
            .ok_or_else(|| {
                AiError::new(
                    "MODEL_UNAVAILABLE",
                    "模型已停用或未绑定当前工作区，请重新选择",
                )
            })?;
        let ctx = self.workspace_context()?;
        let secret:Option<String>=self.conn.query_row("SELECT protected_secret FROM ai_model_connections WHERE user_id=? AND id=? AND deleted=0",params![ctx.user_id,connection.id],|r|r.get(0))?;
        let mut parameters = connection.parameters.clone();
        if model.parameters.temperature.is_some() {
            parameters.temperature = model.parameters.temperature;
        }
        if model.parameters.top_p.is_some() {
            parameters.top_p = model.parameters.top_p;
        }
        if model.parameters.max_output_tokens.is_some() {
            parameters.max_output_tokens = model.parameters.max_output_tokens;
        }
        parameters.extra.extend(model.parameters.extra.clone());
        let config = LlmConfig {
            protocol: "openai".into(),
            base_url: connection.base_url.clone(),
            api_key: secret
                .map(|s| crate::ai_secrets::reveal(&s))
                .transpose()?
                .unwrap_or_default(),
            model_name: model.remote_model_id.clone(),
            generation_parameters: Some(parameters),
        };
        Ok((connection, model, config))
    }

    pub(crate) fn ai_config_for(&self, purpose: &str) -> Result<LlmConfig, String> {
        self.ai_resolve_model(purpose, None)
            .map(|(_, _, config)| config)
            .map_err(|e| e.to_string())
    }

    pub(crate) fn ai_set_default(&self, purpose: &str, reference: &ModelRef) -> AiResult<()> {
        if !["chat", "quick_parse", "report", "agent"].contains(&purpose) {
            return Err(AiError::new("INVALID_CONFIGURATION", "未知的模型用途"));
        }
        let (conn, model, _) = self.ai_resolve_model(purpose, Some(reference))?;
        if purpose == "agent"
            && (model.capabilities.tools != Some(true)
                || model.capabilities.config_revision != Some(conn.config_revision))
        {
            return Err(AiError::new(
                "CAPABILITY_REQUIRED",
                "请先通过此模型的工具调用测试",
            ));
        }
        let ctx = self.workspace_context()?;
        self.conn.execute("INSERT INTO ai_model_defaults VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id,purpose) DO UPDATE SET model_entry_id=excluded.model_entry_id",params![ctx.workspace_id,ctx.user_id,purpose,reference.model_entry_id])?;
        Ok(())
    }

    pub(crate) fn ai_delete_connection(&self, id: &str, revision: i64) -> AiResult<()> {
        let ctx = self.workspace_context()?;
        if self.conn.execute("UPDATE ai_model_connections SET deleted=1,revision=revision+1,config_revision=config_revision+1 WHERE user_id=? AND id=? AND revision=? AND deleted=0",params![ctx.user_id,id,revision])?!=1 {return Err(AiError::new("CONFIG_CONFLICT","连接已修改或删除，请刷新后重试"));}
        Ok(())
    }

    pub(crate) fn ai_update_capabilities(
        &self,
        reference: &ModelRef,
        revision: i64,
        tools: Option<bool>,
        streaming: Option<bool>,
    ) -> AiResult<()> {
        let (conn, mut model, _) = self.ai_resolve_model("chat", Some(reference))?;
        if conn.config_revision != revision {
            return Err(AiError::new(
                "CONFIG_CONFLICT",
                "测试期间连接已修改，请重新测试",
            ));
        }
        model.capabilities.tools = tools.or(model.capabilities.tools);
        model.capabilities.streaming = streaming.or(model.capabilities.streaming);
        model.capabilities.verified_at = Some(now());
        model.capabilities.config_revision = Some(revision);
        let ctx = self.workspace_context()?;
        self.conn.execute(
            "UPDATE ai_model_entries SET payload_json=? WHERE user_id=? AND id=?",
            params![serde_json::to_string(&model)?, ctx.user_id, model.id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_normalization_preserves_proxy_prefixes_and_rejects_credentials() {
        assert_eq!(
            normalize_base_url("http://localhost:11434/", "ollama").unwrap(),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            normalize_base_url("https://host/proxy/v1/chat/completions/", "vllm").unwrap(),
            "https://host/proxy/v1"
        );
        assert_eq!(
            normalize_base_url("http://host/proxy", "openai-compatible").unwrap(),
            "http://host/proxy"
        );
        assert!(normalize_base_url("file:///etc/passwd", "ollama").is_err());
        assert!(normalize_base_url("https://secret@host/v1", "ollama").is_err());
    }
}
