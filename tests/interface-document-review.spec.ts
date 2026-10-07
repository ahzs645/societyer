import { expect, test, type Page } from "@playwright/test";

/**
 * Documents and import review (WP-I): the cross-session review queue with
 * keyboard decisions, confirmations that name counts, distinguishable session
 * names, and duplicate/version detection on documents created from imports.
 * Synthetic data only, staged through the "New session" bundle drawer.
 */
test.setTimeout(150_000);

async function visit(page: Page, route: string) {
  await page.goto(`/demo/app/${route}`, { waitUntil: "networkidle" });
}

function field(page: Page, label: string) {
  return page.locator(".field").filter({ has: page.locator(".field__label").filter({ hasText: new RegExp(`^${label}$`) }) }).first().locator("input,textarea").first();
}

async function stageBundle(page: Page, name: string, bundle: unknown) {
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await field(page, "Session name").fill(name);
  await field(page, "Import JSON").fill(JSON.stringify(bundle));
  const ownership = page.getByRole("checkbox", { name: /I reviewed the source ownership/ });
  if (await ownership.count()) await ownership.check();
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

function reviewedCount(text: string) {
  return Number((text.match(/^([\d,]+)/)?.[1] ?? "0").replace(/,/g, ""));
}

const sha = (c: string) => c.repeat(64);

test("one review queue across sessions: keyboard decisions, focus, progress and confirmed destructive actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "imports");
  await stageBundle(page, "Synthetic queue batch 1", {
    meetingMinutes: [{ title: "Synthetic board minutes without a date", meetingTitle: "Synthetic board minutes without a date" }],
    sources: [
      { title: "Synthetic newsletter 2015-04.pdf", externalId: "synthetic:news-1", sourceDate: "2015-04-01", extractedText: "Spring newsletter ".repeat(10) },
      { title: "Synthetic payroll 2019.xlsx", externalId: "synthetic:payroll-1", sourceDate: "2019-01-31", extractedText: "Payroll register ".repeat(10) },
    ],
  });
  await stageBundle(page, "Synthetic queue batch 2", {
    sources: [{ title: "Synthetic annual report 2016.pdf", externalId: "synthetic:report-1", sourceDate: "2016-06-30", extractedText: "Annual report ".repeat(10) }],
  });

  // Session names keep the part that tells sibling batches apart.
  await expect(page.locator(".import-session-row", { hasText: "queue batch 1" }).first()).toBeVisible();
  await expect(page.locator(".import-session-row", { hasText: "queue batch 2" }).first()).toBeVisible();

  // One queue over both sessions, highest priority first (clear the session
  // filter that creating a session applies).
  await page.locator(".import-session-row.is-active").first().click();
  await expect(page.locator(".import-session-row.is-active")).toHaveCount(0);
  await page.getByLabel("Search candidates").fill("Synthetic");
  await expect(page.locator(".import-queue__count")).toHaveText(/of 4 matching/);
  const rows = page.locator(".import-queue-row");
  await expect(rows.first()).toContainText("Synthetic board minutes without a date");
  await expect(rows.first()).toContainText("High priority");
  await expect(rows.first()).toContainText("missing meeting date");
  await expect(page.locator(".import-queue-row", { hasText: "Synthetic payroll 2019.xlsx" })).toContainText("payroll");
  await expect(page.locator(".import-queue-row", { hasText: "queue batch 2" })).toHaveCount(1);

  // Keyboard: j moves, a approves and moves on, focus stays in the queue.
  const before = reviewedCount(await page.locator(".import-queue__progress-text").innerText());
  const list = page.getByRole("listbox", { name: "Import candidates" });
  await list.focus();
  await page.keyboard.press("j");
  const second = await page.locator(".import-queue-row.is-focused strong").innerText();
  await page.keyboard.press("a");
  await expect(page.locator(".import-queue-row.is-focused strong")).not.toHaveText(second);
  await expect(page.locator(".import-queue__count")).toHaveText(/of 3 matching/);
  await expect.poll(async () => reviewedCount(await page.locator(".import-queue__progress-text").innerText())).toBe(before + 1);
  await expect(list).toBeFocused();
  await page.keyboard.press("r");
  await expect(page.locator(".import-queue__count")).toHaveText(/of 2 matching/);
  await expect(list).toBeFocused();
  await page.keyboard.press("e");
  await expect(page.getByRole("dialog")).toContainText("Review import record");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Bulk decisions name their count and can be cancelled.
  await page.getByRole("button", { name: "Approve 2 shown", exact: true }).click();
  const bulk = page.getByRole("dialog", { name: /Approve 2 shown candidates\?/ });
  await expect(bulk).toContainText("2 records across");
  await bulk.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".import-queue__count")).toHaveText(/of 2 matching/);

  // Deleting a session names what is lost (batch 1 still has pending records,
  // so it stays in the Active track).
  await page.locator(".import-session-row", { hasText: "queue batch 1" }).first().click();
  await page.getByRole("button", { name: "Delete session…", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: /Delete import session "Synthetic queue batch 1"\?/ });
  await expect(confirmation).toContainText("3 staged records");
  await expect(confirmation).toContainText("cannot be undone");
  await confirmation.getByRole("button", { name: "Delete session and 3 records", exact: true }).click();
  await expect(page.getByText("Import session removed", { exact: true })).toBeVisible();
  await expect(page.locator(".import-session-row", { hasText: "queue batch 1" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("documents created from imports show duplicates, versions and normalized categories, and copies merge with confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "imports");
  const candidate = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    fileName: title,
    externalId: `synthetic:${title.replace(/\W+/g, "-").toLowerCase()}`,
    sourceExternalIds: [`synthetic:${title.replace(/\W+/g, "-").toLowerCase()}`],
    sections: ["financials"],
    extractedText: `${title} text`,
    ...extra,
  });
  await stageBundle(page, "Synthetic document versions", {
    documentMap: [
      candidate("Synthetic consent package.pdf", { sha256: sha("a"), category: "financial-statement" }),
      candidate("Synthetic consent package copy.pdf", { sha256: sha("a"), category: "Financial Statement" }),
      candidate("Synthetic minutes 2031-03-04 DRAFT.docx", { category: "Minutes" }),
      candidate("Synthetic minutes 2031-03-04 APPROVED.pdf", { category: "Minutes" }),
    ],
  });
  await page.getByLabel("Search candidates").fill("Synthetic");
  await expect(page.locator(".import-queue__count")).toHaveText(/of 4 matching/);
  await page.getByRole("button", { name: "Approve 4 shown", exact: true }).click();
  await page.getByRole("dialog", { name: /Approve 4 shown candidates\?/ }).getByRole("button", { name: "Approve 4", exact: true }).click();
  await expect(page.locator(".import-queue__count")).toHaveText(/No candidates match/);
  await page.getByRole("button", { name: /Create docs/ }).click();
  await expect(page.getByText(/4 document records created/)).toBeVisible();

  await visit(page, "documents?show=duplicates");
  await expect(page.getByRole("button", { name: /^Financial statement/ })).toBeVisible();
  const duplicateRow = page.locator(".document-title-cell", { hasText: "Synthetic consent package" }).first();
  await expect(duplicateRow).toBeVisible();
  await expect(page.locator(".document-title-cell", { hasText: "Synthetic consent package" })).toHaveCount(2);
  await expect(page.locator(".document-title-cell", { hasText: "2 copies" }).first()).toBeVisible();

  await visit(page, "documents?show=versions");
  await expect(page.locator(".document-title-cell", { hasText: "Synthetic minutes 2031-03-04" })).toHaveCount(2);
  await expect(page.locator(".document-title-cell", { hasText: "2 versions" }).first()).toBeVisible();

  // Merge the copies from the versions panel.
  await visit(page, "documents?show=duplicates");
  await page.locator(".document-title-cell", { hasText: "Synthetic consent package copy.pdf" }).first().click();
  // The row opens the record side panel; "Open" goes to the review page.
  await page.locator("button", { hasText: /^Open/ }).last().click();
  await expect(page.getByRole("heading", { name: "Versions and duplicates" })).toBeVisible();
  await expect(page.getByText("Same file (identical bytes)")).toBeVisible();
  await page.getByRole("button", { name: "Merge copies into the kept record" }).click();
  const merge = page.getByRole("dialog", { name: "Merge 1 duplicate copy?" });
  await expect(merge).toContainText("Nothing is deleted");
  await merge.getByRole("button", { name: "Merge duplicates", exact: true }).click();
  await expect(page.getByText("Duplicates merged", { exact: true })).toBeVisible();
  await visit(page, "documents?show=duplicates");
  await expect(page.locator(".document-title-cell", { hasText: "Synthetic consent package" })).toHaveCount(1);
  expect(errors).toEqual([]);
});
