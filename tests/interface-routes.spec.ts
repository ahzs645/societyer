import { expect, test } from "@playwright/test";
import { INTERFACE_ROUTES } from "./helpers/interfaceRoutes";

for (const route of INTERFACE_ROUTES) {
  test(`${route.pattern} renders its ${route.fixture} state without a crash or page overflow`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /\[ErrorBoundary|Failed to load the data client/.test(message.text())) runtimeErrors.push(message.text());
    });
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    if (route.pattern === "/app/society/new") {
      await expect(page.getByRole("heading", { name: "New organization workspace", exact: true })).toBeVisible();
    } else if (route.kind === "app") {
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator(".workbench__content")).toBeVisible();
      await expect(page.getByText("Checking workspace access…", { exact: true })).toHaveCount(0);
      await expect.poll(() => page.locator(".workbench__content").innerText()).not.toMatch(/^\s*(Loading[^\n]*\s*)?$/i);
    } else {
      await expect.poll(() => page.locator("body").innerText()).not.toMatch(/^\s*(Loading[^\n]*\s*)?$/i);
    }
    await expect(page.getByRole("heading", { name: "Something went wrong.", exact: true })).toHaveCount(0);
    if (route.redirectTo) await expect(page).toHaveURL(new URL(route.redirectTo, testInfo.project.use.baseURL as string).toString());
    // Two frames allow layout and hydrated local snapshots to settle without
    // networkidle, which can hang on intentional disconnected provider retries.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const layout = await page.evaluate(() => {
      const candidates = [document.documentElement, ...document.querySelectorAll<HTMLElement>(".page")];
      return candidates.map((element) => ({
        selector: element === document.documentElement ? "html" : `.page${element.className.replace("page", "").trim() ? ` (${element.className})` : ""}`,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })).filter((element) => element.width > 0 && element.scrollWidth > element.width + 2);
    });
    await testInfo.attach("route-state", { body: JSON.stringify({ route, url: page.url(), layout, runtimeErrors }, null, 2), contentType: "application/json" });
    expect(runtimeErrors, `Runtime failures at ${route.path}`).toEqual([]);
    expect(layout, `Uncontained horizontal page overflow at ${route.path}`).toEqual([]);
  });
}
