import { expect, test } from "@playwright/test";

// Two cold development routes plus an actual document export and drawer.
test.setTimeout(90_000);

test("local filing preparation exposes real form values and manual submission handoffs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo/app/filings/prefill");
  await expect(page.getByRole("heading", { name: "BC Societies Annual Report", exact: true })).toBeVisible();
  await expect(page.locator("pre")).toContainText("Riverside Community Society");
  await expect(page.getByRole("button", { name: "Copy JSON", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export .docx", exact: true })).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .docx", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("prefill-AnnualReport.docx");
  await expect(page.getByRole("link", { name: "Filing checklist and evidence", exact: true })).toHaveAttribute("href", "/demo/app/filings");
  await expect(page.getByRole("link", { name: "BC Registry", exact: true })).toHaveAttribute("href", /bcregistry/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto("/demo/app/filings");
  const prepare = page.getByRole("button", { name: "Prepare", exact: true });
  await prepare.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("pre")).toContainText("BC-Societies");
  await expect(dialog.getByRole("button", { name: "Prepare filing", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("requires a connected server");
  expect(errors).toEqual([]);
});

test("local grant discovery reports its server requirement and keeps manual opportunities editable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo/app/grants/sources");
  await expect(page.getByText("Feed discovery needs a connected server; add opportunities manually.", { exact: true })).toBeVisible();
  const select = page.getByLabel("Grant discovery source", { exact: true });
  if (await select.count()) {
    const available = await select.locator("option").nth(1).getAttribute("value");
    if (available) await select.selectOption(available);
    await expect(page.getByRole("button", { name: "Discover", exact: true })).toBeDisabled();
  }
  await page.getByRole("button", { name: "Add opportunity", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
