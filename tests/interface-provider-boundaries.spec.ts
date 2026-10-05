import { expect, test, type Page } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

test.setTimeout(100_000);
async function createWorkspace(page: Page, name: string) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, name, true);
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
}

test("local Paperless remains unavailable and provider configuration controls never make a remote request", async ({ page }, testInfo) => {
  const errors: string[] = [], outgoing: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/api\/action|\/api\/v1\/browser-connectors|paperless.*ngx/i.test(request.url())) outgoing.push(request.url()); });
  await createWorkspace(page, `Provider boundary ${testInfo.project.name}`);
  await page.goto("/app/paperless");
  await expect(page.getByText("Unavailable locally", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Enable|Save) connection$/ }).first()).toBeDisabled();
  await expect(page.getByText("Local records", { exact: true })).toBeVisible();
  await fits(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeDisabled();
  expect(outgoing).toEqual([]); expect(errors).toEqual([]);
});

test("offline membership plans save, reject invalid fees without losing drafts, and cannot charge a member", async ({ page }, testInfo) => {
  const errors: string[] = [], outgoing: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/stripe\.com|\/api\/action/.test(request.url())) outgoing.push(request.url()); });
  await createWorkspace(page, `Billing boundary ${testInfo.project.name}`);
  await page.goto("/app/membership");
  await expect(page.getByText("Checkout and subscription activation require a connected server. Plans and fee history can still be maintained locally.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New plan", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "New plan", exact: true });
  await drawer.getByLabel("Name", { exact: true }).fill("Offline annual membership");
  await drawer.getByLabel("Price (CAD)", { exact: true }).fill("-15");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Could not save plan", { exact: true })).toBeVisible();
  await expect(drawer.getByLabel("Name", { exact: true })).toHaveValue("Offline annual membership");
  await drawer.getByLabel("Price (CAD)", { exact: true }).fill("15");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByText("Offline annual membership", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign up/i }).first()).toBeDisabled();
  await fits(page);
  await page.reload();
  await expect(page.getByText("Offline annual membership", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign up/i }).first()).toBeDisabled();
  expect(outgoing).toEqual([]); expect(errors).toEqual([]);
});
