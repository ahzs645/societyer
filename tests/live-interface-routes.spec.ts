import { expect, test } from "@playwright/test";
import { INTERFACE_ROUTES } from "./helpers/interfaceRoutes";
import { assertLiveFits, livePath, signInLive } from "./helpers/liveInterface";

// Batch related route renders to use a single genuine session, while retaining
// an attachment for every route and continuing after a failed surface.
const size = 10;
for (let offset = 0; offset < INTERFACE_ROUTES.length; offset += size) {
  const routes = INTERFACE_ROUTES.slice(offset, offset + size);
  test(`live route surfaces ${offset + 1}–${offset + routes.length}`, async ({ page }, testInfo) => {
    await signInLive(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    const failures: Array<{ pattern: string; path?: string; error: string }> = [];
    for (const route of routes) {
      let path: string | undefined;
      try {
        path = livePath(route);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        if (route.pattern === "/app/table-field-lab") {
          // The developer field lab is intentionally registered only by the
          // trusted static demo, so hosted access must safely fall back.
          await expect(page).toHaveURL(new URL("/", testInfo.project.use.baseURL as string).toString());
          await expect(page.getByRole("heading", { name: /Run your society/ })).toBeVisible();
        } else if (route.pattern === "/app/society/new") {
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
        if (route.redirectTo) await expect(page).toHaveURL(new URL(route.redirectTo.replace(/^\/demo/, ""), testInfo.project.use.baseURL as string).toString());
        await assertLiveFits(page);
        await testInfo.attach(`surface-${offset + routes.indexOf(route) + 1}`, {
          body: JSON.stringify({ pattern: route.pattern, path, url: page.url(), viewport: page.viewportSize(), qualification: route.pattern === "/app/table-field-lab" ? "Demo-only lab; safely excluded from hosted routes." : route.fixture === "invalid-token" ? "Invalid token unavailable state." : route.fixture === "missing-record" ? "Safe missing-record state." : "Actual hosted runtime route.", state: (await page.locator("body").innerText()).slice(0, 1400) }),
          contentType: "application/json",
        });
      } catch (error) {
        failures.push({ pattern: route.pattern, path, error: String(error) });
        await testInfo.attach(`failed-${offset + routes.indexOf(route) + 1}`, { body: await page.screenshot(), contentType: "image/png" });
      }
    }
    await testInfo.attach("live-surface-results", { body: JSON.stringify({ failures, errors }), contentType: "application/json" });
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  });
}
