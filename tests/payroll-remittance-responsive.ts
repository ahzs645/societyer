import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
export async function activateRemittance(locator: Locator) {
  if (await locator.page().evaluate(() => navigator.maxTouchPoints > 0))
    await locator.tap();
  else await locator.click();
}
/**
 * Runs a remittance list row's action. Desktop rows show the button itself;
 * phone cards keep their row actions behind the card's "Row actions for …"
 * menu, as every shared record list does.
 */
export async function remittanceRowAction(list: Locator, name: string, rowText?: string) {
  const rows = list.locator("tr.record-table__row, .record-phone-card-shell");
  const row = rowText ? rows.filter({ hasText: rowText }).first() : rows.first();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = row.getByRole("button", { name: new RegExp(`^(${escaped}|Row actions for .+)$`) }).first();
  await expect(target).toBeVisible();
  const label = (await target.getAttribute("aria-label")) ?? "";
  await activateRemittance(target);
  if (label.startsWith("Row actions for "))
    await activateRemittance(list.page().getByRole("menuitem", { name, exact: true }));
}
export async function inspectRemittance(
  page: Page,
  testInfo: TestInfo,
  stage: string,
  focus?: Locator,
) {
  if (!testInfo.project.name) return;
  if (focus) await focus.scrollIntoViewIfNeeded();
  const directory = `/workspace/scratch/payroll-responsive-remittance-screenshots/${testInfo.project.name}`;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${stage}.png`, fullPage: true });
  const layout = await page
    .getByRole("region", { name: "CRA remittances", exact: true })
    .evaluate((panel) => {
      const viewport = document.documentElement.clientWidth,
        touch = navigator.maxTouchPoints > 0;
      const mainPage =
        document.querySelector<HTMLElement>('[role="main"] .page') ??
        document.querySelector<HTMLElement>("main .page");
      const mainRect = mainPage?.getBoundingClientRect();
      const spills = [
        ...panel.querySelectorAll<HTMLElement>(
          "input:not([type=checkbox]),textarea,select,button,summary,dl,details,.field,p,dt,dd,h2,h3,h4,label,li,fieldset",
        ),
      ]
        .filter((el) => {
          // Table scroll regions and the shared record lists scroll their own content.
          if (el.closest(".payroll-calculator__table-wrap, .record-list-table")) return false;
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.left < -1 || rect.right > viewport + 1)
          );
        })
        .map((el) => ({
          tag: el.tagName,
          text: el.textContent?.slice(0, 120),
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
        }));
      const smallTargets = touch
        ? [
            ...panel.querySelectorAll<HTMLElement>(
              "button,input:not([type=checkbox]),select,textarea,summary",
            ),
          ]
            // Layout height: the button just tapped can still be in its
            // pressed state (scale 0.96), which shrinks its rect but not
            // its touch target.
            .filter((el) => {
              // Record list controls reach 44px through an invisible hit
              // area (_control-density.scss), not a taller box.
              if (el.closest(".record-list-table")) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && el.offsetHeight < 44;
            })
            .map((el) => ({
              tag: el.tagName,
              text: el.textContent?.slice(0, 100),
              height: el.offsetHeight,
            }))
        : [];
      return {
        viewport,
        windowWidth: window.innerWidth,
        mainPage: mainRect
          ? {
              left: mainRect.left,
              width: mainRect.width,
              clientWidth: mainPage!.clientWidth,
              scrollWidth: mainPage!.scrollWidth,
            }
          : null,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        panelWidth: panel.clientWidth,
        panelScrollWidth: panel.scrollWidth,
        panelLeft: panel.getBoundingClientRect().left,
        spills,
        smallTargets,
      };
    });
  await testInfo.attach(`${stage}-layout`, {
    body: JSON.stringify(layout, null, 2),
    contentType: "application/json",
  });
  expect(
    layout.documentWidth,
    `${stage}: document must fit ${layout.viewport}px viewport`,
  ).toBeLessThanOrEqual(layout.viewport + 1);
  if (layout.mainPage)
    expect(
      layout.mainPage.left + layout.mainPage.width,
      `${stage}: the main page stays inside the layout viewport`,
    ).toBeLessThanOrEqual(layout.viewport + 1);
  expect(
    layout.bodyWidth,
    `${stage}: body must fit viewport`,
  ).toBeLessThanOrEqual(layout.viewport + 1);
  expect(
    layout.panelLeft + layout.panelScrollWidth,
    `${stage}: content outside table scroll regions must fit the viewport`,
  ).toBeLessThanOrEqual(layout.viewport + 1);
  expect(
    layout.spills,
    `${stage}: non-table controls remain inside viewport`,
  ).toEqual([]);
  expect(
    layout.smallTargets,
    `${stage}: controls provide 44px touch targets`,
  ).toEqual([]);
}
/**
 * Phones show each CRA obligation as a card: nothing in the obligations list
 * may need a sideways swipe, and each card names its period, due date and
 * amount.
 */
export async function expectRemittanceCards(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.use.hasTouch) return;
  const list = page
    .getByRole("region", { name: "CRA obligations", exact: true })
    .locator(".record-list-table");
  await list.scrollIntoViewIfNeeded();
  const fit = await list.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(fit.scroll, "obligations fit without a sideways swipe").toBeLessThanOrEqual(fit.client + 1);
  const firstCard = list.locator(".record-phone-card").first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard).toContainText(/Due \d{4}-\d{2}-\d{2}|Schedule unconfirmed/);
  await expect(firstCard).toContainText("$");
}
