//! Serializable contracts shared by SQLite, Tauri IPC, and the LAN protocol.
//!
//! These camelCase payloads mirror `src/types.ts`; field changes must remain
//! backward compatible because older operations can still exist on peers.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseButtonBehavior {
    #[default]
    Tray,
    Exit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub device_id: String,
    pub nickname: String,
    pub role: String,
    pub ip: String,
    pub is_online: bool,
    pub last_active: String,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOrgUnit {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOrgMember {
    pub org_unit_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectory {
    #[serde(default)]
    pub units: Vec<LocalOrgUnit>,
    #[serde(default)]
    pub members: Vec<LocalOrgMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub created_by: String,
    pub admins: Vec<String>,
    pub members: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_status: Option<String>,
    /// Owning workspace. Older payloads predate workspaces, so the field is
    /// defaulted rather than required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(default)]
    pub next_work_item_sequence: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
}

/// Workflow grouping shared by every state. Mirrors `StateGroup` in the
/// renderer's `src/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StateGroup {
    Backlog,
    Unstarted,
    Started,
    Completed,
    Cancelled,
}

impl StateGroup {
    /// Every group, in board order. Kept as the single vocabulary used by
    /// validation and error messages so a new group cannot be added in one
    /// place and forgotten in another.
    pub const ALL: [StateGroup; 5] = [
        StateGroup::Backlog,
        StateGroup::Unstarted,
        StateGroup::Started,
        StateGroup::Completed,
        StateGroup::Cancelled,
    ];

    /// All accepted `group` string values.
    #[allow(dead_code)]
    pub fn all_names() -> Vec<&'static str> {
        Self::ALL.iter().map(StateGroup::as_str).collect()
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            StateGroup::Backlog => "backlog",
            StateGroup::Unstarted => "unstarted",
            StateGroup::Started => "started",
            StateGroup::Completed => "completed",
            StateGroup::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<StateGroup> {
        match value {
            "backlog" => Some(StateGroup::Backlog),
            "unstarted" => Some(StateGroup::Unstarted),
            "started" => Some(StateGroup::Started),
            "completed" => Some(StateGroup::Completed),
            "cancelled" => Some(StateGroup::Cancelled),
            _ => None,
        }
    }

    /// Display colour seeded for the default state of this group.
    pub fn default_color(&self) -> &'static str {
        match self {
            StateGroup::Backlog => "#d9d9d9",
            StateGroup::Unstarted => "#3f76ff",
            StateGroup::Started => "#f59e0b",
            StateGroup::Completed => "#16a34a",
            StateGroup::Cancelled => "#dc2626",
        }
    }

    /// Compatibility mirror written to the deprecated `Task.status` column.
    pub fn legacy_status(&self) -> &'static str {
        match self {
            StateGroup::Backlog | StateGroup::Unstarted => "todo",
            StateGroup::Started => "in_progress",
            StateGroup::Completed => "completed",
            StateGroup::Cancelled => "abandoned",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub name: String,
    pub color: String,
    pub group: String,
    /// `None` marks a personal-task state list owned by `owner_id`.
    pub project_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    pub sequence: i64,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub timezone: String,
    pub owner_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMember {
    pub workspace_id: String,
    pub user_id: String,
    pub role: String,
    pub status: String,
    pub requested_at: String,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub reviewed_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceJoinRequest {
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub user_id: String,
    pub user_name: String,
    pub status: String,
    pub requested_at: String,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub reviewed_by: Option<String>,
}

fn default_task_content_mode() -> String {
    "markdown".into()
}

fn default_recurrence_interval() -> u16 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    #[serde(default = "default_recurrence_interval")]
    pub interval: u16,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub days_of_week: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_of_month: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month_of_year: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub mime_type: String,
    #[serde(default)]
    pub data_url: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    /// Deprecated compatibility mirror of `state_group`.
    ///
    /// Kept readable and writable forever: un-upgraded peers and historical
    /// sync payloads in `sync_operations` still carry the original literal
    /// values, and `apply_operation`'s idempotency check depends on them.
    pub status: String,
    /// Work item state. `None` only for rows that predate the migration.
    #[serde(default)]
    pub state_id: Option<String>,
    #[serde(default)]
    pub state_group: Option<String>,
    #[serde(default)]
    pub state_name: Option<String>,
    /// Human-facing `<PROJECT>-<n>` reference.
    #[serde(default)]
    pub identifier: Option<String>,
    #[serde(default)]
    pub sequence_number: Option<i64>,
    #[serde(default)]
    pub progress: u8,
    #[serde(default)]
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub recurrence: Option<String>,
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
    pub reminder_time: Option<String>,
    pub creator_id: String,
    pub assignee_id: String,
    pub project_id: Option<String>,
    #[serde(default)]
    pub parent_task_id: Option<String>,
    #[serde(default = "default_task_content_mode")]
    pub content_mode: String,
    #[serde(default)]
    pub abandoned_at: Option<String>,
    pub is_shared: bool,
    pub shared_with: Vec<String>,
    pub subtasks: Vec<Subtask>,
    #[serde(default)]
    pub attachments: Vec<TaskAttachment>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateResult {
    pub task: Task,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_task: Option<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCommentQuote {
    pub comment_id: String,
    pub author_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskComment {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub task_id: String,
    pub author_id: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<TaskCommentQuote>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivity {
    pub id: String,
    pub task_id: String,
    pub action: String,
    pub actor_id: String,
    pub timestamp: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPage<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    /// Local insertion boundary. Remote operations can arrive with older versions.
    pub snapshot: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogPage {
    #[serde(flatten)]
    pub records: RecordPage<SyncOperation>,
    pub latest_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDataArchive {
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(rename = "format")]
    pub archive_format: String,
    pub version: u32,
    pub exported_at: String,
    pub exported_by: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExportResult {
    pub exported_count: usize,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskImportResult {
    pub imported_count: usize,
    pub restored_count: usize,
    pub skipped_count: usize,
    pub converted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub running: bool,
    pub endpoint: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WebConfig {
    pub read_only: bool,
    pub enabled: bool,
    pub bind_address: String,
    pub port: u16,
    pub password_hash: String,
    pub password_protected: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebStatus {
    pub read_only: bool,
    pub enabled: bool,
    pub bind_address: String,
    pub port: u16,
    pub password_configured: bool,
    pub running: bool,
    pub endpoint: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignmentNotification {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub task_id: String,
    pub task_title: String,
    pub recipient_id: String,
    pub assigner_id: String,
    pub assigner_name: String,
    pub project_id: Option<String>,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOperation {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub payload: Value,
    pub timestamp: String,
    pub node_id: String,
    pub version: i64,
    pub scope_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub protocol: String,
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub generation_parameters: Option<crate::ai_types::ModelParameters>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskWarning {
    pub id: String,
    pub level: String,
    #[serde(rename = "type")]
    pub warning_type: String,
    pub title: String,
    pub description: String,
    pub related_task_ids: Vec<String>,
    pub ai_recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickParseResult {
    #[serde(default)]
    pub title: String,
    pub due_date: Option<String>,
    pub reminder_time: Option<String>,
    #[serde(default)]
    pub priority: String,
    pub project_name: Option<String>,
    pub assignee_name: Option<String>,
    pub recurrence: Option<String>,
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMetrics {
    pub relevant_tasks_count: usize,
    pub completed_tasks_count: usize,
    pub progressed_tasks_count: usize,
    pub pending_tasks_count: usize,
    pub blocked_tasks_count: usize,
    pub overdue_tasks_count: usize,
    pub upcoming_tasks_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSectionItem {
    #[serde(default)]
    pub headline: String,
    #[serde(default)]
    pub detail: String,
    pub impact: Option<String>,
    pub next_action: Option<String>,
    #[serde(default)]
    pub task_ids: Vec<String>,
    pub severity: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    pub purpose: Option<String>,
    pub conclusion: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub items: Vec<ReportSectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSourceTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub status: String,
    pub due_date: Option<String>,
    pub assignee_id: String,
    pub project_id: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedReport {
    pub title: String,
    #[serde(rename = "type")]
    pub report_type: String,
    pub period: String,
    pub as_of: String,
    pub generated_at: String,
    pub audience: String,
    pub key_takeaway: String,
    pub executive_summary: String,
    pub metrics: ReportMetrics,
    pub sections: Vec<ReportSection>,
    pub data_notes: Vec<String>,
    pub raw_markdown: String,
    pub source_tasks: Vec<ReportSourceTask>,
    pub generation_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationRelation {
    #[serde(rename = "type")]
    pub relation_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationVisual {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub metric_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSupportingPoint {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSlide {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub purpose: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub core_message: String,
    pub relation_to_previous: PresentationRelation,
    #[serde(default)]
    pub layout: String,
    pub visual: PresentationVisual,
    #[serde(default)]
    pub supporting_points: Vec<PresentationSupportingPoint>,
    #[serde(default)]
    pub speaker_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPresentation {
    pub title: String,
    #[serde(rename = "type")]
    pub report_type: String,
    pub period: String,
    pub as_of: String,
    pub generated_at: String,
    pub audience: String,
    pub key_takeaway: String,
    pub metrics: ReportMetrics,
    pub slides: Vec<PresentationSlide>,
    pub data_notes: Vec<String>,
    pub generation_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGroup {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    #[serde(default)]
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub admin_ids: Vec<String>,
    pub created_by: String,
    pub created_at: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAnnouncement {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub content: String,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub read_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub sender_avatar: Option<String>,
    pub receiver_id: Option<String>,
    pub group_id: Option<String>,
    #[serde(rename = "type")]
    pub message_type: String,
    pub content: String,
    pub file_url: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<String>,
    pub timestamp: String,
    #[serde(default)]
    pub read_by: Vec<String>,
    #[serde(default)]
    pub reply_to: Option<serde_json::Value>,
    #[serde(default)]
    pub mentions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChatConversationRef {
    Broadcast,
    User { target_id: String },
    Group { target_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUnreadSummary {
    pub key: String,
    pub conversation: ChatConversationRef,
    pub name: String,
    pub avatar: Option<String>,
    pub count: u32,
    pub first_unread_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSearchMatch {
    pub message: ChatMessage,
    pub matched_in: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSearchPage {
    pub results: Vec<ChatSearchMatch>,
    pub total: usize,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePage {
    pub messages: Vec<ChatMessage>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub user_id: String,
    pub display_name: String,
    pub address: String,
    pub port: u16,
    #[serde(default)]
    pub http_file_port: u16,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
    pub node_id: String,
    pub workspace_id: String,
    pub listening_port: u16,
    pub peers: Vec<PeerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOffer {
    pub transfer_id: String,
    pub source_node_id: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapData {
    /// Deprecated mirrors of `workspace.id` / `workspace.name`. The renderer
    /// still reads them directly on several call sites, so both stay in the
    /// payload alongside the full record.
    pub workspace_id: String,
    pub workspace_name: String,
    pub workspace: Workspace,
    pub current_user: User,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileRecord {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub sha256: String,
    pub source_node_id: String,
    pub source_address: String,
    pub source_http_port: u16,
    pub uploaded_by: String,
    pub uploaded_at: String,
    pub is_local: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderRecord {
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataOptions {
    #[serde(default)]
    pub tasks: bool,
    #[serde(default)]
    pub wiki: bool,
    #[serde(default)]
    pub chat: bool,
    #[serde(default)]
    pub ai: bool,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataResult {
    pub tasks_deleted: u64,
    pub task_comments_deleted: u64,
    pub wiki_documents_deleted: u64,
    pub chat_messages_deleted: u64,
    pub ai_conversations_deleted: u64,
    pub ai_messages_deleted: u64,
    pub success: bool,
    pub message: String,
}
