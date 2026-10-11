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

test("a missing record shows its not-found state, not the error boundary (P-O2, FF-2)", async ({ page }) => {
  // The person profile has its own not-found state; its merge history waits
  // for the profile instead of failing the page (FF-2).
  await page.goto("/demo/app/people-directory/synthetic_missing_person");
  await expect(page.getByText("Person not found in this workspace")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this page" })).toHaveCount(0);
  // A page with its own not-found state keeps it.
  await page.goto("/demo/app/documents/synthetic_missing_document");
  await expect(page.getByText("Document not found")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this page" })).toHaveCount(0);
});

test("a failed record query reaches the error boundary, and Retry recovers (P-O2)", async ({ page }) => {
  // Detail pages read their record with useRecordQuery (convex/react
  // useQueries), which re-creates its watch on every render. A failed local
  // query must stay failed through that churn so the page shows the error
  // instead of "Loading…" forever.
  await page.goto("/demo/app/goals");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const { localDataClient } = await import("/src/lib/localDataClient.ts" as string);
    const portable = (localDataClient as any).portable;
    const original = portable.runQueryTracked.bind(portable);
    (window as any).__restoreGoalQuery = () => { portable.runQueryTracked = original; };
    portable.runQueryTracked = (name: string, args: unknown) => (name === "goals:get" ? Promise.reject(new Error("Storage is unavailable")) : original(name, args));
    window.history.pushState({}, "", "/demo/app/goals/static_goal_agm");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const boundary = page.getByRole("alert").filter({ hasText: "Couldn't load this page" });
  await expect(boundary).toBeVisible({ timeout: 15_000 });
  await expect(boundary).toContainText("Storage is unavailable");
  await page.evaluate(() => (window as any).__restoreGoalQuery());
  await boundary.getByRole("button", { name: "Retry" }).click();
  await expect(boundary).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
