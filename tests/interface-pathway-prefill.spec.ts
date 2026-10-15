import { expect, test, type Page } from "@playwright/test";
import { chooseGuidedSetupAct } from "./helpers/guidedSetup";

/**
 * The saved incorporation pathway for a federal (CBCA) corporation that is
 * still preparing: inputs come from the workspace ("From your workspace"),
 * typed values stay, and a solo founder records the review themselves.
 * Runs on the desktop and phone projects.
 */

test.setTimeout(300_000);

const CONFIRMATION = "No one else can review this; I've checked it myself";
const SHOTS = process.env.PATHWAY_SHOTS_DIR;

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function shot(page: Page, project: string, name: string, target = page.getByRole("region", { name: "Saved incorporation pathway" })) {
  if (!SHOTS) return;
  await target.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

test("a solo founder's pathway is filled in from the workspace and reviewed by the founder", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `Solo Pathway ${info.project.name} Inc.`;

  // Guided setup: a CBCA corporation that is preparing incorporation.
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click({ timeout: 60_000 });
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible({ timeout: 60_000 });
  await chooseGuidedSetupAct(page, false, { jurisdiction: "federal", act: "Canada Business Corporations Act" });
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup/, { timeout: 90_000 });

  // The name step: use a numbered name (the profile's numbered flag).
  await page.getByRole("button", { name: /^Choose your corporation's name/ }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Use a numbered name", exact: true }).first().click();
  await expect(page.getByText("Using a numbered name", { exact: true })).toBeVisible();

  // A proposed first director, with residency.
  await page.goto("/app/role-holders?role=director&setup=directors");
  const personDialog = page.getByRole("dialog", { name: "New role holder", exact: true });
  await expect(personDialog).toBeVisible({ timeout: 30_000 });
  await personDialog.getByLabel("Full name", { exact: true }).fill("Jane Founder");
  await personDialog.getByLabel("Citizenship/residency", { exact: true }).click();
  await page.getByRole("option", { name: /ordinarily resident in Canada/i }).first().click();
  await personDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Role holder saved", { exact: true })).toBeVisible();

  // The registered office, as a structured address.
  await page.goto("/app/society?intent=address");
  const addressDrawer = page.getByRole("dialog");
  await expect(addressDrawer.getByLabel("Street name", { exact: true })).toBeVisible({ timeout: 30_000 });
  await addressDrawer.getByLabel("Street #", { exact: true }).fill("100");
  await addressDrawer.getByLabel("Street name", { exact: true }).fill("Queen St");
  await addressDrawer.getByLabel("City / town", { exact: true }).fill("Ottawa");
  await addressDrawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(addressDrawer).toBeHidden();

  // A document to attach as the prepared packet.
  await page.goto("/app/society");
  await page.locator(".society-doc-table tr", { hasText: "Articles" }).getByRole("link", { name: "Upload Articles", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible();

  // The pathway shows the workspace's answers, marked with where they came from.
  await page.goto("/app/post-incorporation");
  const panel = page.getByRole("region", { name: "Saved incorporation pathway" });
  await panel.getByRole("button", { name: "Start pathway", exact: true }).click({ timeout: 60_000 });
  await expect(panel.getByRole("textbox", { name: "Proposed legal or working name" })).toHaveValue(name, { timeout: 30_000 });
  await expect(panel.getByRole("textbox", { name: "Registered office address" })).toHaveValue(/100 Queen St, Ottawa/);
  await expect(panel.getByRole("textbox", { name: "Initial directors and consent references" })).toHaveValue("Jane Founder (proposed, resident Canadian)");
  await expect(panel.getByRole("button", { name: /Use a named company/ })).toContainText("No");
  for (const [key, source] of [["proposedName", "Organization profile"], ["registeredOffice", "Registered office address"], ["directors", "Directors register"], ["namedCompany", "Organization profile"]] as const) {
    const input = panel.getByTestId(`pathway-input-${key}`);
    await expect(input).toHaveAttribute("data-source", "workspace");
    await expect(input.getByText("From your workspace", { exact: true })).toBeVisible();
    await expect(input.getByRole("link", { name: source, exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("link", { name: "Directors register", exact: true })).toHaveAttribute("href", "/app/role-holders?role=director");
  await shot(page, info.project.name, "prefilled", panel.locator("details").first());

  // Nothing in the workspace answers the share structure: type it. Typed values stay typed.
  await panel.getByRole("textbox", { name: "Share structure and subscription review reference" }).fill("One class of common shares");
  await panel.getByRole("button", { name: "Save pathway inputs" }).click();
  await expect(page.getByText("Pathway inputs saved", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("pathway-input-shareStructure")).toHaveAttribute("data-source", "user");
  await expect(panel.getByTestId("pathway-input-directors")).toHaveAttribute("data-source", "workspace");
  await fits(page);

  // Work through the run: the inputs freeze with their sources.
  await panel.getByTestId("pathway-node-collect-information").getByRole("button", { name: "Complete step" }).click();
  await expect(panel.getByRole("textbox", { name: "Registered office address" })).toBeDisabled();
  await expect(panel.getByTestId("pathway-input-directors").getByText("From your workspace", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("pathway-node-name-approval").getByText("Branch skipped", { exact: true })).toBeVisible();
  await panel.getByTestId("pathway-node-numbered-name").getByRole("button", { name: "Complete step" }).click();
  const prepare = panel.getByTestId("pathway-node-prepare-documents");
  await prepare.getByRole("button", { name: "Evidence for Prepare and review the incorporation document packet" }).click();
  await page.getByRole("option").filter({ hasNotText: "Select a workspace document" }).first().click();
  await prepare.getByRole("button", { name: "Complete step" }).click();
  await expect(prepare.getByText("Completed", { exact: true })).toBeVisible();

  // Solo founder: no second reviewer exists, so the founder confirms and records the review.
  const review = panel.getByTestId("pathway-node-review");
  await expect(review.getByRole("button", { name: "Approve review" })).toHaveCount(0);
  const selfReview = review.getByTestId("pathway-self-review");
  await expect(selfReview).toBeVisible();
  const record = review.getByRole("button", { name: "Record my review", exact: true });
  await expect(record).toBeDisabled();
  await selfReview.getByText(CONFIRMATION, { exact: true }).click();
  await expect(record).toBeEnabled();
  await review.scrollIntoViewIfNeeded();
  await shot(page, info.project.name, "self-review", review);
  await record.click();
  await expect(page.getByText("Your review is recorded", { exact: true })).toBeVisible();
  await expect(review.getByText("Approved", { exact: true })).toBeVisible();
  const recorded = review.getByTestId("pathway-self-review-record");
  await expect(recorded).toContainText("as the only person who could review it");
  await expect(recorded).toContainText(`Confirmed: “${CONFIRMATION}”`);
  await expect(panel.getByTestId("pathway-node-submit").getByRole("button", { name: "Record manual filing handoff" })).toBeVisible();
  const history = panel.getByTestId("pathway-history");
  await history.locator("summary").click();
  await expect(history).toContainText("Reviewed by the person who prepared it (no one else could review)");
  await expect(history).toContainText(CONFIRMATION);
  await review.scrollIntoViewIfNeeded();
  await shot(page, info.project.name, "self-reviewed", review);
  await fits(page);
  expect(errors).toEqual([]);
});
