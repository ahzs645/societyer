import { expect, test, type Page } from "@playwright/test";
import { chooseGuidedSetupAct } from "./helpers/guidedSetup";

/**
 * The pages organization setup steps link to, for a federal (CBCA)
 * corporation that is still preparing incorporation: the profile, documents,
 * corporation people, the share register and the dashboard's legal checks.
 * Runs on the desktop and phone projects.
 */

test.setTimeout(240_000);

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function createPreparingCbcaWorkspace(page: Page, name: string) {
  await page.goto("/setup");
  // The storage choice is worded for any organization, not only a society.
  await expect(page.getByText("Best for a small organization with one or two people keeping the records.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible({ timeout: 60_000 });
  await chooseGuidedSetupAct(page, false, { jurisdiction: "federal", act: "Canada Business Corporations Act" });
  await expect(page.getByText("Step 4 of 5", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  // Optional questions the founder never opened are not shown as answers.
  await page.getByText("Add governance notes now", { exact: false }).click();
  await expect(page.getByLabel("Shareholder / share class structure", { exact: true })).toContainText("Not answered");
  await expect(page.getByLabel("Directors, officers and shareholders", { exact: true })).toContainText("Not answered");
  await fits(page);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/society/new"), { timeout: 90_000 });
}

test("setup destinations work for a corporation that is preparing incorporation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const phone = info.project.name === "phone" || info.project.name === "narrow-phone";
  await createPreparingCbcaWorkspace(page, `Destination Probe ${info.project.name} Inc.`);

  // Profile: the proposed name and fiscal year end edit freely, one status shows,
  // and the registered-office link opens the collapsed details section.
  await page.goto("/app/society#registered-office");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Proposed name", exact: true })).toBeEditable();
  await expect(page.getByRole("button", { name: /^Unlock / })).toHaveCount(0);
  await expect(page.getByText("Preparing incorporation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Organization status", { exact: true })).toHaveCount(0);
  await expect(page.locator("#more-organization-details")).toHaveJSProperty("open", true);
  await expect(page.locator("#registered-office")).toBeInViewport();
  await page.locator("#more-organization-details > summary").click();
  await expect(page.locator("#more-organization-details")).toHaveJSProperty("open", false);
  await page.getByRole("link", { name: "Manage", exact: true }).click();
  await expect(page.locator("#more-organization-details")).toHaveJSProperty("open", true);
  await expect(page.getByRole("button", { name: "Address", exact: true })).toBeInViewport();
  if (phone) {
    // The formatting toolbar scrolls sideways with a faded edge.
    await expect(page.locator(".markdown-editor__toolbar").first()).toHaveAttribute("data-overflow", "end");
  }
  await fits(page);
  const articlesRow = page.locator(".society-doc-table tr", { hasText: "Articles" });
  await expect(articlesRow.getByText("Missing", { exact: true })).toBeVisible();

  // Documents: a corporation files articles, not a constitution; uploading them puts them on file.
  await articlesRow.getByRole("link", { name: "Upload Articles", exact: true }).click();
  const documentDialog = page.getByRole("dialog");
  await expect(documentDialog.getByLabel("Category", { exact: true })).toContainText("Articles of incorporation");
  await documentDialog.getByLabel("Category", { exact: true }).click();
  await expect(page.getByRole("option", { name: "Certificate of incorporation", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Constitution", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Articles of incorporation", exact: true }).click();
  await documentDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible();
  await page.goto("/app/society");
  await expect(page.locator(".society-doc-table tr", { hasText: "Articles" }).getByText("On file", { exact: true })).toBeVisible();

  // Corporation people: setup's deep link opens the add form, preset and proposed.
  await page.goto("/app/role-holders?role=director&setup=directors");
  const personDialog = page.getByRole("dialog", { name: "New role holder", exact: true });
  await expect(personDialog).toBeVisible();
  await expect(personDialog.getByLabel("Role type", { exact: true })).toContainText("Director");
  await expect(personDialog.getByLabel("Status", { exact: true })).toContainText("Proposed");
  await expect(personDialog.getByText("Membership ID", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/setup=directors/);
  await personDialog.getByLabel("Full name", { exact: true }).fill("Jane Founder");
  await personDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Role holder saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Corporation register", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add a shareholder", exact: true }).click();
  await expect(personDialog.getByLabel("Role type", { exact: true })).toContainText("Shareholder");
  // No share class exists yet, so none is assigned.
  await expect(personDialog.getByLabel("Share class", { exact: true })).toHaveValue("");
  await personDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await fits(page);

  // Share register: CBCA wording, no par value, and actions on screen at phone width.
  await page.goto("/app/rights-ledger");
  await expect(page.getByRole("heading", { name: "Share register", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Share class", exact: true }).click();
  const classDialog = page.getByRole("dialog", { name: "New share class", exact: true });
  await expect(classDialog).toBeVisible();
  await expect(classDialog.getByText("From the articles of incorporation. Blank = no maximum.", { exact: true })).toBeVisible();
  await expect(classDialog.getByText("notice of articles", { exact: false })).toHaveCount(0);
  await expect(classDialog.getByLabel("Par value ($)", { exact: true })).toHaveCount(0);
  await expect(classDialog.getByLabel("Status", { exact: true })).toContainText("Proposed");
  await classDialog.getByLabel("Class name", { exact: true }).fill("Common");
  await classDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Share class saved", { exact: true })).toBeVisible();
  const classRow = page.locator(".rights-ledger-table").first().locator("tbody tr", { hasText: "Common" });
  await expect(classRow.getByRole("button", { name: "Edit", exact: true })).toBeInViewport();
  await expect(classRow.getByRole("button", { name: "Split", exact: true })).toBeInViewport();
  await fits(page);

  // Dashboard: no statutory red flags before the certificate.
  await page.goto("/app");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Fewer than \d+ active legal directors/)).toHaveCount(0);
  await expect(page.getByText(/confirmed resident Canadian director/)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("profile locks are visible, tappable buttons on an incorporated organization", async ({ page }) => {
  await page.goto("/demo/app/society");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible({ timeout: 60_000 });
  const unlock = page.getByRole("button", { name: "Unlock Legal name", exact: true });
  await expect(unlock).toBeVisible();
  expect(await unlock.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect(page.getByRole("textbox", { name: "Legal name", exact: true })).toBeDisabled();
  await unlock.click();
  const confirm = page.getByRole("dialog", { name: "Unlock this field?", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Legal name", exact: true })).toBeEditable();
});
