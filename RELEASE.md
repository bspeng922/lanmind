# 版本发布规范与流程手册 (Release Guide)

本文档规范智域协同（LanMind）桌面客户端的版本发布流程、前置检查清单与产物交付规范。当前发布目标为 **v0.2.0**。

---

## 1. 版本号规范

项目严格遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范：`vMAJOR.MINOR.PATCH`。当前版本为 `v0.2.0`：
- **MAJOR（主版本号）**：包含不兼容的重大架构升级或底层协议变更；
- **MINOR（次版本号）**：包含向下兼容的功能性新增（如新增光学隔空传输、新增组织目录树等）；
- **PATCH（修订版本号）**：包含向下兼容的故障修复、性能与样式优化。

---

## 2. 发版前检查清单 (Pre-release Checklist)

在打 Tag 或触发构建前，请确认完成以下 5 项检查：

### 2.1 版本号一致性确认
确保以下版本来源都指向 `v0.2.0`：
- [lanmind/package.json](lanmind/package.json)、[lanmind/src-tauri/Cargo.toml](lanmind/src-tauri/Cargo.toml) 和 [lanmind/src-tauri/tauri.conf.json](lanmind/src-tauri/tauri.conf.json) 使用构建版本 `0.2.0`（工程配置不带 `v` 前缀）；
- [README.md](README.md) 和 [CHANGELOG.md](CHANGELOG.md) 使用用户可见版本 `v0.2.0`；
- Git Tag、GitHub Release 和安装包元数据使用 `v0.2.0` / `0.2.0` 的对应形式，不得混用其他版本。

### 2.2 代码与类型质量检查
在 `lanmind/` 目录下运行：
```bash
# 1. 前端类型检查
npm run lint

# 2. 前端单元测试
npm test

# 3. 光学传输核心算法单元测试
npm run test:optical

# 4. Rust 后端单元测试
cd src-tauri && cargo test && cd ..
```

### 2.3 更新日志与用户文档
- 在 [CHANGELOG.md](CHANGELOG.md) 中记录 `[v0.2.0] - 2026-10-12`，并按新增、改进、修复和验证范围归类；
- 确认 [README.md](README.md) 的版本摘要、下载入口、构建命令和功能描述与当前代码一致；
- 若 `Unreleased` 有内容，将已交付内容移入版本章节，并保留下一版本的空白入口。

### 2.4 构建与产物检查
在 `lanmind/` 目录执行至少以下检查：
```bash
npm ci
npm run check:i18n
npm run lint
npm test
npm run test:optical
npm run build
cd src-tauri && cargo test --lib
```

确认 Windows、macOS 和 Linux 目标平台至少完成一次安装包启动验证；截图、托盘、自动锁定、网络伺服和光学接收器等原生功能不能只依赖浏览器预览。

### 2.5 工作区与忽略文件检查
确保无临时测试文件、调试日志或未配置的环境文件被暂存：
```bash
git status
```

---

## 3. 自动化云端发版（推荐）

项目配置了完整的多平台 GitHub Actions 构建流水线 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

### 发布步骤：
1. 提交所有变更：
   ```bash
   git add .
   git commit -m "release: v0.2.0"
   git push origin main
   ```
2. 打上对应版本 Tag 并推送到远端：
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. GitHub Actions 将自动启动矩阵并行构建（Windows、macOS Apple Silicon & Intel、Ubuntu 24.04），构建完成后将在 GitHub Releases 创建 `v0.2.0` 正式版本并上传各平台安装包。

推送 Tag 后，在 Actions 页面确认四个矩阵任务均成功，再检查 Release 页面中的文件数量、SHA-256 校验值和版本元数据。`workflow_dispatch` 适合重跑指定分支或 Tag 的构建，正式发版仍应使用版本 Tag 触发。

---

## 4. 本地打包与测试发布

如需在本地离线或私有环境中打包产物：

### Windows 环境：
```powershell
cd lanmind
npm run desktop:build
# 或直接运行
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```
> 输出路径：`lanmind/src-tauri/target/release/bundle/nsis/*.exe` 与 `bundle/msi/*.msi`

### macOS / Linux 环境：
```bash
cd lanmind
npm run desktop:build:unix
# 或直接运行
bash scripts/build-desktop.sh
```
> macOS 输出路径：`lanmind/src-tauri/target/release/bundle/dmg/*.dmg` 与 `*.app`  
> Linux 输出路径：`lanmind/src-tauri/target/release/bundle/deb/*.deb` 与 `*.AppImage`

---

## 5. 发布产物清单校验

正式对外发布的产物命名与规范如下：

| 平台 | 格式 | 说明 |
| :--- | :--- | :--- |
| **Windows** | `LanMind_<version>_x64-setup.exe` | 推荐普通用户使用（NSIS 安装向导） |
| **Windows** | `LanMind_<version>_x64_en-US.msi` | 适合内网域策略批量部署 (GPO) |
| **macOS** | `LanMind_<version>_aarch64.dmg` | 适用于 Apple Silicon (M1/M2/M3/M4) 系列芯片 |
| **macOS** | `LanMind_<version>_x64.dmg` | 适用于 Intel 架构 Mac 设备 |
| **Linux** | `lanmind_<version>_amd64.deb` | 适用于 Ubuntu / Debian 系列发行版 |
| **Linux** | `LanMind_<version>_amd64.AppImage` | 免安装便携格式，适配多数 Linux 桌面 |

其中 `<version>` 在本次发布中为 `0.2.0`。发布前应确认安装包可以在干净环境安装、启动、退出，并且旧版本本地数据能够正常读取；升级不会覆盖任务、聊天记录、锁屏配置或语言偏好。
