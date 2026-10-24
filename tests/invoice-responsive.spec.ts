import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("invoice catalog, customer pricing, branded PDFs and linked payment persist across screen sizes", async ({ page, hasTouch }, info) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const suffix = info.project.name;
  const templateName = `Responsive workshop ${suffix}`;
  const itemName = `Precision brake service ${suffix}`;
  const customerName = `Responsive customer ${suffix}`;
  const priceListName = `Workshop hourly rates ${suffix}`;
  let touchEvents = 0;
  await page.exposeFunction("recordResponsiveTouch", () => { touchEvents++; });
  await page.addInitScript(() => document.addEventListener("touchstart", () => (window as any).recordResponsiveTouch(), { passive: true }));
  const activate = async (locator: Locator) => { if (hasTouch) await locator.tap(); else await locator.click(); };
  const fill = async (locator: Locator, value: string) => { await activate(locator); await locator.fill(value); };
  const pick = async (scope: Locator, label: string, value: string | RegExp) => {
    await activate(scope.getByLabel(label, { exact: true }));
    await activate(page.getByRole("option", { name: value, exact: true }));
  };
  const fit = async (checkpoint: string, scope?: Locator) => {
    const viewport = page.viewportSize()!;
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      pages: [...document.querySelectorAll<HTMLElement>(".page")].filter(element => element.getBoundingClientRect().width > 0).map(element => ({ className: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth })),
    }));
    expect(widths.client, `${checkpoint}: mobile layout viewport has not expanded beyond the device`).toBeLessThanOrEqual(viewport.width + 1);
    expect(widths.document, `${checkpoint}: no page-wide horizontal overflow`).toBeLessThanOrEqual(widths.client + 1);
    for (const surface of widths.pages) expect(surface.scrollWidth, `${checkpoint}: page content fits its own surface (${surface.className})`).toBeLessThanOrEqual(surface.width + 1);
    if (scope) {
      const box = await scope.boundingBox();
      expect(box, `${checkpoint}: form is rendered`).not.toBeNull();
      expect(box!.x, `${checkpoint}: left edge remains reachable`).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width, `${checkpoint}: right edge remains reachable`).toBeLessThanOrEqual(viewport.width + 1);
    }
  };
  const touchTableActions = async (row: Locator, checkpoint: string) => {
    if (!hasTouch) return;
    await row.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
    const surfaces = await row.evaluate(element => {
      const table = element.closest("table")!;
      const card = table.closest(".invoice-card")!;
      for (const surface of [table, card]) surface.scrollLeft = 0;
      return [table, card].map(surface => ({ className: surface.className, width: surface.clientWidth, scrollWidth: surface.scrollWidth }));
    });
    for (const surface of surfaces) expect(surface.scrollWidth, `${checkpoint}: phone card rows do not need a hidden nested horizontal scroll (${surface.className})`).toBeLessThanOrEqual(surface.width + 1);
    const box = (await row.boundingBox())!, viewport = page.viewportSize()!;
    const y = Math.max(150, Math.min(viewport.height - 120, box.y + box.height / 2));
    const start = Math.min(viewport.width - 24, box.x + box.width * 0.8), end = Math.max(24, box.x + box.width * 0.2);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y, id: 1 }] });
    for (let step = 1; step <= 5; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start + (end - start) * step / 5, y, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    for (const button of await row.getByRole("button").all()) {
      const reachable = await button.evaluate(element => {
        const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return rect.x >= 0 && rect.right <= window.innerWidth && rect.y >= 0 && rect.bottom <= window.innerHeight && Boolean(hit && element.contains(hit));
      });
      expect(reachable, `${checkpoint}: action remains physically reachable after a real touch pan without tap autoscrolling`).toBe(true);
    }
  };
  const downloadPdf = async (trigger: Locator, fileName: string) => {
    const ready = page.waitForEvent("download", { timeout: 90_000 });
    await activate(trigger);
    const download = await ready;
    const path = info.outputPath(fileName);
    await download.saveAs(path);
    const bytes = await readFile(path), document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    const searchable = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: true }).promise;
    const texts: string[] = [];
    for (let number = 1; number <= searchable.numPages; number++) texts.push((await (await searchable.getPage(number)).getTextContent()).items.map((item: any) => item.str ?? "").join(" "));
    await searchable.destroy();
    return texts.join(" ").replace(/\s+/g, " ");
  };

  await page.goto("/app/invoices?tab=templates");
  await activate(page.getByRole("button", { name: "Use ddcnorth brand", exact: true }));
  let drawer = page.getByRole("dialog").last();
  await fit("template designer", drawer);
  await fill(drawer.getByLabel("Template name", { exact: true }), templateName);
  await fill(drawer.getByLabel("Document title", { exact: true }), "Workshop service invoice");
  await fill(drawer.getByLabel("Receipt title", { exact: true }), "Workshop payment receipt");
  await fill(drawer.getByLabel("Rate column label", { exact: true }), "Hourly charge");
  await fill(drawer.getByLabel("Logo width (pt)", { exact: true }), "168");
  await pick(drawer, "Logo alignment", "Center");
  await fill(drawer.getByLabel("Footer", { exact: true }), "Warranty: responsive service record");
  const defaultCheck = drawer.getByRole("checkbox", { name: "Use for new invoices by default", exact: true });
  if (!await defaultCheck.isChecked()) await activate(drawer.getByText("Use for new invoices by default", { exact: true }));
  const sampleText = await downloadPdf(drawer.getByRole("button", { name: "Download sample PDF", exact: true }), "designer-sample.pdf");
  expect(sampleText).toContain("Workshop service invoice");
  expect(sampleText).toContain("Hourly charge");
  expect(sampleText).toContain("Warranty: responsive service record");
  await activate(drawer.getByRole("navigation", { name: "Document designer sections", exact: true }).getByRole("button", { name: "Page", exact: true }));
  await expect(drawer.getByLabel("Template name", { exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("template-designer.png") });
  await activate(drawer.getByRole("button", { name: "Save template", exact: true }));
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(page.locator(".invoice-template-card").filter({ hasText: templateName })).toContainText("Default");

  await page.goto("/app/invoices?tab=catalog");
  await activate(page.getByRole("button", { name: "New item", exact: true }));
  drawer = page.getByRole("dialog").last();
  await fill(drawer.getByLabel("Name", { exact: true }), itemName);
  await fill(drawer.getByLabel(/^Unit rate/), "85.00");
  await fill(drawer.getByLabel("Unit", { exact: true }), "hour");
  await fill(drawer.getByLabel("SKU / code", { exact: true }), "BRAKE-LABOUR");
  await pick(drawer, "Type", "Service / labour");
  await pick(drawer, "Currency", "CAD");
  await fit("catalog form", drawer);
  await activate(drawer.getByRole("button", { name: "Save", exact: true }));
  await expect(drawer).toBeHidden();
  const catalogRow = page.getByRole("row").filter({ hasText: itemName });
  await expect(catalogRow).toContainText("CAD / hour");
  await catalogRow.scrollIntoViewIfNeeded();
  await expect(catalogRow).toBeInViewport();
  await touchTableActions(catalogRow, "catalog");
  await fit("saved catalog");
  await page.screenshot({ path: info.outputPath("catalog.png") });
  if (hasTouch) {
    await activate(catalogRow.getByRole("button", { name: `Actions for ${itemName}`, exact: true }));
    await activate(page.getByRole("menuitem", { name: "Edit", exact: true }));
    drawer = page.getByRole("dialog").last();
    await expect(drawer.getByLabel("Name", { exact: true })).toHaveValue(itemName);
    await expect(drawer.getByLabel(/^Unit rate/)).toHaveValue("85.00");
    await activate(drawer.getByRole("button", { name: "Cancel", exact: true }));
  }

  await page.goto("/app/invoices?tab=price_lists");
  await activate(page.getByRole("button", { name: "New price list", exact: true }));
  drawer = page.getByRole("dialog").last();
  await fill(drawer.getByLabel("Name", { exact: true }), priceListName);
  await fill(drawer.getByLabel(`${itemName} / hour (CAD)`, { exact: true }), "70.00");
  await fit("price list form", drawer);
  await activate(drawer.getByRole("button", { name: "Save price list", exact: true }));
  await expect(drawer).toBeHidden();

  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  await fill(form.getByRole("combobox", { name: "Bill to", exact: true }), customerName);
  await activate(page.getByRole("option", { name: /Create customer/ }).last());
  await expect(form.locator(".billto__name")).toHaveText(customerName);
  await pick(form, "Currency", "CAD");
  await expect(form.getByLabel("Template", { exact: true })).toContainText(templateName);
  await pick(form, "Price list", `${priceListName} (CAD)`);
  await activate(form.getByRole("button", { name: "From catalog", exact: true }));
  await activate(page.getByRole("menuitem", { name: new RegExp(itemName) }));
  await expect(form.locator(".line-editor__field--price input")).toHaveValue("70.00");
  await fill(form.getByLabel("Qty", { exact: true }), "2");
  await expect(form.getByLabel("Unit", { exact: true })).toHaveValue("hour");
  await expect(form.getByLabel("SKU", { exact: true })).toHaveValue("BRAKE-LABOUR");
  await expect(form.getByLabel("Currency", { exact: true })).toBeDisabled();
  await fit("invoice line editor", form);
  await page.screenshot({ path: info.outputPath("invoice-builder.png") });
  if (hasTouch) {
    await activate(page.getByRole("tab", { name: "Preview", exact: true }));
    await expect(page.getByRole("complementary", { name: "Invoice preview", exact: true })).toContainText("Workshop service invoice");
    const headingLines = await page.locator(".invoice-builder__preview-head > span").evaluate(element => {
      const text = document.createRange(); text.selectNodeContents(element); return text.getClientRects().length;
    });
    expect(headingLines, "preview toolbar label remains on one line").toBe(1);
    await fit("phone invoice preview");
    await page.screenshot({ path: info.outputPath("invoice-preview.png") });
    await activate(page.getByRole("tab", { name: "Edit", exact: true }));
  }
  await activate(page.getByRole("button", { name: "Save draft", exact: true }));
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  const id = new URL(page.url()).searchParams.get("builder")!;
  await page.reload();
  await expect(page.locator(".line-editor__field--price input")).toHaveValue("70.00");
  await expect(form.getByLabel("Qty", { exact: true })).toHaveValue("2");
  await expect(form.locator(".billto__name")).toHaveText(customerName);
  await activate(page.getByRole("button", { name: "Mark as sent", exact: true }));
  await expect(page.locator(".invoice-builder")).toBeHidden();

  const bank = await page.evaluate(async ({ customerName, suffix }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const workspace = await client.query("invoices:workspace", { societyId });
    const account = (await client.query("financialHub:accounts", { societyId })).find((row: any) => row.currency === "CAD" && /bank|cash|chequ|checking/i.test(`${row.accountType} ${row.name}`));
    if (!account) throw new Error("Synthetic invoice check needs the seeded CAD bank account.");
    const description = `${customerName} responsive bank deposit`;
    await client.mutation("financialHub:importBankCsvTransactions", { societyId, accountId: account._id, rows: [{ date: workspace.today, description, counterparty: customerName, amountCents: 4000, externalId: `responsive-deposit-${suffix}` }] });
    return { accountId: account._id, accountName: account.name, description };
  }, { customerName, suffix });
  await page.goto(`/app/invoices?invoice=${encodeURIComponent(id)}`);
  drawer = page.getByRole("dialog").last();
  await expect(drawer).toContainText("In the books");
  await activate(drawer.getByRole("button", { name: "Record payment", exact: true }));
  const payment = drawer.getByRole("form", { name: /^Record a payment for/ });
  await fill(payment.getByLabel("Amount", { exact: true }), "40.00");
  await fill(payment.getByLabel("Reference", { exact: true }), `RESP-PAY-${suffix}`);
  await pick(payment, "Method", "E-transfer");
  const radio = payment.getByRole("radio", { name: new RegExp(bank.description) });
  if (await radio.count()) await activate(radio);
  else await pick(payment, "Choose another bank deposit", new RegExp(bank.description));
  await fit("linked payment form", drawer);
  await page.screenshot({ path: info.outputPath("linked-payment-form.png") });
  await activate(payment.getByRole("button", { name: "Record $40.00", exact: true }));
  await expect(payment).toBeHidden();
  await expect(drawer).toContainText("Partially paid");
  await expect(drawer.locator(".invoice-bank-chip")).toContainText(bank.description);
  await page.reload();
  drawer = page.getByRole("dialog").last();
  await expect(drawer).toContainText(`RESP-PAY-${suffix}`);
  await expect(drawer.locator(".invoice-bank-chip")).toContainText(bank.accountName);
  if (hasTouch) {
    const bankText = await drawer.locator(".invoice-bank-chip__text").evaluate(element => ({ whiteSpace: getComputedStyle(element).whiteSpace, width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(bankText.whiteSpace, "bank destination wraps instead of hiding behind an ellipsis on touch screens").toBe("normal");
    expect(bankText.scrollWidth).toBeLessThanOrEqual(bankText.width + 1);
  }
  await fit("saved invoice payment", drawer);
  await page.screenshot({ path: info.outputPath("saved-invoice-payment.png") });

  await activate(drawer.getByRole("button", { name: /More actions for/ }));
  const invoiceText = await downloadPdf(page.getByRole("menuitem", { name: "Download PDF", exact: true }), "saved-invoice.pdf");
  for (const text of ["Workshop service invoice", customerName, itemName, "Hourly charge", "CAD", "$140.00", "$100.00", "Warranty: responsive service record"]) expect(invoiceText).toContain(text);
  await activate(drawer.getByRole("button", { name: /Preview receipt for payment/ }));
  const receipt = page.getByRole("dialog").last();
  await fit("receipt preview", receipt);
  const receiptText = await downloadPdf(receipt.getByRole("button", { name: "Download receipt PDF", exact: true }), "payment-receipt.pdf");
  for (const text of ["Workshop payment receipt", customerName, "Amount received", "$40.00", `RESP-PAY-${suffix}`, "E-transfer"]) expect(receiptText).toContain(text);
  await activate(receipt.getByRole("button", { name: "Close", exact: true }).last());

  const snapshot = await page.evaluate(async invoiceId => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const societyId = (await client.query("society:list", {}))[0]._id;
    const workspace = await client.query("invoices:workspace", { societyId });
    const invoice = workspace.invoices.find((row: any) => row._id === invoiceId);
    const transaction = workspace.transactions.find((row: any) => row._id === invoice.payments[0].financialTransactionId);
    const entries = await Promise.all([invoice.journalEntryId, invoice.payments[0].journalEntryId, invoice.payments[0].cashBasisEntryId].filter(Boolean).map((entryId: string) => client.query("accounting:journalEntry", { id: entryId })));
    return { invoice, transaction, entries, catalog: workspace.catalog.find((item: any) => item._id === invoice.lines[0].catalogItemId), customer: workspace.customers.find((row: any) => row.key === `organization:${invoice.counterpartyId}`) };
  }, id);
  expect(snapshot.invoice).toMatchObject({ currency: "CAD", totalCents: 14000, balanceCents: 10000, partyKind: "organization", documentTemplate: { name: templateName }, lines: [{ unitPriceCents: 7000, quantity: 2, unit: "hour", sku: "BRAKE-LABOUR" }] });
  expect(snapshot.invoice.payments[0]).toMatchObject({ amountCents: 4000, method: "e_transfer", reference: `RESP-PAY-${suffix}` });
  expect(snapshot.catalog).toMatchObject({ unitPriceCents: 8500, currency: "CAD", kind: "service" });
  expect(snapshot.transaction).toMatchObject({ linkedInvoiceId: id, accountId: bank.accountId, amountCents: 4000 });
  expect(snapshot.customer).toMatchObject({ name: customerName, outstandingCents: 10000 });
  expect(snapshot.entries.length).toBeGreaterThanOrEqual(2);
  for (const entry of snapshot.entries) {
    expect(entry.entry?.status ?? entry.status).toBe("posted");
    expect(entry.lines.length).toBeGreaterThanOrEqual(2);
    expect(entry.lines.reduce((sum: number, row: any) => sum + (row.side === "debit" ? row.amountCents : -row.amountCents), 0)).toBe(0);
  }
  await info.attach("saved-record-propagation", { body: JSON.stringify(snapshot, null, 2), contentType: "application/json" });
  await page.goto("/app/invoices?tab=customers");
  const customerRow = page.getByRole("row").filter({ hasText: customerName });
  await expect(customerRow).toContainText("$100.00");
  await customerRow.scrollIntoViewIfNeeded();
  await expect(customerRow).toBeInViewport();
  await touchTableActions(customerRow, "customer");
  await fit("customer balance list");
  await page.screenshot({ path: info.outputPath("customer-balance.png") });
  await activate(customerRow.getByRole("button", { name: "Invoice", exact: true }));
  await expect(page.locator(".invoice-builder__form .billto__name")).toHaveText(customerName);
  await expect(page.locator(".invoice-builder__form").getByLabel("Template", { exact: true })).toContainText(templateName);
  if (hasTouch) expect(touchEvents).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
