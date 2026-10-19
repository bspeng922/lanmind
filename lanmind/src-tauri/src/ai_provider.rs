//! OpenAI-compatible transport shared by chat and the agent. No credentials in errors.
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
    let mut body = json!({"model":config.model_name,"messages":messages,"stream":true,"stream_options":{"include_usage":true}});
    parameters.apply(&mut body);
    if !tools.is_empty() {
        body["tools"] = json!(tools);
        body["tool_choice"] = json!("auto");
    }
    let client = http_client()?;
    let mut req = client
        .post(format!(
            "{}/chat/completions",
            config.base_url.trim_end_matches('/')
        ))
        .json(&body)
        .timeout(Duration::from_secs(600));
    if !config.api_key.is_empty() {
        req = req.bearer_auth(&config.api_key);
    }
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
    let mut decoder = StreamDecoder::default();
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

pub async fn discover(config: &LlmConfig) -> AiResult<Vec<String>> {
    let client = http_client()?;
    let mut request = client
        .get(format!("{}/models", config.base_url.trim_end_matches('/')))
        .timeout(Duration::from_secs(15));
    if !config.api_key.is_empty() {
        request = request.bearer_auth(&config.api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| AiError::new("NETWORK_ERROR", "无法读取模型列表"))?;
    if !response.status().is_success() {
        return Err(AiError::new(
            "PROVIDER_ERROR",
            format!(
                "模型列表接口返回 HTTP {}，可手动添加模型",
                response.status().as_u16()
            ),
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| AiError::new("INVALID_RESPONSE", "模型列表响应格式无效"))?;
    let mut ids = value["data"]
        .as_array()
        .ok_or_else(|| AiError::new("INVALID_RESPONSE", "接口没有返回模型列表"))?
        .iter()
        .filter_map(|v| v["id"].as_str().map(str::to_string))
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
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
