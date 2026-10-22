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
