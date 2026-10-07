import { expect, test, type Page } from "@playwright/test";

// Agreements register (A5): create → edit → renew → terminate, list filters and
// the phone layout, on the local runtime. Synthetic data only.

const iso = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function seed(page: Page) {
  await page.goto("/app", { waitUntil: "networkidle" });
  return page.evaluate(async ({ expiring, past }) => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", { name: "Agreements review society", jurisdictionCode: "CA-BC", entityType: "society" });
    setStoredSocietyId(societyId);
    await client.mutation("seedRecordTableMetadata:ensureForSociety", { societyId });
    await client.mutation("agreements:create", {
      societyId, title: "Synthetic storage licence", kind: "licence", status: "active",
      parties: [{ name: "Agreements review society", role: "us" }, { name: "Example Storage Ltd", role: "counterparty" }],
      effectiveDate: past, endDate: expiring, valueCents: 90000,
    });
    await client.mutation("agreements:create", {
      societyId, title: "Synthetic consulting draft", kind: "consulting", status: "draft", reviewStatus: "NeedsReview",
      parties: [{ name: "Example Advisors Inc", role: "counterparty" }],
    });
    return { societyId };
  }, { expiring: iso(40), past: iso(-200) });
}

async function pickDate(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).click();
  const typed = page.getByLabel("Type a date", { exact: true });
  await typed.fill(value);
  await typed.press("Enter");
}

test.describe.configure({ mode: "serial" });

test("create, edit, renew and terminate an agreement", async ({ page }) => {
  await seed(page);
  await page.goto("/app/agreements", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Agreements", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New agreement" }).click();
  const drawer = page.getByRole("dialog", { name: "New agreement" });
  await drawer.getByLabel("Title", { exact: true }).fill("Synthetic hall lease");
  await drawer.getByLabel("Party 2 name").fill("Example Hall Association");
  await drawer.getByLabel("Value", { exact: true }).fill("-5");
  await pickDate(page, "Effective date", iso(-100));
  await pickDate(page, "End date", iso(-200));
  await drawer.getByRole("button", { name: "Save agreement" }).click();
  await expect(drawer.getByText("The value cannot be negative.")).toBeVisible();
  await expect(drawer.getByText("The end date must be on or after the effective date.")).toBeVisible();
  await drawer.getByLabel("Party 2 name").fill("");
  await expect(drawer.getByText("Add at least one counterparty or funder.")).toBeVisible();
  await drawer.getByLabel("Party 2 name").fill("Example Hall Association");
  await drawer.getByLabel("Value", { exact: true }).fill("2400");
  await pickDate(page, "End date", iso(60));
  await drawer.getByLabel("Renewal notice (days)").fill("30");
  await drawer.getByRole("button", { name: "Add reporting obligation" }).click();
  await drawer.getByLabel("Report 1", { exact: true }).fill("Annual use report to the landlord");
  await drawer.getByRole("button", { name: "Save agreement" }).click();

  await expect(page).toHaveURL(/\/app\/agreements\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Synthetic hall lease", level: 1 })).toBeVisible();
  await expect(page.getByText("Agreement ends — Synthetic hall lease")).toBeVisible();
  await expect(page.getByText("Renewal notice due — Synthetic hall lease")).toBeVisible();
  const originalUrl = page.url();

  // Edit.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit agreement" });
  await edit.getByLabel("Title", { exact: true }).fill("Synthetic hall lease (amended)");
  await edit.getByRole("button", { name: "Save agreement" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic hall lease (amended)", level: 1 })).toBeVisible();
  await expect(page.getByText("$2,400").first()).toBeVisible();

  // Renew: a linked draft with the version chain.
  await page.getByRole("button", { name: "Renew", exact: true }).click();
  const renewal = page.getByRole("dialog", { name: "Renew for a new term" });
  await pickDate(page, "End date", iso(425));
  await renewal.getByRole("button", { name: "Create renewal" }).click();
  await expect(page).not.toHaveURL(originalUrl);
  await expect(page.getByText("Draft").first()).toBeVisible();
  await expect(page.getByText("· renewed by the next")).toBeVisible();

  // Terminate the original (confirmation names what is lost).
  await page.goto(originalUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Terminate", exact: true }).click();
  const terminate = page.getByRole("dialog", { name: "Terminate agreement" });
  await terminate.getByRole("button", { name: "Terminate" }).click();
  await expect(terminate.getByText("Give the termination date and the reason.")).toBeVisible();
  await terminate.getByLabel("Reason").fill("Ended by mutual agreement");
  await terminate.getByRole("button", { name: "Terminate" }).click();
  const confirm = page.getByRole("dialog", { name: "Terminate this agreement?" });
  await expect(confirm.getByText(/open deadline/)).toBeVisible();
  await confirm.getByRole("button", { name: "Terminate" }).click();
  await expect(page.getByText("Terminated").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Renew", exact: true })).toBeDisabled();
});

test("register filters and phone layout", async ({ page }) => {
  await seed(page);
  await page.goto("/app/agreements", { waitUntil: "networkidle" });
  const table = page.locator(".record-table, table").first();
  await expect(page.getByRole("link", { name: "Synthetic storage licence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic consulting draft" })).toBeVisible();
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(page.getByRole("link", { name: "Synthetic consulting draft" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic storage licence" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Expiring/ }).click();
  await expect(page.getByRole("link", { name: "Synthetic storage licence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic consulting draft" })).toHaveCount(0);
  await page.getByRole("button", { name: /^All \(\d+\)$/ }).click();
  await expect(table).toBeVisible();

  // Dashboard card.
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByTestId("agreements-expiring-card").getByText("Synthetic storage licence")).toBeVisible();

  // Phone: no horizontal page scroll on the list and the detail page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/agreements", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Agreements", level: 1 })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.getByRole("link", { name: "Synthetic storage licence" }).first().click();
  await expect(page.getByRole("heading", { name: "Synthetic storage licence", level: 1 })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
});

test("missing agreement shows a not-found page", async ({ page }) => {
  await seed(page);
  await page.goto("/app/agreements/agreements_missing_record", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /Agreement not found/i })).toBeVisible();
  await expect(page.getByTestId("record-not-found").getByRole("link", { name: "All agreements" })).toBeVisible();
});
