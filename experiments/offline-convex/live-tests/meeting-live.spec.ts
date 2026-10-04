import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function open(page: Page, run: string) {
  await page.goto(`/meeting.html?live=1&run=${run}`);
  await expect(page.locator("#status")).toContainText("Ready · live Convex");
}
async function create(page: Page, title: string, attachment = false) {
  await page.locator("#title").fill(title);
  await page.locator("#date").fill("2026-11-15T10:00");
  await page.locator("#notes").fill("Live backend preparation");
  await page.locator("#agenda").fill("Discuss real replication");
  if (attachment) await page.locator("#file").setInputFiles({ name: "live.txt", mimeType: "text/plain", buffer: Buffer.from("Real live attachment bytes\n") });
  await page.locator("#save").click();
  await expect(page.locator("#meetings")).toContainText(title);
}
test("real PowerSync replica receives meeting graph, child edits and native attachment", async ({ page, browser }) => {
  const run = randomUUID(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  const second = await context2.newPage(); second.on("pageerror", error => errors.push(String(error)));
  try {
    await open(page, run); await open(second, run);
    await create(page, "Replicated meeting", true);
    await expect(page.locator("#queue")).toHaveText("0 pending commands");
    await expect(second.locator("#server")).toContainText("Replicated meeting");
    await expect(second.locator("#meetings")).toContainText("Downloaded via PowerSync");
    await second.locator("#meetings textarea").fill("Replicated minutes child");
    await second.locator("#meetings button").click();
    await expect(page.locator("#server")).toContainText("Replicated minutes child");
    await page.locator("#files").click();
    await expect(second.locator("#server")).toContainText("available from server");
    await second.locator("#server button").click();
    await expect(second.locator("#status")).toContainText("downloaded and verified");
    await expect(second.locator("#meetings")).toContainText("Attachment bytes accepted");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false); expect(errors).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    const cachedSessionRoutes = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = (await Promise.all(keys.map(async key => (await caches.open(key)).keys()))).flat();
      return requests.filter(request => /\/__live\//.test(request.url)).map(request => request.url);
    });
    expect(cachedSessionRoutes).toEqual([]);
  } finally { await context2.close(); }
});
test("offline parent and child survive restart, reconnect through real command upload and download", async ({ page, context, browser }) => {
  const run = randomUUID(); await open(page, run);
  // Cache this navigation after the installed worker controls the page.
  await page.reload(); await expect(page.locator("#status")).toContainText("Ready · live Convex");
  await context.setOffline(true);
  await create(page, "Offline durable graph", true);
  await page.locator("#meetings textarea").fill("Offline durable child");
  await page.locator("#meetings button").click();
  await expect(page.locator("#queue")).toHaveText("2 pending commands");
  await page.reload(); await expect(page.locator("#meetings")).toContainText("Offline durable child");
  await expect(page.locator("#queue")).toHaveText("2 pending commands");
  await expect(page.locator("#files")).toBeDisabled();
  await context.setOffline(false); await page.reload();
  await expect(page.locator("#queue")).toHaveText("0 pending commands");
  await expect(page.locator("#server")).toContainText("Offline durable child");
  await page.locator("#files").click();
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try { const second = await context2.newPage(); await open(second, run); await expect(second.locator("#server")).toContainText("Offline durable child"); await expect(second.locator("#server")).toContainText("available from server"); }
  finally { await context2.close(); }
});
test("offline queues remain isolated across account and workspace switches", async ({ page, context }) => {
  const run = randomUUID(); await open(page, run);
  await page.locator("#actor").selectOption("owner-b"); await expect(page.locator("#status")).toContainText("Ready");
  await page.locator("#actor").selectOption("viewer-a"); await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save")).toBeDisabled();
  await page.locator("#actor").selectOption("owner-a"); await expect(page.locator("#status")).toContainText("Ready");
  await context.setOffline(true); await create(page, "Private offline A"); await expect(page.locator("#queue")).toHaveText("1 pending commands");
  await page.locator("#actor").selectOption("owner-b"); await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#meetings")).not.toContainText("Private offline A"); await expect(page.locator("#queue")).toHaveText("0 pending commands");
  await page.locator("#actor").selectOption("viewer-a"); await expect(page.locator("#save")).toBeDisabled(); await expect(page.locator("#queue")).toHaveText("0 pending commands");
  await page.locator("#actor").selectOption("owner-a"); await expect(page.locator("#queue")).toHaveText("1 pending commands"); await expect(page.locator("#meetings")).toContainText("Private offline A");
  await context.setOffline(false); await page.reload(); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await expect(page.locator("#server")).toContainText("Private offline A");
  await page.locator("#actor").selectOption("owner-b"); await expect(page.locator("#status")).toContainText("Ready"); await expect(page.locator("#server")).not.toContainText("Private offline A");
});
test("Viewer replica contains permitted preparation but no attachment or write controls", async ({ page, browser }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Visible preparation", true);
  await expect(page.locator("#queue")).toHaveText("0 pending commands"); await page.locator("#files").click();
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const viewer = await context2.newPage(); await open(viewer, run); await viewer.locator("#actor").selectOption("viewer-a");
    await expect(viewer.locator("#server")).toContainText("Visible preparation");
    await expect(viewer.locator("#save")).toBeDisabled(); await expect(viewer.locator("#files")).toBeDisabled();
    await expect(viewer.locator("#meetings textarea")).toHaveCount(0); await expect(viewer.locator("#server button")).toHaveCount(0);
    await expect(viewer.locator("#server")).not.toContainText("live.txt");
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await context2.close(); }
});
test("concurrent offline child edits preserve rejected stale work for review and recovery", async ({ page, browser, context }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Concurrent preparation");
  await expect(page.locator("#queue")).toHaveText("0 pending commands");
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const second = await context2.newPage(); await open(second, run); await expect(second.locator("#meetings")).toContainText("Concurrent preparation");
    await context.setOffline(true); await context2.setOffline(true);
    await page.locator("#meetings textarea").fill("First committed edit"); await page.locator("#meetings button").click();
    await second.locator("#meetings textarea").fill("Stale retained edit"); await second.locator("#meetings button").click();
    await context.setOffline(false); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await expect(page.locator("#server")).toContainText("First committed edit");
    await context2.setOffline(false); await expect(second.locator("#meetings")).toContainText("Needs review"); await expect(second.locator("#queue")).toHaveText("1 pending commands");
    await expect(second.locator("#meetings")).toContainText("Stale retained edit");
    const downloadPromise = second.waitForEvent("download"); await second.locator("#export").click(); const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("societyer-meeting-recovery.json");
    await expect(page.locator("#server")).not.toContainText("Stale retained edit");
  } finally { await context2.close(); }
});
test("revoked Viewer rows disappear from real replica and downloaded local preparation", async ({ page, browser, request }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Revocable preparation"); await expect(page.locator("#queue")).toHaveText("0 pending commands");
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const viewer = await context2.newPage(); await open(viewer, run); await viewer.locator("#actor").selectOption("viewer-a");
    await expect(viewer.locator("#server")).toContainText("Revocable preparation"); await expect(viewer.locator("#meetings")).toContainText("Revocable preparation");
    const ownerSession = await (await request.get(`/__live/session?actor=owner-a&run=${run}`)).json();
    const viewerSession = await (await request.get(`/__live/session?actor=viewer-a&run=${run}`)).json();
    const { publicMutation } = await import("./admin");
    await publicMutation(ownerSession.token, "users:securityDisable", { id: viewerSession.userId, reason: "Local real replica revocation test" });
    await expect(viewer.locator("#server")).not.toContainText("Revocable preparation"); await expect(viewer.locator("#meetings")).not.toContainText("Revocable preparation");
    expect((await request.get(`/__live/credentials?actor=viewer-a&run=${run}`)).status()).toBe(403);
  } finally { await context2.close(); }
});
test("all five workspace roles expose matching meeting read and write controls", async ({ page, browser, request }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Role policy preparation"); await expect(page.locator("#queue")).toHaveText("0 pending commands");
  const ownerSession = await (await request.get(`/__live/session?actor=owner-a&run=${run}`)).json();
  const actorSession = await (await request.get(`/__live/session?actor=viewer-a&run=${run}`)).json();
  const { publicMutation } = await import("./admin");
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const actor = await context2.newPage();
    for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
      await publicMutation(ownerSession.token, "users:setRole", { id: actorSession.userId, role });
      await actor.goto(`/meeting.html?live=1&run=${run}`); await expect(actor.locator("#status")).toContainText("Ready");
      await actor.locator("#actor").selectOption("viewer-a"); await expect(actor.locator("#server")).toContainText("Role policy preparation");
      const writable = ["Owner", "Admin", "Director"].includes(role);
      if (writable) { await expect(actor.locator("#save")).toBeEnabled(); await expect(actor.locator("#meetings textarea")).toHaveCount(1); }
      else { await expect(actor.locator("#save")).toBeDisabled(); await expect(actor.locator("#meetings textarea")).toHaveCount(0); }
      expect(await actor.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      // Reset account so the next navigation cannot accidentally reuse a stale role.
      await actor.locator("#actor").selectOption("owner-a"); await expect(actor.locator("#status")).toContainText("Ready");
    }
  } finally { await context2.close(); }
});
test("built live PWA reopens in a new tab offline and preserves pending graph and attachment", async ({ page, context }) => {
  const run = randomUUID(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await open(page, run);
  expect(await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL)).toContain("/sw.js");
  await context.setOffline(true); await create(page, "Offline reopened live PWA", true);
  await page.locator("#meetings textarea").fill("Reopened child draft"); await page.locator("#meetings button").click();
  await expect(page.locator("#queue")).toHaveText("2 pending commands"); await page.close();
  const reopened = await context.newPage(); reopened.on("pageerror", error => errors.push(error.message));
  await reopened.goto(`/meeting.html?live=1&run=${run}`);
  await expect(reopened.locator("#status")).toContainText("Ready · offline"); await expect(reopened.locator("#meetings")).toContainText("Reopened child draft");
  await expect(reopened.locator("#queue")).toHaveText("2 pending commands"); await expect(reopened.locator("#meetings")).toContainText("transfer pending");
  const offlineCredentialCached = await reopened.evaluate(async () => { try { await fetch("/__live/credentials"); return true; } catch { return false; } });
  expect(offlineCredentialCached).toBe(false); expect(errors).toEqual([]);
  await context.setOffline(false); await expect(reopened.locator("#queue")).toHaveText("0 pending commands"); await expect(reopened.locator("#server")).toContainText("Reopened child draft");
});
test("online revocation disables writes and removes downloaded attachment bytes", async ({ page, browser, request }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Revoked attachment", true); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await page.locator("#files").click();
  const ownerSession = await (await request.get(`/__live/session?actor=owner-a&run=${run}`)).json();
  const successor = await (await request.get(`/__live/session?actor=viewer-a&run=${run}`)).json();
  const { publicMutation } = await import("./admin");
  await publicMutation(ownerSession.token, "users:setRole", { id: successor.userId, role: "Owner" });
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const second = await context2.newPage(); await open(second, run); await expect(second.locator("#server button")).toHaveCount(1); await second.locator("#server button").click(); await expect(second.locator("#status")).toContainText("downloaded and verified");
    await publicMutation(ownerSession.token, "users:securityDisable", { id: ownerSession.userId, reason: "Online downloaded-file revocation test" });
    await expect(second.locator("#server li")).toHaveCount(0); await expect(second.locator("#meetings li")).toHaveCount(0); await expect(second.locator("#save")).toBeDisabled();
    const saved = second.waitForEvent("download"); await second.locator("#export").click(); const recovery = await saved;
    const { readFileSync } = await import("node:fs"); const exported = JSON.parse(readFileSync((await recovery.path())!, "utf8")); expect(exported.files).toEqual([]);
  } finally { await context2.close(); }
});
test("revocation purges downloaded bytes despite pending child and unsaved form edits", async ({ page, browser, request }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Protected draft attachment", true); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await page.locator("#files").click();
  const ownerSession = await (await request.get(`/__live/session?actor=owner-a&run=${run}`)).json();
  const successor = await (await request.get(`/__live/session?actor=viewer-a&run=${run}`)).json();
  const { publicMutation } = await import("./admin"); await publicMutation(ownerSession.token, "users:setRole", { id: successor.userId, role: "Owner" });
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const second = await context2.newPage(); await open(second, run); await expect(second.locator("#server button")).toHaveCount(1); await second.locator("#server button").click(); await expect(second.locator("#status")).toContainText("downloaded and verified");
    await context2.setOffline(true); await second.locator("#meetings textarea").fill("Pending user authored child"); await second.locator("#meetings button").click(); await expect(second.locator("#queue")).toHaveText("1 pending commands");
    await second.locator("#meetings textarea").fill("Additional unsaved edit");
    await publicMutation(ownerSession.token, "users:securityDisable", { id: ownerSession.userId, reason: "Protected downloaded-file revocation test" });
    await context2.setOffline(false); await expect(second.locator("#server li")).toHaveCount(0); await expect(second.locator("#save")).toBeDisabled(); await expect(second.locator("#queue")).toHaveText("1 pending commands");
    const saved = second.waitForEvent("download"); await second.locator("#export").click(); const recovery = await saved;
    const { readFileSync } = await import("node:fs"); const exported = JSON.parse(readFileSync((await recovery.path())!, "utf8"));
    expect(exported.files).toEqual([]); expect(exported.pending).toHaveLength(1); expect(JSON.stringify(exported.history)).toContain("Pending user authored child");
  } finally { await context2.close(); }
});
test("a delayed native attachment download cannot undo replicated revocation", async ({ page, browser, request }) => {
  const run = randomUUID(); await open(page, run); await create(page, "Racing attachment", true); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await page.locator("#files").click();
  const ownerSession = await (await request.get(`/__live/session?actor=owner-a&run=${run}`)).json();
  const successor = await (await request.get(`/__live/session?actor=viewer-a&run=${run}`)).json();
  const { publicMutation } = await import("./admin"); await publicMutation(ownerSession.token, "users:setRole", { id: successor.userId, role: "Owner" });
  const context2 = await browser.newContext({ viewport: page.viewportSize()! });
  let release: () => void = () => {}; let signalDownload: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { signalDownload = resolve; });
  try {
    const second = await context2.newPage(); await open(second, run); await expect(second.locator("#server button")).toHaveCount(1);
    await second.route("**/api/storage/**", async route => {
      const response = await route.fetch(); signalDownload(); await delayed; await route.fulfill({ response });
    });
    await second.locator("#server button").click(); await started;
    await publicMutation(ownerSession.token, "users:securityDisable", { id: ownerSession.userId, reason: "Delayed downloaded-file revocation race" });
    await expect(second.locator("#server li")).toHaveCount(0); release();
    await expect(second.locator("#error")).toContainText(/authorization changed before caching|User is disabled|External identity is disabled|membership is not active|membership not found|Permission .* required/);
    const saved = second.waitForEvent("download"); await second.locator("#export").click(); const recovery = await saved;
    const { readFileSync } = await import("node:fs"); const exported = JSON.parse(readFileSync((await recovery.path())!, "utf8")); expect(exported.files).toEqual([]);
  } finally { release(); await context2.close(); }
});
test("rapid account changes during native authentication settle only the current workspace", async ({ page }) => {
  const run = randomUUID(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let ownerRequests = 0; let release: () => void = () => {}; let heldSignal: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { heldSignal = resolve; });
  await page.route("**/__live/session?**", async route => {
    const actor = new URL(route.request().url()).searchParams.get("actor");
    if (actor === "owner-a" && ++ownerRequests === 2) { const response = await route.fetch(); heldSignal(); await held; await route.fulfill({ response }); }
    else await route.continue();
  });
  try {
    await page.goto(`/meeting.html?live=1&run=${run}`); await started;
    await page.locator("#actor").selectOption("viewer-a"); await page.locator("#actor").selectOption("owner-b"); release();
    await expect(page.locator("#status")).toContainText("Ready · live Convex"); await expect(page.locator("#actor")).toHaveValue("owner-b");
    await create(page, "Current workspace B only"); await expect(page.locator("#queue")).toHaveText("0 pending commands"); await expect(page.locator("#server")).toContainText("Current workspace B only");
    await page.locator("#actor").selectOption("owner-a"); await expect(page.locator("#status")).toContainText("Ready"); await expect(page.locator("#server")).not.toContainText("Current workspace B only");
    expect(errors).toEqual([]);
  } finally { release(); }
});
