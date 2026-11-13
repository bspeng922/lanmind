import { expect, test, type Page } from '@playwright/test';

async function openProvider(page: Page) {
  await page.goto('/tests/theme/index.html?view=ai-agent&locale=en-US');
  await page.getByRole('button', { name: 'Models and Agent settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Models and Agent settings' });
  await settings.getByRole('button', { name: /Anthropic Compatible/ }).click();
  return page.getByRole('dialog', { name: 'New Model Provider' });
}

test('discovers with the current draft without saving and only marks the active action busy', async ({ page }) => {
  const provider = await openProvider(page);
  await provider.getByRole('textbox', { name: 'Name', exact: true }).fill('Draft gateway');
  await provider.getByRole('textbox', { name: 'Base URL', exact: true }).fill('http://draft.invalid/v1');
  await provider.locator('input[type="password"]').fill('fixture-draft-key');
  await page.evaluate(() => { (window as any).__aiFixture.deferConnectionAction = 'connection.discover'; });
  const discover = provider.getByRole('button', { name: 'Discover models', exact: true });
  const save = provider.getByRole('button', { name: 'Save Provider', exact: true });
  await discover.click();
  await expect(discover).toHaveAttribute('aria-busy', 'true');
  await expect(discover.getByRole('progressbar')).toHaveCount(1);
  await expect(save).toHaveAttribute('aria-busy', 'false');
  await expect(save.getByRole('progressbar')).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__aiFixture.connectionRequests)).toEqual([
    { action: 'connection.discover', payload: { draft: {
      id: null, expectedRevision: null, name: 'Draft gateway', providerType: 'anthropic-compatible',
      baseUrl: 'http://draft.invalid/v1', enabled: true, bound: true, parameters: {}, models: [],
      credentialChange: { action: 'replace', value: 'fixture-draft-key' },
    } } },
  ]);
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.length)).toBe(2);
  await page.evaluate(() => (window as any).__aiFixture.releaseConnectionAction());
  const models = page.getByRole('dialog', { name: 'Fetch Models', exact: true });
  await expect(models).toBeVisible();
  await models.click({ position: { x: 4, y: 4 } });
  await expect(models).toBeVisible();
  await expect(provider).toBeVisible();
  await models.getByText('another-model', { exact: true }).click();
  await models.getByRole('button', { name: 'Save Models', exact: true }).click();
  await expect(models).toHaveCount(0);
  await expect(provider.getByText('another-model', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.length)).toBe(2);
  await page.evaluate(() => { (window as any).__aiFixture.deferConnectionAction = 'connection.save'; });
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save.getByRole('progressbar')).toHaveCount(1);
  await expect(discover).toHaveAttribute('aria-busy', 'false');
  await expect(discover.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => (window as any).__aiFixture.releaseConnectionAction());
  await expect(provider).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.length)).toBe(3);
});

test('failed discovery preserves the draft and allows manual models or a retry', async ({ page }) => {
  const provider = await openProvider(page);
  const name = provider.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Retry gateway');
  await page.evaluate(() => { (window as any).__aiFixture.deferConnectionAction = 'connection.discover'; });
  const discover = provider.getByRole('button', { name: 'Discover models', exact: true });
  await discover.click();
  await expect(discover).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as any).__aiFixture.releaseConnectionAction('Model catalog is unavailable'));
  await expect(provider.getByRole('alert')).toContainText('Model catalog is unavailable');
  await expect(name).toHaveValue('Retry gateway');
  await expect(discover).toBeEnabled();
  await provider.click({ position: { x: 4, y: 4 } });
  await expect(name).toHaveValue('Retry gateway');
  const model = provider.getByRole('textbox', { name: 'Remote model ID', exact: true });
  await model.fill('manual-model');
  await model.press('Enter');
  await discover.click();
  const models = page.getByRole('dialog', { name: 'Fetch Models', exact: true });
  await expect(models).toBeVisible();
  await models.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(provider.getByText('manual-model', { exact: true })).toBeVisible();
  await provider.getByRole('button', { name: 'Save Provider', exact: true }).click();
  await expect(provider).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.find((c: any) => c.name === 'Retry gateway')?.models[0]?.remoteModelId)).toBe('manual-model');
});

test('an existing provider discovers with edited type and address without updating its saved revision', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=ai-agent&locale=en-US');
  await page.getByRole('button', { name: 'Models and Agent settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Models and Agent settings' });
  await settings.locator('div.group').filter({ hasText: 'Local Ollama' }).getByTitle('Edit provider', { exact: true }).click();
  const provider = page.getByRole('dialog', { name: /^Edit Model Provider:/ });
  await provider.getByRole('button', { name: 'Provider Type', exact: true }).click();
  await page.getByRole('option', { name: 'Anthropic Compatible (Messages API)', exact: true }).click();
  await provider.getByRole('textbox', { name: 'Base URL', exact: true }).fill('http://edited.invalid/v1');
  await provider.getByRole('button', { name: 'Discover models', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fetch Models', exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() => {
    const fixture = (window as any).__aiFixture;
    return { draft: fixture.connectionRequests[0].payload.draft, saved: fixture.data.catalog.connections.find((c: any) => c.id === 'local') };
  });
  expect(snapshot.draft).toMatchObject({ id: 'local', providerType: 'anthropic-compatible', baseUrl: 'http://edited.invalid/v1', credentialChange: { action: 'keep' } });
  expect(snapshot.saved).toMatchObject({ revision: 1, providerType: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' });
});
