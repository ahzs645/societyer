import { expect, test, type Page } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

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
  await page.getByRole("button", { name: "I've used Societyer before", exact: true }).click();
  await page.getByRole("button", { name: "Continue without a backup", exact: true }).click();
  await page.getByRole("button", { name: "Yes, set up an existing organization", exact: true }).click();
  await page.getByLabel("Act the organization was formed under", { exact: true }).click();
  await page.getByRole("option", { name: /BC business corporation \(provincial\)/ }).click();
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Recorded legal name", exact: true }).fill(`Guided Existing Company ${info.project.name}`);
  await page.getByRole("textbox", { name: "Incorporation #", exact: true }).fill("BC1234567");
  await page.getByLabel("Incorporation date", { exact: true }).fill("2023-05-10");
  await page.getByRole("textbox", { name: "Official email", exact: true }).fill("records@example.test");
  await page.getByRole("textbox", { name: "Fiscal year end", exact: true }).fill("12-31");
  const office = page.getByRole("group", { name: "Registered office address", exact: true });
  await office.getByLabel("Street #", { exact: true }).fill("123");
  await office.getByLabel("Street name", { exact: true }).fill("Example Road");
  await office.getByLabel("City / town", { exact: true }).fill("Victoria");
  await office.getByLabel("Country", { exact: true }).fill("Canada");
  await page.getByLabel("Mailing address is the same as the registered office", { exact: true }).uncheck();
  await page.getByRole("group", { name: "Mailing address", exact: true }).getByLabel("Country", { exact: true }).fill("New Zealand");
  await fits(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Shareholder / share class structure", { exact: true }).click();
  await page.getByRole("option", { name: "Multiple share classes", exact: true }).click();
  await page.getByLabel("Share class names and rights to review", { exact: true }).fill("Class A voting common; Class B non-voting preferred.");
  await page.getByLabel("Where will the organization operate?", { exact: true }).fill("British Columbia and Alberta");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await fits(page);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/workflows\//);
  await page.reload();
  await expect(page.getByText("Workspace onboarding").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue organization setup", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review share classes and securities", exact: true })).toHaveAttribute("href", "/app/rights-ledger");
  await expect(page.getByRole("link", { name: "Add directors, officers and shareholders", exact: true })).toHaveAttribute("href", "/app/role-holders");
  await expect(page.getByRole("link", { name: "Review membership types and add members", exact: true })).toHaveCount(0);
  const saved = await snapshot(page); const organization = saved.tables.societies[0];
  expect(organization.formationStatus).toBe("unverified_existing");
  expect(organization.organizationStatus).toBe("active");
  expect(organization.actFormedUnder).toBe("business_corporations_act__british_columbia_");
  expect(organization.registeredOfficeAddress).toContain("123 Example Road");
  expect(organization.mailingAddress).toBe("\n\nNew Zealand");
  expect(organization.certificateEvidenceDocumentId).toBeUndefined();
  const answers = JSON.parse(organization.onboardingAnswersJson);
  expect(answers.previousUse).toBe("returning"); expect(answers.governanceStructure).toBe("multiple_classes");
  expect(saved.tables.tasks.some((task: any) => task.description.includes("Class A voting common"))).toBe(true);
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
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  const afterProfileSave = await snapshot(page);
  expect(afterProfileSave.tables.societies[0].mailingAddress).toBe("\n\nNew Zealand");
  expect(afterProfileSave.tables.organizationAddresses.some((row: any) => row.type === "mailing" && row.country === "New Zealand" && row.city === "Needs review")).toBe(true);
  expect(errors).toEqual([]); await fits(page);
});

test("new incorporation stays pending and hands off a formation task with reviewed filing guidance", async ({ page }, info) => {
  await start(page);
  await completeGuidedOrganizationSetup(page, `Guided New Society ${info.project.name}`);
  await expect(page.getByRole("heading", { name: "Continue organization setup", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review membership types and add members", exact: true })).toHaveAttribute("href", "/app/members");
  await expect(page.getByRole("link", { name: "Review share classes and securities", exact: true })).toHaveCount(0);
  const saved = await snapshot(page); const organization = saved.tables.societies[0];
  expect(organization.formationStatus).toBe("preparing"); expect(organization.organizationStatus).toBe("pre_incorporation");
  expect(saved.tables.organizationRegistrations[0].status).toBe("pending");
  expect(saved.tables.tasks.some((task: any) => task.tags.includes("formation"))).toBe(true);
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
  await target.goto("http://127.0.0.1:43951/setup");
  await target.getByRole("button", { name: /I have a backup to restore/i }).click();
  await target.waitForURL(/restore=1/);
  await expect(target.getByRole("heading", { name: "Restore from a backup", exact: true })).toBeVisible();
  await target.locator('input[type="file"]').setInputFiles({ name: "societyer-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  const dialog = target.getByRole("dialog");
  await expect(dialog.getByText(/Guided Backup Society/)).toBeVisible();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await target.waitForURL(url => url.pathname === "/app");
  await target.goto("http://127.0.0.1:43951/app/society");
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
