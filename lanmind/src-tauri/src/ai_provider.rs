//! OpenAI/Anthropic-compatible transport shared by chat and the agent. No credentials in errors.
mod anthropic;
#[cfg(test)]
mod integration_tests;
use crate::{ai_models::http_client, ai_types::*, models::LlmConfig};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Default, Debug)]
pub struct Completion {
    pub text: String,
    pub calls: Vec<Value>,
    pub finish: String,
    pub usage: Option<Value>,
    pub streamed: bool,
}

#[derive(Default)]
struct StreamDecoder {
    pending: Vec<u8>,
    data: Vec<u8>,
    calls: BTreeMap<usize, Value>,
    result: Completion,
    done: bool,
    anthropic: Option<anthropic::StreamDecoder>,
}
impl StreamDecoder {
    fn event(&mut self, emit: &mut impl FnMut(&str) -> AiResult<()>) -> AiResult<()> {
        if self.data.is_empty() {
            return Ok(());
        }
        let bytes = std::mem::take(&mut self.data);
        let raw = std::str::from_utf8(&bytes)
            .map_err(|_| AiError::new("INVALID_STREAM", "模型返回了无效的 UTF-8 内容"))?
            .trim();
        if raw == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(raw)
            .map_err(|_| AiError::new("INVALID_STREAM", "模型返回了无效的流数据"))?;
        if value.get("error").is_some() {
            return Err(AiError::new(
                "PROVIDER_ERROR",
                "模型在生成过程中返回错误，请检查服务端日志",
            ));
        }
        if let Some(decoder) = &mut self.anthropic {
            self.done = decoder.event(&value, emit)?;
            return Ok(());
        }
        if !value["usage"].is_null() {
            self.result.usage = Some(value["usage"].clone());
        }
        if let Some(choice) = value["choices"].as_array().and_then(|v| v.first()) {
            if let Some(text) = choice["delta"]["content"].as_str() {
                self.result.text.push_str(text);
                if self.result.text.len() > 4_000_000 {
                    return Err(AiError::new("OUTPUT_LIMIT", "模型输出超出限制"));
                }
                emit(text)?;
            }
            for call in choice["delta"]["tool_calls"]
                .as_array()
                .into_iter()
                .flatten()
            {
                let index = call["index"]
                    .as_u64()
                    .ok_or_else(|| AiError::new("INVALID_STREAM", "工具调用缺少索引"))?
                    as usize;
                if index > 63 {
                    return Err(AiError::new("TOOL_LIMIT", "单轮工具调用过多"));
                }
                let entry = self.calls.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                for (source, target) in [(call.get("id"), &mut entry["id"])] {
                    if let Some(fragment) = source.and_then(Value::as_str) {
                        let mut s = target.as_str().unwrap_or("").to_string();
                        s.push_str(fragment);
                        *target = json!(s);
                    }
                }
                for key in ["name", "arguments"] {
                    if let Some(fragment) = call["function"][key].as_str() {
                        let mut s = entry["function"][key].as_str().unwrap_or("").to_string();
                        s.push_str(fragment);
                        if s.len() > 1_000_000 {
                            return Err(AiError::new("TOOL_LIMIT", "工具参数超出限制"));
                        }
                        entry["function"][key] = json!(s);
                    }
                }
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                self.result.finish = reason.into();
            }
        }
        Ok(())
    }
    fn push(&mut self, bytes: &[u8], emit: &mut impl FnMut(&str) -> AiResult<()>) -> AiResult<()> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() + self.data.len() > 2_000_000 {
            return Err(AiError::new("INVALID_STREAM", "流事件超出限制"));
        }
        while let Some(pos) = self.pending.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.pending.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                self.event(emit)?;
            } else if let Some(data) = line.strip_prefix(b"data:") {
                if !self.data.is_empty() {
                    self.data.push(b'\n');
                }
                self.data
                    .extend_from_slice(data.strip_prefix(b" ").unwrap_or(data));
            }
        }
        Ok(())
    }
    fn finish(mut self) -> AiResult<Completion> {
        if let Some(decoder) = self.anthropic.take() {
            if !self.pending.is_empty() || !self.data.is_empty() {
                return Err(AiError::new("STREAM_INTERRUPTED", "Anthropic 流事件不完整"));
            }
            return decoder.finish();
        }
        // finish_reason is necessary even if a proxy drops the optional [DONE] frame.
        if self.result.finish.is_empty() || !self.pending.is_empty() || !self.data.is_empty() {
            return Err(AiError::new(
                "STREAM_INTERRUPTED",
                "模型响应提前中断，可保留已有内容后重新生成",
            ));
        }
        self.result.calls = self.calls.into_values().collect();
        validate_calls(&self.result.calls)?;
        Ok(self.result)
    }
}
fn validate_calls(calls: &[Value]) -> AiResult<()> {
    let mut seen = std::collections::HashSet::new();
    for call in calls {
        let id = call["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AiError::new("INVALID_TOOL_CALL", "工具调用缺少 ID"))?;
        if !seen.insert(id) || call["function"]["name"].as_str().is_none_or(str::is_empty) {
            return Err(AiError::new("INVALID_TOOL_CALL", "工具调用标识无效"));
        }
        let raw = call["function"]["arguments"]
            .as_str()
            .ok_or_else(|| AiError::new("INVALID_TOOL_CALL", "工具参数格式无效"))?;
        if raw.len() > 1_000_000 || !serde_json::from_str::<Value>(raw)?.is_object() {
            return Err(AiError::new(
                "INVALID_TOOL_CALL",
                "工具参数必须是完整的 JSON 对象",
            ));
        }
    }
    Ok(())
}

pub async fn complete(
    config: &LlmConfig,
    parameters: &ModelParameters,
    messages: &[Value],
    tools: &[Value],
    cancel: &CancellationToken,
    mut emit: impl FnMut(&str) -> AiResult<()>,
) -> AiResult<Completion> {
    parameters.validate()?;
    let is_anthropic = config.protocol == "anthropic";
    let body = if is_anthropic {
        anthropic::request_body(config, parameters, messages, tools)?
    } else {
        let mut body = json!({"model":config.model_name,"messages":messages,"stream":true,"stream_options":{"include_usage":true}});
        parameters.apply(&mut body);
        if !tools.is_empty() {
            body["tools"] = json!(tools);
            body["tool_choice"] = json!("auto");
        }
        body
    };
    let client = http_client()?;
    let endpoint = if is_anthropic { "messages" } else { "chat/completions" };
    let req = client
        .post(format!(
            "{}/{endpoint}",
            config.base_url.trim_end_matches('/')
        ))
        .json(&body)
        .timeout(Duration::from_secs(600));
    let req = authenticate(req, config);
    let response = tokio::select! { biased; _ = cancel.cancelled() => return Err(AiError::new("CANCELLED", "已停止")), r = req.send() => r.map_err(|_| AiError::new("NETWORK_ERROR", "无法连接模型服务，请检查地址及服务状态"))? };
    if !response.status().is_success() {
        return Err(AiError::new(
            if response.status().as_u16() == 401 {
                "AUTHENTICATION_FAILED"
            } else {
                "PROVIDER_ERROR"
            },
            format!("模型接口返回 HTTP {}", response.status().as_u16()),
        ));
    }
    if response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.contains("application/json"))
    {
        let value: Value = tokio::select! {_ = cancel.cancelled()=>return Err(AiError::new("CANCELLED","已停止")),r=response.json()=>r.map_err(|_|AiError::new("INVALID_RESPONSE","模型响应格式无效"))?};
        if is_anthropic {
            return anthropic::response(&value, &mut emit);
        }
        let message = &value["choices"][0]["message"];
        let text = message["content"].as_str().unwrap_or("").to_string();
        let calls = message["tool_calls"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        validate_calls(&calls)?;
        if message["content"].as_str().is_none() && calls.is_empty() {
            return Err(AiError::new("INVALID_RESPONSE", "模型没有返回消息内容"));
        }
        let finish = value["choices"][0]["finish_reason"]
            .as_str()
            .unwrap_or(if calls.is_empty() {
                "stop"
            } else {
                "tool_calls"
            })
            .into();
        emit(&text)?;
        return Ok(Completion {
            text,
            calls,
            finish,
            usage: value.get("usage").cloned(),
            streamed: false,
        });
    }
    let mut response = response;
    let mut decoder = StreamDecoder {
        anthropic: is_anthropic.then(anthropic::StreamDecoder::default),
        ..Default::default()
    };
    loop {
        let chunk = tokio::select! {biased; _=cancel.cancelled()=>return Err(AiError::new("CANCELLED","已停止")),r=tokio::time::timeout(Duration::from_secs(120),response.chunk())=>r.map_err(|_|AiError::new("PROVIDER_TIMEOUT","模型响应超时"))?.map_err(|_|AiError::new("STREAM_INTERRUPTED","模型连接中断"))?};
        match chunk {
            Some(chunk) => {
                decoder.push(&chunk, &mut emit)?;
                if decoder.done {
                    break;
                }
            }
            None => break,
        }
    }
    let mut result = decoder.finish()?;
    result.streamed = true;
    Ok(result)
}

fn authenticate(mut request: reqwest::RequestBuilder, config: &LlmConfig) -> reqwest::RequestBuilder {
    if config.protocol == "anthropic" {
        request = request.header("anthropic-version", "2023-06-01");
        if !config.api_key.is_empty() {
            request = request.header("x-api-key", &config.api_key);
        }
    } else if !config.api_key.is_empty() {
        request = request.bearer_auth(&config.api_key);
    }
    request
}

fn discovery_request_error(error: reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::new("PROVIDER_TIMEOUT", "获取模型列表超时，请检查模型服务的响应状态")
    } else if error.is_builder() {
        AiError::new("INVALID_CONFIGURATION", "无法发送模型列表请求，请检查 API 地址和密钥格式")
    } else {
        AiError::new("NETWORK_ERROR", "无法连接模型列表接口，请检查 API 地址、代理设置及服务状态")
    }
}

pub async fn discover(config: &LlmConfig) -> AiResult<Vec<String>> {
    let client = http_client()?;
    let mut cursor = None::<String>;
    let mut seen_cursors = std::collections::HashSet::new();
    let mut ids = Vec::new();
    let mut bearer_auth = false;
    for _ in 0..10 {
        let request = |bearer_auth: bool| {
            let mut request = client
                .get(format!("{}/models", config.base_url.trim_end_matches('/')))
                .header(reqwest::header::ACCEPT, "application/json")
                .timeout(Duration::from_secs(15));
            if config.protocol == "anthropic" {
                request = request.query(&[("limit", "100")]);
                if let Some(cursor) = &cursor {
                    request = request.query(&[("after_id", cursor)]);
                }
            }
            if bearer_auth {
                request.header("anthropic-version", "2023-06-01").bearer_auth(&config.api_key)
            } else {
                authenticate(request, config)
            }
        };
        let mut response = request(bearer_auth).send().await.map_err(discovery_request_error)?;
        // Some gateways expose an OpenAI-authenticated model catalog alongside
        // their Anthropic Messages API. Retry only the same model-list URL.
        if !bearer_auth && config.protocol == "anthropic" && !config.api_key.is_empty()
            && matches!(response.status().as_u16(), 401 | 403)
        {
            bearer_auth = true;
            response = request(true).send().await.map_err(discovery_request_error)?;
        }
        if !response.status().is_success() {
            let status = response.status().as_u16();
            return Err(AiError::new(
                if matches!(status, 401 | 403) { "AUTHENTICATION_FAILED" } else { "PROVIDER_ERROR" },
                match status {
                    401 | 403 => format!("模型列表鉴权失败（HTTP {status}），请检查 API 密钥和模型列表访问权限"),
                    404 | 405 => format!("服务未提供模型列表接口（HTTP {status}），可手动添加模型 ID"),
                    _ => format!("模型列表接口返回 HTTP {status}，可手动添加模型 ID"),
                },
            ));
        }
        if response.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/html"))
        {
            return Err(AiError::new("INVALID_RESPONSE", "模型地址返回了网页，请检查 API 地址及 /v1 路径"));
        }
        let value: Value = response.json().await
            .map_err(|_| AiError::new("INVALID_RESPONSE", "模型列表响应格式无效"))?;
        ids.extend(value["data"].as_array()
            .ok_or_else(|| AiError::new("INVALID_RESPONSE", "接口没有返回模型列表"))?
            .iter().filter_map(|v| v["id"].as_str().map(str::to_string)));
        if config.protocol != "anthropic" || value["has_more"] != true {
            ids.sort();
            ids.dedup();
            return Ok(ids);
        }
        let next = value["last_id"].as_str().filter(|s| !s.is_empty())
            .ok_or_else(|| AiError::new("INVALID_RESPONSE", "模型列表缺少分页游标"))?;
        if !seen_cursors.insert(next.to_string()) {
            return Err(AiError::new("INVALID_RESPONSE", "模型列表返回重复分页游标"));
        }
        cursor = Some(next.into());
    }
    Err(AiError::new("MODEL_LIMIT", "模型列表分页过多，请手动添加模型"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn anthropic_frames() -> Vec<Value> {
        vec![
            json!({"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":0}}}),
            json!({"type":"ping"}),
            json!({"type":"future_event"}),
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好，杭州。"}}),
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"echo","input":{}}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"value\":\"杭"}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"州\"}"}}),
            json!({"type":"content_block_stop","index":1}),
            json!({"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool-2","name":"clock","input":{}}}),
            json!({"type":"content_block_stop","index":2}),
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}),
            json!({"type":"message_delta","delta":{},"usage":{"output_tokens":7}}),
            json!({"type":"message_stop"}),
        ]
    }
    fn anthropic_stream(events: &[Value]) -> String {
        events.iter().map(|event| format!("event: {}\r\ndata: {event}\r\n\r\n", event["type"].as_str().unwrap())).collect()
    }
    fn anthropic_decoder() -> StreamDecoder {
        StreamDecoder { anthropic: Some(Default::default()), ..Default::default() }
    }
    #[test]
    fn anthropic_utf8_parallel_tools_and_cumulative_usage_survive_fragmentation() {
        let source = anthropic_stream(&anthropic_frames());
        for size in 1..24 {
            let mut decoder = anthropic_decoder();
            let mut output = String::new();
            for chunk in source.as_bytes().chunks(size) {
                decoder.push(chunk, &mut |text| { output.push_str(text); Ok(()) }).unwrap();
            }
            assert!(decoder.done);
            let result = decoder.finish().unwrap();
            assert_eq!(output, "你好，杭州。");
            assert_eq!(result.text, output);
            assert_eq!(result.finish, "tool_calls");
            assert_eq!(result.calls.len(), 2);
            assert_eq!(result.calls[0]["function"]["arguments"], "{\"value\":\"杭州\"}");
            assert_eq!(result.calls[1]["function"]["arguments"], "{}");
            assert_eq!(result.usage, Some(json!({"input_tokens":9,"output_tokens":7})));
        }
    }
    #[test]
    fn anthropic_truncated_tool_arguments_missing_blocks_and_errors_are_not_success() {
        let original = anthropic_frames();
        for events in [
            original[..original.len() - 1].to_vec(),
            original.iter().filter(|v| v["type"] != "content_block_stop").cloned().collect(),
            original.iter().filter(|v| !(v["type"] == "content_block_delta" && v["delta"]["partial_json"] == "州\"}")).cloned().collect(),
        ] {
            let mut decoder = anthropic_decoder();
            decoder.push(anthropic_stream(&events).as_bytes(), &mut |_| Ok(())).unwrap();
            assert!(decoder.finish().is_err());
        }
        let mut decoder = anthropic_decoder();
        let error = decoder.push(b"event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"private-provider-detail\"}}\n\n", &mut |_| Ok(())).unwrap_err();
        assert_eq!(error.code, "PROVIDER_ERROR");
        assert!(!error.message.contains("private-provider-detail"));
    }
    #[test]
    fn fragmented_utf8_and_tool_arguments_are_lossless() {
        let source="data: {\"choices\":[{\"delta\":{\"content\":\"你好\",\"tool_calls\":[{\"index\":0,\"id\":\"call1\",\"function\":{\"name\":\"echo\",\"arguments\":\"{\\\"a\\\":\"}}]},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"1}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
        for size in 1..20 {
            let mut decoder = StreamDecoder::default();
            let mut output = String::new();
            for chunk in source.as_bytes().chunks(size) {
                decoder
                    .push(chunk, &mut |s| {
                        output.push_str(s);
                        Ok(())
                    })
                    .unwrap();
            }
            let result = decoder.finish().unwrap();
            assert_eq!(output, "你好");
            assert_eq!(result.calls[0]["function"]["arguments"], "{\"a\":1}");
        }
    }
    #[test]
    fn incomplete_and_error_streams_are_not_success() {
        let mut d = StreamDecoder::default();
        d.push(
            b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
            &mut |_| Ok(()),
        )
        .unwrap();
        assert!(d.finish().is_err());
        assert!(StreamDecoder::default()
            .push(
                b"data: {\"error\":{\"message\":\"secret\"}}\n\n",
                &mut |_| Ok(())
            )
            .is_err());
    }
}
