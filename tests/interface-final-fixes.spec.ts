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
