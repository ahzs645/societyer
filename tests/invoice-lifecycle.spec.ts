import { test, expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function pdfText(download: Download) {
  const document = await getDocument({ data: new Uint8Array(await readFile((await download.path())!)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number++) pages.push((await (await document.getPage(number)).getTextContent()).items.map((item: any) => item.str || "").join(" "));
  await document.destroy();
  return pages.join(" ");
}

async function invoiceDocument(page: Page, id: string) {
  return page.evaluate(async (invoiceId) => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    return client.query("invoices:document", { id: invoiceId });
  }, id);
}

test("correct an unsent unposted invoice in place and retain its previous PDF", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-08T20:00:00Z"));
  await page.goto("/app/invoices");
  await expect(page.getByRole("button", { name: "New invoice", exact: true })).toBeVisible();
  const id = await page.evaluate(async name => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const { societyId } = await client.mutation("society:createWorkspace", { name, jurisdictionCode: "CA-BC", seedDocumentPackets: false, isCharity: false, isMemberFunded: false });
    const users = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(users.find((user: any) => user.role === "Owner")._id);
    const id = await client.mutation("invoices:upsert", { societyId, partyKind: "custom", billToName: "Synthetic correction customer", issueDate: "2026-11-08", terms: "net_15", currency: "CAD", lines: [{ key: "service", item: "Original synthetic website build", quantity: 1, unitPriceCents: 12500 }] });
    const result = await client.mutation("invoices:issue", { societyId, ids: [id] });
    if (result.posted) throw new Error("Correction fixture must have no ledger posting");
    await client.mutation("invoices:saveSettings", { societyId, prefix: "INV-", nextNumber: 2, defaultTerms: "net_15", paymentMethods: [{ id: "eft", name: "Current synthetic EFT", type: "eft", details: "Synthetic receiving details with transit 00002" }], defaultPaymentMethodIds: ["eft"], paymentInstructions: "Current synthetic receiving instructions" });
    return id;
  }, `Unsent correction ${testInfo.project.name}`);
  await page.goto(`/app/invoices?invoice=${id}`);
  const issued = await invoiceDocument(page, id);
  const drawer = page.locator(".invoice-drawer");
  await drawer.getByRole("button", { name: `More actions for ${issued.number}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Return to draft", exact: true }).click();
  const modal = page.getByRole("dialog", { name: `Return ${issued.number} to draft?`, exact: true });
  await modal.getByPlaceholder("Reason for the correction (required)").fill("Never sent; correct the service charge");
  await modal.getByRole("button", { name: "Return to draft", exact: true }).click();
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill("Updated synthetic website build");
  await form.locator(".line-editor__field--price input").first().fill("250.00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Invoice saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await page.getByRole("button", { name: issued.number, exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Never sent; correct the service charge");
  const downloading = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "Download previous version", exact: true }).click();
  const prior = await downloading;
  expect(prior.suggestedFilename()).toContain("previous-finalization");
  const priorText = await pdfText(prior);
  expect(priorText).toContain("Original synthetic website build");
  expect(priorText).not.toContain("Updated synthetic website build");
  expect(priorText).not.toContain("DRAFT");
  await page.reload();
  const corrected = await invoiceDocument(page, id);
  expect(corrected.number).toBe(issued.number);
  expect(corrected.lifecycle).toBe("draft");
  expect(corrected.totalCents).toBe(25000);
  expect(corrected.sentAtISO).toBeUndefined();
  expect(corrected.paymentMethods[0].name).toBe("Current synthetic EFT");
  expect(corrected.paymentInstructions).toBe("Current synthetic receiving instructions");
  await drawer.getByRole("button", { name: `More actions for ${issued.number}`, exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Delete draft", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("same-number-invoice-correction.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("finalize, download, send externally, record responses, and settle without an email", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-08T20:00:00Z"));
  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  const customer = `Manual client ${testInfo.project.name}`;
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(customer);
  await page.getByRole("option", { name: `Bill “${customer}” once` }).click();
  await form.getByPlaceholder("What you're billing for", { exact: true }).first().fill("Synthetic consulting service");
  await form.locator(".line-editor__field--price input").first().fill("125.00");

  await page.getByRole("button", { name: "More invoice actions", exact: true }).click();
  let downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download draft PDF", exact: true }).click();
  expect(await pdfText(await downloading)).toContain("DRAFT");

  await page.getByRole("button", { name: "Finalize & download", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Finalize invoice?", exact: true });
  downloading = page.waitForEvent("download");
  await confirmation.getByRole("button", { name: "Finalize and download", exact: true }).click();
  const finalizedDownload = await downloading;
  const text = await pdfText(finalizedDownload);
  expect(text).toContain("Synthetic consulting service");
  expect(text).not.toContain("DRAFT");
  expect(text).not.toMatch(/\bSENT\b/);
  await finalizedDownload.saveAs(testInfo.outputPath("finalized-invoice.pdf"));
  await expect(page).toHaveURL(/invoice=[^&]+/);
  const id = new URL(page.url()).searchParams.get("invoice")!;
  const issued = await invoiceDocument(page, id);
  expect(issued.lifecycle).toBe("issued");
  expect(issued.sentAtISO).toBeUndefined();
  expect(issued.payments).toHaveLength(0);
  expect(issued.issuerSnapshot.name).toBeTruthy();
  expect(text).toContain(issued.number);
  for (const registration of issued.issuerTaxRegistrationsSnapshot.registrations) expect(text).toContain(registration.number);
  const drawer = page.locator(".invoice-drawer");
  const workflow = drawer.getByRole("region", { name: "Invoice workflow" });
  await expect(workflow).toContainText("Ready for you to send");
  await expect(workflow.getByRole("button", { name: "Record client response", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

  await workflow.getByRole("button", { name: "Record external sending", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "Record external sending", exact: true });
  await modal.getByLabel("Sent to", { exact: true }).fill("client@example.test");
  await modal.getByLabel("Reference (optional)", { exact: true }).fill("Sent from our own mailbox");
  await modal.getByRole("button", { name: "Record sending", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(workflow).toContainText("client@example.test");
  await workflow.getByRole("button", { name: "Record client response", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Record client response", exact: true });
  await modal.getByLabel("Notes (optional)", { exact: true }).fill("Client confirmed by email.");
  await modal.getByRole("button", { name: "Save client response", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(workflow).toContainText("Accepted");
  expect((await invoiceDocument(page, id)).balanceCents).toBe(issued.balanceCents);

  await workflow.getByRole("button", { name: "Update client response", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Record client response", exact: true });
  await modal.getByLabel("Client response", { exact: true }).click();
  await page.getByRole("option", { name: "Changes requested", exact: true }).click();
  await modal.getByLabel("Reason or requested changes", { exact: true }).fill("Please attach the work completion reference.");
  await modal.getByRole("button", { name: "Save client response", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(workflow).toContainText("Changes requested");
  expect((await invoiceDocument(page, id)).balanceCents).toBe(issued.balanceCents);

  // Adding response evidence must not silently replace a non-acceptance with Accepted.
  await workflow.getByRole("button", { name: "Update client response", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Record client response", exact: true });
  await expect(modal.getByLabel("Client response", { exact: true })).toContainText("Changes requested");
  await expect(modal.getByLabel("Reason or requested changes", { exact: true })).toHaveValue("Please attach the work completion reference.");
  await modal.getByLabel("Reference (optional)", { exact: true }).fill("Client follow-up email");
  await modal.getByRole("button", { name: "Save client response", exact: true }).click();
  await expect(modal).not.toBeVisible();
  const updatedResponse = await invoiceDocument(page, id);
  expect(updatedResponse.clientResponse.response).toBe("changes_requested");
  expect(updatedResponse.clientResponse.reference).toBe("Client follow-up email");
  expect(updatedResponse.balanceCents).toBe(issued.balanceCents);

  await drawer.getByRole("button", { name: "Record payment", exact: true }).click();
  const payment = drawer.getByRole("form", { name: /^Record a payment/ });
  await payment.getByLabel("Amount", { exact: true }).fill("25.00");
  const unlinkPayment = payment.getByRole("button", { name: "Don't link", exact: true });
  if (await unlinkPayment.isVisible()) await unlinkPayment.click();
  await payment.getByRole("button", { name: "Record $25.00", exact: true }).click();
  await expect(payment).not.toBeVisible();
  const partial = await invoiceDocument(page, id);
  expect(partial.balanceCents).toBe(issued.balanceCents - 2500);
  expect(partial.clientResponse.response).toBe("changes_requested");
  await page.reload();
  await expect(workflow).toContainText("Changes requested");
  await expect(workflow).toContainText("client@example.test");
  await drawer.getByRole("button", { name: "Record payment", exact: true }).click();
  await payment.getByLabel("Amount", { exact: true }).fill((partial.balanceCents / 100).toFixed(2));
  if (await unlinkPayment.isVisible()) await unlinkPayment.click();
  await payment.getByRole("button", { name: /^Record \$/ }).click();
  await expect(payment).not.toBeVisible();
  expect((await invoiceDocument(page, id)).status).toBe("paid");
  await expect(workflow).toContainText("Changes requested");
  await page.screenshot({ path: testInfo.outputPath("manual-invoice-workflow.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("external finalization replaces unsaved edits with the saved invoice in the editor, preview, and PDF", async ({ page, hasTouch }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-08T20:00:00Z"));
  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form).toBeVisible();
  const customer = `Concurrent finalization client ${testInfo.project.name}`;
  const item = form.getByPlaceholder("What you're billing for", { exact: true }).first();
  const price = form.locator(".line-editor__field--price input").first();
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(customer);
  await page.getByRole("option", { name: `Bill “${customer}” once` }).click();
  await item.fill("Saved service before finalization");
  await price.fill("80.00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/builder=(?!new)[^&]+/);
  const id = new URL(page.url()).searchParams.get("builder")!;
  await expect(price).toHaveValue("80.00");
  const saved = await invoiceDocument(page, id);
  expect(saved.lifecycle).toBe("draft");
  expect(saved.totalCents).toBe(8000);

  // Keep this builder mounted with an edit that has never reached storage.
  await price.fill("100.00");
  await expect(price).toHaveValue("100.00");
  if (hasTouch) await page.getByRole("tab", { name: "Preview", exact: true }).tap();
  const preview = page.getByRole("complementary", { name: "Invoice preview", exact: true });
  const previewText = preview.getByTestId("invoice-pdf-preview").locator(".textLayer").first();
  await expect(previewText).toContainText("$100.00");
  await expect(previewText).toContainText("DRAFT");
  expect((await invoiceDocument(page, id)).totalCents).toBe(8000);

  // Emulate another tab finalizing the persisted draft, bypassing this editor's save flow.
  const result = await page.evaluate(async (invoiceId) => {
    const path = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(path);
    const document = await client.query("invoices:document", { id: invoiceId });
    return client.mutation("invoices:issue", { societyId: document.societyId, ids: [invoiceId] });
  }, id);
  expect(result.issued).toBe(1);
  await expect(page).toHaveURL(url => url.searchParams.get("builder") === id);
  await expect(item).toBeDisabled();
  await expect(price).toBeDisabled();
  await expect(price).toHaveValue("80.00");
  await expect(form.getByLabel("PO or reference", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finalize & download", exact: true })).toHaveCount(0);

  await expect(previewText).toContainText("Saved service before finalization");
  await expect(previewText).toContainText("$80.00");
  await expect(previewText).not.toContainText("$100.00");
  await expect(previewText).not.toContainText("DRAFT");
  const printDocument = page.locator(".invoice-print-portal .invoice-doc");
  await expect(printDocument).toContainText("$80.00");
  await expect(printDocument).not.toContainText("$100.00");
  await expect(printDocument.locator(".document-preview__watermark")).toHaveCount(0);

  const downloading = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloading;
  const text = await pdfText(download);
  expect(text).toContain(saved.number);
  expect(text).toContain("Saved service before finalization");
  expect(text).toContain("$80.00");
  expect(text).not.toContain("$100.00");
  expect(text).not.toContain("DRAFT");
  await download.saveAs(testInfo.outputPath("concurrently-finalized-invoice.pdf"));
  const finalized = await invoiceDocument(page, id);
  expect(finalized.lifecycle).toBe("issued");
  expect(finalized.totalCents).toBe(8000);
  expect(finalized.sentAtISO).toBeUndefined();
  expect(errors).toEqual([]);
});
