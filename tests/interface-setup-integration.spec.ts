import { expect, test, type Page } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

/**
 * Setup surfaces outside the setup view: the Dashboard summary card, the
 * shell's setup pill and the "Back to setup" bar. All three read the same
 * progress as `/app/organization-setup`.
 */

test.setTimeout(150_000);

const CBCA = { jurisdiction: "federal", act: "Canada Business Corporations Act" };

async function preparingCorporation(page: Page, name: string) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, name, false, CBCA);
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: "Something went wrong.", exact: true })).toHaveCount(0);
}

test("summary card, setup pill and the back-to-setup bar follow one setup checklist", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `Setup Surfaces ${info.project.name}`;
  await preparingCorporation(page, name);

  // Dashboard: one compact summary, worded for a corporation that doesn't exist yet.
  await page.goto("/app");
  const card = page.locator("[data-setup-summary]");
  await expect(card.getByRole("heading", { name: `Getting ${name} ready to incorporate`, exact: true })).toBeVisible();
  await expect(card).toContainText(/\d+ of \d+ done/);
  await expect(card).toContainText("Next:");
  await expect(card).not.toContainText("good standing");
  await expect(card.getByRole("link", { name: "Continue setup" })).toHaveAttribute("href", "/app/organization-setup");
  await expect(page.getByRole("heading", { name: "Continue organization setup", exact: true })).toHaveCount(0);
  await fits(page);

  // The pill counts the same steps and opens the setup view.
  await page.goto("/app/tasks");
  const pill = page.getByRole("button", { name: /^Setup: \d+ of \d+ done/ }).filter({ visible: true }).first();
  await expect(pill).toBeVisible();
  await pill.click();
  const popover = page.getByRole("dialog", { name: `Getting ${name} ready to incorporate`, exact: true });
  await expect(popover).toBeVisible();
  await expect(popover.locator('a[href*="setup=directors"]')).toHaveCount(1);
  await popover.getByRole("link", { name: "Open setup", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup$/);

  // A step link shows the way back, and notices when the step gets done.
  await page.goto("/app/role-holders?role=director&setup=directors");
  const bar = page.getByRole("region", { name: "Setup", exact: true });
  await expect(bar).toContainText("Back to setup");
  await expect(bar).toContainText("Name your first directors");
  await expect(bar).toContainText("Not done yet");
  if (info.project.name.includes("phone")) {
    // Slim, under the phone top bar, never on top of it.
    const [barBox, topBarBox] = await Promise.all([bar.boundingBox(), page.locator(".mobile-topbar").boundingBox()]);
    expect(barBox && topBarBox && barBox.y >= topBarBox.y + topBarBox.height - 1).toBe(true);
    expect(barBox!.height).toBeLessThanOrEqual(64);
  }
  await fits(page);
  // `?role=director` opens the add form with the role already chosen.
  const drawer = page.getByRole("dialog", { name: "New role holder", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Full name", { exact: true }).fill("Avery First Director");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(bar).toContainText(/Done\. Next: /);
  await expect(bar).not.toContainText("Not done yet");

  // Pages that drop the query string keep the bar for this tab.
  await page.goto("/app/tasks");
  await expect(bar).toContainText("Name your first directors");
  await bar.getByRole("link", { name: "Back to setup" }).click();
  await page.waitForURL(/\/app\/organization-setup#step-directors$/);
  await expect(bar).toHaveCount(0);
  await page.goto("/app/tasks");
  await expect(bar).toHaveCount(0);

  // Closing it keeps it closed, even with the step still in the address.
  await page.goto("/app/society?setup=office#registered-office");
  await expect(bar).toContainText("Add the registered office address");
  await bar.getByRole("button", { name: "Close the back to setup bar" }).click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(bar).toHaveCount(0);
  await fits(page);

  // Hiding the summary hides the pill too, and Undo brings both back.
  await page.goto("/app");
  await card.getByRole("button", { name: "Hide setup guide", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});
