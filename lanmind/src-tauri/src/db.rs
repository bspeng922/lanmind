//! Local SQLite source of truth.
//!
//! Mutations that must reach peers append an idempotent sync operation. Purely
//! local preferences and actions, such as clearing local chat history, do not
//! create operations and therefore never delete data from another node.

use crate::models::{
    self, ChatGroup, ChatMessage, LlmConfig, McpConfig, Project, ProjectFileRecord, ProjectFolderRecord,
    ReportMetrics, RiskWarning, State, StateGroup, SyncOperation, Task, TaskAssignmentNotification,
    TaskDataArchive, TaskActivity, TaskComment, TaskImportResult, TaskUpdateResult, User, WebConfig,
    Workspace, WorkspaceJoinRequest, WorkspaceMember,
};
use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, Timelike, Utc};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ReportTaskRecord {
    pub task: Task,
    pub status_as_of: String,
    pub due_date_as_of: Option<String>,
    pub created_in_period: bool,
    pub completed_in_period: bool,
    pub progressed_in_period: bool,
    pub blocked_as_of: bool,
    pub overdue_as_of: bool,
    pub upcoming_in_period: bool,
    pub schedule_slipped: bool,
    pub event_notes: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ReportDataset {
    pub records: Vec<ReportTaskRecord>,
    pub metrics: ReportMetrics,
    pub data_notes: Vec<String>,
}

fn report_local_date(value: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date_time| date_time.with_timezone(&Local).date_naive())
        .or_else(|| {
            value
                .get(..10)
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        })
}

fn completed_subtasks(value: &Value) -> usize {
    value
        .get("subtasks")
        .and_then(Value::as_array)
        .map(|subtasks| {
            subtasks
                .iter()
                .filter(|subtask| {
                    subtask
                        .get("completed")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

fn generate_mcp_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_web_port() -> u16 {
    let mut bytes = [0u8; 2];
    OsRng.fill_bytes(&mut bytes);
    45_000 + (u16::from_le_bytes(bytes) % 10_000)
}

fn parse_task_datetime(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")
        .or_else(|_| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map(|date| date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        })
        .ok()
}

fn is_valid_task_datetime(value: &str) -> bool {
    parse_task_datetime(value).is_some() || DateTime::parse_from_rfc3339(value).is_ok()
}

fn validate_archived_task(task: &Task) -> Result<(), String> {
    if task.id.trim().is_empty() {
        return Err("任务 ID 不能为空".into());
    }
    if task.title.trim().is_empty() {
        return Err(format!("任务 {} 的标题不能为空", task.id));
    }
    if task.creator_id.trim().is_empty() || task.assignee_id.trim().is_empty() {
        return Err(format!("任务 {} 的创建者或负责人不能为空", task.id));
    }
    if !matches!(task.priority.as_str(), "P1" | "P2" | "P3" | "P4") {
        return Err(format!("任务 {} 的优先级无效", task.id));
    }
    if !matches!(
        task.status.as_str(),
        "todo" | "in_progress" | "completed" | "blocked" | "abandoned"
    ) {
        return Err(format!("任务 {} 的状态无效", task.id));
    }
    if task.progress > 100 {
        return Err(format!("任务 {} 的完成进度必须在 0 到 100 之间", task.id));
    }
    if !matches!(task.content_mode.as_str(), "markdown" | "checklist") {
        return Err(format!("任务 {} 的内容模式无效", task.id));
    }
    if task.parent_task_id.as_deref() == Some(task.id.as_str()) {
        return Err(format!("任务 {} 不能关联自身为主任务", task.id));
    }
    let recurrence = task.recurrence.as_deref().unwrap_or("none");
    if !matches!(
        recurrence,
        "none" | "daily" | "weekly" | "monthly" | "yearly"
    ) {
        return Err(format!("任务 {} 的循环类型无效", task.id));
    }
    if recurrence != "none" && task.due_date.is_none() {
        return Err(format!("循环任务 {} 缺少到期日期", task.id));
    }
    if task
        .start_date
        .as_deref()
        .is_some_and(|value| !is_valid_task_datetime(value))
        || task
            .due_date
        .as_deref()
        .is_some_and(|value| !is_valid_task_datetime(value))
        || task
            .reminder_time
            .as_deref()
            .is_some_and(|value| !is_valid_task_datetime(value))
    {
        return Err(format!("任务 {} 的日期格式无效", task.id));
    }
    if DateTime::parse_from_rfc3339(&task.created_at).is_err()
        || DateTime::parse_from_rfc3339(&task.updated_at).is_err()
    {
        return Err(format!("任务 {} 的时间戳格式无效", task.id));
    }
    if let Some(rule) = task.recurrence_rule.as_ref() {
        if rule.interval == 0
            || rule.days_of_week.iter().any(|day| !(1..=7).contains(day))
            || rule
                .day_of_month
                .is_some_and(|day| !(1..=31).contains(&day))
            || rule
                .month_of_year
                .is_some_and(|month| !(1..=12).contains(&month))
        {
            return Err(format!("任务 {} 的循环规则无效", task.id));
        }
        if rule.time_of_day.as_deref().is_some_and(|value| {
            NaiveDateTime::parse_from_str(&format!("2000-01-01T{value}"), "%Y-%m-%dT%H:%M").is_err()
        }) {
            return Err(format!("任务 {} 的循环执行时间无效", task.id));
        }
    }
    Ok(())
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    next.and_then(|date| date.pred_opt())
        .map(|date| date.day())
        .unwrap_or(28)
}

fn occurrence_at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> Option<NaiveDateTime> {
    NaiveDate::from_ymd_opt(year, month, day.min(last_day_of_month(year, month)))?
        .and_hms_opt(hour, minute, 0)
}

fn next_recurrence_due(task: &Task) -> Option<String> {
    let recurrence = task.recurrence.as_deref()?;
    if recurrence == "none" {
        return None;
    }
    let raw_due = task.due_date.as_deref()?;
    let current = parse_task_datetime(raw_due)?;
    let after = Local::now().naive_local().max(current);
    let rule = task.recurrence_rule.as_ref();
    let interval = i64::from(rule.map(|rule| rule.interval.max(1)).unwrap_or(1));
    let configured_time = rule
        .and_then(|rule| rule.time_of_day.as_deref())
        .and_then(|value| {
            NaiveDateTime::parse_from_str(&format!("2000-01-01T{value}"), "%Y-%m-%dT%H:%M").ok()
        });
    let include_time = raw_due.contains('T') || configured_time.is_some();
    let (hour, minute) = configured_time
        .map(|value| (value.hour(), value.minute()))
        .unwrap_or((current.hour(), current.minute()));

    let candidate = match recurrence {
        "daily" => {
            let mut candidate = current.date().and_hms_opt(hour, minute, 0)?;
            while candidate <= after {
                candidate += Duration::days(interval);
            }
            candidate
        }
        "weekly" => {
            let mut days = rule
                .map(|rule| rule.days_of_week.clone())
                .unwrap_or_default();
            if days.is_empty() {
                days.push(current.weekday().number_from_monday() as u8);
            }
            days.sort_unstable();
            days.dedup();
            let monday = current.date()
                - Duration::days(i64::from(current.weekday().num_days_from_monday()));
            let mut found = None;
            'cycles: for cycle in 0..10_000i64 {
                let cycle_monday = monday + Duration::days(cycle * interval * 7);
                for weekday in &days {
                    if !(1..=7).contains(weekday) {
                        continue;
                    }
                    let date = cycle_monday + Duration::days(i64::from(*weekday - 1));
                    let candidate = date.and_hms_opt(hour, minute, 0)?;
                    if candidate > current && candidate > after {
                        found = Some(candidate);
                        break 'cycles;
                    }
                }
            }
            found?
        }
        "monthly" => {
            let day = u32::from(
                rule.and_then(|rule| rule.day_of_month)
                    .unwrap_or(current.day() as u8),
            );
            let mut found = None;
            for step in 1..10_000u32 {
                let total_months =
                    current.year() * 12 + current.month0() as i32 + (step as i32 * interval as i32);
                let year = total_months.div_euclid(12);
                let month = total_months.rem_euclid(12) as u32 + 1;
                let candidate = occurrence_at(year, month, day, hour, minute)?;
                if candidate > after {
                    found = Some(candidate);
                    break;
                }
            }
            found?
        }
        "yearly" => {
            let month = u32::from(
                rule.and_then(|rule| rule.month_of_year)
                    .unwrap_or(current.month() as u8),
            );
            let day = u32::from(
                rule.and_then(|rule| rule.day_of_month)
                    .unwrap_or(current.day() as u8),
            );
            let mut found = None;
            for step in 1..10_000i32 {
                let candidate = occurrence_at(
                    current.year() + step * interval as i32,
                    month,
                    day,
                    hour,
                    minute,
                )?;
                if candidate > after {
                    found = Some(candidate);
                    break;
                }
            }
            found?
        }
        _ => return None,
    };
    Some(if include_time {
        candidate.format("%Y-%m-%dT%H:%M").to_string()
    } else {
        candidate.format("%Y-%m-%d").to_string()
    })
}

fn next_reminder_time(task: &Task, next_due: &str) -> Option<String> {
    let current_due = parse_task_datetime(task.due_date.as_deref()?)?;
    let current_reminder = parse_task_datetime(task.reminder_time.as_deref()?)?;
    let lead = current_due.signed_duration_since(current_reminder);
    if lead < Duration::zero() {
        return None;
    }
    let reminder = parse_task_datetime(next_due)? - lead;
    Some(reminder.format("%Y-%m-%dT%H:%M").to_string())
}

/// FNV-1a over the seeded identity, rendered as 8 lowercase hex digits.
///
/// Work item states are seeded independently on every device, so their IDs must
/// be a pure function of the seed scope rather than a random UUID. Two nodes
/// that seed the same user or project then agree on the ID and converge under
/// `INSERT OR IGNORE` instead of duplicating a state list per device.
fn fnv1a32(value: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// Lowercase alphanumeric slug used inside deterministic state IDs.
///
/// Purely cosmetic: the ID's uniqueness comes from the seed position and the
/// FNV hash of the scope, because a non-Latin name would otherwise slug to the
/// same placeholder as every other non-Latin name.
fn state_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in name.chars().take(48) {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "state".into()
    } else {
        slug
    }
}

/// Deterministic ID for a seeded state: `<scope>-<fnv(scope)>-<sequence>-<slug>`.
///
/// The sequence is the state's position in `seeded_state_specs`, so two devices
/// seeding the same scope derive byte-identical IDs and `INSERT OR IGNORE`
/// converges instead of creating a second list. It also keeps `Backlog` and
/// `Todo`, which share the `unstarted` group, from colliding.
fn state_id_for(scope_key: &str, group: StateGroup, sequence: i64, name: &str) -> String {
    format!(
        "{scope_key}-{}-{}-{sequence}-{}",
        fnv1a32(scope_key),
        group.as_str(),
        state_slug(name)
    )
}

/// Literal `status` strings written by older builds, translated to the group
/// they now belong to. Never rewrite the stored payloads themselves: they are
/// the audit log shipped to peers and `apply_operation`'s idempotency check
/// keys off them.
fn legacy_status_to_group(status: &str) -> StateGroup {
    match status {
        "in_progress" | "blocked" => StateGroup::Started,
        "completed" => StateGroup::Completed,
        "abandoned" => StateGroup::Cancelled,
        _ => StateGroup::Unstarted,
    }
}

/// Legacy `status` to the *name* of the seeded state it refers to. Names, not
/// groups, separate `Blocked` from `In Progress` because both share `started`.
fn legacy_status_to_state_name(status: &str) -> &'static str {
    match status {
        "in_progress" => "In Progress",
        "blocked" => "Blocked",
        "completed" => "Done",
        "abandoned" => "Cancelled",
        _ => "Todo",
    }
}

/// Short uppercase prefix used in work item identifiers. Derived from the
/// project name when it has usable Latin initials, otherwise from the project
/// id, so a Chinese-named project still yields a stable, readable prefix.
fn project_identifier(name: &str, project_id: &str) -> String {
    let initials: String = name
        .split(|character: char| character.is_whitespace() || character == '-' || character == '_')
        .filter_map(|word| word.chars().next())
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let candidate = if initials.len() >= 2 {
        initials.chars().take(6).collect::<String>()
    } else {
        project_id
            .rsplit('-')
            .find(|segment| segment.chars().any(|character| character.is_ascii_alphanumeric()))
            .unwrap_or("PROJ")
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(6)
            .collect::<String>()
            .to_ascii_uppercase()
    };
    if candidate.is_empty() {
        "PROJ".into()
    } else {
        candidate
    }
}

/// URL-safe workspace handle derived from the immutable workspace id, so a
/// rename never changes the slug peers may have cached.
fn workspace_slug(workspace_id: &str) -> String {
    let slug: String = workspace_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "workspace".into()
    } else {
        slug
    }
}

/// Which scope predicate a state query binds.
enum ScopeKey<'a> {
    Project(&'a str),
    Owner(&'a str),
    None,
}

/// The six states seeded for every project and every personal list.
fn seeded_state_specs() -> [(&'static str, StateGroup, &'static str, bool); 6] {
    [
        ("Backlog", StateGroup::Backlog, "#d9d9d9", true),
        ("Todo", StateGroup::Unstarted, "#3f76ff", true),
        ("In Progress", StateGroup::Started, "#f59e0b", true),
        ("Blocked", StateGroup::Started, "#e11d48", false),
        ("Done", StateGroup::Completed, "#16a34a", true),
        ("Cancelled", StateGroup::Cancelled, "#dc2626", true),
    ]
}

pub struct Database {
    pub(crate) conn: Connection,
    pub(crate) active_workspace: std::sync::Arc<std::sync::RwLock<String>>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY NOT NULL,
                username TEXT NOT NULL,
                device_id TEXT NOT NULL,
                nickname TEXT NOT NULL,
                role TEXT NOT NULL,
                ip TEXT NOT NULL,
                is_online INTEGER NOT NULL DEFAULT 1,
                last_active TEXT NOT NULL,
                avatar TEXT
            );
            CREATE TABLE IF NOT EXISTS local_org_units (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                parent_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS local_org_members (
                org_unit_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                PRIMARY KEY (org_unit_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_local_org_members_unit ON local_org_members(org_unit_id);
            CREATE INDEX IF NOT EXISTS idx_local_org_members_user ON local_org_members(user_id);
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                color TEXT NOT NULL,
                created_by TEXT NOT NULL,
                admins_json TEXT NOT NULL,
                members_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                start_date TEXT,
                target_date TEXT,
                is_archived INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL,
                project_id TEXT,
                creator_id TEXT NOT NULL,
                assignee_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                version INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS task_assignment_notifications (
                id TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_assignment_notifications_recipient
                ON task_assignment_notifications(recipient_id, read_at, created_at);
            CREATE TABLE IF NOT EXISTS task_comments (
                id TEXT PRIMARY KEY NOT NULL,
                task_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                author_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);
            CREATE TABLE IF NOT EXISTS sync_operations (
                id TEXT PRIMARY KEY NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                action TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                node_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                scope_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_operations_version ON sync_operations(version);
            CREATE INDEX IF NOT EXISTS idx_sync_operations_entity ON sync_operations(entity_type,entity_id,version);
            CREATE INDEX IF NOT EXISTS idx_sync_operations_history ON sync_operations(timestamp DESC,version DESC,id DESC);
            CREATE TABLE IF NOT EXISTS project_join_requests (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewed_by TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_join_requests_project ON project_join_requests(project_id, status);
            CREATE TABLE IF NOT EXISTS chat_groups (
                id TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL,
                project_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS group_announcements (
                id TEXT PRIMARY KEY NOT NULL,
                group_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_group_announcements ON group_announcements(group_id, pinned DESC, created_at DESC);
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                receiver_id TEXT,
                group_id TEXT,
                project_id TEXT,
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
            CREATE TABLE IF NOT EXISTS llm_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ppt_templates (
                id TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_files (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                source_node_id TEXT NOT NULL,
                source_address TEXT NOT NULL,
                source_http_port INTEGER NOT NULL,
                uploaded_by TEXT NOT NULL,
                uploaded_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id, deleted);
            CREATE TABLE IF NOT EXISTS project_folders (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT NOT NULL,
                path TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_project_folders_project ON project_folders(project_id, deleted);
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                logo TEXT,
                description TEXT,
                timezone TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspace_members (
                workspace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewed_by TEXT,
                PRIMARY KEY (workspace_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, status);
            CREATE TABLE IF NOT EXISTS workspace_join_requests (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                workspace_name TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewed_by TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_join_requests ON workspace_join_requests(workspace_id, status);
            -- "group" is a reserved word in SQLite and must stay quoted in every
            -- statement that touches it, including this DDL.
            CREATE TABLE IF NOT EXISTS states (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                "group" TEXT NOT NULL,
                project_id TEXT,
                owner_id TEXT,
                sequence INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_states_project ON states(project_id, sequence);
            CREATE INDEX IF NOT EXISTS idx_states_owner ON states(owner_id, sequence);
            "#,
        )
        .map_err(|e| e.to_string())?;

        let db = Self { conn, active_workspace: crate::workspace_scope::new_active_workspace() };
        db.remove_legacy_demo_data()?;
        db.seed_if_empty()?;
        db.seed_templates()?;
        db.initialize_workspace_scope()?;
        db.migrate_workspace_payload_metadata()?;
        db.ensure_schema_v1()?;
        db.migrate_workspace_state_ids()?;
        db.install_workspace_relations()?;
        db.install_ai_schema().map_err(|e| e.to_string())?;
        Ok(db)
    }

    /// Adds a column only when it is genuinely absent.
    ///
    /// SQLite has no `ADD COLUMN IF NOT EXISTS`, and a user moving between
    /// builds must not have this layer skipped, so it is intentionally not
    /// guarded by a migration flag.
    pub(crate) fn ensure_column(&self, table: &str, column: &str, definition: &str) -> Result<(), String> {
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?) WHERE name=?)",
                params![table, column],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if exists {
            return Ok(());
        }
        self.conn
            .execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))
            .map_err(|error| error.to_string())
    }

    /// Layer 1 of the work item state migration: idempotent DDL only.
    fn ensure_schema_v1(&self) -> Result<(), String> {
        for (column, definition) in [
            ("project_id", "TEXT"),
            ("owner_id", "TEXT"),
            ("sequence", "INTEGER NOT NULL DEFAULT 0"),
            ("is_default", "INTEGER NOT NULL DEFAULT 0"),
            ("deleted", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            self.ensure_column("states", column, definition)?;
        }
        self.conn
            .execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS idx_states_project ON states(project_id, sequence);
                CREATE INDEX IF NOT EXISTS idx_states_owner ON states(owner_id, sequence);
                "#,
            )
            .map_err(|error| error.to_string())?;
        for (column, definition) in [
            ("state_id", "TEXT"),
            ("state_group", "TEXT"),
            ("state_name", "TEXT"),
        ] {
            self.ensure_column("tasks", column, definition)?;
        }
        self.conn
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state_id);
                 CREATE INDEX IF NOT EXISTS idx_tasks_state_group ON tasks(state_group);",
            )
            .map_err(|error| error.to_string())?;
        for (column, definition) in [
            ("workspace_id", "TEXT"),
            ("identifier", "TEXT"),
            ("lead_id", "TEXT"),
            ("timezone", "TEXT"),
            ("next_work_item_sequence", "INTEGER NOT NULL DEFAULT 1"),
            ("visibility", "TEXT"),
            ("cover_image", "TEXT"),
            ("start_date", "TEXT"),
            ("target_date", "TEXT"),
            ("is_archived", "INTEGER NOT NULL DEFAULT 0"),
            ("archived_at", "TEXT"),
        ] {
            self.ensure_column("projects", column, definition)?;
        }
        self.ensure_workspace_record()?;
        self.migrate_work_item_states_v1()
    }

    /// Creates the workspace row from the existing settings, never from a fresh
    /// value.
    ///
    /// `workspaceId` is the P2P channel partition key: `network.rs` derives
    /// `workspace_key` from `workspace_token` and compares `workspace_id` to
    /// decide `same_workspace`. Regenerating it would break every existing peer
    /// link and leave encrypted history undecryptable, so the row is keyed on
    /// whatever the settings already hold.
    fn ensure_workspace_record(&self) -> Result<(), String> {
        let workspace_id = self
            .setting("workspaceId")?
            .ok_or_else(|| "工作区 ID 未初始化".to_string())?;
        let workspace_name = self
            .setting("workspaceName")?
            .unwrap_or_else(|| "我的工作区".into());
        let owner_id = self.current_user_id()?;
        let now = Utc::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT OR IGNORE INTO workspaces(id,name,slug,logo,description,timezone,owner_id,created_at,updated_at)
                 VALUES(?,?,?,NULL,NULL,?,?,?,?)",
                params![
                    workspace_id,
                    workspace_name,
                    workspace_slug(&workspace_id),
                    "Asia/Shanghai",
                    owner_id,
                    now,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        let owner_id: String=self.conn.query_row("SELECT owner_id FROM workspaces WHERE id=?",params![workspace_id],|r| r.get(0)).map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by)
                 VALUES(?,?,'owner','member',?,?,NULL)",
                params![workspace_id, owner_id, now, now],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Layer 2 of the work item state migration: one-time data backfill.
    ///
    /// Guarded by `schemaMigrationsV1` so it runs once, but deliberately does
    /// NOT rewrite historical `sync_operations` payloads. Re-logging would push
    /// hundreds of phantom operations to peers and inflate the local clock.
    fn migrate_work_item_states_v1(&self) -> Result<(), String> {
        if self.setting("schemaMigrationsV1")?.as_deref() == Some("1") {
            return Ok(());
        }
        self.conn
            .execute_batch("SAVEPOINT work_item_states_v1")
            .map_err(|error| error.to_string())?;
        let result = self.backfill_all_workspace_states();
        match result {
            Ok(()) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT work_item_states_v1")
                    .map_err(|error| error.to_string())?;
                self.save_local_setting("schemaMigrationsV1", "1")
            }
            Err(error) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT work_item_states_v1; RELEASE SAVEPOINT work_item_states_v1",
                );
                Err(error)
            }
        }
    }

    /// Maintenance-only traversal; ordinary callers never change implicit scope.
    fn backfill_all_workspace_states(&self) -> Result<(), String> {
        let original = self.workspace_context()?.workspace_id;
        let scopes: Vec<String> = self.conn.prepare("SELECT id FROM workspaces UNION SELECT workspace_id FROM projects UNION SELECT workspace_id FROM tasks")
            .map_err(|e| e.to_string())?.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        let result = (|| {
            for scope in scopes.into_iter().filter(|s| s != "__legacy_unassigned__") {
                *self.active_workspace.write().map_err(|e| e.to_string())? = scope.clone();
                self.conn.execute("UPDATE settings SET value=? WHERE key='workspaceId'", params![scope]).map_err(|e| e.to_string())?;
                self.conn.execute("UPDATE tasks SET state_id=NULL WHERE workspace_id=active_workspace_id() AND state_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM states s WHERE s.id=tasks.state_id AND s.workspace_id=tasks.workspace_id AND s.project_id IS tasks.project_id AND (s.project_id IS NOT NULL OR s.owner_id=tasks.creator_id))", []).map_err(|e| e.to_string())?;
                self.backfill_work_item_states()?;
            }
            Ok(())
        })();
        *self.active_workspace.write().map_err(|e| e.to_string())? = original.clone();
        self.conn.execute("UPDATE settings SET value=? WHERE key='workspaceId'", params![original]).map_err(|e| e.to_string())?;
        result
    }

    fn backfill_work_item_states(&self) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        let projects = self.projects(None)?;
        for project in &projects {
            self.seed_states_for_scope(Some(&project.id), None, &now)?;
        }
        let users = self.users()?;
        for user in &users {
            self.seed_states_for_scope(None, Some(&user.id), &now)?;
        }

        // Only rows without a state yet are rewritten, so a re-run after users
        // have moved tasks between states cannot overwrite their choices.
        let mut stmt = self
            .conn
            .prepare("SELECT id,payload_json,project_id,creator_id,assignee_id FROM tasks WHERE workspace_id=active_workspace_id() AND state_id IS NULL")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut pending = Vec::new();
        for row in rows {
            pending.push(row.map_err(|error| error.to_string())?);
        }
        drop(stmt);

        for (id, payload_json, project_id, creator_id, _assignee_id) in pending {
            let mut payload: Value =
                serde_json::from_str(&payload_json).map_err(|error| error.to_string())?;
            let legacy_status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("todo")
                .to_string();
            let group = legacy_status_to_group(&legacy_status);
            let wanted_name = legacy_status_to_state_name(&legacy_status);
            // Project tasks resolve against the project list; personal tasks
            // against the creator's list.
            let (scope_project, scope_owner) = match project_id.as_deref() {
                Some(project_id) => (Some(project_id.to_string()), None),
                None => (None, Some(creator_id.clone())),
            };
            let candidates =
                self.states_for_scope(scope_project.as_deref(), scope_owner.as_deref())?;
            let state = candidates
                .iter()
                .find(|state| state.name == wanted_name)
                .or_else(|| {
                    candidates
                        .iter()
                        .find(|state| state.group == group.as_str() && state.is_default)
                })
                .or_else(|| candidates.iter().find(|state| state.group == group.as_str()));
            let Some(state) = state else {
                continue;
            };
            payload["stateId"] = json!(state.id);
            payload["stateGroup"] = json!(state.group);
            payload["stateName"] = json!(state.name);
            payload["status"] = json!(group.legacy_status());
            self.conn
                .execute(
                    "UPDATE tasks SET payload_json=?,state_id=?,state_group=?,state_name=? WHERE workspace_id=active_workspace_id() AND id=? AND state_id IS NULL",
                    params![payload.to_string(), state.id, state.group, state.name, id],
                )
                .map_err(|error| error.to_string())?;
        }

        // Stamped without logging: a historical task must keep its original
        // identifier, and the sequence counter must not jump per legacy row.
        self.conn
            .execute(
                "UPDATE projects SET workspace_id=(SELECT value FROM settings WHERE key='workspaceId') WHERE workspace_id IS NULL",
                [],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn seed_states_for_scope(
        &self,
        project_id: Option<&str>,
        owner_id: Option<&str>,
        now: &str,
    ) -> Result<(), String> {
        let scope_key = match (project_id, owner_id) {
            (Some(project_id), _) => format!("state-{}-{project_id}", self.workspace_context()?.workspace_id),
            (None, Some(owner_id)) => format!("state-personal-{}-{}", self.workspace_context()?.workspace_id, fnv1a32(owner_id)),
            (None, None) => return Ok(()),
        };
        for (sequence, (name, group, color, is_default)) in
            seeded_state_specs().into_iter().enumerate()
        {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO states(id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at,deleted)
                     VALUES(?,?,?,?,?,?,?,?,?,?,0)",
                    params![
                        state_id_for(&scope_key, group, sequence as i64, name),
                        name,
                        color,
                        group.as_str(),
                        project_id,
                        owner_id,
                        sequence as i64,
                        is_default as i64,
                        now,
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn migrate_workspace_state_ids(&self)->Result<(),String> {
        if self.setting("workspaceStateIdsV2")?.is_some() { return Ok(()); }
        let active=self.active_workspace.read().map_err(|e| e.to_string())?.clone();
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result=(|| {
            let rows:Vec<(String,String,Option<String>,Option<String>)>=self.conn.prepare("SELECT id,workspace_id,project_id,owner_id FROM states").map_err(|e| e.to_string())?.query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|e| e.to_string())?.collect::<Result<_,_>>().map_err(|e| e.to_string())?;
            for (old,ws,project,owner) in rows {
                let scope=match (project,owner) { (Some(p),_)=>format!("state-{p}"), (None,Some(u))=>format!("state-personal-{}",fnv1a32(&u)),_=>continue };
                for (sequence,(name,group,_,_)) in seeded_state_specs().into_iter().enumerate() {
                    if state_id_for(&scope,group,sequence as i64,name)!=old { continue; }
                    let new_scope=if let Some(rest)=scope.strip_prefix("state-personal-") {format!("state-personal-{ws}-{rest}")} else {format!("state-{ws}-{}",scope.trim_start_matches("state-"))};
                    let new=state_id_for(&new_scope,group,sequence as i64,name);
                    *self.active_workspace.write().map_err(|e| e.to_string())?=ws.clone();
                    self.conn.execute("UPDATE states SET id=? WHERE id=? AND workspace_id=?",params![new,old,ws]).map_err(|e| e.to_string())?;
                    self.conn.execute("UPDATE tasks SET state_id=?,payload_json=json_set(payload_json,'$.stateId',?) WHERE state_id=? AND workspace_id=?",params![new,new,old,ws]).map_err(|e| e.to_string())?;
                }
            }
            *self.active_workspace.write().map_err(|e| e.to_string())? = active.clone();
            // Existing v1 databases may contain tasks in a second workspace
            // referring to the former global personal state list.
            self.backfill_all_workspace_states()?;
            self.save_local_setting("workspaceStateIdsV2","1")
        })();
        *self.active_workspace.write().map_err(|e| e.to_string())?=active;
        if result.is_ok() {self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;} else {let _=self.conn.execute_batch("ROLLBACK");}
        result
    }

    /// Reads a scope's state list, seeding it on first access.
    ///
    /// Seeding here rather than only during migration matters for a database
    /// created by an older build, for a project that arrived from a peer, and
    /// for a user profile that was added after the migration ran.
    pub fn states_for_scope(
        &self,
        project_id: Option<&str>,
        owner_id: Option<&str>,
    ) -> Result<Vec<State>, String> {
        if project_id.is_some() || owner_id.is_some() {
            let seeded = self.read_states_for_scope(project_id, owner_id)?;
            if !seeded.is_empty() {
                return Ok(seeded);
            }
            self.seed_states_for_scope(project_id, owner_id, &Utc::now().to_rfc3339())?;
            return self.read_states_for_scope(project_id, owner_id);
        }
        self.read_states_for_scope(project_id, owner_id)
    }

    fn read_states_for_scope(
        &self,
        project_id: Option<&str>,
        owner_id: Option<&str>,
    ) -> Result<Vec<State>, String> {
        let (sql, expected) = match (project_id, owner_id) {
            (Some(_), _) => (
                "SELECT id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at FROM states WHERE workspace_id=active_workspace_id() AND deleted=0 AND project_id=? ORDER BY sequence ASC, id ASC",
                ScopeKey::Project(project_id.unwrap()),
            ),
            (None, Some(_)) => (
                "SELECT id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at FROM states WHERE workspace_id=active_workspace_id() AND deleted=0 AND project_id IS NULL AND owner_id=? ORDER BY sequence ASC, id ASC",
                ScopeKey::Owner(owner_id.unwrap()),
            ),
            (None, None) => (
                "SELECT id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at FROM states WHERE workspace_id=active_workspace_id() AND deleted=0 AND project_id IS NULL ORDER BY sequence ASC, id ASC",
                ScopeKey::None,
            ),
        };
        let mut stmt = self.conn.prepare(sql).map_err(|error| error.to_string())?;
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<State> {
            Ok(State { workspace_id: Some(self.active_workspace.read().unwrap().clone()),
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                group: row.get(3)?,
                project_id: row.get(4)?,
                owner_id: row.get(5)?,
                sequence: row.get(6)?,
                is_default: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        };
        let rows = match expected {
            ScopeKey::Project(value) => stmt.query_map(params![value], map_row),
            ScopeKey::Owner(value) => stmt.query_map(params![value], map_row),
            ScopeKey::None => stmt.query_map([], map_row),
        }
        .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    /// All states visible to `user_id`: the personal list plus the list of
    /// every project the user can read.
    pub fn states(&self, user_id: &str) -> Result<Vec<State>, String> {
        let mut states = self.states_for_scope(None, Some(user_id))?;
        for project in self.projects(Some(user_id))? {
            states.extend(self.states_for_scope(Some(&project.id), None)?);
        }
        Ok(states)
    }

    pub fn state_by_id(&self, id: &str) -> Result<Option<State>, String> {
        self.conn
            .query_row(
                "SELECT id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at FROM states WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0",
                params![id],
                |row| {
                    Ok(State { workspace_id: Some(self.active_workspace.read().unwrap().clone()),
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        group: row.get(3)?,
                        project_id: row.get(4)?,
                        owner_id: row.get(5)?,
                        sequence: row.get(6)?,
                        is_default: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    /// Resolves the state a task should carry, given the operator, the target
    /// project and the merged field set. Shared by create and update so the
    /// renderer, MCP and the LAN web server all land on the same row.
    fn resolve_state_for_task(&self, task: &Task) -> Result<Option<State>, String> {
        let (project_scope, owner_scope) = match task.project_id.as_deref() {
            Some(project_id) => (Some(project_id.to_string()), None),
            None => (None, Some(task.creator_id.clone())),
        };
        let states = self.states_for_scope(project_scope.as_deref(), owner_scope.as_deref())?;
        if states.is_empty() {
            return Ok(None);
        }
        let group = task
            .state_group
            .as_deref()
            .and_then(StateGroup::parse)
            .unwrap_or_else(|| legacy_status_to_group(&task.status));
        if let Some(state_id) = task.state_id.as_deref() {
            if let Some(state) = states.iter().find(|state| state.id == state_id) {
                return Ok(Some(state.clone()));
            }
        }
        let wanted_name = task
            .state_name
            .clone()
            .unwrap_or_else(|| legacy_status_to_state_name(&task.status).to_string());
        if let Some(state) = states.iter().find(|state| state.name == wanted_name) {
            return Ok(Some(state.clone()));
        }
        Ok(states
            .iter()
            .find(|state| state.group == group.as_str() && state.is_default)
            .or_else(|| states.iter().find(|state| state.group == group.as_str()))
            .or_else(|| states.iter().find(|state| state.is_default))
            .or_else(|| states.first())
            .cloned())
    }

    fn state_in_group(
        &self,
        map: &serde_json::Map<String, Value>,
        operator: &str,
        group: StateGroup,
    ) -> Result<Option<State>, String> {
        let scope = Self::state_scope_for_map(map, operator);
        let project_id = map.get("projectId").and_then(Value::as_str);
        let states = self.states_for_scope(
            project_id,
            if project_id.is_some() { None } else { scope.as_deref() },
        )?;
        Ok(states
            .iter()
            .find(|state| state.group == group.as_str() && state.is_default)
            .or_else(|| states.iter().find(|state| state.group == group.as_str()))
            .cloned())
    }

    /// Owner scope for a not-yet-persisted task, which is the operator for
    /// personal tasks.
    fn state_scope_for_map(
        map: &serde_json::Map<String, Value>,
        operator: &str,
    ) -> Option<String> {
        if map.get("projectId").and_then(Value::as_str).is_some() {
            None
        } else {
            Some(operator.to_string())
        }
    }

    fn resolve_state_for_new_task(
        &self,
        map: &serde_json::Map<String, Value>,
        operator: &str,
    ) -> Result<Option<State>, String> {
        let project_id = map
            .get("projectId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let owner = if project_id.is_some() {
            None
        } else {
            Some(
                map.get("creatorId")
                    .and_then(Value::as_str)
                    .unwrap_or(operator)
                    .to_string(),
            )
        };
        let states = self.states_for_scope(project_id.as_deref(), owner.as_deref())?;
        if let Some(state_id) = map.get("stateId").and_then(Value::as_str) {
            let state = states
                .iter()
                .find(|state| state.id == state_id)
                .ok_or_else(|| "状态不存在或不属于当前列表".to_string())?;
            return Ok(Some(state.clone()));
        }
        if let Some(group) = map.get("stateGroup").and_then(Value::as_str) {
            let group = StateGroup::parse(group)
                .ok_or_else(|| "状态分组无效，可选值为 backlog, unstarted, started, completed, cancelled".to_string())?;
            return Ok(states
                .iter()
                .find(|state| state.group == group.as_str() && state.is_default)
                .or_else(|| states.iter().find(|state| state.group == group.as_str()))
                .cloned());
        }
        let wanted = map
            .get("status")
            .and_then(Value::as_str)
            .map(legacy_status_to_state_name)
            .unwrap_or("Todo");
        Ok(states
            .iter()
            .find(|state| state.name == wanted)
            .or_else(|| states.iter().find(|state| state.is_default))
            .or_else(|| states.first())
            .cloned())
    }

    /// Writes the denormalized state columns into a serialized task map.
    fn stamp_state(&self, map: &mut serde_json::Map<String, Value>, state: Option<&State>) {
        match state {
            Some(state) => {
                map.insert("stateId".into(), json!(state.id));
                map.insert("stateGroup".into(), json!(state.group));
                map.insert("stateName".into(), json!(state.name));
            }
            None => {
                map.insert("stateId".into(), Value::Null);
                map.insert("stateGroup".into(), Value::Null);
                map.insert("stateName".into(), Value::Null);
            }
        }
    }

    /// Resolves and stamps the state columns for a task payload arriving from a
    /// peer, tolerating payloads that predate work item states.
    ///
    /// A remote `stateId` is looked up locally before being trusted, because
    /// the ID space is device-independent but the local project may not carry
    /// that custom state yet.
    fn fill_task_state_from_payload(&self, payload: &mut Value) -> Result<(), String> {
        let task: Task = match serde_json::from_value(payload.clone()) {
            Ok(task) => task,
            Err(_) => return Ok(()),
        };
        let (project_scope, owner_scope) = match task.project_id.as_deref() {
            Some(project_id) => (Some(project_id), None),
            None => (None, Some(task.creator_id.as_str())),
        };
        let states = match self.states_for_scope(project_scope, owner_scope) {
            Ok(states) if !states.is_empty() => states,
            _ => {
                let now = Utc::now().to_rfc3339();
                self.seed_states_for_scope(project_scope, owner_scope, &now)?;
                self.states_for_scope(project_scope, owner_scope)?
            }
        };
        let group = task
            .state_group
            .as_deref()
            .and_then(StateGroup::parse)
            .unwrap_or_else(|| legacy_status_to_group(&task.status));
        let wanted = task
            .state_name
            .clone()
            .unwrap_or_else(|| legacy_status_to_state_name(&task.status).to_string());
        let state = task
            .state_id
            .as_deref()
            .and_then(|state_id| states.iter().find(|state| state.id == state_id))
            .or_else(|| states.iter().find(|state| state.name == wanted))
            .or_else(|| states.iter().find(|state| state.group == group.as_str() && state.is_default))
            .or_else(|| states.iter().find(|state| state.group == group.as_str()))
            .cloned();
        if let (Some(state), Some(map)) = (state, payload.as_object_mut()) {
            map.insert("stateId".into(), json!(state.id));
            map.insert("stateGroup".into(), json!(state.group));
            map.insert("stateName".into(), json!(state.name));
            map.insert("status".into(), json!(group.legacy_status()));
        }
        Ok(())
    }

    /// Finds the default state of a group inside an existing task's scope,
    /// honouring a custom default before falling back to any state in the group.
    fn resolve_state_in_group(
        &self,
        task: &Task,
        group: StateGroup,
    ) -> Result<Option<State>, String> {
        let owner = if task.project_id.is_some() {
            None
        } else {
            Some(task.creator_id.clone())
        };
        let states = self.states_for_scope(task.project_id.as_deref(), owner.as_deref())?;
        Ok(states
            .iter()
            .find(|state| state.group == group.as_str() && state.is_default)
            .or_else(|| states.iter().find(|state| state.group == group.as_str()))
            .cloned())
    }

    /// Group a task currently sits in, preferring the denormalized column and
    /// falling back to the legacy `status` mirror for pre-migration rows.
    fn task_group(task: &Task) -> StateGroup {
        task.state_group
            .as_deref()
            .and_then(StateGroup::parse)
            .unwrap_or_else(|| legacy_status_to_group(&task.status))
    }

    /// Whether a task is in the `Blocked` state specifically.
    ///
    /// This check has to stay NAME-based: `Blocked` and `In Progress` share the
    /// `started` group, so a group comparison would turn every P1 in-progress
    /// task into a risk warning.
    fn task_is_blocked(&self, task: &Task) -> bool {
        self.state_name_for_task(task) == "Blocked"
    }

    fn state_name_for_task(&self, task: &Task) -> String {
        match task.state_name.as_deref() {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => legacy_status_to_state_name(&task.status).to_string(),
        }
    }

    pub fn workspace_record(&self) -> Result<Workspace, String> {
        self.ensure_workspace_record()?;
        self.workspace_row()?
            .ok_or_else(|| "工作区未初始化".to_string())
    }

    pub fn update_workspace_record(
        &self,
        updates: Value,
        operator: &str,
    ) -> Result<Workspace, String> {
        let mut workspace = self.workspace_record()?;
        if workspace.owner_id != operator {
            let is_admin = self
                .workspace_members(&workspace.id)?
                .iter()
                .any(|member| member.user_id == operator && member.role == "admin");
            if !is_admin {
                return Err("只有工作区所有者或管理员可以修改工作区".into());
            }
        }
        if let Some(updates) = updates.as_object() {
            for field in ["id", "createdAt", "ownerId", "slug"] {
                if updates.contains_key(field) {
                    return Err(format!("不允许修改字段 {field}"));
                }
            }
        }
        let mut merged = serde_json::to_value(&workspace).map_err(|error| error.to_string())?;
        merge_json(&mut merged, updates);
        merged["updatedAt"] = json!(Utc::now().to_rfc3339());
        workspace = serde_json::from_value(merged).map_err(|error| error.to_string())?;
        self.conn
            .execute(
                "UPDATE workspaces SET name=?,logo=?,description=?,timezone=?,updated_at=? WHERE id=?",
                params![
                    workspace.name,
                    workspace.logo,
                    workspace.description,
                    workspace.timezone,
                    workspace.updated_at,
                    workspace.id
                ],
            )
            .map_err(|error| error.to_string())?;
        // The settings keys stay the runtime source of truth for P2P, so a
        // rename has to be mirrored back into them.
        self.save_local_setting("workspaceName", &workspace.name)?;
        self.log_operation(
            "workspace",
            &workspace.id,
            "update",
            serde_json::to_value(&workspace).map_err(|error| error.to_string())?,
            operator,
            None,
        )?;
        Ok(workspace)
    }

    pub fn workspace_members(&self, workspace_id: &str) -> Result<Vec<WorkspaceMember>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by FROM workspace_members WHERE workspace_id=? ORDER BY requested_at ASC, user_id ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                Ok(WorkspaceMember {
                    workspace_id: row.get(0)?,
                    user_id: row.get(1)?,
                    role: row.get(2)?,
                    status: row.get(3)?,
                    requested_at: row.get(4)?,
                    reviewed_at: row.get(5)?,
                    reviewed_by: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    /// Workspace discovery is unauthenticated on the LAN, so joining the
    /// workspace itself needs no approval. Joining a specific project still
    /// requires that project's admin approval, which is a separate flow.
    pub fn request_workspace_membership(
        &self,
        user_id: &str,
        role: Option<&str>,
    ) -> Result<WorkspaceMember, String> {
        let workspace = self.workspace_record()?;
        let now = Utc::now().to_rfc3339();
        let role = match role.unwrap_or("member") {
            value @ ("owner" | "admin" | "member" | "guest") => value.to_string(),
            _ => "member".to_string(),
        };
        let existing = self
            .workspace_members(&workspace.id)?
            .into_iter()
            .find(|member| member.user_id == user_id);
        let member = match existing {
            Some(member) => member,
            None => {
                let member = WorkspaceMember {
                    workspace_id: workspace.id.clone(),
                    user_id: user_id.to_string(),
                    // The workspace secret is the cryptographic boundary, not
                    // `role`; a self-requested role never grants ownership.
                    role: if role == "owner" { "member".into() } else { role },
                    status: "member".into(),
                    requested_at: now.clone(),
                    reviewed_at: Some(now),
                    reviewed_by: None,
                };
                self.insert_workspace_member(&member, true)?;
                member
            }
        };
        Ok(member)
    }

    pub fn review_workspace_membership(
        &self,
        user_id: &str,
        approve: bool,
        role: Option<&str>,
        operator: &str,
    ) -> Result<WorkspaceMember, String> {
        let workspace = self.workspace_record()?;
        let is_admin = workspace.owner_id == operator
            || self
                .workspace_members(&workspace.id)?
                .iter()
                .any(|member| member.user_id == operator && member.role == "admin");
        if !is_admin {
            return Err("只有工作区所有者或管理员可以审批成员".into());
        }
        if !approve {
            self.conn
                .execute(
                    "DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
                    params![workspace.id, user_id],
                )
                .map_err(|error| error.to_string())?;
            self.log_operation(
                "workspace_member",
                &format!("{}-{}", workspace.id, user_id),
                "delete",
                json!({"workspaceId": workspace.id, "userId": user_id}),
                operator,
                None,
            )?;
            // The member row is gone, so the returned record reports the only
            // non-member state the contract allows: a request still awaiting
            // approval.
            let now = Utc::now().to_rfc3339();
            return Ok(WorkspaceMember {
                workspace_id: workspace.id,
                user_id: user_id.to_string(),
                role: "member".into(),
                status: "pending".into(),
                requested_at: now.clone(),
                reviewed_at: Some(now),
                reviewed_by: Some(operator.to_string()),
            });
        }
        let now = Utc::now().to_rfc3339();
        let member = WorkspaceMember {
            workspace_id: workspace.id.clone(),
            user_id: user_id.to_string(),
            role: match role.unwrap_or("member") {
                value @ ("admin" | "member" | "guest") => value.to_string(),
                _ => "member".to_string(),
            },
            status: "member".into(),
            requested_at: now.clone(),
            reviewed_at: Some(now),
            reviewed_by: Some(operator.to_string()),
        };
        self.upsert_workspace_member(&member, true)?;
        Ok(member)
    }

    fn insert_workspace_member(
        &self,
        member: &WorkspaceMember,
        log: bool,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,?)",
                params![
                    member.workspace_id,
                    member.user_id,
                    member.role,
                    member.status,
                    member.requested_at,
                    member.reviewed_at,
                    member.reviewed_by
                ],
            )
            .map_err(|error| error.to_string())?;
        if log {
            self.log_operation(
                "workspace_member",
                &format!("{}-{}", member.workspace_id, member.user_id),
                "create",
                serde_json::to_value(member).map_err(|error| error.to_string())?,
                &member.user_id,
                None,
            )?;
        }
        Ok(())
    }

    fn upsert_workspace_member(&self, member: &WorkspaceMember, log: bool) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,?)
                 ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by",
                params![
                    member.workspace_id,
                    member.user_id,
                    member.role,
                    member.status,
                    member.requested_at,
                    member.reviewed_at,
                    member.reviewed_by
                ],
            )
            .map_err(|error| error.to_string())?;
        if log {
            self.log_operation(
                "workspace_member",
                &format!("{}-{}", member.workspace_id, member.user_id),
                "update",
                serde_json::to_value(member).map_err(|error| error.to_string())?,
                &member.user_id,
                None,
            )?;
        }
        Ok(())
    }

    /// Explicit-invite scenarios. Workspace discovery itself is unauthenticated,
    /// so this is only used when a device is invited by name rather than found
    /// by scanning.
    #[allow(dead_code)]
    pub fn workspace_join_requests(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<WorkspaceJoinRequest>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id,workspace_id,workspace_name,user_id,user_name,status,requested_at,reviewed_at,reviewed_by FROM workspace_join_requests WHERE workspace_id=? ORDER BY requested_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                Ok(WorkspaceJoinRequest {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    workspace_name: row.get(2)?,
                    user_id: row.get(3)?,
                    user_name: row.get(4)?,
                    status: row.get(5)?,
                    requested_at: row.get(6)?,
                    reviewed_at: row.get(7)?,
                    reviewed_by: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    /// Recorded locally and routed over the `lan-chat` channel. A joining device
    /// does not yet hold the workspace secret, so it cannot seal on the
    /// `workspace` channel.
    #[allow(dead_code)]
    pub fn create_workspace_join_request(
        &self,
        user_name: &str,
        user_id: &str,
    ) -> Result<WorkspaceJoinRequest, String> {
        let workspace = self.workspace_record()?;
        let request = WorkspaceJoinRequest {
            id: format!("wsjoin-{}", Uuid::new_v4().simple()),
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            user_id: user_id.to_string(),
            user_name: user_name.to_string(),
            status: "pending".into(),
            requested_at: Utc::now().to_rfc3339(),
            reviewed_at: None,
            reviewed_by: None,
        };
        self.conn
            .execute(
                "INSERT OR REPLACE INTO workspace_join_requests(id,workspace_id,workspace_name,user_id,user_name,status,requested_at,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?)",
                params![
                    request.id,
                    request.workspace_id,
                    request.workspace_name,
                    request.user_id,
                    request.user_name,
                    request.status,
                    request.requested_at,
                    request.reviewed_at,
                    request.reviewed_by
                ],
            )
            .map_err(|error| error.to_string())?;
        // Routed over the lan-chat channel: a joining device does not yet hold
        // the workspace secret and cannot seal on the workspace channel.
        self.log_operation(
            "workspace_join_request",
            &request.id,
            "create",
            serde_json::to_value(&request).map_err(|error| error.to_string())?,
            user_id,
            None,
        )?;
        Ok(request)
    }

    pub fn create_state(&self, value: Value, operator: &str) -> Result<State, String> {
        let project_id = value
            .get("projectId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.ensure_state_scope_writable(project_id.as_deref(), operator)?;
        let now = Utc::now().to_rfc3339();
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "状态名称不能为空".to_string())?
            .to_string();
        let group = value
            .get("group")
            .and_then(Value::as_str)
            .and_then(StateGroup::parse)
            .ok_or_else(|| "状态分组无效，可选值为 backlog, unstarted, started, completed, cancelled".to_string())?;
        let sequence = value
            .get("sequence")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| {
                self.states_for_scope(project_id.as_deref(), Some(operator))
                    .map(|states| states.len() as i64)
                    .unwrap_or(0)
            });
        let state = State { workspace_id: Some(self.workspace_context()?.workspace_id),
            id: format!("state-{}", Uuid::new_v4().simple()),
            name,
            color: value
                .get("color")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| group.default_color().to_string()),
            group: group.as_str().to_string(),
            project_id: project_id.clone(),
            owner_id: if project_id.is_some() {
                None
            } else {
                Some(operator.to_string())
            },
            sequence,
            is_default: value
                .get("isDefault")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            created_at: now.clone(),
            updated_at: now,
        };
        self.insert_state(&state, true)?;
        Ok(state)
    }

    pub fn update_state(
        &self,
        id: &str,
        updates: Value,
        operator: &str,
    ) -> Result<State, String> {
        let mut state = self
            .state_by_id(id)?
            .ok_or_else(|| "状态不存在".to_string())?;
        self.ensure_state_scope_writable(state.project_id.as_deref(), operator)?;
        let mut merged = serde_json::to_value(&state).map_err(|error| error.to_string())?;
        let mut updates = updates;
        if let Some(updates) = updates.as_object_mut() {
            updates.remove("id");
            updates.remove("createdAt");
            updates.remove("ownerId");
        }
        merge_json(&mut merged, updates);
        merged["updatedAt"] = json!(Utc::now().to_rfc3339());
        state = serde_json::from_value(merged).map_err(|error| error.to_string())?;
        if StateGroup::parse(&state.group).is_none() {
            return Err("状态分组无效，可选值为 backlog, unstarted, started, completed, cancelled".into());
        }
        if state.name.trim().is_empty() {
            return Err("状态名称不能为空".into());
        }
        self.insert_state(&state, false)?;
        // Tasks denormalize the name so that every read path stays a plain
        // rename rather than a join; a rename has to propagate here.
        self.conn
            .execute(
                "UPDATE tasks SET state_name=?,payload_json=json_set(payload_json,'$.stateName',?) WHERE workspace_id=active_workspace_id() AND state_id=? AND deleted=0",
                params![state.name, state.name, state.id],
            )
            .map_err(|error| error.to_string())?;
        if state.is_default {
            self.demote_other_defaults(&state)?;
        }
        self.log_operation(
            "state",
            &state.id,
            "update",
            serde_json::to_value(&state).map_err(|error| error.to_string())?,
            operator,
            state.project_id.as_deref(),
        )?;
        Ok(state)
    }

    /// Refuses deletion while tasks still reference the state, reporting the
    /// count so the caller can explain what to move first.
    pub fn delete_state(&self, id: &str, operator: &str) -> Result<bool, String> {
        let state = self
            .state_by_id(id)?
            .ok_or_else(|| "状态不存在".to_string())?;
        self.ensure_state_scope_writable(state.project_id.as_deref(), operator)?;
        let referencing: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE workspace_id=active_workspace_id() AND state_id=? AND deleted=0",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if referencing > 0 {
            return Err(format!(
                "仍有 {referencing} 个任务使用状态「{}」，请先移动这些任务再删除",
                state.name
            ));
        }
        let remaining = self
            .states_for_scope(state.project_id.as_deref(), state.owner_id.as_deref())?
            .into_iter()
            .filter(|candidate| candidate.id != id)
            .count();
        if remaining == 0 {
            return Err("每个列表至少需要保留一个状态".into());
        }
        self.conn
            .execute(
                "UPDATE states SET deleted=1,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?",
                params![Utc::now().to_rfc3339(), id],
            )
            .map_err(|error| error.to_string())?;
        self.log_operation(
            "state",
            id,
            "delete",
            json!({"id": id}),
            operator,
            state.project_id.as_deref(),
        )?;
        Ok(true)
    }

    /// Reorders a state list.
    ///
    /// `project_id` names the list being reordered: `Some` for a project board,
    /// `None` for the caller's personal list. It is passed explicitly rather
    /// than inferred from the first id so that a mixed or stale id list fails
    /// loudly instead of silently reordering the wrong scope.
    pub fn reorder_states(
        &self,
        project_id: Option<&str>,
        ids: Vec<String>,
        operator: &str,
    ) -> Result<Vec<State>, String> {
        if ids.is_empty() {
            return Err("状态排序列表不能为空".into());
        }
        self.ensure_state_scope_writable(project_id, operator)?;
        let owner_scope = if project_id.is_some() {
            None
        } else {
            Some(operator.to_string())
        };
        let scope = self.states_for_scope(project_id, owner_scope.as_deref())?;
        let mut seen = HashSet::new();
        for (sequence, id) in ids.iter().enumerate() {
            if !seen.insert(id.clone()) {
                return Err("状态排序列表存在重复项".into());
            }
            let state = scope
                .iter()
                .find(|candidate| &candidate.id == id)
                .ok_or_else(|| "状态排序只能包含同一列表内的状态".to_string())?;
            self.conn
                .execute(
                    "UPDATE states SET sequence=?,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?",
                    params![sequence as i64, Utc::now().to_rfc3339(), state.id],
                )
                .map_err(|error| error.to_string())?;
        }
        let updated = self.states_for_scope(project_id, owner_scope.as_deref())?;
        let scope_id = match project_id {
            Some(project_id) => project_id.to_string(),
            None => format!("personal-{operator}"),
        };
        self.log_operation(
            "state",
            &format!("reorder-{scope_id}"),
            "reorder",
            json!({"ids": ids}),
            operator,
            project_id,
        )?;
        Ok(updated)
    }

    /// Resolves a `workspace_join_requests` row to the user it belongs to.
    /// Returns `None` when the value is not a known request id, in which case
    /// the caller treats it as a bare user id.
    pub fn workspace_join_request_user(
        &self,
        request_id: &str,
    ) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT user_id FROM workspace_join_requests WHERE workspace_id=active_workspace_id() AND id=?",
                params![request_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn set_default_state(&self, id: &str, operator: &str) -> Result<State, String> {
        let target = self
            .state_by_id(id)?
            .ok_or_else(|| "状态不存在".to_string())?;
        self.ensure_state_scope_writable(target.project_id.as_deref(), operator)?;
        let group = StateGroup::parse(&target.group)
            .ok_or_else(|| "状态分组无效".to_string())?;
        let now = Utc::now().to_rfc3339();
        // One default per group: the renderer picks the default of a group to
        // decide where a freshly created work item lands.
        for state in self.states_for_scope(target.project_id.as_deref(), target.owner_id.as_deref())? {
            if state.group != group.as_str() {
                continue;
            }
            let is_default = state.id == id;
            if state.is_default == is_default {
                continue;
            }
            self.conn
                .execute(
                    "UPDATE states SET is_default=?,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?",
                    params![is_default as i64, now, state.id],
                )
                .map_err(|error| error.to_string())?;
        }
        let state = self
            .state_by_id(id)?
            .ok_or_else(|| "状态不存在".to_string())?;
        self.log_operation(
            "state",
            id,
            "update",
            serde_json::to_value(&state).map_err(|error| error.to_string())?,
            operator,
            state.project_id.as_deref(),
        )?;
        Ok(state)
    }

    fn demote_other_defaults(&self, state: &State) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE states SET is_default=0 WHERE workspace_id=active_workspace_id() AND id<>? AND \"group\"=? AND deleted=0 AND ((project_id IS NULL AND ? IS NULL) OR project_id=?) AND ((owner_id IS NULL AND ? IS NULL) OR owner_id=?)",
                params![
                    state.id,
                    state.group,
                    state.project_id,
                    state.project_id,
                    state.owner_id,
                    state.owner_id
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn insert_state(&self, state: &State, log: bool) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO states(id,name,color,\"group\",project_id,owner_id,sequence,is_default,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)",
                params![
                    state.id,
                    state.name,
                    state.color,
                    state.group,
                    state.project_id,
                    state.owner_id,
                    state.sequence,
                    state.is_default as i64,
                    state.created_at,
                    state.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        if log {
            self.log_operation(
                "state",
                &state.id,
                "create",
                serde_json::to_value(state).map_err(|error| error.to_string())?,
                state.owner_id.as_deref().unwrap_or("system"),
                state.project_id.as_deref(),
            )?;
        }
        Ok(())
    }

    fn ensure_state_scope_writable(
        &self,
        project_id: Option<&str>,
        operator: &str,
    ) -> Result<(), String> {
        match project_id {
            None => Ok(()),
            Some(project_id) => {
                let project = self
                    .projects(None)?
                    .into_iter()
                    .find(|project| project.id == project_id)
                    .ok_or_else(|| "项目不存在".to_string())?;
                if project.created_by == operator
                    || project.admins.iter().any(|admin| admin == operator)
                {
                    Ok(())
                } else {
                    Err("只有项目管理员可以维护该项目的状态列表".into())
                }
            }
        }
    }

    fn remove_legacy_demo_data(&self) -> Result<(), String> {
        if self.setting("legacyDemoDataRemoved")?.as_deref() == Some("1") {
            return Ok(());
        }

        self.conn
            .execute_batch(
                r#"
                DELETE FROM task_comments WHERE task_id IN ('task-101','task-102','task-103','task-104','task-201');
                DELETE FROM states WHERE project_id IN ('proj-001','proj-002');
                DELETE FROM project_files WHERE project_id IN ('proj-001','proj-002');
                DELETE FROM project_folders WHERE project_id IN ('proj-001','proj-002');
                DELETE FROM group_announcements WHERE group_id IN (SELECT id FROM chat_groups WHERE project_id IN ('proj-001','proj-002'));
                DELETE FROM chat_messages WHERE group_id IN (SELECT id FROM chat_groups WHERE project_id IN ('proj-001','proj-002'));
                DELETE FROM chat_groups WHERE project_id IN ('proj-001','proj-002');
                DELETE FROM project_join_requests WHERE project_id IN ('proj-001','proj-002');
                DELETE FROM tasks WHERE id IN ('task-101','task-102','task-103','task-104','task-201');
                DELETE FROM projects WHERE id IN ('proj-001','proj-002');
                DELETE FROM project_join_requests
                  WHERE project_id IN ('proj-001','proj-002')
                     OR user_id IN ('admin@dev-pc-01','zhangsan@dev-pc-02','lisi@dev-pc-03','wangwu@dev-pc-04');
                DELETE FROM chat_messages
                  WHERE sender_id IN ('admin@dev-pc-01','zhangsan@dev-pc-02','lisi@dev-pc-03','wangwu@dev-pc-04')
                     OR receiver_id IN ('admin@dev-pc-01','zhangsan@dev-pc-02','lisi@dev-pc-03','wangwu@dev-pc-04');
                DELETE FROM sync_operations
                  WHERE entity_id IN ('task-101','task-102','task-103','task-104','task-201','proj-001','proj-002')
                     OR node_id IN ('admin@dev-pc-01','zhangsan@dev-pc-02','lisi@dev-pc-03','wangwu@dev-pc-04');
                DELETE FROM users
                  WHERE id IN ('admin@dev-pc-01','zhangsan@dev-pc-02','lisi@dev-pc-03','wangwu@dev-pc-04');
                "#,
            )
            .map_err(|e| e.to_string())?;

        if self.setting("workspaceId")?.as_deref() == Some("workspace-local-demo") {
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES('workspaceId',?)",
                    params![format!("workspace-{}", Uuid::new_v4().simple())],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES('workspaceName','我的工作区')",
                    [],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES('workspaceToken',?)",
                    params![format!(
                        "{}{}",
                        Uuid::new_v4().simple(),
                        Uuid::new_v4().simple()
                    )],
                )
                .map_err(|e| e.to_string())?;
        }

        if let Some(current_user_id) = self.setting("currentUserId")? {
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE id=?)",
                    params![current_user_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                self.conn
                    .execute("DELETE FROM settings WHERE key='currentUserId'", [])
                    .map_err(|e| e.to_string())?;
            }
        }

        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('legacyDemoDataRemoved','1')",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn seed_if_empty(&self) -> Result<(), String> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let current_user_id = if count == 0 {
            let now = Utc::now().to_rfc3339();
            let username = std::env::var("USERNAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "user".into());
            let device_id = hostname::get()
                .ok()
                .and_then(|value| value.into_string().ok())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "desktop".into());
            let safe_username = username.replace(['@', ' '], "_");
            let safe_device_id = device_id.replace(['@', ' '], "_");
            let user = User {
                id: format!("{safe_username}@{safe_device_id}").to_lowercase(),
                username: username.clone(),
                device_id,
                nickname: username,
                role: "admin".into(),
                ip: local_ip_address::local_ip()
                    .map(|ip| ip.to_string())
                    .unwrap_or_else(|_| "127.0.0.1".into()),
                is_online: true,
                last_active: now,
                avatar: None,
            };
            self.upsert_user(&user)?;
            user.id
        } else {
            let configured = self.setting("currentUserId")?;
            match configured {
                Some(id)
                    if self
                        .conn
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM users WHERE id=?)",
                            params![id],
                            |row| row.get::<_, bool>(0),
                        )
                        .map_err(|e| e.to_string())? =>
                {
                    id
                }
                _ => self
                    .conn
                    .query_row("SELECT id FROM users ORDER BY id LIMIT 1", [], |row| {
                        row.get(0)
                    })
                    .map_err(|e| e.to_string())?,
            }
        };

        let workspace_id = self
            .setting("workspaceId")?
            .unwrap_or_else(|| format!("workspace-{}", Uuid::new_v4().simple()));
        let workspace_token = self
            .setting("workspaceToken")?
            .unwrap_or_else(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));
        self.conn
            .execute(
                "INSERT OR IGNORE INTO settings(key,value) VALUES('workspaceId',?),('workspaceName','我的工作区'),('workspaceToken',?),('localClock','1')",
                params![workspace_id, workspace_token],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('currentUserId',?)",
                params![current_user_id],
            )
            .map_err(|e| e.to_string())?;

        let config = LlmConfig { generation_parameters:None,
            protocol: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model_name: "gpt-4o-mini".into(),
        };
        self.conn
            .execute(
                "INSERT OR IGNORE INTO llm_config(id,payload_json) VALUES(1,?)",
                params![serde_json::to_string(&config).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn seed_templates(&self) -> Result<(), String> {
        let templates = vec![
            json!({"id":"tpl-executive","name":"经营汇报","description":"结论先行、数据支撑、风险与动作闭环的管理汇报风格","theme":"business","primaryColor":"#111827","secondaryColor":"#64748b","backgroundColor":"#ffffff","textColor":"#111827","cardBgColor":"#f8fafc","accentColor":"#ea580c","fontFamily":"Microsoft YaHei","slidesLayout":[{"slideType":"cover"},{"slideType":"summary"},{"slideType":"content"},{"slideType":"roadmap"}]}),
            json!({"id":"tpl-business","name":"商务蓝","description":"适合周报和管理汇报","theme":"business","primaryColor":"#2563eb","secondaryColor":"#0f172a","backgroundColor":"#f8fafc","textColor":"#0f172a","cardBgColor":"#ffffff","accentColor":"#38bdf8","fontFamily":"Aptos","slidesLayout":[{"slideType":"cover"},{"slideType":"content"},{"slideType":"summary"},{"slideType":"roadmap"}]}),
            json!({"id":"tpl-tech","name":"科技青","description":"适合研发与产品演示","theme":"tech","primaryColor":"#0891b2","secondaryColor":"#082f49","backgroundColor":"#f0fdfa","textColor":"#164e63","cardBgColor":"#ffffff","accentColor":"#14b8a6","fontFamily":"Aptos","slidesLayout":[{"slideType":"cover"},{"slideType":"content"},{"slideType":"summary"},{"slideType":"roadmap"}]}),
            json!({"id":"tpl-minimal","name":"极简白","description":"高对比黑白排版，留白充足、适合快速阅读","theme":"minimalist","primaryColor":"#0f172a","secondaryColor":"#475569","backgroundColor":"#f8fafc","textColor":"#1e293b","cardBgColor":"#ffffff","accentColor":"#2563eb","fontFamily":"Aptos","slidesLayout":[{"slideType":"cover"},{"slideType":"content"},{"slideType":"summary"},{"slideType":"roadmap"}]}),
        ];
        for template in templates {
            let id = template
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO ppt_templates(id,payload_json) VALUES(?,?)",
                    params![id, template.to_string()],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub(crate) fn setting(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key=?",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub(crate) fn save_local_setting(&self, key: &str, value: &str) -> Result<(), String> {
        if key == "workspaceId" && self.setting(key)?.as_deref() != Some(value) {
            let revision=self.setting("workspaceRevision")?.unwrap_or_else(|| "1".into()).parse::<u64>().unwrap_or(1)+1;
            self.conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('workspaceId',?),('workspaceRevision',?)",params![value,revision.to_string()]).map_err(|e| e.to_string())?;
            *self.active_workspace.write().map_err(|e| e.to_string())?=value.to_string();
            return Ok(());
        }
        self.conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", params![key, value]).map(|_| ()).map_err(|error| error.to_string())
    }

    pub fn close_button_behavior(&self) -> Result<models::CloseButtonBehavior, String> {
        Ok(match self.setting("closeButtonBehavior")?.as_deref() {
            Some("exit") => models::CloseButtonBehavior::Exit,
            _ => models::CloseButtonBehavior::Tray,
        })
    }

    pub fn save_close_button_behavior(&self, behavior: models::CloseButtonBehavior) -> Result<(), String> {
        let value = match behavior {
            models::CloseButtonBehavior::Tray => "tray",
            models::CloseButtonBehavior::Exit => "exit",
        };
        self.conn.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('closeButtonBehavior',?)",
            params![value],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn app_lock_config(&self) -> Result<crate::app_lock::AppLockConfig, String> {
        Ok(crate::app_lock::AppLockConfig {
            enabled: self.setting("appLockEnabled")?.as_deref() == Some("1"),
            idle_minutes: self.setting("appLockIdleMinutes")?.and_then(|value| value.parse::<u32>().ok()).filter(|minutes| (1..=1440).contains(minutes)).unwrap_or(5),
            password_hash: self.setting("appLockPasswordHash")?.unwrap_or_default(),
        })
    }

    pub fn save_app_lock_config(&self, config: &crate::app_lock::AppLockConfig) -> Result<(), String> {
        if !(1..=1440).contains(&config.idle_minutes) { return Err("自动锁定时间必须为 1 到 1440 分钟".into()); }
        if config.enabled && config.password_hash.is_empty() { return Err("启用自动锁定前请设置解锁密码".into()); }
        self.conn.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('appLockEnabled',?),('appLockIdleMinutes',?),('appLockPasswordHash',?)",
            params![if config.enabled { "1" } else { "0" }, config.idle_minutes.to_string(), config.password_hash],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn next_clock(&self) -> Result<i64, String> {
        let current: i64 = self
            .setting("localClock")?
            .unwrap_or_else(|| "0".into())
            .parse()
            .unwrap_or(0);
        let now = Utc::now().timestamp_millis();
        let next = current.max(now) + 1;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('localClock',?)",
                params![next.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(next)
    }

    /// Reads the workspace record without creating one.
    fn workspace_row(&self) -> Result<Option<Workspace>, String> {
        if let Ok(Some(active_id)) = self.setting("workspaceId") {
            let row = self
                .conn
                .query_row(
                    "SELECT id,name,slug,logo,description,timezone,owner_id,created_at,updated_at FROM workspaces WHERE id=?",
                    params![active_id],
                    |row| {
                        Ok(Workspace {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            slug: row.get(2)?,
                            logo: row.get(3)?,
                            description: row.get(4)?,
                            timezone: row.get(5)?,
                            owner_id: row.get(6)?,
                            created_at: row.get(7)?,
                            updated_at: row.get(8)?,
                        })
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if row.is_some() {
                return Ok(row);
            }
        }
        self.conn
            .query_row(
                "SELECT id,name,slug,logo,description,timezone,owner_id,created_at,updated_at FROM workspaces ORDER BY created_at ASC LIMIT 1",
                [],
                |row| {
                    Ok(Workspace {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        slug: row.get(2)?,
                        logo: row.get(3)?,
                        description: row.get(4)?,
                        timezone: row.get(5)?,
                        owner_id: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, String> {
        self.ensure_workspace_record()?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id,name,slug,logo,description,timezone,owner_id,created_at,updated_at FROM workspaces WHERE EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=workspaces.id AND m.user_id=(SELECT value FROM settings WHERE key='currentUserId') AND m.status='member') ORDER BY created_at ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    slug: row.get(2)?,
                    logo: row.get(3)?,
                    description: row.get(4)?,
                    timezone: row.get(5)?,
                    owner_id: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn create_workspace(&self, name: &str, slug: Option<&str>, timezone: Option<&str>, operator: &str) -> Result<Workspace,String> {
        self.workspace_transaction("create_workspace",|| self.create_workspace_inner(name,slug,timezone,operator))
    }
    fn create_workspace_inner(
        &self,
        name: &str,
        slug: Option<&str>,
        timezone: Option<&str>,
        operator: &str,
    ) -> Result<Workspace, String> {
        if name.trim().is_empty() {
            return Err("工作区名称不能为空".into());
        }
        let id = format!("ws-{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let slug_str = slug
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| workspace_slug(&id));
        let tz_str = timezone
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Asia/Shanghai".into());
        let ws = Workspace {
            id: id.clone(),
            name: name.trim().to_string(),
            slug: slug_str,
            logo: None,
            description: None,
            timezone: tz_str,
            owner_id: operator.to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        self.conn
            .execute(
                "INSERT INTO workspaces(id,name,slug,logo,description,timezone,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                params![
                    ws.id,
                    ws.name,
                    ws.slug,
                    ws.logo,
                    ws.description,
                    ws.timezone,
                    ws.owner_id,
                    ws.created_at,
                    ws.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        self.conn
            .execute(
                "INSERT INTO workspace_members(workspace_id,user_id,role,status,requested_at,reviewed_at,reviewed_by) VALUES(?,?,'owner','member',?,?,NULL)",
                params![ws.id, operator, now, now],
            )
            .map_err(|error| error.to_string())?;
        self.conn.execute("INSERT INTO workspace_credentials(workspace_id,token) VALUES(?,?)",params![ws.id,generate_mcp_token()]).map_err(|e| e.to_string())?;
        Ok(ws)
    }

    pub fn delete_workspace(&self, workspace_id: &str, operator: &str) -> Result<(),String> {
        self.workspace_transaction("delete_workspace",|| self.delete_workspace_inner(workspace_id,operator))
    }
    fn delete_workspace_inner(&self, workspace_id: &str, operator: &str) -> Result<(), String> {
        let all = self.list_workspaces()?;
        if all.len() <= 1 {
            return Err("至少保留一个工作区，不能删除全部工作区".into());
        }
        let target = all
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or_else(|| "工作区不存在".to_string())?;
        if target.owner_id != operator {
            return Err("只有工作区所有者可以删除工作区".into());
        }
        let current_ws_id = self.setting("workspaceId")?;
        if current_ws_id.as_deref() == Some(workspace_id) {
            let remaining = self
                .list_workspaces()?
                .into_iter()
                .find(|w| w.id != workspace_id);
            if let Some(next_ws) = remaining {
                self.save_local_setting("workspaceId", &next_ws.id)?;
                self.save_local_setting("workspaceName", &next_ws.name)?;
            }
        }
        self.conn
            .execute("DELETE FROM workspace_members WHERE workspace_id=?", params![workspace_id])
            .map_err(|error| error.to_string())?;
        self.conn.execute("DELETE FROM workspace_join_requests WHERE workspace_id=?", params![workspace_id]).map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM workspaces WHERE id=?", params![workspace_id])
            .map_err(|error| error.to_string())?;
        for table in crate::workspace_scope::TABLES {
            self.conn.execute(&format!("DELETE FROM {table} WHERE workspace_id=?"),params![workspace_id]).map_err(|e| e.to_string())?;
        }
        for table in ["ai_tool_operations","ai_runs","ai_client_messages","ai_branches","ai_messages","ai_conversations","ai_model_defaults","ai_model_bindings","ai_connection_bindings","ai_extensions","ai_schedules","ai_storage_versions","ai_cache_imports","ai_migration_backups","workspace_credentials","workspace_private_data","workspace_llm_bindings","workspace_templates","wiki_documents"] {
            self.conn.execute(&format!("DELETE FROM {table} WHERE workspace_id=?"),params![workspace_id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn switch_workspace(&self, workspace_id: &str, operator: &str) -> Result<Workspace,String> {
        self.workspace_transaction("switch_workspace",|| self.switch_workspace_inner(workspace_id,operator))
    }
    fn switch_workspace_inner(&self, workspace_id: &str, operator: &str) -> Result<Workspace, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id,name,slug,logo,description,timezone,owner_id,created_at,updated_at FROM workspaces WHERE id=?",
            )
            .map_err(|error| error.to_string())?;
        let ws = stmt
            .query_row(params![workspace_id], |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    slug: row.get(2)?,
                    logo: row.get(3)?,
                    description: row.get(4)?,
                    timezone: row.get(5)?,
                    owner_id: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|error| format!("未找到指定工作区: {error}"))?;
        let member: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='member')",params![workspace_id,operator],|r| r.get(0)).map_err(|e| e.to_string())?;
        if !member { return Err("当前用户不是该工作区的成员".into()); }
        self.conn.execute("INSERT OR IGNORE INTO workspace_credentials(workspace_id,token) VALUES(?,?)",params![workspace_id,generate_mcp_token()]).map_err(|e| e.to_string())?;
        self.save_local_setting("workspaceId", &ws.id)?;
        self.save_local_setting("workspaceName", &ws.name)?;
        Ok(ws)
    }

    pub fn workspace(&self) -> Result<(String, String), String> {
        // Signature-compatible reader. The settings keys are still written by
        // the P2P runtime, so they remain the fallback for a database that has
        // not been migrated yet.
        if let Some(workspace) = self.workspace_row()? {
            return Ok((workspace.id, workspace.name));
        }
        Ok((
            self.setting("workspaceId")?
                .ok_or_else(|| "工作区 ID 未初始化".to_string())?,
            self.setting("workspaceName")?
                .unwrap_or_else(|| "我的工作区".into()),
        ))
    }

    pub fn workspace_token(&self) -> Result<String, String> {
        self.conn.query_row("SELECT token FROM workspace_credentials WHERE workspace_id=?",params![self.workspace_context()?.workspace_id],|r| r.get(0)).map_err(|e| e.to_string())
    }

    pub fn current_user_id(&self) -> Result<String, String> {
        self.setting("currentUserId")?
            .ok_or_else(|| "当前用户未初始化".to_string())
    }

    pub fn set_current_user(&self, user_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('currentUserId',?)",
                params![user_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mcp_config(&self) -> Result<McpConfig, String> {
        let enabled = self.setting("mcpEnabled")?.as_deref() == Some("1");
        let port = self
            .setting("mcpPort")?
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port >= 1024)
            .unwrap_or(45992);
        let token = match self.setting("mcpToken")? {
            Some(token) if !token.trim().is_empty() => token,
            _ => {
                let token = generate_mcp_token();
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO settings(key,value) VALUES('mcpToken',?)",
                        params![token],
                    )
                    .map_err(|error| error.to_string())?;
                token
            }
        };
        Ok(McpConfig {
            enabled,
            port,
            token,
        })
    }

    pub fn save_mcp_config(&self, enabled: bool, port: u16) -> Result<McpConfig, String> {
        if port < 1024 {
            return Err("MCP 端口必须在 1024 到 65535 之间".into());
        }
        let current = self.workspace_context()?;
        let token = if self.external_authorization("mcp")? != current { generate_mcp_token() } else { self.mcp_config()?.token };
        self.save_external_authorization("mcp", &current)?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('mcpEnabled',?),('mcpPort',?),('mcpToken',?)",
                params![if enabled { "1" } else { "0" }, port.to_string(), token],
            )
            .map_err(|error| error.to_string())?;
        self.mcp_config()
    }

    pub fn rotate_mcp_token(&self) -> Result<McpConfig, String> {
        self.save_external_authorization("mcp", &self.workspace_context()?)?;
        let token = generate_mcp_token();
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('mcpToken',?)",
                params![token],
            )
            .map_err(|error| error.to_string())?;
        self.mcp_config()
    }

    pub fn restore_mcp_token(&self, token: &str) -> Result<McpConfig, String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('mcpToken',?)",
                params![token],
            )
            .map_err(|error| error.to_string())?;
        self.mcp_config()
    }

    pub fn web_config(&self) -> Result<WebConfig, String> {
        let enabled = self.setting("webEnabled")?.as_deref() == Some("1");
        let bind_address = self
            .setting("webBindAddress")?
            .filter(|value| matches!(value.as_str(), "0.0.0.0" | "127.0.0.1"))
            .unwrap_or_else(|| "0.0.0.0".into());
        let port = self
            .setting("webPort")?
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port >= 1024)
            .unwrap_or_else(generate_web_port);
        let password_hash = self.setting("webPasswordHash")?.unwrap_or_default();
        Ok(WebConfig {
            read_only: self.setting("webReadOnly")?.as_deref() != Some("0"),
            enabled,
            bind_address,
            port,
            password_hash,
            password_protected: self.setting("webPasswordProtected")?.filter(|value| !value.is_empty()),
        })
    }

    pub fn save_web_config(&self, config: &WebConfig) -> Result<WebConfig, String> {
        if config.port < 1024 {
            return Err("Web 服务端口必须在 1024 到 65535 之间".into());
        }
        if !matches!(config.bind_address.as_str(), "0.0.0.0" | "127.0.0.1") {
            return Err("Web 服务监听地址无效".into());
        }
        if config.enabled && config.password_hash.trim().is_empty() {
            return Err("启用 Web 服务前必须设置访问密码".into());
        }
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('webEnabled',?),('webBindAddress',?),('webPort',?),('webPasswordHash',?),('webReadOnly',?),('webPasswordProtected',?)",
                params![
                    if config.enabled { "1" } else { "0" },
                    config.bind_address,
                    config.port.to_string(),
                    config.password_hash,
                    if config.read_only { "1" } else { "0" },
                    config.password_protected.as_deref().unwrap_or("")
                ],
            )
            .map_err(|error| error.to_string())?;
        self.save_external_authorization("web", &self.workspace_context()?)?;
        self.web_config()
    }

    pub fn users(&self) -> Result<Vec<User>, String> {
        let mut stmt = self.conn.prepare("SELECT id,username,device_id,nickname,role,ip,is_online,last_active,avatar FROM users ORDER BY nickname").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    device_id: row.get(2)?,
                    nickname: row.get(3)?,
                    role: row.get(4)?,
                    ip: row.get(5)?,
                    is_online: row.get::<_, i64>(6)? != 0,
                    last_active: row.get(7)?,
                    avatar: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn local_directory(&self) -> Result<models::LocalDirectory, String> {
        let mut units_stmt = self
            .conn
            .prepare("SELECT id, name, parent_id, sort_order FROM local_org_units WHERE workspace_id=active_workspace_id()  ORDER BY sort_order, name, id")
            .map_err(|error| error.to_string())?;
        let units = units_stmt
            .query_map([], |row| {
                Ok(models::LocalOrgUnit {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        let mut members_stmt = self
            .conn
            .prepare("SELECT org_unit_id, user_id FROM local_org_members WHERE workspace_id=active_workspace_id()  ORDER BY org_unit_id, user_id")
            .map_err(|error| error.to_string())?;
        let members = members_stmt
            .query_map([], |row| {
                Ok(models::LocalOrgMember {
                    org_unit_id: row.get(0)?,
                    user_id: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(models::LocalDirectory { units, members })
    }

    pub fn save_local_directory(
        &self,
        directory: &models::LocalDirectory,
    ) -> Result<models::LocalDirectory, String> {
        let unit_ids: HashSet<&str> = directory.units.iter().map(|unit| unit.id.as_str()).collect();
        if unit_ids.len() != directory.units.len() {
            return Err("本地组织 ID 不能重复".into());
        }
        if directory.units.iter().any(|unit| unit.id.trim().is_empty() || unit.name.trim().is_empty()) {
            return Err("本地组织名称不能为空".into());
        }
        if directory.units.iter().any(|unit| unit.parent_id.as_deref().is_some_and(|parent| parent == unit.id || !unit_ids.contains(parent))) {
            return Err("本地组织层级无效".into());
        }
        for unit in &directory.units {
            let mut seen = HashSet::new();
            let mut parent_id = unit.parent_id.as_deref();
            while let Some(parent) = parent_id {
                if !seen.insert(parent) {
                    return Err("本地组织不能形成循环层级".into());
                }
                parent_id = directory
                    .units
                    .iter()
                    .find(|candidate| candidate.id == parent)
                    .and_then(|candidate| candidate.parent_id.as_deref());
            }
        }
        let mut member_keys = HashSet::new();
        for member in &directory.members {
            if !unit_ids.contains(member.org_unit_id.as_str()) {
                return Err("本地组织成员引用了不存在的组织".into());
            }
            if !member_keys.insert((member.org_unit_id.as_str(), member.user_id.as_str())) {
                return Err("本地组织成员不能重复".into());
            }
        }

        let transaction = self.conn.unchecked_transaction().map_err(|error| error.to_string())?;
        transaction
            .execute_batch("DELETE FROM local_org_members WHERE workspace_id=active_workspace_id() ; DELETE FROM local_org_units WHERE workspace_id=active_workspace_id() ;")
            .map_err(|error| error.to_string())?;
        for unit in &directory.units {
            transaction
                .execute(
                    "INSERT INTO local_org_units(id, name, parent_id, sort_order) VALUES(?,?,?,?)",
                    params![unit.id, unit.name.trim(), unit.parent_id, unit.sort_order],
                )
                .map_err(|error| error.to_string())?;
        }
        for member in &directory.members {
            transaction
                .execute(
                    "INSERT INTO local_org_members(org_unit_id, user_id) VALUES(?,?)",
                    params![member.org_unit_id, member.user_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        self.local_directory()
    }

    pub fn upsert_user(&self, user: &User) -> Result<User, String> {
        self.conn.execute("INSERT INTO users(id,username,device_id,nickname,role,ip,is_online,last_active,avatar) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,device_id=excluded.device_id,nickname=excluded.nickname,role=excluded.role,ip=excluded.ip,is_online=excluded.is_online,last_active=excluded.last_active,avatar=excluded.avatar", params![user.id,user.username,user.device_id,user.nickname,user.role,user.ip,if user.is_online {1} else {0},user.last_active,user.avatar]).map_err(|e| e.to_string())?;
        Ok(user.clone())
    }

    pub fn save_local_user_profile(&self, user: &User) -> Result<User, String> {
        let saved = self.upsert_user(user)?;
        self.log_operation(
            "user_profile",
            &saved.id,
            "update",
            serde_json::to_value(&saved).map_err(|error| error.to_string())?,
            &saved.id,
            None,
        )?;
        Ok(saved)
    }

    pub fn remember_lan_user(
        &self,
        user_id: &str,
        device_id: &str,
        nickname: &str,
        ip: &str,
        last_seen: &str,
    ) -> Result<User, String> {
        if self.current_user_id().ok().as_deref() == Some(user_id) {
            return self
                .users()?
                .into_iter()
                .find(|user| user.id == user_id)
                .ok_or_else(|| "本机用户不存在".to_string());
        }
        let existing = self.users()?.into_iter().find(|user| user.id == user_id);
        let username = existing
            .as_ref()
            .map(|user| user.username.clone())
            .unwrap_or_else(|| user_id.split('@').next().unwrap_or("lan-user").to_string());
        let user = User {
            id: user_id.to_string(),
            username: username.clone(),
            device_id: if device_id.trim().is_empty() {
                existing
                    .as_ref()
                    .map(|user| user.device_id.clone())
                    .unwrap_or_else(|| "lan-device".into())
            } else {
                device_id.to_string()
            },
            nickname: if nickname.trim().is_empty() {
                existing
                    .as_ref()
                    .map(|user| user.nickname.clone())
                    .unwrap_or(username)
            } else {
                nickname.to_string()
            },
            role: "user".into(),
            ip: ip.to_string(),
            is_online: false,
            last_active: last_seen.to_string(),
            avatar: existing.and_then(|user| user.avatar),
        };
        self.upsert_user(&user)
    }

    fn insert_project(&self, project: &Project, log: bool) -> Result<(), String> {
        let is_archived_int = if project.is_archived.unwrap_or(false) { 1 } else { 0 };
        self.conn.execute("INSERT OR REPLACE INTO projects(id,name,description,color,created_by,admins_json,members_json,created_at,updated_at,deleted,workspace_id,identifier,lead_id,timezone,next_work_item_sequence,visibility,cover_image,start_date,target_date,is_archived,archived_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)", params![project.id,project.name,project.description,project.color,project.created_by,serde_json::to_string(&project.admins).map_err(|e| e.to_string())?,serde_json::to_string(&project.members).map_err(|e| e.to_string())?,project.created_at,project.updated_at,project.workspace_id,project.identifier,project.lead_id,project.timezone,project.next_work_item_sequence,project.visibility,project.cover_image,project.start_date,project.target_date,is_archived_int,project.archived_at]).map_err(|e| e.to_string())?;
        if log {
            self.log_operation(
                "project",
                &project.id,
                "create",
                serde_json::to_value(project).map_err(|e| e.to_string())?,
                &project.created_by,
                Some(&project.id),
            )?;
        }
        Ok(())
    }

    fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
        let admins: String = row.get(5)?;
        let members: String = row.get(6)?;
        let is_archived_int: Option<i64> = row.get(18).ok();
        let is_archived = is_archived_int.map(|v| v != 0);
        let archived_at: Option<String> = row.get(19).ok();
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            color: row.get(3)?,
            created_by: row.get(4)?,
            admins: serde_json::from_str(&admins).unwrap_or_default(),
            members: serde_json::from_str(&members).unwrap_or_default(),
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            membership_status: None,
            workspace_id: row.get(9)?,
            identifier: row.get(10)?,
            lead_id: row.get(11)?,
            timezone: row.get(12)?,
            next_work_item_sequence: row.get(13)?,
            visibility: row.get(14)?,
            cover_image: row.get(15)?,
            start_date: row.get(16)?,
            target_date: row.get(17)?,
            is_archived,
            archived_at,
        })
    }

    pub fn projects(&self, user_id: Option<&str>) -> Result<Vec<Project>, String> {
        let mut stmt = self.conn.prepare("SELECT id,name,description,color,created_by,admins_json,members_json,created_at,updated_at,workspace_id,identifier,lead_id,timezone,next_work_item_sequence,visibility,cover_image,start_date,target_date,is_archived,archived_at FROM projects WHERE workspace_id=active_workspace_id() AND deleted=0 ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::project_from_row)
            .map_err(|e| e.to_string())?;
        let mut result = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if let Some(uid) = user_id {
            if let Ok(Some(ws_id)) = self.setting("workspaceId") {
                if !ws_id.is_empty() {
                    result.retain(|project| {
                        project.workspace_id.as_deref() == Some(&ws_id) || project.workspace_id.is_none()
                    });
                }
            }
            result.retain(|project| {
                project.created_by == uid
                    || project.members.iter().any(|id| id == uid)
                    || project.admins.iter().any(|id| id == uid)
            });
            for project in &mut result {
                project.membership_status = Some("member".into());
            }
        }
        Ok(result)
    }

    pub fn create_project(&self, value: Value, operator: &str) -> Result<Project, String> {
        let now = Utc::now().to_rfc3339();
        let mut map = value.as_object().cloned().unwrap_or_default();
        self.stamp_workspace(&mut map)?;
        let requested_members = map
            .remove("members")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_owned));
        let requested_admins = map
            .remove("admins")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_owned));
        let lead_id = map
            .remove("leadId")
            .and_then(|value| value.as_str().map(str::to_owned));
        let visibility = map
            .remove("visibility")
            .and_then(|value| value.as_str().map(str::to_owned))
            .or_else(|| Some("public".into()));
        let cover_image = map
            .remove("coverImage")
            .and_then(|value| value.as_str().map(str::to_owned));
        let start_date = map
            .remove("startDate")
            .and_then(|value| value.as_str().map(str::to_owned))
            .filter(|s| !s.trim().is_empty());
        let target_date = map
            .remove("targetDate")
            .or_else(|| map.remove("dueDate"))
            .and_then(|value| value.as_str().map(str::to_owned))
            .filter(|s| !s.trim().is_empty());
        let mut admins = vec![operator.to_string()];
        admins.extend(requested_admins);
        let mut members = vec![operator.to_string()];
        members.extend(requested_members);
        if let Some(ref lead) = lead_id {
            if !lead.trim().is_empty() {
                members.push(lead.clone());
                admins.push(lead.clone());
            }
        }
        admins.extend(admins.clone());
        admins.sort();
        admins.dedup();
        members.extend(admins.iter().cloned());
        members.sort();
        members.dedup();
        let id = map
            .remove("id")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("proj-{}", Uuid::new_v4().simple()));
        let name = map
            .remove("name")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| "未命名项目".into());
        let identifier = map
            .remove("identifier")
            .and_then(|v| v.as_str().map(str::to_owned))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| project_identifier(&name, &id));
        let project = Project {
            id,
            name,
            description: map
                .remove("description")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            color: map
                .remove("color")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "#3b82f6".into()),
            created_by: operator.into(),
            admins,
            members,
            created_at: now.clone(),
            updated_at: now,
            membership_status: Some("member".into()),
            workspace_id: map
                .remove("workspaceId")
                .and_then(|value| value.as_str().map(str::to_owned))
                .or_else(|| self.setting("workspaceId").ok().flatten()),
            identifier: Some(identifier),
            lead_id,
            timezone: map
                .remove("timezone")
                .and_then(|value| value.as_str().map(str::to_owned)),
            next_work_item_sequence: 1,
            visibility,
            cover_image,
            start_date,
            target_date,
            is_archived: Some(false),
            archived_at: None,
        };
        self.insert_project(&project, true)?;
        self.seed_states_for_scope(Some(&project.id), None, &Utc::now().to_rfc3339())?;
        Ok(project)
    }

    pub fn update_project(
        &self,
        id: &str,
        mut updates: Value,
        operator: &str,
    ) -> Result<Project, String> {
        let mut project = self
            .projects(None)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "项目不存在".to_string())?;
        if !project.admins.iter().any(|a| a == operator) && project.created_by != operator {
            return Err("只有项目管理员可以修改项目".into());
        }
        if let Some(updates) = updates.as_object_mut() {
            updates.remove("id");
            updates.remove("createdBy");
            updates.remove("createdAt");
            if let Some(due) = updates.get("dueDate").cloned() {
                if !updates.contains_key("targetDate") {
                    updates.insert("targetDate".into(), due);
                }
            }
        }
        let previous_member_ids = project.members.clone();
        let mut current = serde_json::to_value(&project).map_err(|e| e.to_string())?;
        merge_json(&mut current, updates);
        let mut normalized: Project = serde_json::from_value(current.clone()).map_err(|e| e.to_string())?;
        if project.admins.iter().any(|admin| admin == operator) && project.created_by != operator {
            if !normalized.members.iter().any(|member| member == operator)
                || !normalized.admins.iter().any(|admin| admin == operator)
            {
                return Err("项目管理员不能修改自己的加入状态或角色，请由其他管理员操作".into());
            }
        }
        if !normalized.members.iter().any(|member| member == &normalized.created_by) {
            normalized.members.push(normalized.created_by.clone());
        }
        if !normalized.admins.iter().any(|admin| admin == &normalized.created_by) {
            normalized.admins.push(normalized.created_by.clone());
        }
        normalized.admins.retain(|admin| normalized.members.iter().any(|member| member == admin));
        project = normalized;
        let mut current = serde_json::to_value(&project).map_err(|e| e.to_string())?;
        current["updatedAt"] = json!(Utc::now().to_rfc3339());
        project = serde_json::from_value(current).map_err(|e| e.to_string())?;
        self.insert_project(&project, false)?;
        let mut payload = serde_json::to_value(&project).map_err(|e| e.to_string())?;
        payload["previousMemberIds"] = json!(previous_member_ids);
        self.log_operation(
            "project",
            &project.id,
            "update",
            payload,
            operator,
            Some(&project.id),
        )?;
        Ok(project)
    }

    pub fn transfer_project(
        &self,
        id: &str,
        target_user_id: &str,
        operator: &str,
    ) -> Result<Project, String> {
        let mut project = self
            .projects(None)?
            .into_iter()
            .find(|project| project.id == id)
            .ok_or_else(|| "项目不存在".to_string())?;
        if project.created_by != operator {
            return Err("只有项目创建者可以转让项目".into());
        }
        if target_user_id == operator {
            return Err("不能将项目转让给自己".into());
        }
        if !project.members.iter().any(|member| member == target_user_id) {
            project.members.push(target_user_id.to_string());
        }
        let previous_creator_id = project.created_by.clone();
        project.created_by = target_user_id.to_string();
        if !project.members.iter().any(|member| member == operator) {
            project.members.push(operator.to_string());
        }
        if !project.admins.iter().any(|admin| admin == target_user_id) {
            project.admins.push(target_user_id.to_string());
        }
        project.admins.retain(|admin| admin != operator);
        project.updated_at = Utc::now().to_rfc3339();
        self.insert_project(&project, false)?;
        let mut payload = serde_json::to_value(&project).map_err(|e| e.to_string())?;
        payload["previousCreatorId"] = json!(previous_creator_id);
        self.log_operation("project", id, "transfer", payload, operator, Some(id))?;
        Ok(project)
    }

    pub fn delete_project(&self, id: &str, operator: &str) -> Result<bool, String> {
        let project = match self
            .projects(None)?
            .into_iter()
            .find(|project| project.id == id)
        {
            Some(project) => project,
            None => return Ok(false),
        };
        if project.created_by != operator {
            return Err("只有项目创建者可以删除项目".into());
        }

        let updated = self
            .conn
            .execute(
                "UPDATE projects SET deleted=1,updated_at=? WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0",
                params![Utc::now().to_rfc3339(), id],
            )
            .map_err(|error| error.to_string())?;
        if updated == 0 {
            return Ok(false);
        }
        self.log_operation(
            "project",
            id,
            "delete",
            json!({"id": id, "previousMemberIds": project.members}),
            operator,
            Some(id),
        )?;
        Ok(true)
    }

    pub fn project_files(&self, project_id: &str) -> Result<Vec<ProjectFileRecord>, String> {
        self.require_project_read(project_id,&self.current_user_id()?)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, relative_path, size_bytes, mime_type, sha256, source_node_id, source_address, source_http_port, uploaded_by, uploaded_at FROM project_files WHERE workspace_id=active_workspace_id() AND project_id=? AND deleted=0 ORDER BY uploaded_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id], |row| {
            let size_i64: i64 = row.get(4)?;
            let http_port_i64: i64 = row.get(9)?;
            Ok(ProjectFileRecord { workspace_id: Some(self.active_workspace.read().unwrap().clone()),
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                relative_path: row.get(3)?,
                size_bytes: size_i64 as u64,
                mime_type: row.get(5)?,
                sha256: row.get(6)?,
                source_node_id: row.get(7)?,
                source_address: row.get(8)?,
                source_http_port: http_port_i64 as u16,
                uploaded_by: row.get(10)?,
                uploaded_at: row.get(11)?,
                is_local: false,
                http_url: None,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn project_file_by_id(&self, file_id: &str) -> Result<Option<ProjectFileRecord>, String> {
        let mut stmt = self.conn.prepare("SELECT id, project_id, name, relative_path, size_bytes, mime_type, sha256, source_node_id, source_address, source_http_port, uploaded_by, uploaded_at FROM project_files WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0").map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![file_id]).map_err(|e| e.to_string())?;
        let Some(row) = rows.next().map_err(|e| e.to_string())? else { return Ok(None); };
        Ok(Some(ProjectFileRecord { workspace_id: Some(self.active_workspace.read().unwrap().clone()), id: row.get(0).map_err(|e| e.to_string())?, project_id: row.get(1).map_err(|e| e.to_string())?, name: row.get(2).map_err(|e| e.to_string())?, relative_path: row.get(3).map_err(|e| e.to_string())?, size_bytes: row.get(4).map_err(|e| e.to_string())?, mime_type: row.get(5).map_err(|e| e.to_string())?, sha256: row.get(6).map_err(|e| e.to_string())?, source_node_id: row.get(7).map_err(|e| e.to_string())?, source_address: row.get(8).map_err(|e| e.to_string())?, source_http_port: row.get(9).map_err(|e| e.to_string())?, uploaded_by: row.get(10).map_err(|e| e.to_string())?, uploaded_at: row.get(11).map_err(|e| e.to_string())?, is_local: false, http_url: None }))
    }

    pub fn insert_project_file(&self, record: &ProjectFileRecord, log: bool) -> Result<(), String> {
        self.conn.execute(
            "INSERT OR REPLACE INTO project_files(id, project_id, name, relative_path, size_bytes, mime_type, sha256, source_node_id, source_address, source_http_port, uploaded_by, uploaded_at, deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)",
            params![
                record.id,
                record.project_id,
                record.name,
                record.relative_path,
                record.size_bytes as i64,
                record.mime_type,
                record.sha256,
                record.source_node_id,
                record.source_address,
                record.source_http_port as i64,
                record.uploaded_by,
                record.uploaded_at
            ]
        ).map_err(|e| e.to_string())?;

        if log {
            self.log_operation(
                "project_file",
                &record.id,
                "create",
                serde_json::to_value(record).map_err(|e| e.to_string())?,
                &record.uploaded_by,
                Some(&record.project_id),
            )?;
        }
        Ok(())
    }

    pub fn delete_project_file(&self, file_id: &str, user_id: &str) -> Result<bool, String> {
        let (project_id, uploaded_by): (String, String) = self.conn.query_row(
            "SELECT project_id, uploaded_by FROM project_files WHERE workspace_id=active_workspace_id() AND id=?",
            params![file_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|e| e.to_string())?;

        let project = self.projects(None)?.into_iter().find(|p| p.id == project_id);
        let is_admin = project.as_ref().map(|p| p.created_by == user_id || p.admins.iter().any(|a| a == user_id)).unwrap_or(false);
        if !is_admin && uploaded_by != user_id {
            return Err("无权删除此文件".into());
        }

        self.conn.execute("UPDATE project_files SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![file_id]).map_err(|e| e.to_string())?;
        self.log_operation(
            "project_file",
            file_id,
            "delete",
            json!({"id": file_id, "projectId": project_id}),
            user_id,
            Some(&project_id),
        )?;
        Ok(true)
    }

    pub fn project_folders(&self, project_id: &str) -> Result<Vec<ProjectFolderRecord>, String> {
        self.require_project_read(project_id,&self.current_user_id()?)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, path, created_by, created_at FROM project_folders WHERE workspace_id=active_workspace_id() AND project_id=? AND deleted=0 ORDER BY path ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ProjectFolderRecord { workspace_id: Some(self.active_workspace.read().unwrap().clone()),
                id: row.get(0)?,
                project_id: row.get(1)?,
                path: row.get(2)?,
                created_by: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn insert_project_folder(&self, record: &ProjectFolderRecord, log: bool) -> Result<(), String> {
        self.conn.execute(
            "INSERT OR REPLACE INTO project_folders(id, project_id, path, created_by, created_at, deleted) VALUES(?,?,?,?,?,0)",
            params![record.id, record.project_id, record.path, record.created_by, record.created_at]
        ).map_err(|e| e.to_string())?;

        if log {
            self.log_operation(
                "project_folder",
                &record.id,
                "create",
                serde_json::to_value(record).map_err(|e| e.to_string())?,
                &record.created_by,
                Some(&record.project_id),
            )?;
        }
        Ok(())
    }

    pub fn delete_project_folder(&self, folder_id: &str, user_id: &str) -> Result<bool, String> {
        let (project_id, created_by): (String, String) = self.conn.query_row(
            "SELECT project_id, created_by FROM project_folders WHERE workspace_id=active_workspace_id() AND id=?",
            params![folder_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|e| e.to_string())?;

        let project = self.projects(None)?.into_iter().find(|p| p.id == project_id);
        let is_admin = project.as_ref().map(|p| p.created_by == user_id || p.admins.iter().any(|a| a == user_id)).unwrap_or(false);
        if !is_admin && created_by != user_id {
            return Err("无权删除此目录".into());
        }

        self.conn.execute("UPDATE project_folders SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![folder_id]).map_err(|e| e.to_string())?;
        // A folder owns every file whose relative path is inside that folder.
        // Mark descendants deleted together so the folder cannot reappear after reload.
        let folder_path = self.conn.query_row(
            "SELECT path FROM project_folders WHERE workspace_id=active_workspace_id() AND id=?",
            params![folder_id],
            |row| row.get::<_, String>(0),
        ).map_err(|e| e.to_string())?;
        let descendant_prefix = format!("{}/%", folder_path.trim_end_matches('/'));
        self.conn.execute(
            "UPDATE project_files SET deleted=1 WHERE workspace_id=active_workspace_id() AND project_id=? AND deleted=0 AND (relative_path=? OR relative_path LIKE ?)",
            params![project_id, folder_path, descendant_prefix],
        ).map_err(|e| e.to_string())?;
        self.log_operation(
            "project_folder",
            folder_id,
            "delete",
            json!({"id": folder_id, "projectId": project_id, "path": folder_path}),
            user_id,
            Some(&project_id),
        )?;
        Ok(true)
    }

    pub fn project_folder_descendant_files(&self, folder_id: &str) -> Result<Vec<(String, String)>, String> {
        let (project_id, path): (String, String) = self.conn.query_row(
            "SELECT project_id, path FROM project_folders WHERE workspace_id=active_workspace_id() AND id=?",
            params![folder_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| e.to_string())?;
        let prefix = format!("{}/%", path.trim_end_matches('/'));
        let mut stmt = self.conn.prepare("SELECT project_id, id FROM project_files WHERE workspace_id=active_workspace_id() AND project_id=? AND deleted=0 AND (relative_path=? OR relative_path LIKE ?)").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id, path, prefix], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Allocates the next `<PROJECT>-<n>` reference for a project.
    ///
    /// The counter lives on the project row and increments inside the caller's
    /// savepoint, so a rolled-back create does not burn an identifier.
    ///
    /// 编号仅保证本机唯一，不保证全网唯一：本方法先读后写，不是原子分配，
    /// 因此两台设备离线在同一项目下各建一条任务会各自拿到 `<PROJECT>-3`。
    /// 同步后两行编号相同但工作项 id 不同，数据不冲突。
    /// 局域网去中心化模型下没有仲裁者，接受这一取舍以换取编号可读性与可递增性。
    /// 若日后要求全网唯一，需要改为携带设备标识的编号方案，而不是在这里加锁。
    fn allocate_work_item_sequence(
        &self,
        project_id: &str,
    ) -> Result<(String, i64), String> {
        let next: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(next_work_item_sequence,1) FROM projects WHERE workspace_id=active_workspace_id() AND id=?",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let identifier = self
            .conn
            .query_row(
                "SELECT COALESCE(identifier,?) FROM projects WHERE workspace_id=active_workspace_id() AND id=?",
                params![project_identifier("", project_id), project_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?;
        self.conn
            .execute(
                "UPDATE projects SET next_work_item_sequence=? WHERE workspace_id=active_workspace_id() AND id=?",
                params![next + 1, project_id],
            )
            .map_err(|error| error.to_string())?;
        Ok((format!("{identifier}-{next}"), next))
    }

    fn insert_task_value(&self, value: &Value, log: bool) -> Result<Task, String> {
        let mut scoped_value = value.clone();
        self.stamp_workspace(scoped_value.as_object_mut().ok_or("任务数据无效")?)?;
        let task: Task =
            serde_json::from_value(scoped_value).map_err(|e| format!("任务数据无效: {e}"))?;
        validate_archived_task(&task)?;
        let normalized_value = serde_json::to_value(&task).map_err(|e| e.to_string())?;
        self.conn.execute("INSERT OR REPLACE INTO tasks(id,payload_json,project_id,creator_id,assignee_id,updated_at,version,deleted,state_id,state_group,state_name) VALUES(?,?,?,?,?,?,?,0,?,?,?)", params![task.id, normalized_value.to_string(), task.project_id, task.creator_id, task.assignee_id, task.updated_at, task.version, task.state_id, task.state_group, task.state_name]).map_err(|e| e.to_string())?;
        if log {
            self.log_operation(
                "task",
                &task.id,
                "create",
                normalized_value,
                &task.creator_id,
                task.project_id.as_deref(),
            )?;
        }
        Ok(task)
    }

    fn validate_task_parent(&self, task: &Task, operator: &str) -> Result<(), String> {
        self.require_workspace_member(&task.assignee_id)?;
        for user in &task.shared_with { self.require_workspace_member(user)?; }

        let Some(parent_id) = task.parent_task_id.as_deref() else {
            return Ok(());
        };
        if parent_id == task.id {
            return Err("任务不能关联自身为主任务".into());
        }
        let all_tasks = self.tasks(None)?;
        let parent = all_tasks
            .iter()
            .find(|candidate| candidate.id == parent_id)
            .ok_or_else(|| "选择的主任务不存在".to_string())?;
        if !self.can_read_task(parent, operator) {
            return Err("没有访问所选主任务的权限".into());
        }
        if parent.project_id != task.project_id {
            return Err("主任务与子任务必须属于同一项目".into());
        }
        if parent.parent_task_id.is_some() {
            return Err("当前版本仅支持主任务和子任务两层结构".into());
        }
        if all_tasks
            .iter()
            .any(|candidate| candidate.parent_task_id.as_deref() == Some(task.id.as_str()))
        {
            return Err("已有子任务的任务不能再关联到其他主任务".into());
        }
        Ok(())
    }

    pub fn tasks(&self, user_id: Option<&str>) -> Result<Vec<Task>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM tasks WHERE workspace_id=active_workspace_id() AND deleted=0 ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            let value: Value = serde_json::from_str(&row.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let task: Task = serde_json::from_value(value).map_err(|e| e.to_string())?;
            if user_id
                .map(|uid| self.can_read_task(&task, uid))
                .unwrap_or(true)
            {
                result.push(task);
            }
        }
        Ok(result)
    }

    pub fn task_archive(&self, user_id: &str) -> Result<TaskDataArchive, String> {
        Ok(TaskDataArchive { workspace_id: Some(self.workspace_context()?.workspace_id),
            archive_format: "lanmind-task-export".into(),
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            exported_by: user_id.to_string(),
            tasks: self.tasks(Some(user_id))?,
        })
    }

    pub fn import_task_archive(
        &self,
        mut archive: TaskDataArchive,
        operator: &str,
    ) -> Result<TaskImportResult, String> {
        if archive.archive_format != "lanmind-task-export" || archive.version != 1 {
            return Err("不支持的任务数据文件格式或版本".into());
        }
        if archive.exported_by.trim().is_empty()
            || DateTime::parse_from_rfc3339(&archive.exported_at).is_err()
        {
            return Err("任务数据文件的导出信息无效".into());
        }
        for task in &archive.tasks {
            validate_archived_task(task)?;
        }
        let ws = self.workspace_context()?.workspace_id;
        let mapping: HashMap<String,String> = archive.tasks.iter().filter(|t| t.workspace_id.as_deref().is_some_and(|id| id != ws)).map(|t| (t.id.clone(),format!("task-{}",Uuid::new_v4().simple()))).collect();
        for task in &mut archive.tasks {
            if let Some(id) = mapping.get(&task.id) { task.id = id.clone(); task.project_id=None; task.state_id=None; task.state_name=None; }
            if let Some(parent) = task.parent_task_id.as_ref() { task.parent_task_id=mapping.get(parent).cloned().or_else(|| Some(parent.clone())); }
            task.workspace_id=Some(ws.clone());
        }
        // Parents must exist before SQLite checks child references.
        archive.tasks.sort_by_key(|task| task.parent_task_id.is_some());

        let user_ids = self
            .workspace_users()?
            .into_iter()
            .map(|user| user.id)
            .collect::<HashSet<_>>();
        if !user_ids.contains(operator) {
            return Err("当前桌面用户不存在".into());
        }
        let projects = self
            .projects(None)?
            .into_iter()
            .map(|project| (project.id.clone(), project))
            .collect::<HashMap<_, _>>();
        let mut existing_tasks = {
            let mut statement = self
                .conn
                .prepare("SELECT id, deleted FROM tasks WHERE workspace_id=active_workspace_id() ")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
                })
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<HashMap<_, _>, _>>()
                .map_err(|error| error.to_string())?
        };

        self.conn
            .execute_batch("SAVEPOINT import_task_archive")
            .map_err(|error| error.to_string())?;
        let result = (|| {
            let mut imported_count = 0;
            let mut restored_count = 0;
            let mut skipped_count = 0;
            let mut converted_count = 0;

            for mut task in archive.tasks {
                let restoring = matches!(existing_tasks.get(&task.id), Some(true));
                if matches!(existing_tasks.get(&task.id), Some(false)) {
                    skipped_count += 1;
                    continue;
                }

                let users_available = user_ids.contains(&task.creator_id)
                    && user_ids.contains(&task.assignee_id)
                    && task.shared_with.iter().all(|id| user_ids.contains(id));
                let project_available = task.project_id.as_deref().is_none_or(|project_id| {
                    projects.get(project_id).is_some_and(|project| {
                        let belongs_to_project = |user_id: &str| {
                            project.created_by == user_id
                                || project.members.iter().any(|id| id == user_id)
                                || project.admins.iter().any(|id| id == user_id)
                        };
                        belongs_to_project(operator)
                            && belongs_to_project(&task.creator_id)
                            && belongs_to_project(&task.assignee_id)
                            && task.shared_with.iter().all(|id| belongs_to_project(id))
                    })
                });
                let task_visible_to_operator = self.can_read_task(&task, operator);
                if !users_available || !project_available || !task_visible_to_operator {
                    task.creator_id = operator.to_string();
                    task.assignee_id = operator.to_string();
                    task.project_id = None;
                    task.is_shared = false;
                    task.shared_with.clear();
                    task.updated_at = Utc::now().to_rfc3339();
                    converted_count += 1;
                }

                task.version = self.next_clock()?;
                let payload = serde_json::to_value(&task).map_err(|error| error.to_string())?;
                if restoring {
                    self.conn.execute(
                        "UPDATE tasks SET payload_json=?,project_id=?,creator_id=?,assignee_id=?,updated_at=?,version=?,deleted=0 WHERE workspace_id=active_workspace_id() AND id=?",
                        params![
                            payload.to_string(),
                            task.project_id,
                            task.creator_id,
                            task.assignee_id,
                            task.updated_at,
                            task.version,
                            task.id,
                        ],
                    ).map_err(|error| error.to_string())?;
                    restored_count += 1;
                } else {
                    self.conn.execute(
                        "INSERT INTO tasks(id,payload_json,project_id,creator_id,assignee_id,updated_at,version,deleted) VALUES(?,?,?,?,?,?,?,0)",
                        params![
                            task.id,
                            payload.to_string(),
                            task.project_id,
                            task.creator_id,
                            task.assignee_id,
                            task.updated_at,
                            task.version,
                        ],
                    ).map_err(|error| error.to_string())?;
                }
                self.log_operation(
                    "task",
                    &task.id,
                    "create",
                    payload,
                    operator,
                    task.project_id.as_deref(),
                )?;
                existing_tasks.insert(task.id.clone(), false);
                imported_count += 1;
            }

            Ok(TaskImportResult {
                imported_count,
                restored_count,
                skipped_count,
                converted_count,
            })
        })();

        match result {
            Ok(result) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT import_task_archive")
                    .map_err(|error| error.to_string())?;
                Ok(result)
            }
            Err(error) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT import_task_archive; RELEASE SAVEPOINT import_task_archive",
                );
                Err(error)
            }
        }
    }

    fn can_read_task(&self, task: &Task, user_id: &str) -> bool {
        if task.workspace_id.as_deref() != self.workspace_context().ok().as_ref().map(|c| c.workspace_id.as_str()) { return false; }
        let is_direct_participant = task.creator_id == user_id
            || task.assignee_id == user_id
            || task.shared_with.iter().any(|id| id == user_id);
        if task.project_id.is_none() {
            return task.is_shared || is_direct_participant;
        }
        let project = self
            .projects(None)
            .unwrap_or_default()
            .into_iter()
            .find(|project| Some(project.id.as_str()) == task.project_id.as_deref());
        let Some(project) = project else {
            return false;
        };
        let is_project_admin =
            project.created_by == user_id || project.admins.iter().any(|id| id == user_id);
        if is_project_admin {
            return true;
        }
        if !task.is_shared {
            return is_direct_participant;
        }
        project.members.iter().any(|id| id == user_id)
            || project.admins.iter().any(|id| id == user_id)
    }

    fn can_write_task(&self, task: &Task, user_id: &str) -> bool {
        if task.workspace_id.as_deref() != self.workspace_context().ok().as_ref().map(|c| c.workspace_id.as_str()) { return false; }
        if let Some(project_id) = task.project_id.as_deref() {
            let is_project_admin = self
                .projects(None)
                .unwrap_or_default()
                .into_iter()
                .find(|project| project.id == project_id)
                .map(|project| {
                    project.created_by == user_id || project.admins.iter().any(|id| id == user_id)
                })
                .unwrap_or(false);
            if is_project_admin {
                return true;
            }
        }
        if task.creator_id == user_id || task.assignee_id == user_id {
            return true;
        }
        if task.project_id.is_some() && task.is_shared {
            return self.can_read_task(task, user_id);
        }
        !task.is_shared && task.shared_with.iter().any(|id| id == user_id)
    }

    fn task_visibility_index(&self) -> Result<HashMap<String, Task>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM tasks WHERE workspace_id=active_workspace_id() ")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut tasks = HashMap::new();
        for row in rows {
            let task: Task = serde_json::from_str(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            tasks.insert(task.id.clone(), task);
        }
        Ok(tasks)
    }

    fn insert_task_assignment_notification(
        &self,
        notification: &TaskAssignmentNotification,
        log: bool,
    ) -> Result<bool, String> {
        let payload = serde_json::to_value(notification).map_err(|error| error.to_string())?;
        let inserted = self
            .conn
            .execute(
                "INSERT OR IGNORE INTO task_assignment_notifications(id,payload_json,recipient_id,created_at,read_at) VALUES(?,?,?,?,?)",
                params![
                    notification.id,
                    payload.to_string(),
                    notification.recipient_id,
                    notification.created_at,
                    notification.read_at,
                ],
            )
            .map_err(|error| error.to_string())?;
        if log && inserted > 0 {
            self.log_operation(
                "task_assignment",
                &notification.id,
                "create",
                payload,
                &notification.assigner_id,
                notification.project_id.as_deref(),
            )?;
        }
        Ok(inserted > 0)
    }

    fn notify_task_assignment(&self, task: &Task, operator: &str) -> Result<(), String> {
        if task.assignee_id == operator || (!task.is_shared && task.project_id.is_none()) {
            return Ok(());
        }
        let assigner_name = self
            .users()?
            .into_iter()
            .find(|user| user.id == operator)
            .map(|user| user.nickname)
            .unwrap_or_else(|| operator.to_string());
        let notification = TaskAssignmentNotification { workspace_id: Some(self.workspace_context()?.workspace_id),
            id: format!("task-assignment-{}-{}", task.id, task.version),
            task_id: task.id.clone(),
            task_title: task.title.clone(),
            recipient_id: task.assignee_id.clone(),
            assigner_id: operator.to_string(),
            assigner_name,
            project_id: task.project_id.clone(),
            created_at: Utc::now().to_rfc3339(),
            read_at: None,
        };
        self.insert_task_assignment_notification(&notification, true)?;
        Ok(())
    }

    pub fn task_assignment_notifications(
        &self,
        recipient_id: &str,
    ) -> Result<Vec<TaskAssignmentNotification>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT payload_json,read_at FROM task_assignment_notifications WHERE workspace_id=active_workspace_id() AND recipient_id=? AND read_at IS NULL ORDER BY created_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![recipient_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            let (payload, read_at) = row.map_err(|error| error.to_string())?;
            let mut notification: TaskAssignmentNotification =
                serde_json::from_str(&payload).map_err(|error| error.to_string())?;
            notification.read_at = read_at;
            Ok(notification)
        })
        .collect()
    }

    pub fn mark_task_assignment_notifications_read(
        &self,
        ids: &[String],
        recipient_id: &str,
    ) -> Result<usize, String> {
        let read_at = Utc::now().to_rfc3339();
        let mut updated = 0;
        for id in ids {
            updated += self
                .conn
                .execute(
                    "UPDATE task_assignment_notifications SET read_at=? WHERE workspace_id=active_workspace_id() AND id=? AND recipient_id=? AND read_at IS NULL",
                    params![read_at, id, recipient_id],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(updated)
    }

    pub fn task_comments(&self, task_id: &str, operator: &str) -> Result<Vec<TaskComment>, String> {
        let task = self
            .tasks(None)?
            .into_iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) {
            return Err("没有查看该任务评论的权限".into());
        }
        let mut statement = self.conn.prepare(
            "SELECT payload_json FROM task_comments WHERE workspace_id=active_workspace_id() AND task_id=? AND deleted=0 ORDER BY created_at ASC",
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![task_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            serde_json::from_str::<TaskComment>(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())
        }).collect()
    }

    pub fn create_task_comment(&self, task_id: &str, content: &str, operator: &str) -> Result<TaskComment, String> {
        self.create_task_comment_reply(task_id, content, operator, None)
    }

    pub fn create_task_comment_reply(&self, task_id: &str, content: &str, operator: &str, reply_to_comment_id: Option<&str>) -> Result<TaskComment, String> {
        let task = self.tasks(None)?.into_iter().find(|task| task.id == task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) {
            return Err("没有在该任务下评论的权限".into());
        }
        let content = content.trim();
        if content.is_empty() { return Err("评论内容不能为空".into()); }
        if content.chars().count() > 20_000 { return Err("评论内容不能超过 20000 个字符".into()); }
        let reply_to = reply_to_comment_id.map(|id| {
            let payload: String = self.conn.query_row(
                "SELECT payload_json FROM task_comments WHERE workspace_id=active_workspace_id() AND id=? AND task_id=? AND deleted=0", params![id, task_id], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?.ok_or_else(|| "引用的评论不存在、已删除或不属于当前任务".to_string())?;
            let original: TaskComment = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
            Ok::<_, String>(models::TaskCommentQuote { comment_id: original.id, author_id: original.author_id, content: original.content })
        }).transpose()?;
        let now = Utc::now().to_rfc3339();
        let comment = TaskComment { workspace_id: Some(self.workspace_context()?.workspace_id),
            id: format!("comment-{}", Uuid::new_v4().simple()),
            task_id: task_id.to_string(),
            author_id: operator.to_string(),
            content: content.to_string(),
            reply_to,
            created_at: now.clone(),
            updated_at: now,
        };
        let payload = serde_json::to_value(&comment).map_err(|error| error.to_string())?;
        self.conn.execute(
            "INSERT INTO task_comments(id,task_id,payload_json,author_id,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,0)",
            params![comment.id, comment.task_id, payload.to_string(), comment.author_id, comment.created_at, comment.updated_at],
        ).map_err(|error| error.to_string())?;
        self.log_operation("task_comment", &comment.id, "create", payload, operator, task.project_id.as_deref())?;
        Ok(comment)
    }

    pub fn update_task_comment(&self, id: &str, content: &str, operator: &str) -> Result<TaskComment, String> {
        let (payload, task_id): (String, String) = self.conn.query_row(
            "SELECT payload_json,task_id FROM task_comments WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0", params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| error.to_string())?;
        let mut comment: TaskComment = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        if comment.author_id != operator { return Err("只能修改自己的评论".into()); }
        let task = self.tasks(None)?.into_iter().find(|task| task.id == task_id).ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) { return Err("没有修改该任务评论的权限".into()); }
        let content = content.trim();
        if content.is_empty() { return Err("评论内容不能为空".into()); }
        if content.chars().count() > 20_000 { return Err("评论内容不能超过 20000 个字符".into()); }
        comment.content = content.to_string();
        comment.updated_at = Utc::now().to_rfc3339();
        let next_payload = serde_json::to_value(&comment).map_err(|error| error.to_string())?;
        self.conn.execute("UPDATE task_comments SET payload_json=?,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?", params![next_payload.to_string(), comment.updated_at, id]).map_err(|error| error.to_string())?;
        self.log_operation("task_comment", id, "update", next_payload, operator, task.project_id.as_deref())?;
        Ok(comment)
    }

    pub fn delete_task_comment(&self, id: &str, operator: &str) -> Result<bool, String> {
        let (payload, task_id): (String, String) = self.conn.query_row(
            "SELECT payload_json,task_id FROM task_comments WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0", params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| error.to_string())?;
        let comment: TaskComment = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        if comment.author_id != operator { return Err("只能删除自己的评论".into()); }
        let task = self.tasks(None)?.into_iter().find(|task| task.id == task_id).ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) { return Err("没有删除该任务评论的权限".into()); }
        self.conn.execute("UPDATE task_comments SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![id]).map_err(|error| error.to_string())?;
        self.log_operation("task_comment", id, "delete", json!({"id": id, "taskId": task_id}), operator, task.project_id.as_deref())?;
        Ok(true)
    }

    pub fn task_activity(&self, task_id: &str, operator: &str) -> Result<Vec<TaskActivity>, String> {
        let task = self.tasks(None)?.into_iter().find(|task| task.id == task_id).ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) { return Err("没有查看该任务动态的权限".into()); }
        let (operations, _) = self.sync_operations(0)?;
        Ok(operations.into_iter().filter_map(|operation| {
            let is_task = operation.entity_type == "task" && operation.entity_id == task_id;
            let is_comment = operation.entity_type == "task_comment"
                && operation.payload.get("taskId").and_then(Value::as_str) == Some(task_id);
            if !is_task && !is_comment { return None; }
            Some(TaskActivity { id: operation.id, task_id: task_id.to_string(), action: operation.action, actor_id: operation.node_id, timestamp: operation.timestamp, payload: operation.payload })
        }).collect())
    }

    pub fn task_activity_page(
        &self,
        task_id: &str,
        operator: &str,
        page: i64,
        page_size: i64,
        snapshot: Option<i64>,
    ) -> Result<models::RecordPage<TaskActivity>, String> {
        let task = self.tasks(None)?.into_iter().find(|task| task.id == task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_read_task(&task, operator) {
            return Err("没有查看该任务动态的权限".into());
        }
        let snapshot = self.log_snapshot(snapshot)?;
        let filter = "rowid<=?1 AND ((entity_type='task' AND entity_id=?2) OR
            (entity_type='task_comment' AND json_extract(payload_json,'$.taskId')=?2))";
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM sync_operations WHERE workspace_id=active_workspace_id() AND {filter}"),
            params![snapshot, task_id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        let page_size = page_size.clamp(1, 100);
        let page = page.clamp(1, ((total + page_size - 1) / page_size).max(1));
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id,action,node_id,timestamp,payload_json FROM sync_operations WHERE workspace_id=active_workspace_id() AND {filter}
             ORDER BY timestamp DESC,version DESC,id DESC LIMIT ?3 OFFSET ?4"
        )).map_err(|error| error.to_string())?;
        let items = stmt.query_map(params![snapshot, task_id, page_size, (page - 1) * page_size], |row| {
            let payload: String = row.get(4)?;
            Ok(TaskActivity {
                id: row.get(0)?, task_id: task_id.to_owned(), action: row.get(1)?,
                actor_id: row.get(2)?, timestamp: row.get(3)?,
                payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
            })
        }).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        Ok(models::RecordPage { items, total, page, page_size, snapshot })
    }

    pub fn save_task_with_children(
        &self,
        id: Option<&str>,
        value: Value,
        children: Vec<Value>,
        detached_ids: Vec<String>,
        operator: &str,
        expected_version: Option<i64>,
    ) -> Result<Task, String> {
        self.conn.execute_batch("SAVEPOINT task_family").map_err(|e| e.to_string())?;
        let result = (|| {
            let original_tasks = self.tasks(None)?;
            if let Some(parent_id) = id {
                let original = original_tasks.iter().find(|task| task.id == parent_id)
                    .ok_or_else(|| "任务不存在".to_string())?;
                if original_tasks.iter().any(|task| task.parent_task_id.as_deref() == Some(parent_id))
                    && value.get("projectId").is_some_and(|project| *project != json!(original.project_id)) {
                    return Err("包含子任务时不能更改归属项目".into());
                }
            }
            let parent = match id {
                Some(id) => self.update_task_with_recurrence(id, value, operator, expected_version)?.task,
                None => self.create_task(value, operator)?,
            };
            if parent.parent_task_id.is_some() && !children.is_empty() {
                return Err("子任务不能再创建子任务".into());
            }
            let mut seen = std::collections::HashSet::new();
            for child in children {
                let mut fields = child.as_object().cloned().ok_or_else(|| "子任务数据无效".to_string())?;
                if fields.get("title").and_then(Value::as_str).is_none_or(|title| title.trim().is_empty()) {
                    return Err("子任务名称不能为空".into());
                }
                let child_id = fields.remove("id").and_then(|id| id.as_str().map(str::to_owned));
                let version = fields.remove("version").and_then(|version| version.as_i64());
                fields.remove("draftId");
                fields.insert("projectId".into(), json!(parent.project_id));
                fields.insert("parentTaskId".into(), json!(parent.id));
                if let Some(child_id) = child_id {
                    if !seen.insert(child_id.clone()) || detached_ids.contains(&child_id) {
                        return Err("子任务关联重复".into());
                    }
                    let original = original_tasks.iter().find(|task| task.id == child_id)
                        .ok_or_else(|| "子任务不存在".to_string())?;
                    if original.parent_task_id.as_deref() != id || id.is_none() {
                        return Err("只能编辑当前主任务的子任务".into());
                    }
                    self.update_task_with_recurrence(&child_id, Value::Object(fields), operator, version)?;
                } else {
                    fields.insert("isShared".into(), json!(parent.is_shared));
                    fields.insert("sharedWith".into(), json!(parent.shared_with));
                    fields.entry("subtasks").or_insert_with(|| json!([]));
                    fields.entry("tags").or_insert_with(|| json!([]));
                    fields.entry("recurrence").or_insert_with(|| json!("none"));
                    fields.entry("reminderTime").or_insert(Value::Null);
                    self.create_task(Value::Object(fields), operator)?;
                }
            }
            for child_id in detached_ids {
                if !seen.insert(child_id.clone()) {
                    return Err("子任务关联重复".into());
                }
                let original = original_tasks.iter().find(|task| task.id == child_id)
                    .ok_or_else(|| "子任务不存在".to_string())?;
                if original.parent_task_id.as_deref() != id || id.is_none() {
                    return Err("只能解除当前主任务的子任务关联".into());
                }
                self.update_task(&child_id, json!({"parentTaskId": null}), operator)?;
            }
            Ok(parent)
        })();
        match result {
            Ok(task) => {
                self.conn.execute_batch("RELEASE SAVEPOINT task_family").map_err(|e| e.to_string())?;
                Ok(task)
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK TO SAVEPOINT task_family; RELEASE SAVEPOINT task_family");
                Err(error)
            }
        }
    }

    pub fn create_task(&self, value: Value, operator: &str) -> Result<Task, String> {
        self.conn
            .execute_batch("SAVEPOINT create_task")
            .map_err(|error| error.to_string())?;
        let result = self.create_task_inner(value, operator);
        match result {
            Ok(task) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT create_task")
                    .map_err(|error| error.to_string())?;
                Ok(task)
            }
            Err(error) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT create_task; RELEASE SAVEPOINT create_task",
                );
                Err(error)
            }
        }
    }

    fn create_task_inner(&self, value: Value, operator: &str) -> Result<Task, String> {
        let now = Utc::now().to_rfc3339();
        let mut map = value.as_object().cloned().unwrap_or_default();
        self.stamp_workspace(&mut map)?;
        if let Some(project_id) = map.get("projectId").and_then(Value::as_str) {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == project_id)
                .ok_or_else(|| "项目不存在".to_string())?;
            let is_member = project.members.iter().any(|id| id == operator)
                || project.admins.iter().any(|id| id == operator);
            if !is_member {
                return Err("加入项目并通过管理员审批后才能创建项目任务".into());
            }
            let assignee_id = map
                .get("assigneeId")
                .and_then(Value::as_str)
                .unwrap_or(operator);
            let assignee_is_member = project.members.iter().any(|id| id == assignee_id)
                || project.admins.iter().any(|id| id == assignee_id);
            if !assignee_is_member {
                return Err("项目任务只能指派给项目成员".into());
            }
            map.entry("isShared").or_insert_with(|| json!(true));
        }
        map.insert(
            "id".into(),
            json!(format!("task-{}", Uuid::new_v4().simple())),
        );
        map.insert("createdAt".into(), json!(now));
        map.insert("updatedAt".into(), json!(Utc::now().to_rfc3339()));
        map.insert("version".into(), json!(self.next_clock()?));
        map.insert("creatorId".into(), json!(operator));
        if !map.contains_key("assigneeId") {
            map.insert("assigneeId".into(), json!(operator));
        }
        map.entry("contentMode").or_insert_with(|| json!("markdown"));
        map.entry("parentTaskId").or_insert(Value::Null);
        let requested_status = map
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_else(|| {
                if map.get("stateId").is_some() || map.get("stateGroup").is_some() {
                    ""
                } else {
                    "todo"
                }
            })
            .to_string();
        let mut state = self.resolve_state_for_new_task(&map, operator)?;
        let group = state
            .as_ref()
            .map(|state| state.group.as_str())
            .and_then(StateGroup::parse)
            .unwrap_or_else(|| legacy_status_to_group(&requested_status));
        let cancelled = group == StateGroup::Cancelled;
        // Progress normalization precedence, preserved from the status-only
        // implementation: completion wins unless the task is cancelled.
        let progress = map
            .get("progress")
            .and_then(Value::as_u64)
            .unwrap_or(if group == StateGroup::Completed { 100 } else { 0 })
            .min(100);
        if progress == 100 && !cancelled && group != StateGroup::Completed {
            state = self.state_in_group(&map, operator, StateGroup::Completed)?;
        } else if progress > 0
            && matches!(group, StateGroup::Backlog | StateGroup::Unstarted)
        {
            state = self.state_in_group(&map, operator, StateGroup::Started)?;
        }
        let final_group = state
            .as_ref()
            .map(|state| state.group.as_str())
            .and_then(StateGroup::parse)
            .unwrap_or_else(|| {
                if progress == 100 && !cancelled {
                    StateGroup::Completed
                } else {
                    group
                }
            });
        map.insert("status".into(), json!(final_group.legacy_status()));
        map.insert("progress".into(), json!(progress));
        self.stamp_state(&mut map, state.as_ref());
        if final_group == StateGroup::Cancelled {
            map.insert("abandonedAt".into(), json!(Utc::now().to_rfc3339()));
        } else {
            map.insert("abandonedAt".into(), Value::Null);
        }
        if map.get("identifier").is_none() {
            if let Some(project_id) = map
                .get("projectId")
                .and_then(Value::as_str)
                .map(str::to_owned)
            {
                let (identifier, sequence) = self.allocate_work_item_sequence(&project_id)?;
                map.insert("identifier".into(), json!(identifier));
                map.insert("sequenceNumber".into(), json!(sequence));
            }
        }
        let candidate: Task = serde_json::from_value(Value::Object(map.clone()))
            .map_err(|error| format!("任务数据无效: {error}"))?;
        self.validate_task_parent(&candidate, operator)?;
        let task = self.insert_task_value(&Value::Object(map), true)?;
        self.notify_task_assignment(&task, operator)?;
        Ok(task)
    }

    pub fn update_task(&self, id: &str, updates: Value, operator: &str) -> Result<Task, String> {
        if updates.get("workspaceId").and_then(Value::as_str).is_some_and(|id| Some(id)!=self.setting("workspaceId").ok().flatten().as_deref()) { return Err("不能更改对象的工作区".into()); }
        self.conn
            .execute_batch("SAVEPOINT update_task")
            .map_err(|error| error.to_string())?;
        let result = self.update_task_inner(id, updates, operator);
        match result {
            Ok(task) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT update_task")
                    .map_err(|error| error.to_string())?;
                Ok(task)
            }
            Err(error) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT update_task; RELEASE SAVEPOINT update_task",
                );
                Err(error)
            }
        }
    }

    fn update_task_inner(&self, id: &str, updates: Value, operator: &str) -> Result<Task, String> {
        let current = self
            .tasks(None)?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_write_task(&current, operator) {
            return Err("没有修改该任务的权限".into());
        }
        let mut safe_updates = updates;
        if let Some(updates) = safe_updates.as_object_mut() {
            updates.remove("id");
            updates.remove("creatorId");
            updates.remove("createdAt");
            updates.remove("updatedAt");
            updates.remove("version");
        }
        let mut merged = serde_json::to_value(&current).map_err(|e| e.to_string())?;
        merge_json(&mut merged, safe_updates.clone());
        merged["updatedAt"] = json!(Utc::now().to_rfc3339());
        merged["version"] = json!(self.next_clock()?);
        let requested_status = merged
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or(current.status.as_str())
            .to_string();
        let status_was_explicit = safe_updates.get("status").is_some();
        let progress_was_explicit = safe_updates.get("progress").is_some();
        // "Explicit" means this write named a state, not that the row already
        // carries one. The merged clone always has a state, so testing the
        // merged document would make every write look explicit.
        let explicit_state_id = safe_updates
            .get("stateId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let state_was_explicit =
            explicit_state_id.is_some() || safe_updates.get("stateGroup").is_some();
        let (project_scope, owner_scope) = match current.project_id.as_deref() {
            Some(project_id) => (Some(project_id), None),
            None => (None, Some(current.creator_id.as_str())),
        };
        let requested_state = match explicit_state_id.as_deref() {
            Some(state_id) => {
                let states = self.states_for_scope(project_scope, owner_scope)?;
                states
                    .into_iter()
                    .find(|state| state.id == state_id)
                    .ok_or_else(|| "状态不存在或不属于当前列表".to_string())?
            }
            None => self
                .resolve_state_for_task(&current)?
                .ok_or_else(|| "当前列表没有可用状态".to_string())?,
        };
        let mut progress = merged
            .get("progress")
            .and_then(Value::as_u64)
            .unwrap_or(current.progress as u64)
            .min(100);
        let group_of = |state: &State| StateGroup::parse(&state.group);
        let target_group: StateGroup = if status_was_explicit {
            // A legacy caller speaks only in `status` literals, so the literal
            // is authoritative for the group and the state row is re-derived
            // beneath it.
            legacy_status_to_group(&requested_status)
        } else if state_was_explicit {
            // The write named a state, so that state wins outright. An explicit
            // `progress` must not drag the task out of the group the caller
            // asked for.
            group_of(&requested_state).unwrap_or(StateGroup::Unstarted)
        } else {
            // Neither a state nor a `status` was named: only a progress write
            // can move the task, and only across the two boundaries the status
            // implementation reacted to.
            match group_of(&requested_state) {
                Some(StateGroup::Cancelled) => StateGroup::Cancelled,
                Some(StateGroup::Completed) => match progress {
                    100 => StateGroup::Completed,
                    _ if !progress_was_explicit => StateGroup::Completed,
                    _ => self
                        .resolve_state_in_group(&current, StateGroup::Started)?
                        .and_then(|state| group_of(&state))
                        .unwrap_or(StateGroup::Started),
                },
                Some(group) if progress == 100 => StateGroup::Completed,
                Some(group) if progress > 0 && group == StateGroup::Unstarted => {
                    StateGroup::Started
                }
                Some(group) => group,
                None if progress == 100 => StateGroup::Completed,
                None => StateGroup::Unstarted,
            }
        };
        let mut state = if group_of(&requested_state) == Some(target_group) {
            requested_state.clone()
        } else {
            self.resolve_state_in_group(&current, target_group)?
                .unwrap_or(requested_state.clone())
        };
        // Moving out of the completed group with no explicit progress resets
        // the mirror. Without this, reopening a done task would leave
        // progress=100 on an unstarted task, which then closes itself again.
        if target_group != StateGroup::Completed
            && Some(StateGroup::Completed) == group_of(&requested_state)
            && !progress_was_explicit
        {
            // No explicit progress: reopening a done task resets the mirror.
            progress = 0;
        } else if target_group != StateGroup::Completed && !progress_was_explicit {
            // Leaving the completed group by naming a state resets it too.
            progress = 0;
        }
        if status_was_explicit && requested_status == "abandoned" {
            state = self
                .resolve_state_in_group(&current, StateGroup::Cancelled)?
                .unwrap_or(state);
        }
        let final_group = group_of(&state)
            .unwrap_or_else(|| group_of(&requested_state).unwrap_or(StateGroup::Unstarted));
        // A task in the completed group always reports progress 100, which is
        // the invariant the status-only implementation maintained.
        if final_group == StateGroup::Completed {
            progress = 100;
        }
        merged["status"] = json!(final_group.legacy_status());
        merged["progress"] = json!(progress);
        if let Some(merged_map) = merged.as_object_mut() {
            self.stamp_state(merged_map, Some(&state));
        }
        if final_group == StateGroup::Cancelled {
            if current.state_group.as_deref() != Some("cancelled")
                || current.abandoned_at.is_none()
            {
                merged["abandonedAt"] = json!(Utc::now().to_rfc3339());
            }
        } else {
            merged["abandonedAt"] = Value::Null;
        }
        let task: Task = serde_json::from_value(merged.clone()).map_err(|e| e.to_string())?;
        validate_archived_task(&task)?;
        self.validate_task_parent(&task, operator)?;
        if let Some(project_id) = task.project_id.as_deref() {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == project_id)
                .ok_or_else(|| "项目不存在".to_string())?;
            let is_member = |user_id: &str| {
                project.created_by == user_id
                    || project.members.iter().any(|id| id == user_id)
                    || project.admins.iter().any(|id| id == user_id)
            };
            if !is_member(operator) {
                return Err("加入项目并通过管理员审批后才能修改为该项目的任务".into());
            }
            if !is_member(&task.assignee_id) {
                return Err("项目任务只能指派给项目成员".into());
            }
        }
        let assignee_changed = task.assignee_id != current.assignee_id;
        let mut operation_payload = safe_updates;
        if let Some(payload) = operation_payload.as_object_mut() {
            payload.insert("status".into(), json!(task.status));
            payload.insert("progress".into(), json!(task.progress));
            payload.insert("abandonedAt".into(), json!(task.abandoned_at));
            payload.insert("stateId".into(), json!(task.state_id));
            payload.insert("stateGroup".into(), json!(task.state_group));
            payload.insert("stateName".into(), json!(task.state_name));
        }
        if task.status != current.status {
            if let Some(payload) = operation_payload.as_object_mut() {
                payload.insert(
                    "_statusTransition".into(),
                    json!({"from": current.status, "to": task.status}),
                );
            }
        }
        self.conn.execute("UPDATE tasks SET payload_json=?,project_id=?,creator_id=?,assignee_id=?,updated_at=?,version=?,state_id=?,state_group=?,state_name=? WHERE workspace_id=active_workspace_id() AND id=?", params![merged.to_string(),task.project_id,task.creator_id,task.assignee_id,task.updated_at,task.version,task.state_id,task.state_group,task.state_name,id]).map_err(|e| e.to_string())?;
        self.log_operation(
            "task",
            id,
            "update",
            operation_payload,
            operator,
            task.project_id.as_deref(),
        )?;
        if assignee_changed {
            self.notify_task_assignment(&task, operator)?;
        }
        Ok(task)
    }

    pub fn update_task_with_recurrence(
        &self,
        id: &str,
        updates: Value,
        operator: &str,
        expected_version: Option<i64>,
    ) -> Result<TaskUpdateResult, String> {
        self.conn
            .execute_batch("SAVEPOINT task_with_recurrence")
            .map_err(|error| error.to_string())?;
        let result =
            self.update_task_with_recurrence_inner(id, updates, operator, expected_version);
        match result {
            Ok(result) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT task_with_recurrence")
                    .map_err(|error| error.to_string())?;
                Ok(result)
            }
            Err(error) => {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT task_with_recurrence; RELEASE SAVEPOINT task_with_recurrence",
                );
                Err(error)
            }
        }
    }

    fn update_task_with_recurrence_inner(
        &self,
        id: &str,
        updates: Value,
        operator: &str,
        expected_version: Option<i64>,
    ) -> Result<TaskUpdateResult, String> {
        let current = self
            .tasks(None)?
            .into_iter()
            .find(|task| task.id == id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if expected_version.is_some_and(|version| version != current.version) {
            return Err(format!(
                "任务版本冲突：当前版本为 {}，请重新读取任务后再更新",
                current.version
            ));
        }
        let should_spawn = current.status != "completed"
            && updates.get("status").and_then(Value::as_str) == Some("completed")
            && current
                .recurrence
                .as_deref()
                .is_some_and(|value| value != "none");
        let planned_next = if should_spawn {
            let mut predicted =
                serde_json::to_value(&current).map_err(|error| error.to_string())?;
            merge_json(&mut predicted, updates.clone());
            let predicted: Task = serde_json::from_value(predicted)
                .map_err(|error| format!("任务数据无效: {error}"))?;
            let next_due = next_recurrence_due(&predicted)
                .ok_or_else(|| "循环任务缺少有效的到期日期或循环规则".to_string())?;
            let next_reminder = next_reminder_time(&predicted, &next_due);
            Some((next_due, next_reminder))
        } else {
            None
        };
        let task = self.update_task(id, updates, operator)?;
        let next_task = if let Some((next_due, next_reminder)) = planned_next {
            let value = json!({
                "title": task.title.clone(),
                "description": crate::task_markdown::reset_checklist(&task.description),
                "priority": task.priority.clone(),
                "status": "todo",
                "progress": 0,
                "startDate": task.start_date.clone(),
                "dueDate": next_due,
                "reminderTime": next_reminder,
                "recurrence": task.recurrence.clone(),
                "recurrenceRule": task.recurrence_rule.clone(),
                "assigneeId": task.assignee_id.clone(),
                "projectId": task.project_id.clone(),
                "parentTaskId": task.parent_task_id.clone(),
                "contentMode": task.content_mode.clone(),
                "isShared": task.is_shared,
                "sharedWith": task.shared_with.clone(),
                "subtasks": task.subtasks.clone().into_iter().map(|mut subtask| {
                    subtask.completed = false;
                    subtask
                }).collect::<Vec<_>>(),
                "tags": task.tags.clone(),
                "attachments": task.attachments.clone(),
            });
            Some(self.create_task(value, operator)?)
        } else {
            None
        };
        Ok(TaskUpdateResult { task, next_task })
    }

    pub fn delete_task_and_detach_children(&self, id: &str, operator: &str) -> Result<bool, String> {
        self.conn.execute_batch("SAVEPOINT delete_task_family").map_err(|e| e.to_string())?;
        let result = (|| {
            let all = self.tasks(None)?;
            let parent = all.iter().find(|task| task.id == id).ok_or_else(|| "任务不存在".to_string())?;
            if !self.can_write_task(parent, operator) { return Err("没有删除该任务的权限".into()); }
            for child in all.iter().filter(|task| task.parent_task_id.as_deref() == Some(id)) {
                self.update_task(&child.id, json!({"parentTaskId": null}), operator)?;
            }
            self.delete_task(id, operator)
        })();
        match result {
            Ok(deleted) => { self.conn.execute_batch("RELEASE SAVEPOINT delete_task_family").map_err(|e| e.to_string())?; Ok(deleted) }
            Err(error) => { let _ = self.conn.execute_batch("ROLLBACK TO SAVEPOINT delete_task_family; RELEASE SAVEPOINT delete_task_family"); Err(error) }
        }
    }

    pub fn delete_task(&self, id: &str, operator: &str) -> Result<bool, String> {
        let task = self
            .tasks(None)?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !self.can_write_task(&task, operator) {
            return Err("没有删除该任务的权限".into());
        }
        self.conn
            .execute(
                "UPDATE tasks SET deleted=1,version=? WHERE workspace_id=active_workspace_id() AND id=?",
                params![self.next_clock()?, id],
            )
            .map_err(|e| e.to_string())?;
        self.log_operation(
            "task",
            id,
            "delete",
            json!({"id":id}),
            operator,
            task.project_id.as_deref(),
        )?;
        Ok(true)
    }

    pub(crate) fn log_operation(
        &self,
        entity_type: &str,
        entity_id: &str,
        action: &str,
        payload: Value,
        node_id: &str,
        scope_id: Option<&str>,
    ) -> Result<(), String> {
        let version = self.next_clock()?;
        let timestamp = Utc::now().to_rfc3339();
        let op = SyncOperation {
            id: format!("op-{}", Uuid::new_v4().simple()),
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
            action: action.into(),
            payload,
            timestamp,
            node_id: node_id.into(),
            version,
            scope_id: scope_id.map(str::to_owned),
            workspace_id: Some(self.workspace_context()?.workspace_id),
        };
        self.conn.execute("INSERT OR IGNORE INTO sync_operations(id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id) VALUES(?,?,?,?,?,?,?,?,?)", params![op.id,op.entity_type,op.entity_id,op.action,op.payload.to_string(),op.timestamp,op.node_id,op.version,op.scope_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn log_snapshot(&self, requested: Option<i64>) -> Result<i64, String> {
        let latest: i64 = self.conn.query_row("SELECT COALESCE(MAX(rowid),0) FROM sync_operations WHERE workspace_id=active_workspace_id() ", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        Ok(requested.unwrap_or(latest).clamp(0, latest))
    }

    pub fn sync_logs_page(&self, page: i64, page_size: i64, snapshot: Option<i64>) -> Result<models::SyncLogPage, String> {
        self.sync_logs_page_filtered(page, page_size, snapshot, None)
    }

    pub fn sync_logs_page_for_user(&self, page: i64, page_size: i64, snapshot: Option<i64>, user: &str) -> Result<models::SyncLogPage, String> {
        let ids: Vec<_> = self.audit_operations_for_user(user)?.into_iter().map(|op| op.id).collect();
        self.sync_logs_page_filtered(page, page_size, snapshot, Some(serde_json::to_string(&ids).map_err(|e| e.to_string())?))
    }

    fn sync_logs_page_filtered(&self, page: i64, page_size: i64, snapshot: Option<i64>, allowed: Option<String>) -> Result<models::SyncLogPage, String> {
        let snapshot = self.log_snapshot(snapshot)?;
        let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM sync_operations WHERE workspace_id=active_workspace_id() AND rowid<=? AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))", params![snapshot, allowed, allowed], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let page_size = page_size.clamp(1, 100);
        let page = page.clamp(1, ((total + page_size - 1) / page_size).max(1));
        let mut stmt = self.conn.prepare(
            "SELECT id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id,workspace_id
             FROM sync_operations WHERE workspace_id=active_workspace_id() AND rowid<=? AND (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY timestamp DESC,version DESC,id DESC LIMIT ? OFFSET ?"
        ).map_err(|error| error.to_string())?;
        let items = stmt.query_map(params![snapshot, allowed, allowed, page_size, (page - 1) * page_size], |row| {
            let payload: String = row.get(4)?;
            Ok(SyncOperation {
                id: row.get(0)?, entity_type: row.get(1)?, entity_id: row.get(2)?, action: row.get(3)?,
                payload: serde_json::from_str(&payload).unwrap_or(Value::Null), timestamp: row.get(5)?,
                node_id: row.get(6)?, version: row.get(7)?, scope_id: row.get(8)?, workspace_id: row.get(9)?,
            })
        }).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        let latest_version = self.setting("localClock")?.unwrap_or_else(|| "0".into()).parse().unwrap_or(0);
        Ok(models::SyncLogPage { records: models::RecordPage { items, total, page, page_size, snapshot }, latest_version })
    }

    pub fn sync_operations(&self, since: i64) -> Result<(Vec<SyncOperation>, i64), String> {
        let mut stmt = self.conn.prepare("SELECT id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id,workspace_id FROM sync_operations WHERE workspace_id=active_workspace_id() AND version>? ORDER BY version ASC").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since], |row| {
                let payload: String = row.get(4)?;
                Ok(SyncOperation {
                    id: row.get(0)?,
                    entity_type: row.get(1)?,
                    entity_id: row.get(2)?,
                    action: row.get(3)?,
                    payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                    timestamp: row.get(5)?,
                    node_id: row.get(6)?,
                    version: row.get(7)?,
                    scope_id: row.get(8)?, workspace_id: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let ops = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let latest = self
            .setting("localClock")?
            .unwrap_or_else(|| "0".into())
            .parse()
            .unwrap_or(0);
        Ok((ops, latest))
    }

    /// Audit views never include transport-only permission retractions.
    pub fn audit_operations_for_user(&self, user: &str) -> Result<Vec<SyncOperation>, String> {
        let tasks = self.task_visibility_index()?;
        Ok(self.sync_operations_for_user(user)?.into_iter().filter(|op| {
            if op.entity_type == "task" {
                return tasks.get(&op.entity_id).map(|t| self.can_read_task(t, user)).unwrap_or(op.node_id == user);
            }
            true
        }).collect())
    }

    pub fn sync_operations_for_user(&self, user_id: &str) -> Result<Vec<SyncOperation>, String> {
        let (operations, _) = self.sync_operations(0)?;
        let projects = self.projects(None)?;
        let groups = self.chat_groups().unwrap_or_default();
        let tasks = self.task_visibility_index()?;
        Ok(operations
            .into_iter()
            .filter(|operation| {
                if operation.entity_type=="wiki_document" { return self.require_wiki_read(&operation.entity_id,user_id).is_ok() && operation.scope_id.as_deref().is_none_or(|id| self.require_project_read(id,user_id).is_ok()); }

                if operation.entity_type == "task" {
                    let task = tasks
                        .get(&operation.entity_id)
                        .cloned()
                        .or_else(|| serde_json::from_value::<Task>(operation.payload.clone()).ok());
                    if operation.action == "update"
                        && operation.payload.get("isShared").and_then(Value::as_bool) == Some(false)
                    {
                        if let Some(scope_id) = operation.scope_id.as_deref() {
                            return projects
                                .iter()
                                .find(|project| project.id == scope_id)
                                .map(|project| {
                                    project.members.iter().any(|member| member == user_id)
                                        || project.admins.iter().any(|admin| admin == user_id)
                                })
                                .unwrap_or(false);
                        }
                    }
                    return task
                        .as_ref()
                        .map(|task| self.can_read_task(task, user_id))
                        .unwrap_or(operation.node_id == user_id);
                }
                if operation.entity_type == "chat_group" {
                    return groups.iter().find(|g| g.id == operation.entity_id)
                        .map(|g| g.member_ids.iter().any(|id| id == user_id))
                        .unwrap_or(operation.node_id == user_id)
                        || operation.payload.get("previousMemberIds").and_then(Value::as_array)
                            .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(user_id)));
                }
                if operation.entity_type == "task_assignment" {
                    return operation.payload.get("recipientId").and_then(Value::as_str)
                        == Some(user_id);
                }
                if operation.entity_type == "task_comment" {
                    let task_id = operation.payload.get("taskId").and_then(Value::as_str).map(str::to_owned).or_else(|| {
                        self.conn.query_row("SELECT task_id FROM task_comments WHERE workspace_id=active_workspace_id() AND id=?", params![operation.entity_id], |row| row.get::<_, String>(0)).optional().ok().flatten()
                    });
                    return task_id.as_deref().and_then(|id| tasks.get(id)).map(|task| self.can_read_task(task, user_id)).unwrap_or(operation.node_id == user_id);
                }
                if operation.entity_type == "chat_message" {
                    let receiver = operation.payload.get("receiverId").and_then(Value::as_str);
                    if receiver.is_some() {
                        return receiver == Some(user_id) || operation.node_id == user_id;
                    }
                    if let Some(group_id) = operation.payload.get("groupId").and_then(Value::as_str)
                    {
                        return groups
                            .iter()
                            .find(|group| group.id == group_id)
                            .map(|group| {
                                let is_group_member =
                                    group.member_ids.iter().any(|member| member == user_id);
                                let is_current_project_member = group
                                    .project_id
                                    .as_deref()
                                    .map(|project_id| {
                                        projects
                                            .iter()
                                            .find(|project| project.id == project_id)
                                            .map(|project| {
                                                project.created_by == user_id
                                                    || project
                                                        .members
                                                        .iter()
                                                        .any(|member| member == user_id)
                                                    || project
                                                        .admins
                                                        .iter()
                                                        .any(|admin| admin == user_id)
                                            })
                                            .unwrap_or(false)
                                    })
                                    .unwrap_or(true);
                                is_group_member && is_current_project_member
                            })
                            .unwrap_or(false);
                    }
                    return true;
                }
                if operation.entity_type == "group_announcement" {
                    let group_id = operation
                        .payload
                        .get("groupId")
                        .or_else(|| operation.payload.get("group_id"))
                        .and_then(Value::as_str);
                    return group_id
                        .and_then(|group_id| groups.iter().find(|group| group.id == group_id))
                        .map(|group| {
                            let is_group_member =
                                group.member_ids.iter().any(|member| member == user_id);
                            let is_current_project_member = group
                                .project_id
                                .as_deref()
                                .map(|project_id| {
                                    projects
                                        .iter()
                                        .find(|project| project.id == project_id)
                                        .map(|project| {
                                            project.created_by == user_id
                                                || project
                                                    .members
                                                    .iter()
                                                    .any(|member| member == user_id)
                                                || project
                                                    .admins
                                                    .iter()
                                                    .any(|admin| admin == user_id)
                                        })
                                        .unwrap_or(false)
                                })
                                .unwrap_or(true);
                            is_group_member && is_current_project_member
                        })
                        .unwrap_or(false);
                }
                // These arms must stay ahead of the generic `scope_id`
                // fallback below: that fallback passes an operation through to
                // everyone when `scope_id` names a project the receiving node
                // has not joined, which is a leak once workspace-scoped
                // operations start carrying `scope_id`.
                if operation.entity_type == "state" {
                    let is_member = |project_id: &str| {
                        projects
                            .iter()
                            .find(|project| project.id == project_id)
                            .map(|project| {
                                project.created_by == user_id
                                    || project.members.iter().any(|member| member == user_id)
                                    || project.admins.iter().any(|admin| admin == user_id)
                            })
                            .unwrap_or(false)
                    };
                    if let Some(project_id) = operation
                        .payload
                        .get("projectId")
                        .and_then(Value::as_str)
                    {
                        return is_member(project_id);
                    }
                    // Personal state lists are owned by one user.
                    return operation
                        .payload
                        .get("ownerId")
                        .and_then(Value::as_str)
                        .map(|owner| owner == user_id)
                        .unwrap_or(operation.node_id == user_id);
                }
                if operation.entity_type == "workspace" {
                    // Only the local workspace exists on this device, and its
                    // membership list gates who may see the record.
                    return self
                        .workspace_row()
                        .ok()
                        .flatten()
                        .map(|workspace| {
                            workspace.owner_id == user_id
                                || self
                                    .workspace_members(&workspace.id)
                                    .map(|members| {
                                        members.iter().any(|member| {
                                            member.user_id == user_id
                                                && member.status == "member"
                                        })
                                    })
                                    .unwrap_or(false)
                        })
                        .unwrap_or(false);
                }
                if operation.entity_type == "workspace_member" {
                    return operation
                        .payload
                        .get("userId")
                        .and_then(Value::as_str)
                        .map(|member| member == user_id)
                        .unwrap_or(operation.node_id == user_id);
                }
                if operation.entity_type == "workspace_join_request" {
                    // Workspace control history stays on its workspace channel;
                    // it is visible to the requester and administrators.
                    if operation
                        .payload
                        .get("userId")
                        .and_then(Value::as_str)
                        == Some(user_id)
                    {
                        return true;
                    }
                    return self
                        .workspace_row()
                        .ok()
                        .flatten()
                        .map(|workspace| {
                            workspace.owner_id == user_id
                                || self
                                    .workspace_members(&workspace.id)
                                    .map(|members| {
                                        members.iter().any(|member| {
                                            member.user_id == user_id
                                                && matches!(member.role.as_str(), "owner" | "admin")
                                        })
                                    })
                                    .unwrap_or(false)
                        })
                        .unwrap_or(false);
                }
                if let Some(scope_id) = operation.scope_id.as_deref() {
                    return projects
                        .iter()
                        .find(|project| project.id == scope_id)
                        .map(|project| {
                            project.members.iter().any(|member| member == user_id)
                                || project.admins.iter().any(|admin| admin == user_id)
                                || (operation.entity_type == "project"
                                    && operation
                                        .payload
                                        .get("previousMemberIds")
                                        .and_then(Value::as_array)
                                        .map(|members| {
                                            members
                                                .iter()
                                                .any(|member| member.as_str() == Some(user_id))
                                        })
                                        .unwrap_or(false))
                        })
                        .unwrap_or(false);
                }
                true
            })
            .map(|mut operation| {
                // Revocation reaches former readers without disclosing new private fields.
                if operation.entity_type == "task" && operation.action == "update"
                    && operation.payload.get("isShared").and_then(Value::as_bool) == Some(false)
                    && tasks.get(&operation.entity_id).is_some_and(|t| !self.can_read_task(t, user_id)) {
                    operation.payload = json!({"id":operation.entity_id,"workspaceId":operation.workspace_id,"isShared":false,"sharedWith":[]});
                }
                operation
            })
            .collect())
    }

    pub fn lan_operations_for_user(&self, user_id: &str) -> Result<Vec<SyncOperation>, String> {
        Ok(self
            .sync_operations_for_user(user_id)?
            .into_iter()
            .filter(|operation| match operation.entity_type.as_str() {
                "project"
                | "task"
                | "task_comment"
                | "task_assignment"
                | "user_profile"
                | "chat_message"
                | "group_announcement"
                // Legacy selection helper; public LAN transport rejects all business operations.
                | "workspace_join_request" => true,
                "chat_group" => serde_json::from_value::<ChatGroup>(operation.payload.clone())
                    .map(Self::normalize_chat_group)
                    .map(|group| {
                        group.member_ids.iter().any(|member| member == user_id)
                            || operation
                                .payload
                                .get("previousMemberIds")
                                .and_then(Value::as_array)
                                .map(|members| {
                                    members
                                        .iter()
                                        .any(|member| member.as_str() == Some(user_id))
                                })
                                .unwrap_or(false)
                            || operation.node_id == user_id
                    })
                    .unwrap_or(operation.node_id == user_id),
                _ => false,
            })
            .collect())
    }

    pub fn apply_operation(&self, op: &SyncOperation) -> Result<bool, String> {
        self.conn.execute_batch("SAVEPOINT apply_workspace_operation").map_err(|e| e.to_string())?;
        let result=self.apply_workspace_operation_inner(op);
        if result.is_ok() { self.conn.execute_batch("RELEASE apply_workspace_operation").map_err(|e| e.to_string())?; }
        else { let _=self.conn.execute_batch("ROLLBACK TO apply_workspace_operation; RELEASE apply_workspace_operation"); }
        result
    }
    fn apply_workspace_operation_inner(&self, op: &SyncOperation) -> Result<bool, String> {
        if op.payload.get("workspaceId").and_then(Value::as_str).is_some_and(|ws| Some(ws) != op.workspace_id.as_deref()) {
            return Err("同步载荷与操作的工作区不一致".into());
        }
        if op.workspace_id.as_deref() != Some(self.workspace_context()?.workspace_id.as_str()) { return Err("拒绝其他工作区的同步操作".into()); }
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_operations WHERE workspace_id=active_workspace_id() AND id=?)",
                params![op.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            return Ok(false);
        }
        match (op.entity_type.as_str(), op.action.as_str()) {
            ("wiki_document", "create" | "update" | "delete") => self.apply_wiki_operation(op)?,
            ("task", "create") => {
                let existing_task = self
                    .conn
                    .query_row(
                        "SELECT version, deleted FROM tasks WHERE workspace_id=active_workspace_id() AND id=?",
                        params![op.entity_id],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?)),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                if existing_task.is_none()
                    || existing_task
                        .is_some_and(|(version, deleted)| deleted && version < op.version)
                {
                    let mut payload = op.payload.clone();
                    if existing_task.is_some() {
                        payload["version"] = json!(op.version);
                    }
                    self.fill_task_state_from_payload(&mut payload)?;
                    let _ = self.insert_task_value(&payload, false)?;
                }
            }
            ("task", "update") => {
                if let Some(current) = self.tasks(None)?.into_iter().find(|t| t.id == op.entity_id)
                {
                    let mut merged = serde_json::to_value(current).map_err(|e| e.to_string())?;
                    let mut task_updates = op.payload.clone();
                    if let Some(payload) = task_updates.as_object_mut() {
                        payload.remove("_statusTransition");
                    }
                    merge_json(&mut merged, task_updates);
                    merged["version"] = json!(op.version);
                    let task: Task =
                        serde_json::from_value(merged.clone()).map_err(|e| e.to_string())?;
                    self.conn.execute("UPDATE tasks SET payload_json=?,project_id=?,creator_id=?,assignee_id=?,updated_at=?,version=?,state_id=?,state_group=?,state_name=? WHERE workspace_id=active_workspace_id() AND id=? AND version<?", params![merged.to_string(),task.project_id,task.creator_id,task.assignee_id,task.updated_at,op.version,task.state_id,task.state_group,task.state_name,op.entity_id,op.version]).map_err(|e| e.to_string())?;
                }
            }
            ("task", "delete") => {
                self.conn
                    .execute(
                        "UPDATE tasks SET deleted=1,version=? WHERE workspace_id=active_workspace_id() AND id=? AND version<?",
                        params![op.version, op.entity_id, op.version],
                    )
                    .map_err(|e| e.to_string())?;
            }
            ("task_comment", "create") => {
                let comment: TaskComment = serde_json::from_value(op.payload.clone()).map_err(|error| format!("任务评论无效: {error}"))?;
                if comment.id != op.entity_id { return Err("任务评论身份校验失败".into()); }
                let task = self.tasks(None)?.into_iter().find(|task| task.id == comment.task_id).ok_or_else(|| "评论所属任务不存在".to_string())?;
                if !self.can_read_task(&task, &comment.author_id) { return Err("任务评论权限校验失败".into()); }
                self.conn.execute("INSERT OR IGNORE INTO task_comments(id,task_id,payload_json,author_id,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,0)", params![comment.id, comment.task_id, op.payload.to_string(), comment.author_id, comment.created_at, comment.updated_at]).map_err(|error| error.to_string())?;
            }
            ("task_comment", "update") => {
                let comment: TaskComment = serde_json::from_value(op.payload.clone()).map_err(|error| format!("任务评论无效: {error}"))?;
                self.conn.execute("UPDATE task_comments SET payload_json=?,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?", params![op.payload.to_string(), comment.updated_at, op.entity_id]).map_err(|error| error.to_string())?;
            }
            ("task_comment", "delete") => {
                self.conn.execute("UPDATE task_comments SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![op.entity_id]).map_err(|error| error.to_string())?;
            }
            ("task_assignment", "create") => {
                let notification: TaskAssignmentNotification =
                    serde_json::from_value(op.payload.clone())
                        .map_err(|error| format!("任务指派通知无效: {error}"))?;
                if notification.id != op.entity_id {
                    return Err("任务指派通知身份校验失败".into());
                }
                if self.current_user_id()?.as_str() != notification.recipient_id {
                    return Err("任务指派通知收件人不匹配".into());
                }
                self.insert_task_assignment_notification(&notification, false)?;
            }
            ("project", "create") => {
                let project: Project =
                    serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                if project.created_by != op.node_id {
                    return Err("项目创建者身份校验失败".into());
                }
                self.insert_project(&project, false)?;
            }
            ("project", "update") => {
                if let Some(mut project) = self
                    .projects(None)?
                    .into_iter()
                    .find(|p| p.id == op.entity_id)
                {
                    if project.created_by != op.node_id
                        && !project.admins.iter().any(|admin| admin == &op.node_id)
                    {
                        return Err("只有项目管理员可以修改项目".into());
                    }
                    let mut merged = serde_json::to_value(&project).map_err(|e| e.to_string())?;
                    let mut updates = op.payload.clone();
                    if let Some(updates) = updates.as_object_mut() {
                        updates.remove("id");
                        updates.remove("createdBy");
                        updates.remove("createdAt");
                    }
                    merge_json(&mut merged, updates);
                    project = serde_json::from_value(merged).map_err(|e| e.to_string())?;
                    self.insert_project(&project, false)?;
                }
            }
            ("project", "transfer") => {
                let transferred: Project = serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                let previous_creator = op
                    .payload
                    .get("previousCreatorId")
                    .and_then(Value::as_str)
                    .unwrap_or(&op.node_id);
                if previous_creator != op.node_id || transferred.created_by == op.node_id {
                    return Err("项目转让身份校验失败".into());
                }
                let current = self
                    .projects(None)?
                    .into_iter()
                    .find(|project| project.id == op.entity_id)
                    .ok_or_else(|| "项目转让目标项目不存在".to_string())?;
                if current.created_by != op.node_id
                    || !transferred.members.iter().any(|member| member == &transferred.created_by)
                {
                    return Err("项目转让目标或原创建者校验失败".into());
                }
                self.insert_project(&transferred, false)?;
            }
            ("project", "delete") => {
                let creator_id = self
                    .conn
                    .query_row(
                        "SELECT created_by FROM projects WHERE workspace_id=active_workspace_id() AND id=?",
                        params![op.entity_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                if creator_id.as_deref() != Some(op.node_id.as_str()) {
                    return Err("只有项目创建者可以删除项目".into());
                }
                self.conn
                    .execute(
                        "UPDATE projects SET deleted=1,updated_at=? WHERE workspace_id=active_workspace_id() AND id=?",
                        params![op.timestamp, op.entity_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            ("user_profile", "update") => {
                let mut user: User = serde_json::from_value(op.payload.clone())
                    .map_err(|error| format!("节点资料无效: {error}"))?;
                if user.id != op.entity_id || user.id != op.node_id {
                    return Err("节点资料身份校验失败".into());
                }
                if self.current_user_id().ok().as_deref() != Some(user.id.as_str()) {
                    user.role = "user".into();
                    user.is_online = false;
                    self.upsert_user(&user)?;
                }
            }
            ("chat_message", "create") => {
                let _ = self.save_chat_message_internal(op.payload.clone(), false)?;
            }
            ("chat_group", "create") | ("chat_group", "update") | ("chat_group", "transfer") => {
                let _ = self.save_chat_group_internal(op.payload.clone(), false)?;
            }
            ("chat_group", "delete") => {
                let _ = self.conn.execute("DELETE FROM chat_groups WHERE workspace_id=active_workspace_id() AND id=?", params![op.entity_id]);
                let _ = self.conn.execute("DELETE FROM group_announcements WHERE workspace_id=active_workspace_id() AND group_id=?", params![op.entity_id]);
            }
            ("group_announcement", "create") | ("group_announcement", "update") => {
                let _ = self.save_group_announcement_internal(op.payload.clone(), false, op.scope_id.as_deref())?;
            }
            ("group_announcement", "delete") => {
                let _ = self.conn.execute("DELETE FROM group_announcements WHERE workspace_id=active_workspace_id() AND id=?", params![op.entity_id]);
            }
            ("state", "create") | ("state", "update") => {
                let state: State =
                    serde_json::from_value(op.payload.clone()).map_err(|error| error.to_string())?;
                self.insert_state(&state, false)?;
            }
            ("state", "delete") => {
                self.conn
                    .execute(
                        "UPDATE states SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?",
                        params![op.entity_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            ("state", "reorder") => {
                let ids = op
                    .payload
                    .get("ids")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for (sequence, id) in ids.iter().enumerate() {
                    if let Some(id) = id.as_str() {
                        let _ = self.conn.execute(
                            "UPDATE states SET sequence=? WHERE workspace_id=active_workspace_id() AND id=?",
                            params![sequence as i64, id],
                        );
                    }
                }
            }
            ("workspace", "update") => {
                let workspace: Workspace =
                    serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                self.conn
                    .execute(
                        "UPDATE workspaces SET name=?,logo=?,description=?,timezone=?,updated_at=? WHERE id=?",
                        params![
                            workspace.name,
                            workspace.logo,
                            workspace.description,
                            workspace.timezone,
                            workspace.updated_at,
                            op.entity_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            ("workspace_member", "create") => {
                let member: WorkspaceMember =
                    serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                if self.workspace_record()?.id != member.workspace_id {
                    // A member row for a different workspace cannot be stored in
                    // the single local workspace table.
                    return Err("工作区成员所属工作区与本机不一致".into());
                }
                self.insert_workspace_member(&member, false)?;
            }
            ("workspace_member", "update") => {
                let member: WorkspaceMember =
                    serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                if self.workspace_record()?.id != member.workspace_id {
                    return Err("工作区成员所属工作区与本机不一致".into());
                }
                let current_user_id = self.current_user_id()?;
                // The owning device keeps its own role; only the owner may be
                // recorded as an administrator by a third party.
                if member.user_id == current_user_id && member.role == "owner" {
                    return Err("本机用户的工作区角色不能由远端修改".into());
                }
                self.upsert_workspace_member(&member, false)?;
            }
            ("workspace_member", "delete") => {
                let current_user_id = self.current_user_id()?;
                if op.payload.get("userId").and_then(Value::as_str) == Some(current_user_id.as_str())
                {
                    return Err("不能移除本机用户的工作区成员记录".into());
                }
                self.conn
                    .execute(
                        "DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
                        params![
                            op.payload
                                .get("workspaceId")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                            op.payload.get("userId").and_then(Value::as_str).unwrap_or_default()
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            ("workspace_join_request", "create") => {
                let request: WorkspaceJoinRequest =
                    serde_json::from_value(op.payload.clone()).map_err(|e| e.to_string())?;
                if request.id != op.entity_id || request.user_id != op.node_id {
                    return Err("工作区加入申请身份校验失败".into());
                }
                self.conn
                    .execute(
                        "INSERT OR IGNORE INTO workspace_join_requests(id,workspace_id,workspace_name,user_id,user_name,status,requested_at,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?)",
                        params![
                            request.id,
                            request.workspace_id,
                            request.workspace_name,
                            request.user_id,
                            request.user_name,
                            request.status,
                            request.requested_at,
                            request.reviewed_at,
                            request.reviewed_by
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            ("project_file", "create") => {
                if let Ok(file) = serde_json::from_value::<ProjectFileRecord>(op.payload.clone()) {
                    let _ = self.insert_project_file(&file, false);
                }
            }
            ("project_file", "delete") => {
                let _ = self.conn.execute("UPDATE project_files SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![op.entity_id]);
            }
            ("project_folder", "create") => {
                if let Ok(folder) = serde_json::from_value::<ProjectFolderRecord>(op.payload.clone()) {
                    let _ = self.insert_project_folder(&folder, false);
                }
            }
            ("project_folder", "delete") => {
                if let Some(path) = op.payload.get("path").and_then(|value| value.as_str()) {
                    let prefix = format!("{}{}", path.trim_end_matches('/'), "/%");
                    let _ = self.conn.execute(
                        "UPDATE project_files SET deleted=1 WHERE workspace_id=active_workspace_id() AND project_id=? AND deleted=0 AND (relative_path=? OR relative_path LIKE ?)",
                        params![op.scope_id.as_deref().unwrap_or_default(), path, prefix],
                    );
                }
                let _ = self.conn.execute("UPDATE project_folders SET deleted=1 WHERE workspace_id=active_workspace_id() AND id=?", params![op.entity_id]);
            }
            _ => {}
        }
        self.conn.execute("INSERT OR IGNORE INTO sync_operations(id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id) VALUES(?,?,?,?,?,?,?,?,?)", params![op.id,op.entity_type,op.entity_id,op.action,op.payload.to_string(),op.timestamp,op.node_id,op.version,op.scope_id]).map_err(|e| e.to_string())?;
        let current: i64 = self
            .setting("localClock")?
            .unwrap_or_else(|| "0".into())
            .parse()
            .unwrap_or(0);
        if op.version > current {
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES('localClock',?)",
                    params![op.version.to_string()],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(true)
    }

    pub fn risks(&self, user_id: Option<&str>) -> Result<Vec<RiskWarning>, String> {
        let tasks: Vec<Task> = self
            .tasks(user_id)?
            .into_iter()
            .filter(|task| {
                matches!(
                    Self::task_group(task),
                    StateGroup::Backlog | StateGroup::Unstarted | StateGroup::Started
                )
            })
            .collect();
        let now = Local::now();
        let today = now.format("%Y-%m-%d").to_string();
        let tomorrow = (now + Duration::days(1)).format("%Y-%m-%d").to_string();
        let mut warnings = Vec::new();
        let overdue: Vec<&Task> = tasks
            .iter()
            .filter(|t| {
                t.due_date
                    .as_deref()
                    .map(|d| d.get(..10).unwrap_or(d) < today.as_str())
                    .unwrap_or(false)
            })
            .collect();
        if !overdue.is_empty() {
            warnings.push(RiskWarning {
                id: "warn-overdue".into(),
                level: "high".into(),
                warning_type: "overdue".into(),
                title: format!("存在 {} 个逾期未完成任务", overdue.len()),
                description: format!(
                    "包括：{}",
                    overdue
                        .iter()
                        .take(3)
                        .map(|t| t.title.as_str())
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                related_task_ids: overdue.iter().map(|t| t.id.clone()).collect(),
                ai_recommendation: "优先更新任务进度，或重新安排截止日期。".into(),
            });
        }
        let blocked: Vec<&Task> = tasks
            .iter()
            .filter(|t| t.priority == "P1" && self.task_is_blocked(t))
            .collect();
        if !blocked.is_empty() {
            warnings.push(RiskWarning {
                id: "warn-p1-blocked".into(),
                level: "high".into(),
                warning_type: "unassigned_p1".into(),
                title: format!("有 {} 个 P1 任务处于阻塞状态", blocked.len()),
                description: blocked
                    .iter()
                    .map(|t| t.title.clone())
                    .collect::<Vec<_>>()
                    .join("、"),
                related_task_ids: blocked.iter().map(|t| t.id.clone()).collect(),
                ai_recommendation: "建议立即召集相关成员，解除任务依赖。".into(),
            });
        }
        let imminent: Vec<&Task> = tasks
            .iter()
            .filter(|t| {
                t.due_date
                    .as_deref()
                    .map(|d| {
                        let due_day = d.get(..10).unwrap_or(d);
                        due_day >= today.as_str() && due_day <= tomorrow.as_str()
                    })
                    .unwrap_or(false)
            })
            .collect();
        if !imminent.is_empty() {
            warnings.push(RiskWarning {
                id: "warn-imminent".into(),
                level: "medium".into(),
                warning_type: "imminent".into(),
                title: format!("未来 24 小时有 {} 个任务到期", imminent.len()),
                description: imminent
                    .iter()
                    .map(|t| t.title.clone())
                    .collect::<Vec<_>>()
                    .join("、"),
                related_task_ids: imminent.iter().map(|t| t.id.clone()).collect(),
                ai_recommendation: "优先处理临期任务，并检查其依赖项。".into(),
            });
        }
        Ok(warnings)
    }

    pub fn llm_config(&self) -> Result<LlmConfig, String> {
        let ctx=self.workspace_context()?;
        let binding: Option<String>=self.conn.query_row("SELECT payload_json FROM workspace_llm_bindings WHERE workspace_id=? AND user_id=?",params![ctx.workspace_id,ctx.user_id],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(raw)=binding {
            let mut value:Value=serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if let Some(connection)=value["connectionId"].as_str() {
                let secret:Option<String>=self.conn.query_row("SELECT payload_json FROM llm_connections WHERE user_id=? AND id=?",params![ctx.user_id,connection],|r| r.get(0)).optional().map_err(|e| e.to_string())?;
                value["apiKey"]=secret.and_then(|s| serde_json::from_str::<Value>(&s).ok()).map(|v| v["apiKey"].clone()).unwrap_or_else(|| json!(""));
            }
            return serde_json::from_value(value).map_err(|e| e.to_string());
        }
        if self.setting("workspaceOriginalId")?.as_deref()!=Some(ctx.workspace_id.as_str()) || self.setting("workspaceOriginalUserId")?.as_deref()!=Some(ctx.user_id.as_str()) {
            return Ok(LlmConfig { generation_parameters:None, protocol:"openai".into(),base_url:"https://api.openai.com/v1".into(),model_name:"gpt-4o-mini".into(),api_key:String::new() });
        }
        let raw: String = self
            .conn
            .query_row(
                "SELECT payload_json FROM llm_config WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut config: LlmConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if config.protocol != "openai" {
            config.protocol = "openai".into();
            self.conn
                .execute(
                    "UPDATE llm_config SET payload_json=? WHERE id=1",
                    params![serde_json::to_string(&config).map_err(|e| e.to_string())?],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(config)
    }
    pub fn save_llm_config(&self, value: Value) -> Result<LlmConfig, String> {
        let mut current = serde_json::to_value(self.llm_config()?).map_err(|e| e.to_string())?;
        merge_json(&mut current, value);
        current["protocol"] = json!("openai");
        let config: LlmConfig = serde_json::from_value(current).map_err(|e| e.to_string())?;
        let ctx=self.workspace_context()?;
        let connection=format!("connection-{}",Uuid::new_v4().simple());
        self.conn.execute("INSERT INTO llm_connections VALUES(?,?,?)",params![ctx.user_id,connection,json!({"apiKey":config.api_key}).to_string()]).map_err(|e| e.to_string())?;
        let mut binding=serde_json::to_value(&config).map_err(|e| e.to_string())?;
        binding["apiKey"]=json!(""); binding["connectionId"]=json!(connection);
        self.conn
            .execute(
                "INSERT OR REPLACE INTO workspace_llm_bindings(workspace_id,user_id,payload_json) VALUES(?,?,?)",
                params![ctx.workspace_id,ctx.user_id,binding.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(config)
    }
    pub fn templates(&self) -> Result<Vec<Value>, String> {
        let mut stmt=self.conn.prepare("SELECT payload_json FROM ppt_templates WHERE id IN ('tpl-executive','tpl-business','tpl-tech','tpl-minimal') UNION ALL SELECT payload_json FROM workspace_templates WHERE workspace_id=active_workspace_id()").map_err(|e| e.to_string())?;
        let result=stmt.query_map([],|row| row.get::<_,String>(0)).map_err(|e| e.to_string())?.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect();
        result
    }
    pub fn add_template(&self,value:Value)->Result<Value,String> {
        let id=value["id"].as_str().ok_or("模板 ID 不能为空")?;
        if ["tpl-executive","tpl-business","tpl-tech","tpl-minimal"].contains(&id) { return Err("内置模板为只读，请另存为自定义模板".into()); }
        self.conn.execute("INSERT OR REPLACE INTO workspace_templates VALUES(?,?,?)",params![self.workspace_context()?.workspace_id,id,value.to_string()]).map_err(|e| e.to_string())?;
        Ok(value)
    }

    fn all_task_operations(&self) -> Result<Vec<SyncOperation>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id,workspace_id FROM sync_operations WHERE workspace_id=active_workspace_id() AND entity_type='task' ORDER BY version ASC")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let payload: String = row.get(4)?;
                Ok(SyncOperation {
                    id: row.get(0)?,
                    entity_type: row.get(1)?,
                    entity_id: row.get(2)?,
                    action: row.get(3)?,
                    payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                    timestamp: row.get(5)?,
                    node_id: row.get(6)?,
                    version: row.get(7)?,
                    scope_id: row.get(8)?, workspace_id: row.get(9)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn report_dataset(
        &self,
        project_id: Option<&str>,
        user_id: &str,
        start: NaiveDate,
        end: NaiveDate,
        as_of: NaiveDate,
    ) -> Result<ReportDataset, String> {
        let mut operations_by_task: HashMap<String, Vec<SyncOperation>> = HashMap::new();
        for operation in self.all_task_operations()? {
            operations_by_task
                .entry(operation.entity_id.clone())
                .or_default()
                .push(operation);
        }

        let mut records = Vec::new();
        let mut used_fallback_dates = false;
        for task in self.tasks(Some(user_id))? {
            if task.parent_task_id.is_some() {
                continue;
            }
            // Abandoned tasks are discarded/cancelled and should not appear in work reports.
            if Self::task_group(&task) == StateGroup::Cancelled {
                continue;
            }
            let is_personal_scope = task.creator_id == user_id
                || task.assignee_id == user_id
                || task.shared_with.iter().any(|id| id == user_id);
            if !is_personal_scope
                || project_id
                    .map(|id| task.project_id.as_deref() != Some(id))
                    .unwrap_or(false)
            {
                continue;
            }

            let operations = operations_by_task
                .get(&task.id)
                .cloned()
                .unwrap_or_default();
            let create_operation = operations
                .iter()
                .find(|operation| operation.action == "create");
            let created_day = create_operation
                .and_then(|operation| report_local_date(&operation.timestamp))
                .or_else(|| report_local_date(&task.created_at));
            if created_day.map(|date| date > as_of).unwrap_or(false) {
                continue;
            }
            // Historical payloads keep their original literal `status` strings
            // forever, so replay has to translate on read rather than the
            // stored operations being rewritten.
            let mut status = create_operation
                .and_then(|operation| operation.payload.get("status"))
                .and_then(Value::as_str)
                .map(|status| legacy_status_to_group(status).legacy_status().to_string())
                .unwrap_or_else(|| task.status.clone());
            let mut due_date = create_operation
                .and_then(|operation| operation.payload.get("dueDate"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| task.due_date.clone());
            let mut completed_subtask_count = create_operation
                .map(|operation| completed_subtasks(&operation.payload))
                .unwrap_or_else(|| {
                    task.subtasks
                        .iter()
                        .filter(|subtask| subtask.completed)
                        .count()
                });
            let mut status_as_of_name = create_operation
                .and_then(|operation| operation.payload.get("stateName"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| self.state_name_for_task(&task));
            let mut event_notes = Vec::new();
            let mut created_in_period = false;
            let mut completed_event_in_period = false;
            let mut progressed_in_period = false;
            let mut schedule_slipped = false;

            if create_operation.is_none() {
                used_fallback_dates = true;
                created_in_period = report_local_date(&task.created_at)
                    .map(|date| date >= start && date <= as_of)
                    .unwrap_or(false);
                if report_local_date(&task.updated_at)
                    .map(|date| date >= start && date <= as_of)
                    .unwrap_or(false)
                {
                    if task.status == "completed" {
                        completed_event_in_period = true;
                    } else if !created_in_period {
                        progressed_in_period = true;
                    }
                }
            } else {
                for operation in operations {
                    let Some(event_date) = report_local_date(&operation.timestamp) else {
                        continue;
                    };
                    if event_date > as_of {
                        continue;
                    }
                    let in_actual_period = event_date >= start && event_date <= as_of;
                    if operation.action == "create" {
                        if in_actual_period {
                            created_in_period = true;
                            event_notes.push("本周期创建任务".into());
                        }
                        continue;
                    }
                    if operation.action != "update" {
                        continue;
                    }

                    if let Some(next_status) = operation
                        .payload
                        .get("status")
                        .and_then(Value::as_str)
                        .map(|status| legacy_status_to_group(status).legacy_status())
                    {
                        if next_status != status {
                            if in_actual_period {
                                progressed_in_period = true;
                                event_notes.push(format!("状态由 {status} 变更为 {next_status}"));
                                if next_status == "completed" {
                                    completed_event_in_period = true;
                                }
                            }
                            status = next_status.to_string();
                        }
                        if let Some(next_name) = operation
                            .payload
                            .get("stateName")
                            .and_then(Value::as_str)
                        {
                            status_as_of_name = next_name.to_string();
                        } else if next_status == "in_progress" {
                            // Pre-migration payloads cannot distinguish
                            // `Blocked` from `In Progress`; the group is all
                            // that survives, so the task leaves the blocked
                            // set once it reports a plain started transition.
                            status_as_of_name = "In Progress".into();
                        }
                    }

                    if operation.payload.get("subtasks").is_some() {
                        let next_count = completed_subtasks(&operation.payload);
                        if in_actual_period && next_count > completed_subtask_count {
                            progressed_in_period = true;
                            event_notes.push(format!(
                                "完成 {} 个子任务",
                                next_count - completed_subtask_count
                            ));
                        }
                        completed_subtask_count = next_count;
                    }

                    if operation.payload.get("dueDate").is_some() {
                        let next_due_date = operation
                            .payload
                            .get("dueDate")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        if in_actual_period
                            && next_due_date.as_deref().and_then(report_local_date)
                                > due_date.as_deref().and_then(report_local_date)
                        {
                            schedule_slipped = true;
                            event_notes.push("截止日期后移".into());
                        }
                        due_date = next_due_date;
                    }
                }
            }

            let due_day = due_date.as_deref().and_then(report_local_date);
            let completed_in_period = completed_event_in_period && status == "completed";
            if completed_in_period {
                progressed_in_period = false;
            }
            // Name-based, not group-based: `Blocked` and `In Progress` share the
            // `started` group, so the payload's state name has to be consulted
            // instead of the normalized group.
            let blocked_as_of = status_as_of_name == "Blocked";
            let overdue_as_of =
                status != "completed" && due_day.map(|date| date < as_of).unwrap_or(false);
            let due_in_actual = status != "completed"
                && due_day
                    .map(|date| date >= start && date <= as_of)
                    .unwrap_or(false);
            let upcoming_in_period = status != "completed"
                && due_day
                    .map(|date| date > as_of && date <= end)
                    .unwrap_or(false);
            let actual_relevant = (created_in_period && !upcoming_in_period)
                || completed_in_period
                || progressed_in_period
                || due_in_actual
                || overdue_as_of
                || blocked_as_of;
            if !actual_relevant && !upcoming_in_period {
                continue;
            }

            records.push(ReportTaskRecord {
                task,
                status_as_of: status,
                due_date_as_of: due_date,
                created_in_period,
                completed_in_period,
                progressed_in_period,
                blocked_as_of,
                overdue_as_of,
                upcoming_in_period,
                schedule_slipped,
                event_notes,
            });
        }

        let actual_records = records
            .iter()
            .filter(|record| {
                (record.created_in_period && !record.upcoming_in_period)
                    || record.completed_in_period
                    || record.progressed_in_period
                    || record.overdue_as_of
                    || record.blocked_as_of
                    || record
                        .due_date_as_of
                        .as_deref()
                        .and_then(report_local_date)
                        .map(|date| date >= start && date <= as_of)
                        .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        let completed_tasks_count = actual_records
            .iter()
            .filter(|record| record.completed_in_period)
            .count();
        let progressed_tasks_count = actual_records
            .iter()
            .filter(|record| record.progressed_in_period)
            .count();
        let blocked_tasks_count = actual_records
            .iter()
            .filter(|record| record.blocked_as_of)
            .count();
        let pending_tasks_count = actual_records
            .iter()
            .filter(|record| matches!(record.status_as_of.as_str(), "todo" | "in_progress"))
            .count();
        let overdue_tasks_count = actual_records
            .iter()
            .filter(|record| record.overdue_as_of)
            .count();
        let upcoming_tasks_count = records
            .iter()
            .filter(|record| record.upcoming_in_period)
            .count();
        let relevant_tasks_count = actual_records.len();

        let mut data_notes = Vec::new();
        if used_fallback_dates {
            data_notes
                .push("部分历史任务缺少完整状态事件，已按创建时间和最后更新时间保守估算。".into());
        }
        Ok(ReportDataset {
            records,
            metrics: ReportMetrics {
                relevant_tasks_count,
                completed_tasks_count,
                progressed_tasks_count,
                pending_tasks_count,
                blocked_tasks_count,
                overdue_tasks_count,
                upcoming_tasks_count,
            },
            data_notes,
        })
    }

    pub fn chat_messages(
        &self,
        current_user: &str,
        _target: Option<&str>,
    ) -> Result<Vec<ChatMessage>, String> {
        let visible_group_ids = self
            .chat_groups_for_user(current_user)?
            .into_iter()
            .map(|group| group.id)
            .collect::<Vec<_>>();
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM chat_messages WHERE workspace_id=active_workspace_id()  ORDER BY timestamp ASC LIMIT 5000")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut output = Vec::new();
        for raw in rows {
            let msg: ChatMessage = serde_json::from_str(&raw.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if let Some(group_id) = msg.group_id.as_deref() {
                if visible_group_ids.iter().any(|id| id == group_id) {
                    output.push(msg);
                }
                continue;
            }
            if msg.sender_id == current_user
                || msg.receiver_id.as_deref() == Some(current_user)
                || msg.receiver_id.is_none()
            {
                output.push(msg);
            }
        }
        Ok(output)
    }

    pub fn can_read_chat_file(&self, transfer_id: &str, user: &str) -> Result<bool, String> {
        self.require_workspace_member(user)?;
        let mut stmt = self.conn.prepare("SELECT payload_json FROM chat_messages WHERE workspace_id=active_workspace_id() AND json_extract(payload_json,'$.fileUrl') LIKE ?").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![format!("%/{transfer_id}")], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for row in rows {
            let msg: ChatMessage = serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            if let Some(group) = msg.group_id.as_deref() {
                if self.chat_groups_for_user(user)?.iter().any(|g| g.id == group) { return Ok(true); }
            } else if msg.receiver_id.is_none() || msg.sender_id == user || msg.receiver_id.as_deref() == Some(user) { return Ok(true); }
        }
        Ok(false)
    }

    pub fn chat_message_page(
        &self,
        current_user: &str,
        conversation_type: &str,
        target_id: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<models::ChatMessagePage, String> {
        let page_size = limit.clamp(1, 100);
        let mut where_sql = String::from("1=1");
        let mut values: Vec<String> = Vec::new();
        match conversation_type {
            "group" => {
                let group_id = target_id.ok_or_else(|| "缺少群组 ID".to_string())?;
                let visible = self
                    .chat_groups_for_user(current_user)?
                    .into_iter()
                    .any(|group| group.id == group_id);
                if !visible {
                    return Ok(models::ChatMessagePage {
                        messages: Vec::new(),
                        has_more: false,
                        next_cursor: None,
                    });
                }
                where_sql.push_str(" AND group_id = ?");
                values.push(group_id.to_string());
            }
            "user" => {
                let peer_id = target_id.ok_or_else(|| "缺少用户 ID".to_string())?;
                where_sql.push_str(
                    " AND group_id IS NULL AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))",
                );
                values.extend([
                    current_user.to_string(),
                    peer_id.to_string(),
                    peer_id.to_string(),
                    current_user.to_string(),
                ]);
            }
            "broadcast" => {
                where_sql.push_str(" AND group_id IS NULL AND receiver_id IS NULL");
            }
            _ => return Err("未知聊天会话类型".to_string()),
        }

        if let Some((timestamp, id)) = cursor.and_then(|value| value.split_once('|')) {
            where_sql.push_str(" AND (timestamp < ? OR (timestamp = ? AND id < ?))");
            values.push(timestamp.to_string());
            values.push(timestamp.to_string());
            values.push(id.to_string());
        }

        let query = format!(
            "SELECT id, timestamp, payload_json FROM chat_messages WHERE workspace_id=active_workspace_id() AND {where_sql} ORDER BY timestamp DESC, id DESC LIMIT ?"
        );
        let mut stmt = self.conn.prepare(&query).map_err(|e| e.to_string())?;
        let mut params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let fetch_limit = page_size.saturating_add(1) as i64;
        params.push(&fetch_limit);
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut raw_rows = Vec::new();
        for row in rows {
            raw_rows.push(row.map_err(|e| e.to_string())?);
        }
        let has_more = raw_rows.len() > page_size;
        raw_rows.truncate(page_size);
        let next_cursor = if has_more {
            raw_rows
                .last()
                .map(|(id, timestamp, _)| format!("{timestamp}|{id}"))
        } else {
            None
        };
        let mut messages = raw_rows
            .into_iter()
            .map(|(_, _, payload)| serde_json::from_str::<ChatMessage>(&payload).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        messages.reverse();
        Ok(models::ChatMessagePage {
            messages,
            has_more,
            next_cursor,
        })
    }

    fn chat_message_matches_conversation(
        msg: &ChatMessage,
        current_user: &str,
        conversation_type: &str,
        target_id: Option<&str>,
    ) -> bool {
        match conversation_type {
            "group" => msg.group_id.as_deref() == target_id,
            "user" => {
                let Some(peer_id) = target_id else { return false };
                msg.group_id.is_none()
                    && ((msg.sender_id == current_user && msg.receiver_id.as_deref() == Some(peer_id))
                        || (msg.sender_id == peer_id && msg.receiver_id.as_deref() == Some(current_user)))
            }
            "broadcast" => msg.group_id.is_none() && msg.receiver_id.is_none(),
            _ => false,
        }
    }

    fn all_visible_chat_messages(&self, current_user: &str) -> Result<Vec<ChatMessage>, String> {
        let visible_group_ids = self
            .chat_groups_for_user(current_user)?
            .into_iter()
            .map(|group| group.id)
            .collect::<HashSet<_>>();
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM chat_messages WHERE workspace_id=active_workspace_id()  ORDER BY timestamp ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut output = Vec::new();
        for raw in rows {
            let msg: ChatMessage = serde_json::from_str(&raw.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if let Some(group_id) = msg.group_id.as_deref() {
                if visible_group_ids.contains(group_id) {
                    output.push(msg);
                }
                continue;
            }
            if msg.sender_id == current_user
                || msg.receiver_id.as_deref() == Some(current_user)
                || msg.receiver_id.is_none()
            {
                output.push(msg);
            }
        }
        Ok(output)
    }

    pub fn chat_unread_summaries(
        &self,
        current_user: &str,
    ) -> Result<Vec<models::ChatUnreadSummary>, String> {
        let messages = self.all_visible_chat_messages(current_user)?;
        let groups = self
            .chat_groups_for_user(current_user)?
            .into_iter()
            .map(|group| (group.id.clone(), group))
            .collect::<HashMap<_, _>>();
        let mut summaries: HashMap<String, models::ChatUnreadSummary> = HashMap::new();

        for message in messages {
            if message.sender_id == current_user || message.read_by.iter().any(|id| id == current_user) {
                continue;
            }

            let (key, conversation, name, avatar) = if let Some(group_id) = message.group_id.as_deref() {
                let group = groups.get(group_id);
                (
                    format!("group:{group_id}"),
                    models::ChatConversationRef::Group {
                        target_id: group_id.to_string(),
                    },
                    group.map(|item| item.name.clone()).unwrap_or_else(|| "群组".into()),
                    group.and_then(|item| item.avatar.clone()),
                )
            } else if message.receiver_id.as_deref() == Some(current_user) {
                let sender_id = message.sender_id.as_str();
                (
                    format!("user:{sender_id}"),
                    models::ChatConversationRef::User {
                        target_id: sender_id.to_string(),
                    },
                    message.sender_name.clone(),
                    message.sender_avatar.clone(),
                )
            } else if message.receiver_id.is_none() {
                (
                    "broadcast".to_string(),
                    models::ChatConversationRef::Broadcast,
                    "全员广播".to_string(),
                    Some("📣".to_string()),
                )
            } else {
                continue;
            };

            let entry = summaries.entry(key.clone()).or_insert_with(|| models::ChatUnreadSummary {
                key,
                conversation,
                name,
                avatar,
                count: 0,
                first_unread_message_id: Some(message.id.clone()),
            });
            entry.count = entry.count.saturating_add(1);
        }

        let mut output = summaries.into_values().collect::<Vec<_>>();
        output.sort_by(|left, right| left.key.cmp(&right.key));
        Ok(output)
    }

    pub fn search_chat_messages(
        &self,
        current_user: &str,
        conversation_type: &str,
        target_id: Option<&str>,
        query: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<models::ChatSearchPage, String> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(models::ChatSearchPage {
                results: Vec::new(),
                total: 0,
                next_cursor: None,
            });
        }

        let mut matches = self
            .all_visible_chat_messages(current_user)?
            .into_iter()
            .filter(|message| {
                Self::chat_message_matches_conversation(
                    message,
                    current_user,
                    conversation_type,
                    target_id,
                )
                    && (message.content.to_lowercase().contains(&query)
                        || message
                            .file_name
                            .as_deref()
                            .unwrap_or_default()
                            .to_lowercase()
                            .contains(&query))
            })
            .collect::<Vec<_>>();
        let total = matches.len();
        matches.sort_by(|left, right| {
            right
                .timestamp
                .cmp(&left.timestamp)
                .then_with(|| right.id.cmp(&left.id))
        });

        if let Some(cursor) = cursor {
            if let Some((timestamp, id)) = cursor.split_once('|') {
                matches.retain(|message| {
                    message.timestamp.as_str() < timestamp
                        || (message.timestamp == timestamp && message.id.as_str() < id)
                });
            }
        }

        let page_size = limit.clamp(1, 100);
        let has_more = matches.len() > page_size;
        let page = matches.into_iter().take(page_size).collect::<Vec<_>>();
        let next_cursor = if has_more {
            page.last()
                .map(|message| format!("{}|{}", message.timestamp, message.id))
        } else {
            None
        };
        let results = page
            .into_iter()
            .map(|message| {
                let mut matched_in = Vec::new();
                if message.content.to_lowercase().contains(&query) {
                    matched_in.push("content".to_string());
                }
                if message
                    .file_name
                    .as_deref()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&query)
                {
                    matched_in.push("fileName".to_string());
                }
                models::ChatSearchMatch { message, matched_in }
            })
            .collect();

        Ok(models::ChatSearchPage {
            results,
            total,
            next_cursor,
        })
    }

    pub fn chat_message_context(
        &self,
        current_user: &str,
        conversation_type: &str,
        target_id: Option<&str>,
        message_id: &str,
        before: usize,
        after: usize,
    ) -> Result<Vec<ChatMessage>, String> {
        let messages = self
            .all_visible_chat_messages(current_user)?
            .into_iter()
            .filter(|message| {
                Self::chat_message_matches_conversation(
                    message,
                    current_user,
                    conversation_type,
                    target_id,
                )
            })
            .collect::<Vec<_>>();
        let Some(index) = messages.iter().position(|message| message.id == message_id) else {
            return Ok(Vec::new());
        };
        let start = index.saturating_sub(before);
        let end = (index + after + 1).min(messages.len());
        Ok(messages[start..end].to_vec())
    }

    /// Removes one conversation from this device only.
    ///
    /// Deliberately bypasses `log_operation`: clearing local history must not
    /// propagate a delete to peers that still retain their own copy.
    pub fn clear_chat_messages(
        &self,
        current_user: &str,
        conversation_type: &str,
        target_id: Option<&str>,
    ) -> Result<usize, String> {
        let deleted = match conversation_type {
            "group" => {
                let group_id = target_id.ok_or_else(|| "缺少群组 ID".to_string())?;
                if !self.chat_groups_for_user(current_user)?.iter().any(|g| g.id == group_id) { return Err("群组不存在或没有访问权限".into()); }
                self.conn.execute(
                    "DELETE FROM chat_messages WHERE workspace_id=active_workspace_id() AND group_id=?",
                    params![group_id],
                )
            }
            "user" => {
                let peer_id = target_id.ok_or_else(|| "缺少联系人 ID".to_string())?;
                self.conn.execute(
                    "DELETE FROM chat_messages WHERE workspace_id=active_workspace_id() AND group_id IS NULL AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))",
                    params![current_user, peer_id, peer_id, current_user],
                )
            }
            "broadcast" => self.conn.execute(
                "DELETE FROM chat_messages WHERE workspace_id=active_workspace_id() AND group_id IS NULL AND receiver_id IS NULL",
                [],
            ),
            _ => return Err("不支持的对话类型".into()),
        }
        .map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    pub fn delete_chat_message(&self, message_id: &str, operator: &str) -> Result<(), String> {
        if !self.all_visible_chat_messages(operator)?.iter().any(|m| m.id == message_id) { return Err("消息不存在或没有访问权限".into()); }
        self.conn
            .execute("DELETE FROM chat_messages WHERE workspace_id=active_workspace_id() AND id=?", params![message_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_chat_messages_read(
        &self,
        message_ids: &[String],
        reader_id: &str,
    ) -> Result<Vec<ChatMessage>, String> {
        let visible = self.all_visible_chat_messages(reader_id)?.into_iter().map(|m| m.id).collect::<std::collections::HashSet<_>>();
        let mut updated = Vec::new();
        for msg_id in message_ids {
            if !visible.contains(msg_id) { continue; }
            let row: Result<String, _> = self.conn.query_row(
                "SELECT payload_json FROM chat_messages WHERE workspace_id=active_workspace_id() AND id=?",
                params![msg_id],
                |r| r.get(0),
            );
            if let Ok(raw) = row {
                if let Ok(mut msg) = serde_json::from_str::<ChatMessage>(&raw) {
                    if !msg.read_by.iter().any(|id| id == reader_id) {
                        msg.read_by.push(reader_id.to_string());
                        let payload = serde_json::to_value(&msg).map_err(|e| e.to_string())?;
                        self.conn
                            .execute(
                                "UPDATE chat_messages SET payload_json=? WHERE workspace_id=active_workspace_id() AND id=?",
                                params![payload.to_string(), msg.id],
                            )
                            .map_err(|e| e.to_string())?;
                        updated.push(msg);
                    }
                }
            }
        }
        Ok(updated)
    }

    pub fn save_chat_message(&self, value: Value) -> Result<ChatMessage, String> {
        self.save_chat_message_internal(value, true)
    }
    fn save_chat_message_internal(&self, value: Value, log: bool) -> Result<ChatMessage, String> {
        let mut map = value.as_object().cloned().unwrap_or_default();
        self.stamp_workspace(&mut map)?;
        map.entry("id")
            .or_insert(json!(format!("msg-{}", Uuid::new_v4().simple())));
        map.entry("timestamp")
            .or_insert(json!(Utc::now().to_rfc3339()));
        let msg: ChatMessage =
            serde_json::from_value(Value::Object(map)).map_err(|e| e.to_string())?;
        let group_project_id = msg.group_id.as_deref().and_then(|group_id| {
            self.chat_groups()
                .ok()?
                .into_iter()
                .find(|group| group.id == group_id)?
                .project_id
        });
        let payload = serde_json::to_value(&msg).map_err(|e| e.to_string())?;
        self.conn.execute("INSERT OR REPLACE INTO chat_messages(id,payload_json,sender_id,receiver_id,group_id,project_id,timestamp) VALUES(?,?,?,?,?,?,?)", params![msg.id,payload.to_string(),msg.sender_id,msg.receiver_id,msg.group_id,group_project_id,msg.timestamp]).map_err(|e| e.to_string())?;
        if log {
            self.log_operation(
                "chat_message",
                &msg.id,
                "create",
                payload,
                &msg.sender_id,
                group_project_id.as_deref(),
            )?;
        }
        Ok(msg)
    }
    pub fn chat_groups(&self) -> Result<Vec<ChatGroup>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM chat_groups WHERE workspace_id=active_workspace_id()  ORDER BY created_at")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?)
                .map(Self::normalize_chat_group)
                .map_err(|e| e.to_string())
        })
        .collect()
    }

    fn normalize_chat_group(mut group: ChatGroup) -> ChatGroup {
        if !group.member_ids.iter().any(|id| id == &group.created_by) {
            group.member_ids.push(group.created_by.clone());
        }
        if !group.admin_ids.iter().any(|id| id == &group.created_by) {
            group.admin_ids.push(group.created_by.clone());
        }
        group
            .admin_ids
            .retain(|admin| admin == &group.created_by || group.member_ids.contains(admin));
        group.member_ids.sort();
        group.member_ids.dedup();
        group.admin_ids.sort();
        group.admin_ids.dedup();
        group
    }

    fn chat_group_from_value(&self, value: Value) -> Result<ChatGroup, String> {
        let mut map = value.as_object().cloned().unwrap_or_default();
        self.stamp_workspace(&mut map)?;
        map.entry("id")
            .or_insert(json!(format!("group-{}", Uuid::new_v4().simple())));
        map.entry("createdAt")
            .or_insert(json!(Utc::now().to_rfc3339()));
        let group: ChatGroup =
            serde_json::from_value(Value::Object(map)).map_err(|e| e.to_string())?;
        Ok(Self::normalize_chat_group(group))
    }

    pub fn chat_groups_for_user(&self, user_id: &str) -> Result<Vec<ChatGroup>, String> {
        Ok(self
            .chat_groups()?
            .into_iter()
            .filter(|group| group.member_ids.iter().any(|id| id == user_id))
            .collect())
    }

    pub fn save_chat_group(&self, value: Value, operator: &str) -> Result<ChatGroup, String> {
        let group = self.chat_group_from_value(value)?;
        if group.created_by != operator {
            return Err("群组创建者与当前会话身份不一致".into());
        }
        if let Some(project_id) = group.project_id.as_deref() {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == project_id)
                .ok_or_else(|| "关联项目不存在".to_string())?;
            let belongs_to_project = |user_id: &str| {
                project.created_by == user_id
                    || project.members.iter().any(|id| id == user_id)
                    || project.admins.iter().any(|id| id == user_id)
            };
            if !belongs_to_project(operator) {
                return Err("只有项目成员或管理员可以创建关联群组".into());
            }
            if group
                .member_ids
                .iter()
                .any(|member_id| !belongs_to_project(member_id))
            {
                return Err("关联项目群组只能添加该项目的成员".into());
            }
        }
        self.save_chat_group_internal(
            serde_json::to_value(group).map_err(|e| e.to_string())?,
            true,
        )
    }
    fn save_chat_group_internal(&self, value: Value, log: bool) -> Result<ChatGroup, String> {
        let group = self.chat_group_from_value(value)?;
        let payload = serde_json::to_value(&group).map_err(|e| e.to_string())?;
        self.conn.execute("INSERT OR REPLACE INTO chat_groups(id,payload_json,project_id,created_at) VALUES(?,?,?,?)", params![group.id,payload.to_string(),group.project_id,group.created_at]).map_err(|e| e.to_string())?;
        if log {
            self.log_operation(
                "chat_group",
                &group.id,
                "create",
                payload,
                &group.created_by,
                group.project_id.as_deref(),
            )?;
        }
        Ok(group)
    }

    pub fn update_chat_group_members(
        &self,
        group_id: &str,
        member_ids: Vec<String>,
        admin_ids: Option<Vec<String>>,
        operator: &str,
    ) -> Result<ChatGroup, String> {
        let mut group = self
            .chat_groups()?
            .into_iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;
        if !group.admin_ids.iter().any(|id| id == operator) && group.created_by != operator {
            return Err("只有群管理员或创建者可以管理成员".into());
        }

        if let Some(project_id) = group.project_id.as_deref() {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == project_id)
                .ok_or_else(|| "关联项目不存在".to_string())?;
            let belongs_to_project = |user_id: &str| {
                project.created_by == user_id
                    || project.members.iter().any(|id| id == user_id)
                    || project.admins.iter().any(|id| id == user_id)
            };
            let adds_non_project_member = member_ids.iter().any(|member_id| {
                !belongs_to_project(member_id)
                    && !group
                        .member_ids
                        .iter()
                        .any(|existing| existing == member_id)
            });
            if !belongs_to_project(operator) || adds_non_project_member {
                return Err("关联项目群组只能由项目成员管理，并且只能添加项目成员".into());
            }
        }

        let previous_member_ids = group.member_ids.clone();
        group.member_ids = member_ids
            .into_iter()
            .filter(|id| !id.trim().is_empty())
            .collect();
        if let Some(admins) = admin_ids {
            group.admin_ids = admins
                .into_iter()
                .filter(|id| !id.trim().is_empty())
                .collect();
        }
        group = Self::normalize_chat_group(group);
        let mut payload = serde_json::to_value(&group).map_err(|e| e.to_string())?;
        payload["previousMemberIds"] = json!(previous_member_ids);
        let saved = self.save_chat_group_internal(payload.clone(), false)?;
        self.log_operation(
            "chat_group",
            &saved.id,
            "update",
            payload,
            operator,
            saved.project_id.as_deref(),
        )?;
        Ok(saved)
    }

    pub fn update_chat_group_profile(
        &self,
        group_id: &str,
        name: &str,
        description: Option<&str>,
        avatar: Option<&str>,
        project_id: Option<&str>,
        operator: &str,
    ) -> Result<ChatGroup, String> {
        let mut group = self
            .chat_groups()?
            .into_iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;
        if !group.admin_ids.iter().any(|id| id == operator) && group.created_by != operator {
            return Err("只有群管理员或创建者可以修改群组属性".into());
        }

        let clean_name = name.trim();
        if clean_name.is_empty() {
            return Err("群组名称不能为空".into());
        }

        if let Some(pid) = project_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == pid)
                .ok_or_else(|| "关联项目不存在".to_string())?;
            let belongs_to_project = |user_id: &str| {
                project.created_by == user_id
                    || project.members.iter().any(|id| id == user_id)
                    || project.admins.iter().any(|id| id == user_id)
            };
            if !belongs_to_project(operator) {
                return Err("只有该项目的成员或管理员可以将群组关联至该项目".into());
            }
            group.project_id = Some(pid.to_string());
        } else {
            group.project_id = None;
        }

        group.name = clean_name.to_string();
        group.description = description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        if let Some(av) = avatar.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            group.avatar = Some(av.to_string());
        }

        group = Self::normalize_chat_group(group);
        let payload = serde_json::to_value(&group).map_err(|e| e.to_string())?;
        let saved = self.save_chat_group_internal(payload.clone(), false)?;
        self.log_operation(
            "chat_group",
            &saved.id,
            "update",
            payload,
            operator,
            saved.project_id.as_deref(),
        )?;
        Ok(saved)
    }

    pub fn transfer_chat_group(
        &self,
        group_id: &str,
        target_user_id: &str,
        operator: &str,
    ) -> Result<ChatGroup, String> {
        let mut group = self
            .chat_groups()?
            .into_iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;

        if group.created_by != operator {
            return Err("只有群组创建者可以转让群组".into());
        }
        if target_user_id == operator {
            return Err("不能将群组转让给自己".into());
        }

        if let Some(project_id) = group.project_id.as_deref() {
            let project = self
                .projects(None)?
                .into_iter()
                .find(|project| project.id == project_id)
                .ok_or_else(|| "关联项目不存在".to_string())?;
            let belongs_to_project = |user_id: &str| {
                project.created_by == user_id
                    || project.members.iter().any(|id| id == user_id)
                    || project.admins.iter().any(|id| id == user_id)
            };
            if !belongs_to_project(target_user_id) {
                return Err("只能转让给关联项目的成员".into());
            }
        }

        if !group.member_ids.iter().any(|id| id == target_user_id) {
            group.member_ids.push(target_user_id.to_string());
        }
        let previous_creator_id = group.created_by.clone();
        group.created_by = target_user_id.to_string();

        if !group.admin_ids.iter().any(|id| id == target_user_id) {
            group.admin_ids.push(target_user_id.to_string());
        }
        if !group.member_ids.iter().any(|id| id == operator) {
            group.member_ids.push(operator.to_string());
        }
        group.admin_ids.retain(|admin| admin != operator);

        group = Self::normalize_chat_group(group);
        let mut payload = serde_json::to_value(&group).map_err(|e| e.to_string())?;
        payload["previousCreatorId"] = json!(previous_creator_id);
        let saved = self.save_chat_group_internal(payload.clone(), false)?;
        self.log_operation(
            "chat_group",
            &saved.id,
            "transfer",
            payload,
            operator,
            saved.project_id.as_deref(),
        )?;
        Ok(saved)
    }

    pub fn delete_chat_group(&self, group_id: &str, operator: &str) -> Result<bool, String> {
        let group = match self
            .chat_groups()?
            .into_iter()
            .find(|group| group.id == group_id)
        {
            Some(group) => group,
            None => return Ok(false),
        };

        if group.created_by != operator {
            return Err("只有群组创建者可以删除群组".into());
        }

        let deleted = self
            .conn
            .execute("DELETE FROM chat_groups WHERE workspace_id=active_workspace_id() AND id=?", params![group_id])
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Ok(false);
        }

        let _ = self
            .conn
            .execute("DELETE FROM group_announcements WHERE workspace_id=active_workspace_id() AND group_id=?", params![group_id]);

        self.log_operation(
            "chat_group",
            group_id,
            "delete",
            json!({
                "id": group_id,
                "previousMemberIds": group.member_ids
            }),
            operator,
            group.project_id.as_deref(),
        )?;
        Ok(true)
    }

    pub fn group_announcements(&self, group_id: &str) -> Result<Vec<models::GroupAnnouncement>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM group_announcements WHERE workspace_id=active_workspace_id() AND group_id = ? ORDER BY pinned DESC, created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![group_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut announcements = Vec::new();
        for item in rows {
            let json_str = item.map_err(|e| e.to_string())?;
            if let Ok(announcement) = serde_json::from_str::<models::GroupAnnouncement>(&json_str) {
                announcements.push(announcement);
            }
        }
        Ok(announcements)
    }

    pub fn save_group_announcement(
        &self,
        value: Value,
        operator: &str,
    ) -> Result<models::GroupAnnouncement, String> {
        // The create form intentionally omits the server-owned announcement ID.
        // Generate it here so both UI-created and synced payloads deserialize
        // into the persisted model consistently.
        let mut map = value
            .as_object()
            .cloned()
            .ok_or_else(|| "群公告数据格式错误: 公告必须是对象".to_string())?;
        let has_id = map
            .get("id")
            .and_then(Value::as_str)
            .map(|id| !id.trim().is_empty())
            .unwrap_or(false);
        if !has_id {
            map.insert(
                "id".to_string(),
                json!(format!("ann-{}", Uuid::new_v4().simple())),
            );
        }
        let mut announcement: models::GroupAnnouncement = serde_json::from_value(Value::Object(map))
            .map_err(|e| format!("群公告数据格式错误: {e}"))?;
        let group = self
            .chat_groups()?
            .into_iter()
            .find(|g| g.id == announcement.group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;

        let is_admin = group.created_by == operator || group.admin_ids.iter().any(|id| id == operator);
        if !is_admin {
            return Err("只有群管理员或群创建者可以发布或修改群公告".into());
        }

        if announcement.title.trim().is_empty() {
            return Err("公告标题不能为空".into());
        }
        if announcement.content.trim().is_empty() {
            return Err("公告内容不能为空".into());
        }
        if !announcement.read_by.iter().any(|id| id == operator) {
            announcement.read_by.push(operator.to_string());
        }

        let payload = serde_json::to_value(&announcement).map_err(|e| e.to_string())?;
        self.save_group_announcement_internal(payload, true, group.project_id.as_deref())
    }

    pub fn save_group_announcement_internal(
        &self,
        value: Value,
        log: bool,
        project_id: Option<&str>,
    ) -> Result<models::GroupAnnouncement, String> {
        let announcement: models::GroupAnnouncement = serde_json::from_value(value.clone())
            .map_err(|e| format!("群公告数据格式错误: {e}"))?;
        let pinned_int = if announcement.pinned { 1 } else { 0 };
        self.conn
            .execute(
                "INSERT OR REPLACE INTO group_announcements(id, group_id, author_id, payload_json, pinned, created_at) VALUES(?,?,?,?,?,?)",
                params![
                    announcement.id,
                    announcement.group_id,
                    announcement.author_id,
                    value.to_string(),
                    pinned_int,
                    announcement.created_at
                ],
            )
            .map_err(|e| e.to_string())?;

        if log {
            self.log_operation(
                "group_announcement",
                &announcement.id,
                "create",
                value,
                &announcement.author_id,
                project_id,
            )?;
        }
        Ok(announcement)
    }

    pub fn delete_group_announcement(&self, announcement_id: &str, operator: &str) -> Result<(), String> {
        let announcement_str = self
            .conn
            .query_row(
                "SELECT payload_json FROM group_announcements WHERE workspace_id=active_workspace_id() AND id = ?",
                params![announcement_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("公告不存在: {e}"))?;
        let item: models::GroupAnnouncement = serde_json::from_str(&announcement_str)
            .map_err(|e| e.to_string())?;

        let group = self
            .chat_groups()?
            .into_iter()
            .find(|g| g.id == item.group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;

        let is_admin = group.created_by == operator || group.admin_ids.iter().any(|id| id == operator);
        if !is_admin {
            return Err("只有群管理员或群创建者可以删除群公告".into());
        }

        self.conn
            .execute("DELETE FROM group_announcements WHERE workspace_id=active_workspace_id() AND id = ?", params![announcement_id])
            .map_err(|e| e.to_string())?;

        self.log_operation(
            "group_announcement",
            announcement_id,
            "delete",
            json!({ "id": announcement_id, "groupId": item.group_id }),
            operator,
            group.project_id.as_deref(),
        )?;
        Ok(())
    }

    pub fn pin_group_announcement(
        &self,
        announcement_id: &str,
        pinned: bool,
        operator: &str,
    ) -> Result<models::GroupAnnouncement, String> {
        let announcement_str = self
            .conn
            .query_row(
                "SELECT payload_json FROM group_announcements WHERE workspace_id=active_workspace_id() AND id = ?",
                params![announcement_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("公告不存在: {e}"))?;
        let mut item: models::GroupAnnouncement = serde_json::from_str(&announcement_str)
            .map_err(|e| e.to_string())?;

        let group = self
            .chat_groups()?
            .into_iter()
            .find(|g| g.id == item.group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;

        let is_admin = group.created_by == operator || group.admin_ids.iter().any(|id| id == operator);
        if !is_admin {
            return Err("只有群管理员或群创建者可以置顶群公告".into());
        }

        item.pinned = pinned;
        let payload = serde_json::to_value(&item).map_err(|e| e.to_string())?;
        let pinned_int = if pinned { 1 } else { 0 };

        self.conn
            .execute(
                "UPDATE group_announcements SET payload_json = ?, pinned = ? WHERE workspace_id=active_workspace_id() AND id = ?",
                params![payload.to_string(), pinned_int, announcement_id],
            )
            .map_err(|e| e.to_string())?;

        self.log_operation(
            "group_announcement",
            announcement_id,
            "update",
            payload,
            operator,
            group.project_id.as_deref(),
        )?;
        Ok(item)
    }

    pub fn mark_group_announcement_read(
        &self,
        announcement_id: &str,
        reader_id: &str,
    ) -> Result<models::GroupAnnouncement, String> {
        let announcement_str = self
            .conn
            .query_row(
                "SELECT payload_json FROM group_announcements WHERE workspace_id=active_workspace_id() AND id = ?",
                params![announcement_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("公告不存在: {e}"))?;
        let mut item: models::GroupAnnouncement = serde_json::from_str(&announcement_str)
            .map_err(|e| e.to_string())?;

        if !self.chat_groups_for_user(reader_id)?.iter().any(|g| g.id == item.group_id) { return Err("群组不存在或没有访问权限".into()); }
        if !item.read_by.iter().any(|id| id == reader_id) {
            item.read_by.push(reader_id.to_string());
            let payload = serde_json::to_value(&item).map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "UPDATE group_announcements SET payload_json = ? WHERE workspace_id=active_workspace_id() AND id = ?",
                    params![payload.to_string(), announcement_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(item)
    }
}

fn merge_json(base: &mut Value, patch: Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (key, value) in patch_obj {
            base_obj.insert(key.clone(), value.clone());
        }
    } else {
        *base = patch;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT_ADMIN: &str = "project-admin@test-device";
    const PROJECT_CO_ADMIN: &str = "project-co-admin@test-device";
    const APPROVED_MEMBER: &str = "approved-member@test-device";
    const PENDING_MEMBER: &str = "pending-member@test-device";
    const OUTSIDE_ADMIN: &str = "outside-admin@test-device";

    fn database() -> Database {
        Database::open(Path::new(":memory:")).expect("database should open")
    }

    #[test]
    fn close_button_behavior_defaults_to_tray_for_missing_or_unknown_values() {
        let db = database();
        assert_eq!(db.close_button_behavior().unwrap(), models::CloseButtonBehavior::Tray);
        db.conn.execute(
            "INSERT INTO settings(key,value) VALUES('closeButtonBehavior','unknown')",
            [],
        ).unwrap();
        assert_eq!(db.close_button_behavior().unwrap(), models::CloseButtonBehavior::Tray);
        assert!(serde_json::from_str::<models::CloseButtonBehavior>("\"unknown\"").is_err());
    }

    #[test]
    fn close_button_behavior_is_local_and_survives_database_reopen() {
        let path = std::env::temp_dir().join(format!("lanmind-close-behavior-{}.sqlite", Uuid::new_v4()));
        for behavior in [models::CloseButtonBehavior::Exit, models::CloseButtonBehavior::Tray] {
            {
                let db = Database::open(&path).unwrap();
                db.save_close_button_behavior(behavior).unwrap();
                assert!(db.sync_operations(0).unwrap().0.is_empty());
                assert!(!serde_json::to_string(&db.task_archive("local@test").unwrap()).unwrap().contains("closeButtonBehavior"));
            }
            let reopened = Database::open(&path).unwrap();
            assert_eq!(reopened.close_button_behavior().unwrap(), behavior);
        }
        std::fs::remove_file(path).unwrap();
    }

    fn join_test_workspace(target:&Database,source:&Database) {
        let ws=source.workspace_record().unwrap();
        let user=target.current_user_id().unwrap();
        target.conn.execute("INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?,?,?,?,?,?)",params![ws.id,ws.name,ws.slug,ws.logo,ws.description,ws.timezone,ws.owner_id,ws.created_at,ws.updated_at]).unwrap();
        target.conn.execute("INSERT OR REPLACE INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",params![ws.id,user,Utc::now().to_rfc3339()]).unwrap();
        target.switch_workspace(&ws.id,&user).unwrap();
    }

    impl Database {
        fn upsert_workspace_test_user(&self,user:&User)->Result<(),String> {
            self.upsert_user(user)?;
            self.conn.execute("INSERT OR IGNORE INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",params![self.workspace_context()?.workspace_id,user.id,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
    fn test_user(id: &str, role: &str) -> User {
        let username = id.split('@').next().unwrap_or("test-user").to_string();
        User {
            id: id.into(),
            username: username.clone(),
            device_id: "test-device".into(),
            nickname: username,
            role: role.into(),
            ip: "127.0.0.1".into(),
            is_online: true,
            last_active: "2026-01-01T00:00:00Z".into(),
            avatar: None,
        }
    }

    fn project_database() -> (Database, Project) {
        let db = database();
        for (id, role) in [
            (PROJECT_ADMIN, "admin"),
            (PROJECT_CO_ADMIN, "user"),
            (APPROVED_MEMBER, "user"),
            (PENDING_MEMBER, "user"),
            (OUTSIDE_ADMIN, "admin"),
        ] {
            db.upsert_workspace_test_user(&test_user(id, role))
                .expect("test user should be saved");
        }
        let project = db
            .create_project(
                json!({
                    "name": "测试项目",
                    "description": "项目权限测试",
                    "color": "#2563eb"
                }),
                PROJECT_ADMIN,
            )
            .expect("test project should be created");
        let project = db
            .update_project(
                &project.id,
                json!({"admins": [PROJECT_ADMIN, PROJECT_CO_ADMIN], "members": [PROJECT_ADMIN, PROJECT_CO_ADMIN, APPROVED_MEMBER]}),
                PROJECT_ADMIN,
            )
            .expect("approved member should be added");
        (db, project)
    }

    fn history_operation(db: &Database, id: &str, entity_type: &str, entity_id: &str, payload: Value, version: i64, timestamp: &str) {
        db.conn.execute(
            "INSERT INTO sync_operations(id,entity_type,entity_id,action,payload_json,timestamp,node_id,version) VALUES(?,?,?,'update',?,?,?,?)",
            params![id, entity_type, entity_id, payload.to_string(), timestamp, PROJECT_ADMIN, version],
        ).unwrap();
    }

    #[test]
    fn risks_ignore_terminal_tasks_and_keep_active_warnings() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let overdue_date = (Local::now() - Duration::days(7)).format("%Y-%m-%d").to_string();
        let imminent_date = (Local::now() + Duration::days(1)).format("%Y-%m-%d").to_string();
        let create = |status: &str, date: Option<&str>, priority: &str| {
            let mut payload = task_value(&format!("risk-{status}-{date:?}"), None, &operator);
            payload["status"] = json!(status);
            payload["dueDate"] = json!(date);
            payload["priority"] = json!(priority);
            db.create_task(payload, &operator).unwrap()
        };
        for status in ["completed", "abandoned"] {
            for date in [&overdue_date, &imminent_date] {
                create(status, Some(date), "P1");
            }
        }
        assert!(db.risks(None).unwrap().is_empty());
        assert_eq!(db.tasks(None).unwrap().len(), 4);

        let mut overdue_ids = Vec::new();
        let mut imminent_ids = Vec::new();
        for status in ["todo", "in_progress", "blocked"] {
            overdue_ids.push(create(status, Some(&overdue_date), "P2").id);
            imminent_ids.push(create(status, Some(&imminent_date), "P2").id);
        }
        let blocked = create("blocked", None, "P1");
        let warnings = db.risks(Some(&operator)).unwrap();
        assert_eq!(warnings.len(), 3);
        for (warning_type, mut expected) in [
            ("overdue", overdue_ids.clone()),
            ("imminent", imminent_ids),
            ("unassigned_p1", vec![blocked.id]),
        ] {
            let mut actual = warnings.iter().find(|warning| warning.warning_type == warning_type)
                .unwrap().related_task_ids.clone();
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected);
        }

        let task_id = &overdue_ids[0];
        db.update_task(task_id, json!({"status": "abandoned"}), &operator).unwrap();
        assert!(db.risks(Some(&operator)).unwrap().iter()
            .all(|warning| !warning.related_task_ids.contains(task_id)));
        db.update_task(task_id, json!({"status": "todo"}), &operator).unwrap();
        assert!(db.risks(Some(&operator)).unwrap().iter()
            .any(|warning| warning.related_task_ids.contains(task_id)));
    }

    #[test]
    fn comment_reply_accepts_only_a_visible_existing_comment_in_the_same_task() {
        let (db, project) = project_database();
        let task = db.create_task(task_value("引用测试", Some(&project.id), PROJECT_ADMIN), PROJECT_ADMIN).unwrap();
        let other = db.create_task(task_value("另一任务", Some(&project.id), PROJECT_ADMIN), PROJECT_ADMIN).unwrap();
        let original = db.create_task_comment(&task.id, "原始评论", PROJECT_ADMIN).unwrap();
        let reply = db.create_task_comment_reply(&task.id, " 成员回复 ", APPROVED_MEMBER, Some(&original.id)).unwrap();
        let quote = reply.reply_to.as_ref().unwrap();
        assert_eq!(reply.author_id, APPROVED_MEMBER);
        assert_eq!(reply.content, "成员回复");
        assert_eq!(quote.comment_id, original.id);
        assert_eq!(quote.author_id, PROJECT_ADMIN);
        assert_eq!(quote.content, "原始评论");
        assert!(db.lan_operations_for_user(APPROVED_MEMBER).unwrap().iter().any(|operation| operation.entity_id == reply.id));
        for recipient in [PENDING_MEMBER, OUTSIDE_ADMIN] {
            assert!(!db.lan_operations_for_user(recipient).unwrap().iter().any(|operation| operation.entity_type == "task_comment"));
        }
        let count = db.sync_operations(0).unwrap().0.len();
        for (task_id, original_id, operator) in [
            (other.id.as_str(), original.id.as_str(), PROJECT_ADMIN),
            (task.id.as_str(), "missing", APPROVED_MEMBER),
            (task.id.as_str(), original.id.as_str(), PENDING_MEMBER),
        ] {
            assert!(db.create_task_comment_reply(task_id, "越权回复", operator, Some(original_id)).is_err());
        }
        assert_eq!(db.sync_operations(0).unwrap().0.len(), count);
        db.delete_task_comment(&original.id, PROJECT_ADMIN).unwrap();
        assert!(db.create_task_comment_reply(&task.id, "过期回复", APPROVED_MEMBER, Some(&original.id)).is_err());
        assert_eq!(db.task_comments(&task.id, APPROVED_MEMBER).unwrap().len(), 1);
    }

    #[test]
    fn comment_quotes_survive_original_edits_deletion_reply_updates_and_lan_sync() {
        let (source, project) = project_database();
        let task = source.create_task(task_value("引用同步", Some(&project.id), PROJECT_ADMIN), PROJECT_ADMIN).unwrap();
        let original = source.create_task_comment(&task.id, "原始 **内容**", PROJECT_ADMIN).unwrap();
        let reply = source.create_task_comment_reply(&task.id, "第一层回复", APPROVED_MEMBER, Some(&original.id)).unwrap();
        let followup = source.create_task_comment_reply(&task.id, "回复的回复", PROJECT_ADMIN, Some(&reply.id)).unwrap();
        let followup_json = serde_json::to_value(&followup).unwrap();
        assert_eq!(followup_json["replyTo"]["content"], "第一层回复");
        assert!(followup_json["replyTo"].get("replyTo").is_none());
        source.update_task_comment(&original.id, "编辑后的内容", PROJECT_ADMIN).unwrap();
        source.delete_task_comment(&original.id, PROJECT_ADMIN).unwrap();
        let updated = source.update_task_comment(&reply.id, "修改回复正文", APPROVED_MEMBER).unwrap();
        assert_eq!(updated.reply_to.as_ref().unwrap().content, "原始 **内容**");

        let target = database();
        join_test_workspace(&target,&source);
        for user in source.users().unwrap() { target.upsert_workspace_test_user(&user).unwrap(); }
        for operation in source.lan_operations_for_user(APPROVED_MEMBER).unwrap() {
            target.apply_operation(&operation).unwrap();
        }
        let comments = target.task_comments(&task.id, APPROVED_MEMBER).unwrap();
        assert_eq!(comments.len(), 2);
        let synced = comments.iter().find(|comment| comment.id == reply.id).unwrap();
        assert_eq!(synced.content, "修改回复正文");
        assert_eq!(synced.reply_to.as_ref().unwrap().comment_id, original.id);
        assert_eq!(synced.reply_to.as_ref().unwrap().content, "原始 **内容**");
    }

    #[test]
    fn legacy_comments_load_without_quotes_and_new_quotes_persist_after_database_reopen() {
        let legacy: TaskComment = serde_json::from_value(json!({"id":"old", "taskId":"task", "authorId":"user", "content":"旧评论", "createdAt":"2026-09-30", "updatedAt":"2026-09-30"})).unwrap();
        assert!(legacy.reply_to.is_none());
        assert!(serde_json::to_value(&legacy).unwrap().get("replyTo").is_none());

        let path = std::env::temp_dir().join(format!("lanmind-comment-quote-{}.sqlite", Uuid::new_v4().simple()));
        let (task_id, reply_id, operator) = {
            let db = Database::open(&path).unwrap();
            let operator = db.current_user_id().unwrap();
            let task = db.create_task(task_value("持久化引用", None, &operator), &operator).unwrap();
            let original = db.create_task_comment(&task.id, "持久化原文", &operator).unwrap();
            let reply = db.create_task_comment_reply(&task.id, "持久化回复", &operator, Some(&original.id)).unwrap();
            db.delete_task_comment(&original.id, &operator).unwrap();
            (task.id, reply.id, operator)
        };
        {
            let reopened = Database::open(&path).unwrap();
            let comments = reopened.task_comments(&task_id, &operator).unwrap();
            assert_eq!(comments.len(), 1);
            assert_eq!(comments[0].id, reply_id);
            assert_eq!(comments[0].reply_to.as_ref().unwrap().content, "持久化原文");
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn activity_pagination_includes_history_beyond_sync_transport_limit_and_checks_permissions() {
        let (db, project) = project_database();
        let task = db.create_task(task_value("history", Some(&project.id), PROJECT_ADMIN), PROJECT_ADMIN).unwrap();
        db.conn.execute("DELETE FROM sync_operations", []).unwrap();
        for index in 1..=5041 {
            let comment = index % 2 == 0;
            history_operation(&db, &format!("event-{index:05}"), if comment { "task_comment" } else { "task" },
                if comment { "comment" } else { &task.id }, json!({"taskId":task.id}), index, "2026-09-30T12:00:00Z");
        }
        history_operation(&db, "unrelated-task", "task", "other", json!({"taskId":task.id}), 6000, "2026-10-01T12:00:00Z");
        history_operation(&db, "unrelated-comment", "task_comment", &task.id, json!({"taskId":"other"}), 6001, "2026-10-01T12:00:00Z");
        let first = db.task_activity_page(&task.id, APPROVED_MEMBER, 1, 20, None).unwrap();
        assert_eq!(first.total, 5041);
        assert_eq!(first.items.len(), 20);
        assert_eq!(first.items[0].id, "event-05041");
        assert_eq!(first.items[19].id, "event-05022");
        history_operation(&db, "late-task-event", "task", &task.id, json!({}), 1, "2026-10-02T12:00:00Z");
        let second = db.task_activity_page(&task.id, APPROVED_MEMBER, 2, 20, Some(first.snapshot)).unwrap();
        assert_eq!(second.total, 5041);
        assert_eq!(second.items[0].id, "event-05021");
        let refreshed = db.task_activity_page(&task.id, APPROVED_MEMBER, 1, 20, None).unwrap();
        assert_eq!(refreshed.total, 5042);
        assert_eq!(refreshed.items[0].id, "late-task-event");
        let last = db.task_activity_page(&task.id, PROJECT_ADMIN, i64::MAX, 20, Some(first.snapshot)).unwrap();
        assert_eq!(last.page, 253);
        assert_eq!(last.items.len(), 1);
        assert_eq!(last.items[0].id, "event-00001");
        assert!(db.task_activity_page(&task.id, PENDING_MEMBER, 1, 20, None).is_err());
        assert!(db.task_activity_page(&task.id, OUTSIDE_ADMIN, 1, 20, None).is_err());
        assert!(db.task_activity_page("missing", PROJECT_ADMIN, 1, 20, None).is_err());
    }

    #[test]
    fn log_pagination_snapshot_excludes_late_operations_with_older_versions() {
        let db = database();
        for index in 1..=45 {
            history_operation(&db, &format!("event-{index:05}"), "task", "task", json!({}), index, "2026-09-30T12:00:00Z");
        }
        let first = db.sync_logs_page(1, 20, None).unwrap().records;
        assert_eq!(first.total, 45);
        assert_eq!(first.items[0].id, "event-00045");
        history_operation(&db, "late-remote", "task", "task", json!({}), 1, "2026-10-01T12:00:00Z");
        let second = db.sync_logs_page(2, 20, Some(first.snapshot)).unwrap().records;
        assert_eq!(second.total, 45);
        assert_eq!(second.items[0].id, "event-00025");
        assert_eq!(second.items[19].id, "event-00006");
        let third = db.sync_logs_page(3, 20, Some(first.snapshot)).unwrap().records;
        assert_eq!(third.items.len(), 5);
        assert_eq!(third.items[4].id, "event-00001");
        let ids: HashSet<_> = first.items.iter().chain(second.items.iter()).chain(third.items.iter()).map(|item| &item.id).collect();
        assert_eq!(ids.len(), 45);
        let refreshed = db.sync_logs_page(1, 20, None).unwrap().records;
        assert_eq!(refreshed.total, 46);
        assert_eq!(refreshed.items[0].id, "late-remote");
        // Browsing logs must not change the transport's ascending incremental order.
        let incremental = db.sync_operations(40).unwrap().0;
        assert_eq!(incremental.len(), 5);
        assert_eq!(incremental[0].version, 41);
    }

    #[test]
    fn log_pagination_bounds_empty_pages_and_page_size() {
        let db = database();
        let response = db.sync_logs_page(-5, 0, None).unwrap();
        let serialized = serde_json::to_value(&response).unwrap();
        assert_eq!(serialized["pageSize"], 1);
        assert_eq!(serialized["items"], json!([]));
        assert_eq!(serialized["latestVersion"], db.sync_operations(0).unwrap().1);
        assert!(serialized.get("records").is_none());
        let empty = response.records;
        assert_eq!((empty.page, empty.page_size, empty.total, empty.snapshot), (1, 1, 0, 0));
        for index in 1..=120 {
            history_operation(&db, &format!("event-{index:05}"), "task", "task", json!({}), index, "2026-09-30T12:00:00Z");
        }
        let bounded = db.sync_logs_page(i64::MAX, i64::MAX, Some(i64::MAX)).unwrap().records;
        assert_eq!((bounded.page, bounded.page_size, bounded.items.len()), (2, 100, 20));
        let excluded = db.sync_logs_page(2, 20, Some(0)).unwrap().records;
        assert_eq!((excluded.page, excluded.total), (1, 0));
        assert!(excluded.items.is_empty());
    }

    #[test]
    fn local_directory_is_persistent_and_never_logged_for_lan_sync() {
        let db = database();
        db.upsert_workspace_test_user(&test_user(APPROVED_MEMBER, "user"))
            .expect("test user should be saved");
        let directory = models::LocalDirectory {
            units: vec![
                models::LocalOrgUnit {
                    id: "org-root".into(),
                    name: "研发".into(),
                    parent_id: None,
                    sort_order: 0,
                },
                models::LocalOrgUnit {
                    id: "org-client".into(),
                    name: "客户端".into(),
                    parent_id: Some("org-root".into()),
                    sort_order: 0,
                },
            ],
            members: vec![models::LocalOrgMember {
                org_unit_id: "org-client".into(),
                user_id: APPROVED_MEMBER.into(),
            }],
        };
        let saved = db
            .save_local_directory(&directory)
            .expect("local directory should save");
        assert_eq!(saved.units.len(), 2);
        assert_eq!(saved.members.len(), 1);
        assert_eq!(db.local_directory().expect("directory should load").members[0].user_id, APPROVED_MEMBER);
        assert!(db.sync_operations(0).expect("sync log should load").0.is_empty());

        let invalid = models::LocalDirectory {
            units: vec![
                models::LocalOrgUnit { id: "a".into(), name: "A".into(), parent_id: Some("b".into()), sort_order: 0 },
                models::LocalOrgUnit { id: "b".into(), name: "B".into(), parent_id: Some("a".into()), sort_order: 0 },
            ],
            members: Vec::new(),
        };
        assert!(db.save_local_directory(&invalid).is_err());
        assert_eq!(db.local_directory().expect("directory should remain intact").units.len(), 2);
    }

    fn task_value(title: &str, project_id: Option<&str>, creator: &str) -> Value {
        json!({
            "title": title,
            "description": "测试任务",
            "priority": "P2",
            "status": "todo",
            "dueDate": null,
            "recurrence": "none",
            "reminderTime": null,
            "creatorId": creator,
            "assigneeId": creator,
            "projectId": project_id,
            "isShared": project_id.is_some(),
            "sharedWith": [],
            "subtasks": [],
            "tags": ["测试"]
        })
    }

    fn task_archive(tasks: Vec<Task>) -> TaskDataArchive {
        TaskDataArchive { workspace_id: None,
            archive_format: "lanmind-task-export".into(),
            version: 1,
            exported_at: "2026-09-07T00:00:00Z".into(),
            exported_by: "exporter@test-device".into(),
            tasks,
        }
    }

    #[test]
    fn task_family_saves_children_and_attachments_and_detaches_without_deleting() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let mut value = task_value("主任务", None, &operator);
        value["attachments"] = json!([{ "id": "image", "name": "资料.png", "size": 4, "type": "image/png", "dataUrl": "data:image/png;base64,dGVzdA==", "addedAt": "2026-09-30T00:00:00Z" }]);
        let parent = db.save_task_with_children(None, value, vec![json!({"title": "子任务", "description": "说明", "priority": "P3", "status": "todo", "assigneeId": operator, "dueDate": null})], vec![], &operator, None).unwrap();
        let all = db.tasks(None).unwrap();
        assert_eq!(all.len(), 2);
        let child = all.iter().find(|task| task.parent_task_id.as_deref() == Some(&parent.id)).unwrap();
        assert_eq!(parent.attachments.len(), 1);
        assert_eq!(db.task_archive(&operator).unwrap().tasks.iter().find(|task| task.id == parent.id).unwrap().attachments[0].name, "资料.png");
        let edited = db.save_task_with_children(Some(&parent.id), json!({"title": "主任务更新"}), vec![json!({"id": child.id, "version": child.version, "title": "子任务更新", "status": "completed"})], vec![], &operator, Some(parent.version)).unwrap();
        let completed = db.tasks(None).unwrap().into_iter().find(|task| task.id == child.id).unwrap();
        assert_eq!(completed.status, "completed");
        db.save_task_with_children(Some(&parent.id), json!({}), vec![], vec![child.id.clone()], &operator, Some(edited.version)).unwrap();
        let detached = db.tasks(None).unwrap().into_iter().find(|task| task.id == child.id).unwrap();
        assert!(detached.parent_task_id.is_none());
        assert_eq!(detached.title, "子任务更新");
    }

    #[test]
    fn new_task_family_preserves_copied_child_content_and_scheduling() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let parent = db.save_task_with_children(None, task_value("副本主任务", None, &operator), vec![json!({
            "title": "副本子任务", "description": "正文\n\n![图片](lanmind-attachment:copied-image)\n\n- [ ] 检查",
            "priority": "P2", "status": "todo", "progress": 0, "assigneeId": operator,
            "dueDate": "2026-10-10T09:00", "startDate": "2026-10-09", "recurrence": "weekly",
            "reminderTime": "2026-10-10T08:55", "tags": ["验收"],
            "subtasks": [{"id": "copied-check", "title": "检查", "completed": false}],
            "attachments": [{"id": "copied-image", "name": "资料.png", "size": 4, "type": "image/png", "dataUrl": "data:image/png;base64,dGVzdA==", "addedAt": "2026-10-08"}]
        })], vec![], &operator, None).unwrap();
        let all = db.tasks(None).unwrap();
        let child = all.iter().find(|task| task.parent_task_id.as_deref() == Some(&parent.id)).unwrap();
        assert_eq!(child.tags, vec!["验收"]);
        assert_eq!(child.recurrence.as_deref(), Some("weekly"));
        assert_eq!(child.reminder_time.as_deref(), Some("2026-10-10T08:55"));
        assert_eq!(child.attachments[0].id, "copied-image");
        assert_eq!(child.subtasks[0].id, "copied-check");
        assert!(!child.subtasks[0].completed);
        assert!(child.description.contains("lanmind-attachment:copied-image"));
    }

    #[test]
    fn task_family_failure_rolls_back_parent_children_and_sync_log() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let parent = db.create_task(task_value("原名称", None, &operator), &operator).unwrap();
        let count = db.sync_operations(0).unwrap().0.len();
        let error = db.save_task_with_children(Some(&parent.id), json!({"title": "不应保存"}), vec![json!({"title": "新子任务", "description": "", "priority": "P4", "status": "todo", "assigneeId": operator, "dueDate": null}), json!({"id": "missing", "title": "无效"})], vec![], &operator, Some(parent.version)).unwrap_err();
        assert!(error.contains("子任务不存在"));
        let all = db.tasks(None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "原名称");
        assert_eq!(all[0].version, parent.version);
        assert_eq!(db.sync_operations(0).unwrap().0.len(), count);
        assert!(db.save_task_with_children(Some(&parent.id), json!({"title": "越权"}), vec![], vec![], OUTSIDE_ADMIN, None).is_err());
    }

    #[test]
    fn network_access_mode_defaults_to_read_only_and_persists() {
        let db = database();
        let mut config = db.web_config().unwrap();
        assert!(config.read_only);
        config.read_only = false;
        assert!(!db.save_web_config(&config).unwrap().read_only);
        assert!(!db.web_config().unwrap().read_only);
    }

    #[test]
    fn app_lock_configuration_is_local_and_persists_without_plaintext() {
        let db = database();
        let mut config = db.app_lock_config().unwrap();
        assert!(!config.enabled);
        assert_eq!(config.idle_minutes, 5);
        config.enabled = true;
        assert!(db.save_app_lock_config(&config).is_err());
        config.password_hash = crate::app_lock::hash_password("lock password").unwrap();
        config.idle_minutes = 12;
        db.save_app_lock_config(&config).unwrap();
        let stored = db.app_lock_config().unwrap();
        assert!(stored.enabled);
        assert_eq!(stored.idle_minutes, 12);
        assert_ne!(stored.password_hash, "lock password");
        assert!(crate::app_lock::verify_password("lock password", &stored.password_hash));
        config.idle_minutes = 0;
        assert!(db.save_app_lock_config(&config).is_err());
        config.idle_minutes = 1441;
        assert!(db.save_app_lock_config(&config).is_err());
        assert_eq!(db.app_lock_config().unwrap().idle_minutes, 12);
        assert!(db.sync_operations(0).unwrap().0.is_empty());
        let archive = serde_json::to_string(&db.task_archive("local@test").unwrap()).unwrap();
        assert!(!archive.contains("appLock"));
        assert!(!archive.contains(&stored.password_hash));
    }

    #[test]
    fn cleared_app_lock_password_stays_cleared_after_reopening() {
        let path = std::env::temp_dir().join(format!("lanmind-lock-clear-test-{}.sqlite", Uuid::new_v4()));
        {
            let db = Database::open(&path).unwrap();
            let configured = crate::app_lock::AppLockConfig { enabled: true, idle_minutes: 7, password_hash: crate::app_lock::hash_password("lock password").unwrap() };
            db.save_app_lock_config(&configured).unwrap();
            let cleared = crate::app_lock::prepare_password_clear(&configured, Some("lock password")).unwrap();
            db.save_app_lock_config(&cleared).unwrap();
            assert!(db.sync_operations(0).unwrap().0.is_empty());
        }
        {
            let db = Database::open(&path).unwrap();
            let stored = db.app_lock_config().unwrap();
            assert!(!stored.enabled);
            assert!(stored.password_hash.is_empty());
            assert_eq!(stored.idle_minutes, 7);
            assert!(!crate::app_lock::AppLockRuntime::new(stored).status().unwrap().locked);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn app_lock_configuration_survives_reopening_the_local_database() {
        let path = std::env::temp_dir().join(format!("lanmind-lock-test-{}.sqlite", Uuid::new_v4()));
        let config = crate::app_lock::AppLockConfig { enabled: true, idle_minutes: 7, password_hash: crate::app_lock::hash_password("lock password").unwrap() };
        {
            let db = Database::open(&path).unwrap();
            db.save_app_lock_config(&config).unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            let stored = db.app_lock_config().unwrap();
            assert!(stored.enabled);
            assert_eq!(stored.idle_minutes, 7);
            assert_eq!(stored.password_hash, config.password_hash);
            assert!(crate::app_lock::AppLockRuntime::new(stored).status().unwrap().locked);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn network_password_storage_preserves_legacy_hash_and_encrypted_value() {
        let db = database();
        let mut config = db.web_config().unwrap();
        config.password_hash = crate::web_server::hash_password("test-password").unwrap();
        db.save_web_config(&config).unwrap();
        assert!(db.web_config().unwrap().password_protected.is_none());
        config.password_protected = Some("encrypted-local-value".into());
        db.save_web_config(&config).unwrap();
        let mut restored = db.web_config().unwrap();
        assert_eq!(restored.password_hash, config.password_hash);
        assert_eq!(restored.password_protected.as_deref(), Some("encrypted-local-value"));
        restored.read_only = false;
        db.save_web_config(&restored).unwrap();
        assert_eq!(db.web_config().unwrap().password_protected, config.password_protected);
    }

    #[test]
    fn task_crud_persists_and_soft_deletes() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let created = db
            .create_task(task_value("新增任务", None, &operator), &operator)
            .expect("task should be created");
        assert_eq!(created.status, "todo");

        let updated = db
            .update_task(&created.id, json!({"status": "completed"}), &operator)
            .expect("task should be updated");
        assert_eq!(updated.status, "completed");
        assert!(updated.version > created.version);
        let (operations, _) = db.sync_operations(0).expect("sync log should load");
        let status_update = operations
            .iter()
            .rev()
            .find(|operation| {
                operation.entity_type == "task"
                    && operation.entity_id == created.id
                    && operation.action == "update"
            })
            .expect("task status update should be logged");
        assert_eq!(
            status_update.payload.get("_statusTransition"),
            Some(&json!({"from": "todo", "to": "completed"}))
        );

        assert!(db
            .delete_task(&created.id, &operator)
            .expect("task should be deleted"));
        assert!(!db
            .tasks(None)
            .expect("tasks should load")
            .iter()
            .any(|task| task.id == created.id));
    }

    #[test]
    fn task_archive_contains_only_tasks_visible_to_the_exporting_user() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let own_task = db
            .create_task(task_value("本人的任务", None, &operator), &operator)
            .expect("own task should be created");
        let other_user = "archive-other@test-device";
        db.upsert_workspace_test_user(&test_user(other_user, "user"))
            .expect("other user should be saved");
        let mut other = task_value("他人的私有任务", None, other_user);
        other["id"] = json!("task-private-archive-test");
        other["createdAt"] = json!("2026-09-07T00:00:00Z");
        other["updatedAt"] = json!("2026-09-07T00:00:00Z");
        other["version"] = json!(1);
        db.insert_task_value(&other, false)
            .expect("other task should be inserted");

        let archive = db
            .task_archive(&operator)
            .expect("task archive should be generated");

        assert_eq!(archive.archive_format, "lanmind-task-export");
        assert_eq!(archive.version, 1);
        assert_eq!(archive.tasks.len(), 1);
        assert_eq!(archive.tasks[0].id, own_task.id);
    }

    #[test]
    fn task_import_restores_deleted_ids_and_converts_missing_references() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let existing = db
            .create_task(task_value("已删除任务", None, &operator), &operator)
            .expect("existing task should be created");
        db.delete_task(&existing.id, &operator)
            .expect("existing task should be deleted");

        let mut imported = existing.clone();
        imported.id = "task-import-missing-references".into();
        imported.title = "需要转换的任务".into();
        imported.creator_id = "missing-creator@test-device".into();
        imported.assignee_id = "missing-assignee@test-device".into();
        imported.project_id = Some("missing-project".into());
        imported.is_shared = true;
        imported.shared_with = vec!["missing-member@test-device".into()];
        let result = db
            .import_task_archive(
                task_archive(vec![existing.clone(), imported.clone()]),
                &operator,
            )
            .expect("task archive should import");

        assert_eq!(
            result,
            TaskImportResult {
                imported_count: 2,
                restored_count: 1,
                skipped_count: 0,
                converted_count: 1,
            }
        );
        let saved_tasks = db
            .tasks(Some(&operator))
            .expect("imported tasks should load");
        let restored = saved_tasks
            .iter()
            .find(|task| task.id == existing.id)
            .expect("deleted task should be restored");
        assert_eq!(restored.title, existing.title);
        let saved = saved_tasks
            .into_iter()
            .find(|task| task.id == imported.id)
            .expect("converted task should exist");
        assert_eq!(saved.creator_id, operator);
        assert_eq!(saved.assignee_id, operator);
        assert_eq!(saved.project_id, None);
        assert!(!saved.is_shared);
        assert!(saved.shared_with.is_empty());

        let duplicate = db
            .import_task_archive(task_archive(vec![imported]), &operator)
            .expect("duplicate archive should be accepted");
        assert_eq!(duplicate.imported_count, 0);
        assert_eq!(duplicate.restored_count, 0);
        assert_eq!(duplicate.skipped_count, 1);
    }

    #[test]
    fn task_create_sync_restores_only_newer_deleted_tasks() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let created = db
            .create_task(task_value("task to restore", None, &operator), &operator)
            .expect("task should be created");
        db.delete_task(&created.id, &operator)
            .expect("task should be deleted");
        let tombstone_version = db
            .conn
            .query_row(
                "SELECT version FROM tasks WHERE id=?",
                params![created.id],
                |row| row.get::<_, i64>(0),
            )
            .expect("deleted task version should exist");

        let mut restored = created.clone();
        restored.title = "restored from archive".into();
        let stale_restore = SyncOperation {
            workspace_id: Some(db.workspace_context().unwrap().workspace_id),
            id: "op-stale-task-restore".into(),
            entity_type: "task".into(),
            entity_id: created.id.clone(),
            action: "create".into(),
            payload: json!(restored),
            timestamp: Utc::now().to_rfc3339(),
            node_id: operator.clone(),
            version: tombstone_version - 1,
            scope_id: None,
        };
        assert!(db
            .apply_operation(&stale_restore)
            .expect("stale restore operation should be recorded"));
        assert!(db.tasks(None).expect("tasks should load").is_empty());

        let mut current_restore = stale_restore;
        current_restore.id = "op-current-task-restore".into();
        current_restore.version = tombstone_version + 1;
        assert!(db
            .apply_operation(&current_restore)
            .expect("newer restore operation should apply"));
        let restored = db
            .tasks(None)
            .expect("tasks should load")
            .into_iter()
            .find(|task| task.id == created.id)
            .expect("newer create should restore the deleted task");
        assert_eq!(restored.title, "restored from archive");
        assert_eq!(restored.version, current_restore.version);
    }

    #[test]
    fn task_import_converts_a_private_task_that_would_be_hidden_from_the_importer() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let other_user = "private-import-owner@test-device";
        db.upsert_workspace_test_user(&test_user(other_user, "user"))
            .expect("other user should be saved");
        let task = db
            .create_task(
                task_value("他人的私有归档任务", None, other_user),
                other_user,
            )
            .expect("other user's task should be created");
        db.conn
            .execute("DELETE FROM tasks WHERE id=?", params![task.id])
            .expect("source fixture should be removed before import");

        let result = db
            .import_task_archive(task_archive(vec![task.clone()]), &operator)
            .expect("private task should import");

        assert_eq!(result.converted_count, 1);
        let saved = db
            .tasks(Some(&operator))
            .expect("imported tasks should load")
            .into_iter()
            .find(|item| item.id == task.id)
            .expect("converted task should be visible");
        assert_eq!(saved.creator_id, operator);
        assert_eq!(saved.assignee_id, operator);
        assert!(!saved.is_shared);
    }

    #[test]
    fn task_import_preserves_valid_project_references() {
        let (db, project) = project_database();
        let created = db
            .create_task(
                task_value("项目归档任务", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .expect("project task should be created");
        let mut imported = created.clone();
        imported.id = "task-import-valid-project".into();
        imported.assignee_id = APPROVED_MEMBER.into();
        let result = db
            .import_task_archive(task_archive(vec![imported.clone()]), PROJECT_ADMIN)
            .expect("valid project task should import");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.converted_count, 0);
        let saved = db
            .tasks(Some(PROJECT_ADMIN))
            .expect("project tasks should load")
            .into_iter()
            .find(|task| task.id == imported.id)
            .expect("imported project task should exist");
        assert_eq!(saved.project_id, Some(project.id));
        assert_eq!(saved.creator_id, PROJECT_ADMIN);
        assert_eq!(saved.assignee_id, APPROVED_MEMBER);
    }

    #[test]
    fn task_import_converts_project_tasks_with_non_member_references() {
        let (db, project) = project_database();
        let created = db
            .create_task(
                task_value("项目归档任务", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .expect("project task should be created");
        let mut imported = created;
        imported.id = "task-import-project-non-member".into();
        imported.assignee_id = OUTSIDE_ADMIN.into();

        let result = db
            .import_task_archive(task_archive(vec![imported.clone()]), PROJECT_ADMIN)
            .expect("invalid project member reference should convert");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.converted_count, 1);
        let saved = db
            .tasks(Some(PROJECT_ADMIN))
            .expect("imported tasks should load")
            .into_iter()
            .find(|task| task.id == imported.id)
            .expect("converted task should exist");
        assert_eq!(saved.project_id, None);
        assert_eq!(saved.creator_id, PROJECT_ADMIN);
        assert_eq!(saved.assignee_id, PROJECT_ADMIN);
        assert!(!saved.is_shared);
    }

    #[test]
    fn invalid_task_archive_is_rejected_before_any_rows_are_written() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let template = db
            .create_task(task_value("模板任务", None, &operator), &operator)
            .expect("template task should be created");
        let mut valid = template.clone();
        valid.id = "task-import-valid-before-invalid".into();
        let mut invalid = template;
        invalid.id = "task-import-invalid".into();
        invalid.title = " ".into();

        assert!(db
            .import_task_archive(task_archive(vec![valid.clone(), invalid]), &operator)
            .is_err());
        assert!(db
            .tasks(None)
            .expect("tasks should load")
            .iter()
            .all(|task| task.id != valid.id));
    }

    #[test]
    fn mcp_config_is_local_and_rotates_a_strong_token() {
        let db = database();
        let initial = db.mcp_config().expect("MCP config should load");
        assert!(!initial.enabled);
        assert_eq!(initial.port, 45992);
        assert!(initial.token.len() >= 40);

        let saved = db
            .save_mcp_config(true, 46000)
            .expect("MCP config should save");
        assert!(saved.enabled);
        assert_eq!(saved.port, 46000);
        assert_eq!(saved.token, initial.token);

        let rotated = db.rotate_mcp_token().expect("token should rotate");
        assert_ne!(rotated.token, initial.token);
        assert!(rotated.enabled);
        assert_eq!(rotated.port, 46000);
        assert!(db.save_mcp_config(true, 80).is_err());
    }

    #[test]
    fn recurring_completion_creates_one_future_task_and_checks_version() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let mut value = task_value("循环周会", None, &operator);
        value["dueDate"] = json!("2026-08-03T09:00");
        value["reminderTime"] = json!("2026-08-03T08:45");
        value["recurrence"] = json!("weekly");
        value["recurrenceRule"] = json!({"interval": 1, "daysOfWeek": [1], "timeOfDay": "09:00"});
        let created = db
            .create_task(value, &operator)
            .expect("task should be created");

        assert!(db
            .update_task_with_recurrence(
                &created.id,
                json!({"status":"completed"}),
                &operator,
                Some(created.version - 1),
            )
            .is_err());
        let result = db
            .update_task_with_recurrence(
                &created.id,
                json!({"status":"completed"}),
                &operator,
                Some(created.version),
            )
            .expect("completion should succeed");
        assert_eq!(result.task.status, "completed");
        let next = result.next_task.expect("next recurrence should be created");
        assert_eq!(next.status, "todo");
        assert_eq!(next.recurrence.as_deref(), Some("weekly"));
        assert_eq!(
            next.subtasks.iter().filter(|item| item.completed).count(),
            0
        );

        let repeated = db
            .update_task_with_recurrence(
                &created.id,
                json!({"status":"completed"}),
                &operator,
                Some(result.task.version),
            )
            .expect("repeated completion should remain idempotent");
        assert!(repeated.next_task.is_none());
    }

    #[test]
    fn creating_a_project_keeps_selected_lan_members() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let member = "selected-member@test-device";
        let project = db
            .create_project(
                json!({
                    "name": "局域网成员项目",
                    "members": [member],
                    "admins": [member]
                }),
                &operator,
            )
            .expect("project should be created");

        assert!(project.members.iter().any(|id| id == &operator));
        assert!(project.members.iter().any(|id| id == member));
        assert!(project.admins.iter().any(|id| id == &operator));
        assert!(project.admins.iter().any(|id| id == member));
        assert!(db
            .lan_operations_for_user(member)
            .expect("member LAN operations should load")
            .iter()
            .any(|operation| operation.entity_id == project.id));
    }

    #[test]
    fn project_transfer_demotes_previous_creator_and_promotes_member() {
        let (db, project) = project_database();
        let transferred = db
            .transfer_project(&project.id, APPROVED_MEMBER, PROJECT_ADMIN)
            .expect("creator should transfer the project to a member");
        assert_eq!(transferred.created_by, APPROVED_MEMBER);
        assert!(transferred.members.iter().any(|member| member == PROJECT_ADMIN));
        assert!(transferred.admins.iter().any(|admin| admin == APPROVED_MEMBER));
        assert!(!transferred.admins.iter().any(|admin| admin == PROJECT_ADMIN));
        assert!(db
            .transfer_project(&project.id, PROJECT_CO_ADMIN, PROJECT_ADMIN)
            .is_err());
    }

    #[test]
    fn project_admin_cannot_change_own_membership_or_role() {
        let (db, project) = project_database();
        let error = db
            .update_project(
                &project.id,
                json!({
                    "members": [PROJECT_ADMIN, APPROVED_MEMBER],
                    "admins": [PROJECT_ADMIN]
                }),
                PROJECT_CO_ADMIN,
            )
            .expect_err("an admin must not demote or remove themselves");
        assert!(error.contains("不能修改自己的加入状态或角色"));
    }

    #[test]
    fn only_the_creator_can_delete_a_project_and_the_deletion_syncs() {
        let source = database();
        let creator = source.current_user_id().expect("current user should exist");
        let delegated_admin = "delegated-admin@test-device";
        source
            .upsert_workspace_test_user(&test_user(delegated_admin, "user"))
            .expect("delegated admin should be saved");
        let project = source
            .create_project(
                json!({
                    "name": "可删除项目",
                    "members": [delegated_admin],
                    "admins": [delegated_admin]
                }),
                &creator,
            )
            .expect("project should be created");
        let task = source
            .create_task(
                task_value("随项目隐藏的任务", Some(&project.id), &creator),
                &creator,
            )
            .expect("project task should be created");

        let updated = source
            .update_project(
                &project.id,
                json!({"createdBy": delegated_admin, "name": "管理员修改后的项目"}),
                delegated_admin,
            )
            .expect("a delegated admin should still update normal project fields");
        assert_eq!(updated.created_by, creator);
        assert_eq!(updated.name, "管理员修改后的项目");

        let error = source
            .delete_project(&project.id, delegated_admin)
            .expect_err("a delegated admin must not delete the project");
        assert_eq!(error, "只有项目创建者可以删除项目");
        assert!(source
            .projects(None)
            .expect("projects should load")
            .iter()
            .any(|candidate| candidate.id == project.id));

        assert!(source
            .delete_project(&project.id, &creator)
            .expect("creator should delete the project"));
        assert!(!source
            .projects(None)
            .expect("projects should load")
            .iter()
            .any(|candidate| candidate.id == project.id));
        assert!(source
            .tasks(None)
            .expect("stored tasks should load")
            .iter()
            .any(|candidate| candidate.id == task.id));
        assert!(!source
            .tasks(Some(&creator))
            .expect("visible tasks should load")
            .iter()
            .any(|candidate| candidate.id == task.id));

        let (operations, _) = source
            .sync_operations(0)
            .expect("sync operations should load");
        let create_operation = operations
            .iter()
            .find(|operation| {
                operation.entity_type == "project"
                    && operation.entity_id == project.id
                    && operation.action == "create"
            })
            .expect("project create should be logged")
            .clone();
        let update_operation = operations
            .iter()
            .find(|operation| {
                operation.entity_type == "project"
                    && operation.entity_id == project.id
                    && operation.action == "update"
            })
            .expect("project update should be logged")
            .clone();
        let delete_operation = operations
            .iter()
            .find(|operation| {
                operation.entity_type == "project"
                    && operation.entity_id == project.id
                    && operation.action == "delete"
            })
            .expect("project deletion should be logged")
            .clone();
        assert!(delete_operation
            .payload
            .get("previousMemberIds")
            .and_then(Value::as_array)
            .is_some_and(|members| {
                members
                    .iter()
                    .any(|member| member.as_str() == Some(delegated_admin))
            }));

        let target = database();
        join_test_workspace(&target,&source);
        assert!(target
            .apply_operation(&create_operation)
            .expect("project creation should apply"));
        let mut forged_owner_update = update_operation;
        forged_owner_update.id = "op-forged-project-owner-update".into();
        forged_owner_update.payload["createdBy"] = json!(delegated_admin);
        assert!(target
            .apply_operation(&forged_owner_update)
            .expect("normal admin updates should apply without changing the creator"));
        assert_eq!(
            target.projects(None).expect("target projects should load")[0].created_by,
            creator
        );
        let mut forged_delete = delete_operation.clone();
        forged_delete.id = "op-forged-project-delete".into();
        forged_delete.node_id = delegated_admin.into();
        let error = target
            .apply_operation(&forged_delete)
            .expect_err("a forged admin deletion must be rejected");
        assert_eq!(error, "只有项目创建者可以删除项目");

        assert!(target
            .apply_operation(&delete_operation)
            .expect("creator deletion should apply"));
        assert!(target
            .projects(None)
            .expect("target projects should load")
            .is_empty());
    }

    #[test]
    fn applying_a_lan_user_profile_updates_the_remote_identity() {
        let source = database();
        let mut profile = test_user("profile-user@test-device", "admin");
        profile.nickname = "新的节点名称".into();
        profile.avatar = Some("data:image/png;base64,dGVzdA==".into());
        source
            .save_local_user_profile(&profile)
            .expect("profile should be saved");
        let operation = source
            .lan_operations_for_user("receiver@test-device")
            .expect("LAN operations should load")
            .into_iter()
            .find(|operation| operation.entity_type == "user_profile")
            .expect("profile operation should exist");

        let target = database();
        join_test_workspace(&target,&source);
        assert!(target
            .apply_operation(&operation)
            .expect("profile operation should apply"));
        let received = target
            .users()
            .expect("users should load")
            .into_iter()
            .find(|user| user.id == profile.id)
            .expect("remote profile should be stored");
        assert_eq!(received.nickname, "新的节点名称");
        assert_eq!(received.avatar, profile.avatar);
        assert_eq!(received.role, "user");
        assert!(!received.is_online);
    }

    #[test]
    fn discovered_lan_users_remain_available_as_offline_assignees() {
        let db = database();
        let user_id = "offline-user@test-device";
        db.remember_lan_user(
            user_id,
            "test-device",
            "离线成员",
            "192.168.5.72",
            "2026-07-25T14:00:00Z",
        )
        .expect("LAN user should be remembered");

        let user = db
            .users()
            .expect("users should load")
            .into_iter()
            .find(|user| user.id == user_id)
            .expect("remembered LAN user should exist");
        assert_eq!(user.nickname, "离线成员");
        assert_eq!(user.role, "user");
        assert!(!user.is_online);
    }

    #[test]
    fn project_access_requires_admin_invitation() {
        let (db, project) = project_database();
        let title = "仅项目成员可见";
        let task = db
            .create_task(
                task_value(title, Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .expect("project admin should create a task");

        assert!(!db
            .tasks(Some(PENDING_MEMBER))
            .expect("tasks should load")
            .iter()
            .any(|item| item.id == task.id));
        assert!(db
            .create_task(
                task_value("越权任务", Some(&project.id), PENDING_MEMBER),
                PENDING_MEMBER,
            )
            .is_err());
        assert!(!db
            .projects(Some(PENDING_MEMBER))
            .expect("projects should load")
            .iter()
            .any(|item| item.id == project.id));
        let mut members = project.members.clone();
        members.push(PENDING_MEMBER.into());
        db.update_project(&project.id, json!({"members": members}), PROJECT_ADMIN)
            .expect("project admin should invite the member");
        assert!(db
            .projects(Some(PENDING_MEMBER))
            .expect("projects should load")
            .iter()
            .any(|item| item.id == project.id));
        assert!(db
            .tasks(Some(PENDING_MEMBER))
            .expect("tasks should load")
            .iter()
            .any(|item| item.id == task.id));
    }

    #[test]
    fn sync_operations_are_filtered_by_project_membership() {
        let (db, project) = project_database();
        let task = db
            .create_task(
                task_value("项目同步任务", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .expect("task should be created");

        assert!(!db
            .sync_operations_for_user(PENDING_MEMBER)
            .expect("sync operations should load")
            .iter()
            .any(|operation| operation.entity_id == task.id));
        assert!(db
            .sync_operations_for_user(APPROVED_MEMBER)
            .expect("sync operations should load")
            .iter()
            .any(|operation| operation.entity_id == task.id));
    }

    #[test]
    fn task_assignment_notifications_reach_only_the_recipient_and_remain_until_read() {
        let (source, project) = project_database();
        let mut value = task_value("离线指派任务", Some(&project.id), PROJECT_ADMIN);
        value["assigneeId"] = json!(APPROVED_MEMBER);
        let task = source
            .create_task(value, PROJECT_ADMIN)
            .expect("assigned task should be created");

        let source_notifications = source
            .task_assignment_notifications(APPROVED_MEMBER)
            .expect("source notification should load");
        assert_eq!(source_notifications.len(), 1);
        assert_eq!(source_notifications[0].task_id, task.id);
        assert_eq!(source_notifications[0].recipient_id, APPROVED_MEMBER);

        let operation = source
            .lan_operations_for_user(APPROVED_MEMBER)
            .expect("recipient operations should load")
            .into_iter()
            .find(|operation| operation.entity_type == "task_assignment")
            .expect("assignment notification should be synchronized");
        assert!(!source
            .lan_operations_for_user(PENDING_MEMBER)
            .expect("other user operations should load")
            .iter()
            .any(|candidate| candidate.id == operation.id));

        let target = database();
        join_test_workspace(&target,&source);
        target
            .upsert_workspace_test_user(&test_user(APPROVED_MEMBER, "user"))
            .expect("recipient should be saved");
        target
            .set_current_user(APPROVED_MEMBER)
            .expect("recipient should become current user");
        assert!(target
            .apply_operation(&operation)
            .expect("offline notification should apply after synchronization"));
        assert!(!target
            .apply_operation(&operation)
            .expect("duplicate synchronization should be ignored"));

        let received = target
            .task_assignment_notifications(APPROVED_MEMBER)
            .expect("recipient notification should load");
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].task_title, "离线指派任务");
        assert_eq!(
            target
                .mark_task_assignment_notifications_read(
                    std::slice::from_ref(&received[0].id),
                    APPROVED_MEMBER,
                )
                .expect("notification should be marked read"),
            1
        );
        assert!(target
            .task_assignment_notifications(APPROVED_MEMBER)
            .expect("read notification query should succeed")
            .is_empty());
    }

    #[test]
    fn llm_config_migration_preserves_custom_openai_compatible_fields() {
        let db = database();
        let legacy = LlmConfig { generation_parameters:None,
            protocol: "anthropic".into(),
            base_url: "http://model-gateway.local/v1".into(),
            api_key: "existing-secret".into(),
            model_name: "company-model".into(),
        };
        db.conn
            .execute(
                "UPDATE llm_config SET payload_json=? WHERE id=1",
                params![serde_json::to_string(&legacy).expect("legacy config should serialize")],
            )
            .expect("legacy config should be stored");

        let migrated = db.llm_config().expect("legacy config should migrate");
        assert_eq!(migrated.protocol, "openai");
        assert_eq!(migrated.base_url, legacy.base_url);
        assert_eq!(migrated.api_key, legacy.api_key);
        assert_eq!(migrated.model_name, legacy.model_name);

        let saved = db
            .save_llm_config(json!({"protocol":"gemini","modelName":"company-model-v2"}))
            .expect("config should save as OpenAI compatible");
        assert_eq!(saved.protocol, "openai");
        assert_eq!(saved.base_url, legacy.base_url);
        assert_eq!(saved.api_key, legacy.api_key);
        assert_eq!(saved.model_name, "company-model-v2");
    }

    #[test]
    fn private_project_tasks_are_visible_to_project_admins_but_not_regular_members() {
        let (db, project) = project_database();
        let mut value = task_value("项目内私有任务", Some(&project.id), PROJECT_ADMIN);
        value["isShared"] = json!(false);
        let task = db
            .create_task(value, PROJECT_ADMIN)
            .expect("private project task should be created");

        assert!(db
            .tasks(Some(PROJECT_ADMIN))
            .expect("creator tasks should load")
            .iter()
            .any(|item| item.id == task.id));
        assert!(db
            .tasks(Some(PROJECT_CO_ADMIN))
            .expect("co-admin tasks should load")
            .iter()
            .any(|item| item.id == task.id));
        assert!(db
            .tasks(Some(APPROVED_MEMBER))
            .expect("member tasks should load")
            .iter()
            .all(|item| item.id != task.id));
        assert!(db
            .update_task(&task.id, json!({"status": "in_progress"}), PROJECT_ADMIN)
            .is_ok());
        assert!(db
            .update_task(&task.id, json!({"status": "completed"}), PROJECT_CO_ADMIN)
            .is_ok());
        assert!(db
            .update_task(&task.id, json!({"status": "completed"}), APPROVED_MEMBER)
            .is_err());
        assert!(!db
            .sync_operations_for_user(APPROVED_MEMBER)
            .expect("member sync operations should load")
            .iter()
            .any(|operation| operation.entity_id == task.id));
    }

    #[test]
    fn personal_lan_shared_tasks_are_readable_but_writable_only_by_creator_or_assignee() {
        let db = database();
        let creator = db.current_user_id().expect("current user should exist");
        let assignee = "shared-task-assignee@test-device";
        let reader = "shared-task-reader@test-device";
        db.upsert_workspace_test_user(&test_user(assignee, "user"))
            .expect("assignee should be saved");
        db.upsert_workspace_test_user(&test_user(reader, "user"))
            .expect("reader should be saved");

        let mut value = task_value("局域网共享只读测试", None, &creator);
        value["assigneeId"] = json!(assignee);
        value["isShared"] = json!(true);
        let task = db
            .create_task(value, &creator)
            .expect("shared task should be created");

        assert!(db
            .tasks(Some(reader))
            .expect("reader tasks should load")
            .iter()
            .any(|item| item.id == task.id));
        assert!(db
            .update_task(&task.id, json!({"status": "in_progress"}), reader)
            .is_err());
        assert!(db.delete_task(&task.id, reader).is_err());
        assert!(db
            .update_task(&task.id, json!({"status": "in_progress"}), assignee)
            .is_ok());
    }

    #[test]
    fn applying_the_same_operation_twice_is_idempotent() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let payload = {
            let mut value = task_value("远端任务", None, &operator);
            let map = value
                .as_object_mut()
                .expect("task payload should be an object");
            map.insert("id".into(), json!("task-remote-test"));
            map.insert("createdAt".into(), json!("2026-01-01T00:00:00Z"));
            map.insert("updatedAt".into(), json!("2026-01-01T00:00:00Z"));
            map.insert("version".into(), json!(9_000_000_000_000_i64));
            value
        };
        let operation = SyncOperation {
            workspace_id: Some(db.workspace_context().unwrap().workspace_id),
            id: "op-idempotency-test".into(),
            entity_type: "task".into(),
            entity_id: "task-remote-test".into(),
            action: "create".into(),
            payload,
            timestamp: "2026-01-01T00:00:00Z".into(),
            node_id: operator,
            version: 9_000_000_000_000,
            scope_id: None,
        };

        assert!(db
            .apply_operation(&operation)
            .expect("first operation should apply"));
        assert!(!db
            .apply_operation(&operation)
            .expect("duplicate operation should be ignored"));
        assert_eq!(
            db.tasks(None)
                .expect("tasks should load")
                .iter()
                .filter(|task| task.id == operation.entity_id)
                .count(),
            1
        );
    }

    #[test]
    fn remote_task_create_does_not_overwrite_an_existing_task_id() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let existing = db
            .create_task(task_value("保留本机内容", None, &operator), &operator)
            .expect("local task should be created");
        let mut replacement = existing.clone();
        replacement.title = "不应覆盖的远端内容".into();
        replacement.version += 10_000;
        let operation = SyncOperation {
            workspace_id: Some(db.workspace_context().unwrap().workspace_id),
            id: "op-create-existing-task".into(),
            entity_type: "task".into(),
            entity_id: existing.id.clone(),
            action: "create".into(),
            payload: serde_json::to_value(replacement).expect("task should serialize"),
            timestamp: "2026-09-07T00:00:00Z".into(),
            node_id: operator,
            version: existing.version + 10_001,
            scope_id: None,
        };

        assert!(db
            .apply_operation(&operation)
            .expect("new operation should be recorded"));
        let saved = db
            .tasks(None)
            .expect("tasks should load")
            .into_iter()
            .find(|task| task.id == existing.id)
            .expect("existing task should remain");
        assert_eq!(saved.title, "保留本机内容");
        assert_eq!(saved.version, existing.version);
    }

    /// Runs the layer-2 backfill again on a database whose tasks have been
    /// stripped back to their pre-migration shape.
    fn rerun_state_backfill(db: &Database) {
        db.conn
            .execute(
                "UPDATE tasks SET state_id=NULL,state_group=NULL,state_name=NULL",
                [],
            )
            .unwrap();
        db.conn
            .execute("DELETE FROM settings WHERE key='schemaMigrationsV1'", [])
            .unwrap();
        db.ensure_schema_v1().unwrap();
    }

    #[test]
    fn migration_backfills_task_states_without_logging_sync_operations() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let mut statuses = Vec::new();
        for status in ["todo", "in_progress", "blocked", "completed", "abandoned"] {
            let mut payload = task_value(&format!("migrate-{status}"), None, &operator);
            payload["status"] = json!(status);
            let task = db.create_task(payload, &operator).unwrap();
            statuses.push((status, task.id));
        }
        let before = db.sync_operations(0).unwrap().0.len();
        let clock_before = db.setting("localClock").unwrap();

        rerun_state_backfill(&db);

        // Re-logging would push hundreds of phantom operations to peers and
        // inflate the local clock.
        assert_eq!(db.sync_operations(0).unwrap().0.len(), before);
        assert_eq!(db.setting("localClock").unwrap(), clock_before);

        let tasks = db.tasks(None).unwrap();
        for (status, id) in &statuses {
            let task = tasks.iter().find(|task| &task.id == id).unwrap();
            let expected_group = legacy_status_to_group(status);
            assert!(
                task.state_id.is_some(),
                "task {id} kept a NULL state_id after migration"
            );
            assert_eq!(task.state_group.as_deref(), Some(expected_group.as_str()));
            // The legacy mirror is derived back from the group, so the
            // in_progress/blocked pair both land on `in_progress`.
            assert_eq!(task.status, expected_group.legacy_status());
        }
        // `in_progress` and `blocked` shared one legacy status literal, so the
        // pre-migration payload cannot say which of the two `started` states a
        // task belonged to. The backfill picks deterministically rather than
        // inventing a distinction the stored data never carried.
        let blocked = tasks.iter().find(|task| task.id == statuses[2].1).unwrap();
        assert_eq!(blocked.state_group.as_deref(), Some("started"));
        assert!(matches!(
            blocked.state_name.as_deref(),
            Some("In Progress") | Some("Blocked")
        ));
    }

    #[test]
    fn migration_backfill_never_overwrites_a_users_chosen_state() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let task = db.create_task(task_value("已选状态", None, &operator), &operator)
            .unwrap();
        let started = db
            .states(&operator)
            .unwrap()
            .into_iter()
            .find(|state| state.name == "In Progress")
            .unwrap();
        let moved = db
            .update_task(&task.id, json!({"stateId": started.id}), &operator)
            .unwrap();
        assert_eq!(moved.state_group.as_deref(), Some("started"));

        rerun_state_backfill(&db);

        let reloaded = db
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.id == task.id)
            .unwrap();
        assert_eq!(reloaded.state_id.as_deref(), Some(started.id.as_str()));
        assert_eq!(reloaded.state_group.as_deref(), Some("started"));
    }

    #[test]
    fn personal_states_seed_per_user_and_converge_under_insert_or_ignore() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let other = test_user("state-peer@test-device", "user");
        db.upsert_workspace_test_user(&other).unwrap();

        let mine = db.states_for_scope(None, Some(&operator)).unwrap();
        assert_eq!(mine.len(), 6);
        let names: Vec<&str> = mine.iter().map(|state| state.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Backlog", "Todo", "In Progress", "Blocked", "Done", "Cancelled"]
        );
        assert_eq!(
            mine.iter()
                .find(|state| state.name == "Blocked")
                .unwrap()
                .color,
            "#e11d48"
        );
        // Both `started` states exist, and only one of them is the default.
        let started: Vec<&models::State> =
            mine.iter().filter(|state| state.group == "started").collect();
        assert_eq!(started.len(), 2);
        assert_eq!(started.iter().filter(|state| state.is_default).count(), 1);

        // A second device seeding the same user derives identical IDs, so the
        // INSERT OR IGNORE in `seed_states_for_scope` converges instead of
        // duplicating the list.
        let before = db.states_for_scope(None, Some(&operator)).unwrap().len();
        db.seed_states_for_scope(None, Some(&operator), "2030-01-01T00:00:00Z")
            .unwrap();
        assert_eq!(
            db.states_for_scope(None, Some(&operator)).unwrap().len(),
            before
        );
        assert_ne!(
            db.states_for_scope(None, Some(&operator)).unwrap()[0].id,
            db.states_for_scope(None, Some(&other.id)).unwrap()[0].id
        );
    }

    #[test]
    fn projects_seed_their_own_state_list_and_stamp_identifiers() {
        let (db, project) = project_database();
        let states = db.states_for_scope(Some(&project.id), None).unwrap();
        assert_eq!(states.len(), 6);
        assert_eq!(states[0].name, "Backlog");
        assert!(states
            .iter()
            .all(|state| state.project_id.as_deref() == Some(project.id.as_str())));
        assert!(states.iter().all(|state| state.owner_id.is_none()));

        let task = db
            .create_task(
                task_value("标识测试", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .unwrap();
        let identifier = db
            .projects(None)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.id == project.id)
            .unwrap()
            .identifier
            .unwrap();
        assert_eq!(
            task.identifier.as_deref(),
            Some(format!("{identifier}-1").as_str())
        );
        assert_eq!(task.sequence_number, Some(1));
        let second = db
            .create_task(
                task_value("第二个", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .unwrap();
        assert_eq!(second.sequence_number, Some(2));

        // A personal task carries no identifier because it has no project.
        let personal = db
            .create_task(task_value("个人", None, PROJECT_ADMIN), PROJECT_ADMIN)
            .unwrap();
        assert!(personal.identifier.is_none());
    }

    #[test]
    fn deleting_a_state_in_use_is_refused_with_the_referencing_count() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let task = db
            .create_task(task_value("占用状态", None, &operator), &operator)
            .unwrap();
        let error = db
            .delete_state(task.state_id.as_deref().unwrap(), &operator)
            .unwrap_err();
        assert!(error.contains('1'), "expected a count in {error}");
        assert!(error.contains("Todo"));

        let started = db
            .states(&operator)
            .unwrap()
            .into_iter()
            .find(|state| state.name == "In Progress")
            .unwrap();
        db.update_task(&task.id, json!({"stateId": started.id}), &operator)
            .unwrap();
        assert!(db.delete_state(started.id.as_str(), &operator).is_err());

        let custom = db
            .create_state(json!({"name": "评审中", "group": "started"}), &operator)
            .unwrap();
        assert!(db.delete_state(&custom.id, &operator).unwrap());
        assert!(db.state_by_id(&custom.id).unwrap().is_none());
    }

    #[test]
    fn reordering_states_is_scoped_and_rejects_foreign_ids() {
        let (db, project) = project_database();
        let personal = db.states_for_scope(None, Some(PROJECT_ADMIN)).unwrap();
        let mut ordered: Vec<String> = personal.iter().map(|state| state.id.clone()).collect();
        ordered.reverse();
        let reordered = db
            .reorder_states(None, ordered.clone(), PROJECT_ADMIN)
            .unwrap();
        assert_eq!(
            reordered.iter().map(|state| state.id.clone()).collect::<Vec<_>>(),
            ordered
        );

        // A project list reorders independently of the personal one.
        let project_states = db.states_for_scope(Some(&project.id), None).unwrap();
        let mut flipped: Vec<String> = project_states.iter().map(|state| state.id.clone()).collect();
        flipped.reverse();
        db.reorder_states(Some(&project.id), flipped.clone(), PROJECT_ADMIN)
            .unwrap();
        assert_eq!(
            db.states_for_scope(Some(&project.id), None)
                .unwrap()
                .iter()
                .map(|state| state.id.clone())
                .collect::<Vec<_>>(),
            flipped
        );
        assert_eq!(
            db.states_for_scope(None, Some(PROJECT_ADMIN))
                .unwrap()
                .iter()
                .map(|state| state.id.clone())
                .collect::<Vec<_>>(),
            ordered
        );

        // A non-member cannot reorder a project's states, and a foreign id
        // cannot be smuggled into a personal list.
        assert!(db
            .reorder_states(Some(&project.id), flipped.clone(), APPROVED_MEMBER)
            .is_err());
        assert!(db
            .reorder_states(None, vec![project_states[0].id.clone()], PROJECT_ADMIN)
            .is_err());
        assert!(db
            .reorder_states(None, vec![ordered[0].clone(), ordered[0].clone()], PROJECT_ADMIN)
            .is_err());
        assert!(db.reorder_states(None, vec![], PROJECT_ADMIN).is_err());
    }

    #[test]
    fn workspace_membership_roles_and_status_stay_inside_the_contract() {
        let db = database();
        let workspace = db.workspace_record().unwrap();
        let joiner = test_user("contract@test-device", "user");
        db.upsert_workspace_test_user(&joiner).unwrap();
        for role in ["owner", "admin", "member", "guest", "nonsense"] {
            let member = db
                .request_workspace_membership(&joiner.id, Some(role))
                .unwrap();
            assert!(
                ["owner", "admin", "member", "guest"].contains(&member.role.as_str()),
                "unexpected role {}",
                member.role
            );
            assert!(
                ["member", "pending"].contains(&member.status.as_str()),
                "unexpected status {}",
                member.status
            );
        }

        // Approval promotes to admin, and a later removal reports `pending`
        // rather than a status outside the union.
        let approved = db
            .review_workspace_membership(&joiner.id, true, Some("admin"), &workspace.owner_id)
            .unwrap();
        assert_eq!(approved.role, "admin");
        assert_eq!(approved.status, "member");
        let removed = db
            .review_workspace_membership(&joiner.id, false, None, &workspace.owner_id)
            .unwrap();
        assert_eq!(removed.status, "pending");
        assert!(!db
            .workspace_members(&workspace.id)
            .unwrap()
            .iter()
            .any(|member| member.user_id == joiner.id));
        // A non-admin cannot review.
        assert!(db
            .review_workspace_membership(&joiner.id, true, None, joiner.id.as_str())
            .is_err());
    }

    #[test]
    fn state_choices_preserve_the_legacy_status_mapping() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let states = db.states(&operator).unwrap();
        let state = |name: &str| {
            states
                .iter()
                .find(|state| state.name == name)
                .unwrap()
                .id
                .clone()
        };
        let mut created = Vec::new();
        for name in ["Backlog", "Todo", "In Progress", "Blocked", "Done", "Cancelled"] {
            let mut payload = task_value(name, None, &operator);
            payload["stateId"] = json!(state(name));
            let task = db.create_task(payload, &operator).unwrap();
            created.push((name.to_string(), task));
        }
        for (name, task) in &created {
            let group = match name.as_str() {
                "Backlog" => StateGroup::Backlog,
                "Todo" => StateGroup::Unstarted,
                "In Progress" | "Blocked" => StateGroup::Started,
                "Done" => StateGroup::Completed,
                _ => StateGroup::Cancelled,
            };
            assert_eq!(task.status, group.legacy_status(), "wrong mirror for {name}");
            assert_eq!(task.state_group.as_deref(), Some(group.as_str()));
            // Only `Cancelled` sets `abandonedAt`.
            assert_eq!(task.abandoned_at.is_some(), name == "Cancelled");
        }
    }

    #[test]
    fn reopening_a_completed_task_clears_the_progress_mirror() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let task = db
            .create_task(task_value("重开任务", None, &operator), &operator)
            .unwrap();
        let done = db
            .update_task(&task.id, json!({"status": "completed"}), &operator)
            .unwrap();
        assert_eq!(done.status, "completed");
        assert_eq!(done.progress, 100);

        // Moving out of the completed group with no explicit progress has to
        // reset it, otherwise the task immediately re-closes itself.
        let reopened = db
            .update_task(&task.id, json!({"status": "todo"}), &operator)
            .unwrap();
        assert_eq!(reopened.status, "todo");
        assert_eq!(reopened.progress, 0);
        assert_eq!(reopened.state_group.as_deref(), Some("unstarted"));

        // The same move expressed as a state ID behaves identically.
        let done_state = db
            .states(&operator)
            .unwrap()
            .into_iter()
            .find(|state| state.name == "Done")
            .unwrap();
        let backlog = db
            .states(&operator)
            .unwrap()
            .into_iter()
            .find(|state| state.name == "Backlog")
            .unwrap();
        db.update_task(&task.id, json!({"stateId": done_state.id}), &operator)
            .unwrap();
        let moved = db
            .update_task(&task.id, json!({"stateId": backlog.id}), &operator)
            .unwrap();
        assert_eq!(moved.progress, 0);
        assert_eq!(moved.status, "todo");

        // An explicit progress still wins over the reset.
        db.update_task(&task.id, json!({"status": "completed"}), &operator)
            .unwrap();
        let partial = db
            .update_task(
                &task.id,
                json!({"status": "in_progress", "progress": 40}),
                &operator,
            )
            .unwrap();
        assert_eq!(partial.progress, 40);
        assert_eq!(partial.status, "in_progress");
        assert_eq!(partial.state_name.as_deref(), Some("In Progress"));

        // And moving into the completed group through a state ID fills it in.
        let completed = db
            .update_task(
                &task.id,
                json!({"stateId": done_state.id, "progress": 10}),
                &operator,
            )
            .unwrap();
        assert_eq!(completed.progress, 100);
        assert_eq!(completed.status, "completed");
    }

    #[test]
    fn progress_100_moves_an_unstarted_task_into_the_completed_group() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let task = db
            .create_task(task_value("进度完成", None, &operator), &operator)
            .unwrap();
        let completed = db
            .update_task(&task.id, json!({"progress": 100}), &operator)
            .unwrap();
        assert_eq!(completed.state_group.as_deref(), Some("completed"));
        assert_eq!(completed.status, "completed");

        // Creation follows the same precedence.
        let mut completing = task_value("创建即完成", None, &operator);
        completing["progress"] = json!(100);
        let created = db.create_task(completing, &operator).unwrap();
        assert_eq!(created.status, "completed");
        assert_eq!(created.state_group.as_deref(), Some("completed"));
        assert_eq!(created.progress, 100);

        // A cancelled task is not silently reopened by a progress write.
        let mut abandoning = task_value("已取消", None, &operator);
        abandoning["status"] = json!("abandoned");
        let cancelled = db.create_task(abandoning, &operator).unwrap();
        assert_eq!(cancelled.state_group.as_deref(), Some("cancelled"));
        let still_cancelled = db
            .update_task(&cancelled.id, json!({"progress": 100}), &operator)
            .unwrap();
        assert_eq!(still_cancelled.state_group.as_deref(), Some("cancelled"));
        assert_eq!(still_cancelled.status, "abandoned");
    }

    #[test]
    fn blocked_risks_stay_name_based_because_two_states_share_the_started_group() {
        let db = database();
        let operator = db.current_user_id().unwrap();
        let overdue = (Local::now() - Duration::days(3)).format("%Y-%m-%d").to_string();
        let mut in_progress = task_value("进行中 P1", None, &operator);
        in_progress["priority"] = json!("P1");
        in_progress["status"] = json!("in_progress");
        in_progress["dueDate"] = json!(overdue);
        let in_progress = db.create_task(in_progress, &operator).unwrap();
        assert_eq!(in_progress.state_name.as_deref(), Some("In Progress"));

        let mut blocked = task_value("阻塞 P1", None, &operator);
        blocked["priority"] = json!("P1");
        blocked["status"] = json!("blocked");
        blocked["dueDate"] = json!(overdue);
        let blocked = db.create_task(blocked, &operator).unwrap();
        assert_eq!(blocked.state_group.as_deref(), Some("started"));
        assert_eq!(blocked.state_name.as_deref(), Some("Blocked"));

        let warnings = db.risks(Some(&operator)).unwrap();
        let unassigned = warnings
            .iter()
            .find(|warning| warning.warning_type == "unassigned_p1")
            .expect("the blocked P1 task should warn");
        // A group-based comparison would also flag the in-progress P1 task.
        assert_eq!(unassigned.related_task_ids, vec![blocked.id]);
    }

    #[test]
    fn sync_filtering_never_leaks_state_operations_from_unjoined_projects() {
        let (db, project) = project_database();
        let custom = db
            .create_state(
                json!({"name": "评审中", "group": "started", "projectId": project.id}),
                PROJECT_ADMIN,
            )
            .unwrap();

        for operation in db.sync_operations_for_user(OUTSIDE_ADMIN).unwrap() {
            assert_ne!(
                operation.entity_type, "state",
                "a state operation for an unjoined project leaked to the outsider"
            );
        }
        assert!(db
            .sync_operations_for_user(PROJECT_ADMIN)
            .unwrap()
            .iter()
            .any(|operation| operation.entity_type == "state" && operation.entity_id == custom.id));

        // Personal state lists stay private to their owner.
        let personal = db
            .create_state(json!({"name": "我的待办", "group": "unstarted"}), APPROVED_MEMBER)
            .unwrap();
        assert!(db
            .sync_operations_for_user(APPROVED_MEMBER)
            .unwrap()
            .iter()
            .any(|operation| operation.entity_type == "state"
                && operation.entity_id == personal.id));
        for other in [PROJECT_ADMIN, OUTSIDE_ADMIN] {
            assert!(!db
                .sync_operations_for_user(other)
                .unwrap()
                .iter()
                .any(|operation| operation.entity_type == "state"
                    && operation.entity_id == personal.id));
        }
    }

    #[test]
    fn workspace_record_reuses_the_existing_settings_keys() {
        let db = database();
        let (workspace_id, workspace_name) = db.workspace().unwrap();
        let workspace = db.workspace_record().unwrap();
        assert_eq!(workspace.id, workspace_id);
        assert_eq!(workspace.name, workspace_name);
        // The P2P partition key must survive the migration untouched.
        assert_eq!(
            db.setting("workspaceId").unwrap().as_deref(),
            Some(workspace_id.as_str())
        );
        assert!(db.setting("workspaceToken").unwrap().is_some());
        assert!(db.setting("workspaceName").unwrap().is_some());

        let members = db.workspace_members(&workspace.id).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].user_id, db.current_user_id().unwrap());
        assert_eq!(members[0].role, "owner");
        assert_eq!(members[0].status, "member");

        // Renaming keeps the settings mirror in step, because the P2P runtime
        // still reads `workspaceName` directly.
        let renamed = db
            .update_workspace_record(json!({"name": "新名字"}), &workspace.owner_id)
            .unwrap();
        assert_eq!(renamed.name, "新名字");
        assert_eq!(
            db.setting("workspaceName").unwrap().as_deref(),
            Some("新名字")
        );
        assert_eq!(db.workspace().unwrap().1, "新名字");
        assert!(db
            .update_workspace_record(json!({"name": "越权"}), OUTSIDE_ADMIN)
            .is_err());
    }

    #[test]
    fn workspace_membership_needs_no_approval_but_project_membership_still_does() {
        let db = database();
        let workspace = db.workspace_record().unwrap();
        let joiner = test_user("joiner@test-device", "user");
        db.upsert_workspace_test_user(&joiner).unwrap();

        let member = db.request_workspace_membership(&joiner.id, None).unwrap();
        assert_eq!(member.status, "member");
        assert_eq!(member.role, "member");
        assert_eq!(
            db.workspace_members(&workspace.id)
                .unwrap()
                .iter()
                .filter(|member| member.user_id == joiner.id)
                .count(),
            1
        );
        // Re-requesting is idempotent rather than duplicating the row.
        db.request_workspace_membership(&joiner.id, Some("admin"))
            .unwrap();
        assert_eq!(
            db.workspace_members(&workspace.id)
                .unwrap()
                .iter()
                .filter(|member| member.user_id == joiner.id)
                .count(),
            1
        );
        // A self-requested `owner` role is downgraded: `workspaceToken` is the
        // cryptographic boundary, not the role string.
        let escalated = db
            .request_workspace_membership(&joiner.id, Some("owner"))
            .unwrap();
        assert_eq!(escalated.role, "member");

        // Membership rows are workspace-scoped. Only the join request rides the
        // lan-chat channel, because the request is logged before the joining
        // device holds the workspace secret.
        assert!(!db
            .lan_operations_for_user(&joiner.id)
            .unwrap()
            .iter()
            .any(|operation| operation.entity_type == "workspace_member"));
        let request = db.create_workspace_join_request("joiner", &joiner.id).unwrap();
        assert!(db
            .lan_operations_for_user(&joiner.id)
            .unwrap()
            .iter()
            .any(|operation| operation.entity_type == "workspace_join_request"
                && operation.entity_id == request.id));
        assert!(!db
            .lan_operations_for_user(OUTSIDE_ADMIN)
            .unwrap()
            .iter()
            .any(|operation| operation.entity_id == request.id));

        // A workspace member is still an outsider to an unjoined project.
        let project = db
            .create_project(json!({"name": "私有项目"}), &workspace.owner_id)
            .unwrap();
        assert!(db.projects(Some(&joiner.id)).unwrap().is_empty());
        assert!(db
            .states_for_scope(Some(&project.id), None)
            .unwrap()
            .iter()
            .all(|state| state.project_id.as_deref() == Some(project.id.as_str())));
    }

    #[test]
    fn a_pre_migration_database_upgrades_in_place_and_reopens_cleanly() {
        let path = std::env::temp_dir().join(format!(
            "lanmind-migration-{}.sqlite",
            Uuid::new_v4()
        ));
        let workspace_id;
        let task_id;
        {
            // Build the pre-migration schema by hand: no `states`, no
            // `workspaces`, no denormalized columns.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL, device_id TEXT NOT NULL,
                    nickname TEXT NOT NULL, role TEXT NOT NULL, ip TEXT NOT NULL, is_online INTEGER NOT NULL DEFAULT 1,
                    last_active TEXT NOT NULL, avatar TEXT);
                CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
                    color TEXT NOT NULL, created_by TEXT NOT NULL, admins_json TEXT NOT NULL, members_json TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL, project_id TEXT,
                    creator_id TEXT NOT NULL, assignee_id TEXT NOT NULL, updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE sync_operations (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL, timestamp TEXT NOT NULL,
                    node_id TEXT NOT NULL, version INTEGER NOT NULL, scope_id TEXT);
                "#,
            )
            .unwrap();
            let task = json!({
                "id": "task-legacy","title":"历史任务","description":"","priority":"P1","status":"in_progress",
                "progress":20,"dueDate":null,"recurrence":"none","recurrenceRule":null,"reminderTime":null,
                "creatorId":"legacy@test-device","assigneeId":"legacy@test-device","projectId":null,
                "parentTaskId":null,"contentMode":"markdown","abandonedAt":null,"isShared":false,
                "sharedWith":[],"subtasks":[],"attachments":[],"tags":[],"createdAt":"2026-01-01T00:00:00Z",
                "updatedAt":"2026-01-01T00:00:00Z","version":1
            });
            let admin = test_user("legacy@test-device", "admin");
            conn.execute(
                "INSERT INTO users(id,username,device_id,nickname,role,ip,is_online,last_active) VALUES(?,?,?,?,?,?,1,?)",
                params![admin.id, admin.username, admin.device_id, admin.nickname, admin.role, admin.ip, admin.last_active],
            ).unwrap();
            conn.execute(
                "INSERT INTO tasks(id,payload_json,project_id,creator_id,assignee_id,updated_at,version,deleted) VALUES('task-legacy',?,NULL,'legacy@test-device','legacy@test-device','2026-01-01T00:00:00Z',1,0)",
                params![task.to_string()],
            ).unwrap();
            conn.execute(
                "INSERT INTO sync_operations(id,entity_type,entity_id,action,payload_json,timestamp,node_id,version) VALUES('op-legacy','task','task-legacy','update',?,'2026-01-01T00:00:00Z','legacy@test-device',1)",
                params![task.to_string()],
            ).unwrap();
            for (key, value) in [
                ("currentUserId", "legacy@test-device"),
                ("workspaceId", "workspace-legacy-channel"),
                ("workspaceName", "遗留工作区"),
                ("workspaceToken", "legacy-token-value"),
                ("localClock", "1"),
            ] {
                conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", params![key, value]).unwrap();
            }
            drop(conn);
        }

        let db = Database::open(&path).expect("a pre-migration database must upgrade in place");
        // The P2P channel key is the one value that must never change.
        assert_eq!(
            db.workspace().unwrap(),
            ("workspace-legacy-channel".to_string(), "遗留工作区".to_string())
        );
        assert_eq!(db.workspace_token().unwrap(), "legacy-token-value");
        workspace_id = db.workspace_record().unwrap().id;
        assert_eq!(workspace_id, "workspace-legacy-channel");

        let task = db
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|task| task.id == "task-legacy")
            .expect("the legacy task must survive");
        task_id = task.id.clone();
        assert_eq!(task.state_group.as_deref(), Some("started"));
        assert_eq!(task.progress, 20);
        assert!(task.state_id.is_some());
        assert_eq!(db.states_for_scope(None, Some("legacy@test-device")).unwrap().len(), 6);

        // The historical operation payload keeps its original literal.
        let stored: String = db
            .conn
            .query_row(
                "SELECT payload_json FROM sync_operations WHERE id='op-legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored.contains("\"in_progress\""));

        // The migration marker makes a reopen a no-op.
        assert_eq!(db.setting("schemaMigrationsV1").unwrap().as_deref(), Some("1"));
        drop(db);
        let reopened = Database::open(&path).expect("reopening must stay clean");
        assert_eq!(reopened.tasks(None).unwrap().len(), 1);
        assert_eq!(reopened.states_for_scope(None, Some("legacy@test-device")).unwrap().len(), 6);
        let reloaded = reopened
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|task| task.id == task_id)
            .unwrap();
        assert_eq!(reloaded.status, "in_progress");
        drop(reopened);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_new_database_contains_only_the_local_identity() {
        let db = database();
        let users = db.users().expect("users should load");
        let (operations, _) = db.sync_operations(0).expect("sync log should load");

        assert_eq!(users.len(), 1);
        assert_eq!(users[0].role, "admin");
        assert!(db.projects(None).expect("projects should load").is_empty());
        assert!(db.tasks(None).expect("tasks should load").is_empty());
        assert!(operations.is_empty());

        for legacy_id in [
            "admin@dev-pc-01",
            "zhangsan@dev-pc-02",
            "lisi@dev-pc-03",
            "wangwu@dev-pc-04",
        ] {
            assert!(!users.iter().any(|user| user.id == legacy_id));
        }
    }

    #[test]
    fn legacy_cleanup_removes_only_fixed_demo_records() {
        let db = database();
        let custom_user = test_user("custom-user@custom-device", "user");
        let legacy_user = test_user("zhangsan@dev-pc-02", "user");
        db.upsert_workspace_test_user(&custom_user)
            .expect("custom user should be saved");
        db.upsert_workspace_test_user(&legacy_user)
            .expect("legacy user should be saved");
        let custom_project = db
            .create_project(
                json!({"id": "custom-project", "name": "自建项目"}),
                &custom_user.id,
            )
            .expect("custom project should be saved");
        db.create_project(
            json!({"id": "proj-001", "name": "示例项目"}),
            &legacy_user.id,
        )
        .expect("legacy project should be saved");
        db.conn
            .execute("DELETE FROM settings WHERE key='legacyDemoDataRemoved'", [])
            .expect("migration marker should reset");

        db.remove_legacy_demo_data()
            .expect("legacy cleanup should succeed");
        db.remove_legacy_demo_data()
            .expect("legacy cleanup should be idempotent");

        let users = db.users().expect("users should load");
        let projects = db.projects(None).expect("projects should load");
        assert!(users.iter().any(|user| user.id == custom_user.id));
        assert!(!users.iter().any(|user| user.id == legacy_user.id));
        assert!(projects
            .iter()
            .any(|project| project.id == custom_project.id));
        assert!(!projects.iter().any(|project| project.id == "proj-001"));
    }

    #[test]
    fn report_includes_tasks_from_the_entire_date_range() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let created = db
            .create_task(task_value("Mid-period task", None, &operator), &operator)
            .expect("task should be created");
        let mut payload = serde_json::to_value(&created).expect("task should serialize");
        payload["updatedAt"] = json!("2026-01-15T12:00:00Z");
        payload["dueDate"] = json!("2026-01-31T18:00:00Z");
        db.conn
            .execute(
                "UPDATE tasks SET payload_json=?, updated_at=? WHERE id=?",
                params![payload.to_string(), "2026-01-15T12:00:00Z", created.id],
            )
            .expect("task dates should be updated");
        db.conn
            .execute(
                "UPDATE sync_operations SET timestamp=? WHERE entity_type='task' AND entity_id=?",
                params!["2026-01-15T12:00:00Z", created.id],
            )
            .expect("task event date should match the historical fixture");

        let report = db
            .report_dataset(
                None,
                &operator,
                NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
                NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
            )
            .expect("report dataset should be generated");

        assert_eq!(report.metrics.pending_tasks_count, 1);
    }

    #[test]
    fn report_excludes_child_tasks_from_metrics_and_evidence() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let today = Local::now().date_naive();
        let tomorrow = today + Duration::days(1);
        let parent = db
            .create_task(task_value("Report parent", None, &operator), &operator)
            .expect("parent should be created");
        let mut completed_child = task_value("Completed child", None, &operator);
        completed_child["parentTaskId"] = json!(parent.id);
        let child = db.create_task(completed_child, &operator).expect("child should be created");
        db.update_task(&child.id, json!({"status":"completed"}), &operator)
            .expect("child should be completed");
        let mut blocked_child = task_value("Blocked child", None, &operator);
        blocked_child["parentTaskId"] = json!(parent.id);
        blocked_child["status"] = json!("blocked");
        blocked_child["dueDate"] = json!((today - Duration::days(1)).format("%Y-%m-%d").to_string());
        db.create_task(blocked_child, &operator).expect("blocked child should be created");
        let mut future_child = task_value("Future child", None, &operator);
        future_child["parentTaskId"] = json!(parent.id);
        future_child["dueDate"] = json!(tomorrow.format("%Y-%m-%d").to_string());
        db.create_task(future_child, &operator).expect("future child should be created");

        let report = db.report_dataset(None, &operator, today, tomorrow, today)
            .expect("report dataset should load");
        assert_eq!(report.records.len(), 1);
        assert_eq!(report.records[0].task.id, parent.id);
        assert_eq!(report.metrics.relevant_tasks_count, 1);
        assert_eq!(report.metrics.pending_tasks_count, 1);
        assert_eq!(report.metrics.completed_tasks_count, 0);
        assert_eq!(report.metrics.blocked_tasks_count, 0);
        assert_eq!(report.metrics.overdue_tasks_count, 0);
        assert_eq!(report.metrics.upcoming_tasks_count, 0);

        db.update_task(&child.id, json!({"parentTaskId":null}), &operator)
            .expect("child should be detached");
        let detached_report = db.report_dataset(None, &operator, today, tomorrow, today)
            .expect("report should include detached tasks");
        assert_eq!(detached_report.records.len(), 2);
        assert_eq!(detached_report.metrics.completed_tasks_count, 1);
    }

    #[test]
    fn report_uses_personal_scope_and_keeps_future_tasks_out_of_actual_metrics() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let today = Local::now().date_naive();
        let tomorrow = today + Duration::days(1);

        let mut future = task_value("Tomorrow plan", None, &operator);
        future["dueDate"] = json!(tomorrow.format("%Y-%m-%d").to_string());
        db.create_task(future, &operator)
            .expect("future task should be created");

        let other_user = "other@test-device";
        db.upsert_workspace_test_user(&test_user(other_user, "user"))
            .expect("other user should be saved");
        let mut other = task_value("Other user's task", None, other_user);
        other["id"] = json!("other-personal-task");
        other["createdAt"] = json!(today.format("%Y-%m-%dT08:00:00Z").to_string());
        other["updatedAt"] = json!(today.format("%Y-%m-%dT08:00:00Z").to_string());
        other["version"] = json!(2);
        db.insert_task_value(&other, false)
            .expect("other task should be inserted");

        let dataset = db
            .report_dataset(None, &operator, today, tomorrow, today)
            .expect("report dataset should load");

        assert_eq!(dataset.metrics.relevant_tasks_count, 0);
        assert_eq!(dataset.metrics.upcoming_tasks_count, 1);
        assert!(dataset
            .records
            .iter()
            .all(|record| record.task.title != "Other user's task"));
    }

    #[test]
    fn report_counts_real_completion_transitions() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let today = Local::now().date_naive();
        let task = db
            .create_task(task_value("Completed today", None, &operator), &operator)
            .expect("task should be created");
        db.update_task(&task.id, json!({"status":"completed"}), &operator)
            .expect("task should be completed");

        let dataset = db
            .report_dataset(None, &operator, today, today, today)
            .expect("report dataset should load");

        assert_eq!(dataset.metrics.completed_tasks_count, 1);
        assert_eq!(dataset.metrics.progressed_tasks_count, 0);
        assert_eq!(dataset.records[0].status_as_of, "completed");
    }

    #[test]
    fn report_does_not_recount_tasks_completed_before_the_period() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let today = Local::now().date_naive();
        let yesterday = today - Duration::days(1);
        let mut completed = task_value("Previously completed", None, &operator);
        completed["status"] = json!("completed");
        completed["dueDate"] = json!(today.format("%Y-%m-%d").to_string());
        let task = db
            .create_task(completed, &operator)
            .expect("completed task should be created");
        let historical_timestamp = format!("{}T12:00:00+08:00", yesterday.format("%Y-%m-%d"));
        db.conn
            .execute(
                "UPDATE sync_operations SET timestamp=? WHERE entity_type='task' AND entity_id=?",
                params![historical_timestamp, task.id],
            )
            .expect("task history should be moved before the report period");

        let dataset = db
            .report_dataset(None, &operator, today, today, today)
            .expect("report dataset should load");

        assert_eq!(dataset.metrics.relevant_tasks_count, 0);
        assert_eq!(dataset.metrics.completed_tasks_count, 0);
    }

    #[test]
    fn chat_unread_summaries_are_grouped_by_conversation_and_persist_read_state() {
        let db = database();
        let current = db.current_user_id().expect("current user should exist");
        let peer = "unread-peer@test-device";
        db.upsert_workspace_test_user(&test_user(peer, "user")).expect("peer should exist");
        let group = db
            .save_chat_group(
                json!({"name":"未读测试群","memberIds":[peer],"createdBy":current,"avatar":"👥"}),
                &current,
            )
            .expect("group should be created");

        db.save_chat_message(json!({
            "id":"unread-direct-1","senderId":peer,"senderName":"Peer",
            "receiverId":current,"type":"text","content":"direct","timestamp":"2026-01-01T00:00:01Z","readBy":[]
        })).expect("direct message should save");
        db.save_chat_message(json!({
            "id":"unread-direct-read","senderId":peer,"senderName":"Peer",
            "receiverId":current,"type":"text","content":"already read","timestamp":"2026-01-01T00:00:02Z","readBy":[current]
        })).expect("read message should save");
        db.save_chat_message(json!({
            "id":"unread-broadcast-1","senderId":peer,"senderName":"Peer",
            "type":"text","content":"broadcast","timestamp":"2026-01-01T00:00:03Z","readBy":[]
        })).expect("broadcast should save");
        db.save_chat_message(json!({
            "id":"unread-group-1","senderId":peer,"senderName":"Peer",
            "groupId":group.id,"type":"file","content":"spec.pdf","fileName":"spec.pdf","timestamp":"2026-01-01T00:00:04Z","readBy":[]
        })).expect("group message should save");

        let summaries = db.chat_unread_summaries(&current).expect("summaries should load");
        assert_eq!(summaries.len(), 3);
        assert_eq!(summaries.iter().find(|item| item.key == format!("user:{peer}")).unwrap().count, 1);
        assert_eq!(summaries.iter().find(|item| item.key == "broadcast").unwrap().count, 1);
        assert_eq!(summaries.iter().find(|item| item.key == format!("group:{}", group.id)).unwrap().count, 1);

        db.mark_chat_messages_read(&["unread-direct-1".into()], &current)
            .expect("message should be marked read");
        assert!(db
            .chat_unread_summaries(&current)
            .expect("summaries should reload")
            .iter()
            .all(|item| item.key != format!("user:{peer}")));
    }

    #[test]
    fn chat_search_matches_text_and_file_name_and_returns_context() {
        let db = database();
        let current = db.current_user_id().expect("current user should exist");
        let peer = "search-peer@test-device";
        db.upsert_workspace_test_user(&test_user(peer, "user")).expect("peer should exist");
        for (id, content, file_name, timestamp) in [
            ("search-1", "architecture discussion", None, "2026-01-01T00:00:01Z"),
            ("search-2", "attachment", Some("LanMind-Guide.PDF"), "2026-01-01T00:00:02Z"),
            ("search-3", "unrelated", None, "2026-01-01T00:00:03Z"),
        ] {
            db.save_chat_message(json!({
                "id":id,"senderId":peer,"senderName":"Peer","receiverId":current,
                "type":if file_name.is_some() { "file" } else { "text" },"content":content,
                "fileName":file_name,"timestamp":timestamp,"readBy":[]
            })).expect("search message should save");
        }

        let text_page = db.search_chat_messages(&current, "user", Some(peer), "ARCH", None, 50)
            .expect("text search should work");
        assert_eq!(text_page.total, 1);
        assert_eq!(text_page.results[0].message.id, "search-1");
        let file_page = db.search_chat_messages(&current, "user", Some(peer), "guide.pdf", None, 50)
            .expect("file search should work");
        assert_eq!(file_page.total, 1);
        assert_eq!(file_page.results[0].message.id, "search-2");

        let context = db.chat_message_context(&current, "user", Some(peer), "search-2", 1, 1)
            .expect("context should load");
        assert_eq!(context.len(), 3);
        assert_eq!(context[1].id, "search-2");
    }

    #[test]
    fn chat_message_page_returns_recent_rows_and_stable_cursor_pages() {
        let db = database();
        let current = db.current_user_id().expect("current user should exist");
        let peer = "page-peer@test-device";
        db.upsert_workspace_test_user(&test_user(peer, "user")).expect("peer should exist");
        for index in 0..65 {
            db.save_chat_message(json!({
                "id": format!("page-{index:03}"),
                "senderId": peer,
                "senderName": "Peer",
                "receiverId": current,
                "type": "text",
                "content": format!("message {index}"),
                "timestamp": format!(
                    "2026-01-01T00:{:02}:{:02}Z",
                    index / 60,
                    index % 60
                ),
                "readBy": []
            }))
            .expect("paged message should save");
        }

        let first = db
            .chat_message_page(&current, "user", Some(peer), None, 30)
            .expect("first page should load");
        assert_eq!(first.messages.len(), 30);
        assert!(first.has_more);
        assert_eq!(first.messages.first().unwrap().id, "page-035");
        assert_eq!(first.messages.last().unwrap().id, "page-064");

        let second = db
            .chat_message_page(&current, "user", Some(peer), first.next_cursor.as_deref(), 30)
            .expect("second page should load");
        assert_eq!(second.messages.len(), 30);
        assert!(second.has_more);
        assert_eq!(second.messages.first().unwrap().id, "page-005");
        assert_eq!(second.messages.last().unwrap().id, "page-034");
        assert!(first
            .messages
            .iter()
            .all(|message| !second.messages.iter().any(|older| older.id == message.id)));
    }

    #[test]
    fn chat_group_creator_is_admin_and_only_admins_manage_members() {
        let db = database();
        let owner = db.current_user_id().expect("current user should exist");
        let member = "chat-member@test-device";
        let outsider = "chat-outsider@test-device";
        db.upsert_workspace_test_user(&test_user(member, "user"))
            .expect("member should be saved");
        db.upsert_workspace_test_user(&test_user(outsider, "user"))
            .expect("outsider should be saved");

        let group = db
            .save_chat_group(
                json!({
                    "name": "成员管理测试群",
                    "memberIds": [member],
                    "createdBy": owner,
                    "description": "测试",
                    "avatar": "group"
                }),
                &owner,
            )
            .expect("group should be created");

        assert!(group.admin_ids.contains(&owner));
        assert!(group.member_ids.contains(&owner));
        assert!(db
            .update_chat_group_members(&group.id, vec![member.into()], None, outsider)
            .is_err());

        let updated = db
            .update_chat_group_members(
                &group.id,
                vec![member.into()],
                Some(vec![member.into()]),
                &owner,
            )
            .expect("owner should update members and admins");
        assert!(updated.member_ids.contains(&owner));
        assert!(updated.member_ids.contains(&member.to_string()));
        assert!(updated.admin_ids.contains(&member.to_string()));
        assert!(!updated.member_ids.contains(&outsider.to_string()));
    }

    #[test]
    fn associated_chat_groups_require_project_membership() {
        let (db, project) = project_database();
        let group_value = |created_by: &str| {
            json!({
                "name": "项目协同群",
                "memberIds": [created_by, PROJECT_ADMIN],
                "createdBy": created_by,
                "description": "项目成员权限测试",
                "avatar": "group",
                "projectId": project.id.clone()
            })
        };

        assert!(db
            .save_chat_group(group_value(PENDING_MEMBER), PENDING_MEMBER)
            .is_err());

        let group = db
            .save_chat_group(group_value(APPROVED_MEMBER), APPROVED_MEMBER)
            .expect("project member should create an associated group");
        let message = db
            .save_chat_message(json!({
                "senderId": APPROVED_MEMBER,
                "senderName": "项目成员",
                "groupId": group.id.clone(),
                "type": "text",
                "content": "项目群消息"
            }))
            .expect("group message should be saved");
        assert!(db
            .chat_groups_for_user(APPROVED_MEMBER)
            .expect("member groups should load")
            .iter()
            .any(|item| item.id == group.id));
        assert!(!db
            .chat_groups_for_user(PENDING_MEMBER)
            .expect("outsider groups should load")
            .iter()
            .any(|item| item.id == group.id));
        assert!(db
            .chat_messages(APPROVED_MEMBER, None)
            .expect("member messages should load")
            .iter()
            .any(|item| item.id == message.id));
        assert!(!db
            .chat_messages(PENDING_MEMBER, None)
            .expect("outsider messages should load")
            .iter()
            .any(|item| item.id == message.id));

        db.update_project(
            &project.id,
            json!({"members": [PROJECT_ADMIN]}),
            PROJECT_ADMIN,
        )
        .expect("project admin should remove the member");
        assert!(db
            .chat_groups_for_user(APPROVED_MEMBER)
            .expect("historical groups should remain")
            .iter()
            .any(|item| item.id == group.id));
        assert!(db
            .chat_messages(APPROVED_MEMBER, None)
            .expect("historical messages should remain")
            .iter()
            .any(|item| item.id == message.id));

        let new_message = db
            .save_chat_message(json!({
                "senderId": PROJECT_ADMIN,
                "senderName": "项目管理员",
                "groupId": group.id.clone(),
                "type": "text",
                "content": "成员退出后的新消息"
            }))
            .expect("current project member should send a new message");
        assert!(!db
            .lan_operations_for_user(APPROVED_MEMBER)
            .expect("removed member operations should load")
            .iter()
            .any(|operation| operation.entity_id == new_message.id));
    }

    #[test]
    fn clearing_chat_removes_only_the_current_conversation() {
        let db = database();
        let current = db.current_user_id().expect("current user should exist");
        let peer = "chat-peer@test-device";
        let group = db
            .save_chat_group(
                json!({
                    "id": "group-test",
                    "name": "清空会话测试群",
                    "memberIds": [current.clone()],
                    "createdBy": current.clone()
                }),
                &current,
            )
            .expect("test group should be saved");
        for (id, sender_id, receiver_id, group_id) in [
            ("direct-message-sent", current.as_str(), Some(peer), None),
            (
                "direct-message-received",
                peer,
                Some(current.as_str()),
                None,
            ),
            ("broadcast-message", peer, None, None),
            (
                "group-message",
                current.as_str(),
                None,
                Some(group.id.as_str()),
            ),
        ] {
            db.save_chat_message(json!({
                "id": id,
                "senderId": sender_id,
                "senderName": "测试用户",
                "receiverId": receiver_id,
                "groupId": group_id,
                "type": "text",
                "content": id,
                "timestamp": "2026-07-25T12:00:00Z"
            }))
            .expect("message should be saved");
        }

        assert_eq!(
            db.clear_chat_messages(&current, "user", Some(peer))
                .expect("direct chat should clear"),
            2
        );
        let messages = db
            .chat_messages(&current, None)
            .expect("messages should load");
        assert!(!messages
            .iter()
            .any(|message| message.id == "direct-message-sent"));
        assert!(!messages
            .iter()
            .any(|message| message.id == "direct-message-received"));
        assert!(messages
            .iter()
            .any(|message| message.id == "broadcast-message"));
        assert!(messages.iter().any(|message| message.id == "group-message"));

        assert_eq!(
            db.clear_chat_messages(&current, "group", Some("group-test"))
                .expect("group chat should clear"),
            1
        );
        let messages = db
            .chat_messages(&current, None)
            .expect("messages should load");
        assert!(messages
            .iter()
            .any(|message| message.id == "broadcast-message"));
        assert!(!messages.iter().any(|message| message.id == "group-message"));

        assert_eq!(
            db.clear_chat_messages(&current, "broadcast", None)
                .expect("broadcast chat should clear"),
            1
        );
        assert!(db
            .chat_messages(&current, None)
            .expect("messages should load")
            .is_empty());
    }

    #[test]
    fn delete_and_mark_read_chat_messages() {
        let db = database();
        let current = db.current_user_id().expect("current user should exist");
        let peer = "reader-peer@test-device";

        let saved = db
            .save_chat_message(json!({
                "id": "test-msg-1",
                "senderId": current.as_str(),
                "senderName": "测试发送者",
                "receiverId": peer,
                "type": "text",
                "content": "这是一条待标记和删除的消息",
                "timestamp": "2026-07-25T12:00:00Z"
            }))
            .expect("message should be saved");

        assert_eq!(saved.read_by, Vec::<String>::new());

        let updated = db
            .mark_chat_messages_read(&["test-msg-1".to_string()], peer)
            .expect("marking read should succeed");
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].read_by, vec![peer.to_string()]);

        // Duplicate mark read returns 0 newly modified messages (idempotent)
        let updated2 = db
            .mark_chat_messages_read(&["test-msg-1".to_string()], peer)
            .expect("marking read again should succeed");
        assert_eq!(updated2.len(), 0);

        // Deleting message removes it
        db.delete_chat_message("test-msg-1", &current)
            .expect("delete should succeed");
        let messages = db.chat_messages(&current, None).expect("messages should load");
        assert!(!messages.iter().any(|m| m.id == "test-msg-1"));
    }

    #[test]
    fn lan_sync_includes_member_projects_and_tasks_but_excludes_outsiders() {
        let (db, project) = project_database();
        let task = db
            .create_task(
                task_value("项目成员可见任务", Some(&project.id), PROJECT_ADMIN),
                PROJECT_ADMIN,
            )
            .expect("project task should be created");
        db.save_chat_message(json!({
            "senderId": PROJECT_ADMIN,
            "senderName": "测试用户",
            "type": "text",
            "content": "局域网聊天消息"
        }))
        .expect("chat message should be saved");
        db.save_local_user_profile(&test_user(PROJECT_ADMIN, "admin"))
            .expect("local profile should be saved");

        let member_operations = db
            .lan_operations_for_user(APPROVED_MEMBER)
            .expect("member LAN operations should load");
        assert!(member_operations
            .iter()
            .any(|operation| operation.entity_type == "chat_message"));
        assert!(member_operations
            .iter()
            .any(|operation| operation.entity_type == "user_profile"));
        assert!(member_operations
            .iter()
            .any(|operation| operation.entity_id == project.id));
        assert!(member_operations
            .iter()
            .any(|operation| operation.entity_id == task.id));
        assert!(member_operations.iter().all(|operation| matches!(
            operation.entity_type.as_str(),
            "project" | "task" | "user_profile" | "chat_message" | "chat_group"
        )));

        let outsider_operations = db
            .lan_operations_for_user(PENDING_MEMBER)
            .expect("outsider LAN operations should load");
        assert!(!outsider_operations
            .iter()
            .any(|operation| operation.entity_id == project.id));
        assert!(!outsider_operations
            .iter()
            .any(|operation| operation.entity_id == task.id));
    }

    #[test]
    fn lan_sync_delivers_group_announcements_only_to_group_members() {
        let (db, project) = project_database();
        let group = db
            .save_chat_group(
                json!({
                    "id": "group-announcement-sync",
                    "name": "公告同步群",
                    "createdBy": PROJECT_ADMIN,
                    "createdAt": "2026-09-14T10:00:00Z",
                    "projectId": project.id,
                    "memberIds": [PROJECT_ADMIN, APPROVED_MEMBER],
                    "adminIds": [PROJECT_ADMIN]
                }),
                PROJECT_ADMIN,
            )
            .expect("group should be created");
        db.save_group_announcement(
            json!({
                "id": "announcement-sync-1",
                "groupId": group.id,
                "title": "离线公告",
                "content": "成员上线后应收到这条公告",
                "authorId": PROJECT_ADMIN,
                "authorName": "项目管理员",
                "createdAt": "2026-09-14T10:01:00Z"
            }),
            PROJECT_ADMIN,
        )
        .expect("announcement should be saved");

        let member_operations = db
            .lan_operations_for_user(APPROVED_MEMBER)
            .expect("member LAN operations should load");
        assert!(member_operations.iter().any(|operation| {
            operation.entity_type == "group_announcement"
                && operation.entity_id == "announcement-sync-1"
        }));

        let outsider_operations = db
            .lan_operations_for_user(PENDING_MEMBER)
            .expect("outsider LAN operations should load");
        assert!(!outsider_operations.iter().any(|operation| {
            operation.entity_type == "group_announcement"
                && operation.entity_id == "announcement-sync-1"
        }));
    }

    #[test]
    fn group_announcement_publish_generates_id_when_omitted() {
        let (db, _project) = project_database();
        let group = db
            .save_chat_group(
                json!({
                    "id": "test-group-announcement-generated-id",
                    "name": "公告 ID 测试群",
                    "createdBy": PROJECT_ADMIN,
                    "createdAt": "2026-09-14T10:00:00.000Z",
                    "memberIds": [PROJECT_ADMIN],
                    "adminIds": [PROJECT_ADMIN]
                }),
                PROJECT_ADMIN,
            )
            .expect("group should be created");

        let announcement = db
            .save_group_announcement(
                json!({
                    "groupId": group.id,
                    "title": "自动生成 ID",
                    "content": "创建公告时由后端生成 ID",
                    "authorId": PROJECT_ADMIN,
                    "authorName": "管理员",
                    "createdAt": "2026-09-14T10:01:00.000Z",
                    "readBy": [PROJECT_ADMIN]
                }),
                PROJECT_ADMIN,
            )
            .expect("announcement without id should be saved");

        assert!(announcement.id.starts_with("ann-"));

        let blank_id_announcement = db
            .save_group_announcement(
                json!({
                    "id": "  ",
                    "groupId": group.id,
                    "title": "空 ID 也能发布",
                    "content": "空白 ID 应由后端替换",
                    "authorId": PROJECT_ADMIN,
                    "authorName": "管理员",
                    "createdAt": "2026-09-14T10:02:00.000Z"
                }),
                PROJECT_ADMIN,
            )
            .expect("announcement with blank id should be saved");
        assert!(blank_id_announcement.id.starts_with("ann-"));
        assert_ne!(announcement.id, blank_id_announcement.id);

        let stored = db
            .group_announcements(&group.id)
            .expect("announcements should load");
        assert!(stored.iter().any(|item| item.id == announcement.id));
        assert!(stored
            .iter()
            .any(|item| item.id == blank_id_announcement.id));
    }

    #[test]
    fn group_announcement_crud_and_permissions() {
        let (db, _project) = project_database();
        let group = db
            .save_chat_group(
                json!({
                    "id": "test-group-announcements",
                    "name": "公告测试群",
                    "createdBy": PROJECT_ADMIN,
                    "createdAt": "2026-09-14T10:00:00.000Z",
                    "memberIds": [PROJECT_ADMIN, APPROVED_MEMBER, PENDING_MEMBER],
                    "adminIds": [PROJECT_ADMIN]
                }),
                PROJECT_ADMIN,
            )
            .expect("group should be created");

        // 1. Non-admin cannot publish announcement
        let fail_publish = db.save_group_announcement(
            json!({
                "id": "ann-1",
                "groupId": group.id,
                "title": "非法公告",
                "content": "普通成员发公告",
                "authorId": APPROVED_MEMBER,
                "authorName": "成员A",
                "createdAt": "2026-09-14T10:05:00.000Z"
            }),
            APPROVED_MEMBER,
        );
        assert!(fail_publish.is_err(), "non-admin cannot publish announcement");

        // 2. Admin can publish announcement
        let ann = db
            .save_group_announcement(
                json!({
                    "id": "ann-1",
                    "groupId": group.id,
                    "title": "项目上线通知",
                    "content": "本周五进行系统升级，请注意",
                    "authorId": PROJECT_ADMIN,
                    "authorName": "管理员",
                    "createdAt": "2026-09-14T10:10:00.000Z",
                    "pinned": false,
                    "readBy": [PROJECT_ADMIN]
                }),
                PROJECT_ADMIN,
            )
            .expect("admin should publish announcement");
        assert_eq!(ann.title, "项目上线通知");

        // 3. Mark read
        let marked = db
            .mark_group_announcement_read("ann-1", APPROVED_MEMBER)
            .expect("should mark announcement read");
        assert!(marked.read_by.contains(&APPROVED_MEMBER.to_string()));

        // 4. Pin announcement
        let pinned = db
            .pin_group_announcement("ann-1", true, PROJECT_ADMIN)
            .expect("admin should pin announcement");
        assert!(pinned.pinned);

        // 5. Query announcements
        let list = db
            .group_announcements(&group.id)
            .expect("should query announcements");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ann-1");

        // 6. Non-admin cannot delete announcement
        let fail_delete = db.delete_group_announcement("ann-1", APPROVED_MEMBER);
        assert!(fail_delete.is_err(), "non-admin cannot delete announcement");

        // 7. Admin can delete announcement
        db.delete_group_announcement("ann-1", PROJECT_ADMIN)
            .expect("admin should delete announcement");
        let empty_list = db
            .group_announcements(&group.id)
            .expect("should query announcements");
        assert_eq!(empty_list.len(), 0);
    }
}
