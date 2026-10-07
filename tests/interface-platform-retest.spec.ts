import { expect, test } from "@playwright/test";

/**
 * Platform/shell re-test fixes, exercised in the demo runtime:
 * typed dates, page titles, translated headings, module gate link,
 * described sidebar counts and the stacked minute-book table on phones.
 */

test("the date picker takes a typed date and refuses an ambiguous one", async ({ page }) => {
  await page.goto("/demo/app/deadlines");
  await page.getByRole("button", { name: "New deadline" }).first().click();
  const trigger = page.locator(".date-trigger").first();
  await trigger.click();
  const typed = page.getByLabel("Type a date");
  await typed.fill("03/04/2012");
  await typed.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Day/month order is ambiguous" })).toBeVisible();
  await typed.fill("4 March 2012");
  await typed.press("Enter");
  await expect(page.locator(".calendar")).toHaveCount(0);
  await expect(trigger).toContainText("2012");
  await expect(trigger).toBeFocused();
});

test("the date-and-time picker takes a typed date for an old meeting", async ({ page }) => {
  await page.goto("/demo/app/meetings");
  await page.getByRole("button", { name: /^New meeting/ }).first().click();
  // The picker opens its own dialog, so hold the trigger itself.
  const trigger = page.getByRole("button", { name: "Scheduled" }).first();
  await trigger.click();
  const typed = page.getByLabel("Type a date");
  await typed.fill("4 March 2008");
  await typed.press("Enter");
  await expect(trigger).toContainText("2008");
});

test("the sidebar meeting count follows a new meeting without a reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the desktop sidebar shows the counts inline");
  await page.goto("/demo/app/meetings");
  const badge = page.locator(".sidebar .sidebar__item", { hasText: "Meetings" }).locator(".sidebar__count").first();
  const before = Number((await badge.getAttribute("title"))?.match(/\d+/)?.[0] ?? 0);
  await page.getByRole("button", { name: /^New meeting/ }).first().click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel(/^Title/).first().fill("Synthetic count meeting");
  await dialog.getByRole("button", { name: /^Schedule/ }).last().click();
  await expect(badge).toHaveAttribute("title", `${before + 1} meetings this year`);
});

test("pages name the browser tab and follow the interface language", async ({ page }) => {
  await page.goto("/demo/app/members");
  await expect(page).toHaveTitle("Members · Societyer");
  await page.goto("/demo/app/settings");
  await expect(page).toHaveTitle("Settings · Societyer");
});

test("French headings match the sidebar", async ({ browser }) => {
  const context = await browser.newContext({ locale: "fr-FR" });
  const page = await context.newPage();
  await page.goto("/demo/app");
  await expect(page.locator("h1").first()).toHaveText("Tableau de bord");
  await expect(page).toHaveTitle("Tableau de bord · Societyer");
  await page.goto("/demo/app/settings?tab=modules");
  await expect(page.getByText("Gestion des subventions").first()).toBeVisible();
  await context.close();
});

test("sidebar counts carry a description", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the desktop sidebar shows the counts inline");
  await page.goto("/demo/app");
  await expect(page.locator(".sidebar__count[title$='active members']").first()).toBeVisible();
});

test("the minute book's connected records stack inside a phone screen", async ({ page }, testInfo) => {
  test.skip(!["phone", "narrow-phone"].includes(testInfo.project.name), "phone layout only");
  await page.goto("/demo/app/minute-book");
  await expect(page.locator(".table--stack-mobile").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
