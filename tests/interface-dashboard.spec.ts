import { expect, test } from "@playwright/test";

test("all research collections filter and recover from an empty result", async ({ page }) => {
  await page.goto("/demo/app/research-library", { waitUntil: "domcontentloaded" });
  for (const name of ["Forms and templates", "Legal rule evidence", "Research findings", "Questions to confirm", "Source register", "Implementation status"]) {
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(page.locator(".page > p[aria-live]")).toHaveText(/\d+ of \d+ records/);
    await page.getByRole("searchbox").fill("no-matching-evidence-unique-92847");
    await expect(page.getByText("No records match these filters.", { exact: true })).toBeVisible();
    await expect(page.locator(".page > p[aria-live]")).toHaveText(/^0 of [1-9]\d* records$/);
    await page.getByRole("searchbox").clear();
    await expect(page.getByText("No records match these filters.", { exact: true })).toHaveCount(0);
  }
});

test("dashboard setup guide can be dismissed and restored with Undo", async ({ page }) => {
  await page.goto("/demo/app", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Hide setup guide", exact: true });
  // The seeded workspace deliberately retains incomplete setup checks.
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(dismiss).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dismiss).toBeVisible();
});
