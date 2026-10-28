$ErrorActionPreference = 'Stop'

$timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$deployDir = "src-tauri\target\release\bundle\deployment\LanMind_0.2.1_windows_x64_$timestamp"
New-Item -ItemType Directory -Force -Path $deployDir | Out-Null

$releaseDir = 'src-tauri\target\release'
$bundleDir = "$releaseDir\bundle"

Copy-Item "$bundleDir\nsis\LanMind_0.2.1_x64-setup.exe" -Destination $deployDir
Copy-Item "$bundleDir\msi\LanMind_0.2.1_x64_zh-CN.msi" -Destination $deployDir
Copy-Item "$bundleDir\msi\LanMind_0.2.1_x64_en-US.msi" -Destination $deployDir
Copy-Item "$releaseDir\lanmind.exe" -Destination $deployDir

$fileNames = @('LanMind_0.2.1_x64-setup.exe', 'LanMind_0.2.1_x64_zh-CN.msi', 'LanMind_0.2.1_x64_en-US.msi', 'lanmind.exe')
$hashLines = @()
$buildFiles = @{}

foreach ($name in $fileNames) {
    $fullPath = Join-Path $deployDir $name
    $hash = (Get-FileHash -Path $fullPath -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $fullPath).Length
    $hashLines += "$hash  $name"
    $buildFiles[$name] = @{
        size = $size
        sha256 = $hash
    }
}

$hashLines | Out-File -FilePath (Join-Path $deployDir 'SHA256SUMS.txt') -Encoding utf8

$buildMeta = @{
    version = '0.2.1'
    buildTime = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    platform = 'windows-x64'
    files = $buildFiles
}
$buildMeta | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $deployDir 'build.json') -Encoding utf8

$readmeContent = @"
========================================================================
LanMind (智域协同) v0.2.1 生产环境部署包
========================================================================
打包时间: $((Get-Date).ToString('yyyy/MM/dd HH:mm:ss'))
目标平台: Windows x64 (Windows 10 / Windows 11 / Windows Server 2019+)
软件架构: 本地去中心化 SQLite + LAN P2P 发现通信 + Tauri 2.0 原生架构

一、包含的部署文件清单:
------------------------------------------------------------------------
1. LanMind_0.2.1_x64-setup.exe (推荐)
   - NSIS 一键安装向导，支持中英文双语语言选择，自动创建桌面与开始菜单快捷方式、配置系统协议关联。
2. LanMind_0.2.1_x64_zh-CN.msi
   - 简体中文版 MSI 安装包，专用于企业 Windows 域推送、组策略 (GPO) 批量静默安装。
3. LanMind_0.2.1_x64_en-US.msi
   - 英文版 MSI 安装包，专用于国际化企业环境下的集中式管理部署。
4. lanmind.exe
   - 绿色独立单文件免安装版，解压后双击即可直接运行，适合随身携带或免管理员权限环境。
5. SHA256SUMS.txt
   - 所有二进制构件的 SHA256 完整性哈希清单。
6. build.json
   - 包含版本号、平台架构、构建时间戳及散列值的结构化元数据清单。

二、本次更新与核心功能特性:
------------------------------------------------------------------------
1. 知识库 (Wiki) 深度体验升级与现代编辑器架构:
   - 彻底解决输入卡顿与光标跳动问题：采用本地 Draft 缓存与显式发布入库机制，打字流畅无阻，支持 Ctrl+S 快捷发布；
   - 参考 Notion / 思源笔记 / Obsidian 样式全新重构：提供 24 款页面 Emoji 图标选择器、无边框呼吸感大标题、属性药丸栏（关联项目/更新时间/字数耗时/只读状态）；
   - 支持 Notion 标志性宽屏铺满 (Full Width) 与标准居中阅读模式一键切换并持久化记忆；
   - Obsidian 风格底部毛玻璃状态栏与沉浸式纸张画布，支持点击空白区域自动聚焦末尾；
   - 附件与图片去 Base64 化：基于本地 IndexedDB 二进制存储，避免文档膨胀与卡顿，支持本地图片/文件原生选择；
   - 支持全量文档导出为 ZIP 压缩包，完整保留原始多级目录树与所有关联附件，相对路径自适应匹配。
2. 局域网协作与组织架构强化:
   - 私聊联系人全面支持基于工作区组织架构的多级树状展示，各级独立展开折叠与在线/总人数子树级聚合统计；
   - 群组成员管理弹窗升级为左右分栏架构，支持关联协作项目（指定关联项目后，项目成员自动批量加入群组），并支持一键重新同步；
   - 工作区组织架构树与成员管理支持一键展开/折叠。
3. 项目协作与管理升级:
   - 项目设置成员与权限管理升级为左右分栏布局，左侧架构树挑选人员，右侧展示成员并配置 Admin/Member/Viewer 角色；
   - 成员角色按当前系统语言自适应国际化显示，超长角色标签紧凑截断；
   - 支持项目归档与已归档项目恢复管理，完善归档横幅与按钮视觉；
   - 完整支持 startDate 与 targetDate 项目周期排期管理。
4. 本地数据安全与维护:
   - 新增数据清理功能，支持按任务/Wiki/聊天/AI 对话分类多选清理，支持防误触二次确认；
   - 导入与导出全面支持非项目归属的独立个人任务，支持全量数据完整流转。
5. 全局快捷键与交互能力极大丰富:
   - 新增 AI 对话 (Ctrl+Alt+A)、局域网聊天 (Ctrl+Alt+L)、Wiki (Ctrl+Alt+K)、全局命令搜索 (Ctrl+K)、光载传输 (Ctrl+Alt+O)；
   - 对话与聊天页面全面解除右键菜单限制，支持鼠标任意选区文本复制及图片一键写入剪贴板。
6. 本地多模型与智能体 (AI Agent):
   - 支持 Ollama / vLLM / SGLang / OpenAI 兼容接口等多模型接入与工作区绑定，下拉框支持按供应商层级分组展示；
   - AI 对话消息支持一键复制与独立编辑，编辑后支持重新发送并流式输出生成全新版本回复；
   - 提供发送后动态加载指示（转圈/等待态）与工具调用卡片位置优化；
   - 支持 Enter 发送，Shift+Enter 及 Ctrl+Enter 换行快捷键。
7. 局域网大文件/文件夹共享:
   - 支持团队在局域网内直接共享文件与多级目录树，支持加密传输、断点续传与权限受控隔离。
8. 项目归档与全局清单隔离:
   - 已归档项目任务自动从全局任务列表、日历、看板及桌面日历中隔离排除。
9. 任务创建/详情页现代排版重构与子任务 Markdown 描述:
   - 全面重构任务创建/编辑弹窗排版样式，统一属性胶囊工具条与右侧属性侧栏层级，消除信息割裂与布局混乱；
   - 子工作项卡片全面支持独立 Markdown 描述编辑与即时预览，支持为子任务配置单独排期与到期日期。
10. AI 大模型对话界面与智能体交互优化:
   - 对话输入框底栏紧凑工具条：将 Agent 模式切换、模型选择、Skills 配置、MCP 客户端与本地目录授权全部集成在输入框左下角，支持向上弹出快捷配置面板，扩展会话视口；
   - 助手回复一键转为工作项：精准提取标题，将完整 Markdown 内容填充为任务正文描述；
   - 助手回复一键转为 Wiki 知识库：正文与标题一键入库并无缝跳转编辑；
   - 清理助手消息底部无关联的操作按钮（如打开汇报），工具调用卡片默认收折。
11. 知识库 (Wiki) 头部元数据与标签栏体验优化:
   - 标签添加按钮及已关联标签平齐置于 Emoji 图标后方；
   - 更新时间、字数统计与预计阅读耗时平齐右浮动展示，去除面包屑多余的重复时间显示；
   - 页面历史优化完整层级路径展示，新建子页面操作精简语义。
12. 数据管理（导入/导出/数据清理）多端自适应布局优化:
   - 全面优化导入、导出与本地数据清理页面的响应式设计，消除桌面窗口下硬编码的固定宽度截断，自然铺满工作区；
   - 导入卡片支持网格自适应，历史记录审计表格支持横向平滑滚动与列对齐；
   - 本地数据清理分类卡片在常规桌面下以饱满的 2x2 网格展示，超宽屏自适应横排展开；
   - 优化向导与确认弹窗在不同分辨率屏幕下的最大高度封顶与滚动支持。
13. 现代任务卡片与列表自适应体验重构:
   - 全新现代卡片排版与标准/紧凑密度自适应，直观展示编号、自定义状态药丸、优先级旗帜、负责人、起止排期、提前提醒与任务进度条；
   - 独立子工作项、检查事项与本地附件支持内联展开与快速打卡，按工作区与项目记忆显示偏好。
14. 任务回收站与安全防误删机制:
   - 删除任务前统一安全确认，默认保留子任务并可勾选级联删除；
   - 删除后自动移入任务回收站保留 30 天，支持多条件检索、只读详情预览、单项一键恢复与整组恢复。
15. 多模型智能体与结构化追问 (Ask User) 深度交互:
   - 支持智能体在执行复杂任务时发起结构化追问卡片，支持单选、多选与补充说明；
   - 完整支持 Ollama / vLLM / SGLang / OpenAI 兼容接口等多模型供应商热拔插与本地测试。
16. 定时任务启动按钮重排与历史执行记录:
   - 定时任务卡片启动/暂停开关调整至编辑按钮右侧；
   - 新增定时任务执行记录弹窗，展示历史触发时间、执行状态（成功/失败/运行中）、执行耗时、Run ID 复制与报错详情，支持立即调试与即时刷新。
17. 知识库 (Wiki) 文字编辑工具栏置顶与样式升级:
   - 富文本/Markdown 编辑工具条调整至文档画布最顶端（位于图标、标签与标题上方）；
   - 升级为现代卡片式浮动工具条，圆角悬停微动效与毛玻璃质感，支持长页面滚动粘性贴顶。
18. 知识库 (Wiki) 工具栏提示 (Tooltip) 定位与排版优化:
   - 全面优化工具栏按钮提示定位，避免悬浮层覆盖当前点击按钮或超出视口被截断。
19. 局域网对话分享 (AI Public View) 界面优化:
   - 优化对话公共分享页排版与按钮适配，消除小屏幕下“复制链接”按钮折行，统一卡片与状态指示器视觉。
20. 左侧主导航栏布局精简:
   - 去除底部折叠按钮及相关折叠冗余状态，保持清爽一致的标准常驻导航栏布局。
21. 任务回收站入口位置与交互优化:
   - 将任务回收站快捷入口从深层设置面板提取并整合至左侧主导航栏操作区，方便团队和个人更快速地排查、检索及一键恢复被删除的历史工作项。
22. 工作区解散与局域网节点状态协同:
   - 新增解散工作区安全流转机制，仅所有者可输入完整工作区名称确认解散；
   - 自动向局域网在线协作成对节点广播工作区解散事件，协同清理无效关联并在成员端安全回退至个人默认空间。
23. 工作区创建与成员准入:
   - 工作区菜单支持新建与切换，所有者或管理员在设置中统一添加成员，局域网发现不会自动加入工作区；
   - 接收新工作区后保持当前工作区，离线设备重连后补发，创建后进入失败可重试且不重复创建；
   - 局域网协议升级为版本 4，协作设备需一起升级。
24. LaTeX 数学公式渲染引擎集成 (KaTeX):
   - 支持独立块级公式 (\[...\], $$...$$) 与行内公式 (\(...\), $...$) 高精度排版，彻底解决公式裸露或转义丢失问题。
25. 代码块无限制展示与一键复制功能:
   - 解除代码块最大高度与垂直滚动条限制，杜绝流式输出时自动滚动回顶部的跳动问题；新增右上角带语言标签的浮动一键复制按钮与已复制状态即时反馈。
26. 全局弹窗视口定位与磨砂遮罩规范统一:
   - 彻底修复在局部滚动容器内弹窗导致的视口底部空白露底问题；全量弹窗迁移至 React Portal 顶层挂载，统一采用设计系统标准 bg-overlay backdrop-blur-sm 半透明毛玻璃遮罩。
27. 工作区与文件智能体 (AI Agent) 模型适配与图标区分:
   - 放开 Agent 模式下模型选择过滤，支持选择已启用的任意第三方/自定义大模型进行自主分析与问答；工作区 Agent 图标统一为 Bot 智能体图标，与底层模型选择 Cpu 芯片图标明确区分。

28. 知识库 (Wiki) AI 润色:
   - 支持全文与选中文字润色，可选择已配置模型、填写自定义要求或使用快捷润色要求；
   - 支持原文与结果的差异高亮和双栏阅读预览，可停止、重试与复制结果；
   - 采纳后进入草稿，保留撤销与历史恢复能力，并检查正文、选区和工作区变化，避免覆盖新修改。

29. 跨业务实体复制引用与局域网分享精简:
   - Wiki 页面与 AI 对话全面支持类似任务的「复制内部引用」功能，生成富文本 HTML 胶囊与 Markdown 纯文本链接；
   - 彻底精简局域网分享弹窗，移除 lanmind:// 客户端协议，仅保留专供免安装浏览器直接查阅的局域网 Web 链接；
   - 局域网 Web 端支持点击文档与会话互联平滑跳转。

30. 思源笔记风格的内联快捷引用 ((( / [[):
   - Wiki 编辑器与任务描述全面支持键入 (( 或 [[ 唤起浮动快速引用选择器；
   - 跨类型模糊检索 Wiki 文档、关联任务与 AI 会话，键盘上下导航、回车一键替换插入。

31. 知识库 (Wiki) 代码块、链接与数学公式修复:
   - 去除代码块预览上下多余的占位空行，保留双击编辑与代码复制；
   - 修复 Ctrl / Command 点击引用式链接、图片链接及公式预览内链接的跳转；
   - 修复多行 LaTeX 公式的解析，保持分子分母与上下标正确显示，保留原始公式语法及撤销能力。

32. 知识库 (Wiki) 交互与公式重叠排版修复:
   - 修复 Wiki 页面中使用 Ctrl+点击跳转第一次生效后、后续重复点击同一目标无法正常跳转的问题；
   - 修复 Markdown 及 Wiki 渲染中 KaTeX 数学公式上下位置重叠、行高塌陷以及公式内部出现多余垂直滚动条的问题；
   - 完善生产环境 CSP 安全策略（配置 style-src-attr 'unsafe-inline'），避免 Tauri 打包注入 style nonce 后拦截 KaTeX 内联 style 偏移属性，确保生产包中数学公式上下层级排版正常。

三、完整性校验:
------------------------------------------------------------------------
请使用 SHA256SUMS.txt 核对文件哈希。例如在 Windows PowerShell 中执行:
Get-FileHash LanMind_0.2.1_x64-setup.exe -Algorithm SHA256
"@

$readmeContent | Out-File -FilePath (Join-Path $deployDir 'README.txt') -Encoding utf8

$zipPath = "$deployDir.zip"
Write-Output "Compressing deployment package to $zipPath ..."
Compress-Archive -Path "$deployDir\*" -DestinationPath $zipPath -Force

Write-Output "DEPLOY_DIR=$deployDir"
Write-Output "DEPLOY_ZIP=$zipPath"
Get-ChildItem -Path $deployDir | Select-Object Name, Length
Get-Item -Path $zipPath | Select-Object Name, Length
