import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test.describe("accounting responsive layout", () => {
  test("uses a compact, touch-friendly command grid on mobile", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/demo/app/financials/accounting", { waitUntil: "networkidle" });

    const tools = page.getByRole("group", { name: "Accounting tools" });
    await expect(tools).toBeVisible();
    await expect(page.getByText("Set up, post, and reconcile the ledger.")).toBeVisible();
    await expect(page.getByText("How reconciliation works")).toBeVisible();
    await expect(page.locator(".accounting-reconciliation-note")).not.toHaveAttribute("open", "");

    const layout = await tools.evaluate((element) => {
      const actions = Array.from(element.querySelectorAll<HTMLElement>(".btn-action"));
      const firstRowTop = actions[0]?.getBoundingClientRect().top;
      return {
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
        actionCount: actions.length,
        firstRowCount: actions.filter((action) => action.getBoundingClientRect().top === firstRowTop).length,
        minActionHeight: Math.min(...actions.map((action) => action.getBoundingClientRect().height)),
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(layout).toMatchObject({
      columns: 2,
      actionCount: 8,
      firstRowCount: 2,
      pageOverflows: false,
    });
    expect(layout.minActionHeight).toBeGreaterThanOrEqual(42);
  });

  test("keeps the compact desktop toolbar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/demo/app/financials/accounting", { waitUntil: "networkidle" });

    const tools = page.getByRole("group", { name: "Accounting tools" });
    const layout = await tools.evaluate((element) => {
      const actions = Array.from(element.querySelectorAll<HTMLElement>(".btn-action"));
      return {
        display: getComputedStyle(element).display,
        rows: new Set(actions.map((action) => action.getBoundingClientRect().top)).size,
      };
    });
    await expect(page.getByText("Set up, post, and reconcile the ledger.")).toBeHidden();
    expect(layout).toEqual({ display: "flex", rows: 1 });
  });
});
