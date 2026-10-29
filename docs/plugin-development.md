# 插件开发教程：以 Password Vault 为例

本文面向准备为 LanMind 开发插件的贡献者和第三方开发者。先拆解现有 [Password Vault](password-vault.md)，再给出一个可以按文件复制的最小插件。通用约束见 [功能与插件开发规范](feature-modules.md)，构建环境见 [项目 README](../README.md#快速上手与开发构建)。

## 1. 当前支持的接入方式

当前采用**源码集成、随宿主编译发布**的内置插件机制。第三方提交插件源码和宿主接入改动，由集成者重新构建 LanMind；用户在“系统设置 → 功能与插件”启用或停用插件。

| 能力 | 当前行为 |
| --- | --- |
| 插件自己的目录、界面、翻译和命令归属 | 支持 |
| 启停状态保存、跨窗口通知 | 宿主提供；开关对本机所有工作区生效 |
| 插件清单中的语言资源 | 构建脚本自动收集 |
| 插件的视图、导航、原生命令与停用清理 | 按本文步骤在宿主源码中显式注册 |
| 导入 ZIP 后自动运行、热安装、独立更新 | 尚未实现 |
| 第三方代码沙箱、清单权限授权 | 尚未实现；插件与宿主处于相同权限域 |

`manifest.json` 描述插件，不负责执行代码。`entry`、`nativeEntry` 不会自动建立模块导入或 Tauri 命令注册，`commands` 也不是权限沙箱。发布时应在插件 README 声明兼容的宿主版本或提交、所需依赖和数据范围；当前没有自动校验宿主兼容性的 SDK 版本协议。

本文路径除单独注明外，均相对于仓库根目录。代码块标题指明代码应放入的文件；“增量片段”应合并到原文件，保留原有注册项。

## 2. 先看 Password Vault 的组织方式

### 2.1 文件职责

```text
lanmind/
  plugins/password-vault/
    manifest.json                 # 插件声明与翻译资源位置
    entry.tsx                     # 默认导出；检查启用状态
    client/
      index.ts                    # 类型、IPC、会话状态、错误翻译
      client.test.ts              # 迟到响应、文件夹工具等测试
    components/
      VaultApp.tsx                # 解锁页、主界面及页面内状态
      Panels.tsx                  # 编辑、生成、设置、导入导出、分享
      ShareCard.tsx               # 聊天中的密文分享入口
      ui.tsx                      # 插件内部复用控件
    locales/
      zh-CN.json
      en-US.json
  src-tauri/src/vault/
    mod.rs                        # vault_api 命令、事件、剪贴板
    model.rs                      # 数据结构
    storage.rs                    # 独立数据库、会话和事务
    crypto.rs                     # 加密与密钥包装
    generator.rs                  # 随机密码生成
    ssh.rs                        # SSH 密钥处理
    import_export.rs              # 导入导出
    sharing.rs                    # 局域网分享协议
    tests.rs                      # 原生行为测试
  tests/theme/
    vault.html
    vaultFixture.tsx              # 显式注入内存传输的界面样例
    vault.spec.ts
```

目录名、功能 ID 与翻译命名空间是不同概念。此插件的目录是 `password-vault`，功能 ID、导航段和命名空间都是 `vault`，命令为 `vault_api`。复制开发时，必须逐项替换，不能只改目录名。

前端业务留在插件目录；Rust 代码目前作为宿主 crate 的模块放在 `src-tauri/src/`，使用宿主 Cargo 依赖。复杂插件可按职责拆分文件，简单插件无需复制密码库的加密、会话和分享结构。

### 2.2 实际清单

以下内容对应 [Password Vault 清单](../lanmind/plugins/password-vault/manifest.json)：

```json
{
  "schemaVersion": 1,
  "id": "vault",
  "kind": "plugin",
  "version": "1.0.0",
  "nameKey": "vault:plugin.name",
  "descriptionKey": "vault:plugin.description",
  "section": "vault",
  "views": ["vault"],
  "settings": [],
  "commands": ["vault_api"],
  "commandPrefixes": ["vault_"],
  "entry": "./entry.tsx",
  "nativeEntry": "src-tauri/src/vault/mod.rs",
  "namespace": "vault",
  "distribution": "bundled",
  "defaultLocale": "zh-CN",
  "locales": {
    "zh-CN": "./locales/zh-CN.json",
    "en-US": "./locales/en-US.json"
  }
}
```

| 字段 | 含义与约束 |
| --- | --- |
| `schemaVersion` | 当前清单格式标记为 `1`；不要据此假定宿主实现了完整 schema 校验或迁移 |
| `id` | 功能开关和原生命令归属的唯一 ID；发布后保持稳定 |
| `kind` / `distribution` | 插件使用 `plugin` / `bundled`，在管理页归入预装插件 |
| `version` | 插件版本与契约变更记录，当前随宿主升级，不会触发独立更新 |
| `nameKey` / `descriptionKey` | 使用带命名空间的完整翻译键，供管理页与导航显示 |
| `section` / `views` | 导航段和视图归属；实际组件及路由仍需在宿主注册 |
| `settings` | 归属此功能的宿主设置 tab ID；不会自动生成设置页。插件内部设置面板可以保持 `[]` |
| `commands` | 精确命令名，原生分发器据此检查功能开关 |
| `commandPrefixes` | 可选命令前缀，仅覆盖本插件；不能使用空字符串或 `get_` 等公共前缀 |
| `entry` | 前端入口说明，相对于插件目录；对应静态 `import` 必须同步维护 |
| `nativeEntry` | 原生入口说明，现有约定相对于 `lanmind/`；纯前端插件可省略 |
| `namespace` | 独立翻译命名空间，不得与宿主或其他插件重复 |
| `defaultLocale` / `locales` | 默认语言及资源映射；语言文件路径相对于插件目录，必须留在该目录内 |

命令不得重复归属，前缀不得交叉；当前分发器按注册顺序取第一个匹配项，并不替开发者解决冲突。建议第三方在 ID、命令、事件、存储目录中加入自己的前缀，例如 `acme_hello`。

### 2.3 一次实际调用如何经过各层

以修改密码记录为例：

1. `Panels.tsx` 收集输入，调用 `client.call('save', { entry })`。
2. `client/index.ts` 通过 `invoke('vault_api', { action, payload, sessionVersion })` 进入原生层。
3. 宿主 `lib.rs` 根据清单确认命令属于 `vault`，停用时拒绝调用。
4. `vault/mod.rs` 检查主窗口、应用锁、插件状态和解锁会话版本。
5. `storage.rs` 校验数据、检查记录版本，并在事务中保存加密快照。
6. 客户端与原生事件通知界面刷新；跨越锁定会话的迟到结果被丢弃。

其中 `sessionVersion` 是密码库自己的保护机制，普通插件不必照搬。需要保留的是：前端统一访问层、后端校验、明确的数据范围、事务及异步结果归属。

## 3. 可复制的最小插件：Acme Hello

此示例只演示界面、翻译、IPC 和启停，不保存业务数据。示例目录为 `plugins/acme-hello`，ID、视图和导航段为 `acme_hello`，命名空间为 `acmeHello`。完成本节文件后，还需完成第 4 节的宿主注册。

### 3.1 清单与语言资源

`lanmind/plugins/acme-hello/manifest.json`：

```json
{
  "schemaVersion": 1,
  "id": "acme_hello",
  "kind": "plugin",
  "version": "1.0.0",
  "nameKey": "acmeHello:plugin.name",
  "descriptionKey": "acmeHello:plugin.description",
  "section": "acme_hello",
  "views": ["acme_hello"],
  "settings": [],
  "commands": ["acme_hello_api"],
  "commandPrefixes": ["acme_hello_"],
  "entry": "./entry.tsx",
  "nativeEntry": "src-tauri/src/acme_hello/mod.rs",
  "namespace": "acmeHello",
  "distribution": "bundled",
  "defaultLocale": "zh-CN",
  "locales": {
    "zh-CN": "./locales/zh-CN.json",
    "en-US": "./locales/en-US.json"
  }
}
```

`lanmind/plugins/acme-hello/locales/zh-CN.json`：

```json
{
  "plugin": { "name": "Hello 示例", "description": "演示插件界面与桌面接口。" },
  "title": "Hello 示例",
  "check": "显示问候",
  "ready": "你好，LanMind！",
  "errors": {
    "desktopOnly": "请在桌面应用中使用此功能。",
    "disabled": "Hello 插件已停用。",
    "locked": "请先解锁应用。",
    "unknown": "操作失败，请重试。"
  }
}
```

`lanmind/plugins/acme-hello/locales/en-US.json`：

```json
{
  "plugin": { "name": "Hello Example", "description": "Demonstrates a plugin view and desktop command." },
  "title": "Hello Example",
  "check": "Show greeting",
  "ready": "Hello, LanMind!",
  "errors": {
    "desktopOnly": "Use this feature in the desktop application.",
    "disabled": "The Hello plugin is disabled.",
    "locked": "Unlock the application first.",
    "unknown": "The operation failed. Try again."
  }
}
```

插件自行维护翻译。两个语言文件的键和插值参数必须一致，用户输入保持原文。生成脚本与 Rust 构建会读取清单，宿主语言目录不用再复制一份 JSON，也不要直接编辑生成的 `src/i18n/resources.ts`。

### 3.2 前端入口与客户端

`lanmind/plugins/acme-hello/entry.tsx`：

```tsx
import React from 'react';
import { useFeatures } from '../../src/modules/state';
import HelloApp from './components/HelloApp';

export default function AcmeHelloPlugin() {
  const enabled = useFeatures().acme_hello;
  return enabled ? <HelloApp /> : null;
}
```

`lanmind/plugins/acme-hello/client/index.ts`：

```ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import { tr } from '../../../src/i18n';

export async function checkHello(): Promise<{ ready: boolean }> {
  if (!isTauri()) throw new Error('ACME_HELLO_DESKTOP_ONLY');
  return invoke('acme_hello_api', { action: 'ping' });
}

export function helloError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  if (code === 'ACME_HELLO_DESKTOP_ONLY') return tr('acmeHello:errors.desktopOnly');
  if (code === 'FEATURE_DISABLED:acme_hello') return tr('acmeHello:errors.disabled');
  if (code === 'APP_LOCKED') return tr('acmeHello:errors.locked');
  return tr('acmeHello:errors.unknown');
}
```

业务组件通过客户端访问原生接口，便于替换测试传输和集中处理错误。未知后端错误显示通用文案，避免直接呈现底层路径、SQL 或敏感数据。为新 ID 扩展宿主公共错误解析时，还需检查 `src/i18n/messages.ts`；当前 `FEATURE_DISABLED` 解析使用显式 ID 列表。上例在插件内部处理此错误。

### 3.3 界面与异步卸载处理

`lanmind/plugins/acme-hello/components/HelloApp.tsx`：

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { tr, useLocale } from '../../../src/i18n';
import { checkHello, helloError } from '../client';

export default function HelloApp() {
  useLocale();
  const active = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const check = async () => {
    setBusy(true);
    setReady(false);
    setError('');
    try {
      const result = await checkHello();
      if (active.current) setReady(result.ready);
    } catch (cause) {
      if (active.current) setError(helloError(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  };

  return <section className="h-full overflow-auto bg-canvas p-6 text-main">
    <h1 className="text-lg font-semibold">{tr('acmeHello:title')}</h1>
    <button type="button" disabled={busy} onClick={() => void check()}
      className="mt-4 rounded-lg border border-edge bg-surface px-3 py-2 text-sm hover:bg-hover disabled:opacity-40">
      {tr('acmeHello:check')}
    </button>
    {ready && <p role="status" className="mt-4">{tr('acmeHello:ready')}</p>}
    {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
  </section>;
}
```

`useLocale()` 使运行中的页面响应语言切换，`tr('命名空间:键')` 读取插件翻译。宿主 `src/index.css` 已包含 `@source "../plugins"`，插件目录中的 Tailwind 类会进入构建；动态样式应列出完整类名，避免拼接无法静态扫描的类名。

使用语义主题变量，例如 `bg-canvas`、`bg-surface`、`text-main`、`text-sub`、`border-edge`。弹窗应支持焦点管理和 Escape；通过 Portal 渲染的菜单必须遵守根目录 [AGENTS.md](../AGENTS.md) 的定位规则。新插件可以仿照密码库的控件组织方式，但不应把另一个插件的私有组件当成稳定宿主 SDK。

### 3.4 原生命令

`lanmind/src-tauri/src/acme_hello/mod.rs`：

```rust
use serde_json::{json, Value};
use tauri::{AppHandle, State, WebviewWindow};
use crate::AppState;

#[tauri::command]
pub fn acme_hello_api(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    action: String,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("ACME_HELLO_WINDOW".into());
    }
    if crate::app_interface_locked(&app) {
        return Err("APP_LOCKED".into());
    }
    let db = state.db.lock().map_err(|_| "ACME_HELLO_STORAGE")?;
    db.require_feature("acme_hello")?;
    match action.as_str() {
        "ping" => Ok(json!({ "ready": true })),
        _ => Err("ACME_HELLO_ACTION".into()),
    }
}
```

此命令只返回固定状态，没有后台任务和数据写入，因此不需要新增 `AppState` 字段或原生停用回调。增加文件、数据库或网络业务时，应校验每个参数及当前用户/工作区权限；耗时任务不要持有全局数据库锁，恢复执行或提交前重新检查功能与上下文。密码库用 `spawn_blocking` 承载加密等阻塞操作，并有独立 Runtime 管理会话。

纯前端插件可以省略本小节和原生命令注册，并将清单的 `commands`、`commandPrefixes` 设为 `[]`，删除 `nativeEntry`。仍须在前后端功能目录中注册 ID，以保持桌面开关一致。

## 4. 将插件接入宿主

当前没有统一的动态路由或导航扩展 API，下列步骤都是实际需要的源码集成点。建议搜索 `vault` 对照现有实现，只增加新插件的分支，保留原有业务逻辑。

### 4.1 注册功能与延迟加载

在 `lanmind/src/modules/registry.ts` 合并以下改动：

```ts
// 新增导入。
import acmeHello from '../../plugins/acme-hello/manifest.json';

// 在既有联合类型中追加 'acme_hello'。
export type FeatureId = 'chat' | 'ai' | 'wiki' | 'optical' | 'vault' | 'acme_hello';

// 保留其他插件，并追加新清单。
export const features = [...catalog, optical, vault, acmeHello] as FeatureDefinition[];

// 在既有 defaultFeatureState 对象中追加：
// acme_hello: true
```

在 `lanmind/src/modules/views.tsx` 追加：

```tsx
export const AcmeHelloPlugin = moduleView('acme_hello', () => import('../../plugins/acme-hello/entry'));
```

`moduleView` 负责延迟加载和启停边界；插件入口自己的状态检查保留即可。现有 `FeatureManagementPanel` 遍历 `features` 自动生成管理项，不需要为每个插件复制开关界面。

在 `lanmind/src-tauri/src/feature_modules.rs` 的 `definitions()` 初始化中、返回 `items` 前追加：

```rust
items.push(
    serde_json::from_str(include_str!("../../plugins/acme-hello/manifest.json"))
        .expect("acme hello manifest"),
);
```

只修改前端目录会导致界面出现开关，但桌面原生层不认识该 ID。插件语言文件会自动扫描，前后端功能目录则都需要显式注册。

### 4.2 注册导航和页面

按下表完成增量接线。示例的导航段和视图 ID 都采用 `acme_hello`，减少映射数量。

| 文件 | 需要增加的内容 |
| --- | --- |
| `lanmind/src/app/AppRail.tsx` | `AppSection` 追加 `'acme_hello'`；导入一个图标（如 `Puzzle`），加入 `featureIcons.acme_hello`；为 props、参数解构、`handlers` 添加 `onAcmeHello` 回调 |
| `lanmind/src/components/Sidebar.tsx` | `MainView` 联合类型追加 `'acme_hello'` |
| `lanmind/src/App.tsx` | 从 `modules/views` 导入 `AcmeHelloPlugin`；为 `activeSection`、`goToSection` 和 `<AppRail>` 接好导航；增加独立页面渲染，并从任务画布、项目工具栏的默认分支中排除此视图 |
| `lanmind/src/App.tsx` 的可选入口 | 如需 URL hash 直达，在已有 hash 白名单追加视图；如需命令面板入口，追加命令并纳入功能开关过滤 |

`AppRail.tsx` 中对应的增量成员如下，分别加入已有对象和类型：

```tsx
// AppRailProps：
onAcmeHello?: () => void;
// featureIcons：
acme_hello: Puzzle,
// AppRail 参数解构：
onAcmeHello,
// handlers：
acme_hello: onAcmeHello,
```

`App.tsx` 中沿用现有 `vault` 分支增加对应行为：

```tsx
// activeSection 的条件链：currentView === 'acme_hello' 时返回 'acme_hello'。
// goToSection 的分支：
if (section === 'acme_hello') {
  setSelectedProjectId(null);
  setCurrentView('acme_hello');
}

// <AppRail> 追加属性：
// onAcmeHello={() => goToSection('acme_hello')}

// 主画布中，与 PasswordVaultPlugin 等独立页面并列：
{enabledFeatures.acme_hello && activeView === 'acme_hello' && <AcmeHelloPlugin />}

// 任务画布和项目工具栏的排除条件分别追加：
// activeView !== 'acme_hello' &&
```

上述片段标明各自放置位置，不能整体粘贴到一个函数。启停时，`featureForView()` 会从清单 `views` 找到归属；已有宿主逻辑会将停用功能的当前页面切回任务入口。

### 4.3 注册原生命令

对于带 Rust 实现的插件，在 `lanmind/src-tauri/src/lib.rs` 模块声明处增加：

```rust
mod acme_hello;
```

在现有 `tauri::generate_handler![...]` 列表中追加 `acme_hello::acme_hello_api`。保留外层已有的 `feature_modules::command_feature(...)` 检查，不要另建一个 `invoke_handler` 覆盖宿主分发器。

新增 Rust 或 JavaScript 依赖分别写入宿主 `src-tauri/Cargo.toml` 或 `package.json`，更新对应锁文件。当前插件没有独立依赖安装或构建流程。

完成注册后，桌面入口可打开 Hello 页面，点击“显示问候”调用原生命令；停用后导航和页面消失，直接调用命令返回 `FEATURE_DISABLED:acme_hello`。浏览器 `npm run dev` 可以查看界面，点击调用会提示使用桌面应用，这是此示例的预期行为。

## 5. 从 Hello 扩展到真实业务

### 5.1 生命周期与异步结果

| 时机 | 插件应做的事 | Password Vault 参考 |
| --- | --- | --- |
| 界面挂载 | 订阅必要状态，初始化客户端；只有需要时读取业务数据 | `VaultApp.tsx`、`client.initialize()` |
| 界面卸载 | 清理订阅、定时器、Worker、媒体与文件引用；丢弃属于旧页面的结果 | 页面内 `useEffect` 清理 |
| 插件停用 | 卸载界面，同时停止原生后台工作；保留已保存数据 | `feature_modules.rs` 中 `vault` 分支调用 `vault::lock` |
| 应用锁定、工作区切换 | 根据业务范围取消旧请求或锁定会话；避免结果写入新上下文 | `lib.rs` 的锁定入口、`vault::Runtime` |
| 重新启用 | 恢复入口，重新建立需要的会话；不自动恢复已撤销授权 | 密码库重新解锁 |

Hello 示例中的 `active` 标记只用于忽略卸载后的 UI 结果，不会取消原生工作。带写操作或长期任务的插件还需原生取消机制，以及提交前的开关、权限和工作区检查。

原生停用清理目前是在 `set_feature_module_enabled` 中显式添加分支，不存在自动调用的 `onDisable` 生命周期方法。若有后台 Runtime，应在这里调用自己的停止函数，并在应用退出、应用锁定或工作区切换等相关入口补齐清理。不要把“离开插件页面”一律等同于“停用插件”；密码库允许页面卸载后按独立会话规则自动锁定。

订阅 Tauri 事件时，还要处理 `listen()` 尚未完成就卸载的情况：在 Promise 返回后，如果已卸载，立即调用返回的取消订阅函数。异步页面、工作区或解锁会话切换时，单个布尔标记不足以区分不同请求，应使用请求序号或会话/上下文版本。

### 5.2 数据范围、事件和跨模块调用

每个业务插件应在自己的 README 写清以下约定：

- **数据归属**：应用级、本机身份级或工作区级。工作区业务从后端获取可信上下文并检查权限，不能只相信前端传入的 `workspaceId`、用户 ID 或记录 ID。
- **保存与迁移**：存储目录或表由谁维护、版本如何升级、失败如何回滚。独立数据库的备份、清理和卸载策略也由插件声明；功能开关只负责启停。
- **事件契约**：使用独占名称，例如 `acme_hello://changed`，写清载荷、范围和触发条件。事件通常只广播 ID、版本和状态，界面按权限重新读取数据。
- **能力依赖**：清单目前没有自动处理依赖的 `dependencies` 字段。调用 Chat、AI 或 Wiki 前，前端检查启用状态，后端检查 `require_feature`；相关能力关闭后，插件其他功能仍应可用。

密码库是本机身份级独立加密库；会话锁定事件不包含凭据。聊天分享是一个显式适配功能，另外检查 `chat`，并通过专用密文信封传输。新增独立插件不会自动获得聊天消息类型、工作区同步或 MCP 工具，扩展这些协议时需要专门的宿主集成和兼容性测试。

不要将密码库主密码、解密记录或私钥写入普通 workspace 快照、localStorage、日志、通用事件或无保护的导出。普通插件也应只请求和保存业务所需数据。需要管理敏感数据时，阅读 [密码库的存储与分享协议](password-vault.md)，不要把 Hello 示例扩写为自制加密方案。

## 6. 验证和交付

### 6.1 本地检查命令

下面是**现有 Password Vault** 的可运行验证入口；开发新插件时新增自己的测试文件，再替换相应路径。命令从仓库中的 `lanmind/` 目录执行：

```bash
npm run lint
npm run check:i18n
npx tsx --test plugins/password-vault/client/client.test.ts
npx playwright test tests/theme/vault.spec.ts tests/theme/features.spec.ts
npm run build
```

原生检查从 `lanmind/src-tauri/` 执行：

```bash
cargo test --lib vault::tests
cargo test --lib feature_modules::tests
```

发布前按改动范围运行完整回归；界面 fixture 使用显式测试传输，实际桌面持久化、网络和系统功能须用原生测试或桌面联调验证。可参考 `tests/theme/vaultFixture.tsx` 的注入方式，生产入口不要回退到浏览器明文存储。

### 6.2 第三方交付内容

当前推荐交付一个源码 PR 或可审查补丁，包含：

1. `plugins/<name>/`：清单、前端代码、中英文资源和插件 README；说明开发者、许可证、版本、兼容宿主、依赖、数据范围与使用方法。
2. 可选的原生模块与依赖锁文件，以及第 4 节涉及的全部宿主注册改动。
3. 自动生成的 `src/i18n/resources.ts` 更新；不要只提交语言 JSON 后遗漏生成资源。
4. 对实际业务有意义的测试、验证命令及结果。至少确认启停、重启持久化、资源清理、双语、主题、键盘和工作区边界；带原生命令时验证停用后的直接调用被拒绝。
5. 如有数据，说明迁移、导入导出、备份恢复和删除行为；如扩展网络协议，说明旧版本行为及真实设备联调结果。

只有插件目录的 ZIP 可以用于交换源码，当前管理页不能直接安装运行。插件升级随宿主构建发布；停用保留数据，暂时没有通用的卸载或插件数据清理接口。外部包加载、签名校验、权限授权、隔离和升级协议属于后续框架能力，不应在第三方发布说明中写成当前已支持。

### 6.3 常见接入问题

| 现象 | 优先检查 |
| --- | --- |
| 文件已经放入 `plugins/`，但管理页不显示 | 前端 `features`、`FeatureId`、`defaultFeatureState` 是否都已更新 |
| 桌面切换开关返回 `UNKNOWN_FEATURE` | Rust `definitions()` 是否包含同一 ID |
| 导航图标或点击行为异常 | `AppRail` 的图标、导航段、回调及 `App.tsx` 分支是否接齐 |
| 插件页面和任务列表同时显示 | 任务默认分支及项目工具栏是否排除了新视图 |
| 调用返回 command not found | `lib.rs` 的模块声明和 `generate_handler!` 是否注册；修改 Rust 后是否重新编译桌面端 |
| 停用后还能执行原生命令 | 命令是否被清单精确名称或专属前缀覆盖；业务入口是否检查 `require_feature` |
| 显示翻译键、检查报告重复命名空间 | `namespace`、完整翻译键、语言路径及 `npm run check:i18n` 的生成结果 |
| 插件样式缺失 | 宿主是否保留 `@source "../plugins"`；类名是否完整可扫描 |
| 浏览器能看界面但不能调用原生接口 | 使用 `npm run desktop`（Windows）或 `npm run desktop:unix`（macOS/Linux）验证桌面功能 |

完整业务实现以 [Password Vault 源码](../lanmind/plugins/password-vault/) 和 [原生模块](../lanmind/src-tauri/src/vault/) 为准；本文的 Acme Hello 是扩展教程，不会作为新插件自动加入应用。
