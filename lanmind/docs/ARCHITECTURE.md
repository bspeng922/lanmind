# 架构说明

## 运行模型

智域协同是 Windows 优先的 Tauri 2 桌面应用。React 渲染层负责交互和视图状态，Rust 桌面核心负责受信任能力。两者打包在同一个进程体系中，通过 Tauri IPC 通信，不存在必须部署的中心业务服务器。

| 层 | 目录 | 主要职责 |
| --- | --- | --- |
| 渲染层 | `src/` | React 视图、表单状态、主题、看板和日历交互 |
| IPC 门面 | `src/services/api.ts` | 统一封装 Tauri command；浏览器模式才回退到 HTTP API |
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

- React 只能通过 `ApiService` 调用桌面 commands，组件中不直接拼装数据库路径或网络协议。
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
- 本机清空聊天直接删除本机 `chat_messages`，不创建删除同步操作，因此不会影响其他节点。

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
- `workspace` 通道承载同工作区数据；`lan-chat` 通道允许不同工作区的局域网聊天与项目邀请数据按权限交换。
- 所有同步操作带唯一 ID 和版本号；重复收到同一操作不会重复写入。
- 文件按 1 MiB 分块传输，支持偏移续传、SHA-256 完整性校验和 ChaCha20-Poly1305 加密。

节点无法发现时，优先检查两台设备是否位于同一二层网络、Windows 网络类型是否为“专用”、防火墙是否允许应用通信，以及 AP/VLAN 是否启用了客户端隔离。

## 桌面生命周期

- 单实例插件保证同一主机只运行一个 LanMind 实例；再次启动会聚焦主窗口。
- 点击主窗口关闭按钮会阻止进程退出并隐藏到系统托盘。
- 托盘右键菜单可显示主界面或退出进程。
- 系统级快速创建快捷键只显示独立的 `quick-add` 无边框窗口，不强制显示主窗口。
- 快速创建完成或关闭后窗口重新隐藏，主程序继续在托盘运行。
- 外部消息仅在主窗口隐藏或最小化时触发系统通知。

## 浏览器回退

`server.ts` 与 `src/db/sqlite-store.ts` 仅服务于早期浏览器原型。后者实际使用 JSON 文件，并不是桌面 SQLite 实现。浏览器模式不用于验证 P2P、托盘、全局快捷键、系统通知或真实 SQLite 行为。
