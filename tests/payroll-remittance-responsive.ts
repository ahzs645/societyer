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
          if (el.closest(".payroll-calculator__table-wrap")) return false;
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
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.height < 44;
            })
            .map((el) => ({
              tag: el.tagName,
              text: el.textContent?.slice(0, 100),
              height: el.getBoundingClientRect().height,
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
export async function swipeRemittanceTable(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.use.hasTouch) return;
  const wrapper = page
    .getByRole("region", { name: "CRA obligations", exact: true })
    .locator(".payroll-calculator__table-wrap");
  await wrapper.scrollIntoViewIfNeeded();
  const rect = await wrapper.boundingBox();
  if (!rect)
    throw new Error("Remittance obligation table is not available to touch.");
  await wrapper.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const session = await page.context().newCDPSession(page);
  const point = (x: number) => [
    { x, y: rect.y + Math.min(rect.height / 2, 100) },
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(rect.x + rect.width - 20),
  });
  for (let step = 1; step <= 6; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        rect.x + rect.width - 20 - ((rect.width - 50) * step) / 6,
      ),
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
  await expect
    .poll(() => wrapper.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(20);
}
