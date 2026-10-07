import { readFileSync } from "node:fs";
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

// Word 97–2003 minutes (read in the browser), a policy and a further minutes file:
// accept everything in the run, Promote all ready, then the policy is a native record
// with "View source" and the run shows the finished panel. Synthetic content only.
test("intake reads .doc, promotes a policy and finishes the run with Promote all ready", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The three-pane review is exercised at desktop width.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  const { buildLegacyDoc } = await import("../scripts/lib/legacy-doc-fixture");
  const doc = buildLegacyDoc([
    { text: "Lakeside Clean Air Society – Board of Directors Minutes" },
    { text: "Date: April 8, 2025 (5:00 PM – 6:30 PM)" },
    { text: "Location: Northport Civic Centre, Committee Room" },
    { text: "Present: Avery Quill, Robin Vale, Jordan Pike" },
    { text: "Meeting called to order by the Chair at 5:02 PM." },
    { text: "MOTION: That the 2025 budget be approved. Moved by Robin Vale, seconded by Jordan Pike. CARRIED." },
    { text: "Meeting adjourned at 6:30 PM." },
  ]);
  const policy = [
    "Lakeside Clean Air Society",
    "Expense Approval Policy",
    "Policy number: FIN-07",
    "Adopted: March 3, 2025",
    "Review date: March 3, 2027",
    "",
    "1. Purpose",
    "This policy sets out who may approve expenses on behalf of the Society.",
    "2. Approval limits",
    "Expenses under $500 may be approved by the Treasurer. Expenses of $500 or more require approval by two directors.",
    "3. Records",
    "Receipts are kept with the financial records for seven years.",
  ].join("\n");

  await page.goto("/demo/app/intake", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "AI intake", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("intake-files-input").setInputFiles([
    { name: path.basename(files[0]), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: readFileSync(files[0]) },
    { name: "2025-04-08 Lakeside Board Minutes.doc", mimeType: "application/msword", buffer: Buffer.from(doc) },
    { name: "Lakeside Expense Approval Policy FIN-07.txt", mimeType: "text/plain", buffer: Buffer.from(policy) },
  ]);
  await expect(page.getByText("3 to extract")).toBeVisible();
  await page.getByRole("button", { name: /Start intake run/ }).click();
  const review = page.getByRole("link", { name: "Review results" });
  await expect(review).toBeVisible({ timeout: 120_000 });
  await review.click();
  await expect(page.getByTestId("intake-fields")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("intake-queue")).toContainText("Expense Approval Policy");
  await testInfo.attach("queue", { body: await page.screenshot(), contentType: "image/png" });

  // Accept every high-confidence value in the run, then promote everything that is ready.
  await page.getByTestId("intake-bulk-open").click();
  await page.getByText("Every document in the run").click();
  await page.getByTestId("intake-bulk-confirm").click();
  await page.getByTestId("intake-promote-all").click();
  const confirm = page.getByRole("dialog", { name: /Promote every ready document \(3\)/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Promote ready documents" }).click();
  await expect(page.getByTestId("intake-review-done")).toContainText("3 documents promoted", { timeout: 90_000 });
  await testInfo.attach("done", { body: await page.screenshot(), contentType: "image/png" });

  // The policy is a native record with field provenance.
  await page.goto("/demo/app/policies", { waitUntil: "domcontentloaded" });
  const row = page.getByRole("row", { name: /Expense Approval Policy/ });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTestId("view-source").click();
  const drawer = page.getByRole("dialog", { name: "Source of this record" });
  await expect(drawer).toContainText("Lakeside Expense Approval Policy FIN-07.txt");
  await expect(drawer).toContainText("policyName");

  // The .doc minutes became a meeting.
  await page.goto("/demo/app/meetings", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/2025-04-08|Apr(il)? 8, 2025/).first()).toBeVisible({ timeout: 60_000 });
  expect(runtimeErrors).toEqual([]);
});
