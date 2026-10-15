import { expect, test, type Page } from "@playwright/test";
import { chooseGuidedSetupAct, completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

/** Matches playwright.guided-setup.config.ts (GUIDED_SETUP_PORT, default 43951). */
const GUIDED_SETUP_ORIGIN = `http://127.0.0.1:${process.env.GUIDED_SETUP_PORT ?? 43951}`;

async function start(page: Page, restore = false) {
  await page.goto("/setup");
  await page.getByRole("button", { name: restore ? /I have a backup to restore/i : /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
}
async function snapshot(page: Page) {
  // Read actual IndexedDB records. Importing another data-client module in the
  // browser can construct a second client with a different cache generation.
  return page.evaluate(async () => {
    const choice = JSON.parse(localStorage.getItem("societyer:app-runtime") ?? "null");
    const databases = await indexedDB.databases();
    const name = databases.find((database) => database.name?.startsWith("societyer-local") && (!choice?.workspaceId || database.name.includes(choice.workspaceId)))?.name;
    if (!name) throw new Error("The actual local workspace database was not persisted.");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const request = database.transaction(store, "readonly").objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [records, attachments, changes, meta] = await Promise.all([read("records"), read("attachments"), read("changes"), read("meta")]);
    database.close();
    const tables: Record<string, any[]> = {};
    for (const record of records) if (!record.deletedAtISO && record.value) (tables[record.table] ??= []).push(record.value);
    return { kind: "societyer.localWorkspaceSnapshot", exportedAtISO: new Date().toISOString(), workspace: meta.find((entry) => entry.key === "workspace")?.value, tables, attachments, changes };
  });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: "Something went wrong.", exact: true })).toHaveCount(0);
}
async function exportedBackup(page: Page) {
  await page.goto("/app/settings?tab=runtime");
  const event = page.waitForEvent("download");
  // The JSON records export carries the same snapshot as the ZIP backup, without files.
  await page.getByRole("button", { name: "Records JSON", exact: true }).click();
  const stream = await (await event).createReadStream();
  if (!stream) throw new Error("The workspace backup download did not contain bytes.");
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("existing company collects its Act, addresses and share planning without fabricated certificates or securities", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await start(page);
  await chooseGuidedSetupAct(page, true, { jurisdiction: "British Columbia", act: "Business Corporations Act" });
  await fits(page);
  await page.getByRole("textbox", { name: "Recorded legal name", exact: true }).fill(`Guided Existing Company ${info.project.name}`);
  await page.getByRole("textbox", { name: "Incorporation #", exact: true }).fill("BC1234567");
  await page.getByLabel("Incorporation date", { exact: true }).fill("2023-05-10");
  await page.getByRole("textbox", { name: "Official email", exact: true }).fill("records@example.test");
  await page.getByLabel("Fiscal year end month", { exact: true }).click();
  await page.getByRole("option", { name: "Dec", exact: true }).click();
  await expect(page.getByLabel("Fiscal year end day", { exact: true })).toContainText("31");
  // Addresses are optional at creation; open that section to add them now.
  await page.getByText("Add the registered office and mailing address now", { exact: false }).click();
  const office = page.getByRole("group", { name: "Registered office address", exact: true });
  await office.getByLabel("Street #", { exact: true }).fill("123");
  await office.getByLabel("Street name", { exact: true }).fill("Example Road");
  await office.getByLabel("City / town", { exact: true }).fill("Victoria");
  await office.getByLabel("Country", { exact: true }).fill("Canada");
  await page.getByLabel("Mailing address is the same as the registered office", { exact: true }).uncheck();
  await page.getByRole("group", { name: "Mailing address", exact: true }).getByLabel("Country", { exact: true }).fill("New Zealand");
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByText("Add governance notes now", { exact: false }).click();
  await page.getByLabel("Shareholder / share class structure", { exact: true }).click();
  await page.getByRole("option", { name: "Multiple share classes", exact: true }).click();
  await page.getByLabel("Share class names and rights to review", { exact: true }).fill("Class A voting common; Class B non-voting preferred.");
  await page.getByLabel("Where will the organization operate?", { exact: true }).fill("British Columbia and Alberta");
  await fits(page);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup\?welcome=1/);
  await page.reload();
  // Setup has its own page; step links carry `?setup=<step>` for the way back.
  await expect(page.getByRole("heading", { name: `Set up Guided Existing Company ${info.project.name}`, exact: true })).toBeVisible();
  await expect(page.locator('a[href*="setup=shares"]').first()).toHaveAttribute("href", /^\/app\/rights-ledger/);
  await expect(page.locator('a[href*="setup=directors"]').first()).toHaveAttribute("href", /^\/app\/role-holders/);
  await expect(page.locator('a[href^="/app/members"][href*="setup="]')).toHaveCount(0);
  const saved = await snapshot(page); const organization = saved.tables.societies[0];
  expect(organization.formationStatus).toBe("unverified_existing");
  expect(organization.organizationStatus).toBe("active");
  expect(organization.actFormedUnder).toBe("business_corporations_act__british_columbia_");
  expect(organization.registeredOfficeAddress).toContain("123 Example Road");
  expect(organization.mailingAddress).toBe("\n\nNew Zealand");
  expect(organization.certificateEvidenceDocumentId).toBeUndefined();
  const answers = JSON.parse(organization.onboardingAnswersJson);
  expect(answers.previousUse).toBe("new"); expect(answers.governanceStructure).toBe("multiple_classes");
  expect(answers.classDetails).toContain("Class A voting common");
  expect(saved.tables.rightsholdingTransfers ?? []).toHaveLength(0);
  expect(saved.tables.roleHolders ?? []).toHaveLength(0);
  // Exercise the shared editor in the generic organization-location drawer too.
  await page.goto("/app/society");
  await page.locator("#more-organization-details > summary").click();
  await page.getByRole("button", { name: "Address", exact: true }).click();
  const address = page.getByRole("dialog", { name: "New address", exact: true });
  await address.getByLabel("Country", { exact: true }).fill("Canada");
  await address.getByLabel("Street #", { exact: true }).fill("456");
  await address.getByLabel("Street name", { exact: true }).fill("Records Road");
  await address.getByLabel("City / town", { exact: true }).fill("Victoria");
  await address.getByRole("button", { name: "Save", exact: true }).click();
  await expect(address).toHaveCount(0);
  await expect(page.getByText(/456 Records Road, Victoria/)).toBeVisible();
  const locations = await snapshot(page);
  expect(locations.tables.organizationAddresses.some((row: any) => row.street === "456 Records Road" && row.country === "Canada")).toBe(true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  // Phones hide the header "Saved" note; the toast still shows it.
  await expect(page.getByText("Saved", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const afterProfileSave = await snapshot(page);
  expect(afterProfileSave.tables.societies[0].mailingAddress).toBe("\n\nNew Zealand");
  expect(afterProfileSave.tables.organizationAddresses.some((row: any) => row.type === "mailing" && row.country === "New Zealand" && row.city === "Needs review")).toBe(true);
  expect(errors).toEqual([]); await fits(page);
});

test("new incorporation stays pending and hands off a formation task with reviewed filing guidance", async ({ page }, info) => {
  await start(page);
  await completeGuidedOrganizationSetup(page, `Guided New Society ${info.project.name}`);
  await expect(page.getByRole("heading", { name: `Set up Guided New Society ${info.project.name}`, exact: true })).toBeVisible();
  await expect(page.locator('a[href*="setup=directors"]').first()).toHaveAttribute("href", /^\/app\/directors/);
  await expect(page.locator('a[href*="setup=shares"]')).toHaveCount(0);
  const saved = await snapshot(page); const organization = saved.tables.societies[0];
  expect(organization.formationStatus).toBe("preparing"); expect(organization.organizationStatus).toBe("pre_incorporation");
  expect(saved.tables.organizationRegistrations[0].status).toBe("pending");
  expect(saved.tables.tasks.length).toBeGreaterThan(0);
  expect(saved.tables.workflows[0].config.initialSetupAnswers.organizationStage).toBe("preparing");
  await page.goto("/app/society");
  await expect(page.getByRole("link", { name: "Open official service" })).toBeVisible();
  await fits(page);
});

test("restore previews a real backup on another device and preserves organization records", async ({ page, browser }, info) => {
  await start(page); await completeGuidedOrganizationSetup(page, `Guided Backup Society ${info.project.name}`, true);
  const saved = await exportedBackup(page);
  const context = await browser.newContext({ ...info.project.use });
  const target = await context.newPage();
  await target.goto(`${GUIDED_SETUP_ORIGIN}/setup`);
  await target.getByRole("button", { name: /I have a backup to restore/i }).click();
  await target.waitForURL(/restore=1/);
  await expect(target.getByRole("heading", { name: "Restore from a backup", exact: true })).toBeVisible();
  await target.locator('input[type="file"]').setInputFiles({ name: "societyer-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  const dialog = target.getByRole("dialog");
  await expect(dialog.getByText(/Guided Backup Society/)).toBeVisible();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await target.waitForURL(url => url.pathname === "/app");
  await target.goto(`${GUIDED_SETUP_ORIGIN}/app/society`);
  await expect(target.getByLabel("Legal name", { exact: true })).toHaveValue(`Guided Backup Society ${info.project.name}`);
  const restored = await snapshot(target);
  expect(restored.tables.societies[0].onboardingAnswersJson).toBe(saved.tables.societies[0].onboardingAnswersJson);
  expect(restored.tables.users[0].authSubject).toBeUndefined();
  await fits(target); await context.close();
});

test("malformed backup never reaches destructive confirmation or changes local records", async ({ page }) => {
  await start(page);
  await completeGuidedOrganizationSetup(page, "Keep these original local records", true);
  await start(page, true);
  const before = await snapshot(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ tables: { societies: [{ _id: "dup", name: "One" }, { _id: "dup", name: "Two" }] } })) });
  await expect(page.getByText(/invalid or duplicate records/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.tables).toEqual(before.tables); await fits(page);
});

test("federal CBCA: jurisdiction first, then the Act, with full guidance shown in review", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await start(page);
  await page.getByRole("button", { name: "No, prepare a new incorporation", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where will the organization be incorporated?", exact: true })).toBeVisible();
  // Continue without an answer explains what is missing.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("federal or provincial");
  await page.getByRole("button", { name: /^Federally \(Canada-wide\)/ }).click();
  await expect(page.getByLabel("Province or territory", { exact: true })).toHaveCount(0);
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Which Act will it be incorporated under?", exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4); // CBCA, CNCA, Canada Cooperatives Act, Another Act
  const cbca = page.getByRole("radio", { name: /^Canada Business Corporations Act \(CBCA\)/ });
  const cnca = page.getByRole("radio", { name: /^Canada Not-for-profit Corporations Act/ });
  await expect(page.locator("label", { has: cbca })).toContainText("Full guidance");
  await expect(page.locator("label", { has: cnca })).toContainText("Records only");
  // Keyboard: arrow keys move through the Act choices.
  await cbca.focus(); await page.keyboard.press("Space");
  await expect(cbca).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(cnca).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(cbca).toBeChecked();
  await expect(page.locator(".notice--info")).toContainText("Federal CBCA");
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(`Guided Federal ${info.project.name}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const actRow = page.locator(".society-create__summary > div", { hasText: "Governing Act" });
  await expect(actRow).toContainText("Federal · CBCA");
  await expect(actRow).toContainText("Business corporation · Full guidance");
  // Edit goes back to the Act question with the answer kept; Change goes to the jurisdiction.
  await actRow.getByRole("button", { name: "Edit governing Act", exact: true }).click();
  await expect(cbca).toBeChecked();
  await page.getByRole("button", { name: "Change jurisdiction", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Federally \(Canada-wide\)/ })).toHaveAttribute("aria-pressed", "true");
  for (let index = 0; index < 3; index++) await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await fits(page);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup\?welcome=1/);
  const organization = (await snapshot(page)).tables.societies[0];
  expect([organization.jurisdictionCode, organization.entityType, organization.actFormedUnder, organization.legalSubtype])
    .toEqual(["CA-FED-CBCA", "corporation__business_", "canada_business_corporations_act", "federal_private_corporation"]);
  const answers = JSON.parse(organization.onboardingAnswersJson);
  expect([answers.pathwayKey, answers.incorporationActId]).toEqual(["federal_cbca", "ca-cbca"]);
  expect(errors).toEqual([]);
});

test("Alberta records only: province picker, plain-language note and a records-only workspace", async ({ page }, info) => {
  await start(page);
  await page.getByRole("button", { name: "Yes, set up an existing organization", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^Provincially or territorially/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("province or territory");
  await page.getByLabel("Province or territory", { exact: true }).click();
  await page.getByRole("option", { name: /^Alberta/ }).first().click();
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".society-create__context")).toContainText("Alberta");
  await page.getByRole("radio", { name: /^Business Corporations Act/ }).check();
  await expect(page.locator(".notice--warn")).toContainText("doesn't have reviewed guidance for this Act yet");
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Recorded legal name", exact: true }).fill(`Guided Alberta ${info.project.name}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const actRow = page.locator(".society-create__summary > div", { hasText: "Governing Act" });
  await expect(actRow).toContainText("Alberta · Business Corporations Act");
  await expect(actRow).toContainText("Records only — no reviewed guidance yet");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup\?welcome=1/);
  const organization = (await snapshot(page)).tables.societies[0];
  expect([organization.jurisdictionCode, organization.entityType, organization.actFormedUnder, organization.legalSubtype])
    .toEqual(["CA-AB", "corporation__business_", "business_corporations_act__alberta_", "other"]);
  expect(JSON.parse(organization.onboardingAnswersJson).pathwayKey).toBe("records_only");
  // Settings show the catalogued Act and keep the stored jurisdiction.
  await page.goto("/app/society");
  await page.locator("#more-organization-details > summary").click();
  await expect(page.getByLabel("Act formed under", { exact: true })).toContainText("Business Corporations Act");
  await expect(page.getByLabel("Legal jurisdiction", { exact: true })).toContainText("Alberta");
  await fits(page);
});

test("another Act asks for its name and the kind of organization", async ({ page }, info) => {
  await start(page);
  await page.getByRole("button", { name: "No, prepare a new incorporation", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^Provincially or territorially/ }).click();
  await page.getByLabel("Province or territory", { exact: true }).click();
  await page.getByRole("option", { name: /^Manitoba/ }).first().click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // An Act that incorporates more than one kind of organization asks which.
  await page.getByRole("radio", { name: /^The Corporations Act/ }).check();
  await expect(page.getByRole("group", { name: "What kind of organization is it?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("what kind of organization");
  await page.getByRole("radio", { name: /^Another Act/ }).check();
  await expect(page.locator(".notice--warn")).toContainText("can't guide this incorporation yet");
  await page.getByRole("radio", { name: /^Co-operative/ }).check();
  await page.getByRole("textbox", { name: "Name of the Act", exact: true }).fill("The Example Special Act");
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(`Guided Manitoba ${info.project.name}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".society-create__summary > div", { hasText: "Governing Act" })).toContainText("Manitoba · The Example Special Act");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup\?welcome=1/);
  const saved = await snapshot(page); const organization = saved.tables.societies[0];
  expect([organization.jurisdictionCode, organization.entityType, organization.actFormedUnder]).toEqual(["CA-MB", "cooperative", "another_act"]);
  expect(JSON.parse(organization.onboardingAnswersJson).otherActName).toBe("The Example Special Act");
});
