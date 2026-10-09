# 多语言维护

当前支持 `zh-CN`、`en-US` 和 `system`（跟随系统）。无法匹配系统语言时使用中文。设置中的切换立即生效，重启后保留；桌面窗口共用本机数据库设置，浏览器和离线接收端按各自来源独立保存。

## 目录

```text
i18n/
  locales/
    zh-CN/
      meta.json
      common.json
      settings.json
      tasks.json
      projects.json
      chat.json
      calendar.json
      reports.json
      network.json
      optical.json
      native.json
      errors.json
    en-US/                  # 与中文保持相同模块、键和插值参数
  registry.ts               # 语言注册、系统语言匹配
  core.ts                   # 翻译实例、文档语言与标题
  preferences.ts            # 本机保存、跨窗口通知、浏览器同步
  formatters.ts             # 日期、时间和数字显示
  messages.ts               # 系统提示与旧版错误兼容
  error-patterns.json       # 旧错误文案到稳定 code / params 的映射
  server.ts                 # 浏览器原型按请求隔离语言
  resources.ts              # 自动生成，不手动编辑
```

Rust 的构建脚本将同一套 JSON 嵌入应用，供托盘、窗口标题、错误和报告回退内容使用，无需运行时下载语言包。

## 新增语言

1. 复制 `locales/zh-CN` 为新的 BCP 47 目录，如 `ja-JP`。
2. 修改 `meta.json` 中的 `code`、`nativeName`、`aliases` 和 `direction`。语言选项及前后端匹配规则由元数据生成。
3. 翻译所有模块。保留键名、插值名、Markdown/HTML 结构；保留产品名和协议名。
4. 运行 `npm run check:i18n`、`npm run test:i18n` 和 `npm run lint`，再重新构建桌面包与离线接收端。
5. 在浅色、深色、小窗口中检查新语言，尤其是表单、确认按钮、下拉菜单、日历和通知。

## 开发约定

- 使用语义键，如 `tr('settings:language.label')`。模块中可用嵌套对象或带点的键名。
- 整句翻译，避免拼接不同语言的词序。JS 插值用 `{{name}}`；Rust 报告格式字符串保留 `{name}`，由对应格式化函数处理。
- React 图标和元素放在翻译调用外。不要把 JSX 对象作为字符串插值。
- 组件使用 `useLocale()` 订阅语言；缓存的标签和日期要把语言加入依赖。静态选项使用函数或 getter，避免在模块加载时保存译文。
- `localizeMessage` 只用于系统状态、错误与提示。不得用于任务标题、正文、项目名、成员名、聊天内容或自定义模板。
- 日期和数字按当前语言显示，存储格式保持 ISO。生成报告和 PPT 时显式传入当前语言，已生成内容保持原文。
- 文案简洁，按钮用动词，描述说明行为与必要限制。删除冗余中英并列及无法证实的能力宣传，保留删除范围、密码和权限说明。
- 布局允许换行，保留图标尺寸，使用 `min-width: 0`、弹性宽度和必要的滚动区。下拉菜单按内容实际高度定位；通知和速记窗口受显示器工作区限制。

## 验证

```bash
npm run check:i18n
npm run test:i18n
npx playwright test tests/theme/i18n.spec.ts
```

目录与插值校验已加入生产构建。接收端将两套语言资源一并打入离线缓存。
