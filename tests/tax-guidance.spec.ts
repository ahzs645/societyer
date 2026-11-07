import { test, expect, type Locator, type Page } from "@playwright/test";

async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function ordinary(page: Page, guide: Locator) {
  await pick(page, guide, "Place of supply", "Canada · British Columbia");
  await pick(page, guide, "What are you supplying?", "Ordinary goods / equipment");
  await pick(page, guide, "What is the supplier's tax status?", "Nonprofit organization, not a registered charity");
  await pick(page, guide, "Does this fit an ordinary domestic B.C. supply?", "Yes — place, supplier and ordinary-rate scope confirmed");
  await pick(page, guide, "Does a specific GST/HST exception apply?", "No — ordinary taxable supply");
  await pick(page, guide, "May this supplier collect GST/HST?", "Registered for GST/HST");
  await pick(page, guide, "Does a specific B.C. PST exception apply?", "Use the category guidance");
  await pick(page, guide, "What is the supplier's PST collection position?", "Registered to collect PST");
}

test("catalog guidance persists; invoice assessment distinguishes exemptions and unsupported jurisdictions", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-06T20:00:00Z"));
  const name = `Synthetic tax item ${testInfo.project.name}`;
  await page.goto("/app/invoices?tab=catalog");
  await page.getByRole("button", { name: "New item", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name", { exact: true }).fill(name);
  await drawer.getByLabel(/^Unit price/).fill("100.00");
  await drawer.getByRole("button", { name: "Guide me through tax", exact: true }).click();
  let guide = drawer.getByRole("region", { name: "Tax decision guide" });
  await ordinary(page, guide);
  // The legacy demo claims charitable registration without reviewed evidence.
  // An ordinary supplier answer cannot silently bypass that organization fact.
  await expect(guide.getByTestId("tax-supplier-facts")).toContainText("claims charity registration");
  await expect(guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const organization: any = await client.query("society:get", {});
    await client.mutation("society:upsert", { id: organization._id, name: organization.name, isCharity: false, isMemberFunded: false, charityStatus: "not_applied" });
  });
  await expect(guide).not.toBeVisible();
  await drawer.getByRole("button", { name: "Guide me through tax", exact: true }).click();
  guide = drawer.getByRole("region", { name: "Tax decision guide" });
  await ordinary(page, guide);
  await expect(guide).toContainText("GST: 5%"); await expect(guide).toContainText("PST: 7%");
  await expect(guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true })).toBeEnabled();
  await guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true }).click();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText("GST: Taxable 5%; PST: Taxable 7%");

  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill("Synthetic customer");
  await page.getByRole("option", { name: /once/ }).click();
  await form.getByRole("button", { name: "From catalog", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
  const line = form.locator(".line-editor__row").first();
  await expect(line).toContainText("Tax assessment needs review");
  await line.getByRole("button", { name: "Review tax assessment", exact: true }).click();
  guide = line.getByRole("region", { name: "Tax decision guide" });
  await pick(page, guide, "Does this fit an ordinary domestic B.C. supply?", "Yes — place, supplier and ordinary-rate scope confirmed");
  await pick(page, guide, "Does this customer claim tax relief for this transaction?", "No customer-specific relief");
  // A context change while the guide is open must discard its unsaved answers.
  await form.getByRole("button", { name: /^Change who to bill/ }).click();
  await expect(guide).not.toBeVisible();
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill("Replacement synthetic customer");
  await page.getByRole("option", { name: /once/ }).click();
  await line.getByRole("button", { name: "Review tax assessment", exact: true }).click();
  guide = line.getByRole("region", { name: "Tax decision guide" });
  await expect(guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true })).toBeDisabled();
  await pick(page, guide, "Does this fit an ordinary domestic B.C. supply?", "Yes — place, supplier and ordinary-rate scope confirmed");
  await pick(page, guide, "Does this customer claim tax relief for this transaction?", "No customer-specific relief");
  await pick(page, guide, "Does a specific GST/HST exception apply?", "Zero-rated (taxable at 0%)");
  await expect(guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true })).toBeDisabled();
  await guide.getByLabel("GST/HST rule and supporting evidence", { exact: true }).fill("Synthetic review of a qualifying zero-rated supply");
  await pick(page, guide, "Does a specific B.C. PST exception apply?", "Specific product or service exemption");
  await guide.getByLabel("PST rule and supporting evidence", { exact: true }).fill("Synthetic review of a qualifying provincial exemption");
  await guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true }).click();
  await expect(line).toContainText("GST: Zero-rated; PST: Exempt");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("builder")).not.toBe("new");
  await page.reload();
  await expect(form.locator(".line-editor__row").first()).toContainText("GST: Zero-rated; PST: Exempt");

  await form.getByRole("button", { name: "Review tax assessment", exact: true }).click();
  guide = form.getByRole("region", { name: "Tax decision guide" });
  await pick(page, guide, "Place of supply", "Another province or country");
  await guide.getByLabel("Country / region code", { exact: true }).fill("US-WA");
  await expect(guide).toContainText("No reviewed tax rule pack");
  await expect(guide.getByRole("button", { name: "Confirm and apply tax treatment", exact: true })).toBeDisabled();
  await guide.getByRole("button", { name: "Keep for review", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(form).toContainText("Complete and confirm the tax assessment");
  await page.screenshot({ path: testInfo.outputPath("tax-assessment.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
