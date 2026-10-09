import { expect, test } from "@playwright/test";
import { assertLiveFits, signInLive } from "./helpers/liveInterface";

const image = () => ({
  name: "isolated-pilot.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0MkAAAAASUVORK5CYII=", "base64"),
});

test("production organization logo uploads bytes, binds storage and reloads its preview", async ({ page }) => {
  await signInLive(page);
  const uploads: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname.startsWith("/api/storage/upload")) uploads.push(response.status());
  });
  await page.goto("/app/settings?tab=workspace");
  await page.locator('input[type="file"]').first().setInputFiles(image());
  await expect(page.getByText("Logo updated", { exact: true })).toBeVisible();
  await expect(page.locator(".organization-logo-preview--light img")).toBeVisible();
  await page.reload();
  const preview = page.locator(".organization-logo-preview--light img");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(uploads).toEqual([200]);
  await assertLiveFits(page);
});

test("production inventory photo uploads and persists with its created item", async ({ page }, testInfo) => {
  await signInLive(page);
  const title = `Live photographed item ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/app/inventory");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New item", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles(image());
  await expect(dialog.locator("img")).toBeVisible();
  await dialog.getByLabel(/^Name(?: \*)?$/).fill(title);
  await dialog.getByLabel("SKU", { exact: true }).fill(`LIVE-${testInfo.project.name}-${Date.now()}`);
  await assertLiveFits(page);
  await dialog.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(title, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  // Reopen the persisted record through its existing edit action and verify
  // the preview is served by the native storage URL rather than blob: memory.
  const row = page.locator("tr", { hasText: title });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const imagePreview = page.getByRole("dialog").locator("img").first();
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview).toHaveAttribute("src", /^https?:\/\//);
  await expect.poll(() => imagePreview.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await assertLiveFits(page);
});

test("production asset photo uploads and remains bound after saving and reload", async ({ page }, testInfo) => {
  await signInLive(page);
  const title = `Live photographed asset ${testInfo.project.name} ${Date.now()}`;
  const tag = `LIVE-${testInfo.project.name}-${Date.now()}`;
  await page.goto("/app/assets");
  await page.getByRole("button", { name: "New asset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New asset", exact: true });
  await dialog.getByLabel(/^Name(?: \*)?$/).fill(title);
  await dialog.getByLabel(/^Asset tag(?: \*)?$/).fill(tag);
  await dialog.locator('input[type="file"]').setInputFiles(image());
  await expect(dialog.locator("img")).toBeVisible();
  await assertLiveFits(page);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(title, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const mobileSearch = page.getByRole("searchbox", { name: "Search mobile asset register", exact: true });
  if (await mobileSearch.isVisible()) {
    await mobileSearch.fill(title);
    await page.locator("button:visible").filter({ hasText: title }).first().click();
  } else {
    // Desktop title cells support inline editing. Use the explicit record-open
    // action, then wait for navigation before the persistence reload.
    await page.getByRole("row").filter({ hasText: title }).getByRole("button", { name: "Actions for this asset", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/app\/assets\/[^/]+$/);
  await page.reload();
  const preview = page.getByRole("img", { name: `Photo of ${title}`, exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^https?:\/\//);
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await assertLiveFits(page);
});
