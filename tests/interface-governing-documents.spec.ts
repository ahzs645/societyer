import { expect, test, type Page } from "@playwright/test";
import { chooseGuidedSetupAct } from "./helpers/guidedSetup";

/**
 * Governing documents on the organization profile, for a federal (CBCA)
 * corporation preparing incorporation: a document uploaded as "Other" is
 * chosen as the articles from the profile (and re-filed as articles), the
 * profile and the setup view agree it is on file, then it is unlinked and the
 * unlink undone. Runs on the desktop and phone projects.
 */

test.setTimeout(240_000);

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function createPreparingCbcaWorkspace(page: Page, name: string) {
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: /Start a new organization/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible({ timeout: 60_000 });
  await chooseGuidedSetupAct(page, false, { jurisdiction: "federal", act: "Canada Business Corporations Act" });
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/society/new"), { timeout: 90_000 });
}

test("a document filed as Other is chosen as the articles from the profile, then unlinked with undo", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const phone = info.project.name === "phone" || info.project.name === "narrow-phone";
  await createPreparingCbcaWorkspace(page, `Articles Probe ${info.project.name} Inc.`);

  // Upload a document as "Other": it is not the articles yet.
  await page.goto(`/app/documents?${new URLSearchParams({ intent: "new", category: "Other", title: "Draft articles from the lawyer" })}`);
  const documentDialog = page.getByRole("dialog");
  await expect(documentDialog.getByLabel("Category", { exact: true })).toContainText("Other");
  await documentDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible();

  await page.goto("/app/society");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  const articlesRow = page.locator(".society-doc-table tr", { hasText: "Articles" });
  await expect(articlesRow.getByText("Missing", { exact: true })).toBeVisible();
  await expect(articlesRow.getByRole("link", { name: "Upload Articles", exact: true })).toBeVisible();
  await fits(page);

  // Choose it as the articles. It isn't filed as articles, so re-filing is offered (on by default).
  await articlesRow.getByRole("button", { name: "Choose a document for Articles", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose the articles", exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole("searchbox", { name: "Search documents", exact: true }).fill("draft art");
  const option = picker.getByRole("radio", { name: /Draft articles from the lawyer/ });
  await expect(picker.getByText(/^Other · /).first()).toBeVisible();
  await option.check();
  const refile = picker.getByRole("checkbox", { name: /Also file it as Articles of incorporation/ });
  await expect(refile).toBeChecked();
  if (phone) {
    // A full-width sheet on phones.
    const box = await picker.boundingBox();
    expect(box && box.width).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 2);
  }
  await fits(page);
  await picker.getByRole("button", { name: "Use this document", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByText("Articles on file", { exact: true })).toBeVisible();

  // Articles — on file, with the document named and no "filed as" note (it was re-filed).
  await expect(articlesRow.getByText("On file", { exact: true })).toBeVisible();
  await expect(articlesRow.getByText("Draft articles from the lawyer", { exact: true })).toBeVisible();
  await expect(articlesRow.getByText(/now filed as/)).toHaveCount(0);
  await expect(articlesRow.getByRole("button", { name: "Replace Articles", exact: true })).toBeVisible();
  await fits(page);

  // The setup view agrees: the articles step is done.
  await page.goto("/app/organization-setup");
  await expect(page.locator("#step-articles")).toHaveClass(/setup-step--done/, { timeout: 30_000 });

  // Unlink, then undo.
  await page.goto("/app/society");
  await expect(articlesRow.getByText("On file", { exact: true })).toBeVisible();
  await articlesRow.getByRole("button", { name: "Unlink Articles", exact: true }).click();
  await expect(articlesRow.getByText("Missing", { exact: true })).toBeVisible();
  const toast = page.locator(".toast", { hasText: "Articles unlinked" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(articlesRow.getByText("On file", { exact: true })).toBeVisible();
  await expect(articlesRow.getByText("Draft articles from the lawyer", { exact: true })).toBeVisible();
  await fits(page);

  expect(errors).toEqual([]);
});
