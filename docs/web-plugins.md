# 网页插件与局域网插件中心

独立网页插件由离线 HTML、JavaScript、CSS 和资源组成，不需要修改宿主源码。桌面端入口为“系统设置 → 功能与插件”，提供“已安装”和“插件市场”两个页签。现有密码库、光学传输仍为源码集成的预装插件，不通过本机制更新。

界面统一使用“插件”，以“局域网来源”标明下载渠道；本文的“网页插件”描述 HTML、JavaScript 和 CSS 的运行方式。页面顶部的“局域网插件共享”控制本机所有工作区的对外共享，各插件保留独立的共享开关。

## 开发、签名与第一台机器

在 `lanmind/` 中运行：

```powershell
npm run plugin:package -- keygen --out publisher.pem
npm run plugin:package -- pack --input examples/plugins/hello-web --key publisher.pem --out hello-web.lmpk
```

私钥由开发者保管，不能放进插件源码目录或安装包。工具不覆盖已有密钥或已有输出包。示例已经是可分发的网页资源；React、Vue 等项目应先构建为不依赖外部 CDN 的静态文件，再打包构建目录。JS 必须使用独立文件，不使用内联脚本、`eval`、远程模块或原生后端。

在第一台机器的插件中心点击“导入插件包”。安装完成并启用后，插件自动出现在左侧导航栏，可直接点击打开独立窗口，也可从设置列表点击“打开”。停用、卸载或安装包损坏时，左侧入口自动移除。主功能及底部设置保持固定，插件区独立滚动并隐藏滚动条；插件较多时提供上下箭头，同时支持滚轮、触控板和键盘滚动。其他在线 LanMind 节点可从局域网插件市场安装同一个包。停止某个插件不影响该包共享；关闭单个包或全局共享则撤下对应来源并终止现有传输。

插件根目录可放置 `icon.svg`、`icon.png`、`icon.webp`、`icon.jpg`、`icon.jpeg` 或 `icon.ico`（按此顺序选用），建议使用正方形图标，文件不超过 128 KiB。图标必须包含在包的资源哈希清单中；源码 ZIP 导入会自动生成清单。主程序校验图标哈希后才以本地图片显示在设置列表及导航栏，不加载远程图标，也不把 SVG 内联到宿主页面。缺失、损坏或过大的图标使用默认插件图标；旧插件包无需修改清单即可使用这一约定。

导入窗口同时接受 `.lmpk` 和 `.zip`。签名包沿用原有验证流程；未签名的静态网页插件和 GitHub 源码 ZIP 会先显示插件名称、版本、权限和来源未经验证的提示，用户明确确认后才会安装。确认绑定预览时的包 SHA-256，安装前内容发生变化时会拒绝继续。

GitHub 的 Code → Download ZIP 或 Source code 归档可以直接导入：插件清单需位于 ZIP 根目录，或唯一的第一层目录下；清单中的 HTML 入口及其 JS、CSS 等静态资源必须已可直接运行。宿主会去掉 GitHub 归档的外层目录，为运行资源生成哈希清单，不执行 `npm install`、构建脚本或原生代码。需要 Vite / React / Vue 构建的工程应先构建为静态网页。当前尚未提供输入 GitHub 链接自动下载导入的入口。

## 清单与不可变安装包

示例清单见 `lanmind/examples/plugins/hello-web/manifest.json`。格式为 `schemaVersion: 2`、`runtime: "web"`，必需字段包括 `id`、语义版本 `version`、语言到文案的 `name` / `description`、`defaultLocale`、最低宿主版本 `minHostVersion`、`sdkVersion: 1`、HTML `entry` 和 `capabilities`。

打包器自动增加 `files`，记录每个资源的 SHA-256。ZIP 中仅有 `manifest.json`、`signature.json` 和清单列举的资源；不包含源码宿主注册、安装脚本或用户数据。`signature.json` 包含 Base64 编码的 32 字节 Ed25519 公钥和签名。签名消息为 UTF-8 字节 `lanmind-web-plugin-v1\0`（最后一个字节为 NUL）拼接**原始 manifest.json 字节**。验证时不得重新序列化 JSON。

发布者身份为原始公钥的 SHA-256，插件身份为 `<publisherId>/<id>`。更换签名密钥会成为另一个发布者和插件，不继承原有数据及授权。有效签名验证内容及发布者连续性，不认证显示名称；界面统一标记“签名有效 · 发布者未认证”，无需额外信任发布者确认。

未签名插件明确标记“未签名 · 来源未经验证”，身份使用独立的 `unsigned/<id>` 命名空间，不能替换同 ID 的已签名插件。每次导入或从局域网安装未签名包都需要单独确认。未签名包首次安装默认不共享，可手动开启；旧版节点会忽略不支持的未签名目录项。为方便本地开发，可以确认替换同 ID、同版本的未签名包，保留存档并撤销原有业务访问授权。已有签名但签名无效的包仍直接拒绝，不能当作未签名包绕过检查。

包发布后保持原始字节不变。相同插件版本不得重新打包发布不同内容；更改内容必须提升版本号。每包最多 100 MiB，解包总计最多 300 MiB、5000 个资源文件，清单和签名各最多 256 KiB。禁止绝对路径、链接、重复路径、跨平台大小写冲突和 Windows 保留文件名。

## SDK 1

宿主在插件脚本执行前注入只读的 `window.LanMind`。所有方法返回 Promise；失败的 Error 包含稳定的 `code`，例如 `PLUGIN_PERMISSION_DENIED`、`PLUGIN_VERSION_CONFLICT`、`PLUGIN_FEATURE_DISABLED` 或 `PLUGIN_SESSION`。不会自动重试写操作。

| 方法 | 参数与行为 |
| --- | --- |
| `context.get()` | 当前插件、工作区基本信息、用户 ID、语言和主题 |
| `storage.get(key)` / `set(key, value)` / `delete(key)` | 插件、工作区、用户三者隔离的 JSON KV；单值最多 1 MiB，合计最多 10 MiB |
| `projects.list()` / `states.list()` | 当前用户可访问的项目和状态，要求 `tasks.read` |
| `tasks.list({ keyword?, projectId?, assigneeId?, offset?, limit? })` | 当前用户可见任务；沿用宿主业务工具的筛选参数与分页，返回 `items` 等信息 |
| `tasks.get(taskId)` | 读取任务和版本，要求 `tasks.read` |
| `tasks.create({ title, description?, projectId?, assigneeId?, ... })` | 创建任务，默认当前用户的个人任务，要求任务读写权限 |
| `tasks.update({ taskId, expectedVersion, patch })` | 修改任务；冲突时重新读取并由插件用户重新决定，不能盲目覆盖 |
| `wiki.list({ keyword?, projectId?, parentId?, offset?, limit? })` | 可见文档元信息，要求 `wiki.read` |
| `wiki.get(pageId)` 或 `wiki.get({ pageId, offset?, length? })` | 读取文档正文和版本；正文默认分段返回，检查 `nextOffset` |
| `wiki.create({ title, content, parentId?, projectId? })` | 创建文档，要求文档读写权限 |
| `wiki.update({ pageId, expectedVersion, title?, content? })` | 增量修改文档；不能绕过页面锁和版本检查 |

业务参数及返回值复用宿主 MCP 业务工具的结构，但仅映射上述白名单，不提供任意工具调用、删除、成员管理、文件系统或密码库访问。

插件可声明 `tasks.read`、`tasks.write`、`wiki.read`、`wiki.write`；声明写权限必须同时声明对应读权限。安装不会授予这些权限。首次调用时，宿主主窗口显示插件名称、当前工作区和需要的能力，用户允许后才继续调用。拒绝后本次运行不再重复询问，可重新打开插件再申请。

授权按插件身份、工作区和用户保存，可在插件详情撤销。升级保留仍声明的已有授权，新增能力需要重新申请；更换工作区、用户、锁定应用、停用或撤权都会使运行会话失效。数据权限、工作区成员资格、模块启停和写入版本在每次原生调用时重新检查。

主题使用 `--bg-canvas`、`--bg-surface`、`--bg-card`、`--text-main`、`--text-sub`、`--text-quiet`、`--border-main`、`--accent`。SDK 设置 `lang` 和 `color-scheme`，并在主题或语言变化时触发 `lanmind:context` 自定义事件，其 `detail` 为最新上下文。

## 安装与网络行为

安装包和已解包资源放在应用数据目录的 `plugins/` 下；原始包按 SHA-256 缓存，安装先暂存并完整验证，再切换本机记录。更新失败不替换旧安装，保留上一版本包用于恢复；卸载默认保留插件 KV，但撤销所有授权，用户可选择清除所有本机工作区中的插件 KV。

插件目录使用节点发现和文件服务端口，节点提供：

```text
GET /api/plugins/v1/catalog?offset=0
GET /api/plugins/v1/packages/{sha256}
```

目录为 `{ protocolVersion: 1, items: [{ metadata: { manifest, publicKey, signature }, sha256, sizeBytes }], nextOffset }`，每页最多 20 个包。旧节点的 404 被视为不支持。包接口只提供已登记、可用且开启共享的原始包；不接受文件路径，不提供任意目录浏览或安装用户数据。

共享默认面向全局域网，不依赖工作区凭据。市场按发布者与插件 ID 合并卡片，版本分别展示；相同版本、相同 SHA-256 合并在线节点来源，相同版本不同哈希标记冲突并禁止安装该版本。默认推荐最高兼容的稳定版本，不自动降级、不自动更新。

下载从原生发现的节点地址中随机选择，失败、超时、内容不完整或哈希错误时逐个切换；切换来源后重新下载，禁止拼接不同节点内容。跳转和系统代理关闭。离开设置页不取消后端任务，进度在再次进入后恢复显示；用户可显式取消。

网页插件通过只读资源协议和专用原生桥接运行。独立临时 WebView 不继承主窗口权限；原生命令白名单、资源校验、CSP、外部导航与新窗口拦截共同约束运行。禁用 WebRTC 构造器，并通过权限策略限制相机、麦克风和定位等浏览器能力。运行环境不开放外部网络请求、子框架、后台 Worker、任意原生命令或浏览器版安装；允许读取自身已签名的静态资源。

授权变更和业务写操作记录在本机审计表，包含插件、版本、工作区、用户、动作、目标 ID、时间及结果，不记录正文。插件记录和授权不参与同步；插件成功创建或修改的任务、文档沿用原有业务同步。

## 验证

```powershell
npm run test:plugins
npm run lint
npm run check:i18n
npx playwright test tests/theme/plugins.spec.ts tests/theme/features.spec.ts
cd src-tauri
cargo test plugin_ --lib
```

跨机器联调至少覆盖不同工作区发现、多个相同来源去重、坏来源切换、安装后继续转发、共享撤销，以及在真实 WebView 中检查 SDK、首次授权、版本冲突、应用锁和外部导航阻断。
