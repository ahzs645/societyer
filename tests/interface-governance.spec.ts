import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";
import { test, expect } from "@playwright/test";

function monitor(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}
async function fitsPage(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator(".page").last().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test("motion library loads cold, creates, edits and confirms deletion", async ({ page }) => {
  const errors = monitor(page);
  await page.goto("/demo/app/motion-library");
  await expect(page.getByRole("heading", { name: "Motions", exact: true })).toBeVisible();
  const editor = page.locator(".motion-library__editor");
  await expect(editor.getByRole("button", { name: "Add template", exact: true })).toBeDisabled();
  await editor.getByLabel("Title", { exact: true }).fill("Interface audit motion");
  await editor.locator("[contenteditable=true]").fill("BE IT RESOLVED THAT the interface audit be recorded.");
  await editor.getByRole("button", { name: "Add template", exact: true }).click();
  const template = page.locator(".motion-library__template").filter({ hasText: "Interface audit motion" });
  await expect(template).toHaveCount(1);
  await fitsPage(page);
  await template.getByRole("button", { name: "Edit Interface audit motion", exact: true }).click();
  await editor.getByLabel("Title", { exact: true }).fill("Edited interface audit motion");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  const edited = page.locator(".motion-library__template").filter({ hasText: "Edited interface audit motion" });
  await expect(edited).toHaveCount(1);
  await edited.getByRole("button", { name: "Delete Edited interface audit motion", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete motion template?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edited).toHaveCount(1);
  await edited.getByRole("button", { name: "Delete Edited interface audit motion", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete motion template?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(edited).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("people directory rejects blank names and retains saved edits on narrow screens", async ({ page }) => {
  const errors = monitor(page);
  await page.goto("/demo/app/people-directory");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  let form = page.getByRole("dialog", { name: "New person", exact: true });
  await expect(form.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await form.getByLabel("Full name", { exact: true }).fill("Interface Audit Person");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByLabel("Search people", { exact: true }).fill("Interface Audit");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  form = page.getByRole("dialog", { name: "Edit person", exact: true });
  await form.getByLabel("Full name", { exact: true }).fill("Interface Audit Person With A Long Name For A Narrow Phone");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText("Interface Audit Person With A Long Name For A Narrow Phone", { exact: true }).first()).toBeVisible();
  await fitsPage(page);
  expect(errors).toEqual([]);
});

test("AGM steps fit a narrow phone and local delivery actions remain honest", async ({ page }) => {
  const errors = monitor(page);
  await page.goto("/demo/app/meetings/static_meeting_agm_2025/agm");
  await expect(page.getByRole("heading", { name: "AGM workflow · 2025 annual general meeting", exact: true })).toBeVisible();
  await expect(page.getByText("Sending meeting notices requires a connected server. Prepare the notice and retain evidence of any delivery made outside the app.", { exact: true })).toBeVisible();
  await fitsPage(page);
  await page.goto("/demo/app/notifications");
  await expect(page.getByRole("button", { name: "Send digest", exact: true })).toBeDisabled();
  await expect(page.getByText("Email and SMS digests require a connected server. In-app notifications and reminders remain available here.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  await expect(page.getByText("Marked all read", { exact: true })).toBeVisible();
  await fitsPage(page);
  expect(errors).toEqual([]);
});

test("minutes preview preserves the demo workspace in a new tab", async ({ page }) => {
  const errors = monitor(page);
  await page.goto("/demo/app/meetings/static_meeting_agm_2025?tab=minutes");
  await expect(page.getByRole("heading", { name: "2025 annual general meeting", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const popupEvent = page.context().waitForEvent("page");
  await page.getByRole("menuitem", { name: "Open preview page", exact: true }).click();
  const popup = await popupEvent;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toContain("/demo/app/meetings/static_meeting_agm_2025/preview");
  await expect(popup.getByText("2025 annual general meeting", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});


test("acting Member sees own access without a roster and cannot edit member or meeting records", async ({ page }) => {
  test.setTimeout(70_000);
  const errors = monitor(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  await completeGuidedOrganizationSetup(page, "Interface access society", true);
  await page.goto("/app/members");
  await page.getByRole("button", { name: "New member", exact: true }).click();
  const memberForm = page.getByRole("dialog", { name: "Add member", exact: true });
  await memberForm.getByLabel("First name", { exact: true }).fill("Audit");
  await memberForm.getByLabel("Last name", { exact: true }).fill("ReadOnly");
  await memberForm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(memberForm).toHaveCount(0);
  await expect(page.getByText("Audit", { exact: true }).first()).toBeVisible();
  await page.goto("/app/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Interface Member");
  await page.getByLabel("Email", { exact: true }).fill("interface-member@example.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const picker = page.getByTitle("Switch acting user", { exact: true });
  if (!(await picker.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
  await picker.click();
  await page.locator("span").filter({ hasText: /^Interface Member$/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Your role does not permit viewing the workspace roster. Your own access is shown above.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add user", exact: true })).toHaveCount(0);
  await page.goto("/app/members");
  await expect(page.getByRole("button", { name: "New member", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  await page.getByRole("button", { name: "Audit", exact: true }).click();
  const memberView = page.getByRole("dialog", { name: "View member", exact: true });
  await expect(memberView.getByLabel("First name", { exact: true })).toBeDisabled();
  await expect(memberView.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(memberView.locator("[contenteditable=true]")).toHaveCount(0);
  await memberView.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/app/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeDisabled();
  await page.goto("/app/elections");
  await expect(page.getByRole("heading", { name: "Elections", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New election", exact: true })).toHaveCount(0);
  await page.goto("/app/financials");
  await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
  await page.goto("/app/meetings");
  await expect(page.getByRole("button", { name: "New meeting", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  if (!(await picker.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
  await picker.click();
  await page.getByText("Owner", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "New meeting", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
