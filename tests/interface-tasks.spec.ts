import { expect, test } from "@playwright/test";

const fits = async (page: import("@playwright/test").Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
};

test("tasks list groups work, edits rows in place and keeps a checklist", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-04-21T20:00:00Z"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/tasks");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.getByRole("button", { name: /^To do/ })).toHaveAttribute("aria-expanded", "true");
  await fits(page);

  // Inline add inherits the group: added under "To do" it is a to-do.
  await page.getByRole("button", { name: "Add task to To do", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "New task title", exact: true });
  const title = `Book the hall ${testInfo.project.name}`;
  await composer.fill(title);
  await composer.press("Enter");
  const row = page.locator(".task-row", { hasText: title });
  await expect(row).toBeVisible();
  await composer.press("Escape");

  // Status and priority change in place from the row.
  await row.getByRole("button", { name: /Change status/ }).click();
  await page.getByRole("menuitem", { name: /In progress/ }).click();
  await expect(page.locator(".task-group", { hasText: "In progress" }).locator(".task-row", { hasText: title })).toBeVisible();
  await row.getByRole("button", { name: /Change priority/ }).click();
  await page.getByRole("menuitem", { name: /Urgent/ }).click();
  await expect(row.locator(".task-priority-icon--Urgent")).toBeVisible();

  // The drawer's checklist saves straight away and shows progress on the row.
  await row.locator(".task-row__title-text").click();
  const drawer = page.getByRole("dialog", { name: "Edit task", exact: true });
  const step = drawer.getByRole("textbox", { name: "Add a checklist step", exact: true });
  await step.fill("Call the community centre");
  await step.press("Enter");
  await step.fill("Confirm the deposit");
  await step.press("Enter");
  await drawer.getByRole("checkbox", { name: /Tick Call the community centre/ }).check();
  await expect(row.getByText("1/2", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  // Completing offers an undo that restores the previous status.
  await row.hover();
  await row.getByRole("button", { name: `Actions for task ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Mark complete", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".task-group", { hasText: "In progress" }).locator(".task-row", { hasText: title })).toBeVisible();

  // The board groups by status; a saved list grouping survives a reload.
  await page.getByRole("button", { name: "Kanban view", exact: true }).click();
  await expect(page.locator(".task-board__col", { hasText: "In progress" }).locator(".task-card", { hasText: title })).toBeVisible();
  await fits(page);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByRole("button", { name: "Group tasks by", exact: true }).click();
  await page.getByRole("option", { name: "Due date", exact: true }).click();
  await page.reload();
  await expect(page.locator(".task-group__label", { hasText: "Overdue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Group tasks by", exact: true })).toContainText("Due date");
  await fits(page);
  expect(errors).toEqual([]);
});
