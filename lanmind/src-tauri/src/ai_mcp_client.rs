//! Outbound MCP sessions are independent of LanMind's inbound MCP server.
use crate::ai_types::*;
use rmcp::{
    model::CallToolRequestParams,
    service::RunningService,
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    RoleClient, ServiceExt,
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;
pub struct McpSession {
    service: RunningService<RoleClient, ()>,
    pub extension: AiExtension,
    pub tools: HashMap<String, Value>,
}
pub fn validate_config(config: &Value) -> AiResult<()> {
    let allowed = [
        "transport",
        "url",
        "command",
        "args",
        "cwd",
        "enabledTools",
        "readOnlyTools",
        "trustedStdio",
        "environmentKeys",
    ];
    if config
        .as_object()
        .is_none_or(|m| m.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return Err(AiError::new(
            "INVALID_CONFIGURATION",
            "MCP 配置包含未知字段；凭据请使用专用输入框",
        ));
    }
    match config["transport"].as_str() {
        Some("http") => {
            let raw = config["url"].as_str().ok_or("缺少 MCP URL")?;
            crate::ai_models::normalize_base_url(raw, "openai-compatible")?;
        }
        Some("stdio") => {
            let command = config["command"].as_str().ok_or("缺少 MCP 可执行文件")?;
            if !Path::new(command).is_absolute() || config["trustedStdio"] != true {
                return Err(AiError::new(
                    "STDIO_NOT_TRUSTED",
                    "stdio 需要明确启用信任，并指定可执行文件的绝对路径",
                ));
            }
            if config["args"]
                .as_array()
                .is_none_or(|a| a.len() > 100 || a.iter().any(|v| !v.is_string()))
            {
                return Err(AiError::new(
                    "INVALID_CONFIGURATION",
                    "stdio 参数必须是字符串数组",
                ));
            }
        }
        _ => {
            return Err(AiError::new(
                "INVALID_CONFIGURATION",
                "MCP 仅支持 HTTP 或 stdio",
            ))
        }
    }
    if config["enabledTools"]
        .as_array()
        .is_none_or(|a| a.len() > 100 || a.iter().any(|v| !v.is_string()))
    {
        return Err(AiError::new(
            "INVALID_CONFIGURATION",
            "请选择允许调用的工具名称",
        ));
    }
    Ok(())
}
impl McpSession {
    pub async fn connect(
        extension: AiExtension,
        secret: Value,
        cancel: &CancellationToken,
    ) -> AiResult<Self> {
        validate_config(&extension.config)?;
        let config = &extension.config;
        let service = if config["transport"] == "http" {
            let client = reqwest_mcp::Client::builder()
                .redirect(reqwest_mcp::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .build()
                .map_err(|_| AiError::new("MCP_CONNECTION_FAILED", "无法建立 MCP HTTP 客户端"))?;
            let mut settings = StreamableHttpClientTransportConfig::with_uri(
                config["url"].as_str().unwrap().to_string(),
            );
            settings.reinit_on_expired_session = false;
            settings.max_sse_event_size = 2_000_000;
            if let Some(token) = secret["token"].as_str().filter(|s| !s.is_empty()) {
                settings = settings.auth_header(token);
            }
            let transport = StreamableHttpClientTransport::with_client(client, settings);
            tokio::select! {_=cancel.cancelled()=>return Err(AiError::new("CANCELLED","已停止")),r=tokio::time::timeout(Duration::from_secs(20),().serve(transport))=>r.map_err(|_|AiError::new("MCP_TIMEOUT","MCP 握手超时"))?.map_err(|_|AiError::new("MCP_CONNECTION_FAILED","MCP 握手失败，请检查服务器和凭据"))?}
        } else {
            let mut command = tokio::process::Command::new(config["command"].as_str().unwrap());
            command
                .args(
                    config["args"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap()),
                )
                .env_clear()
                .kill_on_drop(true);
            for key in ["SystemRoot", "WINDIR", "TEMP", "TMP"] {
                if let Ok(v) = std::env::var(key) {
                    command.env(key, v);
                }
            }
            for (key, value) in secret["env"].as_object().into_iter().flatten() {
                command.env(key, value.as_str().unwrap_or(""));
            }
            if let Some(cwd) = config["cwd"].as_str().filter(|s| !s.is_empty()) {
                command.current_dir(cwd);
            }
            #[cfg(windows)]
            {
                command.creation_flags(0x08000000);
            }
            let transport = TokioChildProcess::builder(command)
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|_| AiError::new("MCP_CONNECTION_FAILED", "无法启动受信任的 MCP 进程"))?
                .0;
            tokio::select! {_=cancel.cancelled()=>return Err(AiError::new("CANCELLED","已停止")),r=tokio::time::timeout(Duration::from_secs(20),().serve(transport))=>r.map_err(|_|AiError::new("MCP_TIMEOUT","MCP 握手超时"))?.map_err(|_|AiError::new("MCP_CONNECTION_FAILED","MCP stdio 握手失败"))?}
        };
        let listed = tokio::select! {_=cancel.cancelled()=>return Err(AiError::new("CANCELLED","已停止")),r=tokio::time::timeout(Duration::from_secs(15),service.list_all_tools())=>r.map_err(|_|AiError::new("MCP_TIMEOUT","工具发现超时"))?.map_err(|_|AiError::new("MCP_DISCOVERY_FAILED","无法发现 MCP 工具"))?};
        if listed.len() > 500 {
            return Err(AiError::new("MCP_LIMIT", "服务器提供的工具数量过多"));
        }
        let tools = listed
            .into_iter()
            .map(|tool| {
                (
                    tool.name.to_string(),
                    serde_json::to_value(tool).unwrap_or(Value::Null),
                )
            })
            .collect();
        Ok(Self {
            service,
            extension,
            tools,
        })
    }
    pub fn specs(&self) -> Vec<Value> {
        let enabled = self.extension.config["enabledTools"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        self.tools.iter().filter(|(name,_)|enabled.iter().any(|v|v.as_str()==Some(name))).map(|(name,tool)|json!({"type":"function","function":{"name":self.alias(name),"description":format!("External MCP {}: {}",self.extension.name,tool["description"].as_str().unwrap_or(name)),"parameters":tool["inputSchema"]}})).collect()
    }
    pub fn alias(&self, name: &str) -> String {
        format!(
            "mcp_{}_{}",
            &hash(&self.extension.id)[..10],
            &hash(name)[..20]
        )
    }
    pub fn lookup(&self, alias: &str) -> Option<String> {
        let enabled = self.extension.config["enabledTools"].as_array()?;
        self.tools
            .keys()
            .find(|n| self.alias(n) == alias && enabled.iter().any(|v| v.as_str() == Some(n)))
            .cloned()
    }
    pub fn readonly(&self, name: &str) -> bool {
        self.extension.config["readOnlyTools"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(name)))
    }
    pub async fn call(
        &self,
        name: &str,
        args: Value,
        cancel: &CancellationToken,
    ) -> AiResult<Value> {
        let request = CallToolRequestParams::new(name.to_string())
            .with_arguments(args.as_object().cloned().ok_or("工具参数必须是对象")?);
        // Exactly one send. A dropped/expired write response must never be replayed automatically.
        let result = tokio::select! {biased;_=cancel.cancelled()=>return Err(AiError::new(if self.readonly(name){"CANCELLED"}else{"OUTCOME_UNKNOWN"},"调用已停止，外部操作可能已经执行，请核查")),r=tokio::time::timeout(Duration::from_secs(60),self.service.call_tool(request))=>r.map_err(|_|AiError::new(if self.readonly(name){"MCP_TIMEOUT"}else{"OUTCOME_UNKNOWN"},"MCP 响应超时，写入结果需要核查"))?.map_err(|_|AiError::new(if self.readonly(name){"MCP_ERROR"}else{"OUTCOME_UNKNOWN"},"MCP 调用中断，外部操作可能已经执行"))?};
        let value = serde_json::to_value(result)?;
        if value.to_string().len() > 1_000_000 {
            return Err(AiError::new(
                "TOOL_OUTPUT_LIMIT",
                "外部工具返回内容过大，请缩小查询",
            ));
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::{
        handler::server::router::tool::ToolRouter,
        model::{CallToolResult, ServerCapabilities, ServerInfo},
        tool, tool_handler, tool_router, ServerHandler,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    #[derive(Clone)]
    struct Fixture {
        tool_router: ToolRouter<Self>,
        writes: Arc<AtomicUsize>,
    }
    #[tool_router]
    impl Fixture {
        #[tool(description = "Harmless test read")]
        async fn fixture_read(&self) -> CallToolResult {
            CallToolResult::structured(json!({"value":"中文 fixture"}))
        }
        #[tool(description = "Counts a write, then simulates a lost response")]
        async fn fixture_write(&self) -> CallToolResult {
            self.writes.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_secs(60)).await;
            CallToolResult::structured(json!({"done":true}))
        }
    }
    #[tool_handler(router=self.tool_router)]
    impl ServerHandler for Fixture {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
        }
    }
    #[tokio::test]
    async fn http_discovers_calls_and_never_replays_cancelled_write() {
        use rmcp::transport::streamable_http_server::{
            session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
        };
        let writes = Arc::new(AtomicUsize::new(0));
        let copy = writes.clone();
        let service = StreamableHttpService::new(
            move || {
                Ok(Fixture {
                    tool_router: Fixture::tool_router(),
                    writes: copy.clone(),
                })
            },
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default().with_json_response(true),
        );
        let router = axum::Router::new().nest_service("/mcp", service);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let extension = AiExtension {
            id: "fixture".into(),
            kind: "mcp".into(),
            name: "Fixture".into(),
            description: String::new(),
            enabled: true,
            revision: 1,
            has_credential: false,
            config: json!({"transport":"http","url":format!("http://{address}/mcp"),"enabledTools":["fixture_read","fixture_write"],"readOnlyTools":["fixture_read"]}),
        };
        let cancel = CancellationToken::new();
        let session = McpSession::connect(extension, json!({}), &cancel)
            .await
            .unwrap();
        assert_eq!(session.specs().len(), 2);
        assert_eq!(
            session.lookup(&session.alias("fixture_read")).as_deref(),
            Some("fixture_read")
        );
        assert!(session.lookup("fixture_read").is_none());
        let result = session
            .call("fixture_read", json!({}), &cancel)
            .await
            .unwrap();
        assert!(result.to_string().contains("中文 fixture"));
        let stop = cancel.clone();
        let counter = writes.clone();
        tokio::spawn(async move {
            for _ in 0..100 {
                if counter.load(Ordering::SeqCst) > 0 {
                    stop.cancel();
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            stop.cancel();
        });
        let error = session
            .call("fixture_write", json!({}), &cancel)
            .await
            .unwrap_err();
        assert_eq!(error.code, "OUTCOME_UNKNOWN");
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        drop(session);
        server.abort();
    }
    #[tokio::test]
    async fn trusted_stdio_completes_real_protocol_handshake_and_tool_call() {
        let python = if cfg!(windows) {
            std::process::Command::new("where.exe")
                .arg("python")
                .output()
        } else {
            std::process::Command::new("which").arg("python3").output()
        }
        .ok()
        .filter(|v| v.status.success())
        .and_then(|v| String::from_utf8(v.stdout).ok())
        .and_then(|s| s.lines().next().map(str::to_string));
        let Some(python) = python else {
            eprintln!("stdio fixture skipped: Python is unavailable");
            return;
        };
        let script = r#"import sys,json
for line in sys.stdin:
    req=json.loads(line)
    if 'id' not in req: continue
    method=req.get('method')
    if method=='initialize': result={'protocolVersion':req['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'stdio-fixture','version':'1'}}
    elif method=='tools/list': result={'tools':[{'name':'echo','description':'test','inputSchema':{'type':'object','properties':{'value':{'type':'string'}},'required':['value']}}]}
    elif method=='tools/call': result={'content':[{'type':'text','text':req['params']['arguments']['value']}]}
    else: result={}
    print(json.dumps({'jsonrpc':'2.0','id':req['id'],'result':result}),flush=True)
"#;
        let extension = AiExtension {
            id: "stdio-fixture".into(),
            kind: "mcp".into(),
            name: "Stdio".into(),
            description: String::new(),
            enabled: true,
            revision: 1,
            has_credential: false,
            config: json!({"transport":"stdio","command":python,"args":["-u","-c",script],"trustedStdio":true,"enabledTools":["echo"],"readOnlyTools":["echo"]}),
        };
        let cancel = CancellationToken::new();
        let session = McpSession::connect(extension, json!({}), &cancel)
            .await
            .unwrap();
        let result = session
            .call("echo", json!({"value":"stdio works"}), &cancel)
            .await
            .unwrap();
        assert!(result.to_string().contains("stdio works"));
    }
}
