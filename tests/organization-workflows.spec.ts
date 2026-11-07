import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function date(page: Page, scope: Locator, label: string, value: string) {
  await scope.getByLabel(label, { exact: true }).click();
  const input = page.getByRole("textbox", { name: "Type a date", exact: true });
  await input.fill(value);
  await input.press("Enter");
  await expect(input).not.toBeVisible();
}

/** RecordTable pins actions in a row menu when the available width needs it. */
async function receiptAction(page: Page, receiptNumber: string, name: string) {
  const row = page.getByRole("row").filter({ has: page.getByRole("gridcell", { name: receiptNumber, exact: true }) });
  await expect(row).toBeVisible();
  const trigger = row.getByRole("button", { name: /^Row actions for / });
  if (await trigger.isVisible()) {
    await trigger.click();
    return page.getByRole("menuitem", { name, exact: true });
  }
  return row.getByRole("button", { name, exact: true });
}

async function createSociety(page: Page, name: string) {
  await page.goto("/app/society");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  const societyId = await page.evaluate(async (organizationName) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts" as string);
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts" as string);
    const created = await client.mutation("society:createWorkspace", {
      name: organizationName,
      entityType: "society",
      legalSubtype: "ordinary_society",
      jurisdictionCode: "CA-BC",
      actFormedUnder: "societies_act",
      isCharity: false,
      isMemberFunded: false,
      registeredOfficeAddress: "100 Test Street, Prince George, BC V2L 1A1, Canada",
      fiscalYearEnd: "12-31",
    });
    const users = await client.query("users:list", { societyId: created.societyId });
    const owner = users.find((user: any) => user.role === "Owner" && user.status === "Active");
    if (!owner) throw new Error("The browser fixture requires its actual owner membership.");
    setStoredUserId(owner._id);
    setStoredSocietyId(created.societyId);
    return created.societyId as string;
  }, name);
  const certificateId = await evidencePdf(page, societyId, "Synthetic formation certificate");
  await page.evaluate(async ({ societyId, name, certificateId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    await client.mutation("society:upsert", {
      id: societyId, name, isCharity: false, isMemberFunded: false,
      formationStatus: "incorporated", organizationStatus: "active",
      incorporationNumber: "S0099999", incorporationDate: "2025-01-01",
      certificateEvidenceDocumentId: certificateId, certificateReference: "SYNTHETIC-CERTIFICATE", certificateDate: "2025-01-01",
    });
  }, { societyId, name, certificateId });
  await page.goto("/app/society");
  await expect(page.getByTestId("charity-registration-profile")).toContainText("Registration evidence not recorded");
  return societyId;
}

/** Stores real synthetic PDF bytes through the same upload helper as the UI. */
async function evidencePdf(page: Page, societyId: string, title: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText(`SYNTHETIC TEST EVIDENCE: ${title}`, { x: 35, y: 700, size: 12 });
  const bytes = Array.from(await pdf.save());
  return page.evaluate(async ({ societyId, title, bytes }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const { uploadDocumentVersion } = await import("/src/lib/documentVersionUpload.ts" as string);
    const documentId = await client.mutation("documents:create", {
      societyId, title, category: "governance", tags: ["synthetic_browser_fixture"],
    });
    await uploadDocumentVersion({
      societyId, documentId,
      file: new File([new Uint8Array(bytes)], "synthetic-evidence.pdf", { type: "application/pdf" }),
      createDemoVersion: (args: any) => client.mutation("documentVersions:createDemoVersion", args),
      beginUpload: (args: any) => client.mutation("documentVersions:beginUpload", args),
      recordUploadedVersion: (args: any) => client.mutation("documentVersions:recordUploadedVersion", args),
      completeUpload: (args: any) => client.action("documentVersions:completeUpload", args),
    });
    return documentId as string;
  }, { societyId, title, bytes });
}

test("organization profile preserves pending and reviewed registration history on desktop and phone", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-07T18:00:00Z"));
  const name = `Harbour Registration ${testInfo.project.name} Society`;
  const societyId = await createSociety(page, name);
  const profile = page.getByTestId("charity-registration-profile");
  await profile.getByRole("button", { name: "Record registration update", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "Record charity registration update", exact: true });
  await pick(page, drawer, "Reported registration status", "Application pending");
  await drawer.getByLabel("Authority reference", { exact: true }).fill("SYNTHETIC-APPLICATION-2026");
  await drawer.getByRole("button", { name: "Record update", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(profile).toContainText("Application pending");
  await page.reload();
  await expect(profile).toContainText("Application pending");

  const evidenceTitle = "Synthetic registration decision";
  await evidencePdf(page, societyId, evidenceTitle);
  await profile.getByRole("button", { name: "Record registration update", exact: true }).click();
  drawer = page.getByRole("dialog", { name: "Record charity registration update", exact: true });
  await pick(page, drawer, "Reported registration status", "Registration recorded");
  await drawer.getByLabel("CRA charity registration number", { exact: true }).fill("123456789RR0001");
  await date(page, drawer, "Registration effective from", "2026-01-01");
  await pick(page, drawer, "Supporting registration document", evidenceTitle);
  await drawer.getByLabel(/I reviewed the supporting evidence/).check();
  await drawer.getByLabel("Reason for this update", { exact: true }).fill("Recorded the synthetic decision and checked its effective date.");
  await drawer.getByRole("button", { name: "Record update", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(profile).toContainText("Evidence reviewed; each gift and signing action still needs its own checks.");
  await profile.getByText("Registration history (2)", { exact: true }).click();
  await expect(profile).toContainText("Revision 1");
  await expect(profile).toContainText("Revision 2");
  await expect(profile).toContainText("Application pending");
  await page.reload();
  await expect(profile).toContainText("123456789RR0001");
  const state = await page.evaluate(async (societyId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    return client.query("receipts:registrationHistory", { societyId });
  }, societyId);
  expect(state.history).toHaveLength(2);
  expect(state.current.status).toBe("registered");
  expect(state.assessment.readiness).toBe("ready");
  await page.screenshot({ path: testInfo.outputPath("organization-registration.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("acknowledgement becomes a separately signed official receipt without changing the original", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-07T18:00:00Z"));
  const name = `Harbour Gifts ${testInfo.project.name} Society`;
  const societyId = await createSociety(page, name);
  await page.goto("/app/receipts");
  await expect(page.getByRole("heading", { name: "Donations and receipts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New donation record", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "Record donation acknowledgement", exact: true });
  await drawer.getByLabel("Donor full name", { exact: true }).fill("Synthetic Donor");
  await drawer.getByLabel("Donor address", { exact: true }).fill("200 Test Street, Prince George, BC V2L 1A1, Canada");
  await drawer.getByLabel("Gift amount (CAD)", { exact: true }).fill("125.00");
  await drawer.getByLabel("Place of issue", { exact: true }).fill("Prince George, BC");
  await drawer.getByRole("button", { name: "Record acknowledgement", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const original = await page.evaluate(async (societyId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const rows = await client.query("receipts:list", { societyId });
    return rows[0];
  }, societyId);
  expect(original.documentKind).toBe("acknowledgement");
  expect(original.eligibleAmountCents).toBe(0);
  await expect(await receiptAction(page, original.receiptNumber, "Prepare official receipt")).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto("/app/society");
  const evidenceTitle = "Synthetic decision for gift workflow";
  await evidencePdf(page, societyId, evidenceTitle);
  const profile = page.getByTestId("charity-registration-profile");
  await profile.getByRole("button", { name: "Record registration update", exact: true }).click();
  drawer = page.getByRole("dialog", { name: "Record charity registration update", exact: true });
  await pick(page, drawer, "Reported registration status", "Registration recorded");
  await drawer.getByLabel("CRA charity registration number", { exact: true }).fill("123456789RR0001");
  await date(page, drawer, "Registration effective from", "2026-01-01");
  await pick(page, drawer, "Supporting registration document", evidenceTitle);
  await drawer.getByLabel(/I reviewed the supporting evidence/).check();
  await drawer.getByRole("button", { name: "Record update", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(profile).toContainText("Evidence reviewed; each gift and signing action still needs its own checks.");

  await page.goto("/app/receipts");
  await (await receiptAction(page, original.receiptNumber, "Prepare official receipt")).click();
  drawer = page.getByRole("dialog", { name: "Prepare official receipt", exact: true });
  await expect(drawer.getByLabel("Donor full name", { exact: true })).toHaveValue("Synthetic Donor");
  await drawer.getByLabel(/I reviewed the donor identity/).check();
  await drawer.getByRole("button", { name: "Prepare for signature", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const preparation = await page.evaluate(async (societyId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const rows = await client.query("receipts:list", { societyId });
    return rows.find((row: any) => row.documentKind === "official_tax_receipt");
  }, societyId);
  expect(preparation.issueStatus).toBe("prepared");
  const downloadPromise = page.waitForEvent("download");
  await (await receiptAction(page, preparation.receiptNumber, "PDF for signature")).click();
  const download = await downloadPromise;
  await download.saveAs(testInfo.outputPath("synthetic-receipt-preparation.pdf"));
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const signedTitle = "Synthetic signed copy — test evidence only";
  await evidencePdf(page, societyId, signedTitle);
  await (await receiptAction(page, preparation.receiptNumber, "Record signed issue")).click();
  drawer = page.getByRole("dialog", { name: "Record signed issue", exact: true });
  await drawer.getByLabel("Signed copy document", { exact: true }).selectOption({ label: signedTitle });
  await drawer.getByLabel("Authorized signatory name", { exact: true }).fill("Synthetic Authorized Signer");
  await drawer.getByLabel(/I checked that the signed copy matches/).check();
  await drawer.getByRole("button", { name: "Record signed issue", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(await receiptAction(page, preparation.receiptNumber, "Signed copy")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(await receiptAction(page, original.receiptNumber, "Prepare official receipt")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  const rows = await page.evaluate(async (societyId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    return client.query("receipts:list", { societyId });
  }, societyId);
  const acknowledgement = rows.find((row: any) => row._id === original._id);
  const official = rows.find((row: any) => row.documentKind === "official_tax_receipt");
  expect(acknowledgement).toEqual(original);
  expect(official.issueStatus).toBe("issued");
  expect(official.sourceAcknowledgementId).toBe(original._id);
  expect(official.signedCopySnapshot.documentVersionId).toBeTruthy();
  expect(official.issuerSnapshot.name).toBe(name);
  await page.screenshot({ path: testInfo.outputPath("donation-receipt-lifecycle.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
