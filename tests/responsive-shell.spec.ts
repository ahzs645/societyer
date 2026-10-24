import { test, expect, type Page } from "@playwright/test";
import { PAYROLL_VIEWS } from "../src/features/payrollCalculation/payrollViewRegistry";

async function assertContained(page: Page, location: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    pages: [...document.querySelectorAll<HTMLElement>("[role=main] .page")].map(element => ({ width: element.clientWidth, scroll: element.scrollWidth })),
  }));
  expect(dimensions.document, `${location}: whole-page horizontal overflow ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, `${location}: body horizontal overflow ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  for (const size of dimensions.pages) expect(size.scroll, `${location}: page horizontal overflow ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(size.width + 1);
}

test("all payroll sections and connected finance pages fit the viewport and remain reachable", async ({ page, isMobile }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app/payroll/calculator");
  await expect(page.getByRole("heading", { name: "Payroll calculator", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", { name: "Synthetic responsive qualification", jurisdictionCode: "CA-BC", seedDocumentPackets: false, isCharity: false, isMemberFunded: false });
    const societyId = created.societyId;
    const users = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(users.find((row: any) => row.role === "Owner")._id);
  });
  await page.reload();
  const navigation = page.getByRole("navigation", { name: "Payroll calculator sections", exact: true });
  await expect(navigation.getByRole("button")).toHaveCount(PAYROLL_VIEWS.length);
  for (const view of PAYROLL_VIEWS) {
    console.info(`Checking payroll view ${view.id}`);
    const button = navigation.getByRole("button", { name: view.label, exact: true });
    if (isMobile) await button.tap(); else await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const content = page.locator(".payroll-calculator__view-section > div");
    await expect(content.locator(":scope > *").first()).toBeVisible();
    await expect(content).not.toContainText("Loading payroll view");
    await assertContained(page, `payroll:${view.id}`);
  }
  await page.screenshot({ path: testInfo.outputPath("payroll-workspace.png"), fullPage: true });

  for (const [path, heading] of [
    ["/app/financials/planning", "Semester cost planner"],
    ["/app/financials/reports/catalog", "Report catalog & designer"],
    ["/app/invoices", "Invoices"],
    ["/app/payroll", "Payroll"],
  ]) {
    console.info(`Checking finance route ${path}`);
    await page.goto(path);
    await expect(page.getByRole("main").getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await assertContained(page, path);
  }

  if (isMobile) {
    const more = page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true });
    await more.tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const finance = sheet.locator('a[href="/app/financials"]');
    if (!(await finance.isVisible())) {
      const filter = sheet.getByRole("textbox", { name: /Filter navigation/ });
      await filter.fill("Financials");
    }
    await finance.tap();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/app\/financials(?:\?|$)/);
    await assertContained(page, "mobile navigation");
  }
  expect(errors).toEqual([]);
});
