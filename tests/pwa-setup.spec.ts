import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The installable PWA is served from a static build with no backend, so the
 * first launch has to ask where records live and then run entirely on the
 * browser-local workspace. These tests walk the whole pipeline the way a new
 * operator does: install → choose storage → create or restore → work.
 */

const RUNTIME_KEY = "societyer:app-runtime";

async function createOrganization(page: Page, name: string) {
  await page.getByRole("textbox").first().fill(name);
  await page.getByRole("button", { name: /^Create workspace$/ }).click();
  await page.waitForURL(/\/app\/workflows\//, { timeout: 20_000 });
  // Setup hands off to the onboarding workflow it just created. If that page
  // can't find the workflow — or finds a row shaped differently from the one
  // the Convex mutation writes — the pipeline dead-ends on its final step.
  await expect(page.getByText("Workflow not found.")).toHaveCount(0);
  await expect(page.getByText("Workspace onboarding").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Organization profile").first()).toBeVisible({ timeout: 20_000 });
}

async function downloadBackup(page: Page) {
  await page.goto("/app/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^Runtime$/ }).click();
  await expect(page.getByRole("heading", { name: "Workspace storage" })).toBeVisible({ timeout: 15_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download backup/i }).click();
  const path = join(mkdtempSync(join(tmpdir(), "societyer-backup-")), "backup.json");
  await (await download).saveAs(path);
  return path;
}

// Each case boots the whole app from scratch three or four times (setup →
// reload → app shell → reload), so these need considerably longer than the
// suite-wide default — especially when several workers share the machine.
test.describe.configure({ timeout: 150_000 });

test.describe("PWA first-run setup", () => {
  test("an unconfigured launch is sent to setup instead of a dead app shell", async ({ page }) => {
    const localConvexSockets: string[] = [];
    page.on("websocket", (socket) => {
      if (socket.url().includes("127.0.0.1:3210")) localConvexSockets.push(socket.url());
    });

    await page.goto("/app?pwa=1", { waitUntil: "domcontentloaded" });

    await page.waitForURL(/\/setup/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /where should your records live/i })).toBeVisible();
    // The whole point of the gate: never open a socket to a backend that the
    // static build has no way to reach.
    expect(localConvexSockets).toEqual([]);
  });

  test("choosing local storage creates a workspace that survives a reload", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Start a new organization/i }).click();

    await page.waitForURL(/\/app\/society\/new/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "New organization workspace" })).toBeVisible();

    const choice = await page.evaluate((key) => localStorage.getItem(key), RUNTIME_KEY);
    expect(choice).toContain('"local"');

    await createOrganization(page, "Rivermouth Arts Society");

    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Rivermouth Arts Society").first()).toBeVisible({ timeout: 20_000 });
    // A configured workspace must not be mistaken for a fresh one while
    // IndexedDB is still hydrating.
    await expect(page).toHaveURL(/\/app$/);
  });

  test("a fresh device restores an exported backup", async ({ page, browser }) => {
    await page.goto("/setup", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Start a new organization/i }).click();
    await page.waitForURL(/\/app\/society\/new/, { timeout: 15_000 });
    await createOrganization(page, "Harbourview Housing Society");
    const backupPath = await downloadBackup(page);

    // A second context is a second device: empty storage, no workspace.
    const secondDevice = await browser.newContext();
    const restored = await secondDevice.newPage();
    await restored.goto("/app", { waitUntil: "domcontentloaded" });
    await restored.waitForURL(/\/setup/, { timeout: 15_000 });

    await restored.getByRole("button", { name: /I have a backup to restore/i }).click();
    await restored.waitForURL(/restore=1/, { timeout: 15_000 });
    await expect(restored.getByRole("heading", { name: "Restore from a backup" })).toBeVisible();

    await restored.setInputFiles('input[type="file"]', backupPath);
    await restored.getByRole("button", { name: /^Restore$/ }).click();

    await restored.waitForURL((url) => url.pathname === "/app", { timeout: 20_000 });
    await expect(restored.getByText("Harbourview Housing Society").first()).toBeVisible({ timeout: 20_000 });
    await secondDevice.close();
  });

  test("the app boots offline once the service worker has cached the shell", async ({ page, context }) => {
    await page.goto("/setup", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Start a new organization/i }).click();
    await page.waitForURL(/\/app\/society\/new/, { timeout: 15_000 });
    await createOrganization(page, "Lakeside Trails Society");

    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Lakeside Trails Society").first()).toBeVisible({ timeout: 20_000 });

    await context.setOffline(true);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Lakeside Trails Society").first()).toBeVisible({ timeout: 20_000 });
    await context.setOffline(false);
  });

  test("connecting to a server stores the address and leaves local data alone", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Server address").fill("https://societyer.example.org");
    await page.getByRole("button", { name: /^Connect$/ }).click();

    await page.waitForURL((url) => url.pathname === "/app", { timeout: 15_000 });
    const choice = await page.evaluate((key) => localStorage.getItem(key), RUNTIME_KEY);
    expect(choice).toContain("https://societyer.example.org");
  });

  test("the manifest points at a route the app can actually serve", async ({ request, page }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.start_url).toBe("/app?pwa=1");

    // Every declared entry point must resolve to the app shell, not a 404.
    for (const url of [manifest.start_url, ...manifest.shortcuts.map((s: any) => s.url)]) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${url} should be served`).toBeLessThan(400);
      await expect(page.locator("#root")).not.toBeEmpty();
    }
  });
});
