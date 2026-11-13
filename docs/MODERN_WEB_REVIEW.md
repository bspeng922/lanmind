# Modern Web Guidance 与 Anthropic 接口改进记录

日期：2026-11-12。

## 技能与审阅范围

已从 [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) 安装 `skills/modern-web-guidance`，本机位置为 `C:/Users/Administrator/.codex/skills/modern-web-guidance`。本轮直接读取技能执行，后续新会话自动发现。没有增加前端或 Rust 运行时依赖。

完成全库文件清单、静态扫描与按模块审阅，覆盖应用入口和模块加载、任务编辑、聊天与 AI、Wiki、富文本与文件预览、公共控件与主题、插件、光学传输，以及 Rust AI 连接、传输、运行时和数据迁移。审阅结合架构、测试手册及现有测试；不是逐行人工审计或对所有指南的穷尽检查。

Tauri 使用 Windows WebView2、macOS WKWebView、Linux WebKitGTK。Vite 的 `chrome105` / `safari13` 编译目标不能保证新 Web API 存在，因此新能力采用检测和回退，不提高系统版本要求。相关约束已写入根目录 `AGENTS.md`，原有 Portal 定位规则保留。

## 扫描结果与取舍

执行 `modern-web-guidance@latest legacy-scan . --json`，初次 15 项候选，修改后复扫 1 项。扫描仅覆盖指南库约 20% 的确定性规则，候选数量不是安全或性能评分。

| 类型 | 初始候选 | 处理 |
| --- | ---: | --- |
| 输入法确认时的 Enter | 10 | 统一 composition 与 WebKit 229 检查，并扩展到命令、引用、标签和编辑器等相关入口 |
| 滚动条样式 | 2 | 标准 CSS 属性优先，WebKit 选择器置于不支持标准属性的条件内 |
| 文本域自动高度 | 1 | 支持时使用原生 field sizing，旧 WebView 保留原 JS 高度计算 |
| 图表预览关闭 | 1 | 使用原生 dialog 表单关闭，并补齐可访问名称、初始焦点与资源清理 |
| SVG 解析时的 innerHTML | 1 | 核实后保留；输入经过现有 SVG 专用 DOMPurify 清理，不能直接替换为默认 Sanitizer 策略 |

现有按需加载的业务模块、图表引擎、Graphviz Worker、表格 Worker 与可见列窗口化、隐藏页面暂停刷新、接收端离线缓存继续复用。没有为减少扫描命中而删除兼容代码，也没有在不清楚首屏和定位影响时全局加入 `content-visibility`。React Portal 菜单挂载在 body 的现状也不适合直接将所有父弹窗改成原生 modal，否则菜单会落入 inert 区域。

## 已完成的改进

- 使用共享 `isComposingKeyboardEvent`，避免确认中文、日文等候选时误发送消息、提交重命名、添加标签或移动焦点；保留正常 Enter 行为。命令按钮获得焦点后交由浏览器执行原生 Enter，避免窗口监听器再触发另一条命令。
- 任务标题与 AI 输入区使用 `field-sizing: content`，约束宽度及最小、最大高度；不支持时继续运行已有测量逻辑。
- 持续的旋转、闪烁、跳动动画使用 `motion-safe:`；公共菜单和相关自定义动画按偏好启用。平滑滚动在每次调用时读取系统设置，偏好变化立即生效；颜色等非位移反馈保留。
- 标准滚动条使用主题色并保留旧 WebKit 回退；强制色模式恢复系统滚动条颜色和可见的 outline 焦点提示。
- 图表放大预览使用 `<form method="dialog">`、关闭按钮 autofocus 和可访问名称；关闭及富文本会话销毁时释放临时 URL 和弹窗。
- 光学传输批量编码和 PDF 导出的循环约每 50ms 让出主线程；优先 `scheduler.yield()`，缺失时使用定时器。保留包顺序、导出格式和取消机制，没有宣称未经测量的性能百分比。
- 修复 Markdown 目录使用源文件行号、正文使用标题序号导致无法跳转的问题。目录与正文均按解析后的标题顺序生成 ID，也避免把代码块中的伪标题纳入目录。

## Anthropic 兼容接口

在“模型供应商”中增加 **Anthropic 兼容 / Anthropic Compatible** 预设及供应商类型，提供中英文文案，默认地址为 `https://api.anthropic.com/v1`。可编辑为其他兼容网关，可发现模型或手动添加模型 ID。

Rust 传输层按供应商选择协议，Anthropic 使用 `/messages`、`x-api-key` 和 `anthropic-version: 2023-06-01`。根地址自动补 `/v1`，完整 `/messages`、`/models` 地址会规范化，同时保留网关路径前缀。模型发现支持 Anthropic 分页并检测重复游标。

共用会话格式转换为 Anthropic 顶层 system、assistant tool_use 和 user tool_result，多工具结果合并为相邻的 user 回合。支持 SSE 文本和分段工具 JSON、普通 JSON 响应、停止原因映射、累计 token 用量、取消和错误脱敏。不完整或重复的工具调用不会作为成功响应交给执行层。新供应商沿用现有凭据保护、工作区绑定和能力验证；旧配置迁移保留 Anthropic 协议。

Anthropic 请求始终提供必填 `max_tokens`，未设置时默认 4096；通用 stop 参数映射为 stop_sequences，不支持的 OpenAI 专用扩展参数明确报错。连接能力测试不再强制 temperature，因为实测 `claude-sonnet-5-5` 拒绝非默认温度。

已通过用户提供的局域网网关对 `claude-sonnet-5-5` 执行真实 Rust 传输层测试：模型列表、流式文本回复、原生工具调用和工具结果回传后的继续回答全部通过。凭据只注入测试进程环境，没有写入项目、测试 fixture 或本报告。

协议依据：[Messages](https://platform.claude.com/docs/en/api/messages/create)、[Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)、[Models](https://platform.claude.com/docs/en/api/models/list)。

## 后续工作区与密码库问题

修复新工作区所有者无法创建局域网群组的问题。旧前端只检查用户旧角色及已有项目、群组的创建者/管理员身份，空工作区的所有者会被隐藏建群入口。聊天页面和弹窗现在接收当前工作区及成员信息：所有者或当前工作区已准入的管理员可以创建首个群组；待准入、其他用户及其他工作区的管理员记录不能授予当前工作区管理者权限。原有群内管理权限继续按该群的创建者和管理员判断。

建群仍需要至少一名其他协作成员，只有自己的工作区需要先添加成员。补齐中英文权限提示，并新增权限单元测试及页面/弹窗创建流程的浏览器用例。

另核实密码库主密码无法找回。仍解锁时可用独立新密码导出加密备份；已有备份且记得备份密码时可恢复备份内容。库已锁定且无可用备份时无法解密原记录。现有销毁功能要求旧主密码；本次没有对实际密码库执行重置、删除或迁移。处理方式写入 [密码库说明](password-vault.md#忘记主密码)。

## 验证

| 检查 | 结果 |
| --- | --- |
| 修改前基线 | 三套 TypeScript 检查及 270 个单元测试通过 |
| `npm run lint:all` | 通过 |
| `npm test` | 274 通过，0 失败，包含工作区建群后续修复 |
| Windows `cargo test --locked --lib` | 273 通过，0 失败，7 项按条件跳过 |
| Anthropic live 测试 | 单独显式运行，1 通过 |
| 新增现代化及 AI 浏览器定向回归 | 19 通过 |
| 完整浏览器回归 | 454 通过，0 失败；工作区建群后续修复另做定向回归 |
| 工作区建群定向浏览器回归 | 25 通过，0 失败，包含 8 项新增用例 |
| 生产构建及入口体积预算 | 主应用、网络页和独立接收端构建通过；三个入口 gzip 预算通过 |
| 独立光学接收端浏览器回归 | 1 通过，0 失败 |

浏览器回归使用本机 Chrome，经现有 `PLAYWRIGHT_EXECUTABLE_PATH` 配置指定。新增用例覆盖原生 composing / WebKit 229、标题原生高度与强制旧分支、原生命令按钮 Enter、动态效果偏好切换、强制色焦点、原生预览关闭与清理，以及 Anthropic 供应商创建和回读。Rust 新用例覆盖 UTF-8 任意分块、并行工具与分段参数、截断与错误流、JSON 停止原因、请求转换、HTTP 鉴权、模型分页、取消和协议迁移。

尚未在真实 WKWebView、WebKitGTK、macOS 输入法或屏幕阅读器上进行人工验证，也未生成或发布桌面安装包。已有大型按需图表和文档模块的 Vite chunk 提示由入口预算检查补充评估。

## Modern Web Guidance

- `ime-safe-enter-submit`：我使用共享检查保留 WebKit 的兼容分支，防止只检查 isComposing 仍会误提交。原文：“Add a `keyCode === 229` check (recommended)”。
- `form-fields-automatically-fit-contents`：我明确恢复 textarea 的 height:auto，保持固定宽度及高度上限，并保留旧运行时的检测回退。原文：“Explicit `width` and `height` properties override `field-sizing: content`”。
- `customize-scrollbar-color-and-thickness`：我将旧选择器限制在条件回退内，防止两套滚动条样式同时生效。原文：“Wrap legacy fallbacks in an `@supports not (scrollbar-color: auto)` block”。
- `accessibility`：我在强制色模式使用 outline，使阴影型焦点提示被系统覆盖时仍能辨认。原文：“provide an `outline`-based fallback for High Contrast Mode”。
- `motion`：我按系统偏好启用持续动画，并保留颜色反馈，避免统一压缩动画时长。原文：“Always respect reduced motion preferences.”
- `dialog`：我使用表单关闭及浏览器原生焦点恢复，避免再叠加键盘处理。原文：“close with `<form method="dialog">` buttons or `command="close"`.”
- `break-up-long-tasks`：我为 scheduler.yield 保留定时器回退，确保旧 WebView 可以继续执行。原文：“You MUST implement a fallback using `setTimeout`”。
