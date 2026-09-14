# MCP 局域网接入

LanMind 桌面端内置一个基于 Streamable HTTP 的 MCP Server。外部大模型客户端或 Agent 可以在当前桌面用户的权限范围内读取项目、成员、任务与风险，并创建或更新任务。

## 启用与连接

1. 打开“设置 → MCP 服务”。
2. 开启服务并保存。默认端口为 `45992`，端口冲突时可以修改。
3. 复制界面显示的 MCP 地址和 Bearer Token。
4. 在客户端中将 transport 设为 Streamable HTTP，URL 填写 `http://<LanMind 设备局域网 IP>:45992/mcp`，并加入请求头：

```text
Authorization: Bearer <设置页中显示的 Token>
```

不同 MCP 客户端的配置文件格式并不统一，但都需要传递相同的 URL 和 Authorization Header。修改端口后需要同步更新客户端配置；轮换 Token 后，已有会话会断开，所有客户端都必须改用新 Token。

如果其他设备无法连接，请确认两台设备处于可互访的可信局域网，并允许 LanMind 通过 Windows 专用网络防火墙。MCP 服务必须在 LanMind 运行期间使用，退出应用后不会作为独立服务驻留。

## 工具

- `get_context`：工作区、当前桌面用户、本地时间和时区。
- `list_users`、`list_projects`：任务指派和项目选择所需的上下文。
- `list_tasks`、`get_task`：按关键词、项目、负责人、状态、优先级和日期读取当前用户可见任务。
- `list_risk_warnings`：读取当前用户可见的风险提示。
- `create_task`：以当前桌面用户身份创建任务。
- `update_task`：使用 `taskId`、`expectedVersion` 和部分 `patch` 更新任务；版本冲突时需要重新读取再提交。

第一版不暴露删除、项目成员管理、聊天、文件、LLM 密钥或同步日志。循环任务首次变为 `completed` 时，服务会按现有循环规则生成下一期，并在 `update_task` 的 `nextTask` 字段中返回。

## 安全边界

MCP 使用随机 256-bit Bearer Token 鉴权，但当前传输是 HTTP，报文没有 TLS 加密。仅应在可信办公局域网中启用，不要用于访客 Wi-Fi、不可信 VLAN 或可被监听的公共网络。Token 只保存在当前设备，不会通过 LanMind 同步给其他节点。
