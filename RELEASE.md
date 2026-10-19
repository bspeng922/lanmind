# 版本发布规范与流程手册

本手册用于智域协同（LanMind）桌面客户端的后续发布。当前最新已发布版本和工程版本均为 **v0.2.0 / 0.2.0**，本地开发改动记在 [CHANGELOG.md 的 Unreleased](CHANGELOG.md#unreleased)。尚未确定下一版本号；不要重复创建或覆盖已有的 `v0.2.0` Tag。

## 版本与文档

采用 [语义化版本](https://semver.org/lang/zh-CN/) `MAJOR.MINOR.PATCH`。发布前确定目标版本，并核对以下来源：

- [package.json](lanmind/package.json)、[package-lock.json](lanmind/package-lock.json)、[Cargo.toml](lanmind/src-tauri/Cargo.toml)、[Cargo.lock](lanmind/src-tauri/Cargo.lock) 和 [tauri.conf.json](lanmind/src-tauri/tauri.conf.json) 使用一致的工程版本，不带 `v`。
- Git Tag 与 GitHub Release 使用 `v<version>`，安装包元数据对应 `<version>`。
- 将实际交付的 `Unreleased` 内容移入新版本和真实发布日期，保留历史版本；同步 [README.md](README.md) 的已发布摘要、截图与下载入口。
- 更新 [release.yml](.github/workflows/release.yml) 中的 `releaseBody`。目前仍是 v0.2.0 摘要，工作流不会自动把 `Unreleased` 转为新版本说明。

## 发布前验证

在 `lanmind/` 目录安装依赖并执行：

```bash
npm ci
npm run check:i18n
npm run lint
npm test
npm run test:i18n
npm run test:task-content
npm run test:optical
npm run build
npx playwright install chromium
npm run test:theme
npm run test:optical:browser
```

然后在 `lanmind/src-tauri/` 执行：

```bash
cargo check --locked
cargo test --locked --lib
```

完整手工步骤见 [测试手册](docs/TESTING.md)。AI 原生脚本用例默认跳过，须先构建桌面二进制，再按 [AI 实施说明](docs/AI_AGENT_DELIVERY.md#验证方式) 单独运行。浏览器 fixture、协议测试服务和构建成功只覆盖各自测试范围。

当前开发改动发布前，还需记录以下验收结果：

- **旧数据升级**：使用旧数据库副本验证工作区归属、`.workspace-v2.bak` 备份、无法判断归属记录的隔离保留、任务状态和主题迁移，以及重复启动的幂等性。迁移细节见 [工作区隔离记录](docs/WORKSPACE_ISOLATION_PLAN.md)。
- **原生双节点**：两区各自凭据、同区同步、跨区拒绝、离线重连、多窗口切区、文件授权与外部 MCP/Web 授权失效，不能只使用 React fixture 验收。
- **真实 AI 服务**：分别验证目标 Ollama、vLLM、SGLang 或 OpenAI 兼容服务的发现、流式输出、工具调用与取消；Agent 模型须通过实际工具往返测试。
- **多平台安装包**：Windows、macOS（Apple Silicon / Intel）、Linux 验证安装、启动、退出、旧数据读取，以及托盘、截图、自动锁定、桌面日历、文件/凭据/子进程限制。未验收的平台与服务应在发布说明中列明。

升级前备份完整应用数据目录，包括 SQLite 数据库及其配套的加密密钥；AI 运行恢复记录不能替代数据备份。不要用真实个人数据做破坏性迁移测试。

## 仓库与待提交文件

提交前执行 `git status --short`、`git diff --check` 并审查暂存内容。保留新增源码、测试、语言包、设计/迁移文档和依赖锁文件；不要提交构建产物、本地数据库、凭据、截图、日志或一次性打包输出。目录规则见 [仓库文件维护](docs/REPOSITORY_HYGIENE.md)。

## GitHub Actions 发布

[release.yml](.github/workflows/release.yml) 接收 `v*` Tag，构建 Windows、macOS Apple Silicon、macOS Intel 和 Ubuntu 24.04 四个矩阵任务，并上传安装包到正式 GitHub Release。当前工作流不执行完整单元测试、Playwright 和原生手工验收，以上检查需要事先完成。

完成版本更新、审查和提交后，为已经确认的发布提交创建新 Tag：

```bash
# 将占位符替换为本次确定的新版本号和已审查提交，再执行
git tag v<version> <release-commit>
git push origin v<version>
```

推送 Tag 会触发公开发布。确认四个矩阵任务完成，逐项核对 Release 说明、安装包版本、文件数量和下载文件的 SHA-256。`workflow_dispatch` 只用于明确选择目标引用后的构建操作；正式发布使用版本 Tag。

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
