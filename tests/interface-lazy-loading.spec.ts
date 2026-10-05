import { expect, test, type Page } from "@playwright/test";

async function openAuthorizedDashboard(page: Page) {
  await page.goto("/demo/app");
  await expect(page.locator(".app-shell")).toBeVisible();
  // Rendering the shell precedes the authorized actor query. A forged event
  // before this resolves is intentionally ignored by the permission gate.
  await expect(page.getByTitle("Switch acting user", { exact: true })).toContainText("Owner");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

const createDialogs = [
  { event: "quickaction:add-task", title: "New task" },
  { event: "quickaction:add-asset", title: "New asset" },
  { event: "quickaction:create-meeting", title: "Schedule meeting" },
  { event: "quickaction:add-commitment", title: "New commitment" },
];

for (const { event, title } of createDialogs) {
  test(`cold ${title} event loads its form once and remains usable`, async ({ page }) => {
    const errors: string[] = [];
    const requestedAssets: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/assets/")) requestedAssets.push(path);
    });
    await openAuthorizedDashboard(page);
    await expect(page.locator(".page").first()).toBeVisible();
    // A read-only dashboard should not pay for rich editing code. The original
    // shared shell eagerly loaded this bundle through every global create form.
    expect(requestedAssets.filter((path) => /MarkdownEditor/.test(path))).toEqual([]);
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), event);
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), event);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input").first()).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("a cold shortcut opens the deferred palette and subsequent shortcuts still toggle it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openAuthorizedDashboard(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeHidden();
  await page.keyboard.press("/");
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  expect(errors).toEqual([]);
});

test("a cold assistant open event survives its deferred renderer import", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openAuthorizedDashboard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant", exact: true });
  await expect(assistant).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assistant).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("societyer-ai:open")));
  await expect(assistant).toBeVisible();
  expect(errors).toEqual([]);
});
