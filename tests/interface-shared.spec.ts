import { expect, test, type Locator, type Page } from "@playwright/test";

// Multi-route and role-switch scenarios include several cold development loads.
// Keep assertion deadlines strict while allowing the whole lifecycle to finish.
test.setTimeout(90_000);

async function expectInViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  // Drawers animate into place; assess their settled interactive bounds.
  await expect.poll(async () => {
    const bounds = await locator.boundingBox();
    const viewport = page.viewportSize()!;
    return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
  }).toBe(true);
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectPaintedControlOnTop(control: Locator) {
  await expect(control).toBeVisible();
  await expect.poll(() => control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const topbar = document.querySelector<HTMLElement>(".mobile-topbar");
    const wasInert = topbar?.inert;
    // Inert elements still paint, but browsers omit them from hit testing.
    // Measure the painted stacking order without that omission, then restore
    // accessibility state synchronously before any user interaction occurs.
    if (topbar) topbar.inert = false;
    try {
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    } finally {
      if (topbar) topbar.inert = Boolean(wasInert);
    }
  })).toBe(true);
}

test("an open resizable dialog keeps its controls reachable when the viewport shrinks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo/app/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expectInViewport(page, modal);
  await page.setViewportSize({ width: 1024, height: 500 });
  await expectInViewport(page, modal);
  await expectPaintedControlOnTop(modal.getByRole("button", { name: "Close", exact: true }));
  await testInfo.attach("short-viewport-dialog", { body: await page.screenshot(), contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("long record titles leave confirmation actions reachable without page overflow", async ({ page }, testInfo) => {
  const title = `Shared responsive audit ${"VeryLongMeetingName".repeat(8)}`;
  await page.goto("/demo/app/meetings");
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Schedule meeting", exact: true });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(title);
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
  await testInfo.attach("long-title-toast", { body: await page.screenshot(), contentType: "image/png" });
  await page.goto("/demo/app/meetings");
  const row = page.locator(".record-table__row").filter({ hasText: title });
  await row.getByRole("button", { name: "Actions for this meeting", exact: true }).click();
  const actions = page.getByRole("menu");
  await expect(actions).toBeVisible();
  const scroller = page.locator(".record-table__scroll");
  const canScroll = await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 30);
  if (canScroll) {
    await scroller.evaluate((element) => { element.scrollLeft = 30; });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(30);
    await expect(actions).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `Delete "${title}"?`, exact: true });
  await expectInViewport(page, confirmation);
  await expectInViewport(page, confirmation.getByRole("button", { name: "Close", exact: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await testInfo.attach("long-title-confirmation", { body: await page.screenshot(), contentType: "image/png" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(row).toBeVisible();
});

test("date and time picker closes without losing an unsaved meeting drawer", async ({ page }) => {
  await page.goto("/demo/app/meetings");
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Schedule meeting", exact: true });
  await drawer.getByRole("textbox", { name: "Title", exact: true }).fill("Unsaved date and time audit");
  const scheduled = drawer.getByRole("button", { name: "Scheduled", exact: true });
  await scheduled.click();
  const picker = page.getByRole("dialog", { name: "Date and time picker", exact: true });
  await expectInViewport(page, picker);
  await drawer.locator(".drawer__body").evaluate((element) => { element.scrollTop = 30; });
  await expectInViewport(page, picker);
  await expect(picker.getByRole("button", { name: "Previous month", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(picker.getByRole("button", { name: "Done", exact: true })).toBeFocused();
  await picker.getByLabel("Hour", { exact: true }).selectOption("10");
  await picker.getByLabel("Minute", { exact: true }).selectOption("35");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Unsaved date and time audit");
  await expect(scheduled).toBeFocused();
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("drawer and modal headers paint above mobile chrome and close by touch", async ({ page }) => {
  await page.goto("/demo/app/society");
  await page.getByText("More organization details", { exact: false }).click();
  const address = page.getByRole("button", { name: "Address", exact: true });
  await address.click();
  const drawer = page.getByRole("dialog", { name: "New address", exact: true });
  await expectInViewport(page, drawer);
  await expectPaintedControlOnTop(drawer.getByRole("heading", { name: "New address", exact: true }));
  const closeDrawer = drawer.getByRole("button", { name: "Close drawer", exact: true });
  await expectPaintedControlOnTop(closeDrawer);
  if (page.viewportSize()!.width < 980) {
    await expect(page.locator(".mobile-topbar")).toHaveAttribute("inert", "");
    await closeDrawer.tap();
  } else await closeDrawer.click();
  await expect(drawer).toBeHidden();
  await expect(address).toBeFocused();
  if (page.viewportSize()!.width < 980) await expect(page.locator(".mobile-topbar")).not.toHaveAttribute("inert", "");

  await page.keyboard.press("?");
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expectInViewport(page, modal);
  await expectPaintedControlOnTop(modal.getByRole("heading", { name: "Keyboard shortcuts", exact: true }));
  const closeModal = modal.getByRole("button", { name: "Close", exact: true });
  await expectPaintedControlOnTop(closeModal);
  if (page.viewportSize()!.width < 980) await closeModal.tap();
  else await closeModal.click();
  await expect(modal).toBeHidden();
});

test("shared navigation and command palette contain keyboard focus and restore it", async ({ page }) => {
  await page.goto("/demo/app/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 980) {
    const more = page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true });
    await more.click();
    const navigation = page.getByRole("dialog", { name: "navigation", exact: true });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("button").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(navigation.getByRole("button").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(more).toBeFocused();
  }
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.click();
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  const input = palette.getByRole("combobox", { name: "Command palette search" });
  await expect(input).toBeFocused();
  await expectInViewport(page, palette);
  await page.keyboard.press("Shift+Tab");
  expect(await palette.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await input.fill("Members");
  await expect(palette.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(search).toBeFocused();
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expectInViewport(page, shortcuts);
  await expect(shortcuts.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(shortcuts.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();
});

test("nested date and selection controls close independently of their record drawer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/members");
  const create = page.getByRole("button", { name: "New member", exact: true });
  await create.click();
  const drawer = page.getByRole("dialog", { name: "Add member", exact: true });
  await expectInViewport(page, drawer);
  const joined = drawer.getByLabel("Joined", { exact: true });
  const before = await joined.innerText();
  await joined.click();
  const calendar = page.getByRole("dialog", { name: "Date picker", exact: true });
  await expectInViewport(page, calendar);
  await expect(calendar.locator(".calendar__cell.is-active")).toBeFocused();
  const focused = await calendar.locator(".calendar__cell.is-active").getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  await expect(calendar.locator(".calendar__cell.is-active")).toBeFocused();
  await expect(calendar.locator(".calendar__cell.is-active")).not.toHaveAttribute("aria-label", focused!);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("Enter");
  await expect(calendar).toBeHidden();
  await expect(joined).not.toHaveText(before);
  await expect(joined).toBeFocused();
  await joined.click();
  await expect(calendar).toBeVisible();
  const currentMonth = await calendar.locator(".calendar__cell.is-active").getAttribute("aria-label");
  await calendar.getByRole("button", { name: "Next month", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(calendar).toBeVisible();
  await expect(calendar.locator(".calendar__cell.is-active")).not.toHaveAttribute("aria-label", currentMonth!);
  await calendar.getByRole("button", { name: "Choose month", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole("grid", { name: "Month", exact: true }).getByRole("button", { name: "Jan", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(joined).toBeFocused();
  const province = drawer.getByLabel("Province / state", { exact: true });
  await province.click();
  const choices = page.getByRole("listbox");
  await expect(choices).toBeVisible();
  expect(await choices.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(choices).toBeHidden();
  await expect(drawer).toBeVisible();
  const membershipClass = drawer.getByLabel("Class", { exact: true });
  await membershipClass.click();
  await expect(choices).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(choices).toBeHidden();
  await expect(drawer.getByLabel("Status", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(create).toBeFocused();
  expect(errors).toEqual([]);
});

test("record table menus fit the viewport and alternate views retain usable controls", async ({ page }) => {
  await page.goto("/demo/app/members");
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  const statusCell = page.locator(".record-table__row").first().locator('[data-field-name="status"]');
  const originalStatus = await statusCell.innerText();
  if (page.viewportSize()!.width <= 760) await statusCell.tap();
  else await statusCell.dblclick();
  const editorOptions = page.getByRole("listbox");
  await expect(editorOptions).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(editorOptions).toBeHidden();
  await expect(page.locator(".record-table__cell-editor-popover")).toHaveCount(0);
  await expect(statusCell).toBeFocused();
  await expect(statusCell).toHaveText(originalStatus);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const options = page.getByRole("dialog", { name: "Table options", exact: true });
  await expectInViewport(page, options);
  await options.getByRole("radio", { name: "Comfortable", exact: true }).click();
  await expect(options.getByRole("radio", { name: "Comfortable", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  const sort = page.getByRole("dialog", { name: "Sort records", exact: true });
  await expectInViewport(page, sort);
  await sort.getByRole("button", { name: "Add sort", exact: true }).click();
  await expectInViewport(page, sort);
  await page.keyboard.press("Escape");
  await expect(sort).toBeHidden();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expectInViewport(page, page.locator(".record-table__filter-popover"));
  await page.getByTitle("Kanban view", { exact: true }).click();
  await expect(page.locator(".kanban")).toBeVisible();
  await page.getByTitle("Calendar view", { exact: true }).click();
  await expect(page.locator(".calendar-view")).toBeVisible();
  await page.getByTitle("Table view", { exact: true }).click();
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("saved view writes stay disabled for Member and Viewer while local sorting remains available", async ({ page }) => {
  await page.goto("/demo/app/users");
  for (const role of ["Member", "Viewer"]) {
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Add user", exact: true });
    await form.getByLabel("Display name", { exact: true }).fill(`Interface Table ${role}`);
    await form.getByLabel("Email", { exact: true }).fill(`table-${role.toLowerCase()}@interface.example`);
    if (role === "Viewer") {
      await form.getByLabel("Role", { exact: true }).click();
      await page.getByRole("option", { name: "Viewer", exact: true }).click();
    }
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toBeHidden();
  }
  // Preserve this tab's acting-user choice by navigating through the router.
  const openPicker = async () => {
    const picker = page.getByTitle("Switch acting user", { exact: true });
    if (!await picker.isVisible()) await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
    await picker.click();
  };
  const closeNavigation = async () => {
    if (page.viewportSize()!.width < 980) await page.keyboard.press("Escape");
  };
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("combobox").fill("Members");
  await palette.getByRole("option", { name: /^Members/ }).first().click();
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  for (const role of ["Member", "Viewer"]) {
    await openPicker();
    await page.getByRole("listbox", { name: "Acting user", exact: true }).getByText(`Interface Table ${role}`, { exact: true }).click();
    await closeNavigation();
    await expect(page.locator(".record-table__row").first()).toBeVisible();
    await page.locator(".record-table__header-row").getByRole("button", { name: "First name", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save as", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Select records", exact: true })).toHaveCount(0);
    await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  }
  await openPicker();
  await page.getByText("Owner", { exact: true }).click();
  await closeNavigation();
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  await page.locator(".record-table__header-row").getByRole("button", { name: "First name", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save as", exact: true })).toBeEnabled();
});


test("phone touch selection reaches bulk actions without changing the default frozen table", async ({ page }) => {
  await page.goto("/demo/app/members");
  await expect(page.locator(".record-table__row").first()).toBeVisible();
  const select = page.getByRole("button", { name: "Select records", exact: true });
  if (page.viewportSize()!.width > 760) {
    await expect(select).toHaveCount(0);
    await expect(page.locator(".record-table__checkbox-cell").first()).toBeVisible();
    return;
  }
  await expect(page.locator(".record-table__checkbox-cell")).toHaveCount(0);
  await expect(page.locator(".record-table__mobile-selection-checkbox")).toHaveCount(0);
  await select.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(select).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Exit selection", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(select).toBeVisible();
  await expect(page.getByRole("region", { name: "Bulk actions", exact: true })).toHaveCount(0);
  await select.tap();
  const checkboxes = page.locator(".record-table__mobile-selection-checkbox input");
  await expect.poll(() => checkboxes.first().evaluate((element) => element.closest("td")!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => checkboxes.first().evaluate((element) => element.closest("label")!.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
  await checkboxes.nth(0).tap();
  await checkboxes.nth(1).tap();
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bulk = page.getByRole("region", { name: "Bulk actions", exact: true });
  await expect(bulk).toContainText("2 selected");
  await bulk.scrollIntoViewIfNeeded();
  await expectInViewport(page, bulk);
  await bulk.getByRole("button", { name: "Edit", exact: true }).tap();
  const edit = page.getByRole("dialog");
  await expectInViewport(page, edit);
  await edit.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(edit).toBeHidden();
  await page.getByRole("button", { name: "Exit selection", exact: true }).tap();
  await expect(bulk).toHaveCount(0);
  await expect(checkboxes).toHaveCount(0);
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".record-table__checkbox-cell")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("workflow preparation is readable for Viewer while workflow and package writes stay disabled", async ({ page }) => {
  await page.goto("/demo/app/workflow-packages");
  await page.getByRole("button", { name: "New package", exact: true }).click();
  const packageForm = page.getByRole("dialog");
  await packageForm.getByLabel("Package name", { exact: true }).fill("Interface permission package");
  await packageForm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(packageForm).toBeHidden();
  await expect(page.getByText("Interface permission package", { exact: true })).toBeVisible();
  await page.goto("/demo/app/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add user", exact: true });
  await form.getByLabel("Display name", { exact: true }).fill("Workflow Interface Viewer");
  await form.getByLabel("Email", { exact: true }).fill("workflow-viewer@interface.example");
  await form.getByLabel("Role", { exact: true }).click();
  await page.getByRole("option", { name: "Viewer", exact: true }).click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
  const picker = page.getByTitle("Switch acting user", { exact: true });
  if (!await picker.isVisible()) await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
  await picker.click();
  await page.locator("span").filter({ hasText: /^Workflow Interface Viewer$/ }).click();
  await expect(picker).toContainText("Viewer");
  if (page.viewportSize()!.width < 980) await page.keyboard.press("Escape");
  const navigate = async (name: string) => {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await palette.getByRole("combobox").fill(name);
    await palette.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
  };
  await navigate("Workflows");
  await expect(page.getByRole("button", { name: "New workflow", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Pause|Resume)$/, includeHidden: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Remove /, includeHidden: true }).first()).toBeDisabled();
  await page.locator(".record-table__identifier-button").first().click();
  const preview = page.getByRole("dialog");
  if (await preview.count()) await preview.getByRole("button", { name: /^Open/ }).click();
  await expect(page.getByRole("button", { name: "Add Node", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Pause|Activate)$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeDisabled();
  await expect(page.locator(".workflow-sidepanel fieldset")).toHaveAttribute("disabled", "");
  await navigate("Workflow packages");
  await expect(page.getByRole("button", { name: "New package", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Task", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete workflow package", exact: true }).first()).toBeDisabled();
});

test("row actions stay reachable by touch for receipt, workflow, insurance and asset callbacks", async ({ page }, testInfo) => {
  const touch = Boolean(testInfo.project.use.hasTouch);
  const activate = async (control: Locator) => {
    await control.scrollIntoViewIfNeeded();
    if (touch) {
      const bounds = await control.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await control.tap();
    } else await control.click();
  };
  await page.goto("/demo/app/receipts");
  await page.getByRole("button", { name: "Issue receipt", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Issue donation receipt", exact: true });
  await form.getByLabel("Charity registration #", { exact: true }).fill("000000000RR0001");
  await form.getByLabel("Donor name", { exact: true }).fill("Synthetic touch row action receipt");
  await form.getByLabel("Amount", { exact: true }).fill("100");
  await form.getByLabel("Eligible amount", { exact: true }).fill("100");
  await form.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(form).toBeHidden();
  const receipt = page.locator("tr", { hasText: "Synthetic touch row action receipt" });
  await activate(receipt.getByRole("button", { name: "Void", exact: true }));
  await page.getByPlaceholder("Reason (required)").fill("Synthetic interface regression; no real donation");
  await page.getByRole("button", { name: "Void receipt", exact: true }).click();
  await expect(receipt).toContainText("Voided");
  await page.reload();
  await expect(receipt).toContainText("Voided");
  await page.goto("/demo/app/workflows");
  const workflow = page.locator(".record-table__row").first();
  const run = workflow.getByRole("button", { name: "Run now", exact: true });
  await expect(run).toBeVisible();
  await expect(run).toBeDisabled();
  const pause = workflow.getByRole("button", { name: /^(Pause|Resume)$/ });
  const initialLabel = await pause.innerText();
  await activate(pause);
  await expect(pause).not.toHaveText(initialLabel);
  await activate(pause);
  await expect(pause).toHaveText(initialLabel);
  await page.goto("/demo/app/insurance");
  await activate(page.locator(".record-table__row").first().getByRole("button", { name: "Edit", exact: true }));
  const policy = page.getByRole("dialog", { name: "Edit policy", exact: true });
  await expect(policy).toBeVisible();
  await policy.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/demo/app/assets");
  if (page.viewportSize()!.width <= 760) {
    await page.locator(".asset-mobile-card").first().getByRole("button", { name: "Edit", exact: true }).tap();
  } else {
    await activate(page.locator(".record-table__row").first().getByRole("button", { name: "Actions for this asset", exact: true }));
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  }
  const asset = page.getByRole("dialog", { name: "Edit asset", exact: true });
  await expect(asset).toBeVisible();
  await asset.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
