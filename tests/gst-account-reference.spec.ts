import { test, expect } from "@playwright/test";

test("organization GST account can be saved once and referenced while filing", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-08T20:00:00Z"));
  await page.goto("/app/society");
  await expect(page.getByTestId("gst-account-reference")).toBeVisible();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const organization: any = await client.query("society:get", {});
    const overview: any = await client.query("organizationDetails:overview", { societyId: organization._id });
    for (const identifier of overview.identifiers) {
      if (["gst", "business_number"].includes(identifier.kind)) await client.mutation("organizationDetails:removeIdentifier", { id: identifier._id });
    }
  });
  const card = page.getByTestId("gst-account-reference");
  await expect(card).toContainText("No GST/HST account is saved");
  await page.getByRole("button", { name: "Add GST/HST account", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Kind", { exact: true })).toContainText("GST/HST registration");
  await drawer.getByLabel("Number", { exact: true }).fill("123 456 789 rt 0001");
  await drawer.getByLabel("Status", { exact: true }).click();
  await page.getByRole("option", { name: "Active", exact: true }).click();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(card.getByRole("button", { name: "Copy organization GST/HST account 123456789RT0001", exact: true })).toBeVisible();
  await page.reload();
  await expect(card).toContainText("123456789RT0001");

  await page.goto("/app/filings");
  await page.getByRole("button", { name: "New filing", exact: true }).click();
  await drawer.getByLabel("Kind", { exact: true }).click();
  await page.getByRole("option", { name: "GST/HST return", exact: true }).click();
  await expect(drawer.getByTestId("gst-account-reference")).toContainText("123456789RT0001");
  await expect(drawer.getByTestId("gst-account-reference")).toContainText("Current organization account");
  await drawer.getByLabel("Period / label", { exact: true }).fill(`Synthetic GST ${testInfo.project.name}`);
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: `Synthetic GST ${testInfo.project.name}` });
  await row.getByRole("button", { name: "Mark filed", exact: true }).click();
  const filingModal = page.getByRole("dialog", { name: "Mark filing as filed", exact: true });
  await expect(filingModal.getByTestId("gst-account-reference")).toContainText("123456789RT0001");
  await expect(filingModal.getByTestId("gst-account-reference")).toContainText("does not change or verify a submitted return");
  await filingModal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/app/society#tax-identifiers");
  await expect(page.locator("#more-organization-details")).toHaveAttribute("open", "");
  await expect(page.locator("#tax-identifiers")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("organization-gst-account.png"), fullPage: true });
  expect(errors).toEqual([]);
});
