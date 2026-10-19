//! Database Local Data Cleanup Module
//!
//! CALLING SPEC:
//!     db.clear_local_data(&options, workspace_id, operator) -> Result<ClearDataResult, String>
//!
//! CONTRACT:
//!     - Input:
//!         - options: ClearDataOptions specifying:
//!             - tasks (bool): whether to clear tasks, comments, notifications
//!             - wiki (bool): whether to clear wiki documents and views
//!             - chat (bool): whether to clear chat messages and group announcements
//!             - ai (bool): whether to clear AI conversations, runs, and messages
//!             - scope (Option<String>): "current" (default, active workspace) or "all" (all local data)
//!         - workspace_id: ID of the target workspace for "current" scope
//!         - operator: ID of user triggering the cleanup
//!     - Output:
//!         - ClearDataResult containing deleted counts and operation summary
//!     - Side effects:
//!         - Deletes corresponding records from SQLite tables
//!         - Runs PRAGMA optimize
//!     - Preserves:
//!         - User profiles, project structures, memberships, workspace definitions, AI model configs

use crate::db::Database;
use crate::models::{ClearDataOptions, ClearDataResult};
use rusqlite::params;

/// Check whether a table exists in SQLite catalog before querying.
fn table_exists(conn: &rusqlite::Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
        params![table_name],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

/// Execute a delete statement safely if the table exists, returning the number of affected rows.
fn safe_delete(
    conn: &rusqlite::Connection,
    table: &str,
    condition: Option<&str>,
    param: Option<&str>,
) -> Result<u64, String> {
    if !table_exists(conn, table) {
        return Ok(0);
    }

    let query = match condition {
        Some(cond) => format!("DELETE FROM {table} WHERE {cond}"),
        None => format!("DELETE FROM {table}"),
    };

    let count = match param {
        Some(val) => conn.execute(&query, params![val]),
        None => conn.execute(&query, []),
    }
    .map_err(|e| format!("Failed to delete from {table}: {e}"))?;

    Ok(count as u64)
}

impl Database {
    /// Clears selected local data categories (tasks, wiki, chat, ai) within the specified scope.
    pub fn clear_local_data(
        &self,
        options: &ClearDataOptions,
        workspace_id: &str,
        _operator: &str,
    ) -> Result<ClearDataResult, String> {
        let is_all = options.scope.as_deref() == Some("all");
        let ws_param = if is_all { None } else { Some(workspace_id) };

        let mut result = ClearDataResult::default();

        // 1. Tasks cleanup (delete child tables first to respect foreign key constraints)
        if options.tasks {
            let cond = if is_all { None } else { Some("workspace_id=?") };
            let _ = safe_delete(&self.conn, "task_assignment_notifications", cond, ws_param)?;
            result.task_comments_deleted = safe_delete(&self.conn, "task_comments", cond, ws_param)?;
            result.tasks_deleted = safe_delete(&self.conn, "tasks", cond, ws_param)?;

            // Clean related sync operations
            if is_all {
                let _ = safe_delete(
                    &self.conn,
                    "sync_operations",
                    Some("entity_type IN ('task', 'task_comment', 'task_assignment_notification', 'task_attachment')"),
                    None,
                );
            } else {
                let _ = self.conn.execute(
                    "DELETE FROM sync_operations WHERE workspace_id=? AND entity_type IN ('task', 'task_comment', 'task_assignment_notification', 'task_attachment')",
                    params![workspace_id],
                );
            }
        }

        // 2. Wiki documents cleanup
        if options.wiki {
            let cond = if is_all { None } else { Some("workspace_id=?") };
            result.wiki_documents_deleted = safe_delete(&self.conn, "wiki_documents", cond, ws_param)?;

            if is_all {
                let _ = safe_delete(
                    &self.conn,
                    "workspace_private_data",
                    Some("feature IN ('wiki', 'wikiView')"),
                    None,
                );
                let _ = safe_delete(
                    &self.conn,
                    "sync_operations",
                    Some("entity_type = 'wiki_document'"),
                    None,
                );
            } else {
                let _ = self.conn.execute(
                    "DELETE FROM workspace_private_data WHERE workspace_id=? AND feature IN ('wiki', 'wikiView')",
                    params![workspace_id],
                );
                let _ = self.conn.execute(
                    "DELETE FROM sync_operations WHERE workspace_id=? AND entity_type = 'wiki_document'",
                    params![workspace_id],
                );
            }
        }

        // 3. Chat messages cleanup
        if options.chat {
            let cond = if is_all { None } else { Some("workspace_id=?") };
            result.chat_messages_deleted = safe_delete(&self.conn, "chat_messages", cond, ws_param)?;
            let _ = safe_delete(&self.conn, "group_announcements", cond, ws_param)?;

            if is_all {
                let _ = safe_delete(
                    &self.conn,
                    "sync_operations",
                    Some("entity_type IN ('chat_message', 'group_announcement')"),
                    None,
                );
            } else {
                let _ = self.conn.execute(
                    "DELETE FROM sync_operations WHERE workspace_id=? AND entity_type IN ('chat_message', 'group_announcement')",
                    params![workspace_id],
                );
            }
        }

        // 4. AI conversations cleanup
        if options.ai {
            let cond = if is_all { None } else { Some("workspace_id=?") };
            let _ = safe_delete(&self.conn, "ai_tool_operations", cond, ws_param)?;
            let _ = safe_delete(&self.conn, "ai_runs", cond, ws_param)?;
            let _ = safe_delete(&self.conn, "ai_client_messages", cond, ws_param)?;
            let _ = safe_delete(&self.conn, "ai_branches", cond, ws_param)?;
            result.ai_messages_deleted = safe_delete(&self.conn, "ai_messages", cond, ws_param)?;
            result.ai_conversations_deleted = safe_delete(&self.conn, "ai_conversations", cond, ws_param)?;

            if is_all {
                let _ = safe_delete(
                    &self.conn,
                    "workspace_private_data",
                    Some("feature = 'ai'"),
                    None,
                );
            } else {
                let _ = self.conn.execute(
                    "DELETE FROM workspace_private_data WHERE workspace_id=? AND feature = 'ai'",
                    params![workspace_id],
                );
            }
        }

        // Run optimize to maintain database performance
        let _ = self.conn.execute_batch("PRAGMA optimize;");

        result.success = true;
        result.message = format!(
            "清理完成: 任务 {} 条，评论 {} 条，Wiki 文档 {} 篇，聊天记录 {} 条，AI 会话 {} 条（消息 {} 条）",
            result.tasks_deleted,
            result.task_comments_deleted,
            result.wiki_documents_deleted,
            result.chat_messages_deleted,
            result.ai_conversations_deleted,
            result.ai_messages_deleted
        );

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_clear_local_data_tasks_and_scope() {
        let db = Database::open(Path::new(":memory:")).expect("db should open");
        let ws_id = db.workspace_context().expect("workspace should exist").workspace_id;

        // Insert dummy tasks and comments
        db.conn.execute(
            "INSERT INTO tasks (id, payload_json, workspace_id, creator_id, assignee_id, updated_at, version, deleted)
             VALUES ('t1', ?1, ?2, 'u1', 'u1', '2026-01-01', 1, 0)",
            params![format!(r#"{{"workspaceId":"{ws_id}"}}"#), ws_id],
        ).unwrap();

        db.conn.execute(
            "INSERT INTO task_comments (id, task_id, author_id, created_at, updated_at, payload_json, workspace_id, deleted)
             VALUES ('c1', 't1', 'u1', '2026-01-01', '2026-01-01', '{}', ?1, 0)",
            params![ws_id],
        ).unwrap();

        // Clear current workspace tasks only
        let opts = ClearDataOptions {
            tasks: true,
            wiki: false,
            chat: false,
            ai: false,
            scope: Some("current".into()),
        };
        let res = db.clear_local_data(&opts, &ws_id, "u1").unwrap();
        assert_eq!(res.tasks_deleted, 1);
        assert_eq!(res.task_comments_deleted, 1);

        let count: i64 = db.conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        // Test scope = all
        db.conn.execute(
            "INSERT INTO tasks (id, payload_json, workspace_id, creator_id, assignee_id, updated_at, version, deleted)
             VALUES ('t2', ?1, ?2, 'u1', 'u1', '2026-01-01', 1, 0)",
            params![format!(r#"{{"workspaceId":"{ws_id}"}}"#), ws_id],
        ).unwrap();

        let opts_all = ClearDataOptions {
            tasks: true,
            wiki: false,
            chat: false,
            ai: false,
            scope: Some("all".into()),
        };
        let res_all = db.clear_local_data(&opts_all, &ws_id, "u1").unwrap();
        assert_eq!(res_all.tasks_deleted, 1);

        let final_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(final_count, 0);
    }

    #[test]
    fn test_clear_local_data_wiki_chat_ai() {
        let db = Database::open(Path::new(":memory:")).expect("db should open");
        let ws_id = db.workspace_context().expect("workspace should exist").workspace_id;

        // Insert wiki documents
        db.conn.execute(
            "INSERT INTO wiki_documents (workspace_id, id, payload_json, deleted)
             VALUES (?1, 'wiki-1', '{\"title\":\"Test\"}', 0)",
            params![ws_id],
        ).unwrap();

        // Insert chat messages
        db.conn.execute(
            "INSERT INTO chat_messages (id, workspace_id, sender_id, receiver_id, payload_json, timestamp)
             VALUES ('m1', ?1, 'u1', 'u2', '{\"text\":\"hi\"}', '2026-01-01')",
            params![ws_id],
        ).unwrap();

        // Insert AI conversations and messages
        db.conn.execute(
            "INSERT INTO ai_conversations (workspace_id, user_id, id, payload_json)
             VALUES (?1, 'u1', 'ai-conv-1', '{}')",
            params![ws_id],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO ai_messages (workspace_id, user_id, conversation_id, id, payload_json)
             VALUES (?1, 'u1', 'ai-conv-1', 'ai-msg-1', '{}')",
            params![ws_id],
        ).unwrap();

        let opts = ClearDataOptions {
            tasks: false,
            wiki: true,
            chat: true,
            ai: true,
            scope: Some("current".into()),
        };

        let res = db.clear_local_data(&opts, &ws_id, "u1").unwrap();
        assert_eq!(res.wiki_documents_deleted, 1);
        assert_eq!(res.chat_messages_deleted, 1);
        assert_eq!(res.ai_conversations_deleted, 1);
        assert_eq!(res.ai_messages_deleted, 1);

        // Verify tables are empty
        let wiki_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM wiki_documents", [], |r| r.get(0)).unwrap();
        let chat_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM chat_messages", [], |r| r.get(0)).unwrap();
        let ai_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM ai_conversations", [], |r| r.get(0)).unwrap();
        let ai_msg_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM ai_messages", [], |r| r.get(0)).unwrap();
        assert_eq!(wiki_count, 0);
        assert_eq!(chat_count, 0);
        assert_eq!(ai_count, 0);
        assert_eq!(ai_msg_count, 0);
    }
}
