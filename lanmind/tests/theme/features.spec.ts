import { expect, test } from '@playwright/test';

test('feature switches persist, hide navigation and retain core settings', async ({ page }) => {
  await page.goto('/tests/theme/features.html?locale=en-US');
  const ai = page.getByRole('switch', { name: 'AI Assistant', exact: true });
  await expect(ai).toBeChecked();
  await expect(page.getByRole('button', { name: 'Model Providers', exact: true })).toBeVisible();
  await ai.click();
  await expect(ai).not.toBeChecked();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Model Providers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await page.reload();
  await expect(ai).not.toBeChecked();
  await ai.click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toBeVisible();
});

test('bundled plugin follows app-wide changes across windows', async ({ page, context }) => {
  await page.goto('/tests/theme/features.html?locale=en-US');
  const other = await context.newPage();
  await other.goto('/tests/theme/features.html?locale=en-US');
  const optical = page.getByRole('switch', { name: 'Optical Transfer', exact: true });
  await expect(optical).toBeChecked();
  await optical.click();
  await expect(other.getByRole('switch', { name: 'Optical Transfer', exact: true })).not.toBeChecked();
  await expect(other.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Optical Transfer', exact: true })).toHaveCount(0);
  await expect(page.getByText('This version supports enabling and disabling', { exact: false })).toBeVisible();
  await other.getByRole('switch', { name: 'Optical Transfer', exact: true }).click();
  await expect(optical).toBeChecked();
});

test('module manager has Chinese labels and keyboard accessible switches', async ({ page }) => {
  await page.goto('/tests/theme/features.html');
  const chat = page.getByRole('switch', { name: '局域网聊天', exact: true });
  await expect(chat).toBeChecked();
  await chat.focus();
  await page.keyboard.press('Space');
  await expect(chat).not.toBeChecked();
  await expect(page.getByText('开关对本机所有工作区生效。', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '插件', exact: true })).toBeVisible();
});

test('disabling the optical plugin releases an active camera stream', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(5);
      (window as any).__opticalStream = stream;
      return stream;
    } });
  });
  await page.goto('/tests/theme/features.html?locale=en-US&optical');
  await page.getByRole('tab', { name: 'Receive', exact: true }).click();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__opticalStream?.getTracks()[0]?.readyState)).toBe('live');
  await page.getByRole('switch', { name: 'Optical Transfer', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__opticalStream?.getTracks()[0]?.readyState)).toBe('ended');
});
