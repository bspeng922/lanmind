# 架构说明

除非另行标明，以下源码路径相对应用目录 `lanmind/`。

## 工作台与导航

- `src/app/AppShell.tsx` 组织标题栏、全局导航、次级导航、内容区及上下文抽屉挂载点。
- `src/app/AppRail.tsx` 提供 Work、Wiki、AI、Chat、光学传输和设置入口；`CommandPalette.tsx` 提供本地 `Ctrl/Cmd+K` 命令面板。
- `src/components/wiki/WikiView.tsx` 负责文档树和编辑界面；`wikiPersistence.ts` 串行提交带版本的页面增量，`wiki_data.rs` 在 SQLite 事务内检查版本与权限并同步。浏览器存储承担缓存、个人视图状态和冲突草稿；冲突后暂停保存，由用户导出草稿或重新载入。
- `src/components/ai/AIWorkspace.tsx` 正式导出 `AgentWorkspace.tsx`，使用 `aiClient.ts` 访问专用 AI IPC。旧 store 和界面代码保留迁移与兼容用途，不作为生产会话写入入口。
- `src/components/LanChatModal.tsx` 承载聊天界面；`RightDrawerRoot.tsx`、`LanMindAIDrawer.tsx` 和 `IssuePeekDrawer.tsx` 提供报告、风险及任务上下文。
- `src/components/task/`、`workitem/` 复用任务正文、属性、子工作项、动态和状态等显示；项目创建、项目设置与工作区设置分别维护各自范围。

界面导航不另建业务事实来源。任务、Wiki、聊天和 AI 的持久状态最终由桌面数据库与对应权限服务决定。

## 运行模型

多语言资源位于 `lanmind/src/i18n/locales/<locale>/<module>.json`，React 与 Rust 共用。桌面语言偏好保存在本机 SQLite 设置中，通过 `i18n://changed` 通知所有窗口；浏览器按来源保存并同步。报告生成显式携带语言，Rust 使用任务局部上下文隔离并发请求，浏览器原型使用请求局部上下文。新增语言流程见 [多语言维护](../lanmind/src/i18n/README.md)。

智域协同是跨平台（Windows / macOS / Linux）的 Tauri 2 桌面应用。React 渲染层负责交互和视图状态，Rust 桌面核心负责受信任能力。两者打包在同一个进程体系中，通过 Tauri IPC 通信，不存在必须部署的中心业务服务器。

| 层 | 目录 | 主要职责 |
| --- | --- | --- |
| 渲染层 | `src/` | React 视图、表单状态、主题、看板和日历交互 |
| IPC 门面 | `src/services/api.ts` | 统一封装 Tauri command；浏览器模式才回退到 HTTP API |
| AI IPC 与运行时 | `src/components/ai/aiClient.ts`、`src-tauri/src/ai_*.rs` | 多模型路由、会话运行、工具循环、审批、目录能力和扩展；生产环境仅桌面端 |
| 桌面组合根 | `src-tauri/src/lib.rs` | 初始化数据库和网络、注册 commands、托盘、窗口与快捷键 |
| 本地数据 | `src-tauri/src/db.rs` | SQLite schema、CRUD、权限过滤和增量操作日志 |
| P2P 传输 | `src-tauri/src/network.rs` | 节点发现、加密同步、聊天事件和文件分块传输 |
| 共享模型 | `src-tauri/src/models.rs`、`src/types.ts` | Rust/TypeScript 两端的数据契约 |

```text
用户操作
  -> React component
  -> ApiService
  -> Tauri command
  -> SQLite transaction + sync operation
  -> P2P peer
  -> apply_operation（幂等）
  -> Tauri event
  -> React 刷新视图
```

## 目录决策

保留根目录 `src/` 与 `src-tauri/`，原因如下：

- `src/` 是 Vite/React 的标准渲染层目录。
- `src-tauri/` 是 Tauri CLI 的标准 Rust crate 和桌面配置目录。
- Rust 核心不是独立部署的 HTTP 后端，因此 `backend/` 不能准确表达它的生命周期和信任边界。
- 当前项目只有一个前端包，增加 `frontend/` 会同时增加 Vite 根目录、`frontendDist`、脚本和 CI 的路径配置。

当出现可独立部署的中继、账号或模型代理服务时，新增 `services/<service-name>/`；当共享包明显增多时，再评估 Cargo workspace 或 JavaScript monorepo。在这之前不为目录形式提前承担复杂度。

## IPC 边界

- React 通过 `ApiService` 或专用 `aiClient` 调用桌面 commands，组件不直接拼装数据库路径或网络协议。
- command 参数和返回值使用 camelCase JSON，Rust 模型通过 Serde 映射。
- Rust 通过事件推送 `chat://message`、`sync://operation`、`shortcut://triggered` 和 `quick-add://opened` 等瞬时状态。
- command 用于请求/响应，event 用于异步通知；持久状态最终仍以 SQLite 为准。

## 数据与权限

- 每台设备拥有独立 SQLite 数据库，SQLite 是本机事实来源。
- 首次启动只创建本机身份，不生成示例项目、任务、节点或同步日志。
- 工作区发现不需要管理员审批；用户申请进入具体项目时，必须由该项目管理员批准。
- 未批准成员可以发现项目，但不能读取或创建该项目任务。
- SQLite 开启 WAL、外键和单调版本日志；远端操作按 ID 幂等应用，并按项目成员关系过滤。
- 用户离线后保留节点身份并标记离线，任务指派人不会因为对方退出而丢失。
- 本机清空聊天只删除当前工作区内可见会话，不创建删除同步操作，因此不会影响其他节点。

## 概念层级

数据模型分三层，工作项是最小可执行单元：

| 层 | 实体 | 表 | 说明 |
| --- | --- | --- | --- |
| 工作区 | `Workspace` | `workspaces` | 组织边界，也是 P2P 同步与加密信道的分区单位 |
| 项目 | `Project` | `projects` | 产品线或持续性的工作流，隶属某个工作区 |
| 工作项 | `Task` | `tasks` | 一条具体任务，隶属某个项目或个人任务区 |

工作区成员角色为 `owner` / `admin` / `member` / `guest`，准入状态为 `member` / `pending`。

**工作区标识与凭据决定同步边界。** `workspaces` 保存本机可访问的注册信息，`settings.workspaceId` 只表示当前活动工作区；每区 token 保存于本机 `workspace_credentials`，切换时重建网络运行时，不能复用旧区密钥。首次迁移保留原活动区 token，其他工作区使用独立凭据。`WorkspaceContext { workspaceId, userId, revision }` 在同一数据库锁内校验，A→B→A 后旧请求仍失效。

Work、Wiki、Chat 及关联数据按工作区归属；个人 AI、收藏、视图和模型绑定再按用户区分。14 张业务表具有必填工作区列，已知 UUID 不能代替访问检查。迁移、隔离区、文件授权及实际验收范围见 [Workspace 改造记录](WORKSPACE_ISOLATION_PLAN.md)。

**工作区成员角色是过滤与展示概念，不是安全边界。** 真正的访问边界由工作区密钥承担。局域网内没有仲裁者，因此加入工作区不需要审批；加入具体项目仍需该项目管理员批准。

## 工作项状态模型

状态分两层：

- **状态组**固定为 5 个，决定行为：`backlog` / `unstarted` / `started` / `completed` / `cancelled`。
  只有 `completed` 组计入完成、周期、模块与统计；只有 `completed` 与 `cancelled` 组可被自动归档。
- **状态**由项目自定义，决定名称、颜色与组内顺序，存放在 `states` 表。

`states.project_id` 为空表示该状态属于工作区级的个人任务状态列表，此时 `owner_id` 记录归属用户。每个项目（及个人状态区）在每个组内至多有一个默认状态，新建工作项时使用。

工作项上冗余了 `state_group` 与 `state_name` 两个列，因为现有读取路径都是「取出全部任务后在 Rust 侧过滤」，冗余后筛选与统计无需 join。颜色不做冗余——颜色属于展示，独立于状态定义变化。

`tasks.status` 列保留为兼容镜像，旧归档和历史同步载荷仍可能携带该字段。业务逻辑优先使用状态 ID 与状态组；缺少新字段的旧记录仍通过旧 `status` 映射到状态组及名称，写入时维护兼容值。历史操作日志不重写，读取时按映射翻译，使跨迁移期的工作汇报保持正确；这不表示接受旧版本网络协议。

「阻塞」是 `started` 组下的一个独立状态，按**名称**识别而非按组识别——若按组判断，每个进行中的工作项都会被误判为阻塞。

## 聊天会话模型

聊天类型由接收字段唯一确定，渲染层和 SQLite 必须使用同一规则：

| 会话 | `groupId` | `receiverId` |
| --- | --- | --- |
| 全员广播 | 空 | 空 |
| 单聊 | 空 | 明确的接收用户 ID |
| 群聊/项目频道 | 明确的群 ID | 空 |

单聊筛选必须要求消息明确发给当前用户或对方，不能把 `receiverId` 为空的广播消息归入发送者的单聊。

## 局域网传输

- UDP `45991` 用于节点发现，同时使用子网广播与 `239.255.45.91` 组播，提高不同网卡环境下的发现成功率。
- TCP 监听端口由系统动态分配并写入发现报文，用于增量同步和文件请求。
- 协议 v2 的 `workspace` 加密通道承载同工作区内按权限筛选的业务数据，广播聊天也仅限本工作区。旧 `lan-chat` 通道不再接受业务请求；异区发现只发送最小提示，不交换记录或密钥，旧协议业务不自动导入。
- 所有同步操作带独立 `workspaceId`、唯一 ID 和版本号；`scopeId` 保留项目等原有含义。重复操作幂等，跨区及父级不一致操作原子拒绝，历史载荷不因迁移而重写。
- 文件按 1 MiB 分块传输，支持偏移续传、SHA-256 校验和 ChaCha20-Poly1305 加密。TCP 校验所属聊天及参与者，HTTP raw/preview/Range 需签名且限时的授权；磁盘路径为 `storage/workspaces/<ws>/projects/<project>/<file>`。
- 实时文件共享由 `src-tauri/src/shared_files.rs` 承担，复用工作区加密 TCP 通道，以 256 KiB 请求块传输。共享配置使用本机 `settings` 中的工作区及用户作用域键保存，不加入同步日志；绝对路径不发给远端。共享面向持有当前工作区凭据的节点，不提供指定成员 ACL。
- 共享源使用 `cap-std` 目录句柄约束访问，拒绝路径穿越、符号链接及 Windows 重解析点，并校验源身份。每个请求重新校验工作区上下文与共享权限。只读允许浏览和下载；可写仅允许上传新文件和新建目录。上传以 SHA-256 验证临时文件，再原子提交且不覆盖已有文件；连接关闭、停止共享或切区清理未完成上传。
- `src/components/SharedFilesModal.tsx` 提供共享管理和按需加载的目录树，`src/services/sharedFiles.ts` 封装专用 IPC。下载保留目录及空目录，通过临时文件和目录归属标记支持重试续传；完成前校验摘要。支持进度事件和取消，单文件上限 2 GB。Windows 下共享目录句柄会阻止目录被移动或替换，停止共享后释放。

节点无法发现时，优先检查两台设备是否位于同一二层网络、Windows 网络类型是否为“专用”、防火墙是否允许应用通信，以及 AP/VLAN 是否启用了客户端隔离。

## 桌面生命周期

- 单实例插件保证同一主机只运行一个 LanMind 实例；再次启动会聚焦主窗口。
- 主窗口关闭默认隐藏到系统托盘；用户选择“退出程序”后会结束整个进程和附属窗口。
- 托盘右键菜单可显示主界面或退出进程。
- 系统级快速创建快捷键只显示独立的 `quick-add` 无边框窗口，不强制显示主窗口。
- 快速创建完成或关闭后窗口重新隐藏，主程序继续在托盘运行。
- 外部消息仅在主窗口隐藏或最小化时触发系统通知。

### 跨平台窗口与桌面层级适配

- **桌面日历常驻底层**：
  - **Windows**: 使用 `GWLP_HWNDPARENT` 挂载到 Shell Window，避免 `Win + D` 导致透明日历被最小化；
  - **macOS**: 通过 Cocoa 运行时设定 `setLevel: kCGDesktopWindowLevel` (`-2147483603`) 并配置 `NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary`，使透明日历常驻于壁纸桌面层且跨虚拟桌面可见，在调整/交互模式下恢复至 `0` 级普通窗口；
  - **Linux**: 使用标准的 `set_always_on_bottom(true)` 并跳过任务栏。
- **界面自适应**：
  - 前端通过 `get_platform` 原生调用识别宿主系统；
  - macOS 下将窗口控制按钮（红黄绿交通灯）置于左上角，全局搜索显示 `⌘ K`，快捷键录制与展示使用 `⌘ / ⌥ / ⇧`；
  - Windows 与 Linux 下维持右上角无边框窗口按钮与 `Ctrl / Alt / Shift` 提示。

## 浏览器回退

`server.ts` 与 `src/db/sqlite-store.ts` 仅服务于早期浏览器原型。后者实际使用 JSON 文件，并不是桌面 SQLite 实现。浏览器模式不用于验证 P2P、托盘、全局快捷键、系统通知或真实 SQLite 行为。

生产网络任务页由 Rust `web_server.rs` 提供，浏览器会话固定授权工作区。AI 不提供生产 HTTP 回退；`tests/theme/aiFixture.tsx` 只替换测试页中的 IPC 门面。

## 模型连接与 Agent

模型连接属于本机用户，模型启用绑定、用途默认值、会话、扩展和定时任务属于工作区及用户。模型身份使用 `{ connectionId, modelEntryId }`，远端模型 ID 和密钥只在 Rust 中解析；同名模型不会合并。旧单连接配置、浏览器会话和凭据在首次使用时迁移，旧整份会话快照写入随版本切换被拒绝。

| 模块 | 职责 |
| --- | --- |
| `ai_types.rs`、`ai_models.rs`、`ai_secrets.rs` | 版本化契约、连接/模型/用途路由、参数继承、部署能力测试、系统凭据保护 |
| `ai_store.rs`、`ai_runtime.rs` | SQLite 消息链与分支、幂等请求、单会话运行约束、流式事件、检查点、取消和审批 |
| `ai_provider.rs` | 共用 OpenAI 兼容传输，处理分块 UTF-8、SSE、完整 JSON、原生工具调用与网络取消 |
| `ai_files.rs`、`ai_documents.rs` | 授权目录能力、路径边界、冲突检查、备份恢复、文本提取与实际 OOXML 导出 |
| `ai_extensions.rs`、`ai_mcp_client.rs` | Skill 版本快照与按需加载、外连 MCP HTTP/可信 stdio、工具选择和授权 |
| `ai_script.rs`、`ai_api.rs` | 纯 JavaScript 子进程、资源限制、统一作用域 IPC 和应用内只读调度 |
| `mcp_tools.rs`、`mcp_task_filter.rs` | Agent 与 MCP Server 共用的 25 项业务工具、参数定义、权限与筛选；六类写入的预览校验 |

普通对话不提供执行工具。Agent 需要模型通过当前部署的原生工具往返测试；工作区 Agent 默认挂载全部 25 项业务工具。任务、评论和 Wiki 写入先在回滚保存点中生成真实预览，审批后在同一数据库锁内重新检查版本和预览内容；文件写操作沿用具体审批或已有目录创建授权。工具内容不能授予新权限。内部写入和执行证据在同一 SQLite 事务中保存；外部写入结果不明时标记 `outcome_unknown` 并停止自动重发。重新生成/继续回答禁止写入。外部 MCP Server 使用同一业务实现，鉴权后直接执行，不使用桌面对话审批。

事件携带工作区、用户、上下文 revision、runId 和 seq。数据库检查点固定原归属，切区/锁定/撤销会取消相关运行；重启将未结束运行标记为中断。加密终态恢复记录只更新原归属下已有对象，不恢复执行。Skills 固定版本但不自动执行包内脚本；可信 stdio 子进程与纯 JavaScript 沙箱有不同的信任边界。

AI 会话、运行、模型密钥、目录授权、MCP 配置和定时任务不参与 P2P 同步。文件授权只在当前应用和工作区上下文内有效；调度只处理当前已解锁工作区。详细限制和验证范围见 [AI 实施说明](AI_AGENT_DELIVERY.md)。

## 主题与状态语义

主题入口为 `src/styles/themes/registry.ts`，仅注册 `light` 和 `dark`；`system` 是偏好，由系统明暗模式解析。旧五套 ID 经 `migrateThemePreference` 映射到亮/暗主题。启动预加载与 React 共用迁移和应用逻辑，减少首屏闪烁。

布局和组件使用语义 token；状态组、阻塞和优先级颜色由 `state-tokens.css` 统一，保持跨主题语义。主题目录与新增方式见 [主题维护](../lanmind/src/styles/themes/README.md)。


## 工作区切换与外部授权

切换验证成员资格、更新 revision、停止旧运行时并启动目标运行时；失败回滚上下文。旧后台工作持有永久取消标记，主窗口、速记、桌面日历、通知窗口收到事件后重载。AI 回调和 Wiki 延迟保存固定原上下文；通知校验工作区及 revision。

MCP 和 Web 服务在启用/配置时固定工作区、用户及 revision，授权归属持久化，重启不自动改绑。桌面切换后旧授权失效，Web 旧 cookie 返回 401；需重新启用或配置服务绑定目标工作区；MCP 改绑自动轮换 Token。用户资料更新保留身份 ID，不能通过资料接口切换用户。工作区移除仅清理本机记录，不生成共享删除。
