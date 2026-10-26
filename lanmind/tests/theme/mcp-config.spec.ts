import { test, expect, type Page } from "@playwright/test";

async function addConnection(page: Page) {
  await page.goto("/tests/theme/index.html?view=ai-agent&locale=en-US");
  await page.getByRole("button", { name: "Models and Agent settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "MCP client", exact: true }).click();
  await dialog.getByRole("button", { name: "Add MCP connection" }).click();
  return dialog;
}

test("switches HTTP form and JSON both ways, then saves JSON without exposing its token", async ({ page }) => {
  const dialog = await addConnection(page);
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Docs");
  await dialog.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/mcp");
  await dialog.getByLabel("Bearer token").fill("pending-token");
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  const json = dialog.getByRole("textbox", { name: "MCP configuration JSON" });
  expect(JSON.parse(await json.inputValue()).headers.Authorization).toBe("Bearer pending-token");
  await json.fill(JSON.stringify({ mcpServers: { "Imported docs": { url: "https://example.com/docs", headers: { Authorization: "Bearer imported-token" } } } }));
  await dialog.getByRole("button", { name: "Form", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Imported docs");
  await expect(dialog.getByRole("textbox", { name: "URL", exact: true })).toHaveValue("https://example.com/docs");
  await expect(dialog.getByLabel("Bearer token")).toHaveValue("imported-token");
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(json).toBeHidden();
  const saved = await page.evaluate(() => (window as any).__aiFixture.data.extensions.find((e: any) => e.kind === "mcp"));
  expect(saved).toMatchObject({ name: "Imported docs", hasCredential: true, config: { transport: "http", url: "https://example.com/docs" } });
  expect(JSON.stringify(saved)).not.toContain("imported-token");
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  expect(JSON.parse(await json.inputValue()).headers).toBeUndefined();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Bearer token")).toHaveAttribute("placeholder", "Saved; leave blank to keep the current credential");
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  const clear = dialog.getByRole("checkbox", { name: "Clear the saved credential", exact: true });
  await clear.check();
  await json.fill(JSON.stringify({ url: "https://example.com/docs", headers: { Authorization: "Bearer replacement-token" } }));
  await expect(clear).not.toBeChecked();
  await clear.check();
  expect(JSON.parse(await json.inputValue()).headers).toBeUndefined();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(json).toBeHidden();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.extensions.find((e: any) => e.kind === "mcp").hasCredential)).toBe(false);
});

test("keeps invalid JSON visible, blocks saving and rejects unsupported configuration", async ({ page }) => {
  const dialog = await addConnection(page);
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  const json = dialog.getByRole("textbox", { name: "MCP configuration JSON" });
  await json.fill('{"mcpServers":');
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Form", exact: true }).click();
  await expect(json).toHaveValue('{"mcpServers":');
  await expect(json).toHaveAttribute("aria-invalid", "true");
  await json.fill(JSON.stringify({ url: "https://example.com/mcp", headers: { "X-API-Key": "secret" } }));
  await expect(dialog.getByRole("alert")).toContainText("Only Authorization: Bearer");
  await json.fill(JSON.stringify({ mcpServers: { first: { url: "https://example.com/1" }, second: { url: "https://example.com/2" } } }));
  await expect(dialog.getByRole("alert")).toContainText("one MCP connection at a time");
  expect(await page.evaluate(() => (window as any).__aiFixture.data.extensions.filter((e: any) => e.kind === "mcp"))).toHaveLength(0);
});

test("preserves stdio values through mode changes and requires trust before saving", async ({ page }) => {
  const dialog = await addConnection(page);
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  const json = dialog.getByRole("textbox", { name: "MCP configuration JSON" });
  await json.fill(JSON.stringify({ mcpServers: { local: { command: "C:\\tools\\mcp.exe", args: ["--root", "a b"], cwd: "C:\\docs", env: { API_KEY: "environment-secret" } } } }));
  await dialog.getByRole("button", { name: "Form", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Absolute executable path", exact: true })).toHaveValue("C:\\tools\\mcp.exe");
  expect(JSON.parse(await dialog.getByRole("textbox", { name: "Arguments", exact: true }).inputValue())).toEqual(["--root", "a b"]);
  await dialog.getByRole("button", { name: "JSON", exact: true }).click();
  expect(JSON.parse(await json.inputValue()).env).toEqual({ API_KEY: "environment-secret" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("I trust this program");
  await dialog.getByRole("checkbox", { name: "I trust this program and allow it to start" }).check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(json).toBeHidden();
  const saved = await page.evaluate(() => (window as any).__aiFixture.data.extensions.find((e: any) => e.kind === "mcp"));
  expect(saved.config).toMatchObject({ command: "C:\\tools\\mcp.exe", args: ["--root", "a b"], cwd: "C:\\docs", trustedStdio: true, environmentKeys: ["API_KEY"] });
  expect(JSON.stringify(saved)).not.toContain("environment-secret");
});
