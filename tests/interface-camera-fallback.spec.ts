import { expect, test } from "@playwright/test";
import { assertScannerFallback, denyBrowserCamera } from "./helpers/cameraFallback";

// The fake device supplies video hardware; no fake-UI or grantPermissions bypass is used.
// Full Chromium supports media permissions; its headless-shell build does not.
// `launchOptions` here replaces the config-level object, so carry the
// configured browser path (SOCIETYER_CHROMIUM_PATH) over explicitly.
const executablePath = process.env.SOCIETYER_CHROMIUM_PATH;
test.use({
  channel: "chromium",
  launchOptions: { ...(executablePath ? { executablePath } : {}), args: ["--use-fake-device-for-media-stream"] },
  permissions: [],
});
test.beforeEach(async ({ page, baseURL }) => denyBrowserCamera(page, baseURL!));

test("camera denial still lets an asset tag resolve through the existing register", async ({ page }) => {
  await page.goto("/demo/app/assets");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await assertScannerFallback(page, "AST-0001", "Scan an asset");
  await expect(page).toHaveURL(/\/assets\/static_asset_projector$/);
  await expect(page.getByRole("heading", { name: "AST-0001", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("camera denial retains inventory manual bin lookup and rejects unknown codes", async ({ page }) => {
  await page.goto("/demo/app/inventory");
  await page.getByRole("button", { name: /^Locations & bins/ }).click();
  await page.getByRole("button", { name: "Scan bin", exact: true }).click();
  await assertScannerFallback(page, "UNKNOWN-QUALIFICATION-BIN", "Scan bin");
  await expect(page.getByText("No bin matches that code", { exact: true })).toBeVisible();
  await assertScannerFallback(page, "FAC-HALL", "Scan bin");
  await expect(page.getByRole("dialog", { name: "What's in Riverside community hall", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Scan bin", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
