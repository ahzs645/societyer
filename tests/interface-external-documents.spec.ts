import { expect, test } from "@playwright/test";

test("external documents opt in, persist source configuration, and keep live access unavailable locally", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const sourceRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (/login\.microsoftonline\.com|graph\.microsoft\.com|documentSources:(browse|link|resolve)/.test(`${request.url()} ${request.postData() ?? ""}`)) sourceRequests.push(request.url());
  });

  await page.goto("/demo/app/documents");
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New document", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link existing document", exact: true })).toHaveCount(0);

  await page.goto("/demo/app/settings?tab=modules");
  const moduleToggle = page.getByRole("switch", { name: /^External documents\b/ });
  await expect(moduleToggle).not.toBeChecked();
  await expect(moduleToggle).toBeEnabled();
  // Toggle's native input is visually hidden; its containing label is the click target.
  await page.locator("label.check-row").filter({ has: moduleToggle }).click();
  await expect(moduleToggle).toBeChecked();
  // The displayed choice is optimistic; wait for its mutation before navigating.
  await expect(moduleToggle).toBeEnabled();

  await page.goto("/demo/app/documents");
  await page.getByRole("button", { name: "Link existing document", exact: true }).click();
  const emptyDialog = page.getByRole("dialog", { name: "Link existing document", exact: true });
  await expect(emptyDialog.getByText(/No document source is enabled/)).toBeVisible();
  await emptyDialog.getByRole("link", { name: "Configure document sources", exact: true }).click();

  const settings = page.getByRole("region", { name: "External document sources", exact: true });
  await expect(settings.getByText("Module enabled", { exact: true })).toBeVisible();
  await expect(settings.getByText(/Connect from the hosted workspace/)).toBeVisible();
  await settings.getByRole("button", { name: "Add document source", exact: true }).click();
  await settings.getByLabel("Source name", { exact: true }).fill("Board records");
  await settings.getByLabel("Microsoft tenant ID", { exact: true }).fill("11111111-1111-4111-8111-111111111111");
  await settings.getByLabel("Application (client) ID", { exact: true }).fill("22222222-2222-4222-8222-222222222222");
  await settings.getByLabel("SharePoint site URL", { exact: true }).fill("https://example.sharepoint.com/sites/records");
  await settings.getByLabel("SharePoint site ID", { exact: true }).fill("example.sharepoint.com,33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444");
  await settings.getByLabel("Document library (drive) ID", { exact: true }).fill("b!example-library");
  await settings.getByRole("button", { name: "Save document source", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Enable Board records", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Enable Board records", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Disable Board records", exact: true })).toBeEnabled();

  await page.reload();
  await expect(settings.getByRole("button", { name: "Disable Board records", exact: true })).toBeVisible();
  await page.goto("/demo/app/documents");
  await page.getByRole("button", { name: "Link existing document", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Link existing document", exact: true });
  await expect(dialog.getByText(/Connect from the hosted workspace/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Browse library", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Link document", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "New document", exact: true })).toBeEnabled();
  expect(sourceRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("document source validation rejects employee OneDrive without losing configuration edits", async ({ page }) => {
  await page.goto("/demo/app/settings?tab=runtime");
  const settings = page.getByRole("region", { name: "External document sources", exact: true });
  await settings.getByRole("button", { name: "Add document source", exact: true }).click();
  await settings.getByLabel("Source name", { exact: true }).fill("Rejected personal drive");
  await settings.getByLabel("Microsoft tenant ID", { exact: true }).fill("11111111-1111-4111-8111-111111111111");
  await settings.getByLabel("Application (client) ID", { exact: true }).fill("22222222-2222-4222-8222-222222222222");
  await settings.getByLabel("SharePoint site URL", { exact: true }).fill("https://example-my.sharepoint.com/personal/employee");
  await settings.getByLabel("SharePoint site ID", { exact: true }).fill("example-my.sharepoint.com,33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444");
  await settings.getByLabel("Document library (drive) ID", { exact: true }).fill("b!personal-library");
  await settings.getByRole("button", { name: "Save document source", exact: true }).click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(settings.getByLabel("Source name", { exact: true })).toHaveValue("Rejected personal drive");
  await expect(settings.getByRole("button", { name: "Enable Rejected personal drive", exact: true })).toHaveCount(0);
});
