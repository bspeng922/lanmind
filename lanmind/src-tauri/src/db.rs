//! Local SQLite source of truth.
//!
//! Mutations that must reach peers append an idempotent sync operation. Purely
//! local preferences and actions, such as clearing local chat history, do not
//! create operations and therefore never delete data from another node.

use crate::models::{
    ChatGroup, ChatMessage, LlmConfig, McpConfig, Project, ReportMetrics, RiskWarning,
    SyncOperation, Task, TaskAssignmentNotification, TaskDataArchive, TaskImportResult,
    TaskUpdateResult, User,
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
        "todo" | "in_progress" | "completed" | "blocked"
    ) {
        return Err(format!("任务 {} 的状态无效", task.id));
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

pub struct Database {
    conn: Connection,
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
                deleted INTEGER NOT NULL DEFAULT 0
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
            "#,
        )
        .map_err(|e| e.to_string())?;

        let db = Self { conn };
        db.remove_legacy_demo_data()?;
        db.seed_if_empty()?;
        db.seed_templates()?;
        Ok(db)
    }

    fn remove_legacy_demo_data(&self) -> Result<(), String> {
        if self.setting("legacyDemoDataRemoved")?.as_deref() == Some("1") {
            return Ok(());
        }

        self.conn
            .execute_batch(
                r#"
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

        let config = LlmConfig {
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

    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key=?",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
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

    pub fn workspace(&self) -> Result<(String, String), String> {
        Ok((
            self.setting("workspaceId")?
                .ok_or_else(|| "工作区 ID 未初始化".to_string())?,
            self.setting("workspaceName")?
                .unwrap_or_else(|| "我的工作区".into()),
        ))
    }

    pub fn workspace_token(&self) -> Result<String, String> {
        self.setting("workspaceToken")?
            .ok_or_else(|| "工作区密钥未初始化".to_string())
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
        let token = self.mcp_config()?.token;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('mcpEnabled',?),('mcpPort',?),('mcpToken',?)",
                params![if enabled { "1" } else { "0" }, port.to_string(), token],
            )
            .map_err(|error| error.to_string())?;
        self.mcp_config()
    }

    pub fn rotate_mcp_token(&self) -> Result<McpConfig, String> {
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
        self.conn.execute("INSERT OR REPLACE INTO projects(id,name,description,color,created_by,admins_json,members_json,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,?,?,?,0)", params![project.id,project.name,project.description,project.color,project.created_by,serde_json::to_string(&project.admins).map_err(|e| e.to_string())?,serde_json::to_string(&project.members).map_err(|e| e.to_string())?,project.created_at,project.updated_at]).map_err(|e| e.to_string())?;
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
        })
    }

    pub fn projects(&self, user_id: Option<&str>) -> Result<Vec<Project>, String> {
        let mut stmt = self.conn.prepare("SELECT id,name,description,color,created_by,admins_json,members_json,created_at,updated_at FROM projects WHERE deleted=0 ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::project_from_row)
            .map_err(|e| e.to_string())?;
        let mut result = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if let Some(uid) = user_id {
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
        let mut admins = vec![operator.to_string()];
        admins.extend(requested_admins);
        admins.sort();
        admins.dedup();
        let mut members = vec![operator.to_string()];
        members.extend(requested_members);
        members.extend(admins.iter().cloned());
        members.sort();
        members.dedup();
        let id = map
            .remove("id")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("proj-{}", Uuid::new_v4().simple()));
        let project = Project {
            id,
            name: map
                .remove("name")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "未命名项目".into()),
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
        };
        self.insert_project(&project, true)?;
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
        }
        let previous_member_ids = project.members.clone();
        let mut current = serde_json::to_value(&project).map_err(|e| e.to_string())?;
        merge_json(&mut current, updates);
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
                "UPDATE projects SET deleted=1,updated_at=? WHERE id=? AND deleted=0",
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

    fn insert_task_value(&self, value: &Value, log: bool) -> Result<Task, String> {
        let task: Task =
            serde_json::from_value(value.clone()).map_err(|e| format!("任务数据无效: {e}"))?;
        self.conn.execute("INSERT OR REPLACE INTO tasks(id,payload_json,project_id,creator_id,assignee_id,updated_at,version,deleted) VALUES(?,?,?,?,?,?,?,0)", params![task.id, value.to_string(), task.project_id, task.creator_id, task.assignee_id, task.updated_at, task.version]).map_err(|e| e.to_string())?;
        if log {
            self.log_operation(
                "task",
                &task.id,
                "create",
                value.clone(),
                &task.creator_id,
                task.project_id.as_deref(),
            )?;
        }
        Ok(task)
    }

    pub fn tasks(&self, user_id: Option<&str>) -> Result<Vec<Task>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM tasks WHERE deleted=0 ORDER BY updated_at DESC")
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
        Ok(TaskDataArchive {
            archive_format: "lanmind-task-export".into(),
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            exported_by: user_id.to_string(),
            tasks: self.tasks(Some(user_id))?,
        })
    }

    pub fn import_task_archive(
        &self,
        archive: TaskDataArchive,
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

        let user_ids = self
            .users()?
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
        let mut existing_ids = {
            let mut statement = self
                .conn
                .prepare("SELECT id FROM tasks")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<HashSet<_>, _>>()
                .map_err(|error| error.to_string())?
        };

        self.conn
            .execute_batch("SAVEPOINT import_task_archive")
            .map_err(|error| error.to_string())?;
        let result = (|| {
            let mut imported_count = 0;
            let mut skipped_count = 0;
            let mut converted_count = 0;

            for mut task in archive.tasks {
                if !existing_ids.insert(task.id.clone()) {
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
                self.log_operation(
                    "task",
                    &task.id,
                    "create",
                    payload,
                    operator,
                    task.project_id.as_deref(),
                )?;
                imported_count += 1;
            }

            Ok(TaskImportResult {
                imported_count,
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
            .prepare("SELECT payload_json FROM tasks")
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
        let notification = TaskAssignmentNotification {
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
                "SELECT payload_json,read_at FROM task_assignment_notifications WHERE recipient_id=? AND read_at IS NULL ORDER BY created_at DESC",
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
                    "UPDATE task_assignment_notifications SET read_at=? WHERE id=? AND recipient_id=? AND read_at IS NULL",
                    params![read_at, id, recipient_id],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(updated)
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
        let task = self.insert_task_value(&Value::Object(map), true)?;
        self.notify_task_assignment(&task, operator)?;
        Ok(task)
    }

    pub fn update_task(&self, id: &str, updates: Value, operator: &str) -> Result<Task, String> {
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
        let task: Task = serde_json::from_value(merged.clone()).map_err(|e| e.to_string())?;
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
        if task.status != current.status {
            if let Some(payload) = operation_payload.as_object_mut() {
                payload.insert(
                    "_statusTransition".into(),
                    json!({"from": current.status, "to": task.status}),
                );
            }
        }
        self.conn.execute("UPDATE tasks SET payload_json=?,project_id=?,creator_id=?,assignee_id=?,updated_at=?,version=? WHERE id=?", params![merged.to_string(),task.project_id,task.creator_id,task.assignee_id,task.updated_at,task.version,id]).map_err(|e| e.to_string())?;
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
                "description": task.description.clone(),
                "priority": task.priority.clone(),
                "status": "todo",
                "dueDate": next_due,
                "reminderTime": next_reminder,
                "recurrence": task.recurrence.clone(),
                "recurrenceRule": task.recurrence_rule.clone(),
                "assigneeId": task.assignee_id.clone(),
                "projectId": task.project_id.clone(),
                "isShared": task.is_shared,
                "sharedWith": task.shared_with.clone(),
                "subtasks": task.subtasks.clone().into_iter().map(|mut subtask| {
                    subtask.completed = false;
                    subtask
                }).collect::<Vec<_>>(),
                "tags": task.tags.clone(),
            });
            Some(self.create_task(value, operator)?)
        } else {
            None
        };
        Ok(TaskUpdateResult { task, next_task })
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
                "UPDATE tasks SET deleted=1,version=? WHERE id=?",
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

    fn log_operation(
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
        };
        self.conn.execute("INSERT OR IGNORE INTO sync_operations(id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id) VALUES(?,?,?,?,?,?,?,?,?)", params![op.id,op.entity_type,op.entity_id,op.action,op.payload.to_string(),op.timestamp,op.node_id,op.version,op.scope_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn sync_operations(&self, since: i64) -> Result<(Vec<SyncOperation>, i64), String> {
        let mut stmt = self.conn.prepare("SELECT id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id FROM sync_operations WHERE version>? ORDER BY version ASC LIMIT 5000").map_err(|e| e.to_string())?;
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
                    scope_id: row.get(8)?,
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

    pub fn sync_operations_for_user(&self, user_id: &str) -> Result<Vec<SyncOperation>, String> {
        let (operations, _) = self.sync_operations(0)?;
        let projects = self.projects(None)?;
        let groups = self.chat_groups().unwrap_or_default();
        let tasks = self.task_visibility_index()?;
        Ok(operations
            .into_iter()
            .filter(|operation| {
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
                if operation.entity_type == "task_assignment" {
                    return operation.payload.get("recipientId").and_then(Value::as_str)
                        == Some(user_id);
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
                        .unwrap_or(true);
                }
                true
            })
            .collect())
    }

    pub fn lan_operations_for_user(&self, user_id: &str) -> Result<Vec<SyncOperation>, String> {
        Ok(self
            .sync_operations_for_user(user_id)?
            .into_iter()
            .filter(|operation| match operation.entity_type.as_str() {
                "project" | "task" | "task_assignment" | "user_profile" | "chat_message" => true,
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
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_operations WHERE id=?)",
                params![op.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            return Ok(false);
        }
        match (op.entity_type.as_str(), op.action.as_str()) {
            ("task", "create") => {
                let task_exists = self
                    .conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?)",
                        params![op.entity_id],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| error.to_string())?;
                if !task_exists {
                    let _ = self.insert_task_value(&op.payload, false)?;
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
                    self.conn.execute("UPDATE tasks SET payload_json=?,project_id=?,creator_id=?,assignee_id=?,updated_at=?,version=? WHERE id=? AND version<?", params![merged.to_string(),task.project_id,task.creator_id,task.assignee_id,task.updated_at,op.version,op.entity_id,op.version]).map_err(|e| e.to_string())?;
                }
            }
            ("task", "delete") => {
                self.conn
                    .execute(
                        "UPDATE tasks SET deleted=1,version=? WHERE id=? AND version<?",
                        params![op.version, op.entity_id, op.version],
                    )
                    .map_err(|e| e.to_string())?;
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
            ("project", "delete") => {
                let creator_id = self
                    .conn
                    .query_row(
                        "SELECT created_by FROM projects WHERE id=?",
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
                        "UPDATE projects SET deleted=1,updated_at=? WHERE id=?",
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
            ("chat_group", "create") => {
                let _ = self.save_chat_group_internal(op.payload.clone(), false)?;
            }
            ("chat_group", "update") => {
                let _ = self.save_chat_group_internal(op.payload.clone(), false)?;
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
        let tasks = self.tasks(user_id)?;
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
                    && t.status != "completed"
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
            .filter(|t| t.priority == "P1" && t.status == "blocked")
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
                    && t.status != "completed"
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
        self.conn
            .execute(
                "INSERT OR REPLACE INTO llm_config(id,payload_json) VALUES(1,?)",
                params![serde_json::to_string(&config).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        Ok(config)
    }
    pub fn templates(&self) -> Result<Vec<Value>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM ppt_templates ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
        })
        .collect()
    }
    pub fn add_template(&self, value: Value) -> Result<Value, String> {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_else(|| "tpl-custom");
        self.conn
            .execute(
                "INSERT OR REPLACE INTO ppt_templates(id,payload_json) VALUES(?,?)",
                params![id, value.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(value)
    }

    fn all_task_operations(&self) -> Result<Vec<SyncOperation>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,entity_type,entity_id,action,payload_json,timestamp,node_id,version,scope_id FROM sync_operations WHERE entity_type='task' ORDER BY version ASC")
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
                    scope_id: row.get(8)?,
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
            let mut status = create_operation
                .and_then(|operation| operation.payload.get("status"))
                .and_then(Value::as_str)
                .unwrap_or(task.status.as_str())
                .to_string();
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

                    if let Some(next_status) =
                        operation.payload.get("status").and_then(Value::as_str)
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
            let blocked_as_of = status == "blocked";
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
        target: Option<&str>,
    ) -> Result<Vec<ChatMessage>, String> {
        let visible_group_ids = self
            .chat_groups_for_user(current_user)?
            .into_iter()
            .map(|group| group.id)
            .collect::<Vec<_>>();
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM chat_messages ORDER BY timestamp ASC LIMIT 5000")
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
                || target
                    .map(|t| msg.receiver_id.as_deref() == Some(t) || msg.sender_id == t)
                    .unwrap_or(true)
            {
                output.push(msg);
            }
        }
        Ok(output)
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
                self.conn.execute(
                    "DELETE FROM chat_messages WHERE group_id=?",
                    params![group_id],
                )
            }
            "user" => {
                let peer_id = target_id.ok_or_else(|| "缺少联系人 ID".to_string())?;
                self.conn.execute(
                    "DELETE FROM chat_messages WHERE group_id IS NULL AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))",
                    params![current_user, peer_id, peer_id, current_user],
                )
            }
            "broadcast" => self.conn.execute(
                "DELETE FROM chat_messages WHERE group_id IS NULL AND receiver_id IS NULL",
                [],
            ),
            _ => return Err("不支持的对话类型".into()),
        }
        .map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    pub fn save_chat_message(&self, value: Value) -> Result<ChatMessage, String> {
        self.save_chat_message_internal(value, true)
    }
    fn save_chat_message_internal(&self, value: Value, log: bool) -> Result<ChatMessage, String> {
        let mut map = value.as_object().cloned().unwrap_or_default();
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
            .prepare("SELECT payload_json FROM chat_groups ORDER BY created_at")
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
        if group.admin_ids.is_empty() {
            group.admin_ids.push(group.created_by.clone());
        }
        if !group.admin_ids.iter().any(|id| id == &group.created_by) {
            group.admin_ids.push(group.created_by.clone());
        }
        for admin_id in group.admin_ids.clone() {
            if !group.member_ids.iter().any(|id| id == &admin_id) {
                group.member_ids.push(admin_id);
            }
        }
        group.member_ids.sort();
        group.member_ids.dedup();
        group.admin_ids.sort();
        group.admin_ids.dedup();
        group
    }

    fn chat_group_from_value(value: Value) -> Result<ChatGroup, String> {
        let mut map = value.as_object().cloned().unwrap_or_default();
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
        let group = Self::chat_group_from_value(value)?;
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
        let group = Self::chat_group_from_value(value)?;
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
        operator: &str,
    ) -> Result<ChatGroup, String> {
        let mut group = self
            .chat_groups()?
            .into_iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| "群组不存在或已被删除".to_string())?;
        if !group.admin_ids.iter().any(|id| id == operator) {
            return Err("只有群管理员可以管理成员".into());
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
            db.upsert_user(&test_user(id, role))
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
        TaskDataArchive {
            archive_format: "lanmind-task-export".into(),
            version: 1,
            exported_at: "2026-09-07T00:00:00Z".into(),
            exported_by: "exporter@test-device".into(),
            tasks,
        }
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
        db.upsert_user(&test_user(other_user, "user"))
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
    fn task_import_skips_existing_and_deleted_ids_and_converts_missing_references() {
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
                imported_count: 1,
                skipped_count: 1,
                converted_count: 1,
            }
        );
        let saved = db
            .tasks(Some(&operator))
            .expect("imported tasks should load")
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
        assert_eq!(duplicate.skipped_count, 1);
    }

    #[test]
    fn task_import_converts_a_private_task_that_would_be_hidden_from_the_importer() {
        let db = database();
        let operator = db.current_user_id().expect("current user should exist");
        let other_user = "private-import-owner@test-device";
        db.upsert_user(&test_user(other_user, "user"))
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
    fn only_the_creator_can_delete_a_project_and_the_deletion_syncs() {
        let source = database();
        let creator = source.current_user_id().expect("current user should exist");
        let delegated_admin = "delegated-admin@test-device";
        source
            .upsert_user(&test_user(delegated_admin, "user"))
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
        target
            .upsert_user(&test_user(APPROVED_MEMBER, "user"))
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
        let legacy = LlmConfig {
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
        db.upsert_user(&test_user(assignee, "user"))
            .expect("assignee should be saved");
        db.upsert_user(&test_user(reader, "user"))
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
        db.upsert_user(&custom_user)
            .expect("custom user should be saved");
        db.upsert_user(&legacy_user)
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
        db.upsert_user(&test_user(other_user, "user"))
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
    fn chat_group_creator_is_admin_and_only_admins_manage_members() {
        let db = database();
        let owner = db.current_user_id().expect("current user should exist");
        let member = "chat-member@test-device";
        let outsider = "chat-outsider@test-device";
        db.upsert_user(&test_user(member, "user"))
            .expect("member should be saved");
        db.upsert_user(&test_user(outsider, "user"))
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
            .update_chat_group_members(&group.id, vec![member.into()], outsider)
            .is_err());

        let updated = db
            .update_chat_group_members(&group.id, vec![member.into()], &owner)
            .expect("owner should update members");
        assert!(updated.member_ids.contains(&owner));
        assert!(updated.member_ids.contains(&member.to_string()));
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
}
