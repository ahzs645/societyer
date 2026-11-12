import { expect, test, type Page } from "@playwright/test";
import { RecordTablePage } from "./pom/recordTablePage";

/**
 * In-memory lists (RecordListTable) remember their last state per person and
 * browser, and page lists offer named views shared with the workspace
 * (listViews), chosen from the same views menu the object tables use.
 */
async function gotoInvoices(page: Page, search = "") {
  await page.goto(`/demo/app/invoices${search}`, { waitUntil: "networkidle" });
  await new RecordTablePage(page).expectTableOrEmptyState();
}

async function sortSecondColumnAscending(page: Page) {
  // The first column (Number) is the list's identifier; the second is Customer.
  await page.locator(".record-table__header-menu-trigger").nth(1).click();
  await page.locator(".record-table__header-menu").getByRole("button", { name: /A → Z/ }).click();
  await page.keyboard.press("Escape");
}

const rememberedKeys = (page: Page) =>
  page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("societyer:list-table:") && key.endsWith(":invoices")));

test.describe("list saved views", () => {
  test("a list comes back as it was left", async ({ page }) => {
    await gotoInvoices(page);
    const saveAs = page.getByRole("button", { name: /^Save as$/ });
    await expect(saveAs).toBeHidden();

    await sortSecondColumnAscending(page);
    await expect(saveAs).toBeVisible();
    await expect.poll(() => rememberedKeys(page)).toHaveLength(1);

    await page.reload({ waitUntil: "networkidle" });
    await new RecordTablePage(page).expectTableOrEmptyState();
    // The remembered sort is back, so the list still differs from its default view.
    await expect(saveAs).toBeVisible();

    // Choosing the default view again resets it, and the browser forgets the change.
    await page.locator(".record-table__view-button").click();
    await page.locator(".record-table__menu").getByRole("button", { name: /All invoices/ }).click();
    await expect(saveAs).toBeHidden();
    await expect.poll(() => rememberedKeys(page)).toHaveLength(0);
  });

  test("a named view is saved, linked, renamed and deleted", async ({ page }) => {
    await gotoInvoices(page);
    await sortSecondColumnAscending(page);

    await page.getByRole("button", { name: /^Save as$/ }).click();
    await page.getByPlaceholder("View name").fill("By customer");
    await page.getByRole("button", { name: "Save view" }).click();

    const viewButton = page.locator(".record-table__view-button");
    await expect(viewButton).toContainText("By customer");
    await expect(page).toHaveURL(/[?&]view=/);
    const link = new URL(page.url());

    // The link opens the view, even from a browser that remembers something else.
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("societyer:list-table:")) window.localStorage.removeItem(key);
    });
    await gotoInvoices(page, link.search);
    await expect(viewButton).toContainText("By customer");
    await expect(page.getByRole("button", { name: /^Save as$/ })).toBeHidden();

    await viewButton.click();
    await page.locator(".record-table__menu").getByRole("button", { name: /Rename view/ }).click();
    const name = page.getByPlaceholder("View name");
    await name.fill("Customers A to Z");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(viewButton).toContainText("Customers A to Z");

    await viewButton.click();
    await page.locator(".record-table__menu").getByRole("button", { name: /Delete view/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete view" }).click();
    await expect(viewButton).toContainText("All invoices");
    await expect(page).not.toHaveURL(/[?&]view=/);
  });
});
