import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function select(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function createInvoice(page: Page, name: string, currency = "CAD") {
  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  if (currency !== "CAD") await select(page, form, "Currency", currency);
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(name);
  await page.getByRole("option", { name: `Bill “${name}” once` }).click();
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill("Browser money service");
  await form.locator(".line-editor__field--price input").first().fill(currency === "CAD" ? "105.00" : "100.00");
  return form;
}

async function issueAndOpen(page: Page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  const id = new URL(page.url()).searchParams.get("builder")!;
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page.locator(".invoice-builder")).not.toBeVisible();
  await page.goto(`/app/invoices?invoice=${encodeURIComponent(id)}`);
  const drawer = page.getByRole("dialog").last();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("In the books");
  return { id, drawer };
}

async function pay(page: Page, drawer: Locator, amount: string, reference: string, fx?: { rate: string; source: string }) {
  await drawer.getByRole("button", { name: "Record payment", exact: true }).click();
  const form = drawer.getByRole("form", { name: /^Record a payment for/ });
  await form.getByLabel("Amount", { exact: true }).fill(amount);
  await form.getByLabel("Reference", { exact: true }).fill(reference);
  if (fx) {
    await form.getByLabel("1 USD in CAD", { exact: true }).fill(fx.rate);
    await form.getByLabel("Settlement FX source", { exact: true }).fill(fx.source);
  }
  const noLink = form.getByRole("button", { name: "Don't link", exact: true });
  if (await noLink.isVisible()) await noLink.click();
  await form.locator("button[type=submit]").click();
  await expect(form).not.toBeVisible();
  await expect(drawer.locator(".invoice-payments__row").filter({ hasText: reference })).toBeVisible();
}

async function invoiceSnapshot(page: Page, id: string) {
  return page.evaluate(async (invoiceId) => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    const societies = await client.query("society:list", {});
    const workspace = await client.query("invoices:workspace", { societyId: societies[0]._id });
    const invoice = workspace.invoices.find((row: any) => row._id === invoiceId);
    const journalIds = [...new Set([
      invoice.journalEntryId,
      ...invoice.payments.flatMap((payment: any) => [payment.journalEntryId, payment.cashBasisEntryId, payment.reversalJournalEntryId, payment.reversalCashBasisEntryId]),
      ...(invoice.fxRevaluations ?? []).flatMap((mark: any) => [mark.journalEntryId, mark.reversalJournalEntryId]),
    ].filter(Boolean))];
    const entries = await Promise.all(journalIds.map((entryId) => client.query("accounting:journalEntry", { id: entryId })));
    return { invoice, entries };
  }, id);
}

function assertBalanced(entries: any[]) {
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.entry?.status ?? entry.status).toBe("posted");
    const lines = entry.lines ?? entry.entry?.lines ?? [];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.reduce((sum: number, line: any) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0)).toBe(0);
  }
}

async function downloadPdf(page: Page, drawer: Locator, name: string) {
  await drawer.getByRole("button", { name: /More actions for/ }).click();
  const ready = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("menuitem", { name: "Download PDF", exact: true }).click();
  const download = await ready;
  const path = `/workspace/scratch/invoice-money-browser/${name}.pdf`;
  await download.saveAs(path);
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true, disableFontFace: true }).promise;
  const text: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) text.push((await (await pdf.getPage(pageNumber)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
  await pdf.destroy();
  return text.join(" ").replace(/\s+/g, " ");
}

test("inclusive tax, shipping, withholding and audited settlement adjustments persist through UI and PDF", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const form = await createInvoice(page, `Native money customer ${Date.now()}`);
  const charges = form.getByRole("region", { name: "Tax, shipping, withholding and exchange rate", exact: true });
  await select(page, charges, "Rates include tax", "Tax inclusive — extract tax");
  await select(page, form, "Tax for line 1", "GST 5%");
  await charges.getByLabel("Shipping amount", { exact: true }).fill("10.50");
  await charges.getByLabel("Shipping tax percent", { exact: true }).fill("5");
  await charges.getByLabel("Shipping tax label", { exact: true }).fill("GST");
  await charges.getByLabel("Withholding value", { exact: true }).fill("5.00");
  const { id, drawer } = await issueAndOpen(page);
  const figures = drawer.locator(".invoice-drawer__figures");
  await expect(figures).toContainText("$110.50");
  await pay(page, drawer, "50.00", "MONEY-PAY-001");

  const adjustments = drawer.getByRole("region", { name: "Credits, write-offs, refunds and FX", exact: true });
  await adjustments.getByText("Credits, write-offs and refunds", { exact: true }).click();
  const adjustment = adjustments.locator("form");
  await adjustment.getByLabel("Amount (CAD)", { exact: true }).fill("10.00");
  await adjustment.getByLabel("Reference", { exact: true }).fill("MONEY-CREDIT-001");
  await adjustment.getByLabel("Reason", { exact: true }).fill("Browser service correction credit");
  await adjustment.getByRole("button", { name: "Record adjustment", exact: true }).click();
  await expect(drawer.locator(".invoice-payments__row").filter({ hasText: "MONEY-CREDIT-001" })).toContainText("Credit note");
  await select(page, adjustment, "Adjustment type", "Record cash refund");
  await adjustment.getByLabel("Original cash payment", { exact: true }).click();
  await page.getByRole("option", { name: /\$50\.00/ }).click();
  await adjustment.getByLabel("Amount (CAD)", { exact: true }).fill("10.00");
  await adjustment.getByLabel("Reference", { exact: true }).fill("MONEY-REFUND-001");
  await adjustment.getByLabel("Reason", { exact: true }).fill("Browser cash returned against original payment");
  await adjustment.getByRole("button", { name: "Record adjustment", exact: true }).click();
  await expect(drawer.locator(".invoice-payments__row").filter({ hasText: "MONEY-REFUND-001" })).toContainText("Refund");
  await expect(figures).toContainText("$60.50");
  await select(page, adjustment, "Adjustment type", "Write off balance");
  await adjustment.getByLabel("Amount (CAD)", { exact: true }).fill("60.50");
  await adjustment.getByLabel("Reference", { exact: true }).fill("MONEY-WRITEOFF-001");
  await adjustment.getByLabel("Reason", { exact: true }).fill("Browser approved remaining balance write-off");
  await adjustment.getByRole("button", { name: "Record adjustment", exact: true }).click();
  const writtenOff = drawer.locator(".invoice-payments__row").filter({ hasText: "MONEY-WRITEOFF-001" });
  await expect(writtenOff).toContainText("Write-off");
  await expect(figures).toContainText("$0.00");
  const settled = await invoiceSnapshot(page, id);
  expect(settled.invoice.totalCents).toBe(11050);
  expect(settled.invoice.balanceCents).toBe(0);
  expect(settled.invoice).toMatchObject({ cashPaidCents: 5000, creditCents: 1000, writeOffCents: 6050, refundCents: 1000, settledCents: 11050 });
  assertBalanced(settled.entries);
  const pdf = await downloadPdf(page, drawer, "inclusive-adjustments");
  for (const text of ["Shipping", "Withholding", "Credits applied", "Write-off", "$110.50", "$60.50"]) expect(pdf).toContain(text);

  await writtenOff.getByRole("button", { name: /^Remove the/ }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Record reversal", exact: true }).click();
  await expect(writtenOff).toContainText("reversed");
  await page.reload();
  const restored = page.getByRole("dialog").last();
  await expect(restored.locator(".invoice-drawer__figures")).toContainText("$60.50");
  await expect(restored.locator(".invoice-payments__row")).toHaveCount(4);
  await expect(restored.locator(".invoice-payments__row").filter({ hasText: "MONEY-WRITEOFF-001" })).toContainText("reversed");
  await expect(restored.getByRole("button", { name: /Preview receipt for payment/ })).toHaveCount(1);
  const persisted = await invoiceSnapshot(page, id);
  expect(persisted.invoice.money).toMatchObject({ taxMode: "inclusive", shipping: { amountCents: 1050, taxRatePercent: 5 }, withholding: { kind: "amount", value: 500 } });
  expect(persisted.invoice.balanceCents).toBe(6050);
  assertBalanced(persisted.entries);
  expect(errors).toEqual([]);
});

test("explicit invoice and settlement FX quotes, revaluation reversals and PDF currency survive reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const form = await createInvoice(page, `Foreign money customer ${Date.now()}`, "USD");
  await form.getByLabel("Invoice exchange rate", { exact: true }).fill("1.3");
  await form.getByLabel("Rate source", { exact: true }).fill("Browser agreed CAD contract quote");
  await form.getByLabel("Quote reference", { exact: true }).fill("FX-BROWSER-INVOICE-001");
  const { id, drawer } = await issueAndOpen(page);
  await pay(page, drawer, "40.00", "FX-BROWSER-PAY-001", { rate: "1.4", source: "Browser actual bank settlement quote" });
  const adjustments = drawer.getByRole("region", { name: "Credits, write-offs, refunds and FX", exact: true });
  await adjustments.getByText("Period-end FX revaluation", { exact: true }).click();
  const revaluation = adjustments.locator("details").filter({ hasText: "Period-end FX revaluation" });
  await revaluation.getByLabel("1 USD in CAD", { exact: true }).fill("1.5");
  await revaluation.getByLabel("Revaluation rate source", { exact: true }).fill("Browser period-end closing quote");
  await revaluation.getByRole("button", { name: "Record revaluation", exact: true }).click();
  await expect(revaluation).toContainText("$12.00");
  let snapshot = await invoiceSnapshot(page, id);
  expect(snapshot.invoice.money.fx).toMatchObject({ rateMicros: 1300000, baseCurrency: "CAD", source: "Browser agreed CAD contract quote" });
  expect(snapshot.invoice.payments[0]).toMatchObject({ amountCents: 4000, fxRateMicros: 1400000, baseAmountCents: 5600, bookValueCents: 5200, fxGainLossCents: 400 });
  expect(snapshot.invoice.fxRevaluations[0]).toMatchObject({ adjustmentCents: 1200, baseBalanceCents: 9000, invoiceBalanceCents: 6000 });
  assertBalanced(snapshot.entries);
  await pay(page, drawer, "60.00", "FX-BROWSER-PAY-002", { rate: "1.2", source: "Browser final bank settlement quote" });
  await expect(revaluation).toContainText("reversed");
  await expect(drawer.locator(".invoice-drawer__figures")).toContainText("$0.00");
  await page.reload();
  const persisted = page.getByRole("dialog").last();
  await expect(persisted).toContainText("Paid");
  await expect(persisted.locator(".invoice-payments__row")).toHaveCount(2);
  snapshot = await invoiceSnapshot(page, id);
  expect(snapshot.invoice.balanceCents).toBe(0);
  expect(snapshot.invoice.payments[1]).toMatchObject({ amountCents: 6000, fxRateMicros: 1200000, baseAmountCents: 7200, bookValueCents: 7800, fxGainLossCents: -600 });
  expect(snapshot.invoice.fxRevaluations[0].reversedDate).toBeTruthy();
  assertBalanced(snapshot.entries);
  const pdf = await downloadPdf(page, persisted, "explicit-fx-settlement");
  for (const text of ["USD", "Browser money service", "$100.00", "$0.00"]) expect(pdf).toContain(text);
  await persisted.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Invoice exchange rate", { exact: true })).toHaveValue("1.3");
  await expect(page.getByLabel("Invoice exchange rate", { exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("recurring builder and series controls configure a real paused delivery schedule", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const name = `Recurring delivery customer ${Date.now()}`;
  const form = await createInvoice(page, name);
  await form.getByText("Make this a recurring series", { exact: true }).click();
  await expect(form.getByRole("switch", { name: "Make this a recurring series", exact: true })).toBeChecked();
  await expect(form).toContainText("New delivery schedules start paused");
  await expect(form.getByRole("checkbox", { name: "Send automatically once email sending is connected", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  const invoiceId = new URL(page.url()).searchParams.get("builder")!;
  const snapshot = await invoiceSnapshot(page, invoiceId);
  const seriesId = snapshot.invoice.seriesId;
  expect(seriesId).toBeTruthy();
  await page.getByRole("button", { name: "Configure automatic delivery", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Configure automatic delivery", exact: true });
  await expect(dialog.getByLabel("Schedule source", { exact: true })).toHaveValue(seriesId);
  await expect(dialog.getByLabel("Automation type", { exact: true })).toHaveValue("recurring_invoice");
  await expect(dialog.getByRole("checkbox", { name: "Enable this schedule", exact: true })).not.toBeChecked();
  await dialog.getByRole("textbox", { name: "Schedule name", exact: true }).fill(`${name} PDF delivery`);
  await dialog.getByRole("textbox", { name: "Schedule recipients", exact: true }).fill("recurring-browser@example.test");
  await dialog.getByRole("button", { name: "Save delivery schedule", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/app/invoices?tab=recurring");
  const card = page.locator(".series-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Configure automatic delivery", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Configure automatic delivery", exact: true });
  await expect(dialog.getByLabel("Schedule source", { exact: true })).toHaveValue(seriesId);
  await expect(dialog.getByRole("textbox", { name: "Schedule name", exact: true })).toHaveValue(`${name} PDF delivery`);
  await expect(dialog.getByRole("textbox", { name: "Schedule recipients", exact: true })).toHaveValue("recurring-browser@example.test");
  await expect(dialog.getByRole("checkbox", { name: "Enable this schedule", exact: true })).not.toBeChecked();
  await dialog.getByRole("textbox", { name: "Delivery timezone", exact: true }).fill("UTC");
  await dialog.getByRole("button", { name: "Save delivery schedule", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const stored = await page.evaluate(async sourceId => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    const societyId = (await client.query("society:list", {}))[0]._id;
    const automation = await client.query("billingAutomation:workspace", { societyId });
    const invoices = await client.query("invoices:workspace", { societyId });
    return { schedules: automation.schedules.filter((row: any) => row.sourceId === sourceId), series: invoices.series.find((row: any) => row._id === sourceId) };
  }, seriesId);
  expect(stored.schedules).toHaveLength(1);
  expect(stored.schedules[0]).toMatchObject({ kind: "recurring_invoice", sourceId: seriesId, active: false, timezone: "UTC", recipients: ["recurring-browser@example.test"] });
  expect(stored.series.autoSend).toBe(false);
  expect(errors).toEqual([]);
});
