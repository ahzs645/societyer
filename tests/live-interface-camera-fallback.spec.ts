import { expect, test } from "@playwright/test";
import { assertScannerFallback, denyBrowserCamera } from "./helpers/cameraFallback";
import { assertLiveFits, liveFixture, signInLive } from "./helpers/liveInterface";

test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] }, permissions: [] });
test.beforeEach(async ({ page, baseURL }) => denyBrowserCamera(page, baseURL!));

for (const role of ["Owner", "Viewer"]) {
  test(`${role} can use camera-denied manual asset lookup with genuine workspace authorization`, async ({ page }) => {
    await signInLive(page, role);
    const assetId = liveFixture().ids.static_asset_projector;
    await page.goto(`/app/assets/${assetId}`);
    // A protected native route briefly renders an "Authorizing" H1. Wait for
    // the actual detail PageHeader before reading its asset tag as input.
    const title = page.locator(".page__header .page__title-text");
    await expect(title).toBeVisible();
    const tag = (await title.innerText()).trim();
    expect(tag).not.toBe("");
    await page.goto("/app/assets");
    if (role === "Viewer") await expect(page.getByRole("button", { name: "New asset", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await assertScannerFallback(page, tag, "Scan an asset");
    await expect(page).toHaveURL(new RegExp(`/assets/${assetId}$`));
    await expect(page.getByRole("heading", { name: tag, exact: true })).toBeVisible();
    await assertLiveFits(page);
  });
}
