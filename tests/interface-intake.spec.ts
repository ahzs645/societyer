import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// AI-led intake end to end on synthetic documents (tests/fixtures/intake/files):
// upload three files → run the in-browser pipeline → review → bulk accept →
// promote → the meeting exists and shows its field provenance ("View source").
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "intake", "files");
const files = ["2025-05-13_Board_Minutes_APPROVED.docx", "2025_03_04_Operations_Committee_Minutes.pdf", "Executive Committee Minutes 2025-02-11.txt"].map((name) => path.join(fixtures, name));

test.setTimeout(150_000);

test("intake run → review → accept → promote creates a meeting with provenance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The three-pane review is exercised at desktop width.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/demo/app/intake", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "AI intake", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("intake-files-input").setInputFiles(files);
  await expect(page.getByText("3 to extract")).toBeVisible();
  await page.getByRole("button", { name: /Start intake run/ }).click();
  const review = page.getByRole("link", { name: "Review results" });
  await expect(review).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".intake-stage--done", { hasText: "Fields extracted" })).toContainText("3");
  await review.click();

  // The board minutes (six motions) lead the risk-ordered queue.
  const fields = page.getByTestId("intake-fields");
  await expect(fields).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("intake-queue").locator("[aria-current=true]")).toContainText("2025-05-13_Board_Minutes_APPROVED.docx");

  // Clicking a field highlights its source span.
  await page.locator('[data-path="date"]').click();
  await expect(page.locator("mark.intake-hl").first()).toBeVisible({ timeout: 20_000 });

  // Bulk accept (sampled preview), then edit one field; required fields become ready.
  await page.getByTestId("intake-bulk-open").click();
  await expect(page.getByTestId("intake-bulk-sample").locator("li")).toHaveCount(5);
  await page.getByTestId("intake-bulk-confirm").click();
  await expect(page.locator('[data-path="date"]')).toHaveAttribute("data-decision", "accept");
  await page.locator('[data-path="location"]').getByRole("button", { name: /^Edit/ }).click();
  await page.locator('[data-path="location"]').getByRole("textbox").fill("Committee Room, Northport Civic Centre");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect(page.locator('[data-path="location"]')).toHaveAttribute("data-decision", "edit");

  // Promote through the import path.
  await page.getByTestId("intake-promote-open").click();
  await page.getByTestId("intake-promote-confirm").click();
  const openMeeting = page.getByRole("button", { name: "Open meeting" });
  await expect(openMeeting).toBeVisible({ timeout: 60_000 });
  await openMeeting.click();

  await expect(page).toHaveURL(/\/app\/meetings\//);
  const viewSource = page.getByTestId("view-source");
  await expect(viewSource).toBeVisible({ timeout: 30_000 });
  await viewSource.click();
  const drawer = page.getByRole("dialog", { name: "Source of this record" });
  await expect(drawer).toContainText("2025-05-13_Board_Minutes_APPROVED.docx");
  await expect(drawer).toContainText("scheduledAt");
  await expect(drawer).toContainText("“May 13, 2025”");
  await expect(drawer).toContainText("edited by reviewer");
  await expect(drawer).toContainText("Committee Room, Northport Civic Centre");
  await testInfo.attach("meeting-provenance", { body: await page.screenshot(), contentType: "image/png" });
  expect(runtimeErrors).toEqual([]);
});
