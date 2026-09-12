# 智域协同（LanMind）

> 当前桌面版本：0.1.1 · Windows · Tauri 2 · React 19 · SQLite

智域协同是一款面向办公室、项目现场和隔离内网团队的本地优先协作桌面应用。它把项目、任务、沟通、文件传输、半透明桌面日历挂件和工作汇报集中在一个 Windows 客户端中，通过局域网直接连接团队成员，不依赖中心业务服务器。

---

### 界面功能预览

#### 1. 看板视图（Kanban Board）
直观的看板泳道，支持状态拖拽流转、P1-P4 优先级标识、多项目聚合、以及右侧实时局域网在线节点感知。

![看板视图](docs/images/01_kanban_view.png)

#### 2. 全部任务清单（Task List）
支持多维度组合筛选（优先级、状态、日期、项目、标签），集成子任务进度清单折叠与快捷状态切换。

![全部任务清单](docs/images/02_tasks_list.png)

#### 3. 半透明桌面日历挂件（Desktop Calendar Widget）
独立半透明桌面挂件窗口，支持贴附桌面底层（Pinned to Desktop）或置顶，深度融合农历、节气与法定调休，双击单元格支持自然语言极速记事。

![桌面日历挂件](docs/images/06_desktop_calendar.png)

#### 4. 月度日历排期视图（Calendar Schedule）
月度日程视图，集中展示团队任务到期节点、循环任务未来排期与中国农历传统节假日。

![月度日历排期视图](docs/images/03_calendar_view.png)

#### 5. AI 工作汇报工作室（AI Report Studio）
一键汇总周期任务客观事实，借助大模型自动提炼提纲与核心论点，支持直接导出规范精美的 16:9 PPTX 演示文档。

![AI 工作汇报工作室](docs/images/04_report_studio.png)

#### 6. 系统全域配置中心（Settings & LLM）
支持私有化或兼容 OpenAI 协议大模型接入，支持一键探测与拉取模型列表；提供桌面日历透明度/底色自由调节与局域网 MCP 服务管理。

![系统全域配置中心](docs/images/05_llm_settings.png)

---

### 快速指引

- **完整使用与架构说明文档**：[lanmind/README.md](lanmind/README.md)
- **工程源码目录**：[lanmind/](lanmind/)
- **技术架构说明**：[lanmind/docs/ARCHITECTURE.md](lanmind/docs/ARCHITECTURE.md)
- **测试与验证手册**：[lanmind/docs/TESTING.md](lanmind/docs/TESTING.md)
- **MCP 局域网生态接入**：[lanmind/docs/MCP.md](lanmind/docs/MCP.md)

---

### 核心亮点

1. **本地优先与无中心 P2P 同步**：每台设备独立运行 SQLite 数据库，局域网节点间点对点加密同步，无单点故障与中心数据泄露风险。
2. **半透明桌面日历挂件**：常驻桌面，结合农历、节气与法定节假日调休，半透明底色支持跟随主题与色盘自选，双击单元格快速新增待办。
3. **结构化循环任务**：支持工作日、跨周、月末对齐、节假日智能顺延，已完成历史数据真实留痕。
4. **AI 工作报告与 PPTX 导出**：连接私有/兼容大模型，一键汇总周期任务事实生成高质量汇报，支持模型列表一键拉取。
5. **局域网 MCP Agent 接入**：内置 HTTP MCP Server，支持外部 AI Agent 读取与管理任务。
