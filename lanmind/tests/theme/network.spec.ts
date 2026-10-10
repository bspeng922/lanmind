import { expect, test, type Page } from '@playwright/test';
import type { TaskComment } from '../../src/types';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lanmind-locale-preference', 'zh-CN'));
});

test('network login can reveal the password and retry after a rejected password', async ({ page }) => {
  let authenticated = false;
  const user = { id: 'user', nickname: '本机用户', username: 'user', deviceId: 'test', role: 'user', ip: '127.0.0.1', isOnline: true, lastActive: '2026-09-30' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') {
      authenticated = route.request().postDataJSON().password === 'correct-password';
      await route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { authenticated: true } : { error: '访问密码不正确' } });
    } else if (!authenticated) await route.fulfill({ status: 401, json: { error: '请先登录' } });
    else if (path === '/api/bootstrap') await route.fulfill({ json: { currentUser: user, users: [user], projects: [], readOnly: true } });
    else await route.fulfill({ json: [] });
  });
  await page.goto('/network.html');
  const input = page.getByLabel('访问密码', { exact: true });
  await input.fill('incorrect-password');
  await page.getByRole('button', { name: '显示访问密码' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏访问密码' }).click();
  await expect(input).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('访问密码不正确');
  await expect(input).toHaveValue('incorrect-password');
  await input.fill('correct-password');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('network settings use shared dropdowns, generate 16 characters, and save automatically', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=network-settings&theme=titanium-light');
  await expect(page.getByRole('heading', { name: '网页访问', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存并应用', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '随机生成 16 位密码', exact: true }).click();
  const password = await page.getByRole('textbox', { name: '网页访问密码' }).inputValue();
  expect(password).toHaveLength(16);
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(1);
  await page.getByRole('switch', { name: '启用网页访问' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.status.running)).toBe(true);
  await page.getByRole('button', { name: '网页访问模式' }).click();
  await page.getByRole('listbox', { name: '网页访问模式' }).getByRole('option', { name: '可编辑', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.status.readOnly)).toBe(false);
  await page.getByRole('button', { name: '网页访问监听范围' }).click();
  await page.getByRole('listbox', { name: '网页访问监听范围' }).getByRole('option', { name: '仅本机', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.status.bindAddress)).toBe('127.0.0.1');
  await page.screenshot({ path: 'tests/theme/screenshots/network-settings.png' });
});

async function mockNetwork(page: Page, readOnly: boolean, options: { dense?: boolean; child?: boolean; comments?: boolean } = {}) {
  const user = { id: 'user', nickname: '本机用户', username: 'user', deviceId: 'test', role: 'user', ip: '127.0.0.1', isOnline: true, lastActive: '2026-09-30' };
  const project = { id: 'project', name: '网络协作项目', description: '', color: '#2563eb', createdBy: 'user', admins: ['user'], members: ['user'], createdAt: '2026-09-30', updatedAt: '2026-09-30' };
  const tasks: any[] = [{ id: 'task', title: '网络中的任务', description: '任务说明\n\n- [ ] 核对资料', priority: 'P3', status: 'todo', dueDate: '2026-09-30', assigneeId: 'user', creatorId: 'user', projectId: 'project', isShared: true, sharedWith: [], subtasks: [{ id: 'check', title: '核对资料', completed: false }], tags: [], createdAt: '2026-09-30', updatedAt: '2026-09-30', version: 1 }];
  if (options.dense) tasks.push(...Array.from({ length: 18 }, (_, index) => ({ ...tasks[0], id: `dense-${index}`, title: `网络日历任务 ${index + 1}` })));
  if (options.child) tasks.push({ ...tasks[0], id: 'child', title: '网络独立子任务', parentTaskId: 'task', status: 'completed', progress: 100, tags: ['子任务标签'] });
  let nextId = 0;
  let authenticated = false;
  const comments: TaskComment[] = options.comments ? [
    { id: 'original', taskId: 'task', authorId: 'user', content: '请确认网络测试结果', createdAt: '2026-09-30', updatedAt: '2026-09-30' },
    { id: 'reply', taskId: 'task', authorId: 'user', content: '已完成验证', replyTo: { commentId: 'original', authorId: 'user', content: '请确认网络测试结果' }, createdAt: '2026-09-30', updatedAt: '2026-09-30' },
  ] : [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') { authenticated = true; await route.fulfill({ json: { authenticated: true } }); return; }
    if (!authenticated) { await route.fulfill({ status: 401, json: { error: '请先登录' } }); return; }
    if (path === '/api/bootstrap') await route.fulfill({ json: { currentUser: user, users: [user], projects: [project], readOnly } });
    else if (path === '/api/tasks' && route.request().method() === 'GET') await route.fulfill({ json: tasks });
    else if (path === '/api/tasks/save-with-children') {
      const payload = route.request().postDataJSON();
      let parent = tasks.find((task) => task.id === payload.id);
      if (parent) Object.assign(parent, payload.task);
      else { parent = { ...tasks[0], ...payload.task, id: `new-task-${++nextId}` }; tasks.push(parent); }
      for (const child of payload.childTasks || []) {
        if (child.id) Object.assign(tasks.find((task) => task.id === child.id), child);
        else tasks.push({ ...parent, ...child, id: `new-child-${++nextId}`, parentTaskId: parent.id });
      }
      await route.fulfill({ json: parent });
    } else if (path.startsWith('/api/tasks/') && route.request().method() === 'PUT') {
      const task = tasks.find((item) => item.id === path.split('/').at(-1));
      Object.assign(task, route.request().postDataJSON()); await route.fulfill({ json: task });
    } else if (path.endsWith('/activity')) await route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, snapshot: 0 } });
    else if (path.endsWith('/comments')) {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        const original = comments.find((item) => item.id === payload.replyToCommentId);
        const comment: TaskComment = { id: `comment-${++nextId}`, taskId: 'task', authorId: 'user', content: payload.content, createdAt: '2026-09-30', updatedAt: '2026-09-30', replyTo: original ? { commentId: original.id, authorId: original.authorId, content: original.content } : undefined };
        comments.push(comment);
        await route.fulfill({ json: comment });
      } else await route.fulfill({ json: comments });
    }
    else await route.fulfill({ json: {} });
  });
  await page.goto('/network.html');
  await page.getByLabel('访问密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '网络中的任务', exact: true })).toBeVisible();
  return tasks;
}

test('editable network comments send the quoted ID through HTTP and keep the saved quote on reopen', async ({ page }) => {
  await mockNetwork(page, false, { comments: true });
  await page.locator('main .theme-glow-card').getByTitle('编辑任务', { exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  const comments = editor.getByRole('region', { name: '任务评论' });
  await comments.locator('[data-comment-id="original"]').getByRole('button', { name: '引用回复 本机用户 的评论' }).click();
  await comments.getByLabel('评论内容').fill('网络回复 **已确认**');
  const sending = page.waitForRequest((request) => request.url().endsWith('/api/tasks/task/comments') && request.method() === 'POST');
  await comments.getByRole('button', { name: '发送回复', exact: true }).click();
  expect((await sending).postDataJSON()).toEqual({ content: '网络回复 **已确认**', replyToCommentId: 'original' });
  await expect(comments.locator('strong')).toHaveText('已确认');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('main .theme-glow-card').getByTitle('编辑任务', { exact: true }).click();
  await expect(comments.getByRole('button', { name: '查看引用的评论：本机用户' })).toHaveCount(2);
});

for (const readOnly of [true, false]) test(`network ${readOnly ? 'read-only' : 'editable'} project shares multi-select across its views`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00'));
  await mockNetwork(page, readOnly);
  await page.getByRole('button', { name: '网络协作项目', exact: true }).click();
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '项目排序和过滤', exact: true });
  await panel.getByRole('button', { name: '项目优先级', exact: true }).click();
  const menu = page.getByRole('listbox', { name: '项目优先级', exact: true });
  await menu.getByRole('option', { name: 'P2 重要', exact: true }).click();
  await menu.getByRole('option', { name: 'P3 普通', exact: true }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.project-toolbar h2').click();
  for (const name of ['看板', '日历', '时间线', '列表']) {
    await page.getByRole('button', { name: '项目布局', exact: true }).click();
    await page.getByRole('dialog', { name: '项目布局设置', exact: true }).getByRole('button', { name, exact: true }).click();
    await page.locator('.project-toolbar h2').click();
    await expect(page.locator('main').getByText('网络中的任务', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '排序和过滤', exact: true })).toHaveCount(0);
    if (readOnly) await expect(page.locator('main').getByRole('button', { name: /新建任务/ })).toHaveCount(0);
  }
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(panel.getByRole('button', { name: '项目优先级', exact: true })).toContainText('P3');
  await expect(panel.getByRole('button', { name: '项目负责人', exact: true })).toBeEnabled();
});

test('read-only network shows quoted comments and allows jumping without reply or delete controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNetwork(page, true, { comments: true });
  await page.getByRole('button', { name: '网络中的任务', exact: true }).click();
  const info = page.getByRole('dialog', { name: '任务信息' });
  const comments = info.getByRole('region', { name: '任务评论' });
  await comments.getByRole('button', { name: '查看引用的评论：本机用户' }).click();
  await expect(comments.locator('[data-comment-id="original"]')).toBeFocused();
  await expect(comments.getByRole('button', { name: /引用回复|删除评论/ })).toHaveCount(0);
  await expect(comments.getByLabel('评论内容')).toHaveCount(0);
  expect(await info.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: 'tests/theme/screenshots/network-comment-quote-mobile.png' });
});

test('network password actions are view, copy, random; hidden saved passwords copy without changing settings', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/tests/theme/index.html?view=network-settings&theme=titanium-light');
  const input = page.getByLabel('网页访问密码', { exact: true });
  const controls = input.locator('..').getByRole('button');
  await expect(controls).toHaveCount(3);
  await expect(controls.nth(0)).toHaveAttribute('aria-label', '显示密码');
  await expect(controls.nth(1)).toHaveAttribute('aria-label', '复制访问密码');
  await expect(controls.nth(2)).toHaveAttribute('aria-label', '随机生成 16 位密码');
  await expect(controls.nth(1)).toBeDisabled();
  await controls.nth(2).click();
  const password = await input.inputValue();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(1);
  await page.reload();
  await expect(input).toBeEmpty();
  await page.getByRole('button', { name: '复制访问密码', exact: true }).click();
  await expect(page.getByText('访问密码已复制', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
  await expect(input).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(0);
  await input.fill('updated-password');
  await page.getByRole('button', { name: '复制访问密码', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('updated-password');
});

test('copy failures and legacy hashes never show a false clipboard success', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=network-settings&legacy=1');
  await page.getByRole('button', { name: '复制访问密码', exact: true }).click();
  await expect(page.getByText('旧版密码只保存了校验值，无法显示。重新设置一次密码后即可查看。', { exact: true })).toBeVisible();
  await expect(page.getByText('访问密码已复制', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '随机生成 16 位密码', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('clipboard denied'); } }); });
  await page.getByRole('button', { name: '复制访问密码', exact: true }).click();
  await expect(page.getByText('复制访问密码失败，请重试或点击查看后手动复制。', { exact: true })).toBeVisible();
  await expect(page.getByText('访问密码已复制', { exact: true })).toHaveCount(0);
});

for (const readOnly of [true, false]) {
  test(`network calendar overflow is accessible in ${readOnly ? 'read-only' : 'editable'} mode and after zoom`, async ({ page }, info) => {
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    await page.setViewportSize({ width: 1080, height: 700 });
    await mockNetwork(page, readOnly, { dense: true });
    await page.getByRole('button', { name: '网络协作项目', exact: true }).click();
    await page.getByRole('button', { name: '项目布局', exact: true }).click();
    await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name: '日历', exact: true }).click();
    await page.locator('.project-toolbar h2').click();
    const day = page.locator('[data-calendar-date="2026-09-30"]');
    const more = day.getByRole('button', { name: '查看 2026-09-30 的全部 19 项任务', exact: true });
    for (const zoom of [1, 1.5]) {
      await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
      await more.scrollIntoViewIfNeeded();
      await expect(more).toBeVisible();
      await expect.poll(() => day.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return [...node.querySelectorAll('.calendar-task, .calendar-more')].every((child) => {
          const rect = child.getBoundingClientRect();
          return rect.bottom <= bounds.bottom + 1 && rect.top >= bounds.top && rect.right <= bounds.right + 1;
        });
      })).toBe(true);
      await more.click();
      const dialog = page.getByRole('dialog', { name: '2026-09-30 的任务', exact: true });
      await expect(dialog.getByText('共 19 项', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(readOnly ? 0 : 1);
      await dialog.getByTitle('关闭当天任务', { exact: true }).click();
    }
    await page.screenshot({ path: info.outputPath('network-calendar-overflow.png') });
  });
}

test('read-only checklist expands without edits; editable checklist saves Markdown', async ({ page }) => {
  await mockNetwork(page, true);
  let card = page.locator('main .theme-glow-card');
  await card.getByRole('button', { name: '展开检查事项', exact: true }).click();
  await expect(card.getByRole('checkbox', { name: '标记完成检查事项：核对资料' })).toBeDisabled();
  const tasks = await mockNetwork(page, false);
  card = page.locator('main .theme-glow-card');
  await card.getByRole('button', { name: '展开检查事项', exact: true }).click();
  await card.locator('label').filter({ has: page.getByRole('checkbox', { name: '标记完成检查事项：核对资料' }) }).click();
  await expect(card.getByRole('checkbox', { name: '标记完成检查事项：核对资料' })).toBeChecked();
  expect(tasks[0].description).toBe('任务说明\n\n- [x] 核对资料');
});

test('network duplicate includes fresh child tasks and works on LAN HTTP without randomUUID', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }); });
  await mockNetwork(page, false, { child: true });
  const card = page.locator('main .theme-glow-card');
  await card.getByRole('button', { name: '更多操作', exact: true }).click();
  const saving = page.waitForRequest('**/api/tasks/save-with-children');
  await card.getByRole('menuitem', { name: '创建副本', exact: true }).click();
  const payload = (await saving).postDataJSON();
  expect(payload.id).toBeNull();
  expect(payload.childTasks).toHaveLength(1);
  expect(payload.childTasks[0].id).toBeUndefined();
  expect(payload.childTasks[0].title).toBe('网络独立子任务');
  expect(payload.childTasks[0].status).toBe('todo');
  expect(payload.childTasks[0].subtasks[0].id).not.toBe('check');
  const copy = page.locator('main .theme-glow-card').filter({ has: page.getByRole('button', { name: '网络中的任务（副本）', exact: true }) });
  await copy.getByRole('button', { name: '展开子任务', exact: true }).click();
  await expect(copy.getByRole('button', { name: '网络独立子任务', exact: true })).toBeVisible();
});

test('read-only network offers task details and filters without editing controls or system settings', async ({ page }) => {
  await mockNetwork(page, true);
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0);
  await expect(page.getByTitle('编辑任务', { exact: true })).toHaveCount(0);
  await expect(page.getByText('系统设置', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '网络中的任务', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务信息' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '任务信息' }).getByRole('button', { name: '编辑任务' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭任务信息' }).click();
  await page.getByRole('button', { name: '排序和过滤' }).click();
  await expect(page.getByRole('dialog', { name: '任务排序和过滤' })).toBeVisible();
  await page.screenshot({ path: 'tests/theme/screenshots/network-read-only.png' });
});

test('network timeline shares the compact periods and opens read-only task information', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00'));
  await mockNetwork(page, true);
  await page.getByRole('button', { name: '网络协作项目', exact: true }).click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name: '时间线', exact: true }).click();
  await page.keyboard.press('Escape');
  const timeline = page.locator('.timeline-view');
  await expect(timeline).toContainText('2026-09-29 至 2026-10-05');
  await timeline.getByRole('button', { name: '14 天', exact: true }).click();
  await expect(timeline).toContainText('2026-09-28 至 2026-10-11');
  await timeline.getByRole('button', { name: '查看任务：网络中的任务', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务信息', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toHaveCount(0);
});

test('editable network saves through the shared task editor', async ({ page }) => {
  await mockNetwork(page, false);
  await page.getByRole('button', { name: '网络中的任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await editor.getByPlaceholder('请输入任务标题...').fill('网络编辑已保存');
  await editor.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: '网络编辑已保存', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tests/theme/screenshots/network-editable.png' });
});

test('network project separates layout and filtering and loads task activity by page', async ({ page }) => {
  await mockNetwork(page, true);
  await page.getByRole('button', { name: '网络协作项目', exact: true }).click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  const layout = page.getByRole('dialog', { name: '项目布局设置', exact: true });
  await expect(layout.getByRole('group', { name: '项目视图' })).toBeVisible();
  await expect(layout.getByRole('switch')).toHaveCount(0);
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(layout).toHaveCount(0);
  const filters = page.getByRole('dialog', { name: '项目排序和过滤', exact: true });
  await expect(filters.getByRole('group', { name: '项目视图' })).toHaveCount(0);
  await filters.getByRole('button', { name: '项目优先级', exact: true }).click();
  await page.getByRole('option', { name: 'P1 紧急', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '网络中的任务', exact: true })).toHaveCount(0);
  await filters.getByRole('button', { name: '全部重置' }).click();
  await page.keyboard.press('Escape');
  const requests: URLSearchParams[] = [];
  await page.route('**/api/tasks/task/activity?**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    const pageNumber = Number(query.get('page'));
    await route.fulfill({ json: { items: [{ id: `event-${pageNumber}`, taskId: 'task', actorId: 'user', action: 'update', timestamp: '2026-09-30T12:00:00Z', payload: { taskId: 'task', content: `网络动态 ${pageNumber}` } }], total: 21, page: pageNumber, pageSize: 20, snapshot: 21 } });
  });
  await page.locator('main .theme-glow-card').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '查看任务动态', exact: true }).click();
  const activity = page.getByRole('dialog', { name: '任务动态', exact: true });
  await expect(activity.getByText('网络动态 1', { exact: true })).toBeVisible();
  await activity.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(activity.getByText('网络动态 2', { exact: true })).toBeVisible();
  expect(requests.map((query) => [query.get('page'), query.get('pageSize'), query.get('snapshot')])).toEqual([['1', '20', null], ['2', '20', '21']]);
});

test('network task page fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNetwork(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '网络中的任务', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务信息' })).toBeVisible();
  await page.screenshot({ path: 'tests/theme/screenshots/network-mobile.png' });
});

test('network editing supports LAN browsers without randomUUID', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }); });
  await mockNetwork(page, false);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const create = page.getByRole('dialog', { name: '创建任务' });
  await create.getByPlaceholder('请输入任务标题...').fill('局域网新任务');
  await create.getByRole('textbox', { name: '任务 Markdown 内容' }).fill('- [ ] 局域网检查');
  await create.getByRole('button', { name: '添加子任务', exact: true }).click();
  await create.getByRole('textbox', { name: '子任务 1 名称' }).fill('局域网子任务');
  const saving = page.waitForRequest('**/api/tasks/save-with-children');
  await create.getByRole('button', { name: '保存任务', exact: true }).click();
  const payload = (await saving).postDataJSON();
  expect(payload.childTasks[0].draftId).toBeTruthy();
  expect(payload.task.subtasks[0].title).toBe('局域网检查');
  await expect(create).toHaveCount(0);
});
