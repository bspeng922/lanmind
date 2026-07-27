# 智域协同（LanMind）

> 当前桌面版本：0.1.1 · Windows · Tauri 2 · React 19 · SQLite

智域协同是一款面向办公室、项目现场和隔离内网团队的本地优先协作桌面应用。它把项目、任务、沟通、文件传输、半透明桌面日历挂件和工作汇报集中在一个 Windows 客户端中，通过局域网直接连接团队成员，不依赖中心业务服务器。

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
