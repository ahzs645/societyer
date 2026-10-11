import { expect, test } from "@playwright/test";

// Polish retest: detail routes with a missing id show a not-found state (FF-2),
// and the record calendar can jump to its earliest and latest records (A6).
// Demo runtime, synthetic data only.

const missing = [
  "/demo/app/meetings/missing_meeting_id",
  "/demo/app/meetings/missing_meeting_id/preview",
  "/demo/app/meetings/missing_meeting_id/agm",
  "/demo/app/committees/missing_committee_id",
  "/demo/app/goals/missing_goal_id",
  "/demo/app/elections/missing_election_id",
  "/demo/app/people-directory/missing_person_id",
];

test("detail routes with a missing id show not found, never the error boundary", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  for (const path of missing) {
    await page.goto(path);
    await expect(page.locator("#main-content").getByText(/not found/i).first(), path).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".page-error"), path).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("record calendar jumps to the earliest and latest records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/meetings");
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  const calendar = page.locator(".calendar-view");
  await expect(calendar).toBeVisible();
  const title = calendar.locator(".calendar-view__title");
  await calendar.getByRole("button", { name: /^Jump to earliest record/ }).click();
  // The 2025 annual general meeting is the demo's earliest meeting.
  await expect(title).toHaveText(/June 2025/);
  await expect(calendar.locator(".calendar-view__event").first()).toBeVisible();
  await calendar.getByRole("button", { name: /^Jump to latest record/ }).click();
  await expect(title).not.toHaveText(/June 2025/);
  await expect(calendar.locator(".calendar-view__event").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
