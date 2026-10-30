import { expect, test, type Page } from '@playwright/test';

// Exercise the production notification entry point with simulated desktop IPC.
// No real application data, native windows, or system notifications are used.
async function openNotificationWindow(page: Page, autoDismiss = true, sender = false, featureReadFailures = 0) {
  await page.setViewportSize({ width: 420, height: 260 });
  await page.addInitScript(({ autoDismiss, sender, featureReadFailures }) => {
    (window as any).isTauri = true;
    localStorage.setItem('lanmind-locale-preference', 'zh-CN');
    localStorage.setItem('lanmind-theme', 'dark');
    localStorage.setItem('lanmind_notification_auto_dismiss', String(autoDismiss));
    localStorage.setItem('lanmind_notification_duration_seconds', '3');
    localStorage.setItem('lanmind_notification_sound_enabled', 'false');
    const callbacks = new Map<number, (value: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let nextId = 0;
    const controls = {
      commands: [] as string[],
      sent: [] as any[],
      pending: [] as any[],
      visible: false,
      featureReadFailures,
      hasSnoozeListener: () => Array.from(listeners.values()).some((listener) => listener.event === 'notification://snooze'),
      emit(event: string, payload: unknown) {
        for (const [id, listener] of listeners) {
          if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
        }
      },
      notify(id: string) {
        controls.emit('notification://show', {
          id, kind: 'reminder', title: '任务提醒', body: `${id}\n到期时间：今天 18:00`,
          createdAt: new Date().toISOString(), workspaceId: 'notification-workspace', workspaceRevision: 1,
        });
      },
    };
    (window as any).__notificationFixture = controls;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => listeners.delete(id),
    };
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: sender ? 'main' : 'notification' }, currentWebview: { label: sender ? 'main' : 'notification' } },
      transformCallback(callback: (value: unknown) => void) { callbacks.set(++nextId, callback); return nextId; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: any) {
        controls.commands.push(command);
        if (command === 'plugin:event|listen') {
          listeners.set(++nextId, { event: args.event, handler: args.handler });
          return nextId;
        }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'plugin:event|emit') { controls.emit(args.event, args.payload); return; }
        if (command === 'get_locale_settings') return { preference: 'zh-CN', locale: 'zh-CN' };
        if (command === 'get_feature_modules') {
          if (controls.featureReadFailures-- > 0) throw new Error('Application state is not ready');
          return { chat: true, ai: true, wiki: true, optical: true, vault: true };
        }
        if (command === 'get_workspace_context') return { workspaceId: 'notification-workspace', userId: 'user', revision: 1 };
        if (command === 'get_bootstrap') return { currentUser: { id: 'user', username: 'test-user', nickname: 'Test User', deviceId: 'test-device', role: 'admin', isOnline: true }, workspaceId: 'notification-workspace' };
        if (command === 'get_workspace') return { id: 'notification-workspace', name: '测试工作区' };
        if (command === 'get_chat_unread_summaries' || command === 'get_task_assignment_notifications') return [];
        if (command === 'get_local_directory') return { units: [], members: [] };
        if (command === 'show_notification_window') { controls.sent.push(args.notification); return; }
        if (command === 'get_app_lock_status' || command === 'record_app_activity') {
          return { revision: 1, enabled: false, locked: false, passwordConfigured: false, idleMinutes: 10 };
        }
        if (command === 'get_pending_notifications') return controls.pending.splice(0);
        if (command === 'reveal_notification_window') { controls.visible = true; return; }
        if (command === 'plugin:window|hide') { controls.visible = false; return; }
      },
    };
  }, { autoDismiss, sender, featureReadFailures });
  await page.goto(sender ? '/tests/theme/index.html?view=notification-sender' : '/notification.html');
  await expect.poll(() => page.evaluate((sender) => sender
    ? (window as any).__notificationFixture.hasSnoozeListener()
    : (window as any).__notificationFixture.commands.includes('notification_window_ready'), sender)).toBe(true);
}

async function notify(page: Page, id: string) {
  await page.evaluate((id) => (window as any).__notificationFixture.notify(id), id);
}

async function hideCount(page: Page) {
  return page.evaluate(() => (window as any).__notificationFixture.commands.filter((command: string) => command === 'plugin:window|hide').length);
}

test('notification startup recovers when desktop state is temporarily unavailable', async ({ page }) => {
  // This is the first navigation and includes Vite's cold module compilation.
  test.setTimeout(90_000);
  await openNotificationWindow(page, false, false, 1);
  await notify(page, 'startup-recovered');
  await expect(page.getByRole('heading', { name: 'startup-recovered', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.visible)).toBe(true);
});

test('pending notifications reveal the native window again after it has been hidden', async ({ page }) => {
  await openNotificationWindow(page, false);
  await notify(page, 'first');
  await page.getByRole('button', { name: '关闭提醒', exact: true }).click();
  await expect.poll(() => hideCount(page)).toBe(1);
  await page.evaluate(() => (window as any).__notificationFixture.pending.push({
    id: 'missed-event', kind: 'message', title: '补取的新消息', body: '隐藏窗口也应重新显示',
    createdAt: new Date().toISOString(), workspaceId: 'notification-workspace', workspaceRevision: 1,
  }));
  await expect(page.getByRole('heading', { name: '补取的新消息', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.visible)).toBe(true);
});

test('a pending message reveals a hidden window while an earlier notification is still queued', async ({ page }) => {
  await openNotificationWindow(page, false);
  await notify(page, 'first');
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.visible)).toBe(true);
  await page.evaluate(() => {
    const fixture = (window as any).__notificationFixture;
    fixture.visible = false;
    fixture.pending.push({
      id: 'second', kind: 'message', title: '另一条消息', body: '重新显示未关闭的提醒窗口',
      createdAt: new Date().toISOString(), workspaceId: 'notification-workspace', workspaceRevision: 1,
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.pending.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.visible)).toBe(true);
  await expect(page.getByRole('heading', { name: 'first', exact: true })).toBeVisible();
});

test('auto-dismiss advances one notification at a time and ignores duplicate delivery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openNotificationWindow(page);
  await notify(page, 'first');
  await notify(page, 'first');
  await notify(page, 'second');
  await expect(page.getByRole('heading', { name: 'first', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'second', exact: true })).toBeVisible({ timeout: 6000 });
  expect(await hideCount(page)).toBe(0);
  await expect.poll(() => hideCount(page), { timeout: 6000 }).toBe(1);
  expect(errors).toEqual([]);
});

test('a new popup counts down after the previous popup was dismissed under the pointer', async ({ page }) => {
  await openNotificationWindow(page);
  await notify(page, 'first');
  await page.getByRole('button', { name: '关闭提醒', exact: true }).click();
  await expect.poll(() => hideCount(page)).toBe(1);
  // A native hide does not reliably deliver a DOM mouseleave event.
  await notify(page, 'second');
  await expect(page.getByRole('heading', { name: 'second', exact: true })).toBeVisible();
  await expect.poll(() => hideCount(page), { timeout: 6000 }).toBe(2);
});

test('dismissing a notification also closes its snooze menu', async ({ page }) => {
  await openNotificationWindow(page, false);
  await notify(page, 'first');
  await page.getByRole('button', { name: '稍后提醒', exact: true }).click();
  await expect(page.getByRole('button', { name: '5 分钟后', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭提醒', exact: true }).click();
  await notify(page, 'second');
  await expect(page.getByRole('heading', { name: 'second', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '5 分钟后', exact: true })).toBeHidden();
});

test('snoozed reminders survive theme changes and use the latest theme', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openNotificationWindow(page, true, true);
  await page.clock.install();
  await page.evaluate(() => (window as any).__notificationFixture.emit('notification://snooze', {
    id: 'snoozed', title: '稍后提醒测试', body: '测试任务', kind: 'reminder', snoozeMinutes: 5,
  }));
  await page.clock.fastForward(60_000);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lanmind-theme-change', { detail: 'light' })));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.clock.fastForward(4 * 60_000 + 100);
  await expect.poll(() => page.evaluate(() => (window as any).__notificationFixture.sent)).toEqual([
    expect.objectContaining({ title: '稍后提醒测试', themeId: 'light', themePreference: 'light' }),
  ]);
});
