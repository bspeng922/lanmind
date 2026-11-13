# 主题样式与自定义

本目录提供 `dark/`（暗色）和 `light/`（亮色）两套内置主题，`registry.ts` 按暗色、亮色顺序注册。`system` 是“跟随系统”偏好，按系统明暗模式解析为两套主题之一；缺省主题为暗色。修改主题源码后运行 `npm run build`，桌面安装包还需重新构建；当前没有运行时导入主题文件或应用内配色编辑功能。

已保存的兼容主题 ID 由 `src/utils/theme.ts` 的 `migrateThemePreference` 按下表解析，启动预加载和 React 共用该逻辑：

| 兼容 ID | 当前 ID |
| --- | --- |
| `navy-slate`、`aurora-purple`、`cyber-emerald` | `dark` |
| `warm-amber`、`titanium-light` | `light` |
| `system` | `system`，继续跟随系统 |

## 文件职责

每个主题目录均包含：

- `theme.ts`：主题 ID、名称、说明和选择器预览，保持 `ThemeConfig` 接口兼容。
- `tokens.css`：主题语义变量，包括页面、面板、文字、边框、反馈颜色、遮罩、阴影和代码高亮。
- `components.css`：特定组件的变量覆盖，例如聊天气泡、日历、项目管理按钮。未声明的项目沿用公共组件样式。

`registry.ts` 汇总主题元数据；`index.css` 汇总 CSS。`component-defaults.css` 在每个 `[data-theme]` 边界将组件覆盖变量重置为 `initial`，防止外层明亮主题影响内层独立深色日历。

`state-tokens.css` 单独定义跨主题固定的工作项状态与优先级颜色：`backlog`、`unstarted`、`started`、`completed`、`cancelled` 五个状态组和 `blocked` 扩展，以及 `urgent`、`high`、`medium`、`low`、`none` 优先级。项目可定义具体状态名称，显示按所属状态组使用语义变量；不要在每套主题中另配一套状态颜色。状态组不是主题的成功/警告/错误反馈色。

公共布局、控件及状态规则位于上一级的 `base.css`、`components.css`、`controls.css`。`component-variants.css` 将组件变量应用到明确的组件选择器；通过 `var(--变量, revert-layer)` 在未覆盖时退回公共规则。这些文件不存放某个主题的专属颜色。

## 常用变量与类名

| 用途 | CSS 变量 | Tailwind 类名示例 |
| --- | --- | --- |
| 页面 / 面板 / 卡片 | `--bg-canvas` / `--bg-surface` / `--bg-card` | `bg-canvas` / `bg-surface` / `bg-card` |
| 输入 / 悬停 | `--bg-input` / `--bg-hover` | `bg-input` / `hover:bg-hover` |
| 主文字 / 次文字 / 辅助文字 | `--text-main` / `--text-sub` / `--text-muted` | `text-main` / `text-sub` / `text-quiet` |
| 分隔线 / 控件边界 | `--border-main` / `--border-subtle` | `border-edge` / `border-subtle` |
| 强调色 / 强调按钮文字 | `--accent` / `--accent-contrast` | `text-accent` / `text-on-accent` |
| 主要按钮 | `--accent-gradient`、`--accent-contrast` | `theme-btn-primary` |
| 信息 / 成功 / 警告 / 危险 / 群组 | `--info` / `--success` / `--warning` / `--danger` / `--feature` | `text-info` / `bg-success/10` / `text-warning` / `text-danger` / `text-feature` |
| 实心状态按钮 | `--danger-strong` / `--warning-solid` / `--feature-solid` | 与 `--on-solid` 或 `--on-warning-solid` 搭配 |
| 弹窗遮罩 | `--overlay` | `bg-overlay` |
| 滚动条滑块 | `--scrollbar-thumb`、`--scrollbar-thumb-hover` | 标准滚动条属性与 WebKit 回退 |
| 阴影 | `--soft-shadow` / `--panel-shadow` / `--popover-shadow` | `shadow-soft` / `shadow-panel` / `shadow-popover` |
| 键盘焦点 | `--focus-ring` | 共用控件自动使用 |
| Markdown 高亮 | `--code-comment`、`--code-string`、`--code-keyword` 等 | `.markdown-body .token.*` 自动使用 |
| 桌面日历底色 | `--calendar-tint`（空格分隔 RGB） | 与用户透明度组合 |

状态修饰作用于完整类名，如 `hover:bg-hover/80`、`focus:border-accent`，默认状态不会因类名包含 `hover:` 而受到影响。不要增加 `[class*="bg-…"]` 这类全局匹配，也不要用全局 `.text-white` 覆盖解决局部颜色问题。

## 共享排版与布局

`../layout-tokens.css` 定义跨主题的字号、间距、控件尺寸和阅读宽度；`../layout.css` 定义显式组件类及容器响应式规则。颜色继续由本目录的主题变量提供。避免用全局选择器强制放大所有小字、图标或专用编辑器。

| 用途 | 类名 / 变量 | 默认大小（根字号 16px） |
| --- | --- | --- |
| 计数、徽标、分组标签 | `text-caption` / `--font-size-caption` | 11px |
| 次要说明、表单标签 | `text-meta` / `--font-size-meta` | 12px |
| 常规界面正文 | `text-body` / `--font-size-body` | 13px |
| 对话与阅读正文 | `text-reading` / `--font-size-reading` | 14px |
| 区块标题 / 页面标题 | `text-section` / `text-page` | 16px / 20px |
| 紧凑 / 标准 / 大控件 | `--control-size-sm` / `--control-size` / `--control-size-lg` | 32px / 36px / 40px |

字号与控件尺寸使用 `rem`，行高使用无单位比例。文字控件用最小高度配合内容撑高，避免文字缩放后被固定高度裁切。共享控件按需使用 `ui-field`、`ui-button`、`ui-icon-button`；输入框内有图标或按钮时，通过 `--ui-field-padding-start` / `--ui-field-padding-end` 预留空间。专用编辑器、媒体画布和原生窗口按钮保留独立尺寸规则。

模型供应商与工作区基础卡片使用 Grid 自动排布。设置导航、AI 对话、局域网聊天、Wiki 和密码库按实际容器宽度调整分栏；不支持容器查询的 WebView 使用媒体查询回退。`dvh` 前保留 `vh` 声明，`scrollbar-gutter` 和 `text-wrap` 作为渐进增强。不要仅因为构建成功就假定 WebView 支持新 CSS/API。

窄窗口中保持菜单、侧栏内容可滚动访问。侧栏的实际滚动区域使用 `sidebar-scroll`，有独立标题或搜索栏的容器使用 `sidebar-scroll-region`。主导航、设置、会话列表、Wiki 目录与大纲、工作区组织树、任务属性、汇报选项和密码库导航共用细滚动条、透明轨道和主题配色，支持横向与纵向滚动。鼠标移入侧栏或键盘焦点进入时显示滚动条，触屏与高对比度模式保留可见滚动提示，显示隐藏时保持内容位置稳定。窄图标栏保留上下滚动箭头。正文和编辑器使用常规滚动条。

密码库在窄容器中切换列表与详情，详情顶部保留返回列表按钮；宽容器继续显示多栏。Wiki 标准模式与 AI 对话内容随可用宽度伸缩，上限由 `--document-width` 和 `--conversation-width` 控制，默认均为 `80rem`；Wiki 全宽模式取消文档宽度上限。

明亮模式使用浅灰色滚动条滑块，设置导航与通用滚动区域共用配色。未定义滚动条 token 的主题沿用文字色回退，高对比度与强制色模式优先保证可见性。

新建、编辑、删除和确认弹窗只能通过显式关闭、取消或现有键盘操作退出，点击遮罩不关闭；详情、预览和历史弹窗可点击遮罩关闭。共用弹窗组件默认禁止遮罩关闭，由信息类调用方显式启用；编辑或提交期间暂停遮罩关闭。嵌套弹窗必须阻止事件冒泡误关父弹窗。

排版回归见 `tests/theme/visual-layout.spec.ts`，覆盖双主题、320/780/1440px 的供应商表单、390px 与 200% 根字号的核心页面，以及聊天最大化/还原。完整检查仍按下方“验证”执行。

## 修改现有主题

例如调整亮色主题的底色，在 `light/tokens.css` 中修改：

```css
[data-theme="light"] {
  --bg-canvas: #f3f4f6;
  --bg-surface: #ffffff;
  --bg-hover: #e9eef5;
  --text-main: #111827;
  --accent: #1d4ed8;
}
```

组件有独立视觉要求时，修改该目录的 `components.css`，例如：

```css
[data-theme="light"] {
  --component-chat-bubble-self-background: #e8f0fe;
  --component-chat-bubble-self-border-color: #bfdbfe;
}
```

覆盖变量名称与 `component-variants.css` 对应。新增组件覆盖时，同时在 `component-defaults.css` 注册为 `initial`，确保嵌套主题独立。普通变量已有对应语义时优先引用它，不要重复固定颜色。

## 添加主题

1. 复制一个相近的主题目录，修改三份文件中的主题 ID、名称、颜色和预览信息。
2. 在 `src/types.ts` 的 `ThemeId` 中添加 ID，并在本目录的 `registry.ts` 注册元数据。
3. 在本目录的 `index.css` 导入新目录的 `tokens.css` 和 `components.css`，保留公共 `state-tokens.css`。现有 `dark`、`light`、`system` 及旧 ID 映射须保持兼容；替换 ID 时明确补充迁移。
4. 更新 `src/utils/theme.ts` 中的偏好解析和明暗分类；“跟随系统”默认映射为 `light` / `dark`。新增显示名称与描述须同步双语语言包。
5. 检查主题选择、刷新、首屏预加载、系统切换和辅助窗口，并扩充主题回归用例中的主题列表及迁移测试。

CSS 层顺序为 `theme → base → utilities → components → theme-variants`。组件状态和局部覆盖具有明确优先级，无需继续堆积 `!important`。主题变量在对应 `[data-theme]` 容器中继承，React 组件通过 `useTheme` 切换；启动脚本与 React 共用 `applyTheme`。

## 内容与主题的边界

应用工具栏、阅读区域、菜单和表单随主题变化。Word/PDF 页面自身配色、PPT 模板、图片视频、用户选择的项目标识颜色，以及系统窗口控制按钮颜色独立保留。桌面日历自定义颜色继续由用户设置决定，透明度只改变底色，不改变文字透明度。

## 验证

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:theme
```

浏览器回归使用 `tests/theme/` 中的独立数据和真实组件；不读写真实数据库、不发送聊天消息、不上传文件。测试页只供 Vite 开发服务器使用，不是生产构建入口。截图和失败跟踪输出到 `test-results/`。

自动检查包括亮/暗主题的文件面板、搜索与新建目录，亮色模式的主要页面与弹窗、可读文字对比度、悬停/焦点/选中、嵌套主题、持久化和跨窗口同步；单元测试覆盖旧 ID 迁移与系统偏好解析。文字检查对普通平面背景使用 4.5:1、大号文字使用 3:1；禁用、透明整体和渐变/文档内容需结合截图检查。

原生桌面验证还应确认真实通知窗口、壁纸透出效果、日历透明度 0% / 45% / 90% 及独立自定义配色；浏览器截图不能替代原生窗口层级与桌面合成验证。
