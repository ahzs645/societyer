import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";
import { expect, test, type Page, type Locator } from "@playwright/test";

// Each scenario provisions a fresh legal workspace before exercising bytes,
// a saved record, and a cold reload; allow its full lifecycle to complete.
test.setTimeout(60_000);

const image = () => ({ name: "local-persistence.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0MkAAAAASUVORK5CYII=", "base64") });

async function createLocalWorkspace(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  await completeGuidedOrganizationSetup(page, "Local upload persistence audit", true);
  expect(page.url()).not.toContain("/demo/");
}

async function expectPersistedInlineImage(imagePreview: Locator) {
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect.poll(() => imagePreview.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("fresh local workspace organization logo retains its bytes after reload", async ({ page }, testInfo) => {
  await createLocalWorkspace(page);
  const nativeUploads: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/storage\/upload/.test(request.url())) nativeUploads.push(request.url()); });
  await page.goto("/app/settings?tab=workspace");
  await page.locator('input[type="file"]').first().setInputFiles(image());
  await expect(page.getByText("Logo updated", { exact: true })).toBeVisible();
  await page.reload();
  await expectPersistedInlineImage(page.locator(".organization-logo-preview--light img"));
  expect(nativeUploads).toEqual([]);
  await expectFits(page);
  await testInfo.attach("local-logo-after-reload", { body: await page.screenshot(), contentType: "image/png" });
});

test("fresh local workspace inventory photo persists with its saved item", async ({ page }, testInfo) => {
  await createLocalWorkspace(page);
  await page.goto("/app/inventory");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New item", exact: true });
  await expect(dialog.locator("button").filter({ hasText: "Upload" })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(image());
  await expect(dialog.locator("button").filter({ hasText: "Replace" })).toBeVisible();
  const title = `Local photographed inventory ${testInfo.project.name}`;
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(title);
  await dialog.getByLabel("SKU", { exact: true }).fill(`LOCAL-${testInfo.project.name}`);
  await dialog.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Edit", exact: true }).click();
  await expectPersistedInlineImage(page.getByRole("dialog").locator("img").first());
  await expectFits(page);
  await testInfo.attach("local-inventory-photo-after-reload", { body: await page.screenshot(), contentType: "image/png" });
});

test("fresh local workspace asset photo persists after save and reload", async ({ page }, testInfo) => {
  await createLocalWorkspace(page);
  await page.goto("/app/assets");
  await page.getByRole("button", { name: "New asset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New asset", exact: true });
  const title = `Local photographed asset ${testInfo.project.name}`;
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(title);
  await dialog.getByRole("textbox", { name: "Asset tag", exact: true }).fill(`LOCAL-${testInfo.project.name}`);
  await expect(dialog.locator("button").filter({ hasText: "Upload" })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(image());
  await expect(dialog.locator("button").filter({ hasText: "Replace" })).toBeVisible();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const mobileSearch = page.getByRole("searchbox", { name: "Search mobile asset register", exact: true });
  if (await mobileSearch.isVisible()) await mobileSearch.fill(title);
  if (page.viewportSize()!.width <= 760) {
    await page.locator("button:visible").filter({ hasText: title }).first().click();
  } else {
    await page.locator(".record-table__row").filter({ hasText: title }).getByRole("button", { name: "Actions for this asset", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  }
  await page.waitForURL(/\/assets\/[^/?]+$/);
  await page.reload();
  await expectPersistedInlineImage(page.getByRole("img", { name: `Photo of ${title}`, exact: true }));
  await expectFits(page);
  await testInfo.attach("local-asset-photo-after-reload", { body: await page.screenshot(), contentType: "image/png" });
});
