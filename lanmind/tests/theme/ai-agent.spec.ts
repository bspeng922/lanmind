import { test, expect as baseExpect } from "@playwright/test";
// Browser runs refresh every five seconds; leave room for a complete poll.
const expect = baseExpect.configure({ timeout: 10_000 });
const route = "/tests/theme/index.html?view=ai-agent&locale=en-US";
test("groups duplicate model IDs, keeps two turns and preserves answer versions", async ({
  page,
}) => {
  await page.goto(route);
  const model = page.getByRole("button", { name: "Model", exact: true });
  await model.click();
  const menu = page.getByRole("listbox", { name: "Model", exact: true });
  await expect(menu.getByText("Llama", { exact: true })).toBeVisible();
  await expect(menu.getByText("GPU vLLM", { exact: true })).toBeVisible();
  await expect(menu.getByRole("option")).toHaveCount(2);
  await menu.getByRole("option").nth(1).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Remember code 42");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Answer 1: code 42.", { exact: false }),
  ).toBeVisible();
  await prompt.fill("What is my code?");
  await prompt.press("Enter");
  await expect(
    page.getByText("Answer 2: code 42.", { exact: false }),
  ).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search conversations" });
  await search.fill("What is my code?");
  await expect(
    page.getByTitle("Open this conversation", { exact: true }),
  ).toHaveCount(1);
  await search.fill("missing search phrase");
  await expect(
    page.getByText("No matching conversations", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__aiFixture.requests
          .slice(0, 2)
          .map((r: any) => r.modelRef.connectionId),
      ),
    )
    .toEqual(["gpu", "gpu"]);
  await page
    .getByRole("button", { name: "Regenerate", exact: true })
    .last()
    .click();
  await expect(
    page.getByText("Answer 3: code 42.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(2);
  const versions = page.getByRole("button", { name: "Answer versions" });
  await versions.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option").first().click();
  await expect(
    page.getByText("Answer 2: code 42.", { exact: false }),
  ).toBeVisible();
});
test("stops an active run and obtains one explicit approval for a write", async ({
  page,
}) => {
  await page.goto(route);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("wait for a long response");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("option", { name: "Workspace Agent", exact: true }).click();
  await prompt.fill("create task Review plan");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve operation" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__aiFixture.writes))
    .toBe(0);
  await page.getByRole("button", { name: "Approve operation" }).click();
  await expect(page.getByText("Task created.", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__aiFixture.writes))
    .toBe(1);
  await page
    .getByRole("button", { name: "Regenerate", exact: true })
    .last()
    .click();
  await expect(
    page.getByText("Answer 3: code 42.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__aiFixture.writes))
    .toBe(1);
});
test("saves a preset connection and keeps credential values out of the read response", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Models and Agent settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /SGLang/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Base URL" })).toHaveValue(
    "http://127.0.0.1:30000/v1",
  );
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("SGLang lab");
  await dialog.locator('input[type="password"]').fill("fixture-private-key");
  const modelInput = dialog.getByRole("textbox", { name: "Remote model ID", exact: true });
  await modelInput.fill("same-model");
  await modelInput.press("Enter");
  await dialog.locator('button').filter({ hasText: /(保存供应商|Save Provider)/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.length)).toBe(3);
  await expect(dialog.locator('input[type="password"]')).toHaveValue("");
  await expect(dialog.locator('input[type="password"]')).toHaveAttribute(
    "placeholder",
    "Saved; leave blank to keep the current credential",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.stringify((window as any).__aiFixture.data.catalog).includes(
          "fixture-private-key",
        ),
      ),
    )
    .toBe(false);
});
test("discovers and binds selected MCP tools and saves an app schedule", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Models and Agent settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "MCP client", exact: true }).click();
  await dialog.getByRole("button", { name: "Add MCP connection" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByRole("button", { name: "Discover tools" }).click();
  await dialog.getByRole("checkbox", { name: "echo", exact: true }).check();
  await dialog
    .getByRole("checkbox", { name: "Grant read-only access", exact: false })
    .check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__aiFixture.data.extensions.find(
            (e: any) => e.kind === "mcp",
          ).config.enabledTools,
      ),
    )
    .toEqual(["echo"]);
  await dialog.getByRole("button", { name: "Schedules", exact: true }).click();
  await dialog.getByRole("button", { name: "Add schedule" }).click();
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Daily task review");
  await dialog
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Summarize my current tasks");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    dialog.getByText("Daily task review", { exact: true }),
  ).toBeVisible();
  const historyBtn = dialog.getByRole("button", { name: /History|执行记录/ });
  await expect(historyBtn).toBeVisible();
  await historyBtn.click();
  const historyModal = page.getByRole("dialog", { name: /Execution History|定时任务执行记录/ });
  await expect(historyModal).toBeVisible();
  await historyModal.getByRole("button", { name: /Close|关闭/ }).click();
  await expect(historyModal).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__aiFixture.data.schedules.length),
    )
    .toBe(1);
  const mcpName = await page.evaluate(
    () =>
      (window as any).__aiFixture.data.extensions.find(
        (e: any) => e.kind === "mcp",
      ).name,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("option", { name: "Workspace Agent", exact: true }).click();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: `${mcpName} MCP`, exact: true }),
  ).toBeVisible();
});
