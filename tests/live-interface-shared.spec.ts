import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLiveFits, signInLive } from "./helpers/liveInterface";

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Live shared surfaces must not emit uncaught runtime errors").toEqual([]);
});

async function expectInsideViewport(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await expect.poll(async () => {
    const bounds = await control.boundingBox();
    const viewport = page.viewportSize()!;
    return Boolean(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
  }).toBe(true);
}

test("live shared navigation and command palette retain keyboard focus on every viewport", async ({ page }, testInfo) => {
  await signInLive(page);
  await page.goto("/app/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 980) {
    const more = page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true });
    await more.tap();
    const navigation = page.getByRole("dialog", { name: "navigation", exact: true });
    await expectInsideViewport(page, navigation);
    await page.keyboard.press("Shift+Tab");
    expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(more).toBeFocused();
  }
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.click();
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expectInsideViewport(page, palette);
  await expect(palette.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await palette.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expectInsideViewport(page, shortcuts);
  await testInfo.attach("live-shared-shortcuts", { body: await page.screenshot(), contentType: "image/png" });
  await shortcuts.getByRole("button", { name: "Close", exact: true }).click();
  await assertLiveFits(page);
});

test("live member drawer keeps nested date and selection controls usable without committing a record", async ({ page }, testInfo) => {
  await signInLive(page);
  await page.goto("/app/members");
  const create = page.getByRole("button", { name: "New member", exact: true });
  await create.click();
  const drawer = page.getByRole("dialog", { name: "Add member", exact: true });
  await expectInsideViewport(page, drawer);
  const joined = drawer.getByLabel("Joined", { exact: true });
  await joined.click();
  const calendar = page.getByRole("dialog", { name: "Date picker", exact: true });
  await expectInsideViewport(page, calendar);
  await page.keyboard.press("ArrowRight");
  await expect(calendar.locator(".calendar__cell.is-active")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(joined).toBeFocused();
  await drawer.getByLabel("Province / state", { exact: true }).click();
  const choices = page.getByRole("listbox");
  await expectInsideViewport(page, choices);
  await page.keyboard.press("Escape");
  await expect(choices).toBeHidden();
  await expect(drawer).toBeVisible();
  await testInfo.attach("live-member-drawer", { body: await page.screenshot(), contentType: "image/png" });
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(create).toBeFocused();
  await assertLiveFits(page);
});

test("live Viewer may sort locally but cannot edit rows or save shared views", async ({ page }) => {
  await signInLive(page, "Viewer");
  await page.goto("/app/members");
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New member", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select records", exact: true })).toHaveCount(0);
  await page.locator(".record-table__header-row").getByRole("button", { name: "First name", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save as", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await expectInsideViewport(page, page.getByRole("dialog", { name: "Table options", exact: true }));
  await page.keyboard.press("Escape");
  await assertLiveFits(page);
});

test("live open resizable dialog refits a short desktop viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInLive(page);
  await page.goto("/app/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expectInsideViewport(page, modal);
  await page.setViewportSize({ width: 1024, height: 500 });
  await expectInsideViewport(page, modal);
  await expectInsideViewport(page, modal.getByRole("button", { name: "Close", exact: true }));
  await testInfo.attach("live-refitted-modal", { body: await page.screenshot(), contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("live long meeting title keeps saved feedback and confirmation controls within the viewport", async ({ page }, testInfo) => {
  await signInLive(page);
  const title = `Live shared ${testInfo.project.name} ${Date.now()} ${"VeryLongMeetingName".repeat(8)}`;
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Schedule meeting", exact: true });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  // Pick a distinct future date through the actual calendar control.
  const projectDay = ["narrow-phone", "phone", "tablet", "desktop"].indexOf(testInfo.project.name) + 10;
  await form.getByRole("button", { name: "Scheduled", exact: true }).click();
  const calendar = page.locator(".calendar--with-time");
  await calendar.locator(".calendar__nav").last().click();
  await calendar.locator(".calendar__cell:not(.is-out)").filter({ hasText: new RegExp(`^${projectDay}$`) }).click();
  await calendar.getByRole("button", { name: "Done", exact: true }).click();
  await form.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(form).toBeHidden();
  await page.waitForURL(/\/meetings\/[^/?]+$/);
  const toast = page.getByRole("status").filter({ hasText: "Meeting scheduled" });
  // Toasts expire. Capture all feedback geometry atomically while visible,
  // before later navigation/screenshot work can consume their display time.
  await expect(toast).toBeVisible();
  const toastGeometry = await toast.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, fitsContent: element.scrollWidth <= element.clientWidth + 1, width: innerWidth, height: innerHeight };
  });
  expect(toastGeometry.left).toBeGreaterThanOrEqual(-1);
  expect(toastGeometry.top).toBeGreaterThanOrEqual(-1);
  expect(toastGeometry.right).toBeLessThanOrEqual(toastGeometry.width + 1);
  expect(toastGeometry.bottom).toBeLessThanOrEqual(toastGeometry.height + 1);
  expect(toastGeometry.fitsContent).toBe(true);
  await testInfo.attach("live-long-title-feedback", { body: await page.screenshot(), contentType: "image/png" });
  await page.goto("/app/meetings");
  const row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByRole("button", { name: "Actions for this meeting", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `Delete "${title}"?`, exact: true });
  await expectInsideViewport(page, confirmation);
  await expectInsideViewport(page, confirmation.getByRole("button", { name: "Close", exact: true }));
  await assertLiveFits(page);
  await testInfo.attach("live-long-title-confirmation", { body: await page.screenshot(), contentType: "image/png" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Actions for this meeting", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("live date and time picker preserves an unsaved meeting when dismissed by keyboard", async ({ page }) => {
  await signInLive(page);
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Schedule meeting", exact: true });
  await drawer.getByRole("textbox", { name: "Title", exact: true }).fill("Unsaved live date and time audit");
  const scheduled = drawer.getByRole("button", { name: "Scheduled", exact: true });
  await scheduled.click();
  const picker = page.getByRole("dialog", { name: "Date and time picker", exact: true });
  await expectInsideViewport(page, picker);
  await drawer.locator(".drawer__body").evaluate((element) => { element.scrollTop = 30; });
  await expectInsideViewport(page, picker);
  await expect(picker.getByRole("button", { name: "Previous month", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(picker.getByRole("button", { name: "Done", exact: true })).toBeFocused();
  await picker.getByLabel("Hour", { exact: true }).selectOption("10");
  await picker.getByLabel("Minute", { exact: true }).selectOption("35");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Unsaved live date and time audit");
  await expect(scheduled).toBeFocused();
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await assertLiveFits(page);
});

test("live vault stores and reveals synthetic bytes only for permitted actors", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const title = `Live vault authority ${testInfo.project.name} ${Date.now()}`;
  const value = `synthetic-browser-qualification-${testInfo.project.name}`;
  await signInLive(page);
  await page.goto("/app/secrets");
  await page.getByRole("button", { name: "New access record", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "New access record", exact: true });
  await drawer.getByLabel("Record name", { exact: true }).fill(title);
  await drawer.getByLabel("Service", { exact: true }).fill("Disposable qualification service");
  await drawer.getByLabel("Value", { exact: true }).fill(value);
  await drawer.getByLabel("Reveal access", { exact: true }).click();
  await page.getByRole("option", { name: "Owner only", exact: true }).click();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).toBeHidden();
  let row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByText(title, { exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  drawer = page.getByRole("dialog", { name: "Edit access record", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Reveal stored value", exact: true })).toBeEnabled();
  await drawer.getByRole("button", { name: "Reveal stored value", exact: true }).click();
  await expect(drawer.locator("input.mono")).toHaveValue(value);
  await assertLiveFits(page);
  await drawer.getByLabel("Service", { exact: true }).fill("Updated disposable qualification service");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByText(title, { exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  drawer = page.getByRole("dialog", { name: "Edit access record", exact: true });
  await expect(drawer.getByLabel("Service", { exact: true })).toHaveValue("Updated disposable qualification service");
  await drawer.getByRole("button", { name: "Reveal stored value", exact: true }).click();
  await expect(drawer.locator("input.mono")).toHaveValue(value);
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  await signInLive(page, "Admin");
  await page.goto("/app/secrets");
  row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByText(title, { exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  drawer = page.getByRole("dialog", { name: "Edit access record", exact: true });
  await expect(drawer.getByRole("button", { name: "Reveal stored value", exact: true })).toBeDisabled();
  await expect(drawer.getByLabel("Reveal access", { exact: true })).toBeDisabled();
  await expect(drawer.getByLabel("Linked user", { exact: true })).toBeDisabled();
  await expect(drawer.getByLabel("Primary custodian", { exact: true })).toBeDisabled();
  await expect(drawer.getByLabel("Replace value", { exact: true })).toBeDisabled();
  await expect(drawer.getByLabel("Service", { exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(drawer.locator("input.mono")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  await signInLive(page, "Viewer");
  await page.goto("/app/secrets");
  await expect(page.getByRole("button", { name: "New access record", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  row = page.locator(".record-table__row").filter({ hasText: title });
  await expect(row.getByRole("button", { name: `Delete access custody record ${title}`, exact: true })).toBeDisabled();
  await row.getByText(title, { exact: true }).click();
  await page.locator(".record-side-panel__open").click();
  drawer = page.getByRole("dialog", { name: "Access record", exact: true });
  await expect(drawer.getByLabel("Record name", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Reveal stored value", exact: true })).toBeDisabled();
  await expect(drawer.locator("input.mono")).toHaveCount(0);
  await assertLiveFits(page);
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();

  await signInLive(page);
  await page.goto("/app/secrets");
  row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByRole("button", { name: `Delete access custody record ${title}`, exact: true }).click();
  await expect(row).toHaveCount(0);
});
