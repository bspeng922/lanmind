import { expect as baseExpect, test, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 10_000 });

const route = '/tests/theme/index.html?view=ai-agent&locale=zh-CN';
const card = (page: Page) => page.getByRole('region', { name: '需要你确认', exact: true });
async function ask(page: Page, prompt = 'clarify choices') {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(prompt);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(card(page)).toBeVisible();
}

test('groups independent questions, submits explicit selections and keeps an answer history', async ({ page }) => {
  await page.goto(route);
  await ask(page);
  await expect(card(page).getByRole('group')).toHaveCount(3);
  await expect(card(page).getByRole('button', { name: '提交回答' })).toBeDisabled();
  await card(page).getByRole('checkbox', { name: '调整优先级', exact: true }).check();
  await card(page).getByRole('checkbox', { name: '并入 LanMind 项目', exact: true }).check();
  await card(page).getByRole('radio', { name: '顺延截止日期', exact: true }).check();
  await card(page).getByRole('radio', { name: '暂不处理', exact: true }).check();
  await expect(card(page).getByRole('radio', { name: '顺延截止日期', exact: true })).not.toBeChecked();
  await card(page).getByRole('radio', { name: 'P1 最紧急', exact: true }).check();
  await expect(card(page).getByText('已选择 3 / 3 项问题')).toBeVisible();
  await card(page).getByRole('textbox').fill('其余保持 P4。');
  await card(page).getByRole('button', { name: '提交回答' }).click();
  await expect(card(page).getByText('已回答', { exact: true })).toBeVisible();
  const state = await page.evaluate(() => (window as any).__aiFixture);
  expect(state.decisions).toEqual([{ answer: '你希望进行哪些改动？\n- 调整优先级\n- 并入 LanMind 项目\n\n逾期子任务如何处理？\n- 暂不处理\n\n确认优先级方向\n- P1 最紧急\n\n其余保持 P4。' }]);
  expect(state.writes).toBe(0);
  await card(page).getByText('查看原问题', { exact: true }).click();
  await expect(card(page).getByRole('checkbox').first()).toBeDisabled();
});

test('allows a custom answer, preserves newlines and submits with Ctrl+Enter', async ({ page }) => {
  await page.goto(route);
  await ask(page);
  const answer = card(page).getByRole('textbox');
  await answer.fill('先不修改');
  await answer.press('Enter');
  await answer.pressSequentially('请先解释优先级。');
  await expect(answer).toHaveValue('先不修改\n请先解释优先级。');
  expect(await page.evaluate(() => (window as any).__aiFixture.decisions.length)).toBe(0);
  await answer.press('Control+Enter');
  await expect(card(page).getByText('已回答', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.decisions[0].answer)).toBe('先不修改\n请先解释优先级。');
});

test('retains choices and text when submission fails and permits retry', async ({ page }) => {
  await page.goto(route);
  await ask(page);
  await card(page).getByRole('checkbox', { name: '调整优先级', exact: true }).check();
  await card(page).getByRole('textbox').fill('保留草稿');
  await page.evaluate(() => { (window as any).__aiFixture.failDecision = true; });
  await card(page).getByRole('button', { name: '提交回答' }).click();
  await expect(card(page).getByRole('alert')).toContainText('Fixture answer failed');
  await expect(card(page).getByRole('checkbox', { name: '调整优先级', exact: true })).toBeChecked();
  await expect(card(page).getByRole('textbox')).toHaveValue('保留草稿');
  await page.evaluate(() => { (window as any).__aiFixture.failDecision = false; });
  await card(page).getByRole('button', { name: '提交回答' }).click();
  await expect(card(page).getByText('已回答', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.decisions.length)).toBe(1);
});

test('formats legacy questions into readable sections and stops accepting input after cancellation', async ({ page }) => {
  await page.goto(route);
  await ask(page, 'clarify legacy');
  await expect(card(page).locator('.ai-question-text-section')).toHaveCount(3);
  await expect(card(page).getByRole('textbox', { name: '回答', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(card(page).getByRole('textbox')).toHaveCount(0);
  await expect(card(page).getByText('已回答', { exact: true })).toHaveCount(0);
});

test('renders DSML as a question card and sends an ordinary reply without executing a tool', async ({ page }) => {
  await page.goto(route);
  await ask(page, 'clarify dsml');
  await expect(page.locator('[data-message-role="assistant"]').first()).not.toContainText('DSML');
  await expect(card(page).locator('.ai-question-text-section')).toHaveCount(3);
  await card(page).getByRole('textbox').fill('调整优先级，P1 最紧急。');
  await card(page).getByRole('button', { name: '提交回答' }).click();
  await expect(card(page).getByText('已回答', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.requests[1].input.text)).toBe('调整优先级，P1 最紧急。');
  expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(0);
});

test('deduplicates textual markup when a real ask_user call exists', async ({ page }) => {
  await page.goto(route);
  await ask(page, 'clarify both');
  await expect(card(page)).toHaveCount(1);
  await expect(page.locator('[data-message-role="assistant"]')).not.toContainText('DSML');
});

test('combines multiple textual requests into one submission and keeps both questions in answer history', async ({ page }) => {
  await page.goto(route);
  await ask(page, 'clarify dsml multiple');
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toContainText('交付日期希望安排在哪一天？');
  const answer = '优先级调整为 P1。\n交付日期安排在周五。';
  await card(page).getByRole('textbox').fill(answer);
  await expect(card(page).getByRole('textbox')).toHaveValue(answer);
  await card(page).getByRole('button', { name: '提交回答' }).click();
  await expect(card(page).getByText('已回答', { exact: true })).toBeVisible();
  await expect(card(page).getByRole('textbox')).toHaveCount(0);
  await expect(card(page).locator('.ai-question-answer')).toContainText(answer);
  expect(await page.evaluate(() => (window as any).__aiFixture.requests[1].input.text)).toBe(answer);
  expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(0);
  await card(page).getByText('查看原问题', { exact: true }).click();
  await expect(card(page)).toContainText('交付日期希望安排在哪一天？');
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: options wrap within the conversation at 800px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 800, height: 1200 });
    await page.goto(`${route}&theme=${theme}`);
    await ask(page);
    expect(await card(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await card(page).getByRole('checkbox', { name: '调整优先级', exact: true }).check();
    await card(page).screenshot({ path: info.outputPath('ask-user.png') });
  });
}
