//! ai_chat.rs — OpenAI-compatible streaming LLM client for Tauri IPC and Web.
//!
//! CALLING SPEC:
//!     ai_chat::stream_llm_chat(
//!         &config,
//!         &system_prompt,
//!         &prompt,
//!         |chunk| { /* handle chunk */ Ok(()) },
//!     ).await -> Result<(), String>
//!
//! TOOL CONTRACTS:
//!     parse_sse_line(line: &str) -> SseAction
//!         - Pure function parsing SSE lines
//!         - Deterministic: same line -> same SseAction
//!         - No side effects
//!         - Independently testable

use crate::models::LlmConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "event", content = "data")]
pub enum ChatStreamEvent {
    #[serde(rename = "chunk")]
    Chunk(String),
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum SseAction {
    Chunk(String),
    Done,
    Skip,
}

/// Deterministic parser for SSE data lines.
///
/// TOOL CONTRACT:
///   Input: single line from SSE stream (with or without \r)
///   Output: SseAction enum
///   Deterministic, pure function, no side effects.
pub fn parse_sse_line(line: &str) -> SseAction {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return SseAction::Skip;
    }
    let Some(data_str) = trimmed.strip_prefix("data:") else {
        return SseAction::Skip;
    };
    let data = data_str.trim();
    if data == "[DONE]" {
        return SseAction::Done;
    }
    if let Ok(val) = serde_json::from_str::<Value>(data) {
        if let Some(content) = val
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            return SseAction::Chunk(content.to_string());
        }
        if let Some(text) = val.pointer("/choices/0/text").and_then(Value::as_str) {
            return SseAction::Chunk(text.to_string());
        }
    }
    SseAction::Skip
}

/// Streams an LLM chat completion request, calling `on_chunk` for each received delta.
pub async fn stream_llm_chat<F>(
    config: &LlmConfig,
    system_prompt: &str,
    prompt: &str,
    mut on_chunk: F,
) -> Result<(), String>
where
    F: FnMut(String) -> Result<(), String>,
{
    crate::ai_provider::complete(
        config,
        &config
            .generation_parameters
            .clone()
            .unwrap_or(crate::ai_types::ModelParameters {
                temperature: Some(0.2),
                ..Default::default()
            }),
        &[
            json!({"role":"system","content":system_prompt}),
            json!({"role":"user","content":prompt}),
        ],
        &[],
        &tokio_util::sync::CancellationToken::new(),
        |text| on_chunk(text.to_string()).map_err(Into::into),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Executes streaming chat and forwards events to a Tauri Channel.
pub async fn execute_stream_to_channel(
    config: &LlmConfig,
    system_prompt: &str,
    prompt: &str,
    channel: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let stream_result = stream_llm_chat(config, system_prompt, prompt, |chunk| {
        channel
            .send(ChatStreamEvent::Chunk(chunk))
            .map_err(|err| err.to_string())
    })
    .await;

    match stream_result {
        Ok(()) => {
            let _ = channel.send(ChatStreamEvent::Done);
            Ok(())
        }
        Err(err) => {
            let _ = channel.send(ChatStreamEvent::Error(err.clone()));
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_line_data() {
        let line = r#"data: {"choices":[{"delta":{"content":"Hello world"}}]}"#;
        assert_eq!(
            parse_sse_line(line),
            SseAction::Chunk("Hello world".to_string())
        );
    }

    #[test]
    fn test_parse_sse_line_done() {
        assert_eq!(parse_sse_line("data: [DONE]"), SseAction::Done);
        assert_eq!(parse_sse_line("data: [DONE]\r"), SseAction::Done);
    }

    #[test]
    fn test_parse_sse_line_skip() {
        assert_eq!(parse_sse_line(": ping"), SseAction::Skip);
        assert_eq!(parse_sse_line(""), SseAction::Skip);
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            SseAction::Skip
        );
    }
}
