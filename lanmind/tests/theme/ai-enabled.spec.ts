import { test, expect, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Models and Agent settings" }).click();
  return page.getByRole("dialog");
}

test("creates a disabled schedule and preserves its configuration through list and editor switches", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Schedules", exact: true }).click();
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Daily review");
  await dialog.getByRole("textbox", { name: "Prompt", exact: true }).fill("Review my tasks");
  await dialog.getByRole("switch", { name: "Enable this task", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const toggle = dialog.getByRole("switch", { name: "Enable or disable: Daily review", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByText("Automatic runs paused", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Enable this task", exact: true })).toBeChecked();
  await expect(dialog.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("Review my tasks");
  await dialog.getByRole("switch", { name: "Enable this task", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
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
  await expect(dialog.getByRole("switch", { name: "Enable this connection", exact: true })).toBeChecked();
  await dialog.getByLabel("API key", { exact: true }).fill("provider-secret");
  await dialog.getByRole("button", { name: "Save Provider", exact: true }).click();
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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

test("keeps disabled Skills and MCP configurations and clears them from the next run's selected scope", async ({ page }) => {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "MCP client", exact: true }).click();
  await dialog.getByRole("button", { name: "Add MCP connection" }).click();
  await expect(dialog.getByRole("switch", { name: "Enable this configuration", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
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
  await expect(dialog.getByRole("switch", { name: "Enable this configuration", exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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
