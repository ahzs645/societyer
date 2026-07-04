import { expect, test } from "@playwright/test";
import { MembersPage } from "./pom/membersPage";
import { RecordTablePage } from "./pom/recordTablePage";

// A phone-sized viewport that sits below the 760px card breakpoint, plus a
// desktop control size to prove the treatment is viewport-driven rather than
// always-on.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

test.describe("record table mobile view", () => {
  test("on a phone the table drops selection + drag columns and freezes the first column", async ({ page }) => {
    await page.setViewportSize(PHONE);

    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);

    // Leading structural columns are dropped so the name column is flush left.
    await expect(table.bodySelectionCheckboxes()).toHaveCount(0);
    await expect(table.dragHandles()).toHaveCount(0);

    // The first (name) column is frozen while the rest scroll sideways.
    expect(await table.firstBodyCellPosition()).toBe("sticky");
    expect(await table.scrollContainerOverflowX()).toBe("auto");
  });

  test("on desktop the selectable table keeps its selection + drag columns", async ({ page }) => {
    await page.setViewportSize(DESKTOP);

    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);

    // The Members demo table is `selectable`, so on a wide screen both leading
    // structural columns are present — the mobile treatment is not applied.
    await expect(table.bodySelectionCheckboxes().first()).toBeVisible();
    await expect(table.dragHandles().first()).toBeVisible();
  });

  test("the frozen first column stays pinned when the table is scrolled sideways", async ({ page }) => {
    await page.setViewportSize(PHONE);

    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    const firstCell = table.firstBodyCell();
    await expect(firstCell).toBeVisible();

    const before = await firstCell.boundingBox();
    await table.scrollContainer().evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    // Let the scroll settle before re-measuring.
    await page.waitForTimeout(150);
    const after = await firstCell.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // A sticky column keeps its on-screen x position as the body scrolls.
    expect(Math.abs((after!.x ?? 0) - (before!.x ?? 0))).toBeLessThan(2);
  });

  test("caps the frozen first column so it doesn't dominate the phone width", async ({ page }) => {
    await page.setViewportSize(PHONE);

    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    const box = await table.firstBodyCell().boundingBox();
    expect(box).not.toBeNull();
    // The column carries an inline width from the field size (e.g. 240px). On a
    // 390px phone that would swallow the viewport; it must be capped to well
    // under half so the other columns get room. Still wide enough to be usable.
    expect(box!.width).toBeLessThan(PHONE.width * 0.55);
    expect(box!.width).toBeGreaterThan(60);
  });

  test("shows an edge-fade affordance so a wide table reads as scrollable, not cut off", async ({ page }) => {
    await page.setViewportSize(PHONE);

    const members = new MembersPage(page);
    await members.gotoDemo();

    const table = new RecordTablePage(page);
    const frame = table.scrollFrame();

    // At rest there is more content off the right edge — the right fade shows.
    await expect(frame).toHaveClass(/is-scrolled-right/);
    await expect(frame).not.toHaveClass(/is-scrolled-left/);

    // Scroll to the far right: the right fade clears and the left one appears.
    await table.scrollTableToEnd();
    await expect(frame).toHaveClass(/is-scrolled-left/);
    await expect(frame).not.toHaveClass(/is-scrolled-right/);
  });
});
