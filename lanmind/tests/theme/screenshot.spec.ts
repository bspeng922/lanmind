import { expect, test, type Page } from '@playwright/test';

const openChat = (page: Page, query = '') => page.goto(`/tests/theme/index.html?view=chat&screenshot=success${query}`);
const calls = (page: Page) => page.evaluate(() => (window as any).__screenshotFixture.calls);
const images = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lan_chat_messages_v2') || '[]').filter((message: any) => message.type === 'image'));
const draftImages = (page: Page) => page.getByRole('group', { name: '待发送图片' });

async function selectRegion(page: Page, from = { x: 100, y: 100 }, to = { x: 500, y: 400 }) {
  await expect(page.locator('img')).toBeVisible();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await expect(page.getByTestId('screenshot-region')).toBeVisible();
}

async function pasteImage(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const blob = await (await fetch((window as any).__screenshotFixture.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.locator('textarea').focus();
  await page.keyboard.press('Control+v');
}

for (const theme of ['ivory', 'midnight']) {
  test(`screenshot and arrow form a compact button group (${theme})`, async ({ page }) => {
    await openChat(page, `&theme=${theme}`);
    const file = page.getByRole('button', { name: '传输文件', exact: true });
    const capture = page.getByRole('button', { name: '截图', exact: true });
    const options = page.getByRole('button', { name: '截图选项' });
    const boxes = await Promise.all([file.boundingBox(), capture.boundingBox(), options.boundingBox()]);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
    expect(boxes[2]!.x - boxes[1]!.x - boxes[1]!.width).toBeLessThanOrEqual(1);
    expect(boxes[2]!.width).toBeLessThanOrEqual(16);
    expect(boxes[1]!.width + boxes[2]!.width).toBeLessThanOrEqual(42);
    await options.click();
    await expect(page.getByRole('menuitem', { name: '隐藏窗口截图' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(options).toBeFocused();
    await options.click();
    await page.getByRole('menuitem', { name: '隐藏窗口截图' }).click();
    await expect.poll(() => calls(page)).toEqual([true]);
    await expect(capture).toBeEnabled();
    await expect(page.getByRole('dialog', { name: '截图预览' })).not.toBeVisible();
    expect(await images(page)).toHaveLength(0);
    await options.click();
    await page.locator('textarea').click();
    await expect(page.getByRole('menu', { name: '截图选项' })).not.toBeVisible();
  });
}

test('normal capture returns to the composer without a preview or sending a message', async ({ page }) => {
  await openChat(page);
  await page.locator('textarea').fill('保留输入草稿');
  await page.getByRole('button', { name: '截图', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([false]);
  await expect(page.locator('textarea')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '截图预览' })).not.toBeVisible();
  expect(await images(page)).toHaveLength(0);
  await expect(page.locator('textarea')).toHaveValue('保留输入草稿');
});

for (const result of ['cancel', 'error']) {
  test(`capture ${result} leaves messages and the draft intact`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=chat&screenshot=${result}`);
    await page.locator('textarea').fill('截图前的草稿');
    await page.getByRole('button', { name: '截图', exact: true }).click();
    await expect.poll(() => calls(page)).toEqual([false]);
    await expect(page.getByRole('button', { name: '截图', exact: true })).toBeEnabled();
    await expect(page.locator('textarea')).toHaveValue('截图前的草稿');
    expect(await images(page)).toHaveLength(0);
    if (result === 'error') await expect(page.getByText('截图失败，请检查系统录屏权限后重试')).toBeVisible();
  });
}

test('capture disables duplicate requests and cancels when switching conversations', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=chat&screenshot=delayed');
  const capture = page.getByRole('button', { name: '截图', exact: true });
  await capture.click();
  await expect(capture).toBeDisabled();
  await expect(page.getByRole('button', { name: '截图选项' })).toBeDisabled();
  await page.locator('.chat-group-item').filter({ hasText: '项目协作群' }).click();
  await expect(capture).toBeEnabled();
  expect(await calls(page)).toEqual([false]);
  expect(await page.evaluate(() => (window as any).__screenshotFixture.cancelled)).toBe(1);
});

test('screenshot controls are disabled for read-only project history', async ({ page }) => {
  await openChat(page, '&readonly-group=1');
  await page.locator('.chat-group-item').filter({ hasText: '项目协作群' }).click();
  await expect(page.getByRole('button', { name: '截图', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '截图选项' })).toBeDisabled();
});

test('screenshot menu and selection actions support English', async ({ page }) => {
  await openChat(page, '&locale=en-US');
  await page.getByRole('button', { name: 'Screenshot options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Hide window and capture' })).toBeVisible();
  await page.goto('/tests/theme/index.html?view=screenshot-selection&locale=en-US');
  await expect(page.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save screenshot as' })).toBeVisible();
});

test('reverse selection uses native image pixels and Enter copies the region', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=screenshot-selection');
  await selectRegion(page, { x: 400, y: 300 }, { x: 100, y: 50 });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.regions)).toEqual([{ x: 200, y: 100, width: 600, height: 500 }]);
  expect(await page.evaluate(() => (window as any).__screenshotFixture.actions)).toEqual(['copy']);
});

test('zero-size selections are ignored, double-click copies and Escape cancels', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=screenshot-selection');
  await page.mouse.click(30, 300);
  await expect(page.getByRole('button', { name: '复制到剪贴板' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '截图另存为' })).toBeDisabled();
  await selectRegion(page);
  await page.mouse.dblclick(200, 200);
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.actions)).toEqual(['copy']);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.cancelled)).toBe(1);
});

test('save cancellation and failure preserve the region for retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=screenshot-selection');
  await selectRegion(page);
  const save = page.getByRole('button', { name: '截图另存为' });
  await page.evaluate(() => { (window as any).__screenshotFixture.cancelSave = true; });
  await save.click();
  await expect(page.getByTestId('screenshot-region')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__screenshotFixture.saves)).toBe(0);
  await page.evaluate(() => { (window as any).__screenshotFixture.cancelSave = false; (window as any).__screenshotFixture.failSave = true; });
  await save.click();
  await expect(page.getByText('保存图片失败，请重试')).toBeVisible();
  await page.evaluate(() => { (window as any).__screenshotFixture.failSave = false; });
  await save.click();
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.saves)).toBe(1);
  expect(await page.evaluate(() => (window as any).__screenshotFixture.regions)).toEqual([{ x: 200, y: 200, width: 800, height: 600 }]);
});

test('copy failure preserves the region for retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=screenshot-selection');
  await selectRegion(page);
  await page.evaluate(() => { (window as any).__screenshotFixture.failCopy = true; });
  await page.getByRole('button', { name: '复制到剪贴板' }).click();
  await expect(page.getByText('复制图片失败，请重试')).toBeVisible();
  await expect(page.getByTestId('screenshot-region')).toBeVisible();
  await page.evaluate(() => { (window as any).__screenshotFixture.failCopy = false; });
  await page.getByRole('button', { name: '复制到剪贴板' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.regions.length)).toBe(1);
});

test('clipboard images paste into a draft and send to the selected group', async ({ page }) => {
  await openChat(page);
  await page.locator('.chat-group-item').filter({ hasText: '项目协作群' }).click();
  await page.locator('textarea').fill('保留输入草稿');
  await pasteImage(page);
  await expect(draftImages(page).getByRole('img')).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue('保留输入草稿');
  expect(await images(page)).toHaveLength(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(draftImages(page)).not.toBeVisible();
  await expect.poll(async () => (await images(page)).length).toBe(1);
  const [message] = await images(page);
  expect(message.groupId).toBe('theme-group');
  expect(message.fileUrl).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('textarea')).toHaveValue('');
});

test('image-only drafts can be removed, pasted again and sent with Enter', async ({ page }) => {
  await openChat(page);
  await pasteImage(page);
  await expect(draftImages(page)).toBeVisible();
  await draftImages(page).getByRole('button', { name: '移除图片' }).click();
  await expect(draftImages(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await pasteImage(page);
  await expect(draftImages(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await images(page)).length).toBe(1);
});

test('failed image sends keep the draft for retry without opening a modal', async ({ page }) => {
  await openChat(page);
  await pasteImage(page);
  await expect(draftImages(page)).toBeVisible();
  await page.evaluate(() => { (window as any).__screenshotFixture.failSend = true; (window as any).isTauri = true; });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('测试发送失败')).toBeVisible();
  await expect(draftImages(page).getByRole('img')).toBeVisible();
  await page.evaluate(() => { (window as any).__screenshotFixture.failSend = false; });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(draftImages(page)).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__screenshotFixture.sends)).toBe(1);
});

test('plain text still pastes normally and image drafts stay with their conversation', async ({ page }) => {
  await openChat(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('普通文字粘贴'));
  await page.locator('textarea').focus();
  await page.keyboard.press('Control+v');
  await expect(page.locator('textarea')).toHaveValue('普通文字粘贴');
  await pasteImage(page);
  await expect(draftImages(page)).toBeVisible();
  await page.locator('.chat-group-item').filter({ hasText: '项目协作群' }).click();
  await expect(draftImages(page)).not.toBeVisible();
  expect(await images(page)).toHaveLength(0);
});

test('screenshot toolbar provides rectangle, arrow, text, mosaic, eraser and annotation controls', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=screenshot-selection');
  await selectRegion(page);
  await expect(page.getByRole('button', { name: '矩形框' })).toBeVisible();
  await expect(page.getByRole('button', { name: '箭头' })).toBeVisible();
  await expect(page.getByRole('button', { name: '画笔' })).toBeVisible();
  await expect(page.getByRole('button', { name: '文本' })).toBeVisible();
  await expect(page.getByRole('button', { name: '马赛克' })).toBeVisible();
  await expect(page.getByRole('button', { name: '橡皮擦' })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销 (Ctrl+Z)' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重做 (Ctrl+Y)' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空标注' })).toBeVisible();

  // Test rectangle tool activates
  await page.getByRole('button', { name: '矩形框' }).click();
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(260, 260);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '撤销 (Ctrl+Z)' })).toBeEnabled();

  // Test undo
  await page.getByRole('button', { name: '撤销 (Ctrl+Z)' }).click();
  await expect(page.getByRole('button', { name: '撤销 (Ctrl+Z)' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重做 (Ctrl+Y)' })).toBeEnabled();
});

