# 版本发布规范与流程手册

本手册规定智域协同（LanMind）桌面客户端的版本管理、构建和发布要求。当前工程版本为 **0.2.2**，发布标签为 **v0.2.2**。不得重复创建或覆盖已有版本 Tag。

## 版本与文档

采用 [语义化版本](https://semver.org/lang/zh-CN/) `MAJOR.MINOR.PATCH`。发布前确定目标版本，并核对以下来源：

- [package.json](lanmind/package.json)、[package-lock.json](lanmind/package-lock.json)、[Cargo.toml](lanmind/src-tauri/Cargo.toml)、[Cargo.lock](lanmind/src-tauri/Cargo.lock) 和 [tauri.conf.json](lanmind/src-tauri/tauri.conf.json) 使用一致的工程版本，不带 `v`。
- Git Tag 与 GitHub Release 使用 `v<version>`，安装包元数据对应 `<version>`。
- 同步 [README.md](README.md) 的当前版本、功能说明、截图与下载入口；配置和使用手册与交付功能保持一致。
- 更新 [release.yml](.github/workflows/release.yml) 中 `prepare-release` 的 `RELEASE_BODY`。确保工作流中的说明与本次发布内容同步。

## 发布前验证

在 `lanmind/` 目录安装依赖并执行：

```bash
npm ci
npx playwright install chromium
npm run check:i18n
npm run lint
npm test
npm run test:i18n
npm run test:task-content
npm run test:ai-questions
npm run test:optical
npm run build
npm run test:theme
npm run test:optical:browser
```

然后在 `lanmind/src-tauri/` 执行：

```bash
cargo check --locked
cargo test --locked --lib
```

完整手工步骤见 [测试手册](docs/TESTING.md)。AI 原生脚本用例默认跳过，须先构建桌面二进制、设置 `LANMIND_AI_TEST_BINARY`，再按测试手册单独运行。浏览器 fixture、协议测试服务和构建成功只覆盖各自测试范围。

发布验收覆盖以下范围：

- **任务与追问交互**：我的任务与协作项目卡片的必要字段、密度记忆、只读权限和窄屏布局；删除取消、失败重试及子任务保留/一并删除；协作者自定义状态在后续编辑中保留；多项文本追问合并提交及 Wiki 保存、历史预览、恢复前草稿备份。定向命令见 [测试手册](docs/TESTING.md#自动化检查)。
- **旧数据升级**：使用旧数据库副本验证工作区归属、`.workspace-v2.bak` 备份、无法判断归属记录的隔离保留、任务状态和主题迁移，以及重复启动的幂等性。工作区数据边界见 [架构说明](docs/ARCHITECTURE.md#概念层级)。
- **原生双节点**：两区各自凭据、同区同步、跨区拒绝、离线重连、多窗口切区、文件授权与外部 MCP/Web 授权失效，不能只使用 React fixture 验收。
- **真实 AI 服务**：分别验证目标 Ollama、vLLM、SGLang、OpenAI 或 Anthropic 兼容服务的发现、流式输出、工具调用与取消；Agent 模型须通过实际工具往返测试。
- **多平台安装包**：Windows、macOS（Apple Silicon / Intel）、Linux 验证安装、启动、退出、旧数据读取，以及托盘、截图、自动锁定、桌面日历、文件/凭据/子进程限制。未验收的平台与服务应在发布说明中列明。

升级前备份完整应用数据目录，包括 SQLite 数据库及其配套的加密密钥；AI 运行恢复记录不能替代数据备份。不要用真实个人数据做破坏性迁移测试。

## 仓库与待提交文件

提交前执行 `git status --short`、`git diff --check` 并审查暂存内容。保留源码、测试、语言包、当前架构与兼容说明和依赖锁文件；不要提交构建产物、本地数据库、凭据、测试截图、日志或一次性打包输出。目录规则见 [.gitignore](.gitignore)。

## GitHub Actions 发布

[release.yml](.github/workflows/release.yml) 接收 `v*` Tag，检查可选 Apple 凭据并创建 Release 草稿，再构建 Windows 和 Ubuntu 24.04 两个矩阵任务。所有任务成功后一起公开产物；任一任务失败则保留草稿。macOS 矩阵当前停用，需从源码构建。当前工作流只运行打包校验脚本的测试，不执行完整应用单元测试、Playwright 和原生手工验收，以上检查需要事先完成。

恢复 macOS 矩阵前可按规范配置六项 GitHub Actions Secrets（`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`）。现有校验脚本在完全未配置时允许跳过，部分配置时会拒绝继续；恢复打包后，应明确决定签名、公证和校验要求。

完成版本更新、审查和提交后，为已经确认的发布提交创建新 Tag：

```bash
# 将占位符替换为本次确定的新版本号和已审查提交，再执行
git tag v<version> <release-commit>
git push origin v<version>
```

推送 Tag 会触发发布流程。确认两个矩阵任务及 `publish-release` 完成，逐项核对 Release 说明、安装包版本、文件数量和下载文件的 SHA-256。`workflow_dispatch` 也必须选择与工程版本一致的版本 Tag，不接受分支引用。失败后可在同一 Tag 重试其草稿，已公开的 Release 不允许重新上传覆盖，修复应使用新版本。

## 本地打包与产物

在 `lanmind/` 执行：

```powershell
# Windows
npm run desktop:build
```

```bash
# macOS / Linux
npm run desktop:build:unix
```

默认产物根目录为 `lanmind/src-tauri/target/release/bundle/`；指定 Rust target 时位于对应的 `target/<triple>/release/bundle/`。

| 平台 | 目录与格式 | 示例文件名 |
| --- | --- | --- |
| Windows | `nsis/*.exe`、`msi/*.msi` | `LanMind_<version>_x64-setup.exe`、`LanMind_<version>_x64_en-US.msi` |
| macOS | `dmg/*.dmg`、`macos/*.app` | `LanMind_<version>_aarch64.dmg`、`LanMind_<version>_x64.dmg` |
| Linux | `deb/*.deb`、`appimage/*.AppImage` | `lanmind_<version>_amd64.deb`、`LanMind_<version>_amd64.AppImage` |

实际名称、架构和语言以后端打包配置为准。发布可下载产物与校验清单，不将二进制、部署压缩包或本地数据提交进源码仓库。
