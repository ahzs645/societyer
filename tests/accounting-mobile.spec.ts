import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test.describe("accounting responsive layout", () => {
  test("keeps the ledger tools in the header's New and More menus on mobile", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/demo/app/financials/accounting", { waitUntil: "networkidle" });

    // Entries live in one "+ New" menu; setup tools sit behind "⋯ More".
    await page.getByRole("button", { name: "New", exact: true }).click();
    for (const name of ["Journal entry", "Allocate imported transaction", "Ledger reconciliation"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    for (const name of ["Set up standard chart of accounts", "Add fiscal period", "Opening balances", "Post bank transactions to journal", "Bank reconciliation"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // The reconciliation background moved behind the header's ⓘ.
    await page.getByRole("button", { name: "About Accounting", exact: true }).click();
    await expect(page.getByText("ledger reconciliation here checks the journal against a statement balance", { exact: false })).toBeVisible();

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  });

  test("keeps a compact desktop header with no row of tool buttons", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/demo/app/financials/accounting", { waitUntil: "networkidle" });

    await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Accounting tools" })).toHaveCount(0);
    await expect(page.getByText("Balance sheet as at", { exact: false }).first()).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  });
});
