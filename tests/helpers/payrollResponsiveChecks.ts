import { expect, type Page, type TestInfo } from "@playwright/test";
const errors = new WeakMap<Page, string[]>();
export function watchPayrollResponsiveErrors(
  { page }: { page: Page },
  info: TestInfo,
) {
  if (!info.config.metadata.payrollResponsive) return;
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
}
export async function measurePayrollViewport(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const actual = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    const outside = [
      ...document.querySelectorAll<HTMLElement>("main *,.drawer *"),
    ]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height || box.right <= width + 1) return false;
        let parent = element.parentElement;
        while (parent && parent !== document.documentElement) {
          if (
            /auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX)
          )
            return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .slice(0, 15)
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        label: element.getAttribute("aria-label"),
        text: element.textContent?.trim().slice(0, 120),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }));
    const surfaces = [
      ...document.querySelectorAll<HTMLElement>(
        "main,.payroll-calculator,.drawer,.inspector-panel,.drawer__body",
      ),
    ]
      .filter((element) => element.clientWidth > 0)
      .map((element) => ({
        label: element.className || element.tagName,
        width: element.clientWidth,
        actual: element.scrollWidth,
      }));
    return { width, actual, outside, surfaces };
  });
}
export async function assertPayrollFits(page: Page) {
  const measurements = await measurePayrollViewport(page);
  expect(
    measurements.actual,
    `Payroll document overflows: ${JSON.stringify(measurements.outside)}`,
  ).toBeLessThanOrEqual(measurements.width + 1);
  for (const surface of measurements.surfaces)
    expect(
      surface.actual,
      `${surface.label} overflows: ${JSON.stringify(measurements.outside)}`,
    ).toBeLessThanOrEqual(surface.width + 1);
}
export async function checkPayrollResponsiveViewport(
  { page }: { page: Page },
  info: TestInfo,
) {
  if (!info.config.metadata.payrollResponsive || page.isClosed()) return;
  const measurements = await measurePayrollViewport(page);
  await info.attach("payroll-viewport-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath(`payroll-${info.project.name}.png`),
    fullPage: true,
  });
  if (info.status !== info.expectedStatus) return;
  await assertPayrollFits(page);
  expect(
    errors.get(page) ?? [],
    "No browser exceptions during the actual payroll workflow",
  ).toEqual([]);
}
