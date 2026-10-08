import { expect, test, type Page } from '@playwright/test';

const taskView = (page: Page) => page.locator('main').first().locator(':scope > div').last();
const editor = (page: Page) => page.getByRole('dialog', { name: '编辑任务', exact: true });
const row = (page: Page) => taskView(page).locator('.theme-glow-card').filter({ has: page.getByRole('button', { name: '整理项目资料', exact: true }) });
async function open(page: Page) { await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light'); await row(page).getByTitle('编辑任务', { exact: true }).click(); }

test('comments resolve author names, render Markdown and allow deleting only your own comment', async ({ page }) => {
  await open(page);
  const comments = editor(page).getByRole('region', { name: '任务评论', exact: true });
  await expect(comments.getByText('协作成员', { exact: true })).toBeVisible();
  await expect(comments.getByText('peer@test', { exact: true })).toHaveCount(0);
  await expect(comments.getByRole('button', { name: '删除评论' })).toHaveCount(0);
  await comments.getByLabel('评论内容').fill('已完成 **联调验证**\n\n下一步补充测试。');
  await comments.getByRole('button', { name: '发送评论', exact: true }).click();
  await expect(comments.getByLabel('评论内容')).toHaveValue('');
  await expect(comments.locator('strong')).toHaveText('联调验证');
  await expect(comments.getByText('测试管理员', { exact: true })).toBeVisible();
  await expect(comments.getByText('我', { exact: true })).toBeVisible();
  await comments.getByRole('button', { name: '删除评论', exact: true }).click();
  await expect(comments.locator('strong')).toHaveCount(0);
  await expect(comments.getByText('请核对资料后提交')).toBeVisible();
  await editor(page).getByRole('button', { name: '关闭', exact: true }).click();
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  await expect(editor(page).getByRole('region', { name: '任务评论' }).getByText('请核对资料后提交')).toBeVisible();
});

test('quoted reply can be cancelled, saved, reopened and used to jump to the original comment', async ({ page }) => {
  await open(page);
  let comments = editor(page).getByRole('region', { name: '任务评论' });
  await comments.getByRole('button', { name: '引用回复 协作成员 的评论' }).click();
  await expect(comments.getByLabel('评论内容')).toBeFocused();
  await expect(comments.getByLabel('正在引用的评论')).toContainText('请核对资料后提交');
  await comments.getByLabel('评论内容').fill('已核对 **项目资料**');
  await comments.getByRole('button', { name: '取消引用' }).click();
  await expect(comments.getByLabel('正在引用的评论')).toHaveCount(0);
  await expect(comments.getByLabel('评论内容')).toHaveValue('已核对 **项目资料**');
  await comments.getByRole('button', { name: '引用回复 协作成员 的评论' }).click();
  await page.screenshot({ path: 'tests/theme/screenshots/comment-quote-composer-light.png' });
  await comments.getByRole('button', { name: '发送回复', exact: true }).click();
  await expect(comments.getByLabel('正在引用的评论')).toHaveCount(0);
  await expect(comments.getByLabel('评论内容')).toHaveValue('');
  await expect(comments.locator('strong')).toHaveText('项目资料');
  await comments.getByRole('button', { name: '查看引用的评论：协作成员' }).click();
  await expect(comments.locator('[data-comment-id="comment-one"]')).toBeFocused();
  await editor(page).getByRole('button', { name: '关闭', exact: true }).click();
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  comments = editor(page).getByRole('region', { name: '任务评论' });
  await expect(comments.getByRole('button', { name: '查看引用的评论：协作成员' })).toContainText('请核对资料后提交');
  await comments.locator('.task-comment-item').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/theme/screenshots/comment-quote-saved-light.png' });
});

test('failed reply preserves the draft and quote, and can be sent again', async ({ page }) => {
  await open(page);
  const comments = editor(page).getByRole('region', { name: '任务评论' });
  await comments.getByRole('button', { name: '引用回复 协作成员 的评论' }).click();
  await comments.getByLabel('评论内容').fill('保留失败的回复草稿');
  await page.evaluate(() => { (window as any).__taskFixture.failComment = true; });
  await comments.getByRole('button', { name: '发送回复', exact: true }).click();
  await expect(comments.getByRole('alert')).toHaveText('评论发送失败，请重试');
  await expect(comments.getByLabel('评论内容')).toHaveValue('保留失败的回复草稿');
  await expect(comments.getByLabel('正在引用的评论')).toContainText('请核对资料后提交');
  await expect(comments.getByRole('button', { name: '引用回复 协作成员 的评论' })).toBeVisible();
  await page.evaluate(() => { (window as any).__taskFixture.failComment = false; });
  await comments.getByRole('button', { name: '发送回复', exact: true }).click();
  await expect(comments.getByRole('alert')).toHaveCount(0);
  await expect(comments.getByLabel('评论内容')).toHaveValue('');
  await expect(comments.getByRole('button', { name: '查看引用的评论：协作成员' })).toBeVisible();
});

test('deleting an original comment retains its quote in the reply', async ({ page }) => {
  await open(page);
  const comments = editor(page).getByRole('region', { name: '任务评论' });
  await comments.getByLabel('评论内容').fill('需要确认交付时间');
  await comments.getByRole('button', { name: '发送评论', exact: true }).click();
  const original = comments.locator('.task-comment-item').filter({ hasText: '需要确认交付时间' });
  await original.getByRole('button', { name: '引用回复 测试管理员 的评论' }).click();
  await comments.getByLabel('评论内容').fill('时间已确认');
  await comments.getByRole('button', { name: '发送回复', exact: true }).click();
  await comments.locator('.task-comment-item').filter({ has: page.locator('.task-markdown').filter({ hasText: '需要确认交付时间' }) }).getByRole('button', { name: '删除评论' }).click();
  const quote = comments.getByRole('blockquote', { name: '引用的评论' });
  await expect(quote).toContainText('需要确认交付时间');
  await expect(quote).toContainText('原评论不可用，已保留引用内容');
  await expect(comments.getByText('时间已确认', { exact: true })).toBeVisible();
});

test('Markdown and checklist edit in both directions while retaining prose', async ({ page }) => {
  await open(page);
  await editor(page).getByRole('button', { name: '检查事项', exact: true }).click();
  await editor(page).locator('label').filter({ has: page.getByRole('checkbox', { name: '切换检查事项：核对资料' }) }).click();
  await editor(page).getByRole('textbox', { name: '检查事项：核对资料', exact: true }).fill('核对新资料');
  await editor(page).getByRole('button', { name: 'Markdown', exact: true }).click();
  const markdown = editor(page).getByRole('textbox', { name: '任务 Markdown 内容' });
  await expect(markdown).toHaveValue('保留任务正文\n\n- [x] 核对新资料\n- [x] 提交报告');
  await markdown.fill('保留任务正文\n\n- [ ] 新检查事项');
  await editor(page).getByRole('button', { name: '检查事项', exact: true }).click();
  await expect(editor(page).getByRole('textbox', { name: '检查事项：新检查事项', exact: true })).toBeVisible();
  await expect(editor(page).getByRole('checkbox', { name: '切换检查事项：新检查事项' })).not.toBeChecked();
  await expect(editor(page).getByRole('textbox', { name: '检查事项：提交报告', exact: true })).toHaveCount(0);
});

test('activity is independent and task deletion is last in More', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light');
  await row(page).getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(row(page).getByRole('button').last()).toHaveText('删除任务');
  await row(page).getByRole('button', { name: '查看任务动态' }).click();
  await expect(page.getByRole('dialog', { name: '任务动态', exact: true })).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByText('协作成员 · 更新任务')).toBeVisible();
});

test('list accordion shows separate checks and children; checking updates Markdown', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light');
  await row(page).getByRole('button', { name: '展开子任务', exact: true }).click();
  const checks = row(page).getByLabel('检查事项：整理项目资料');
  await expect(checks.getByText('检查事项 (1/2)', { exact: true })).toBeVisible();
  await expect(checks.getByText('核对资料', { exact: true })).toBeVisible();
  await checks.locator('label').filter({ has: page.getByRole('checkbox', { name: '标记完成检查事项：核对资料' }) }).click();
  await expect(checks.getByRole('checkbox', { name: '标记完成检查事项：核对资料' })).toBeChecked();
  await expect(checks.getByText('检查事项 (2/2)', { exact: true })).toBeVisible();
  await expect(row(page).getByLabel('子任务：整理项目资料').getByRole('button', { name: '独立子任务' })).toBeVisible();
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  await expect(editor(page).getByRole('textbox', { name: '任务 Markdown 内容' })).toHaveValue('保留任务正文\n\n- [x] 核对资料\n- [x] 提交报告');
  await editor(page).getByRole('button', { name: '关闭', exact: true }).click();
  const onlyChecks = taskView(page).locator('.theme-glow-card').filter({ has: page.getByRole('button', { name: '检查明亮主题', exact: true }) });
  await onlyChecks.getByRole('button', { name: '展开检查事项', exact: true }).click();
  await expect(onlyChecks.getByLabel('检查事项：检查明亮主题').getByText('旧版检查事项', { exact: true })).toBeVisible();
  await expect(onlyChecks.getByLabel('子任务：检查明亮主题')).toHaveCount(0);
  await onlyChecks.getByRole('button', { name: '收起检查事项', exact: true }).click();
  await expect(onlyChecks.getByLabel('检查事项：检查明亮主题')).toHaveCount(0);
});

test('selected tags stay above available tags; Enter creates without saving and cancellation discards drafts', async ({ page }) => {
  await open(page);
  const tags = editor(page).getByLabel('任务标签', { exact: true });
  const selected = tags.getByLabel('已选标签', { exact: true });
  const available = tags.getByLabel('可选标签', { exact: true });
  await expect(selected.getByText('#验收', { exact: true })).toBeVisible();
  await expect(available.getByRole('button', { name: '选择标签：开发', exact: true })).toBeVisible();
  expect((await available.boundingBox())!.y).toBeGreaterThan((await selected.boundingBox())!.y);
  await available.getByRole('button', { name: '选择标签：开发', exact: true }).click();
  await expect(selected.getByText('#开发', { exact: true })).toBeVisible();
  await expect(available.getByRole('button', { name: '选择标签：开发', exact: true })).toHaveCount(0);
  await selected.getByRole('button', { name: '移除标签：开发' }).click();
  await expect(available.getByRole('button', { name: '选择标签：开发', exact: true })).toBeVisible();
  const plus = tags.getByRole('button', { name: '创建标签', exact: true });
  await plus.click();
  const input = tags.getByRole('textbox', { name: '新标签名称' });
  await expect(input).toBeFocused();
  await input.fill('  新标签  '); await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(selected.getByText('#新标签', { exact: true })).toBeVisible();
  await expect(editor(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__taskFixture.saves)).toBe(0);
  await plus.click(); await input.fill('新标签'); await input.press('Enter');
  await expect(selected.getByText('#新标签', { exact: true })).toHaveCount(1);
  await plus.click(); await input.fill('取消的标签');
  await tags.getByRole('button', { name: '取消创建标签' }).click();
  await expect(selected.getByText('#取消的标签')).toHaveCount(0);
  await plus.click(); await expect(input).toHaveValue(''); await input.fill('空白取消');
  await editor(page).getByRole('heading', { name: '编辑局域网任务' }).click();
  await expect(input).toHaveCount(0);
  await plus.click(); await input.fill('Escape取消'); await input.press('Escape');
  await expect(input).toHaveCount(0); await expect(editor(page)).toBeVisible();
  await editor(page).getByRole('button', { name: '保存任务', exact: true }).click();
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  await expect(editor(page).getByLabel('已选标签').getByText('#新标签', { exact: true })).toBeVisible();
});

test('creating a copy clones child tasks and keeps original completion untouched', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light');
  await row(page).getByRole('button', { name: '更多操作', exact: true }).click();
  await row(page).getByRole('button', { name: '创建副本', exact: true }).click();
  const duplicate = taskView(page).locator('.theme-glow-card').filter({ has: page.getByRole('button', { name: '整理项目资料（副本）', exact: true }) });
  await expect(duplicate).toBeVisible();
  await duplicate.getByRole('button', { name: '展开子任务', exact: true }).click();
  await expect(duplicate.getByLabel('子任务：整理项目资料（副本）').getByRole('button', { name: '独立子任务', exact: true })).toBeVisible();
  await expect(duplicate.getByRole('checkbox', { name: '标记完成子任务：独立子任务' })).not.toBeChecked();
  await expect(duplicate.getByRole('checkbox', { name: '标记完成检查事项：提交报告' })).not.toBeChecked();
  const result = await page.evaluate(() => {
    const tasks = (window as any).__taskFixture.tasks;
    const parent = tasks.find((item: any) => item.title === '整理项目资料（副本）');
    return { parent, child: tasks.find((item: any) => item.parentTaskId === parent.id), originalChild: tasks.find((item: any) => item.id === 'child-one'), original: tasks.find((item: any) => item.id === 'task-0') };
  });
  expect(result.child.id).not.toBe(result.originalChild.id);
  expect(result.child.parentTaskId).toBe(result.parent.id);
  expect(result.child.tags).toEqual(['子任务标签']);
  expect(result.child.progress).toBe(0);
  expect(result.originalChild.status).toBe('completed');
  expect(result.original.subtasks[1].completed).toBe(true);
});

test('real children expand, can be edited, and new parents can create children', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light');
  await row(page).getByRole('button', { name: '展开子任务', exact: true }).click();
  const children = row(page).getByLabel('子任务：整理项目资料');
  await expect(children.getByRole('button', { name: '独立子任务', exact: true })).toBeVisible();
  await expect(children.getByText('核对资料', { exact: true })).toHaveCount(0);
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  await editor(page).getByRole('textbox', { name: '子任务 1 名称', exact: true }).fill('已编辑的子任务');
  await editor(page).getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(children.getByRole('button', { name: '已编辑的子任务' })).toBeVisible();
  await taskView(page).getByRole('button', { name: '新建任务', exact: true }).click();
  const create = page.getByRole('dialog', { name: '创建任务' });
  await expect(create.locator('.task-child-editor input')).toHaveCount(0);
  await create.getByPlaceholder('请输入任务标题...').fill('新主任务');
  await create.getByRole('button', { name: '添加子任务', exact: true }).click();
  await create.getByRole('textbox', { name: '子任务 1 名称' }).fill('新独立子任务');
  await create.getByRole('button', { name: '保存任务' }).click();
  await expect(create).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskFixture.tasks.find((task: any) => task.title === '新独立子任务').parentTaskId)).toBeTruthy();
});

test('images insert, render, persist, and comments follow attachments', async ({ page }) => {
  await open(page);
  await editor(page).getByLabel('添加任务附件').setInputFiles({ name: '资料.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG2kAAAAASUVORK5CYII=', 'base64') });
  await editor(page).getByRole('button', { name: '插入附件图片' }).click();
  await editor(page).getByRole('button', { name: '资料.png', exact: true }).click();
  await editor(page).getByRole('tab', { name: '预览', exact: true }).click();
  const image = editor(page).locator('article img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  const attachmentY = await editor(page).getByLabel('任务附件', { exact: true }).evaluate((node) => node.getBoundingClientRect().top);
  const commentsY = await editor(page).getByText('评论', { exact: true }).first().evaluate((node) => node.getBoundingClientRect().top);
  expect(commentsY).toBeGreaterThan(attachmentY);
  await editor(page).getByRole('button', { name: '保存任务', exact: true }).click();
  await row(page).getByTitle('编辑任务', { exact: true }).click();
  await editor(page).getByRole('tab', { name: '预览', exact: true }).click();
  await expect(editor(page).locator('article img')).toBeVisible();
});

test('save failure keeps the editor and task changes', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__taskFixture.failSave = true; });
  await editor(page).getByPlaceholder('请输入任务标题...').fill('保存失败后保留');
  await editor(page).getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(editor(page).getByText('测试保存失败')).toBeVisible();
  await expect(editor(page).getByPlaceholder('请输入任务标题...')).toHaveValue('保存失败后保留');
});

test('task references copy HTML and paste into Markdown as a named task link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/tests/theme/index.html?view=task-detail&theme=titanium-light');
  await row(page).getByRole('button', { name: '更多操作' }).click();
  await row(page).getByRole('button', { name: '复制任务链接' }).click();
  const clipboard = await page.evaluate(async () => { const items = await navigator.clipboard.read(); return { text: await (await items[0].getType('text/plain')).text(), html: await (await items[0].getType('text/html')).text() }; });
  expect(clipboard.html).toContain('data-lanmind-task');
  expect(clipboard.html).toContain('整理项目资料');
  await taskView(page).getByRole('button', { name: '检查明亮主题', exact: true }).click();
  await editor(page).getByRole('textbox', { name: '任务 Markdown 内容' }).fill(clipboard.text);
  await editor(page).getByRole('tab', { name: '预览' }).click();
  const reference = editor(page).locator('a.task-reference');
  await expect(reference).toHaveText('整理项目资料');
  await reference.click();
  const info = page.getByRole('dialog', { name: '任务信息' });
  await expect(info).toBeVisible();
  await expect(info.getByRole('heading', { name: '整理项目资料' })).toBeVisible();
});

for (const width of [1440, 390]) test(`task properties and portal dropdown fit at ${width}px`, async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await editor(page).getByRole('button', { name: '选择任务状态', exact: true }).click();
  const listbox = page.getByRole('listbox', { name: '选择任务状态', exact: true });
  await expect(listbox).toBeVisible();
  expect(await listbox.evaluate((node) => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
  await listbox.getByRole('option', { name: '进行中', exact: true }).click();
  expect(await editor(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: `tests/theme/screenshots/task-detail-${width}.png` });
});
