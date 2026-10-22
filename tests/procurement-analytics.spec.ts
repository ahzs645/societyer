import { test, expect } from "@playwright/test";

test("hosted summary views render without downloading whole lists or review histories", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [view, heading] of [["overview", "Overview"], ["trends", "Trends"], ["compare", "Period comparison"], ["buyers", "Buyers"], ["suppliers", "Suppliers"], ["sizes", "Award sizes"], ["mix", "Procurement mix"], ["quality", "Data quality"], ["opportunities", "Opportunities"], ["decisions", "Decision insights"]]) {
    await page.goto(`/tests/fixtures/procurement-analytics.html?section=analytics&analysis=${view}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText("Load detailed analytics", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  }
  await page.goto("/tests/fixtures/procurement-analytics.html?section=analytics&analysis=overview");
  await expect(page.getByText("65 awards included", { exact: false })).toBeVisible();
  await page.screenshot({ path: `tmp/procurement-browser-results/${info.project.name}-overview.png`, fullPage: true });
});

test("party directory requests bounded pages and searches every party", async ({ page }) => {
  await page.goto("/tests/fixtures/procurement-analytics.html?section=analytics&analysis=suppliers");
  await expect(page.getByRole("heading", { name: "Supplier directory" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/rankpage=50/);
  await expect(page.getByText("51–65 of 65 matching", { exact: false })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search suppliers" }).fill("Supplier 64");
  await expect(page.getByText("1–1 of 1 matching", { exact: false })).toBeVisible();
  const requests = await page.evaluate(() => (window as any).__analysisRequests);
  expect(requests.some((request: any) => request.offset === 50)).toBe(true);
  expect(requests.at(-1).search).toBe("Supplier 64");
});

test("filters and quality show their inclusion rules", async ({ page }) => {
  await page.goto("/tests/fixtures/procurement-analytics.html?section=analytics");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await page.getByLabel("Include placeholder suppliers").check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/placeholders=1/);
  await page.goto("/tests/fixtures/procurement-analytics.html?section=analytics&analysis=quality");
  await expect(page.getByText("Unavailable inputs are not counted as confirmed missing fields.", { exact: false })).toBeVisible();
  expect(await page.locator("body").evaluate(body => body.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
