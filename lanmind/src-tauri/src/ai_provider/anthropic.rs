//! Translate the shared conversation/tool format to the Anthropic Messages API.
use super::{validate_calls, Completion};
use crate::{ai_types::*, models::LlmConfig};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) fn request_body(
    config: &LlmConfig,
    parameters: &ModelParameters,
    messages: &[Value],
    tools: &[Value],
) -> AiResult<Value> {
    if parameters.temperature.is_some_and(|v| v > 1.0) {
        return Err(AiError::new(
            "INVALID_PARAMETERS",
            "Anthropic temperature 必须在 0 到 1 之间",
        ));
    }
    if let Some(key) = parameters.extra.keys().find(|key| key.as_str() != "stop") {
        return Err(AiError::new(
            "INVALID_PARAMETERS",
            format!("Anthropic 不支持参数：{key}"),
        ));
    }
    let mut system = Vec::new();
    let mut turns: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or("");
        let mut blocks = Vec::new();
        let target_role = match role {
            "system" | "developer" => {
                let text = message["content"].as_str().ok_or_else(invalid_messages)?;
                if !text.is_empty() {
                    system.push(text);
                }
                continue;
            }
            "user" | "assistant" => {
                if let Some(text) = message["content"].as_str() {
                    if !text.is_empty() {
                        blocks.push(json!({"type":"text","text":text}));
                    }
                } else if !message["content"].is_null() {
                    return Err(invalid_messages());
                }
                if let Some(calls) = message["tool_calls"].as_array() {
                    if role != "assistant" {
                        return Err(invalid_messages());
                    }
                    validate_calls(calls)?;
                    for call in calls {
                        let input: Value =
                            serde_json::from_str(call["function"]["arguments"].as_str().unwrap())?;
                        blocks.push(json!({"type":"tool_use","id":call["id"],"name":call["function"]["name"],"input":input}));
                    }
                }
                role
            }
            "tool" => {
                let id = message["tool_call_id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(invalid_messages)?;
                let text = message["content"].as_str().ok_or_else(invalid_messages)?;
                blocks.push(json!({"type":"tool_result","tool_use_id":id,"content":text}));
                "user"
            }
            _ => return Err(invalid_messages()),
        };
        if blocks.is_empty() {
            continue;
        }
        // Parallel tool results must share the user turn immediately after tool_use.
        if let Some(last) = turns.last_mut().filter(|last| last["role"] == target_role) {
            last["content"].as_array_mut().unwrap().extend(blocks);
        } else {
            turns.push(json!({"role":target_role,"content":blocks}));
        }
    }
    if turns.is_empty() {
        return Err(invalid_messages());
    }
    let mut body = json!({
        "model":config.model_name,"messages":turns,"stream":true,
        "max_tokens":parameters.max_output_tokens.unwrap_or(4096)
    });
    if !system.is_empty() {
        body["system"] = json!(system.join("\n\n"));
    }
    if let Some(value) = parameters.temperature {
        body["temperature"] = json!(value);
    }
    if let Some(value) = parameters.top_p {
        body["top_p"] = json!(value);
    }
    if let Some(stop) = parameters.extra.get("stop").filter(|s| !s.is_null()) {
        let sequences = if stop.is_string() {
            json!([stop])
        } else {
            stop.clone()
        };
        if !sequences
            .as_array()
            .is_some_and(|v| v.iter().all(Value::is_string))
        {
            return Err(AiError::new(
                "INVALID_PARAMETERS",
                "Anthropic stop 必须为字符串或字符串数组",
            ));
        }
        body["stop_sequences"] = sequences;
    }
    if !tools.is_empty() {
        let mut specs = Vec::new();
        for tool in tools {
            let function = &tool["function"];
            if tool["type"] != "function"
                || !function["parameters"].is_object()
                || function["name"].as_str().is_none_or(str::is_empty)
            {
                return Err(AiError::new(
                    "INVALID_TOOL_SCHEMA",
                    "Anthropic 工具声明无效",
                ));
            }
            let mut spec = json!({"name":function["name"],"input_schema":function["parameters"]});
            if let Some(description) = function["description"].as_str() {
                spec["description"] = json!(description);
            }
            specs.push(spec);
        }
        body["tools"] = json!(specs);
        body["tool_choice"] = json!({"type":"auto"});
    }
    Ok(body)
}

fn invalid_messages() -> AiError {
    AiError::new("INVALID_MESSAGES", "Anthropic 消息格式无效")
}
fn invalid_stream() -> AiError {
    AiError::new("INVALID_STREAM", "Anthropic 流事件顺序或内容无效")
}
fn finish_reason(reason: &Value) -> AiResult<String> {
    Ok(match reason
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(invalid_stream)?
    {
        "end_turn" | "stop_sequence" => "stop",
        "max_tokens" | "model_context_window_exceeded" => "length",
        "tool_use" => "tool_calls",
        other => other,
    }
    .into())
}
fn tool_call(block: &Value) -> AiResult<Value> {
    if !block["input"].is_object() {
        return Err(AiError::new(
            "INVALID_TOOL_CALL",
            "Anthropic 工具参数必须是 JSON 对象",
        ));
    }
    Ok(
        json!({"id":block["id"],"type":"function","function":{"name":block["name"],"arguments":block["input"].to_string()}}),
    )
}
fn append_text(
    result: &mut Completion,
    text: &str,
    emit: &mut impl FnMut(&str) -> AiResult<()>,
) -> AiResult<()> {
    if result.text.len() + text.len() > 4_000_000 {
        return Err(AiError::new("OUTPUT_LIMIT", "模型输出超出限制"));
    }
    result.text.push_str(text);
    if !text.is_empty() {
        emit(text)?;
    }
    Ok(())
}
fn validate_result(result: &Completion) -> AiResult<()> {
    if result.calls.len() > 64 {
        return Err(AiError::new("TOOL_LIMIT", "单轮工具调用过多"));
    }
    validate_calls(&result.calls)?;
    if (result.calls.is_empty() && result.finish == "tool_calls")
        || (!result.calls.is_empty() && result.finish != "tool_calls")
    {
        return Err(AiError::new(
            "INVALID_TOOL_CALL",
            "Anthropic 工具调用未完整结束",
        ));
    }
    Ok(())
}

pub(super) fn response(
    value: &Value,
    emit: &mut impl FnMut(&str) -> AiResult<()>,
) -> AiResult<Completion> {
    let content = value["content"]
        .as_array()
        .ok_or_else(|| AiError::new("INVALID_RESPONSE", "Anthropic 没有返回消息内容"))?;
    let mut result = Completion {
        finish: finish_reason(&value["stop_reason"])?,
        usage: value.get("usage").cloned(),
        ..Default::default()
    };
    for block in content {
        match block["type"].as_str() {
            Some("text") => append_text(
                &mut result,
                block["text"].as_str().ok_or_else(invalid_stream)?,
                emit,
            )?,
            Some("tool_use") => result.calls.push(tool_call(block)?),
            _ => {}
        }
    }
    validate_result(&result)?;
    Ok(result)
}

struct Block {
    kind: String,
    closed: bool,
    call: Option<Value>,
    arguments: Option<String>,
}

#[derive(Default)]
pub(super) struct StreamDecoder {
    blocks: BTreeMap<usize, Block>,
    result: Completion,
    started: bool,
    stopped: bool,
}
impl StreamDecoder {
    pub(super) fn event(
        &mut self,
        value: &Value,
        emit: &mut impl FnMut(&str) -> AiResult<()>,
    ) -> AiResult<bool> {
        match value["type"].as_str() {
            Some("message_start") => {
                if self.started {
                    return Err(invalid_stream());
                }
                self.started = true;
                self.merge_usage(&value["message"]["usage"]);
            }
            Some("content_block_start") => {
                if !self.started || !self.result.finish.is_empty() {
                    return Err(invalid_stream());
                }
                let index = block_index(value)?;
                if self.blocks.contains_key(&index) {
                    return Err(invalid_stream());
                }
                let content = &value["content_block"];
                let kind = content["type"].as_str().ok_or_else(invalid_stream)?;
                if kind == "tool_use"
                    && self.blocks.values().filter(|b| b.call.is_some()).count() >= 64
                {
                    return Err(AiError::new("TOOL_LIMIT", "单轮工具调用过多"));
                }
                let call = if kind == "tool_use" {
                    Some(tool_call(content)?)
                } else {
                    None
                };
                if kind == "text" {
                    append_text(
                        &mut self.result,
                        content["text"].as_str().ok_or_else(invalid_stream)?,
                        emit,
                    )?;
                }
                self.blocks.insert(
                    index,
                    Block {
                        kind: kind.into(),
                        closed: false,
                        call,
                        arguments: None,
                    },
                );
            }
            Some("content_block_delta") => {
                let block = self
                    .blocks
                    .get_mut(&block_index(value)?)
                    .filter(|b| !b.closed)
                    .ok_or_else(invalid_stream)?;
                let delta = &value["delta"];
                match delta["type"].as_str() {
                    Some("text_delta") => {
                        if block.kind != "text" {
                            return Err(invalid_stream());
                        }
                        append_text(
                            &mut self.result,
                            delta["text"].as_str().ok_or_else(invalid_stream)?,
                            emit,
                        )?;
                    }
                    Some("input_json_delta") => {
                        if block.call.is_none() {
                            return Err(invalid_stream());
                        }
                        let arguments = block.arguments.get_or_insert_with(String::new);
                        let fragment = delta["partial_json"].as_str().ok_or_else(invalid_stream)?;
                        if arguments.len() + fragment.len() > 1_000_000 {
                            return Err(AiError::new("TOOL_LIMIT", "工具参数超出限制"));
                        }
                        arguments.push_str(fragment);
                    }
                    _ => {} // Thinking/signature and future delta types are not user-visible text.
                }
            }
            Some("content_block_stop") => {
                let block = self
                    .blocks
                    .get_mut(&block_index(value)?)
                    .filter(|b| !b.closed)
                    .ok_or_else(invalid_stream)?;
                block.closed = true;
                if let (Some(call), Some(arguments)) = (&mut block.call, block.arguments.take()) {
                    call["function"]["arguments"] = json!(arguments);
                }
            }
            Some("message_delta") => {
                if !self.started {
                    return Err(invalid_stream());
                }
                if !value["delta"]["stop_reason"].is_null() {
                    self.result.finish = finish_reason(&value["delta"]["stop_reason"])?;
                }
                // Anthropic's output token count is cumulative, not an increment.
                self.merge_usage(&value["usage"]);
            }
            Some("message_stop") => self.stopped = true,
            _ => {} // Ping and future event types must not break compatible streams.
        }
        Ok(self.stopped)
    }
    fn merge_usage(&mut self, usage: &Value) {
        if let Some(fields) = usage.as_object() {
            self.result
                .usage
                .get_or_insert_with(|| json!({}))
                .as_object_mut()
                .unwrap()
                .extend(fields.clone());
        }
    }
    pub(super) fn finish(mut self) -> AiResult<Completion> {
        if !self.started
            || !self.stopped
            || self.result.finish.is_empty()
            || self.blocks.values().any(|b| !b.closed)
        {
            return Err(AiError::new(
                "STREAM_INTERRUPTED",
                "Anthropic 响应提前中断，可保留已有内容后重新生成",
            ));
        }
        self.result.calls = self.blocks.into_values().filter_map(|b| b.call).collect();
        validate_result(&self.result)?;
        Ok(self.result)
    }
}
fn block_index(value: &Value) -> AiResult<usize> {
    value["index"]
        .as_u64()
        .filter(|i| *i < 1024)
        .map(|i| i as usize)
        .ok_or_else(invalid_stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_preserves_system_history_parallel_results_and_parameter_mapping() {
        let config = LlmConfig {
            protocol: "anthropic".into(),
            base_url: "http://fixture/v1".into(),
            model_name: "claude-fixture".into(),
            api_key: String::new(),
            generation_parameters: None,
        };
        let parameters: ModelParameters = serde_json::from_value(
            json!({"temperature":0.4,"topP":0.8,"maxOutputTokens":512,"extra":{"stop":["END"]}}),
        )
        .unwrap();
        let tools = vec![
            json!({"type":"function","function":{"name":"echo","description":"Echo","parameters":{"type":"object","properties":{}}}}),
        ];
        let messages = vec![
            json!({"role":"system","content":"System instructions"}),
            json!({"role":"developer","content":"Workspace context"}),
            json!({"role":"user","content":"Remember 42"}),
            json!({"role":"assistant","content":"Calling tools","tool_calls":[
                {"id":"a","function":{"name":"echo","arguments":"{\"value\":42}"}},
                {"id":"b","function":{"name":"echo","arguments":"{}"}}
            ]}),
            json!({"role":"tool","tool_call_id":"a","content":"42"}),
            json!({"role":"tool","tool_call_id":"b","content":"done"}),
            json!({"role":"user","content":"Continue"}),
        ];
        let body = request_body(&config, &parameters, &messages, &tools).unwrap();
        assert_eq!(body["system"], "System instructions\n\nWorkspace context");
        assert_eq!(body["messages"].as_array().unwrap().len(), 3);
        assert_eq!(body["messages"][0]["content"][0]["text"], "Remember 42");
        assert_eq!(
            body["messages"][1]["content"][1],
            json!({"type":"tool_use","id":"a","name":"echo","input":{"value":42}})
        );
        assert_eq!(
            body["messages"][2]["content"],
            json!([
                {"type":"tool_result","tool_use_id":"a","content":"42"},
                {"type":"tool_result","tool_use_id":"b","content":"done"},
                {"type":"text","text":"Continue"}
            ])
        );
        assert_eq!(
            body["tools"][0]["input_schema"],
            tools[0]["function"]["parameters"]
        );
        assert_eq!(body["tool_choice"], json!({"type":"auto"}));
        assert_eq!(body["max_tokens"], 512);
        assert_eq!(body["stop_sequences"], json!(["END"]));
        assert_eq!(body["temperature"], 0.4);
        assert_eq!(body["top_p"], 0.8);
        assert!(body.get("stream_options").is_none());
        let body = request_body(&config, &Default::default(), &messages[..3], &[]).unwrap();
        assert_eq!(body["max_tokens"], 4096);
        assert!(body.get("tools").is_none());
        let invalid: ModelParameters = serde_json::from_value(json!({"extra":{"seed":1}})).unwrap();
        assert_eq!(
            request_body(&config, &invalid, &messages, &[])
                .unwrap_err()
                .code,
            "INVALID_PARAMETERS"
        );
    }
    #[test]
    fn json_responses_normalize_stops_and_reject_truncated_or_duplicate_tools() {
        for (reason, expected) in [
            ("end_turn", "stop"),
            ("stop_sequence", "stop"),
            ("max_tokens", "length"),
            ("refusal", "refusal"),
        ] {
            let mut output = String::new();
            let result = response(&json!({"content":[{"type":"text","text":"你好"}],"stop_reason":reason,"usage":{"input_tokens":2}}), &mut |s| { output.push_str(s); Ok(()) }).unwrap();
            assert_eq!(output, "你好");
            assert_eq!(result.finish, expected);
            assert!(!result.streamed);
        }
        let block = json!({"type":"tool_use","id":"call","name":"echo","input":{"value":42}});
        let value = json!({"content":[block.clone()],"stop_reason":"tool_use"});
        assert_eq!(
            response(&value, &mut |_| Ok(())).unwrap().calls[0]["function"]["arguments"],
            "{\"value\":42}"
        );
        for invalid in [
            json!({"content":[block.clone()],"stop_reason":"max_tokens"}),
            json!({"content":[block.clone(),block],"stop_reason":"tool_use"}),
            json!({"content":[],"stop_reason":"tool_use"}),
        ] {
            assert!(response(&invalid, &mut |_| Ok(())).is_err());
        }
    }
}
