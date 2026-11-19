use crate::db::Database;
use crate::workspace_scope::WorkspaceContext;
use crate::AppState;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use uuid::Uuid;

const EXPORT_HISTORY: &str = "taskExportHistory";
const EXPORT_HISTORY_LIMIT: usize = 50;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum TaskFileFormat {
    Csv,
    Json,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchImportError {
    message: String,
    row: Option<usize>,
}

impl From<String> for BatchImportError {
    fn from(message: String) -> Self {
        Self { message, row: None }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchImportResult {
    created_count: usize,
    #[serde(skip)]
    replayed: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ExportScope {
    All,
    Personal,
    Project { id: String },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskExportHistoryEntry {
    id: Uuid,
    exported_by: String,
    exported_on: String,
    scope: ExportScope,
    project_name: Option<String>,
    task_count: usize,
    format: TaskFileFormat,
}

impl Database {
    pub(crate) fn initialize_task_import_receipts(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS task_import_receipts (
                    workspace_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    request_id TEXT NOT NULL,
                    fingerprint BLOB NOT NULL,
                    created_count INTEGER NOT NULL,
                    PRIMARY KEY(workspace_id,user_id,request_id)
                )",
            )
            .map_err(|error| error.to_string())
    }

    fn import_task_batch(
        &self,
        context: &WorkspaceContext,
        request_id: Uuid,
        project_id: Option<&str>,
        format: TaskFileFormat,
        rows: Vec<Value>,
    ) -> Result<BatchImportResult, BatchImportError> {
        if rows.is_empty() {
            return Err("TASK_IMPORT_EMPTY".to_owned().into());
        }
        let body =
            serde_json::to_vec(&(project_id, format, &rows)).map_err(|error| error.to_string())?;
        let fingerprint = Sha256::digest(body);
        let count = rows.len();
        let request_id = request_id.to_string();
        let mut failed_row = None;

        self.workspace_transaction("import_task_batch", || {
            let receipt = self
                .conn
                .query_row(
                    "SELECT fingerprint,created_count FROM task_import_receipts
                     WHERE workspace_id=? AND user_id=? AND request_id=?",
                    params![context.workspace_id, context.user_id, request_id],
                    |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, usize>(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some((stored, created_count)) = receipt {
                if stored.as_slice() != &fingerprint[..] {
                    return Err("TASK_IMPORT_REQUEST_CONFLICT".into());
                }
                return Ok(BatchImportResult {
                    created_count,
                    replayed: true,
                });
            }

            for (index, row) in rows.into_iter().enumerate() {
                let result = (|| {
                    let mut fields = match row {
                        Value::Object(fields) => fields,
                        _ => return Err("TASK_IMPORT_INVALID_ROW".into()),
                    };
                    fields.retain(|key, _| {
                        matches!(
                            key.as_str(),
                            "title"
                                | "description"
                                | "priority"
                                | "status"
                                | "stateGroup"
                                | "dueDate"
                                | "subtasks"
                        )
                    });
                    fields.insert("projectId".into(), json!(project_id));
                    fields.insert("isShared".into(), json!(project_id.is_some()));
                    fields.insert("sharedWith".into(), json!([]));
                    fields.entry("subtasks").or_insert_with(|| json!([]));
                    fields.insert("tags".into(), json!(["Imported", format]));
                    self.create_task(Value::Object(fields), &context.user_id)
                })();
                if let Err(error) = result {
                    failed_row = Some(index + 1);
                    return Err(error);
                }
            }

            self.conn
                .execute(
                    "INSERT INTO task_import_receipts VALUES(?,?,?,?,?)",
                    params![
                        context.workspace_id,
                        context.user_id,
                        request_id,
                        &fingerprint[..],
                        count
                    ],
                )
                .map_err(|error| error.to_string())?;
            Ok(BatchImportResult {
                created_count: count,
                replayed: false,
            })
        })
        .map_err(|message| BatchImportError {
            message,
            row: failed_row,
        })
    }

    fn task_export_history(&self) -> Result<Vec<TaskExportHistoryEntry>, String> {
        self.read_private_data(EXPORT_HISTORY)?
            .map(serde_json::from_value)
            .transpose()
            .map(|entries| entries.unwrap_or_default())
            .map_err(|error| error.to_string())
    }

    fn record_task_export(
        &self,
        context: &WorkspaceContext,
        entry: TaskExportHistoryEntry,
    ) -> Result<Vec<TaskExportHistoryEntry>, String> {
        let mut entries = self.task_export_history()?;
        entries.truncate(EXPORT_HISTORY_LIMIT - 1);
        entries.insert(0, entry);
        let payload = serde_json::to_string(&entries).map_err(|error| error.to_string())?;
        self.conn
            .execute(
                "INSERT INTO workspace_private_data(workspace_id,user_id,feature,payload_json) VALUES(?,?,?,?)
                 ON CONFLICT(workspace_id,user_id,feature) DO UPDATE SET payload_json=excluded.payload_json",
                params![context.workspace_id, context.user_id, EXPORT_HISTORY, payload],
            )
            .map_err(|error| error.to_string())?;
        Ok(entries)
    }
}

#[tauri::command]
pub(crate) fn import_task_batch(
    app: AppHandle,
    state: State<AppState>,
    workspace_context: WorkspaceContext,
    request_id: String,
    project_id: Option<String>,
    format: TaskFileFormat,
    rows: Vec<Value>,
) -> Result<BatchImportResult, BatchImportError> {
    let request_id =
        Uuid::parse_str(&request_id).map_err(|_| "TASK_IMPORT_REQUEST_CONFLICT".to_owned())?;
    let db = state
        .db
        .lock()
        .map_err(|_| "STORAGE_UNAVAILABLE".to_owned())?;
    db.validate_workspace_context(&workspace_context)?;
    let result = db.import_task_batch(
        &workspace_context,
        request_id,
        project_id.as_deref(),
        format,
        rows,
    )?;
    drop(db);
    if !result.replayed {
        crate::emit_tasks_changed(&app, "imported", None);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn list_task_export_history(
    state: State<AppState>,
    workspace_context: WorkspaceContext,
) -> Result<Vec<TaskExportHistoryEntry>, String> {
    crate::with_workspace_db(&state, &workspace_context, Database::task_export_history)
}

#[tauri::command]
pub(crate) fn save_task_export(
    state: State<AppState>,
    workspace_context: WorkspaceContext,
    path: String,
    content: String,
    scope: ExportScope,
    format: TaskFileFormat,
    task_count: usize,
) -> Result<Option<Vec<TaskExportHistoryEntry>>, String> {
    let (exported_by, project_name) = crate::with_workspace_db(&state, &workspace_context, |db| {
        let user = db
            .users()?
            .into_iter()
            .find(|user| user.id == workspace_context.user_id)
            .ok_or("STORAGE_UNAVAILABLE")?;
        let project_name = match &scope {
            ExportScope::Project { id } => Some(
                db.projects(Some(&user.id))?
                    .into_iter()
                    .find(|project| &project.id == id)
                    .ok_or("项目不存在或没有访问权限")?
                    .name,
            ),
            _ => None,
        };
        let exported_by = if user.nickname.is_empty() {
            user.username
        } else {
            user.nickname
        };
        Ok((exported_by, project_name))
    })?;
    crate::save_text_file(path, content)?;
    let entry = TaskExportHistoryEntry {
        id: Uuid::new_v4(),
        exported_by,
        exported_on: Utc::now().to_rfc3339(),
        scope,
        project_name,
        task_count,
        format,
    };
    Ok(crate::with_workspace_db(&state, &workspace_context, |db| {
        db.record_task_export(&workspace_context, entry)
    })
    .ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn row(title: &str) -> Value {
        json!({"title": title, "description": "batch task", "priority": "P3", "status": "todo"})
    }

    #[test]
    fn batch_import_rolls_back_tasks_and_sync_log_at_the_failing_row() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let context = db.workspace_context().unwrap();
        let request = Uuid::new_v4();
        let before = db.sync_operations(0).unwrap();
        let count = db.tasks(None).unwrap().len();
        let error = db
            .import_task_batch(
                &context,
                request,
                None,
                TaskFileFormat::Csv,
                vec![row("valid"), Value::Null],
            )
            .unwrap_err();
        assert_eq!(error.row, Some(2));
        assert_eq!(db.tasks(None).unwrap().len(), count);
        let after = db.sync_operations(0).unwrap();
        assert_eq!((after.0.len(), after.1), (before.0.len(), before.1));
        let result = db
            .import_task_batch(
                &context,
                request,
                None,
                TaskFileFormat::Csv,
                vec![row("valid")],
            )
            .unwrap();
        assert!(!result.replayed);
        assert_eq!(db.tasks(None).unwrap().len(), count + 1);
    }

    #[test]
    fn thousand_row_import_replays_the_receipt_after_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("import.sqlite");
        let db = Database::open(&path).unwrap();
        let context = db.workspace_context().unwrap();
        let request = Uuid::new_v4();
        let rows: Vec<_> = (0..1_000).map(|i| row(&format!("Task {i}"))).collect();
        let count = db.tasks(None).unwrap().len();
        let first = db
            .import_task_batch(&context, request, None, TaskFileFormat::Json, rows.clone())
            .unwrap();
        assert_eq!(first.created_count, 1_000);
        drop(db);
        let db = Database::open(&path).unwrap();
        let replay = db
            .import_task_batch(
                &db.workspace_context().unwrap(),
                request,
                None,
                TaskFileFormat::Json,
                rows,
            )
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.created_count, first.created_count);
        assert_eq!(db.tasks(None).unwrap().len(), count + first.created_count);
        let conflict = db
            .import_task_batch(
                &context,
                request,
                None,
                TaskFileFormat::Json,
                vec![row("different")],
            )
            .unwrap_err();
        assert_eq!(conflict.message, "TASK_IMPORT_REQUEST_CONFLICT");
    }

    #[test]
    fn export_history_keeps_metadata_for_the_latest_fifty_in_its_workspace() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let context = db.workspace_context().unwrap();
        for task_count in 0..55 {
            db.record_task_export(
                &context,
                TaskExportHistoryEntry {
                    id: Uuid::new_v4(),
                    exported_by: "Alice".into(),
                    exported_on: Utc::now().to_rfc3339(),
                    scope: ExportScope::Personal,
                    project_name: None,
                    task_count,
                    format: TaskFileFormat::Csv,
                },
            )
            .unwrap();
        }
        let history = db.task_export_history().unwrap();
        assert_eq!(history.len(), EXPORT_HISTORY_LIMIT);
        assert_eq!(history[0].task_count, 54);
        assert_eq!(history[49].task_count, 5);
        let other = db
            .create_workspace("Other", None, None, &context.user_id)
            .unwrap();
        db.switch_workspace(&other.id, &context.user_id).unwrap();
        assert!(db.task_export_history().unwrap().is_empty());
        db.switch_workspace(&context.workspace_id, &context.user_id)
            .unwrap();
        assert_eq!(db.task_export_history().unwrap()[0].id, history[0].id);
        let mut peer = db
            .users()
            .unwrap()
            .into_iter()
            .find(|user| user.id == context.user_id)
            .unwrap();
        peer.id = "export-reader".into();
        peer.username = peer.id.clone();
        db.upsert_user(&peer).unwrap();
        db.set_current_user(&peer.id).unwrap();
        assert!(db.task_export_history().unwrap().is_empty());
    }
}
