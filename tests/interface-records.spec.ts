import { expect, test, type Page } from "@playwright/test";

async function openNavigation(page: Page) {
  const mobileMore = page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true });
  if (await mobileMore.isVisible() && !await page.getByRole("dialog", { name: "navigation", exact: true }).isVisible()) {
    await mobileMore.click();
  }
}

// [route, header action, first field, menu item when the action opens the "+" menu]
const dialogCases: ReadonlyArray<readonly [string, string, string, string?]> = [
  ["certificate-register", "Issue certificate", "Certificate number"],
  ["filings", "New filing", "Period / label"],
  ["deadlines", "New deadline", "Title"],
  ["corporate-history", "Add", "Name", "Name change"],
  ["significant-individuals", "Record step", "Individual name"],
  ["policies", "New policy", "Policy name"],
  ["auditors", "New appointment", "Firm name"],
  ["court-orders", "Record order", "Title"],
  ["inspections", "Log inspection", "Inspector name"],
  ["pipa-training", "Log training", "Participant"],
  ["service-providers", "New provider", "Firm name"],
  ["documents", "New document", "Title"],
  ["minute-book", "New record", "Title"],
  ["governance-registers", "Add record", "Person name"],
  ["rights-ledger", "New", "Class name", "Class"],
  ["rights-ledger", "New", "Quantity", "Transfer"],
  ["template-engine", "New", "Name", "Field"],
  ["template-engine", "New", "Name", "Template"],
  ["template-engine", "New", "Package name", "Precedent"],
  ["template-engine", "New", "Run name", "Package run"],
  ["template-engine", "New", "Title", "Draft document"],
  ["template-engine", "New", "Full name", "Signer"],
  ["formation-maintenance", "New", "Name", "Name search"],
  ["formation-maintenance", "New", "New entity name", "Amendment"],
  ["formation-maintenance", "New", "Filing year", "Annual maintenance"],
  ["formation-maintenance", "New", "Label", "Jurisdiction"],
  ["formation-maintenance", "New", "Page", "Log entry"],
  ["formation-maintenance", "New", "NUANS number", "Formation package"],
];

for (const width of [320, 390, 768, 1440]) {
  test(`legal record forms remain usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    let currentRoute = "";
    for (const [route, action, field, menuItem] of dialogCases) {
      if (route !== currentRoute) await page.goto(`/demo/app/${route}`);
      currentRoute = route;
      await page.getByRole("button", { name: action, exact: true }).first().click();
      if (menuItem) await page.getByRole("menuitem", { name: menuItem, exact: true }).click();
      const dialog = page.getByRole("dialog").last();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(field, { exact: true }).fill(`Interface audit ${width}`);
      await expect(dialog.getByLabel(field, { exact: true })).toHaveValue(`Interface audit ${width}`);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(bodyWidth, `${route} extends beyond its ${width}px viewport`).toBeLessThanOrEqual(width + 2);
    }
    await page.goto("/demo/app/deadlines");
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(page.getByRole("button", { name: "List", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.goto("/demo/app/bylaws-history");
    await page.getByRole("button", { name: "Current bylaws", exact: true }).click();
    await expect(page.getByRole("button", { name: "Timeline", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await page.goto("/demo/app/compliance-obligations");
    await expect(page.getByRole("heading", { name: "Compliance obligations", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 2);
    const complianceWidth = await page.locator(".page").evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(complianceWidth.scroll).toBeLessThanOrEqual(complianceWidth.width + 2);
    expect(errors).toEqual([]);
  });
}

test("rejected certificate and formation evidence stays visible without unhandled errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/certificate-register");
  await page.getByRole("button", { name: "Issue certificate", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Could not record certificate", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Certificate number", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/demo/app/society");
  await page.getByText("More organization details", { exact: false }).click();
  await page.getByLabel("Legal formation status", { exact: true }).click();
  await page.getByRole("option", { name: "Incorporated — certificate evidence verified", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Could not save organization", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Legal formation status", { exact: true })).toContainText("certificate evidence verified");
  expect(errors).toEqual([]);
});

test("document metadata opens its review workbench and validates page comments", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/documents");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const title = "Interface audit metadata document";
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible();
  // Row actions live in the per-document menu (Preview stays inline).
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Actions for this document", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open review page", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  // A metadata-only record cannot be opened; the page says why instead.
  await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeDisabled();
  await expect(page.getByRole("note").filter({ hasText: "No file is attached to this document — it is a metadata record." })).toBeVisible();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Add a comment first.", { exact: true })).toBeVisible();
  await page.locator("[contenteditable=true]").first().pressSequentially("Synthetic page review note for interface verification.");
  await page.getByLabel("Page", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Page must be a positive whole number.", { exact: true })).toBeVisible();
  await page.getByLabel("Page", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Comment added", { exact: true })).toBeVisible();
  await expect(page.locator(".panel").filter({ hasText: "Synthetic page review note for interface verification." })).toBeVisible();
  await expect(page.locator("[contenteditable=true]").first()).toHaveText("");
  await page.getByRole("button", { name: "In review", exact: true }).click();
  await expect(page.getByText("Review status updated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.locator(".panel").filter({ hasText: "Synthetic page review note for interface verification." }).getByText("Resolved", { exact: true })).toBeVisible();
  await page.goto("/demo/app/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const userDialog = page.getByRole("dialog");
  await userDialog.getByLabel("Display name", { exact: true }).fill("Interface Records Viewer");
  await userDialog.getByLabel("Email", { exact: true }).fill("records-viewer@interface.example");
  await userDialog.getByLabel("Role", { exact: true }).click();
  await page.getByRole("option", { name: "Viewer", exact: true }).click();
  await userDialog.getByLabel("Status", { exact: true }).click();
  await page.getByRole("option", { name: "Active", exact: true }).click();
  await userDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(userDialog).toHaveCount(0);
  await page.locator("tr", { hasText: "Interface Records Viewer" }).getByRole("button", { name: "Act as", exact: true }).click();
  await expect(page.getByText("Now acting as Interface Records Viewer", { exact: true })).toBeVisible();
  // Demo actors are intentionally in-memory; use router navigation to preserve the selected role.
  await openNavigation(page);
  await page.getByRole("link", { name: "Documents", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "New document", exact: true })).toBeDisabled();
  await expect(page.locator("tr", { hasText: title })).toHaveCount(0);
  const publicBylaws = page.locator("tr", { hasText: "Current bylaws" });
  // Row actions live in the per-document menu; a Viewer sees the writes disabled.
  const rowMenu = publicBylaws.getByRole("button", { name: "Actions for this document", exact: true });
  await rowMenu.click();
  await expect(page.getByRole("menuitem", { name: "Flag for purge", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Delete…", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "File history", exact: true }).click();
  const versions = page.getByRole("dialog");
  await expect(versions.getByText("Document editing permission is required to upload or restore versions.", { exact: true })).toBeVisible();
  await versions.getByRole("button", { name: "Close", exact: true }).click();
  await rowMenu.click();
  await page.getByRole("menuitem", { name: "Open review page", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Current bylaws", exact: true })).toBeVisible();
  await expect(page.getByText("Your role can read this document. Document editing permission is required to change review status or comments.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "In review", exact: true })).toBeDisabled();
  await openNavigation(page);
  const recordsGroup = page.getByRole("button", { name: /^Governance records/ }).first();
  if (await recordsGroup.getAttribute("aria-expanded") !== "true") await recordsGroup.click();
  await page.getByRole("link", { name: "Annual filings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add filing", exact: true })).toBeDisabled();
  for (const remove of await page.getByRole("button", { name: /^Delete .* filing$/ }).all()) await expect(remove).toBeDisabled();
  const annualRow = page.locator("tbody tr").first();
  if (await annualRow.count()) {
    await annualRow.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  // Corporate-only sidebar entries are hidden for this society fixture. Preview
  // their public deep links without reloading the demo's in-memory actor.
  const navigatePreview = async (route: string) => page.evaluate((path) => {
    window.history.pushState({}, "", `/demo/app/${path}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
  await navigatePreview("certificate-register");
  await expect(page.getByRole("button", { name: "Issue certificate", exact: true })).toBeDisabled();
  for (const remove of await page.getByRole("button", { name: /^Delete certificate / }).all()) await expect(remove).toBeDisabled();
  await navigatePreview("compliance-settings");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByText("Clone this entity", { exact: true }).click();
  await page.getByLabel("New entity name", { exact: true }).fill("Synthetic readonly attempt");
  await expect(page.getByRole("button", { name: "Clone", exact: true })).toBeDisabled();
  await openNavigation(page);
  const workspaceGroup = page.getByRole("button", { name: /^Workspace(?: \d+)?$/ }).first();
  if (await workspaceGroup.getAttribute("aria-expanded") !== "true") await workspaceGroup.click();
  await page.getByRole("link", { name: "Society", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await navigatePreview("governance-registers");
  await expect(page.getByRole("button", { name: "Add record", exact: true })).toBeDisabled();
  for (const promote of await page.getByRole("button", { name: "Promote", exact: true }).all()) await expect(promote).toBeDisabled();
  await openNavigation(page);
  await page.getByRole("link", { name: "Obligations", exact: true }).click();
  for (const action of await page.getByRole("button", { name: /^(Track|Review|Dismiss|Reopen|Packet)$/ }).all()) await expect(action).toBeDisabled();
  expect(errors).toEqual([]);
});

test("annual filing ledger validates required facts and saves a pending record", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/annual-filings");
  await page.getByRole("button", { name: "Add filing", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter a jurisdiction and a four-digit filing year.", { exact: true })).toBeVisible();
  await dialog.getByLabel("Jurisdiction", { exact: true }).fill("CA-FED-CBCA");
  await dialog.getByLabel("Year", { exact: true }).fill("2027");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Add the filed-on date before marking this filing as filed.", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Annual filing saved", { exact: true })).toBeVisible();
  await expect(page.locator("tr", { hasText: "2027" })).toContainText("✗");
  expect(errors).toEqual([]);
});

test("an existing entity initializes its catalog and prepares an editable draft", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/document-catalog");
  await page.getByRole("button", { name: "Initialize document catalog", exact: true }).click();
  await expect(page.getByText("Document catalog initialized", { exact: true })).toBeVisible();
  const template = page.getByText("BC society constitution — preparation draft", { exact: true }).locator("..");
  await template.getByRole("button", { name: "Prepare draft", exact: true }).click();
  await expect(template.getByRole("link", { name: "Open Template Engine", exact: true })).toBeVisible();
  await template.getByRole("link", { name: "Open Template Engine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Template engine", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "BC society constitution — preparation draft", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
