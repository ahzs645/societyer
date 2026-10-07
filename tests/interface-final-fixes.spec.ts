import { expect, test } from "@playwright/test";

/**
 * Final re-test fixes exercised in the demo runtime (synthetic data only).
 */

test("the policies register fits the window with its status visible (X-02)", async ({ page }) => {
  await page.goto("/demo/app/policies");
  const table = page.locator("table.policies-table");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const overflow = await page.evaluate(() => {
    const wrap = document.querySelector(".policies-table")?.closest(".table-wrap") as HTMLElement | null;
    return { wrap: wrap ? wrap.scrollWidth - wrap.clientWidth : 0, page: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(overflow.page, "no page-level horizontal scroll").toBeLessThanOrEqual(1);
  const viewport = page.viewportSize()!;
  if (viewport.width >= 1280) {
    expect(overflow.wrap, "no horizontal scroll inside the register at desktop width").toBeLessThanOrEqual(1);
    const status = table.locator("thead th", { hasText: /^Status$/ });
    await expect(status).toBeInViewport();
    await expect(table.locator("tbody tr").first().locator("td[data-label='Status'] .badge").first()).toBeInViewport();
  }
});

test("a missing record shows a readable error with Retry instead of loading forever (P-O2)", async ({ page }) => {
  await page.goto("/demo/app/people-directory/synthetic_missing_person");
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load this page" });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert).toContainText("could not be found");
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this page" })).toBeVisible({ timeout: 20_000 });
  // Moving to another page clears the boundary.
  await page.getByRole("alert").getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this page" })).toHaveCount(0);
  // A page with its own not-found state keeps it.
  await page.goto("/demo/app/documents/synthetic_missing_document");
  await expect(page.getByText("Document not found")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this page" })).toHaveCount(0);
});
