import { test, expect } from "@playwright/test";

function monitor(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}
async function fitsPage(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator(".page").last().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test("notification settings: switches persist, mute the inbox, and thresholds read as sentences", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = monitor(page);
  await page.goto("/demo/app/notifications");
  // The in-browser workspace runs the alert scan on load: the seeded thresholds
  // raise budget alerts from the demo books.
  await expect(page.getByText(/passed 90% of budget|is over budget/).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page).toHaveURL(/tab=settings/);
  await expect(page.getByRole("heading", { name: "What you hear about", exact: true })).toBeVisible();
  // Seeded switches: the owner turned on deadline texts.
  await expect(page.getByRole("switch", { name: "Deadlines: Text", exact: true })).toHaveAttribute("aria-checked", "true");

  const budgetInApp = page.getByRole("switch", { name: "Budget alerts: In app", exact: true });
  await expect(budgetInApp).toHaveAttribute("aria-checked", "true");
  await budgetInApp.click();
  await expect(budgetInApp).toHaveAttribute("aria-checked", "false");
  await page.getByRole("tab", { name: /Inbox/ }).click();
  await expect(page.getByText(/passed 90% of budget|is over budget/)).toHaveCount(0);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Budget alerts: In app", exact: true }).click();

  // Thresholds are sentences with inline fields and a live status line.
  const thresholds = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Alert thresholds", exact: true }) });
  await expect(thresholds.getByText("Alert when spending on a budget line passes", { exact: true })).toBeVisible();
  const budget = thresholds.getByRole("textbox", { name: "Budget threshold, percent of plan", exact: true });
  await budget.fill("400");
  await budget.press("Enter");
  await expect(thresholds.getByText("No budget line is at 400% yet.", { exact: true })).toBeVisible();
  await budget.fill("90");
  await budget.press("Enter");
  await expect(thresholds.getByText(/Right now \d+ lines? (is|are) at or past 90%/)).toBeVisible();

  const digests = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Digest emails", exact: true }) });
  await expect(digests.getByText("If your weekly summary went out now", { exact: true })).toBeVisible();
  await expect(digests.getByText(/transactions? needs? attention this fiscal year/)).toBeVisible();
  await fitsPage(page);
  expect(errors).toEqual([]);
});
