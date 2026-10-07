import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { assertLiveFits, liveFixture } from "./helpers/liveInterface";

// These tests need the isolated live-qualification lab (Docker Convex, Better
// Auth broker and its account file). Without the lab they are skipped, so the
// local recovery specs in the same config still run.
const LABORATORY_FILE = process.env.OFFLINE_ROLLOUT_LAB_FILE ?? "experiments/live-qualification/.env.accounts.local";
const laboratory = existsSync(LABORATORY_FILE) ? JSON.parse(readFileSync(LABORATORY_FILE, "utf8")) : null;
test.skip(!laboratory, `live-qualification lab is not running (${LABORATORY_FILE} is missing)`);
const operator = new ConvexHttpClient(laboratory?.convexUrl ?? "http://127.0.0.1:0", { logger: false });
if (laboratory) operator.setAdminAuth(laboratory.adminKey);
async function open(page: Page, role = "Owner") {
  const account = liveFixture().identities[role];
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(liveFixture().societyId);
  await page.goto("/app/meetings/offline");
  await expect(page.getByRole("heading", { name: "Offline meeting preparation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export recovery", exact: true })).toBeEnabled();
  await expect(page.locator(".offline-meeting-preparation [role=alert]")).toHaveCount(0);
}
async function create(page: Page, title: string, attachment = false) {
  await page.getByLabel("Meeting title", { exact: true }).fill(title);
  await page.getByLabel("Date and time", { exact: true }).fill("2026-11-15T10:00");
  await page.getByLabel("Agenda item", { exact: true }).fill("Actual production transport");
  await page.getByLabel("Preparation notes", { exact: true }).fill("Actual Better Auth and full native Convex preparation");
  if (attachment) await page.getByLabel("Attachment (up to 1 MB)", { exact: true }).setInputFiles({ name: "production-live.txt", mimeType: "text/plain", buffer: Buffer.from("Production native attachment bytes\n") });
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  await expect(page.locator(".offline-meeting-list .card").filter({ has: page.getByRole("heading", { name: title, exact: true }) })).toBeVisible();
}
const card = (page: Page, title: string) => page.locator(".offline-meeting-list .card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const pending = (page: Page) => page.locator(".offline-meeting-preparation > [role=status]");
async function cleanup(prefix: string) {
  await operator.function(makeFunctionReference("offlineRolloutFixture:cleanPreparedMeetings"), undefined, { societyId: liveFixture().societyId, prefix });
}
async function sdkRows(page: Page) {
  return page.evaluate(async societyId => {
    const databaseModule = "/src/offline/database.ts", authModule = "/src/lib/authToken.ts", convexModule = "/node_modules/convex/dist/esm/browser/index.js", serverModule = "/node_modules/convex/dist/esm/server/index.js";
    const { openDatabase } = await import(databaseModule);
    const { getAuthToken } = await import(authModule);
    const { ConvexHttpClient } = await import(convexModule);
    const { makeFunctionReference } = await import(serverModule);
    const client = new ConvexHttpClient("http://127.0.0.1:43230"); client.setAuth(await getAuthToken());
    const identity = await client.query(makeFunctionReference("offlineMeetings:syncIdentity"), { societyId });
    const separator = identity.actorKey.lastIndexOf("|");
    const db = await openDatabase({ deployment: "http://127.0.0.1:43230", issuer: identity.actorKey.slice(0, separator), subject: identity.actorKey.slice(separator + 1), societyId });
    try { return await db.readTransaction(async tx => ({ downloads: await tx.getAll("SELECT meeting_uuid, payload FROM offlineMeetingDownloads"), pending: await tx.getAll("SELECT * FROM ps_crud") })); }
    finally { await db.close(); }
  }, liveFixture().societyId);
}

test("production broker, native command, actual PowerSync replica and attachment transfer", async ({ page, browser }) => {
  const prefix = `Rollout qualification ${randomUUID()}`, title = `${prefix} replicated`;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    await open(page); const replica = await context.newPage(); await open(replica, "Director");
    await create(page, title, true); await expect(pending(page)).toContainText("0 pending commands");
    await expect(card(replica, title)).toBeVisible();
    await expect.poll(async () => JSON.stringify(await sdkRows(replica))).toContain(title);
    await card(page, title).getByRole("button", { name: "Send attachment", exact: true }).click();
    await expect(card(page, title)).toContainText("Attachment sent");
    const attachments = replica.locator(".offline-meeting-preparation").getByRole("button", { name: "Save attachment on this device", exact: true });
    await expect(attachments).toHaveCount(1); await expect(attachments).toBeEnabled(); await attachments.click();
    await expect(pending(replica)).toContainText("Attachment verified and saved on this device");
    const saved = replica.waitForEvent("download"); await replica.getByRole("button", { name: "Download saved production-live.txt", exact: true }).click();
    const file = await saved; expect(readFileSync((await file.path())!, "utf8")).toBe("Production native attachment bytes\n");
    await assertLiveFits(page); await assertLiveFits(replica); expect(errors).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
  } finally { await context.close(); await cleanup(prefix); }
});

test("production page applies all five roles and broker rejects forged workspace", async ({ page }) => {
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
    // Separate actual sessions; the preceding role is explicitly signed out.
    if (role !== "Owner") await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
    await open(page, role);
    const writable = ["Owner", "Admin", "Director"].includes(role);
    await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toHaveCount(writable ? 1 : 0);
    if (writable) await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeEnabled();
    await assertLiveFits(page);
    const denied = await page.evaluate(async societyId => {
      const module = "/src/lib/authToken.ts"; const { authenticatedFetch } = await import(module);
      const response = await authenticatedFetch("/api/v1/offline/meeting-preparation/credentials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ societyId }) });
      return { status: response.status, result: await response.json() };
    }, laboratory.fixture.societyB);
    expect(denied.status).toBe(403); expect(JSON.stringify(denied.result)).not.toContain('"token"');
  }
});

test("offline parent and dependent child reconnect through production uploads and real replication", async ({ page, context }) => {
  const prefix = `Rollout qualification ${randomUUID()}`, title = `${prefix} offline`;
  try {
    await open(page); await context.setOffline(true); await create(page, title);
    await card(page, title).locator("textarea").fill("Offline authored dependent minutes");
    await card(page, title).getByRole("button", { name: "Save minutes on this device", exact: true }).click();
    await expect(pending(page)).toContainText("2 pending commands");
    await context.setOffline(false); await expect(pending(page)).toContainText("0 pending commands");
    await expect.poll(async () => JSON.stringify(await sdkRows(page))).toContain("Offline authored dependent minutes");
    await assertLiveFits(page);
  } finally { await context.setOffline(false); await cleanup(prefix); }
});

test("stale unsaved minutes require explicit resolution and stale queued descendants are quarantined", async ({ page, browser }) => {
  const prefix = `Rollout qualification ${randomUUID()}`, title = `${prefix} conflict`;
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    await open(page); await create(page, title); await expect(pending(page)).toContainText("0 pending commands");
    const second = await context.newPage(); await open(second); await expect(card(second, title)).toBeVisible();
    await card(second, title).locator("textarea").fill("Unsaved original baseline");
    await card(page, title).locator("textarea").fill("First committed discussion");
    await card(page, title).getByRole("button", { name: "Save minutes on this device", exact: true }).click(); await expect(pending(page)).toContainText("0 pending commands");
    await expect(card(second, title)).toContainText("Newer minutes are available");
    await card(second, title).getByRole("button", { name: "Use synced minutes", exact: true }).click();
    await expect(card(second, title).locator("textarea")).toHaveValue("First committed discussion");
    await context.setOffline(true);
    await card(second, title).locator("textarea").fill("Queued stale authored work");
    await card(second, title).getByRole("button", { name: "Save minutes on this device", exact: true }).click();
    await expect(pending(second)).toContainText("1 pending commands");
    await expect(card(second, title).getByRole("button", { name: "Save minutes on this device", exact: true })).toBeEnabled();
    await expect(card(second, title).locator("textarea")).toHaveValue("Queued stale authored work");
    await card(second, title).locator("textarea").fill("Dependent stale authored work");
    await card(second, title).getByRole("button", { name: "Save minutes on this device", exact: true }).click();
    await expect(pending(second)).toContainText("2 pending commands");
    await card(page, title).locator("textarea").fill("Authoritative second discussion");
    await card(page, title).getByRole("button", { name: "Save minutes on this device", exact: true }).click(); await expect(pending(page)).toContainText("0 pending commands");
    await expect.poll(async () => JSON.stringify(await sdkRows(page))).toContain("Authoritative second discussion");
    await context.setOffline(false);
    await expect(pending(second)).toContainText("0 pending commands");
    await expect(second.getByRole("region", { name: "Edits needing review", exact: true })).toContainText("2 quarantined edits");
    await expect.poll(async () => (await sdkRows(second)).pending.length).toBe(0);
    await expect.poll(async () => JSON.stringify((await sdkRows(second)).downloads)).toContain("Authoritative second discussion");
    await expect(card(second, title)).toContainText("Authoritative second discussion");
    const download = second.waitForEvent("download"); await second.getByRole("button", { name: "Export recovery", exact: true }).click();
    const saved = await download; const recovery = JSON.parse(readFileSync((await saved.path())!, "utf8"));
    expect(recovery.pending).toHaveLength(0);
    expect(recovery.history.filter((row: { state: string }) => row.state === "quarantined")).toHaveLength(2);
    expect(JSON.stringify(recovery.history)).toContain("Dependent stale authored work");
    expect(JSON.stringify(recovery.history)).toContain("DEPENDENCY_QUARANTINED");
    await expect(second.getByRole("region", { name: "Edits needing review", exact: true })).toContainText("Needs review");
    await expect.poll(async () => JSON.stringify(await sdkRows(second))).toContain("Authoritative second discussion");
    await expect(card(second, title)).toContainText("Authoritative second discussion");
    await assertLiveFits(second);
  } finally { await context.close(); await cleanup(prefix); }
});

test("actual material ACL revocation and scheduled expiry remove downloaded attachment bytes", async ({ page, browser }) => {
  const prefix = `Rollout qualification ${randomUUID()}`, title = `${prefix} ACL`;
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    await open(page); await create(page, title, true); await expect(pending(page)).toContainText("0 pending commands");
    await card(page, title).getByRole("button", { name: "Send attachment", exact: true }).click(); await expect(card(page, title)).toContainText("Attachment sent");
    const saved = page.waitForEvent("download"); await page.getByRole("button", { name: "Export recovery", exact: true }).click();
    const recovery = JSON.parse(readFileSync((await (await saved).path())!, "utf8"));
    const accepted = recovery.history.find((row: { body: string; state: string }) => row.state === "accepted" && JSON.parse(row.body).title === title);
    const result = JSON.parse(accepted.result), materialId = result.mappings.find((row: { table: string }) => row.table === "meetingMaterials").nativeId;
    const token = await page.evaluate(async () => { const module = "/src/lib/authToken.ts"; return (await import(module)).getAuthToken(); });
    const owner = new ConvexHttpClient(laboratory.convexUrl, { logger: false }); owner.setAuth(token!);
    const second = await context.newPage(); await open(second, "Director"); await expect(card(second, title)).toBeVisible();
    const saveFile = second.getByRole("button", { name: "Save attachment on this device", exact: true });
    await expect(saveFile).toHaveCount(1); await expect(saveFile).toBeEnabled(); await saveFile.click(); await expect(pending(second)).toContainText("Attachment verified and saved");
    await expect(second.getByRole("button", { name: "Download saved production-live.txt", exact: true })).toBeVisible();
    await owner.mutation(makeFunctionReference("meetingMaterials:setAvailability"), { id: materialId, availabilityStatus: "withdrawn" });
    await expect(saveFile).toHaveCount(0); await expect(second.getByRole("button", { name: "Download saved production-live.txt", exact: true })).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(await sdkRows(second))).not.toContain('"name":"production-live.txt"');
    await owner.mutation(makeFunctionReference("meetingMaterials:setAvailability"), { id: materialId, availabilityStatus: "available", expiresAtISO: new Date(Date.now() + 8_000).toISOString() });
    await expect(saveFile).toHaveCount(1); await expect(saveFile).toBeEnabled(); await saveFile.click(); await expect(pending(second)).toContainText("Attachment verified and saved");
    await expect(second.getByRole("button", { name: "Download saved production-live.txt", exact: true })).toBeVisible();
    await expect(saveFile).toHaveCount(0); await expect(second.getByRole("button", { name: "Download saved production-live.txt", exact: true })).toHaveCount(0);
    const exported = second.waitForEvent("download"); await second.getByRole("button", { name: "Export recovery", exact: true }).click();
    const cleared = JSON.parse(readFileSync((await (await exported).path())!, "utf8")); expect(cleared.files).toHaveLength(0);
    await expect.poll(async () => JSON.stringify(await sdkRows(second))).not.toContain('"name":"production-live.txt"');
    await assertLiveFits(second);
  } finally { await context.close(); await cleanup(prefix); }
});

test("offline hard reload preserves authored SQLite work and recovers after returning online", async ({ page, context }) => {
  const prefix = `Rollout qualification ${randomUUID()}`, title = `${prefix} reload`;
  try {
    await open(page); await context.setOffline(true); await create(page, title);
    await expect(pending(page)).toContainText("1 pending commands");
    let reloadError = "";
    try { await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }); }
    catch (error) { reloadError = String(error); }
    // The root application does not provide the pilot's offline shell/auth cache.
    // Qualify preservation and online recovery without silently inventing one.
    if (reloadError) expect(reloadError).toMatch(/ERR_INTERNET_DISCONNECTED|offline|Timeout|net::ERR/i);
    await context.setOffline(false); await page.goto("/app/meetings/offline");
    await expect(page.getByRole("button", { name: "Export recovery", exact: true })).toBeEnabled();
    await expect(card(page, title)).toBeVisible();
    await expect.poll(async () => JSON.stringify(await sdkRows(page))).toContain(title);
    await expect(pending(page)).toContainText("0 pending commands");
    await assertLiveFits(page);
    test.info().annotations.push({ type: "offline-root-shell", description: reloadError ? "Offline navigation unavailable; authored SQLite work recovered on online reopen." : "Cached navigation completed; hosted authentication/recovery was verified after online reopen only." });
  } finally { await context.setOffline(false); await cleanup(prefix); }
});
