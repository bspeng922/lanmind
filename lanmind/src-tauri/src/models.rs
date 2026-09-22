//! Serializable contracts shared by SQLite, Tauri IPC, and the LAN protocol.
//!
//! These camelCase payloads mirror `src/types.ts`; field changes must remain
//! backward compatible because older operations can still exist on peers.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
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
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub status: String,
    pub due_date: Option<String>,
    pub recurrence: Option<String>,
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
    pub reminder_time: Option<String>,
    pub creator_id: String,
    pub assignee_id: String,
    pub project_id: Option<String>,
    pub is_shared: bool,
    pub shared_with: Vec<String>,
    pub subtasks: Vec<Subtask>,
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
pub struct TaskDataArchive {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignmentNotification {
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
    pub workspace_id: String,
    pub workspace_name: String,
    pub current_user: User,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileRecord {
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
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub created_by: String,
    pub created_at: String,
}
