# 主题样式与自定义

本目录是五个内置主题的入口。修改主题源码后运行 `npm run build`，桌面安装包还需重新构建；当前没有运行时导入主题文件或应用内配色编辑功能。

## 文件职责

每个主题目录均包含：

- `theme.ts`：主题 ID、名称、说明和选择器预览，保持 `ThemeConfig` 接口兼容。
- `tokens.css`：全局语义变量，包括页面、面板、文字、边框、状态色、遮罩、阴影和代码高亮。
- `components.css`：特定组件的变量覆盖，例如聊天气泡、日历、项目管理按钮。未声明的项目沿用公共组件样式。

`registry.ts` 汇总主题元数据；`index.css` 汇总 CSS。`component-defaults.css` 在每个 `[data-theme]` 边界将组件覆盖变量重置为 `initial`，防止外层明亮主题影响内层独立深色日历。

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
| 阴影 | `--soft-shadow` / `--panel-shadow` / `--popover-shadow` | `shadow-soft` / `shadow-panel` / `shadow-popover` |
| 键盘焦点 | `--focus-ring` | 共用控件自动使用 |
| Markdown 高亮 | `--code-comment`、`--code-string`、`--code-keyword` 等 | `.markdown-body .token.*` 自动使用 |
| 桌面日历底色 | `--calendar-tint`（空格分隔 RGB） | 与用户透明度组合 |

状态修饰作用于完整类名，如 `hover:bg-hover/80`、`focus:border-accent`，默认状态不会因类名包含 `hover:` 而受到影响。不要增加 `[class*="bg-…"]` 这类全局匹配，也不要用全局 `.text-white` 覆盖解决局部颜色问题。

## 修改现有主题

例如调整明亮主题的底色，在 `titanium-light/tokens.css` 中修改：

```css
[data-theme="titanium-light"] {
  --bg-canvas: #f3f4f6;
  --bg-surface: #ffffff;
  --bg-hover: #e9eef5;
  --text-main: #111827;
  --accent: #1d4ed8;
}
```

组件有独立视觉要求时，修改该目录的 `components.css`，例如：

```css
[data-theme="titanium-light"] {
  --component-chat-bubble-self-background: #e8f0fe;
  --component-chat-bubble-self-border-color: #bfdbfe;
}
```

覆盖变量名称与 `component-variants.css` 对应。新增组件覆盖时，同时在 `component-defaults.css` 注册为 `initial`，确保嵌套主题独立。普通变量已有对应语义时优先引用它，不要重复固定颜色。

## 添加主题

1. 复制一个相近的主题目录，修改三份文件中的主题 ID、名称、颜色和预览信息。
2. 在 `src/types.ts` 的 `ThemeId` 中添加 ID，并在本目录的 `registry.ts` 注册元数据。
3. 在本目录的 `index.css` 导入新目录的 `tokens.css` 和 `components.css`。五个现有 ID 和 `system` 的含义保持不变，已保存的用户设置无需迁移。
4. 若新增另一种浅色主题，更新 `applyTheme` 中的明暗分类；“跟随系统”默认仍映射为钛白明亮 / 深蓝星空。
5. 检查主题选择、刷新、系统切换和辅助窗口，并扩充主题回归用例中的主题列表。

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

自动检查包括五套主题的文件面板、搜索与新建目录，明亮模式的主要页面与弹窗、可读文字对比度、悬停/焦点/选中、嵌套主题、持久化和跨窗口同步。文字检查对普通平面背景使用 4.5:1、大号文字使用 3:1；禁用、透明整体和渐变/文档内容需结合截图检查。

原生桌面验证还应确认真实通知窗口、壁纸透出效果、日历透明度 0% / 45% / 90% 及独立自定义配色；浏览器截图不能替代原生窗口层级与桌面合成验证。
