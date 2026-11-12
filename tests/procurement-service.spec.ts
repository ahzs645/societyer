import { expect, test } from "@playwright/test";

test("service reader loads awards lazily, renders the complete list and reuses notice fetches", async ({ page, isMobile }) => {
  const failures: string[] = []; page.on("pageerror", error => failures.push(error.message));
  await page.goto("/tests/fixtures/procurement-service.html");
  await expect(page.getByText("Fictional road project", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__catalogRequests.some((path: string) => path.endsWith("/list/award.json")))).toBe(false);
  const start = Date.now();
  await page.getByRole("tab", { name: /Awards/ }).click();
  await expect(page.getByText("Synthetic award 0", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".record-table__view-count").first()).toHaveText("21877");
  console.log(`Synthetic 21,877-row list ready in ${Date.now() - start} ms (${test.info().project.name}); this is a local UI check, not a live network timing.`);
  if (!isMobile) await page.getByRole("button", { name: "Synthetic award 0", exact: true }).focus();
  // The list's own search also finds notices by their text: "zebra" is only in award 0's description.
  await page.getByRole("button", { name: /^Search awards/ }).click();
  await page.getByRole("textbox", { name: "Search awards" }).fill("zebra");
  await expect(page.getByText("Synthetic award 1", { exact: true })).toHaveCount(0);
  await page.getByText("Synthetic award 0", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Synthetic award 0", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__catalogRequests.filter((path: string) => { const url = new URL(path); return url.pathname.endsWith("/notice") && url.searchParams.get("key") === "award:00000"; }).length)).toBe(1);
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByText("Addendum 12.pdf", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("service analytics refresh at a deadline inside the same minute", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T12:00:10Z") });
  await page.goto("/tests/fixtures/procurement-service.html?section=analytics&analysis=opportunities&deadlineSoon=1");
  await expect(page.getByRole("heading", { name: "Opportunities", exact: true })).toBeVisible({ timeout: 20_000 });
  const before = await page.evaluate(() => (window as any).__analysisRequests.at(-1).asOf);
  await page.clock.runFor(6000);
  await expect.poll(() => page.evaluate(() => (window as any).__analysisRequests.at(-1).asOf)).toBeGreaterThan(before);
  const after = await page.evaluate(() => (window as any).__analysisRequests.at(-1).asOf);
  expect(Math.floor(after / 60_000)).toBe(Math.floor(before / 60_000));
});

test("buyer and issued-for pages render both lists on the catalog service", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  for (const [field, name] of [["buyer", "Example municipality"], ["issuedFor", "Example public agency"]]) {
    await page.goto(`/tests/fixtures/procurement-service.html?${new URLSearchParams({ [field]: name })}`);
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    // Overview, Opportunities and Awards are tabs; each list shows in its own panel.
    await page.getByRole("tab", { name: /^Opportunities/ }).click();
    await expect(page.getByRole("tabpanel", { name: "Opportunities" }).getByText("Fictional road project", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /^Awards/ }).click();
    await expect(page.getByRole("tabpanel", { name: "Awards" }).getByText("Synthetic award 0", { exact: true })).toBeVisible();
  }
  expect(failures).toEqual([]);
});

test("opportunity triage follows the notice layout and page overscroll is contained", async ({ page, isMobile }) => {
  await page.goto("/tests/fixtures/procurement-service.html?notice=opportunity%3Aroads&fixtureTriage=1");
  const triage = page.getByRole("region", { name: "Our bid triage" });
  await expect(triage).toBeVisible();
  const details = page.getByRole("complementary", { name: "Notice details" });
  if (isMobile) {
    await expect(details).toHaveCount(0);
    const card = await triage.boundingBox();
    const tabs = await page.getByRole("tablist").first().boundingBox();
    expect(card!.y + card!.height).toBeLessThanOrEqual(tabs!.y);
  } else {
    await expect(details.getByRole("region", { name: "Our bid triage" })).toBeVisible();
    await expect(triage).toHaveCSS("flex-direction", "column");
  }
  await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none");
  await expect(page.locator("main.page")).toHaveCSS("overscroll-behavior-y", "none");
});
