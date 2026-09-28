# 版本发布规范与流程手册 (Release Guide)

本文档规范智域协同（LanMind）桌面客户端的版本发布流程、前置检查清单与产物交付规范。

---

## 1. 版本号规范

项目严格遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范：`vMAJOR.MINOR.PATCH`（例如 `v0.1.4`）：
- **MAJOR（主版本号）**：包含不兼容的重大架构升级或底层协议变更；
- **MINOR（次版本号）**：包含向下兼容的功能性新增（如新增光学隔空传输、新增组织目录树等）；
- **PATCH（修订版本号）**：包含向下兼容的故障修复、性能与样式优化。

---

## 2. 发版前检查清单 (Pre-release Checklist)

在打 Tag 或触发构建前，请确认完成以下 5 项检查：

### 2.1 版本号一致性确认
确保以下 4 个文件中的版本号保持严格一致：
- [lanmind/package.json](file:///d:/code/2026/lanmind/lanmind/package.json) 中的 `"version"`
- [lanmind/src-tauri/Cargo.toml](file:///d:/code/2026/lanmind/lanmind/src-tauri/Cargo.toml) 中的 `version`
- [lanmind/src-tauri/tauri.conf.json](file:///d:/code/2026/lanmind/lanmind/src-tauri/tauri.conf.json) 中的 `"version"`
- [README.md](file:///d:/code/2026/lanmind/README.md) 顶部的版本标识

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

### 2.3 更新日志完善
- 在 [CHANGELOG.md](file:///d:/code/2026/lanmind/CHANGELOG.md) 中将当前待发布的特性由 `[Unreleased]` 移至对应版本（如 `[v0.1.5] - 2026-XX-XX`）。

### 2.4 工作区与忽略文件检查
确保无临时测试文件、调试日志或未配置的环境文件被暂存：
```bash
git status
```

---

## 3. 自动化云端发版（推荐）

项目配置了完整的多平台 GitHub Actions 构建流水线 [`.github/workflows/release.yml`](file:///d:/code/2026/lanmind/.github/workflows/release.yml)。

### 发布步骤：
1. 提交所有变更：
   ```bash
   git add .
   git commit -m "release: v0.1.5"
   git push origin main
   ```
2. 打上对应版本 Tag 并推送到远端：
   ```bash
   git tag v0.1.5
   git push origin v0.1.5
   ```
3. GitHub Actions 将自动启动矩阵并行构建（Windows、macOS Apple Silicon & Intel、Ubuntu 22.04），构建完成后将自动在 GitHub Releases 创建发布草稿/正式版本，并上传各平台安装包。

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
