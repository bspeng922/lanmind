//! Workspace boundaries live at the database boundary, including background jobs.
use crate::db::Database;
use rusqlite::{functions::FunctionFlags, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

pub(crate) const TABLES: &[&str] = &[
    "projects",
    "tasks",
    "states",
    "task_comments",
    "task_assignment_notifications",
    "sync_operations",
    "project_join_requests",
    "chat_groups",
    "chat_messages",
    "group_announcements",
    "project_files",
    "project_folders",
    "local_org_units",
    "local_org_members",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub workspace_id: String,
    pub user_id: String,
    pub revision: u64,
}

impl Database {
    pub(crate) fn workspace_transaction<T>(
        &self,
        name: &str,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let before = self
            .active_workspace
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        self.conn
            .execute_batch(&format!("SAVEPOINT {name}"))
            .map_err(|e| e.to_string())?;
        let result = operation().and_then(|value| {
            self.conn
                .execute_batch(&format!("RELEASE {name}"))
                .map(|_| value)
                .map_err(|e| e.to_string())
        });
        if result.is_err() {
            let _ = self
                .conn
                .execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"));
            *self.active_workspace.write().map_err(|e| e.to_string())? = before;
        }
        result
    }
    pub(crate) fn initialize_workspace_scope(&self) -> Result<(), String> {
        let ws = self.setting("workspaceId")?.ok_or("工作区未初始化")?;
        *self.active_workspace.write().map_err(|e| e.to_string())? = ws.clone();
        let active = Arc::clone(&self.active_workspace);
        self.conn
            .create_scalar_function(
                "active_workspace_id",
                0,
                FunctionFlags::SQLITE_UTF8,
                move |_| Ok(active.read().map(|s| s.clone()).unwrap_or_default()),
            )
            .map_err(|e| e.to_string())?;
        if self.setting("workspaceIsolationV2")?.is_some() {
            return Ok(());
        }
        // The backup precedes every schema/data change and is never overwritten.
        if let Some(path) = self
            .conn
            .path()
            .filter(|p| !p.is_empty() && *p != ":memory:")
        {
            let backup = format!("{path}.workspace-v2.bak");
            if !std::path::Path::new(&backup).exists() {
                self.conn
                    .execute("VACUUM INTO ?", params![backup])
                    .map_err(|e| e.to_string())?;
            }
        }
        self.conn
            .execute_batch("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let result = self.migrate_workspace_scope(&ws);
        let result = match result {
            Ok(()) => self.conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        };
        self.conn
            .execute_batch("PRAGMA foreign_keys=ON")
            .map_err(|e| e.to_string())?;
        result
    }

    /// Early v2 databases already have authoritative workspace columns and a
    /// migration flag, but some historical JSON payloads were left unstamped.
    /// Repair them before state migrations update tasks under the JSON guard.
    pub(crate) fn migrate_workspace_payload_metadata(&self) -> Result<(), String> {
        if self.setting("workspacePayloadMetadataV2")?.is_some() {
            return Ok(());
        }
        let original = self
            .active_workspace
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        self.workspace_transaction("workspace_payload_metadata", || {
            for table in [
                "tasks",
                "task_comments",
                "task_assignment_notifications",
                "chat_messages",
                "chat_groups",
                "group_announcements",
            ] {
                let scopes: Vec<String> = self.conn
                    .prepare(&format!("SELECT DISTINCT workspace_id FROM {table} WHERE json_extract(payload_json,'$.workspaceId') IS NULL"))
                    .map_err(|e| e.to_string())?
                    .query_map([], |r| r.get(0)).map_err(|e| e.to_string())?
                    .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
                for scope in scopes {
                    // Honor each row's stored ownership, including quarantined
                    // legacy chats; never assign history to the current scope.
                    *self.active_workspace.write().map_err(|e| e.to_string())? = scope.clone();
                    self.conn.execute(
                        &format!("UPDATE {table} SET payload_json=json_set(payload_json,'$.workspaceId',workspace_id) WHERE workspace_id=? AND json_extract(payload_json,'$.workspaceId') IS NULL"),
                        params![scope],
                    ).map_err(|e| format!("回填 {table} 工作区标记失败: {e}"))?;
                }
            }
            *self.active_workspace.write().map_err(|e| e.to_string())? = original;
            // Keep historical sync payloads, clocks and context revisions intact.
            self.save_local_setting("workspacePayloadMetadataV2", "1")
        })
    }

    fn migrate_workspace_scope(&self, ws: &str) -> Result<(), String> {
        for table in TABLES {
            self.ensure_column(table, "workspace_id", "TEXT")?;
        }
        self.conn
            .execute(
                "UPDATE projects SET workspace_id=? WHERE workspace_id IS NULL OR workspace_id=''",
                params![ws],
            )
            .map_err(|e| e.to_string())?;
        for table in [
            "tasks",
            "states",
            "project_join_requests",
            "project_files",
            "project_folders",
            "chat_groups",
        ] {
            self.conn.execute(&format!("UPDATE {table} SET workspace_id=COALESCE((SELECT workspace_id FROM projects WHERE id={table}.project_id),?) WHERE workspace_id IS NULL OR workspace_id=''"), params![ws]).map_err(|e| e.to_string())?;
        }
        for (table, parent, column, json_column) in [
            ("task_comments", "tasks", "task_id", false),
            ("task_assignment_notifications", "tasks", "taskId", true),
            ("group_announcements", "chat_groups", "group_id", false),
            ("chat_messages", "chat_groups", "group_id", false),
        ] {
            let reference = if json_column {
                format!("json_extract({table}.payload_json,'$.{column}')")
            } else {
                format!("{table}.{column}")
            };
            self.conn.execute(&format!("UPDATE {table} SET workspace_id=COALESCE((SELECT workspace_id FROM {parent} WHERE id={reference}),?) WHERE workspace_id IS NULL OR workspace_id=''"), params![ws]).map_err(|e| e.to_string())?;
        }
        // Historic payloads are immutable; only their ownership index is backfilled.
        self.conn.execute("UPDATE sync_operations SET workspace_id=COALESCE(
            (SELECT workspace_id FROM tasks WHERE id=sync_operations.entity_id AND entity_type='task'),
            (SELECT workspace_id FROM projects WHERE id=sync_operations.entity_id AND entity_type='project'),
            (SELECT workspace_id FROM task_comments WHERE id=sync_operations.entity_id AND entity_type='task_comment'),
            (SELECT workspace_id FROM chat_groups WHERE id=sync_operations.entity_id AND entity_type='chat_group'),
            (SELECT workspace_id FROM chat_messages WHERE id=sync_operations.entity_id AND entity_type='chat_message'),
            (SELECT workspace_id FROM projects WHERE id=sync_operations.scope_id),
            json_extract(payload_json,'$.workspaceId'),?) WHERE workspace_id IS NULL OR workspace_id=''", params![ws]).map_err(|e| e.to_string())?;
        for table in ["local_org_units", "local_org_members"] {
            self.conn.execute(&format!("UPDATE {table} SET workspace_id=? WHERE workspace_id IS NULL OR workspace_id=''"), params![ws]).map_err(|e| e.to_string())?;
        }
        // Multi-workspace legacy chats have no reliable provenance. Retain them,
        // outside every active workspace, and record their count for recovery.
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if count > 1 {
            self.conn.execute_batch("UPDATE chat_groups SET workspace_id='__legacy_unassigned__' WHERE project_id IS NULL;
                UPDATE chat_messages SET workspace_id='__legacy_unassigned__' WHERE group_id IS NULL OR group_id IN (SELECT id FROM chat_groups WHERE workspace_id='__legacy_unassigned__');
                UPDATE group_announcements SET workspace_id='__legacy_unassigned__' WHERE group_id IN (SELECT id FROM chat_groups WHERE workspace_id='__legacy_unassigned__');
                UPDATE sync_operations SET workspace_id='__legacy_unassigned__' WHERE entity_type IN ('chat_message','chat_group','group_announcement') AND scope_id IS NULL;") .map_err(|e| e.to_string())?;
        }
        self.quarantine_orphaned_rows()?;
        for (table, column) in [
            ("projects", "created_by"),
            ("tasks", "creator_id"),
            ("tasks", "assignee_id"),
        ] {
            self.conn.execute_batch(&format!("INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by) SELECT workspace_id,{column},'member','member','2026-10-15',NULL,NULL FROM {table} WHERE workspace_id<>'__legacy_unassigned__';")).map_err(|e| e.to_string())?;
        }
        for (table, column) in [
            ("projects", "members_json"),
            ("projects", "admins_json"),
            ("tasks", "payload_json"),
        ] {
            let expression = if table == "tasks" {
                "json_extract(t.payload_json,'$.sharedWith')".to_string()
            } else {
                format!("t.{column}")
            };
            self.conn.execute_batch(&format!("INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by) SELECT t.workspace_id,j.value,'member','member','2026-10-15',NULL,NULL FROM {table} t,json_each({expression}) j WHERE t.workspace_id<>'__legacy_unassigned__' AND typeof(j.value)='text';")).map_err(|e| e.to_string())?;
        }
        for table in [
            "tasks",
            "task_comments",
            "task_assignment_notifications",
            "chat_messages",
            "chat_groups",
            "group_announcements",
        ] {
            self.conn.execute_batch(&format!("UPDATE {table} SET payload_json=json_set(payload_json,'$.workspaceId',workspace_id);")).map_err(|e| e.to_string())?;
        }
        for table in TABLES {
            self.rebuild_scoped_table(table)?;
        }
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS workspace_credentials(workspace_id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_private_data(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,feature TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,feature));
            CREATE TABLE IF NOT EXISTS workspace_llm_bindings(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
            CREATE TABLE IF NOT EXISTS workspace_templates(workspace_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,id));").map_err(|e| e.to_string())?;
        let token = self
            .setting("workspaceToken")?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        self.conn
            .execute(
                "INSERT OR IGNORE INTO workspace_credentials VALUES(?,?)",
                params![ws, token],
            )
            .map_err(|e| e.to_string())?;
        self.save_local_setting("workspaceOriginalId", ws)?;
        self.save_local_setting("workspaceOriginalUserId", &self.current_user_id()?)?;
        self.conn.execute("INSERT OR IGNORE INTO workspace_templates SELECT ?,id,payload_json FROM ppt_templates WHERE id NOT IN ('tpl-executive','tpl-business','tpl-tech','tpl-minimal')",params![ws]).map_err(|e| e.to_string())?;
        self.save_local_setting("workspaceRevision", "1")?;
        let mut counts = serde_json::Map::new();
        for table in TABLES {
            let count: i64 = self
                .conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table} WHERE workspace_id='__legacy_unassigned__'"
                    ),
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            counts.insert(table.to_string(), count.into());
        }
        self.save_local_setting(
            "workspaceMigrationQuarantine",
            &serde_json::Value::Object(counts).to_string(),
        )?;
        self.save_local_setting("workspaceIsolationV2", "1")
    }

    fn rebuild_scoped_table(&self, table: &str) -> Result<(), String> {
        let indexes: Vec<String> = self.conn.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").map_err(|e| e.to_string())?
            .query_map(params![table], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<Result<_,_>>().map_err(|e| e.to_string())?;
        let columns: Vec<(String, String, bool, Option<String>, i64)> = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?
            .query_map([], |r| {
                Ok((r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        let mut definitions = Vec::new();
        let mut keys: Vec<_> = columns.iter().filter(|c| c.4 > 0).collect();
        keys.sort_by_key(|c| c.4);
        for (name, kind, required, default, _) in &columns {
            if name == "workspace_id" {
                definitions.push("workspace_id TEXT NOT NULL DEFAULT (active_workspace_id()) CHECK(length(workspace_id)>0)".to_string());
            } else {
                definitions.push(format!(
                    "\"{name}\" {kind}{}{}",
                    if *required { " NOT NULL" } else { "" },
                    default
                        .as_ref()
                        .map(|d| format!(" DEFAULT {d}"))
                        .unwrap_or_default()
                ));
            }
        }
        if !keys.is_empty() {
            definitions.push(format!(
                "PRIMARY KEY({})",
                keys.iter()
                    .map(|c| format!("\"{}\"", c.0))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        // Organization IDs are workspace-local as well.
        if table == "local_org_members" {
            definitions.pop();
            definitions.push("PRIMARY KEY(workspace_id,org_unit_id,user_id)".into());
        }
        let relation = match table {
            "tasks"
            | "states"
            | "project_join_requests"
            | "project_files"
            | "project_folders"
            | "chat_groups" => Some(("project_id", "projects")),
            "task_comments" => Some(("task_id", "tasks")),
            "chat_messages" | "group_announcements" => Some(("group_id", "chat_groups")),
            "local_org_units" => Some(("parent_id", "local_org_units")),
            "local_org_members" => Some(("org_unit_id", "local_org_units")),
            _ => None,
        };
        if let Some((column, parent)) = relation {
            definitions.push(format!("FOREIGN KEY(workspace_id,{column}) REFERENCES {parent}(workspace_id,id) DEFERRABLE INITIALLY DEFERRED"));
        }
        let names = columns
            .iter()
            .map(|c| format!("\"{}\"", c.0))
            .collect::<Vec<_>>()
            .join(",");
        self.conn.execute_batch(&format!("CREATE TABLE {table}_ws_new({}); INSERT INTO {table}_ws_new({names}) SELECT {names} FROM {table}; DROP TABLE {table}; ALTER TABLE {table}_ws_new RENAME TO {table};", definitions.join(","))).map_err(|e| format!("{table}: {e}"))?;
        for index in indexes {
            self.conn.execute_batch(&index).map_err(|e| e.to_string())?;
        }
        self.conn
            .execute_batch(&format!(
                "CREATE INDEX idx_{table}_workspace ON {table}(workspace_id);"
            ))
            .map_err(|e| e.to_string())?;
        if table != "local_org_members" {
            self.conn.execute_batch(&format!("CREATE UNIQUE INDEX idx_{table}_workspace_id ON {table}(workspace_id,id);
                CREATE TRIGGER {table}_workspace_insert BEFORE INSERT ON {table} BEGIN
                    SELECT RAISE(ABORT,'workspace mismatch') WHERE NEW.workspace_id<>active_workspace_id();
                    SELECT RAISE(ABORT,'cross-workspace id collision') WHERE EXISTS(SELECT 1 FROM {table} WHERE id=NEW.id AND workspace_id<>NEW.workspace_id);
                END;
                CREATE TRIGGER {table}_workspace_update BEFORE UPDATE ON {table} BEGIN
                    SELECT RAISE(ABORT,'workspace is immutable') WHERE NEW.workspace_id<>OLD.workspace_id OR OLD.workspace_id<>active_workspace_id();
                END;")).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    fn quarantine_orphaned_rows(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS workspace_quarantine(source_table TEXT NOT NULL,payload_json TEXT NOT NULL,reason TEXT NOT NULL);").map_err(|e| e.to_string())?;
        // Move broken historical references out of business tables without guessing
        // an owner. Children are processed after parents, preserving every row.
        for (table, column, parent) in [
            ("tasks", "project_id", "projects"),
            ("states", "project_id", "projects"),
            ("chat_groups", "project_id", "projects"),
            ("task_comments", "task_id", "tasks"),
            ("project_files", "project_id", "projects"),
            ("project_folders", "project_id", "projects"),
            ("project_join_requests", "project_id", "projects"),
            ("chat_messages", "group_id", "chat_groups"),
            ("group_announcements", "group_id", "chat_groups"),
            ("local_org_members", "org_unit_id", "local_org_units"),
        ] {
            let columns: Vec<String> = self
                .conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|e| e.to_string())?
                .query_map([], |r| r.get(1))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            let json = columns
                .iter()
                .map(|c| format!("'{c}',\"{c}\""))
                .collect::<Vec<_>>()
                .join(",");
            let missing=format!("{column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM {parent} p WHERE p.id={table}.{column} AND p.workspace_id={table}.workspace_id)");
            self.conn.execute_batch(&format!("INSERT INTO workspace_quarantine SELECT '{table}',json_object({json}),'missing or foreign parent' FROM {table} WHERE {missing}; DELETE FROM {table} WHERE {missing};")).map_err(|e| e.to_string())?;
        }
        // A vanished local organization parent can safely become a root group.
        self.conn.execute_batch("UPDATE local_org_units SET parent_id=NULL WHERE parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_org_units p WHERE p.id=local_org_units.parent_id AND p.workspace_id=local_org_units.workspace_id);").map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn external_authorization(&self, service: &str) -> Result<WorkspaceContext, String> {
        if !matches!(service, "mcp" | "web") {
            return Err("未知的外部服务".into());
        }
        let key = format!("{service}WorkspaceAuthorization");
        if let Some(raw) = self.setting(&key)? {
            return serde_json::from_str(&raw).map_err(|e| e.to_string());
        }
        let context = self.workspace_context()?;
        self.save_external_authorization(service, &context)?;
        Ok(context)
    }

    pub(crate) fn save_external_authorization(
        &self,
        service: &str,
        context: &WorkspaceContext,
    ) -> Result<(), String> {
        if !matches!(service, "mcp" | "web") {
            return Err("未知的外部服务".into());
        }
        self.save_local_setting(
            &format!("{service}WorkspaceAuthorization"),
            &serde_json::to_string(context).map_err(|e| e.to_string())?,
        )
    }

    pub fn workspace_context(&self) -> Result<WorkspaceContext, String> {
        Ok(WorkspaceContext {
            workspace_id: self.setting("workspaceId")?.ok_or("工作区未初始化")?,
            user_id: self.current_user_id()?,
            revision: self
                .setting("workspaceRevision")?
                .unwrap_or_else(|| "1".into())
                .parse()
                .unwrap_or(1),
        })
    }
    pub fn validate_workspace_context(&self, expected: &WorkspaceContext) -> Result<(), String> {
        if &self.workspace_context()? != expected {
            return Err("工作区已切换，请重新载入后操作".into());
        }
        Ok(())
    }
    pub(crate) fn stamp_workspace(
        &self,
        map: &mut serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let ws = self.workspace_context()?.workspace_id;
        if map
            .get("workspaceId")
            .and_then(|v| v.as_str())
            .is_some_and(|id| id != ws)
        {
            return Err("对象不属于当前工作区".into());
        }
        map.insert("workspaceId".into(), ws.into());
        Ok(())
    }
    pub(crate) fn install_workspace_relations(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS wiki_documents(workspace_id TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,payload_json TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,id));
            CREATE TABLE IF NOT EXISTS ai_conversations(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,id));
            CREATE TABLE IF NOT EXISTS ai_messages(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id,conversation_id,id));").map_err(|e| e.to_string())?;
        self.ensure_column("wiki_documents", "version", "INTEGER NOT NULL DEFAULT 0")?;
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS llm_connections(user_id TEXT NOT NULL,id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(user_id,id));").map_err(|e| e.to_string())?;
        for (table, parent, column) in [
            ("tasks", "projects", "project_id"),
            ("states", "projects", "project_id"),
            ("task_comments", "tasks", "task_id"),
            ("project_files", "projects", "project_id"),
            ("project_folders", "projects", "project_id"),
            ("project_join_requests", "projects", "project_id"),
            ("chat_groups", "projects", "project_id"),
            ("chat_messages", "chat_groups", "group_id"),
            ("group_announcements", "chat_groups", "group_id"),
            ("local_org_units", "local_org_units", "parent_id"),
            ("local_org_members", "local_org_units", "org_unit_id"),
        ] {
            for event in ["INSERT", "UPDATE"] {
                self.conn.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS {table}_{column}_{event}_scope BEFORE {event} ON {table} BEGIN
                    SELECT RAISE(ABORT,'related object is outside workspace') WHERE NEW.{column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM {parent} WHERE id=NEW.{column} AND workspace_id=NEW.workspace_id);
                END;")).map_err(|e| e.to_string())?;
            }
        }
        for event in ["INSERT", "UPDATE"] {
            self.conn.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS tasks_json_{event}_scope BEFORE {event} ON tasks BEGIN
                SELECT RAISE(ABORT,'payload workspace mismatch') WHERE json_extract(NEW.payload_json,'$.workspaceId') IS NOT NEW.workspace_id;
                SELECT RAISE(ABORT,'parent task workspace mismatch') WHERE json_extract(NEW.payload_json,'$.parentTaskId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks p WHERE p.id=json_extract(NEW.payload_json,'$.parentTaskId') AND p.workspace_id=NEW.workspace_id AND p.project_id IS NEW.project_id);
                SELECT RAISE(ABORT,'state workspace mismatch') WHERE NEW.state_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM states s WHERE s.id=NEW.state_id AND s.workspace_id=NEW.workspace_id AND s.project_id IS NEW.project_id AND (s.project_id IS NOT NULL OR s.owner_id=NEW.creator_id));
            END;")).map_err(|e| e.to_string())?;
        }
        self.external_authorization("mcp")?;
        self.external_authorization("web")?;
        Ok(())
    }
    pub fn require_project_read(&self, project: &str, user: &str) -> Result<(), String> {
        if !self.projects(Some(user))?.iter().any(|p| p.id == project) {
            return Err("项目不存在或没有访问权限".into());
        }
        Ok(())
    }
    pub(crate) fn require_wiki_read(&self, id: &str, user: &str) -> Result<(), String> {
        let ws = self.workspace_context()?.workspace_id;
        let mut cursor = Some(id.to_string());
        let mut visited = std::collections::HashSet::new();
        while let Some(id) = cursor {
            if !visited.insert(id.clone()) {
                return Err("文档父级关系存在循环".into());
            }
            let raw: String = self
                .conn
                .query_row(
                    "SELECT payload_json FROM wiki_documents WHERE workspace_id=? AND id=? AND deleted=0",
                    params![ws, id],
                    |r| r.get(0),
                )
                .map_err(|_| "文档不存在或没有访问权限".to_string())?;
            let document: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if let Some(project) = document["projectId"].as_str() {
                self.require_project_read(project, user)?;
            }
            cursor = document["parentId"].as_str().map(str::to_owned);
        }
        Ok(())
    }

    pub(crate) fn apply_wiki_operation(
        &self,
        op: &crate::models::SyncOperation,
    ) -> Result<(), String> {
        let ctx = self.workspace_context()?;
        let existing: Option<(Option<String>, i64)> = self
            .conn
            .query_row(
                "SELECT project_id,version FROM wiki_documents WHERE workspace_id=? AND id=?",
                params![ctx.workspace_id, op.entity_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if existing
            .as_ref()
            .is_some_and(|(_, version)| *version >= op.version)
        {
            return Ok(());
        }
        if existing.is_some() {
            self.require_wiki_read(&op.entity_id, &op.node_id)?;
        }
        if op.action == "delete" {
            self.conn.execute("INSERT INTO wiki_documents(workspace_id,id,payload_json,deleted,version) VALUES(?,?,'{}',1,?) ON CONFLICT(workspace_id,id) DO UPDATE SET deleted=1,version=excluded.version",params![ctx.workspace_id,op.entity_id,op.version]).map_err(|e| e.to_string())?;
            return Ok(());
        }
        let document = &op.payload;
        if document["id"].as_str() != Some(&op.entity_id)
            || document["workspaceId"].as_str() != Some(&ctx.workspace_id)
        {
            return Err("文档同步归属不一致".into());
        }
        if let Some(project) = document["projectId"].as_str() {
            self.require_project_read(project, &op.node_id)?;
        }
        if let Some(parent) = document["parentId"].as_str() {
            let valid:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM wiki_documents WHERE workspace_id=? AND id=? AND deleted=0)",params![ctx.workspace_id,parent],|r| r.get(0)).map_err(|e| e.to_string())?;
            if !valid {
                return Err("文档父级尚未同步或不属于当前工作区".into());
            }
            self.require_wiki_read(parent, &op.node_id)?;
            let mut cursor = Some(parent.to_string());
            let mut visited = std::collections::HashSet::from([op.entity_id.clone()]);
            while let Some(id) = cursor {
                if !visited.insert(id.clone()) {
                    return Err("文档父级关系存在循环".into());
                }
                let raw: String = self
                    .conn
                    .query_row(
                        "SELECT payload_json FROM wiki_documents WHERE workspace_id=? AND id=?",
                        params![ctx.workspace_id, id],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                let value: serde_json::Value =
                    serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                cursor = value["parentId"].as_str().map(str::to_owned);
            }
        }
        self.conn.execute("INSERT OR REPLACE INTO wiki_documents(workspace_id,id,project_id,payload_json,deleted,version) VALUES(?,?,?,?,0,?)",params![ctx.workspace_id,op.entity_id,document["projectId"].as_str(),document.to_string(),op.version]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn workspace_users(&self) -> Result<Vec<crate::models::User>, String> {
        let members = self.workspace_members(&self.workspace_context()?.workspace_id)?;
        Ok(self
            .users()?
            .into_iter()
            .filter(|u| {
                members
                    .iter()
                    .any(|m| m.user_id == u.id && m.status == "member")
            })
            .collect())
    }
    pub(crate) fn require_workspace_member(&self, user: &str) -> Result<(), String> {
        let member:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=active_workspace_id() AND user_id=? AND status='member')",params![user],|r| r.get(0)).map_err(|e| e.to_string())?;
        if !member {
            return Err("所选用户不是当前工作区成员".into());
        }
        Ok(())
    }
    pub fn read_private_data(&self, feature: &str) -> Result<Option<serde_json::Value>, String> {
        let ctx = self.workspace_context()?;
        if feature == "wiki" {
            return self.read_wiki_data();
        }
        if feature == "ai" {
            let summaries: Vec<serde_json::Value> = self
                .conn
                .prepare(
                    "SELECT payload_json FROM ai_conversations WHERE workspace_id=? AND user_id=?",
                )
                .map_err(|e| e.to_string())?
                .query_map(params![ctx.workspace_id, ctx.user_id], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?
                .map(|r| {
                    serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
                })
                .collect::<Result<_, _>>()?;
            if summaries.is_empty() {
                let initialized:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM workspace_private_data WHERE workspace_id=? AND user_id=? AND feature='ai')",params![ctx.workspace_id,ctx.user_id],|r| r.get(0)).map_err(|e| e.to_string())?;
                return Ok(initialized.then(
                    || serde_json::json!({"index":{"version":1,"conversations":[]},"messages":{}}),
                ));
            }
            let mut messages = serde_json::Map::new();
            for summary in &summaries {
                let id = summary["id"].as_str().ok_or("会话 ID 无效")?;
                let rows: Vec<serde_json::Value>=self.conn.prepare("SELECT payload_json FROM ai_messages WHERE workspace_id=? AND user_id=? AND conversation_id=? ORDER BY rowid").map_err(|e| e.to_string())?.query_map(params![ctx.workspace_id,ctx.user_id,id],|r| r.get::<_,String>(0)).map_err(|e| e.to_string())?.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect::<Result<_,_>>()?;
                messages.insert(id.to_string(), rows.into());
            }
            return Ok(Some(
                serde_json::json!({"index":{"version":1,"conversations":summaries},"messages":messages}),
            ));
        }
        self.conn.query_row("SELECT payload_json FROM workspace_private_data WHERE workspace_id=? AND user_id=? AND feature=?", params![ctx.workspace_id,ctx.user_id,feature], |r| r.get::<_,String>(0)).optional().map_err(|e| e.to_string())?.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string())).transpose()
    }
    pub fn save_private_data(
        &self,
        feature: &str,
        payload: &serde_json::Value,
    ) -> Result<(), String> {
        if !matches!(feature, "wiki" | "ai" | "wikiView") {
            return Err("未知的工作区存储类型".into());
        }
        let ctx = self.workspace_context()?;
        self.conn
            .execute_batch("SAVEPOINT workspace_data")
            .map_err(|e| e.to_string())?;
        let result = (|| {
            if feature == "wiki" {
                return self.save_wiki_data(payload);
            }
            if feature == "ai" {
                let migrated: bool = self.conn.query_row("SELECT COALESCE((SELECT messages_migrated FROM ai_storage_versions WHERE workspace_id=? AND user_id=?),0)", params![ctx.workspace_id,ctx.user_id], |r| r.get(0)).map_err(|e| e.to_string())?;
                if migrated { return Err("AI_STORAGE_VERSION: 会话存储已升级，请刷新窗口".into()); }
                let summaries = payload["index"]["conversations"]
                    .as_array()
                    .ok_or("会话索引无效")?;
                self.conn
                    .execute(
                        "DELETE FROM ai_messages WHERE workspace_id=? AND user_id=?",
                        params![ctx.workspace_id, ctx.user_id],
                    )
                    .map_err(|e| e.to_string())?;
                self.conn
                    .execute(
                        "DELETE FROM ai_conversations WHERE workspace_id=? AND user_id=?",
                        params![ctx.workspace_id, ctx.user_id],
                    )
                    .map_err(|e| e.to_string())?;
                for summary in summaries {
                    let id = summary["id"].as_str().ok_or("会话 ID 无效")?;
                    self.conn
                        .execute(
                            "INSERT INTO ai_conversations VALUES(?,?,?,?)",
                            params![ctx.workspace_id, ctx.user_id, id, summary.to_string()],
                        )
                        .map_err(|e| e.to_string())?;
                    for message in payload["messages"][id].as_array().into_iter().flatten() {
                        self.conn
                            .execute(
                                "INSERT INTO ai_messages VALUES(?,?,?,?,?)",
                                params![
                                    ctx.workspace_id,
                                    ctx.user_id,
                                    id,
                                    message["id"].as_str().ok_or("消息 ID 无效")?,
                                    message.to_string()
                                ],
                            )
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO workspace_private_data VALUES(?,?,?,?)",
                    params![ctx.workspace_id, ctx.user_id, feature, payload.to_string()],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
        })();
        if result.is_ok() {
            self.conn
                .execute_batch("RELEASE workspace_data")
                .map_err(|e| e.to_string())?;
        } else {
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO workspace_data; RELEASE workspace_data");
        }
        result
    }
    fn read_wiki_data(&self) -> Result<Option<serde_json::Value>, String> {
        let ctx = self.workspace_context()?;
        let mut documents = self.wiki_pages(&ctx.user_id)?;
        let view = self.read_private_data("wikiView")?.unwrap_or_else(
            || serde_json::json!({"selectedId":null,"expandedIds":[],"favorites":[]}),
        );
        if documents.is_empty() && view.get("initialized").is_none() {
            return Ok(None);
        }
        for document in &mut documents {
            document["favorite"] = serde_json::json!(view["favorites"]
                .as_array()
                .is_some_and(|a| a.contains(&document["id"])));
        }
        Ok(Some(
            serde_json::json!({"documents":documents,"selectedId":view["selectedId"],"expandedIds":view["expandedIds"]}),
        ))
    }
    fn save_wiki_data(&self, payload: &serde_json::Value) -> Result<(), String> {
        let ctx = self.workspace_context()?;
        let documents = payload["documents"].as_array().ok_or("文档数据无效")?;
        let mut ids = std::collections::HashSet::new();
        for document in documents {
            let id = document["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("文档 ID 无效")?;
            if !ids.insert(id) {
                return Err("文档 ID 重复".into());
            }
            let mut cursor = Some(id);
            let mut visited = std::collections::HashSet::new();
            while let Some(id) = cursor {
                if !visited.insert(id) {
                    return Err("文档父级关系存在循环".into());
                }
                let ancestor = documents
                    .iter()
                    .find(|d| d["id"].as_str() == Some(id))
                    .ok_or("文档父级不属于该工作区")?;
                if let Some(project) = ancestor["projectId"].as_str() {
                    self.require_project_read(project, &ctx.user_id)?;
                }
                cursor = ancestor["parentId"].as_str();
            }
        }
        for document in documents {
            if document["workspaceId"]
                .as_str()
                .is_some_and(|ws| ws != ctx.workspace_id)
            {
                return Err("文档工作区不一致".into());
            }
            if let Some(project) = document["projectId"].as_str() {
                self.require_project_read(project, &ctx.user_id)?;
            }
            if let Some(parent) = document["parentId"].as_str() {
                if !documents.iter().any(|d| d["id"].as_str() == Some(parent)) {
                    return Err("文档父级不属于该工作区".into());
                }
            }
            let id = document["id"].as_str().ok_or("文档 ID 无效")?;
            let old: Option<String> = self
                .conn
                .query_row(
                    "SELECT project_id FROM wiki_documents WHERE workspace_id=? AND id=?",
                    params![ctx.workspace_id, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();
            if let Some(project) = old {
                self.require_project_read(&project, &ctx.user_id)?;
            }
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM wiki_documents WHERE workspace_id=? AND id=?)",
                    params![ctx.workspace_id, id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if exists {
                self.require_wiki_read(id, &ctx.user_id)?;
            }
            let mut shared = document.clone();
            if let Some(o)=shared.as_object_mut(){o.remove("version");}
            shared["favorite"] = false.into();
            shared["workspaceId"] = ctx.workspace_id.clone().into();
            let previous:Option<String>=self.conn.query_row("SELECT payload_json FROM wiki_documents WHERE workspace_id=? AND id=? AND deleted=0",params![ctx.workspace_id,id],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
            if previous.as_deref() != Some(&shared.to_string()) {
                self.log_operation(
                    "wiki_document",
                    id,
                    if previous.is_some() {
                        "update"
                    } else {
                        "create"
                    },
                    shared.clone(),
                    &ctx.user_id,
                    document["projectId"].as_str(),
                )?;
                let version = self
                    .setting("localClock")?
                    .unwrap_or_default()
                    .parse::<i64>()
                    .unwrap_or(0);
                self.conn.execute("INSERT OR REPLACE INTO wiki_documents(workspace_id,id,project_id,payload_json,deleted,version) VALUES(?,?,?,?,0,?)",params![ctx.workspace_id,id,document["projectId"].as_str(),shared.to_string(),version]).map_err(|e| e.to_string())?;
            }
        }
        for id in payload["deletedIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|id| id.as_str())
        {
            let project: Option<String> = self
                .conn
                .query_row(
                    "SELECT project_id FROM wiki_documents WHERE workspace_id=? AND id=?",
                    params![ctx.workspace_id, id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();
            if let Some(project) = project.as_ref() {
                self.require_project_read(project, &ctx.user_id)?;
            }
            self.log_operation(
                "wiki_document",
                id,
                "delete",
                serde_json::json!({"id":id,"workspaceId":ctx.workspace_id}),
                &ctx.user_id,
                project.as_deref(),
            )?;
            let version = self
                .setting("localClock")?
                .unwrap_or_default()
                .parse::<i64>()
                .unwrap_or(0);
            self.conn
                .execute(
                    "UPDATE wiki_documents SET deleted=1,version=? WHERE workspace_id=? AND id=?",
                    params![version, ctx.workspace_id, id],
                )
                .map_err(|e| e.to_string())?;
        }
        let favorites: Vec<_> = documents
            .iter()
            .filter(|d| d["favorite"] == true)
            .map(|d| d["id"].clone())
            .collect();
        self.save_private_data("wikiView",&serde_json::json!({"initialized":true,"selectedId":payload["selectedId"],"expandedIds":payload["expandedIds"],"favorites":favorites}))
    }
}

pub(crate) fn new_active_workspace() -> Arc<RwLock<String>> {
    Arc::new(RwLock::new(String::new()))
}

#[cfg(test)]
#[path = "workspace_scope_tests.rs"]
mod tests;
