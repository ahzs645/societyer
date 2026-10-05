import { expect, test, type Page } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

test.setTimeout(100_000);
async function localWorkspace(page: Page, name: string) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, name, true);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
}

test("a real local workspace keeps live AI, Paperless and browser sessions unavailable without outbound requests", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const externalCalls: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (/\/ai-chat\/stream|\/api\/v1\/browser-connectors|\/api\/action/.test(request.url())) externalCalls.push(request.url());
  });
  await localWorkspace(page, `Local capability audit ${testInfo.project.name}`);
  await page.goto("/app/ai-agents");
  await expect(page.getByRole("status").filter({ hasText: "Live AI chat, agents and provider keys require a connected workspace" })).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate key and load models", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
  await fits(page);
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant", exact: true });
  await expect(assistant.getByText("Live AI requires a connected workspace. Saved conversations and drafts remain available locally.", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(assistant.getByRole("button", { name: "Add file references", exact: true })).toBeVisible();
  await assistant.locator('input[type="file"]').setInputFiles({ name: "audit-reference.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic reference only") });
  await expect(assistant.getByText("Only file names and sizes are included in your message. File contents are not uploaded or analyzed.", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Close AI assistant", exact: true }).last().click();
  await page.goto("/app/paperless");
  await expect(page.getByText("Unavailable locally", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Enable|Save) connection$/ }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeDisabled();
  await fits(page);
  await page.goto("/app/browser-connectors");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Launch browser", exact: true }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Open workspace", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Wave", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch browser", exact: true }).first()).toBeDisabled();
  await fits(page);
  expect(externalCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test("commitment preparation reaches editable tasks and rejects an invalid event while preserving the draft", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await localWorkspace(page, `Task integration audit ${testInfo.project.name}`);
  await page.goto("/app/commitments");
  await page.getByRole("button", { name: "New commitment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add commitment", exact: true });
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Annual external audit promise");
  await dialog.locator("[contenteditable=true]").first().pressSequentially("Prepare the annual external audit package.");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The featured card exposes the same cross-module callback as the row action.
  await page.getByRole("button", { name: "Plan task", exact: true }).first().click();
  await expect(page.getByText("Preparation task created", { exact: true })).toBeVisible();
  await page.goto("/app/tasks");
  const title = "Prepare Annual external audit promise";
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await page.getByText(title, { exact: true }).first().click();
  const taskForm = page.getByRole("dialog").last();
  await expect(taskForm.getByLabel("Event ID (optional)", { exact: true })).toHaveValue(/^commitment:/);
  await taskForm.getByRole("textbox", { name: "Title", exact: true }).fill("Corrected audit preparation");
  await taskForm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(taskForm).toBeHidden();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const createForm = page.getByRole("dialog").last();
  await createForm.getByRole("textbox", { name: "Title", exact: true }).fill("Keep this rejected task draft");
  await createForm.getByLabel("Event ID (optional)", { exact: true }).fill("unknown:unowned-source");
  await createForm.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Could not save task", { exact: true })).toBeVisible();
  await expect(createForm.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep this rejected task draft");
  await createForm.getByLabel("Event ID (optional)", { exact: true }).fill("");
  await createForm.getByRole("button", { name: "Create", exact: true }).click();
  await expect(createForm).toBeHidden();
  await page.reload();
  await expect(page.getByText("Corrected audit preparation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Keep this rejected task draft", { exact: true }).first()).toBeVisible();
  await fits(page);
  expect(errors).toEqual([]);
});
