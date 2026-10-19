# MCP 服务与客户端接入

LanMind 桌面端内置一个基于 Streamable HTTP 的 MCP Server。外部大模型客户端或 Agent 可以在启用服务时固定的工作区及桌面用户权限范围内查询项目、成员、组织、任务、评论、动态和 Wiki，并创建或更新任务、评论与 Wiki 页面。

当前开发源码同时提供独立的 MCP Client，用于 AI Agent 连接外部工具。Server 在“设置 → MCP 服务”启用，Client 在“AI → 模型与 Agent 设置 → MCP 客户端”配置；两者不共用连接和授权。

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

Server 与工作区 Agent 共用 `mcp_tools.rs` 的 25 项工具定义、参数校验和数据库实现。默认全部开放，19 项只读、6 项写入，MCP `readOnlyHint` 与实际写入类型一致。

| 场景 | 工具 | 参数与结果 |
| --- | --- | --- |
| 工作区上下文 | `get_context`、`get_workspace` | 当前身份、本地日期/时间/时区偏移；工作区简介和配置时区 |
| 成员与组织 | `list_users`、`list_workspace_members`、`get_org_directory` | 当前工作区已加入成员、工作区角色；本机维护的组织层级与成员映射 |
| 项目 | `list_projects`、`get_project`、`list_project_members`、`get_project_summary` | 详情/成员/统计使用 `projectId`；成员含管理员角色、负责人标记 |
| 任务查询 | `list_states`、`list_tasks`、`get_task`、`list_today_tasks`、`list_risk_warnings` | 状态定义；关键词、项目、负责人、状态、优先级、日期、`parentTaskId` 筛选；按 ID 读取版本；今日日程；风险 |
| 任务写入 | `create_task`、`update_task` | 创建默认个人任务、负责人为当前用户；更新使用 `taskId`、`expectedVersion`、部分 `patch` |
| 评论与动态 | `list_task_comments`、`create_task_comment`、`update_task_comment`、`list_task_activity` | 使用 `taskId`；回复指定 `replyToCommentId`；仅可修改自己的评论，需 `commentId` 和 `expectedUpdatedAt` |
| Wiki | `list_wiki_pages`、`search_wiki`、`get_wiki_page`、`create_wiki_page`、`update_wiki_page` | 列表/搜索返回元数据和版本；正文按 Unicode 字符分段读取；更新使用 `pageId`、`expectedVersion`、`title` 和/或 `content` |

`list_today_tasks` 使用桌面本地日期，列出可见任务中今天到期或进行中的顶层任务，排除已完成、已取消、子任务和归档项目，不受界面临时筛选影响。支持可选 `projectId`、`assigneeId` 筛选。项目摘要是当前可见顶层任务快照；完成率为已完成数除以排除已取消后的任务数，不表示历史周期绩效。

分页列表默认 `limit=100`、最大 200，使用 `offset`；Wiki 搜索默认 30、最大 100。任务动态使用 `page`、`pageSize` 和可选 `snapshot` 保持翻页快照。Wiki 正文默认读取 12000、最多 30000 个 Unicode 字符，依据 `nextOffset` 续读；标题最多 500 字符，正文最多 500000 字符。评论正文为 1–20000 字符。

任务创建支持 `parentTaskId`，自动继承父任务的项目和共享范围，沿用两层工作项限制。任务更新支持自定义状态、指派、日期、进度与标签；循环任务首次进入 `completed` 状态组时，按现有循环规则生成下一期，并在 `nextTask` 字段中返回。

Wiki 创建支持可选 `parentId`、`projectId`，同时检查页面、祖先和关联项目权限；锁定页面需要先在 Wiki 中解锁。编辑器使用版本化增量保存，Agent/MCP 更新不会被其他页面的旧快照覆盖。冲突后应重新读取、核对差异再提交，不能自动用新版本重发旧内容。

## 对话操作与调用示例

在 AI 对话中选择“工作区 Agent”和已通过工具调用测试的模型，即可询问“查看今天的任务”“查看项目组成员”“查找发布 Wiki”，或要求创建任务、添加评论和修改页面。名称不明确时通过对话追问；模型先查询真实项目、成员和状态 ID。任务和 Wiki 结果卡片提供应用内来源链接。

工作区 Agent 的六类写操作均先生成预览，用户确认后再次检查权限、版本与变更内容，再执行并记录结果。拒绝或取消不写入。重新生成/继续回答不能重复写入。**外部 MCP 客户端通过 Bearer Token 授权后直接执行写操作**，不经过桌面对话审批；需要交互审批的客户端应自行实现。

以下为 `tools/call` 的参数示例，实际 ID 和版本应使用查询结果：

```json
{"name":"list_today_tasks","arguments":{"limit":50}}
{"name":"create_task","arguments":{"title":"整理发布清单"}}
{"name":"create_task_comment","arguments":{"taskId":"<taskId>","content":"已补充验收结果","replyToCommentId":"<commentId>"}}
{"name":"search_wiki","arguments":{"keyword":"发布","limit":10}}
{"name":"get_wiki_page","arguments":{"pageId":"<pageId>","offset":0,"length":12000}}
{"name":"update_wiki_page","arguments":{"pageId":"<pageId>","expectedVersion":123,"content":"核对后的完整 Markdown 正文"}}
```

`update_task`、`update_task_comment`、`update_wiki_page` 遇到并发变更返回 `VERSION_CONFLICT`。工具执行错误通过 MCP `isError` 及错误文本返回。工具范围不包含删除、成员管理、发送聊天消息、文件访问、LLM 密钥和同步日志。

## 安全边界

MCP 使用随机 256-bit Bearer Token 鉴权，但当前传输是 HTTP，报文没有 TLS 加密。仅应在可信办公局域网中启用，不要用于访客 Wi-Fi、不可信 VLAN 或可被监听的公共网络。Token 只保存在当前设备，不会通过 LanMind 同步给其他节点。


服务授权固定 `workspaceId + userId + revision`。桌面切换工作区后，旧连接和使用原 Token 新建的连接均不能跟随切换读取目标区；切回原区也不会恢复旧授权。授权归属持久化到本机，重启也不自动改绑。需要在目标工作区重新启用/保存 MCP 配置，此时自动轮换 Token，客户端须更新为新 Token。任务按 ID 读取、创建和更新都在同一数据库锁内重新验证上下文和原有实体权限。

## AI Agent 连接外部 MCP

1. 在 AI 设置的“MCP 客户端”中添加连接，选择 Streamable HTTP 或 stdio。
2. HTTP 填写完整服务 URL；需要鉴权时在专用凭据框填写 Bearer Token。
3. stdio 指定绝对可执行文件路径、参数数组和可选工作目录，按需填写环境变量，并明确启用可信本地程序授权。stdio 会执行所配置程序，不属于纯 JavaScript 沙箱。
4. 保存后发现工具，勾选本连接允许使用的工具；只对已确认的只读工具授予只读访问，其余调用需要审批。
5. 回到工作区/文件 Agent，在运行范围中勾选该连接，选择已通过工具测试的模型后发送请求。普通聊天不挂载工具。

配置、工具选择和运行范围限定当前工作区及用户。Token 和 stdio 环境变量受系统保护，配置读取只显示是否已保存及环境变量键；stdio 清理默认继承环境，仅保留必要系统变量和显式配置项。连接、发现、调用有超时和取消，运行结束清理子进程。

工具使用独立名称避免跨连接冲突，执行前重新检查连接版本和工具定义。HTTP 不跟随重定向，不因超时或过期会话自动重发调用；写入取消或断连后无法确认结果时记录 `outcome_unknown`，应先在目标系统核查。即使外部服务自称只读，也需要用户配置只读授权。

当前外连实现覆盖工具发现和调用，不包含完整 MCP resources/prompts 工作流。Server 固定工作区授权测试、Client 的本机 HTTP/stdio 测试服务与取消用例均在 Rust 回归中；真实第三方服务仍需联调。配置限制见 [AI 实施说明](AI_AGENT_DELIVERY.md)。

## 回归验证

2026-10-19：Rust 库回归 173 项通过、4 项环境相关用例默认跳过；前端单元测试 116 项通过；AI、Wiki 与工作区隔离界面回归 23 项通过。TypeScript、i18n 和前端生产构建通过。业务测试覆盖工具定义一致性、真实 SQLite 预览回滚、成员/组织权限、任务版本、今日日程与项目统计、评论回复/编辑、Wiki 并发版本/分段读取/批量回滚，以及本机 MCP HTTP 发现和调用。界面使用测试 IPC 数据，未替代真实模型部署联调。
