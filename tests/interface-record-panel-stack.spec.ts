import { expect, test, type Page } from "@playwright/test";

// The presentation document links to the 2025 AGM; the Q2 board meeting
// lists directors as attendees, which link on to their member records.
const DOCUMENT_URL = "/demo/app/documents?record=static_document_needs_presentation";
const STACKED_URL = `${DOCUMENT_URL}&stack=mtg.static_meeting_board_q2`;

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 769;

async function openPanel(page: Page, url = DOCUMENT_URL) {
  await page.goto(url);
  const panel = page.locator(".record-side-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.describe("record panel card stack", () => {
  test("related records stack as cards with back, carousel, close-one and a deep link", async ({ page }) => {
    const panel = await openPanel(page);
    const meeting = panel.locator(".record-side-panel__linked .entity-chip").first();
    await expect(meeting).toContainText("2025 annual general meeting");

    await meeting.click();
    const position = panel.locator(".record-panel-stack__position");
    await expect(position).toHaveText("2 of 2");
    await expect(panel.getByRole("navigation", { name: "Stacked cards" })).toBeVisible();
    await expect(page).toHaveURL(/stack=mtg\.static_meeting_agm_2025/);
    await expect(page.locator(".hover-card")).toHaveCount(0);

    await panel.locator(".record-panel-stack__back").click();
    await expect(position).toHaveText("1 of 2");
    await expect(page).not.toHaveURL(/stack=/);
    await panel.getByRole("button", { name: "Next card" }).click();
    await expect(position).toHaveText("2 of 2");

    if (!isPhone(page)) {
      await panel.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(position).toHaveText("1 of 2");
      await page.keyboard.press("ArrowRight");
      await expect(position).toHaveText("2 of 2");
      // Esc closes only the visible card; the table record stays open.
      await page.keyboard.press("Escape");
    } else {
      await panel.getByRole("button", { name: "Close card" }).click();
    }
    await expect(panel).toBeVisible();
    await expect(position).toHaveCount(0);
    await expect(page).not.toHaveURL(/stack=/);
  });

  test("a deep link reopens the stack and cards keep stacking", async ({ page }) => {
    const panel = await openPanel(page, STACKED_URL);
    const position = panel.locator(".record-panel-stack__position");
    await expect(position).toHaveText("2 of 2");
    const attendee = panel.locator(".entity-preview__related .entity-chip").first();
    await expect(attendee).toBeVisible();
    await attendee.click();
    await expect(position).toHaveText("3 of 3");
    await expect.poll(() => new URL(page.url()).searchParams.get("stack")).toMatch(/^mtg\.static_meeting_board_q2~d\./);

    await panel.getByRole("button", { name: /Options/ }).click();
    await page.getByRole("menuitem", { name: "Close all cards" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/record=/);
  });

  test("the panel minimises to a dock, restores, and expands to full screen", async ({ page }) => {
    const panel = await openPanel(page, STACKED_URL);
    await panel.getByRole("button", { name: "Minimise" }).click();
    await expect(panel).toHaveCount(0);
    const dock = page.getByRole("region", { name: "Minimised record panel" });
    await expect(dock).toBeVisible();
    await expect(dock.locator(".record-panel-dock__restore")).toBeFocused();
    await dock.locator(".record-panel-dock__restore").click();
    await expect(panel).toBeVisible();
    await expect(dock).toHaveCount(0);
    await expect(panel.locator(".record-panel-stack__position")).toHaveText("2 of 2");

    const before = await panel.boundingBox();
    await panel.getByRole("button", { name: "Full screen" }).click();
    await expect(panel).toHaveClass(/record-side-panel--fullscreen/);
    const after = await panel.boundingBox();
    expect(after!.width).toBeGreaterThanOrEqual(before!.width);
    if (!isPhone(page)) expect(after!.width).toBeGreaterThan(before!.width + 200);
    await panel.getByRole("button", { name: "Exit full screen" }).click();
    await expect(panel).not.toHaveClass(/record-side-panel--fullscreen/);
  });
});

test.describe("hover cards", () => {
  test("open after a pause on hover or keyboard focus and close on leave or Esc", async ({ page }) => {
    test.skip(isPhone(page), "Touch devices never show hover cards");
    const panel = await openPanel(page);
    const meeting = panel.locator(".record-side-panel__linked .entity-chip").first();
    const card = page.locator(".hover-card");

    await meeting.hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Quorum");
    await page.mouse.move(4, 400);
    await expect(card).toHaveCount(0);

    await meeting.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(panel).toBeVisible();
  });

  test("never open on touch; a tap opens the record instead", async ({ page }) => {
    test.skip(!isPhone(page), "Touch-only behaviour");
    await page.goto("/demo/app/members");
    const name = page.locator(".record-table__row[data-row-index='0'] [data-field-name='firstName'] .record-table__identifier-button").first();
    await expect(name).toBeVisible();
    await name.tap();
    await page.waitForTimeout(600);
    await expect(page.locator(".hover-card")).toHaveCount(0);
  });
});
