import { expect, test, type Page } from "@playwright/test";

test.setTimeout(150_000);

async function openNavigation(page: Page) {
  if (page.viewportSize()!.width < 980) {
    await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "navigation", exact: true })).toBeVisible();
  }
}

test("the sidebar area switcher narrows the tree, keeps favorites and follows the page", async ({ page }) => {
  await page.goto("/demo/app");
  await openNavigation(page);
  const areas = page.getByRole("radiogroup", { name: "Workspace area", exact: true });
  await expect(areas.getByRole("radio", { name: "All", exact: true })).toHaveAttribute("aria-checked", "true");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByRole("button", { name: "Meetings", exact: true })).toHaveCount(1);

  // Finance: goes to the Financials overview; governance sections are hidden,
  // finance pages read as a flat list, favorites stay.
  await areas.getByRole("radio", { name: "Finance", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/app\/financials$/);
  await openNavigation(page);
  await expect(areas.getByRole("radio", { name: "Finance", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(sidebar.getByRole("button", { name: "Meetings", exact: true })).toHaveCount(0);
  await expect(sidebar.locator(".sidebar__nav").getByText("Reconciliation", { exact: true })).toBeVisible();
  await expect(sidebar.locator("[data-pinned]").first()).toBeVisible();

  // Governance from a finance page returns to the dashboard.
  await areas.getByRole("radio", { name: "Governance", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/app$/);
  await openNavigation(page);
  await expect(sidebar.getByRole("button", { name: "Meetings", exact: true })).toHaveCount(1);
  await expect(sidebar.locator(".sidebar__nav").getByText("Reconciliation", { exact: true })).toHaveCount(0);
  if (page.viewportSize()!.width < 980) await page.keyboard.press("Escape");

  // Opening a finance page (g then f) while in Governance follows into Finance.
  await page.locator("h1").first().click();
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await expect(page).toHaveURL(/\/demo\/app\/financials$/);
  await openNavigation(page);
  await expect(areas.getByRole("radio", { name: "Finance", exact: true })).toHaveAttribute("aria-checked", "true");
  if (page.viewportSize()!.width < 980) await page.keyboard.press("Escape");

  // g then a shows every area again.
  await page.locator("h1").first().click();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await openNavigation(page);
  await expect(areas.getByRole("radio", { name: "All", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("the command palette switches area", async ({ page }) => {
  await page.goto("/demo/app/meetings");
  await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("kbar:open")));
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("combobox").fill("Switch to Finance");
  await palette.getByRole("option", { name: /^Switch to Finance/ }).first().click();
  await expect(page).toHaveURL(/\/demo\/app\/financials$/);
  await openNavigation(page);
  await expect(page.getByRole("radio", { name: "Finance", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("the cash-flow Sankey reads by hover, selection and table", async ({ page }) => {
  await page.goto("/demo/app/financials");
  const card = page.locator(".cash-flow-sankey");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.scrollIntoViewIfNeeded();
  if (page.viewportSize()!.width >= 980) {
    await card.locator(".sankey__node.is-selectable .sankey__bar").first().hover({ force: true });
    await expect(card.locator(".chart-tooltip")).toContainText("of money in");
    await card.locator(".sankey__node.is-selectable .sankey__bar").first().click({ force: true });
  } else {
    await card.locator(".sankey-bars__row").first().click();
  }
  await expect(card.locator(".cash-flow-sankey__focus")).toContainText("transactions");
  await card.getByRole("button", { name: /^Clear / }).click();
  await expect(card.locator(".cash-flow-sankey__focus")).toHaveCount(0);
  await card.getByRole("button", { name: "View as table", exact: true }).click();
  await expect(card.getByRole("columnheader", { name: "Net amount", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
