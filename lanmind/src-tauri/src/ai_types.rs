//! Shared, versioned contracts for the desktop AI subsystem.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

pub type AiResult<T> = Result<T, AiError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: String,
    pub message: String,
}
impl AiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl From<String> for AiError {
    fn from(message: String) -> Self {
        Self::new("OPERATION_FAILED", message)
    }
}
impl From<&str> for AiError {
    fn from(message: &str) -> Self {
        Self::from(message.to_string())
    }
}
impl From<rusqlite::Error> for AiError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("STORAGE_UNAVAILABLE", error.to_string())
    }
}
impl From<serde_json::Error> for AiError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("INVALID_DATA", error.to_string())
    }
}
impl From<std::io::Error> for AiError {
    fn from(error: std::io::Error) -> Self {
        Self::new("FILE_ERROR", error.to_string())
    }
}

pub fn id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn hash(value: impl AsRef<[u8]>) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(value.as_ref()))
}
pub fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelRef {
    pub connection_id: String,
    pub model_entry_id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelParameters {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub extra: serde_json::Map<String, Value>,
}
impl ModelParameters {
    pub fn validate(&self) -> AiResult<()> {
        if self
            .temperature
            .is_some_and(|n| !n.is_finite() || !(0.0..=2.0).contains(&n))
            || self
                .top_p
                .is_some_and(|n| !n.is_finite() || !(0.0..=1.0).contains(&n))
            || self
                .max_output_tokens
                .is_some_and(|n| n == 0 || n > 1_000_000)
        {
            return Err(AiError::new("INVALID_PARAMETERS", "模型参数超出允许范围"));
        }
        for key in self.extra.keys() {
            if ![
                "frequency_penalty",
                "presence_penalty",
                "seed",
                "stop",
                "reasoning_effort",
                "chat_template_kwargs",
            ]
            .contains(&key.as_str())
            {
                return Err(AiError::new(
                    "INVALID_PARAMETERS",
                    format!("不允许覆盖模型请求字段：{key}"),
                ));
            }
        }
        Ok(())
    }
    pub fn apply(&self, body: &mut Value) {
        if let Some(value) = self.temperature {
            body["temperature"] = json!(value);
        }
        if let Some(value) = self.top_p {
            body["top_p"] = json!(value);
        }
        if let Some(value) = self.max_output_tokens {
            body["max_tokens"] = json!(value);
        }
        for (key, value) in &self.extra {
            body[key] = value.clone();
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub tools: Option<bool>,
    pub vision: Option<bool>,
    pub streaming: Option<bool>,
    pub context_window: Option<u32>,
    pub verified_at: Option<String>,
    pub config_revision: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub remote_model_id: String,
    pub display_name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub missing: bool,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
    #[serde(default)]
    pub parameters: ModelParameters,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnection {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub enabled: bool,
    pub revision: i64,
    pub config_revision: i64,
    pub has_credential: bool,
    pub bound: bool,
    pub reference_count: usize,
    #[serde(default)]
    pub parameters: ModelParameters,
    #[serde(default)]
    pub models: Vec<AiModel>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub schema_version: u32,
    pub connections: Vec<AiConnection>,
    pub defaults: HashMap<String, ModelRef>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum CredentialChange {
    #[default]
    Keep,
    Replace {
        value: String,
    },
    Clear,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionDraft {
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default = "yes")]
    pub bound: bool,
    #[serde(default)]
    pub credential_change: CredentialChange,
    #[serde(default)]
    pub parameters: ModelParameters,
    #[serde(default)]
    pub models: Vec<AiModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    pub title_locked: bool,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    pub revision: i64,
    pub branch_id: String,
    pub head_message_id: Option<String>,
    #[serde(default)]
    pub models: HashMap<String, ModelRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub branch_id: String,
    pub parent_message_id: Option<String>,
    pub run_id: Option<String>,
    pub user_message_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub model_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RunInput {
    #[serde(rename_all = "camelCase")]
    NewMessage {
        client_message_id: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Retry {
        user_message_id: String,
        run_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Continue { run_id: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRequest {
    pub client_request_id: String,
    pub conversation_id: String,
    pub branch_id: String,
    pub expected_head_message_id: Option<String>,
    pub expected_conversation_version: i64,
    pub input: RunInput,
    pub model_ref: Option<ModelRef>,
    #[serde(default = "chat_mode")]
    pub mode: String,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub root_ids: Vec<String>,
    #[serde(default)]
    pub mcp_ids: Vec<String>,
    #[serde(default)]
    pub parameters: Option<ModelParameters>,
}
fn chat_mode() -> String {
    "chat".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRun {
    pub id: String,
    pub conversation_id: String,
    pub branch_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub status: String,
    pub mode: String,
    pub model_ref: ModelRef,
    pub model_label: String,
    pub config_revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub finish_reason: Option<String>,
    pub error: Option<AiError>,
    pub seq: u64,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub artifacts: Vec<Value>,
    #[serde(default)]
    pub usage: Option<Value>,
    #[serde(default)]
    pub context: Value,
}
impl AiRun {
    pub fn active(&self) -> bool {
        is_active(&self.status)
    }
}
pub fn is_active(status: &str) -> bool {
    matches!(
        status,
        "queued" | "running" | "waiting_approval" | "waiting_input" | "cancelling"
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
    pub status: String,
    pub result: Option<Value>,
    pub approval_id: Option<String>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEvent {
    pub schema_version: u32,
    pub workspace_id: String,
    pub user_id: String,
    pub context_revision: u64,
    pub conversation_id: String,
    pub run_id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExtension {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub revision: i64,
    pub config: Value,
    pub has_credential: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSchedule {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub frequency: String,
    pub next_run_at: String,
    pub enabled: bool,
    pub model_ref: ModelRef,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    pub last_run_id: Option<String>,
    pub last_error: Option<String>,
    pub revision: i64,
}
