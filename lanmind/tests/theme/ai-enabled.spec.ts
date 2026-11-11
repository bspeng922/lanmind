import { test, expect, type Locator, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Models and Agent settings" }).click();
  return page.getByRole("dialog", { name: "Models and Agent settings" });
}

async function expectBackdropCoversViewport(page: Page, modal: Locator) {
  await expect(modal).toBeVisible();
  const metrics = await modal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const hitBottomCenter = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 4);
    const hitBottomLeft = document.elementFromPoint(12, window.innerHeight - 4);
    return {
      inBody: element.parentElement === document.body,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      marginBottom: style.marginBottom,
      coversBottomCenter: hitBottomCenter === element || element.contains(hitBottomCenter),
      coversBottomLeft: hitBottomLeft === element || element.contains(hitBottomLeft),
    };
  });
  expect(metrics).toEqual({
    inBody: true,
    top: 0,
    left: 0,
    right: metrics.innerWidth,
    bottom: metrics.innerHeight,
    innerWidth: metrics.innerWidth,
    innerHeight: metrics.innerHeight,
    marginBottom: "0px",
    coversBottomCenter: true,
    coversBottomLeft: true,
  });
}

test("creates a disabled schedule and preserves its configuration through list and editor switches", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Schedules", exact: true }).click();
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  const scheduleDialog = page.getByRole("dialog", { name: /New Scheduled Task|Edit Scheduled Task/ });
  await scheduleDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Daily review");
  await scheduleDialog.getByRole("textbox", { name: "Prompt", exact: true }).fill("Review my tasks");
  await scheduleDialog.getByRole("switch", { name: "Enable this task", exact: true }).click();
  await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
  const toggle = dialog.getByRole("switch", { name: "Enable or disable: Daily review", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByText("Automatic runs paused", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(scheduleDialog.getByRole("switch", { name: "Enable this task", exact: true })).toBeChecked();
  await expect(scheduleDialog.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("Review my tasks");
  await scheduleDialog.getByRole("switch", { name: "Enable this task", exact: true }).click();
  await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await dialog.getByRole("button", { name: "Skills", exact: true }).click();
  await dialog.getByRole("button", { name: "Schedules", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.schedules[0])).toMatchObject({ enabled: false, name: "Daily review", prompt: "Review my tasks" });
});

test("toggles providers without clearing models or credentials, and removes disabled providers from model selection", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  const dialog = await openSettings(page);
  const localToggle = dialog.getByRole("switch", { name: "Enable or disable: Local Ollama", exact: true });
  const localCard = dialog.locator("div.group").filter({ has: page.getByRole("switch", { name: "Enable or disable: Local Ollama", exact: true }) });
  await localCard.getByTitle("Edit provider", { exact: true }).click();
  const providerDialog = page.getByRole("dialog", { name: /New Model Provider|Edit Model Provider/ });
  await expect(providerDialog.getByRole("switch", { name: "Enable this connection", exact: true })).toBeChecked();
  await providerDialog.getByLabel("API key", { exact: true }).fill("provider-secret");
  await providerDialog.getByRole("button", { name: "Save Provider", exact: true }).click();
  await expect(providerDialog).toHaveCount(0);
  await localToggle.click();
  await expect(localToggle).not.toBeChecked();
  await localToggle.click();
  await expect(localToggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.find((c: any) => c.id === "local"))).toMatchObject({ enabled: true, hasCredential: true, models: [{ remoteModelId: "same-model" }] });
  await localToggle.click();
  await expect(localToggle).not.toBeChecked();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  const list = page.getByRole("listbox", { name: "Model", exact: true });
  await expect(list.getByText("Local Ollama", { exact: true })).toHaveCount(0);
  await expect(list.getByText("GPU vLLM", { exact: true })).toBeVisible();
  await list.getByRole("option").first().click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Check the enabled provider");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__aiFixture.requests.at(-1)?.modelRef.connectionId)).toBe("gpu");
});

test("re-enables retained providers in the current workspace for model tests and schedules", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=command-palette&locale=en-US");
  const rail = page.locator(".app-rail");
  await expect(rail).toBeVisible();
  await page.evaluate(() => {
    const catalog = (window as any).__aiFixture.data.catalog;
    for (const connection of catalog.connections) {
      connection.bound = false;
      connection.models.forEach((model: any) => { model.enabled = false; });
    }
    catalog.connections[0].hasCredential = true;
  });
  await rail.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsNav = page.getByRole("navigation", { name: "Settings categories" });
  await settingsNav.getByRole("button", { name: "Model Providers", exact: true }).click();
  const localToggle = page.getByRole("switch", { name: "Enable or disable: Local Ollama", exact: true });
  const localCard = page.locator("div.group").filter({ has: localToggle });
  await expect(localToggle).not.toBeChecked();
  await expect(localCard.getByTitle("Test connection and model availability", { exact: true })).toBeDisabled();
  await expect(localCard.getByText(/Not enabled in this workspace/)).toBeVisible();

  await settingsNav.getByRole("button", { name: "Scheduled Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  const scheduleDialog = page.getByRole("dialog", { name: "New Scheduled Task", exact: true });
  await scheduleDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Recovered schedule");
  await scheduleDialog.getByRole("textbox", { name: "Prompt", exact: true }).fill("Review my tasks");
  await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(scheduleDialog.getByRole("alert")).toHaveText("Enable a model provider in this workspace and select an available model first");
  expect(await page.evaluate(() => (window as any).__aiFixture.data.schedules)).toHaveLength(0);
  await scheduleDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await settingsNav.getByRole("button", { name: "Model Providers", exact: true }).click();
  await localToggle.click();
  await expect(localToggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.find((connection: any) => connection.id === "local"))).toMatchObject({
    enabled: true,
    bound: true,
    hasCredential: true,
    models: [{ id: "local-model", enabled: true }],
  });
  await localCard.getByTitle("Test connection and model availability", { exact: true }).click();
  await page.getByTitle("Test this model", { exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Same model" }).getByText("Normal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();

  await settingsNav.getByRole("button", { name: "Scheduled Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  await scheduleDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Recovered schedule");
  await scheduleDialog.getByRole("textbox", { name: "Prompt", exact: true }).fill("Review my tasks");
  await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(scheduleDialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__aiFixture.data.schedules[0])).toMatchObject({
    name: "Recovered schedule",
    modelRef: { connectionId: "local", modelEntryId: "local-model" },
  });
});

test("binds a retained provider and its models when saving edits in another workspace", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  await page.getByRole("button", { name: "Models and Agent settings" }).waitFor();
  await page.evaluate(() => {
    const connection = (window as any).__aiFixture.data.catalog.connections[0];
    connection.bound = false;
    connection.models.forEach((model: any) => { model.enabled = false; });
    connection.hasCredential = true;
  });
  const dialog = await openSettings(page);
  const localToggle = dialog.getByRole("switch", { name: "Enable or disable: Local Ollama", exact: true });
  const localCard = dialog.locator("div.group").filter({ has: page.getByRole("switch", { name: "Enable or disable: Local Ollama", exact: true }) });
  await localCard.getByTitle("Edit provider", { exact: true }).click();
  const providerDialog = page.getByRole("dialog", { name: /Edit Model Provider/ });
  await providerDialog.getByRole("button", { name: "Save Provider", exact: true }).click();
  await expect(providerDialog).toHaveCount(0);
  await expect(localToggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.find((connection: any) => connection.id === "local"))).toMatchObject({
    bound: true,
    hasCredential: true,
    models: [{ id: "local-model", enabled: true }],
  });
});

test("keeps disabled Skills and MCP configurations and clears them from the next run's selected scope", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "MCP client", exact: true }).click();
  await dialog.getByRole("button", { name: "Add MCP connection" }).click();
  const mcpDialog = page.getByRole("dialog", { name: /Add MCP Server|Configure MCP Server/ });
  await expect(mcpDialog.getByRole("switch", { name: "Enable this configuration", exact: true })).toBeChecked();
  await mcpDialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("option", { name: "Workspace Agent", exact: true }).click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("checkbox", { name: /Workspace planner/ }).check();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("checkbox", { name: "MCP MCP", exact: true }).check();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await openSettings(page);
  await dialog.getByRole("button", { name: "Skills", exact: true }).click();
  const skillToggle = dialog.getByRole("switch", { name: "Enable or disable: Workspace planner", exact: true });
  await skillToggle.click();
  await expect(skillToggle).not.toBeChecked();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  const skillDialog = page.getByRole("dialog", { name: /New Skill|Configure Skill/ });
  await expect(skillDialog.getByRole("switch", { name: "Enable this configuration", exact: true })).not.toBeChecked();
  await skillDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.getByRole("button", { name: "MCP client", exact: true }).click();
  const mcpToggle = dialog.getByRole("switch", { name: "Enable or disable: MCP", exact: true });
  await mcpToggle.click();
  await expect(mcpToggle).not.toBeChecked();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Skills", exact: true })).toHaveAttribute("title", "Skills");
  await expect(page.getByRole("button", { name: "MCP", exact: true })).toHaveAttribute("title", "MCP client");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Check the enabled scope");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__aiFixture.requests.at(-1)?.skillIds)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__aiFixture.requests.at(-1)?.mcpIds)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__aiFixture.data.extensions.map((e: any) => ({ name: e.name, enabled: e.enabled })))).toEqual(expect.arrayContaining([{ name: "Workspace planner", enabled: false }, { name: "MCP", enabled: false }]));
});

test("portals AI settings editor modals to document.body and covers the entire embedded viewport", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=command-palette&locale=en-US");
  const rail = page.locator(".app-rail");
  await expect(rail).toBeVisible();
  await rail.getByRole("button", { name: "Settings", exact: true }).click();

  const settingsNav = page.getByRole("navigation", { name: "Settings categories" });
  await settingsNav.getByRole("button", { name: "Model Providers", exact: true }).click();
  await page.getByRole("button", { name: /OpenAI/ }).click();
  const createProviderModal = page.getByRole("dialog", { name: "New Model Provider" });
  await expectBackdropCoversViewport(page, createProviderModal);
  await createProviderModal.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByTitle("Edit provider", { exact: true }).first().click();
  const editProviderModal = page.getByRole("dialog", { name: /Edit Model Provider/ });
  await expectBackdropCoversViewport(page, editProviderModal);
  await editProviderModal.getByRole("button", { name: "Cancel", exact: true }).click();

  await settingsNav.getByRole("button", { name: "Scheduled Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  const createScheduleModal = page.getByRole("dialog", { name: "New Scheduled Task" });
  await expectBackdropCoversViewport(page, createScheduleModal);
  await createScheduleModal.getByRole("textbox", { name: "Name", exact: true }).fill("Coverage check");
  await createScheduleModal.getByRole("textbox", { name: "Prompt", exact: true }).fill("Check coverage");
  await createScheduleModal.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const editScheduleModal = page.getByRole("dialog", { name: "Edit Scheduled Task" });
  await expectBackdropCoversViewport(page, editScheduleModal);
  await editScheduleModal.getByRole("button", { name: "Cancel", exact: true }).click();

  await settingsNav.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "Add MCP connection", exact: true }).click();
  const mcpModal = page.getByRole("dialog", { name: "Add MCP Server" });
  await expectBackdropCoversViewport(page, mcpModal);
  await mcpModal.getByRole("button", { name: "Cancel", exact: true }).click();
});
