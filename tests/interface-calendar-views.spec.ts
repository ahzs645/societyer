import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

test.setTimeout(100_000);
test.use({ timezoneId: "America/Vancouver" });
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator(".page").last().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test("calendar layouts save, discard and reload while dated records open their actual detail", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-03-08T20:00:00Z"));
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, "Calendar transaction workspace", true);
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.goto("/app/deadlines");
  await page.getByRole("button", { name: "New deadline", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add deadline", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill("Calendar source deadline");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  const calendar = page.locator(".calendar-view");
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  await expect(calendar.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(calendar.locator('[data-calendar-date="2026-03-08"]')).toContainText("Calendar source deadline");
  await calendar.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(calendar.getByRole("button", { name: "Calendar source deadline", exact: true })).toHaveCount(0);
  await calendar.getByRole("button", { name: "Previous week", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeHidden();
  await page.reload();
  await expect(calendar.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(calendar.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeHidden();
  await page.reload();
  await expect(calendar.getByRole("button", { name: "Agenda", exact: true })).toHaveAttribute("aria-pressed", "true");
  await fits(page);
  await calendar.getByRole("button", { name: "Calendar source deadline", exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  dialog = page.getByRole("dialog", { name: "Edit deadline", exact: true });
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue("Calendar source deadline");
  await dialog.getByLabel("Title", { exact: true }).fill("Edited calendar source deadline");
  await dialog.locator('[contenteditable="true"]').fill("Evidence retained through deferred editing.");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await calendar.getByRole("button", { name: "Edited calendar source deadline", exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  await expect(page.getByRole("dialog", { name: "Edit deadline", exact: true }).locator(".ProseMirror")).toContainText("Evidence retained through deferred editing.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await calendar.getByRole("button", { name: "Month", exact: true }).click();
  await fits(page);
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Save as", exact: true }).click();
  const saveAs = page.getByRole("dialog", { name: "Save as a new view", exact: true });
  await saveAs.getByRole("textbox").fill("Personal week agenda");
  await saveAs.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(saveAs).toBeHidden();
  await expect(page.locator(".record-table__view-button")).toContainText("Personal week agenda");
  await page.reload();
  // The saved view stays selected across a reload.
  await expect(page.locator(".record-table__view-button")).toContainText("Personal week agenda");
  await page.locator(".record-table__view-button").click();
  await page.getByRole("button", { name: "Personal week agenda", exact: true }).click();
  await expect(calendar.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await fits(page);
  expect(errors).toEqual([]);
});

test("task phone cards honor calendar and kanban selection and retain the record handoff", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-04-21T20:00:00Z"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/tasks");
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  const calendar = page.locator(".calendar-view");
  await expect(calendar).toBeVisible();
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  await expect(calendar.getByRole("region", { name: "Week calendar", exact: true })).toBeVisible();
  await fits(page);
  await calendar.locator(".calendar-view__event").first().click();
  const task = page.getByRole("dialog", { name: "Edit task", exact: true });
  await expect(task.getByLabel("Title", { exact: true })).toBeEnabled();
  await task.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Kanban view", exact: true }).click();
  await expect(calendar).toBeHidden();
  await expect(page.locator(".kanban")).toBeVisible();
  await page.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(page.locator(".kanban")).toBeHidden();
  await fits(page);
  expect(errors).toEqual([]);
});


test("Viewer can change the presentation and inspect a deadline while save and edit remain denied", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-04-18T20:00:00Z"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add user", exact: true });
  await form.getByLabel("Display name", { exact: true }).fill("Calendar Viewer");
  await form.getByLabel("Email", { exact: true }).fill("calendar-viewer@interface.example");
  await form.getByLabel("Role", { exact: true }).click();
  await page.getByRole("option", { name: "Viewer", exact: true }).click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
  const picker = page.getByTitle("Switch acting user", { exact: true });
  if (!await picker.isVisible()) await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
  await picker.click();
  await page.locator("span").filter({ hasText: /^Calendar Viewer$/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("combobox").fill("Deadlines");
  await palette.getByRole("option", { name: /^Deadlines/ }).first().click();
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  const calendar = page.locator(".calendar-view");
  await calendar.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save as", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New deadline", exact: true })).toBeDisabled();
  await calendar.locator(".calendar-view__event").first().click();
  await page.locator(".record-side-panel__open").click();
  const readonly = page.getByRole("dialog", { name: "View deadline", exact: true });
  await expect(readonly.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(readonly.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(readonly.locator(".ProseMirror")).toBeVisible();
  await expect(readonly.locator('[contenteditable="true"]')).toHaveCount(0);
  await readonly.getByRole("button", { name: "Cancel", exact: true }).click();
  await fits(page);
  expect(errors).toEqual([]);
});

// 2026-03-09T04:30Z is the evening of March 8 in Vancouver (UTC-7 after the
// DST change) but March 9 in UTC; pin the viewer's zone so the assertion
// holds on any machine (FF-3).
test.describe("viewer time zone", () => {
  test.use({ timezoneId: "America/Vancouver" });

  test("timestamp events use the viewer's day across DST and open only their owned meeting", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-03-09T04:00:00Z"));
    await page.goto("/demo/app/meetings");
    await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
    // Set an incoming offset-bearing timestamp through the ordinary authorized
    // local mutation, rather than mocking the calendar's query or bypassing ACLs.
    const title = await page.evaluate(async () => {
      const fixture = await window.__societyerE2E!.inspect();
      const modulePath = "/src/lib/localDataClient.ts";
      const { localDataClient } = await import(modulePath);
      const meetings = await localDataClient.query("meetings:list", { societyId: fixture.selectedSocietyId });
      const meeting = meetings.find((row: { type: string }) => row.type === "Board");
      await localDataClient.mutation("meetings:update", { id: meeting._id, patch: { scheduledAt: "2026-03-09T04:30:00Z" } });
      return meeting.title as string;
    });
    await page.getByRole("button", { name: "Calendar view", exact: true }).click();
    const calendar = page.locator(".calendar-view");
    await calendar.getByRole("button", { name: "Week", exact: true }).click();
    await expect(calendar.locator('[data-calendar-date="2026-03-08"]').getByRole("button", { name: title, exact: true })).toBeVisible();
    await expect(calendar.locator('[data-calendar-date="2026-03-09"]')).toHaveCount(0);
    await fits(page);
    await calendar.getByRole("button", { name: title, exact: true }).click();
    await page.locator(".record-side-panel__open").click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});


test("approved minutes download a valid searchable PDF after loading the deferred web renderer", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const vectorLoads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/src/lib/pdfVectorRenderer.ts")) vectorLoads.push(request.url()); });
  await page.goto("/demo/app/meetings/static_meeting_agm_2025");
  await expect(page.getByRole("heading", { name: "2025 annual general meeting", exact: true })).toBeVisible();
  expect(vectorLoads).toEqual([]);
  await page.getByRole("button", { name: /^(Actions|Meeting actions)$/ }).click();
  const ready = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download PDF", exact: true }).click();
  const download = await ready;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const file = testInfo.outputPath("approved-minutes.pdf");
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBeGreaterThan(0);
  const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  expect(text).toContain("2025 annual general meeting");
  expect(text).toMatch(/Adopted the agenda/i);
  expect(vectorLoads.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
