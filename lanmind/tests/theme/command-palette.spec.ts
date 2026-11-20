import { expect, test } from '@playwright/test';

test('Open AI in the command palette opens the working AI workspace', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByPlaceholder('Search commands').fill('Open AI');
  await palette.getByRole('button', { name: 'Open AI', exact: false }).click();
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
});

test('disabled modules have no command-palette entries', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lanmind-feature-modules-v1', JSON.stringify({ ai: false, wiki: false, optical: false, vault: false, chat: false }));
  });
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  for (const name of ['Open AI', 'Open Wiki', 'Open Chat', 'Open Optical Transfer']) {
    await expect(palette.getByRole('button', { name, exact: false })).toHaveCount(0);
  }
  await expect(palette.getByRole('button', { name: 'Open Work', exact: false })).toBeVisible();
});

test('command palette input has no blue focus ring, quick add shortcut works, and back returns on first click', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav).toBeVisible();

  // Command palette input focus should not paint a focus ring or outline
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const searchInput = palette.getByPlaceholder('Search commands');
  await expect(searchInput).toBeFocused();
  await expect(searchInput).toHaveCSS('outline-style', 'none');
  await expect(searchInput).toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // Navigate to AI, then click Back once — must immediately return to All tasks
  await nav.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'AI Assistant', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'All tasks', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Forward', exact: true })).toBeEnabled();

  // Ctrl+Shift+Space opens Quick Add in-app
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByRole('textbox').first()).toBeVisible();
});

test('standalone quick add waits for the lock status and refocuses its draft when reopened', async ({ page }) => {
  await page.addInitScript(() => {
    let eventId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const handlers = new Map<string, number>();
    let releaseLockStatus!: () => void;
    const lockStatus = new Promise((resolve) => {
      releaseLockStatus = () => resolve({ enabled: false, locked: false, idleMinutes: 5, passwordConfigured: false, revision: 0 });
    });
    const mock = {
      ready: [] as boolean[],
      featureReads: 0,
      hides: 0,
      releaseLockStatus,
      open: () => {
        const event = 'quick-add://opened';
        const callback = callbacks.get(handlers.get(event)!);
        callback?.({ event, payload: null });
      },
    };
    Object.assign(window, {
      isTauri: true,
      __quickAddFixture: mock,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'quick-add' } },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++eventId, callback);
          return eventId;
        },
        invoke: async (command: string, args: { event?: string; handler?: number; ready?: boolean }) => {
          if (command === 'get_feature_modules') {
            mock.featureReads++;
            throw new Error('App state is not ready');
          }
          if (command === 'get_workspace_context') return { workspaceId: 'test', userId: 'local', revision: 0 };
          if (command === 'get_app_lock_status') return lockStatus;
          if (command === 'plugin:event|listen') {
            handlers.set(args.event!, args.handler!);
            return ++eventId;
          }
          if (command === 'quick_add_window_ready') mock.ready.push(Boolean(args.ready));
          if (command === 'plugin:window|hide') mock.hides++;
          return null;
        },
      },
    });
  });
  await page.setViewportSize({ width: 700, height: 230 });
  await page.goto('/quick-add.html');
  const input = page.getByRole('textbox');
  await expect(page.locator('[data-app-lock-initializing]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__quickAddFixture.ready)).toEqual([]);
  await page.evaluate(() => (window as any).__quickAddFixture.releaseLockStatus());
  await expect.poll(() => page.evaluate(() => (window as any).__quickAddFixture.ready)).toEqual([true]);
  expect(await page.evaluate(() => (window as any).__quickAddFixture.featureReads)).toBe(1);
  await expect(input).toBeVisible();
  const surface = page.locator('#root .fixed.inset-0').filter({ has: input });
  await expect(surface).toHaveCSS('border-top-left-radius', '16px');
  await expect(surface).toHaveCSS('padding', '0px');
  expect(await surface.boundingBox()).toEqual({ x: 0, y: 0, width: 700, height: 230 });
  await expect(surface.locator(':scope > div')).toHaveCSS('border-top-width', '0px');
  await expect(input).not.toBeFocused();
  await page.evaluate(() => (window as any).__quickAddFixture.open());
  await expect(input).toBeFocused();
  await page.keyboard.type('Create a task');
  await input.blur();
  await page.evaluate(() => (window as any).__quickAddFixture.open());
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Create a task');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__quickAddFixture.hides)).toBe(1);
  await expect(input).toHaveValue('');
});

test('a saved app shortcut leaves text editing shortcuts available in forms', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('p2p_studio_shortcuts', JSON.stringify([
      { id: 'openInbox', code: 'KeyA', keyLabel: 'Ctrl + A', ctrlKey: true, altKey: false, shiftKey: false },
    ]));
  });
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const ai = navigation.getByRole('button', { name: 'AI Assistant', exact: true });
  await ai.click();
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Original text');
  await expect(prompt).toHaveCSS('user-select', 'text');
  await prompt.press('Control+a');
  await page.keyboard.type('Updated text');
  await expect(prompt).toHaveValue('Updated text');
  await expect(ai).toHaveAttribute('aria-current', 'page');

  await ai.focus();
  await page.keyboard.press('Control+a');
  await expect(navigation.getByRole('button', { name: 'All tasks', exact: true })).toHaveAttribute('aria-current', 'page');
});
