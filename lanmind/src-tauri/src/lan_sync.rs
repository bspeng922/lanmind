//! SQLite feed and receiver state for the LAN transport. Business versions remain
//! independent of delivery order: a relay can learn an older operation later.

use crate::db::Database;
use crate::models::SyncOperation;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub(crate) const PAGE_OPERATIONS: usize = 128;
pub(crate) const PAGE_BYTES: usize = 1024 * 1024;
const CHAT: u8 = 1;
const WIKI: u8 = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct FeedCursor {
    pub(crate) log_id: String,
    pub(crate) access_revision: i64,
    pub(crate) features: u8,
    pub(crate) receiver_features: u8,
    pub(crate) after: i64,
    pub(crate) through: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SignedCursor {
    pub(crate) value: FeedCursor,
    pub(crate) signature: String,
}

pub(crate) struct FeedPage {
    pub(crate) operations: Vec<SyncOperation>,
    pub(crate) cursor: FeedCursor,
    pub(crate) finished: bool,
}

impl Database {
    pub(crate) fn install_lan_sync(&self) -> Result<(), String> {
        self.workspace_transaction("install_lan_sync", || {
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS lan_sync_identity (id TEXT NOT NULL);
                 CREATE TABLE IF NOT EXISTS lan_sync_sequence (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id TEXT NOT NULL,
                    operation_id TEXT NOT NULL UNIQUE
                 );
                 CREATE INDEX IF NOT EXISTS idx_lan_sync_sequence_workspace
                    ON lan_sync_sequence(workspace_id, sequence);
                 CREATE TABLE IF NOT EXISTS lan_sync_access (
                    workspace_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS lan_sync_cursors (
                    workspace_id TEXT NOT NULL, local_user_id TEXT NOT NULL, peer_id TEXT NOT NULL,
                    cursor_json TEXT NOT NULL, PRIMARY KEY(workspace_id,local_user_id,peer_id)
                 );
                 CREATE TABLE IF NOT EXISTS lan_sync_pending (
                    workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                    dependency_type TEXT NOT NULL, dependency_id TEXT NOT NULL,
                    operation_json TEXT NOT NULL, PRIMARY KEY(workspace_id,operation_id)
                 );
                 CREATE TRIGGER IF NOT EXISTS lan_sync_append AFTER INSERT ON sync_operations
                 BEGIN
                    INSERT INTO lan_sync_sequence(workspace_id,operation_id) VALUES(NEW.workspace_id,NEW.id);
                 END;
                 CREATE TRIGGER IF NOT EXISTS lan_sync_remove AFTER DELETE ON sync_operations
                 BEGIN
                    DELETE FROM lan_sync_sequence WHERE operation_id=OLD.id;
                 END;",
            ).map_err(|error| error.to_string())?;
            let initialized: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM lan_sync_identity)", [], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            if !initialized {
                self.conn.execute(
                    "INSERT INTO lan_sync_sequence(workspace_id,operation_id)
                     SELECT workspace_id,id FROM sync_operations ORDER BY version,id", [],
                ).map_err(|error| error.to_string())?;
                self.conn.execute("INSERT INTO lan_sync_identity VALUES(?)", [Uuid::new_v4().to_string()])
                    .map_err(|error| error.to_string())?;
            }
            self.install_lan_access_triggers()
        })
    }

    fn install_lan_access_triggers(&self) -> Result<(), String> {
        // Compare only access fields. REPLACE writers (projects, chat and Wiki)
        // need the comparison before the old row has been replaced.
        let tables: &[(&str, &str, &[&str], &[&str])] = &[
            ("workspace_members", "user_id", &["role", "status"], &[]),
            (
                "projects",
                "id",
                &[
                    "created_by",
                    "admins_json",
                    "members_json",
                    "visibility",
                    "deleted",
                ],
                &[],
            ),
            (
                "tasks",
                "id",
                &[
                    "project_id",
                    "creator_id",
                    "assignee_id",
                    "deleted",
                    "purged_at",
                ],
                &["isShared", "sharedWith"],
            ),
            ("chat_groups", "id", &["project_id"], &["memberIds"]),
            (
                "wiki_documents",
                "id",
                &["project_id", "deleted"],
                &["parentId"],
            ),
        ];
        let bump = |row: &str| {
            format!(
                "INSERT INTO lan_sync_access VALUES({row}.workspace_id,1)
             ON CONFLICT(workspace_id) DO UPDATE SET revision=revision+1;"
            )
        };
        for (table, key, columns, fields) in tables {
            let differences = columns.iter().map(|column| format!("OLD.{column} IS NOT NEW.{column}"))
                .chain(fields.iter().map(|field| format!(
                    "json_extract(OLD.payload_json,'$.{field}') IS NOT json_extract(NEW.payload_json,'$.{field}')"
                )))
                .collect::<Vec<_>>().join(" OR ");
            let insert_condition = format!(
                "EXISTS(SELECT 1 FROM {table} OLD WHERE OLD.workspace_id=NEW.workspace_id
                         AND OLD.{key}=NEW.{key} AND ({differences}))"
            );
            self.conn
                .execute_batch(&format!(
                    "CREATE TRIGGER IF NOT EXISTS lan_sync_{table}_replace BEFORE INSERT ON {table}
                 WHEN {insert_condition} BEGIN {bump_new} END;
                 CREATE TRIGGER IF NOT EXISTS lan_sync_{table}_access AFTER UPDATE ON {table}
                 WHEN {differences} BEGIN {bump_new} END;
                 CREATE TRIGGER IF NOT EXISTS lan_sync_{table}_delete AFTER DELETE ON {table}
                 BEGIN {bump_old} END;",
                    bump_new = bump("NEW"),
                    bump_old = bump("OLD"),
                ))
                .map_err(|error| error.to_string())?;
        }
        self.conn
            .execute_batch(
                "CREATE TRIGGER IF NOT EXISTS lan_sync_new_member AFTER INSERT ON workspace_members
             WHEN NEW.status='member' BEGIN
                INSERT INTO lan_sync_access VALUES(NEW.workspace_id,1)
                ON CONFLICT(workspace_id) DO UPDATE SET revision=revision+1;
             END;",
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn purge_lan_sync(&self, workspace: &str) -> Result<(), String> {
        for table in ["lan_sync_cursors", "lan_sync_pending", "lan_sync_access"] {
            self.conn
                .execute(
                    &format!("DELETE FROM {table} WHERE workspace_id=?"),
                    [workspace],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub(crate) fn clear_pending_sync(
        &self,
        entities: &[&str],
        workspace: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM lan_sync_pending WHERE (?1 IS NULL OR workspace_id=?1)
             AND json_extract(operation_json,'$.entityType') IN (SELECT value FROM json_each(?2))",
                params![
                    workspace,
                    serde_json::to_string(entities).map_err(|error| error.to_string())?
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn lan_access_revision(&self) -> Result<i64, String> {
        self.conn.query_row(
            "SELECT COALESCE((SELECT revision FROM lan_sync_access WHERE workspace_id=active_workspace_id()),0)",
            [], |row| row.get(0),
        ).map_err(|error| error.to_string())
    }

    pub(crate) fn lan_features(&self) -> Result<u8, String> {
        let enabled = self.feature_modules()?;
        Ok(u8::from(enabled.get("chat") == Some(&true)) * CHAT
            | u8::from(enabled.get("wiki") == Some(&true)) * WIKI)
    }

    pub(crate) fn lan_cursor(
        &self,
        local_user: &str,
        peer: &str,
    ) -> Result<Option<SignedCursor>, String> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT cursor_json FROM lan_sync_cursors
             WHERE workspace_id=active_workspace_id() AND local_user_id=? AND peer_id=?",
                params![local_user, peer],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))
            .transpose()
    }

    pub(crate) fn lan_page(
        &self,
        recipient: &str,
        previous: Option<&FeedCursor>,
        receiver_features: u8,
    ) -> Result<FeedPage, String> {
        let log_id: String = self
            .conn
            .query_row("SELECT id FROM lan_sync_identity", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let access_revision = self.lan_access_revision()?;
        let features = self.lan_features()?;
        let previous = previous.filter(|cursor| {
            cursor.log_id == log_id
                && cursor.access_revision == access_revision
                && cursor.features == features
                && cursor.receiver_features == receiver_features
        });
        let after = previous.map_or(0, |cursor| cursor.after);
        let snapshot = match previous.map(|cursor| cursor.through).filter(|through| *through > after) {
            Some(through) => through,
            None => self.conn.query_row(
                "SELECT COALESCE(MAX(sequence),0) FROM lan_sync_sequence WHERE workspace_id=active_workspace_id()",
                [], |row| row.get::<_, i64>(0),
            ).map_err(|error| error.to_string())?.max(after),
        };
        let mut scanned = after;
        let mut operations = Vec::new();
        if snapshot > after {
            let mut stmt = self.conn.prepare(
                "SELECT seq.sequence, op.id, op.entity_type, op.entity_id, op.action, op.payload_json,
                        op.timestamp, op.node_id, op.version, op.scope_id, op.workspace_id,
                        length(CAST(op.payload_json AS BLOB))
                 FROM lan_sync_sequence seq JOIN sync_operations op ON op.id=seq.operation_id
                 WHERE seq.workspace_id=active_workspace_id() AND seq.sequence>? AND seq.sequence<=?
                 ORDER BY seq.sequence LIMIT ?",
            ).map_err(|error| error.to_string())?;
            let mut rows = stmt
                .query(params![after, snapshot, PAGE_OPERATIONS])
                .map_err(|error| error.to_string())?;
            let mut estimated_bytes: usize = 2;
            let mut examined = 0;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                let sequence: i64 = row.get(0).map_err(|error| error.to_string())?;
                let op_type: String = row.get(2).map_err(|error| error.to_string())?;
                if !allows(features & receiver_features, &op_type)
                    || op_type == "workspace_join_request"
                {
                    scanned = sequence;
                    examined += 1;
                    continue;
                }
                let payload_size: usize = row.get(11).map_err(|error| error.to_string())?;
                let op = (|| -> rusqlite::Result<SyncOperation> {
                    Ok(SyncOperation {
                        id: row.get(1)?,
                        entity_type: op_type,
                        entity_id: row.get(3)?,
                        action: row.get(4)?,
                        payload: Value::Null,
                        timestamp: row.get(6)?,
                        node_id: row.get(7)?,
                        version: row.get(8)?,
                        scope_id: row.get(9)?,
                        workspace_id: row.get(10)?,
                    })
                })()
                .map_err(|error| error.to_string())?;
                let header_size = serde_json::to_vec(&op)
                    .map_err(|error| error.to_string())?
                    .len();
                let estimated = header_size.saturating_add(payload_size).saturating_add(1);
                if !operations.is_empty() && estimated_bytes.saturating_add(estimated) > PAGE_BYTES
                {
                    break;
                }
                let mut op = op;
                let raw: String = row.get(5).map_err(|error| error.to_string())?;
                op.payload = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
                operations.push(op);
                scanned = sequence;
                examined += 1;
                estimated_bytes = estimated_bytes.saturating_add(estimated);
                if estimated_bytes >= PAGE_BYTES {
                    break;
                }
            }
            if examined < PAGE_OPERATIONS && estimated_bytes < PAGE_BYTES && scanned == after {
                scanned = snapshot;
            }
        }

        let operations = self.project_sync_operations_for_user(operations, recipient)?;
        let finished = scanned >= snapshot;
        Ok(FeedPage {
            operations,
            finished,
            cursor: FeedCursor {
                log_id,
                access_revision,
                features,
                receiver_features,
                after: scanned,
                through: if finished { 0 } else { snapshot },
            },
        })
    }

    pub(crate) fn accept_lan_page(
        &self,
        local_user: &str,
        peer: &str,
        cursor: &SignedCursor,
        operations: Vec<SyncOperation>,
    ) -> Result<Vec<SyncOperation>, String> {
        if operations.len() > PAGE_OPERATIONS
            || cursor.value.receiver_features != self.lan_features()?
        {
            return Err("LAN sync page no longer matches the receiver".into());
        }
        self.workspace_transaction("apply_lan_page", || {
            let mut applied = Vec::new();
            for op in operations {
                self.apply_or_stage_lan_operation(op, &mut applied)?;
            }
            self.retry_ready_lan_operations(&mut applied)?;
            self.conn.execute(
                "INSERT INTO lan_sync_cursors VALUES(active_workspace_id(),?,?,?)
                 ON CONFLICT(workspace_id,local_user_id,peer_id) DO UPDATE SET cursor_json=excluded.cursor_json
                 WHERE cursor_json<>excluded.cursor_json",
                params![local_user, peer, serde_json::to_string(cursor).map_err(|error| error.to_string())?],
            ).map_err(|error| error.to_string())?;
            Ok(applied)
        })
    }

    fn apply_or_stage_lan_operation(
        &self,
        mut op: SyncOperation,
        applied: &mut Vec<SyncOperation>,
    ) -> Result<(), String> {
        if op.workspace_id.as_deref() != Some(self.workspace_context()?.workspace_id.as_str()) {
            return Err("LAN operation belongs to another workspace".into());
        }
        if is_recycle(&op) {
            if op.payload["items"].as_array().is_none() {
                return Err("invalid LAN recycle payload".into());
            }
            let pending: Option<String> = self.conn.query_row(
                "SELECT operation_json FROM lan_sync_pending WHERE workspace_id=active_workspace_id() AND operation_id=?",
                [&op.id], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?;
            if let Some(raw) = pending {
                let mut staged: SyncOperation =
                    serde_json::from_str(&raw).map_err(|error| error.to_string())?;
                same_recycle_operation(&staged, &op)?;
                extend_recycle_projection(&mut staged.payload, &mut op.payload)?;
                op = staged;
            }
            self.remove_erased_recycle_entries(&mut op)?;
        }
        if let Some((table, id)) = self.lan_dependency(&op)? {
            let payload = serde_json::to_string(&op).map_err(|error| error.to_string())?;
            self.conn
                .execute(
                    "INSERT INTO lan_sync_pending VALUES(active_workspace_id(),?,?,?,?)
                 ON CONFLICT(workspace_id,operation_id) DO UPDATE SET
                    dependency_type=excluded.dependency_type,dependency_id=excluded.dependency_id,
                    operation_json=excluded.operation_json",
                    params![op.id, table, id, payload],
                )
                .map_err(|error| error.to_string())?;
            return Ok(());
        }
        let changed = if is_recycle(&op) {
            self.apply_recycle_projection(&mut op)?
        } else {
            self.apply_operation(&op)?
        };
        self.conn.execute(
            "DELETE FROM lan_sync_pending WHERE workspace_id=active_workspace_id() AND operation_id=?", [&op.id],
        ).map_err(|error| error.to_string())?;
        if changed {
            applied.push(op);
        }
        Ok(())
    }

    fn apply_recycle_projection(&self, op: &mut SyncOperation) -> Result<bool, String> {
        let previous = self.conn.query_row(
            "SELECT entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id
             FROM sync_operations WHERE workspace_id=active_workspace_id() AND id=?",
            [&op.id], |row| Ok((
                SyncOperation {
                    id: op.id.clone(), workspace_id: op.workspace_id.clone(), entity_type: row.get(0)?,
                    entity_id: row.get(1)?, action: row.get(2)?, payload: Value::Null,
                    timestamp: row.get(4)?, node_id: row.get(5)?, version: row.get(6)?, scope_id: row.get(7)?,
                },
                row.get::<_, String>(3)?,
            )),
        ).optional().map_err(|error| error.to_string())?;
        let Some((mut previous, raw)) = previous else {
            return self.apply_operation(op);
        };
        same_recycle_operation(&previous, op)?;
        previous.payload = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        if !extend_recycle_projection(&mut previous.payload, &mut op.payload)? {
            return Ok(false);
        }
        self.apply_task_recycle_operation(op)?;
        self.conn.execute(
            "UPDATE sync_operations SET payload_json=? WHERE workspace_id=active_workspace_id() AND id=?",
            params![previous.payload.to_string(), op.id],
        ).map_err(|error| error.to_string())?;
        // A relay that already acknowledged the old projection must see these items.
        self.conn
            .execute(
                "DELETE FROM lan_sync_sequence WHERE operation_id=?",
                [&op.id],
            )
            .map_err(|error| error.to_string())?;
        self.conn.execute(
            "INSERT INTO lan_sync_sequence(workspace_id,operation_id) VALUES(active_workspace_id(),?)", [&op.id],
        ).map_err(|error| error.to_string())?;
        Ok(true)
    }

    fn remove_erased_recycle_entries(&self, op: &mut SyncOperation) -> Result<(), String> {
        if op.action == "purge" {
            return Ok(());
        }
        for key in ["items", "detached"] {
            let Some(entries) = op.payload.get_mut(key).and_then(Value::as_array_mut) else {
                continue;
            };
            let mut keep = Vec::with_capacity(entries.len());
            for entry in std::mem::take(entries) {
                let id = recycle_item_id(key, &entry).ok_or("invalid LAN recycle item")?;
                let purged_generation: Option<(i64, String)> = self
                    .conn
                    .query_row(
                        "SELECT deletion_version,COALESCE(deletion_id,'') FROM tasks
                     WHERE workspace_id=active_workspace_id() AND id=? AND purged_at IS NOT NULL",
                        [id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                let generation = recycle_generation(&entry);
                if purged_generation.as_ref().is_none_or(|(version, id)| {
                    key == "items" && generation > (*version, id.as_str())
                }) {
                    keep.push(entry);
                }
            }
            *entries = keep;
        }
        Ok(())
    }

    pub(crate) fn redact_lan_pending_task(&self, id: &str) -> Result<(), String> {
        self.conn.execute(
            "DELETE FROM lan_sync_pending WHERE workspace_id=active_workspace_id() AND (
                (json_extract(operation_json,'$.entityType')='task'
                 AND json_extract(operation_json,'$.action') NOT IN ('trash','restore','purge')
                 AND json_extract(operation_json,'$.entityId')=?1)
                OR (json_extract(operation_json,'$.entityType') IN ('task_comment','task_assignment')
                    AND json_extract(operation_json,'$.payload.taskId')=?1)
             )", [id],
        ).map_err(|error| error.to_string())?;
        let mut stmt = self.conn.prepare(
            "SELECT operation_id FROM lan_sync_pending p WHERE workspace_id=active_workspace_id()
               AND json_extract(operation_json,'$.entityType')='task'
               AND json_extract(operation_json,'$.action') IN ('trash','restore')
               AND (EXISTS(SELECT 1 FROM json_each(p.operation_json,'$.payload.items') item
                           WHERE json_extract(item.value,'$.task.id')=?1)
                 OR EXISTS(SELECT 1 FROM json_each(p.operation_json,'$.payload.detached') item
                           WHERE json_extract(item.value,'$.id')=?1))",
        ).map_err(|error| error.to_string())?;
        let affected = stmt
            .query_map([id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        for op_id in affected {
            let raw: String = self.conn.query_row(
                "SELECT operation_json FROM lan_sync_pending WHERE workspace_id=active_workspace_id() AND operation_id=?",
                [&op_id], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            let mut op = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
            self.remove_erased_recycle_entries(&mut op)?;
            if ["items", "detached"]
                .iter()
                .all(|key| op.payload[*key].as_array().is_none_or(Vec::is_empty))
            {
                self.conn.execute(
                    "DELETE FROM lan_sync_pending WHERE workspace_id=active_workspace_id() AND operation_id=?",
                    [&op_id],
                ).map_err(|error| error.to_string())?;
            } else {
                // Keep the existing dependency if it still blocks this projection.
                // A removed item has a tombstone and is ready for dependency reevaluation.
                self.conn.execute(
                    "UPDATE lan_sync_pending SET operation_json=?,
                     dependency_type=CASE WHEN dependency_type='task_deletions' AND dependency_id=? THEN 'tasks' ELSE dependency_type END
                     WHERE workspace_id=active_workspace_id() AND operation_id=?",
                    params![serde_json::to_string(&op).map_err(|error| error.to_string())?, id, op_id],
                ).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn retry_ready_lan_operations(&self, applied: &mut Vec<SyncOperation>) -> Result<(), String> {
        let features = self.lan_features()?;
        let mut stmt = self.conn.prepare(
            "SELECT p.operation_id,length(CAST(p.operation_json AS BLOB))
             FROM lan_sync_pending p WHERE p.workspace_id=active_workspace_id()
               AND (?1 OR json_extract(operation_json,'$.entityType') NOT IN ('chat_group','chat_message','group_announcement'))
               AND (?2 OR json_extract(operation_json,'$.entityType')<>'wiki_document')
               AND CASE p.dependency_type
                 WHEN 'projects' THEN EXISTS(SELECT 1 FROM projects q WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id)
                 WHEN 'tasks' THEN EXISTS(SELECT 1 FROM tasks q WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id)
                 WHEN 'task_deletions' THEN EXISTS(
                    SELECT 1 FROM tasks q, json_each(p.operation_json,'$.payload.items') item
                    WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id
                      AND q.id=json_extract(item.value,'$.task.id')
                      AND (q.deletion_version,COALESCE(q.deletion_id,'')) >=
                          (COALESCE(json_extract(item.value,'$.deletionVersion'),0),COALESCE(json_extract(item.value,'$.deletionId'),''))
                 )
                 WHEN 'task_comments' THEN EXISTS(SELECT 1 FROM task_comments q WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id)
                 WHEN 'chat_groups' THEN EXISTS(SELECT 1 FROM chat_groups q WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id)
                 WHEN 'wiki_documents' THEN EXISTS(SELECT 1 FROM wiki_documents q WHERE q.workspace_id=p.workspace_id AND q.id=p.dependency_id)
               END
             ORDER BY p.rowid LIMIT ?3",
        ).map_err(|error| error.to_string())?;
        let ready = stmt
            .query_map(
                params![features & CHAT != 0, features & WIKI != 0, PAGE_OPERATIONS],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?)),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut bytes: usize = 0;
        for (id, size) in ready {
            if bytes != 0 && bytes.saturating_add(size) > PAGE_BYTES {
                break;
            }
            let raw: Option<String> = self.conn.query_row(
                "DELETE FROM lan_sync_pending
                 WHERE workspace_id=active_workspace_id() AND operation_id=? RETURNING operation_json",
                [id], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?;
            let Some(raw) = raw else {
                continue;
            };
            let operation = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
            self.apply_or_stage_lan_operation(operation, applied)?;
            bytes = bytes.saturating_add(size);
        }
        Ok(())
    }

    fn lan_dependency(&self, op: &SyncOperation) -> Result<Option<(&'static str, String)>, String> {
        let payload = &op.payload;
        let dependency = match (op.entity_type.as_str(), op.action.as_str()) {
            ("project", "update" | "delete" | "transfer") => {
                Some(("projects", op.entity_id.as_str()))
            }
            ("task", "update" | "delete") => Some(("tasks", op.entity_id.as_str())),
            ("task", "create") => payload["parentTaskId"].as_str().map(|id| ("tasks", id)),
            ("task_comment", "create") => payload["taskId"].as_str().map(|id| ("tasks", id)),
            ("task_comment", "update" | "delete") => Some(("task_comments", op.entity_id.as_str())),
            ("chat_message" | "group_announcement", "create" | "update") => payload
                .get("groupId")
                .or_else(|| payload.get("group_id"))
                .and_then(Value::as_str)
                .map(|id| ("chat_groups", id)),
            ("wiki_document", "create" | "update") => payload["parentId"]
                .as_str()
                .map(|id| ("wiki_documents", id)),
            _ => None,
        };
        let project = match op.entity_type.as_str() {
            "wiki_document" | "state" | "project_file" | "project_folder" | "chat_group"
            | "task" => payload["projectId"]
                .as_str()
                .or(op.scope_id.as_deref())
                .map(|id| ("projects", id)),
            _ => None,
        };
        let detached = payload["detached"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| entry["id"].as_str().map(|id| ("tasks", id)));
        let recycle_project = payload["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                entry["task"]["projectId"]
                    .as_str()
                    .map(|id| ("projects", id))
            });
        for (table, id) in dependency
            .into_iter()
            .chain(project)
            .chain(detached)
            .chain(recycle_project)
        {
            let present: bool = self.conn.query_row(&format!(
                "SELECT EXISTS(SELECT 1 FROM {table} WHERE workspace_id=active_workspace_id() AND id=?)"
            ), [id], |row| row.get(0)).map_err(|error| error.to_string())?;
            if !present {
                if table == "task_comments" {
                    if let Some(task) = payload["taskId"].as_str() {
                        if self.task_is_purged(task)? {
                            continue;
                        }
                    }
                }
                return Ok(Some((table, id.to_owned())));
            }
        }
        if is_recycle(op) && op.action == "restore" {
            for entry in payload["items"].as_array().into_iter().flatten() {
                let id = recycle_item_id("items", entry).ok_or("invalid LAN recycle item")?;
                let seen: Option<(i64, String)> = self
                    .conn
                    .query_row(
                        "SELECT deletion_version,COALESCE(deletion_id,'') FROM tasks
                     WHERE workspace_id=active_workspace_id() AND id=?",
                        [id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                if seen
                    .as_ref()
                    .is_none_or(|(version, id)| (*version, id.as_str()) < recycle_generation(entry))
                {
                    return Ok(Some(("task_deletions", id.to_owned())));
                }
            }
        }
        Ok(None)
    }
}

fn is_recycle(op: &SyncOperation) -> bool {
    op.entity_type == "task" && matches!(op.action.as_str(), "trash" | "restore" | "purge")
}

fn same_recycle_operation(stored: &SyncOperation, incoming: &SyncOperation) -> Result<(), String> {
    if stored.entity_type != incoming.entity_type
        || stored.entity_id != incoming.entity_id
        || stored.action != incoming.action
        || stored.node_id != incoming.node_id
        || stored.version != incoming.version
        || stored.timestamp != incoming.timestamp
        || stored.scope_id != incoming.scope_id
    {
        return Err("LAN recycle operation identity changed".into());
    }
    Ok(())
}

fn recycle_item_id<'a>(key: &str, entry: &'a Value) -> Option<&'a str> {
    match key {
        "items" => entry["task"]["id"].as_str(),
        _ => entry["id"].as_str(),
    }
}

fn recycle_generation(entry: &Value) -> (i64, &str) {
    (
        entry["deletionVersion"].as_i64().unwrap_or(0),
        entry["deletionId"].as_str().unwrap_or(""),
    )
}

// Keep the union for relays and leave just the newly visible entries in the delta.
fn extend_recycle_projection(stored: &mut Value, delta: &mut Value) -> Result<bool, String> {
    let mut changed = false;
    for key in ["items", "detached"] {
        let Some(new) = delta.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        if !stored[key].is_array() {
            stored[key] = Value::Array(Vec::new());
        }
        let known = stored[key].as_array_mut().unwrap();
        let mut ids = known
            .iter()
            .filter_map(|entry| recycle_item_id(key, entry).map(str::to_owned))
            .collect::<std::collections::HashSet<_>>();
        let entries = std::mem::take(new);
        for entry in entries {
            let id = recycle_item_id(key, &entry).ok_or("invalid LAN recycle item")?;
            if ids.insert(id.to_owned()) {
                known.push(entry.clone());
                new.push(entry);
                changed = true;
            }
        }
    }
    Ok(changed)
}

fn allows(features: u8, entity: &str) -> bool {
    match crate::feature_modules::entity_feature(entity) {
        Some("chat") => features & CHAT != 0,
        Some("wiki") => features & WIKI != 0,
        _ => true,
    }
}
