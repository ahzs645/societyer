import { test, expect, type Page } from "@playwright/test";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message));
  await request.post("/__fixture/reset"); await page.goto("/meeting.html");
  await expect(page.locator("#status")).toContainText("Ready");
  await page.reload(); await expect(page.locator("#status")).toContainText("Ready");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });
async function save(page: Page, title = "Offline board preparation", attachment = false) {
  await page.getByLabel("Meeting title", { exact: true }).fill(title);
  await page.getByLabel("Preparation notes").fill("Preparation notes that must survive restart");
  if (attachment) await page.getByLabel("Meeting attachment").setInputFiles({ name: "preparation.txt", mimeType: "text/plain", buffer: Buffer.from("Offline preparation file") });
  await page.getByRole("button", { name: "Save meeting on this device", exact: true }).click();
  await expect(page.locator("#meetings")).toContainText(title);
}
async function saveMinutes(page: Page, discussion = "Child draft that must survive restart") {
  await page.getByLabel("Minutes discussion").fill(discussion);
  await page.getByRole("button", { name: "Save minutes on this device", exact: true }).click();
  await expect(page.locator("#meetings")).toContainText(discussion);
}
async function upload(page: Page) {
  await page.getByRole("button", { name: "Upload meeting commands", exact: true }).click();
  await expect(page.locator("#queue")).toHaveText("0 pending commands");
}
async function refresh(page: Page) {
  await page.getByRole("button", { name: "Refresh authorized fixture view", exact: true }).click();
  await expect(page.locator("#status")).toContainText("view refreshed");
}
test("meeting graph, child edit and attachment bytes survive offline restart", async ({ page, context, request }) => {
  await context.setOffline(true); await save(page, "Offline board preparation", true); await saveMinutes(page);
  await expect(page.locator("#queue")).toHaveText("2 pending commands");
  await page.reload(); await expect(page.locator("#status")).toContainText("Ready · offline");
  await expect(page.locator("#meetings")).toContainText("Child draft that must survive restart");
  await expect(page.locator("#meetings")).toContainText("transfer pending");
  await context.setOffline(false); await upload(page); await refresh(page);
  await expect(page.locator("#server")).toContainText("revision 2");
  await expect(page.locator("#server")).toContainText("bytes not available from server");
  await page.getByRole("button", { name: "Transfer attachment bytes", exact: true }).click();
  await expect(page.locator("#status")).toContainText("bytes accepted"); await refresh(page);
  await expect(page.locator("#server")).toContainText("available from server");
  const snapshots = await (await request.get("/__fixture/meeting-snapshot?subject=owner-a")).json();
  expect(snapshots[0].discussion).toBe("Child draft that must survive restart"); expect(snapshots[0].agenda).toEqual(["Opening discussion"]);
});
test("lost command acknowledgement preserves command and persistent mapping on retry", async ({ page, request }) => {
  await save(page); await request.post("/__fixture/lose-ack", { data: { subject: "owner-a" } });
  await page.getByRole("button", { name: "Upload meeting commands" }).click();
  await expect(page.getByRole("alert")).toContainText("lost acknowledgement"); await expect(page.locator("#queue")).toHaveText("1 pending commands");
  await page.reload(); await expect(page.locator("#status")).toContainText("Ready"); await upload(page); await saveMinutes(page); await upload(page);
  const snapshots = await (await request.get("/__fixture/meeting-snapshot?subject=owner-a")).json(); expect(snapshots).toHaveLength(1); expect(snapshots[0].revision).toBe(2);
});
test("rejected parent holds dependent child and attachment with a durable recovery export", async ({ page, request }) => {
  await save(page, "Held parent draft", true); await saveMinutes(page, "Held child draft");
  await request.post("/__fixture/role", { data: { subject: "owner-a", role: "Member" } });
  await page.getByRole("button", { name: "Upload meeting commands" }).click();
  await expect(page.getByRole("alert")).toContainText("meetings:write"); await expect(page.locator("#queue")).toHaveText("2 pending commands");
  await page.getByRole("button", { name: "Transfer attachment bytes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Parent command must be accepted");
  await page.reload(); await expect(page.locator("#meetings")).toContainText("Held child draft");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export recovery copy" }).click();
  const path = await (await download).path(); const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile(path!, "utf8"));
  expect(exported.pending).toHaveLength(2); expect(exported.files).toHaveLength(1); expect(exported.history[0].state).toBe("review");
  expect(await (await request.get("/__fixture/meeting-snapshot?subject=owner-a")).json()).toHaveLength(0);
});
test("two isolated browser clients retain both conflicting minute drafts", async ({ page, browser }) => {
  await save(page); await upload(page); await saveMinutes(page, "First client's offline draft");
  const other = await browser.newContext(); const second = await other.newPage();
  const secondErrors: string[] = []; second.on("pageerror", error => secondErrors.push(error.message));
  try {
    await second.goto("/meeting.html"); await expect(second.locator("#status")).toContainText("Ready"); await refresh(second);
    await saveMinutes(second, "Second client's accepted draft");
    await upload(second);
    await page.getByRole("button", { name: "Upload meeting commands" }).click();
    await expect(page.getByRole("alert")).toContainText("REVISION_CONFLICT"); await expect(page.locator("#queue")).toHaveText("1 pending commands");
    await refresh(page); await expect(page.locator("#server")).toContainText("Second client's accepted draft"); await expect(page.locator("#meetings")).toContainText("First client's offline draft");
    await page.reload(); await expect(page.locator("#meetings")).toContainText("First client's offline draft");
    expect(secondErrors).toEqual([]);
  } finally { await other.close(); }
});
test("downloaded view respects workspace, Viewer ACL and membership revocation", async ({ page, request }) => {
  await save(page, "Private board material", true); await upload(page); await refresh(page);
  await page.getByLabel("Evaluation account").selectOption("viewer-a"); await expect(page.locator("#status")).toContainText("Ready");
  await refresh(page); await expect(page.locator("#server")).toContainText("Private board material"); await expect(page.locator("#server")).not.toContainText("preparation.txt");
  await expect(page.getByRole("button", { name: "Save meeting on this device", exact: true })).toBeDisabled();
  await page.getByLabel("Evaluation account").selectOption("owner-b"); await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#meetings")).not.toContainText("Private board material"); await refresh(page); await expect(page.locator("#server")).toBeEmpty();
  await page.getByLabel("Evaluation account").selectOption("owner-a"); await expect(page.locator("#status")).toContainText("Ready");
  await request.post("/__fixture/role", { data: { subject: "owner-a", role: "Owner", status: "Disabled" } });
  await page.getByRole("button", { name: "Refresh authorized fixture view" }).click(); await expect(page.getByRole("alert")).toContainText("disabled"); await expect(page.locator("#server")).toBeEmpty();
});
test("attachment transfers to second browser independently of record download", async ({ page, browser }) => {
  await save(page, "Shared meeting fixture", true); await upload(page);
  const other = await browser.newContext(); const second = await other.newPage();
  const secondErrors: string[] = []; second.on("pageerror", error => secondErrors.push(error.message));
  try {
    await second.goto("/meeting.html"); await expect(second.locator("#status")).toContainText("Ready"); await refresh(second);
    await expect(second.locator("#server")).toContainText("bytes not available from server");
    await page.getByRole("button", { name: "Transfer attachment bytes", exact: true }).click(); await expect(page.locator("#status")).toContainText("bytes accepted"); await refresh(second);
    await second.getByRole("button", { name: "Download attachment to this device" }).click(); await expect(second.locator("#status")).toContainText("downloaded and verified");
    await second.reload(); await expect(second.locator("#status")).toContainText("Ready");
    const download = second.waitForEvent("download"); await second.getByRole("button", { name: "Export recovery copy" }).click();
    const path = await (await download).path(); const { readFile } = await import("node:fs/promises"); const recovery = JSON.parse(await readFile(path!, "utf8"));
    expect(recovery.files).toHaveLength(1); expect(Buffer.from(recovery.files[0].content, "base64").toString()).toBe("Offline preparation file"); expect(secondErrors).toEqual([]);
  } finally { await other.close(); }
});
test("phone and desktop keep meeting and recovery controls within the viewport", async ({ page }) => {
  await save(page, "X".repeat(190)); await saveMinutes(page, "Y".repeat(500));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole("button", { name: "Export recovery copy" })).toBeVisible();
});
test("unknown persisted command version is retained for upgrade recovery", async ({ page }) => {
  await page.evaluate(async () => {
    const databaseUrl = "/src/database.ts"; const { openDatabase } = await import(databaseUrl) as typeof import("../src/database");
    const session = JSON.parse(localStorage.getItem("societyer.meeting-pilot.session.owner-a")!);
    const scope = { deployment: "convex-test:meeting-pilot", issuer: session.issuer, subject: session.subject, societyId: session.societyId };
    const db = await openDatabase(scope);
    const command = { version: 0, operationId: crypto.randomUUID(), meetingUuid: crypto.randomUUID(), baseRevision: 1, kind: "edit-minutes", discussion: "Old schema work to preserve" };
    await db.writeTransaction(async tx => {
      await tx.execute("INSERT INTO offlineMeetingCommands (id, society_id, body, _metadata) VALUES (?, ?, ?, ?)", [command.operationId, scope.societyId, JSON.stringify(command), JSON.stringify({ scope, command })]);
      await tx.execute("INSERT INTO meetingCommandHistory (id, meeting_uuid, body, state) VALUES (?, ?, ?, 'waiting')", [command.operationId, command.meetingUuid, JSON.stringify(command)]);
    }); await db.close();
  });
  await page.reload(); await expect(page.locator("#queue")).toHaveText("1 pending commands");
  await page.getByRole("button", { name: "Upload meeting commands" }).click(); await expect(page.getByRole("alert")).toContainText("UNSUPPORTED_COMMAND_VERSION");
  await expect(page.locator("#queue")).toHaveText("1 pending commands");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export recovery copy" }).click();
  const path = await (await download).path(); const { readFile } = await import("node:fs/promises"); const recovery = JSON.parse(await readFile(path!, "utf8"));
  expect(recovery.history[0].state).toBe("review"); expect(JSON.parse(recovery.history[0].body).discussion).toBe("Old schema work to preserve");
});
test("session change during accepted command does not acknowledge another account's queue", async ({ page, request }) => {
  await save(page, "Meeting before account switch");
  let release!: () => void; let committed!: () => void; let fulfilled!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const accepted = new Promise<void>(resolve => { committed = resolve; });
  const returned = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route("**/__fixture/meeting-command", async route => { const response = await route.fetch(); committed(); await hold; await route.fulfill({ response }); fulfilled(); });
  await page.getByRole("button", { name: "Upload meeting commands" }).click(); await accepted;
  await page.getByLabel("Evaluation account").selectOption("owner-b"); await expect(page.locator("#queue")).toHaveText("0 pending commands");
  release(); await returned; await page.unroute("**/__fixture/meeting-command");
  await page.getByLabel("Evaluation account").selectOption("owner-a"); await expect(page.locator("#queue")).toHaveText("1 pending commands"); await upload(page);
  expect(await (await request.get("/__fixture/meeting-snapshot?subject=owner-a")).json()).toHaveLength(1);
});
test("durable SQLite commit failure rolls back local graph and command together", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const databaseUrl = "/src/database.ts"; const { openDatabase } = await import(databaseUrl) as typeof import("../src/database"); const storeUrl = "/src/meetingStore.ts"; const { saveMeetingCommand, newKeys } = await import(storeUrl) as typeof import("../src/meetingStore");
    const session = JSON.parse(localStorage.getItem("societyer.meeting-pilot.session.owner-a")!);
    const scope = { deployment: "convex-test:meeting-pilot", issuer: session.issuer, subject: session.subject, societyId: session.societyId };
    const db = await openDatabase(scope); const keys = newKeys();
    // Fail after portable row writes, within the REAL SQLite transaction.
    const fault: any = { getAll: db.getAll.bind(db), getOptional: db.getOptional.bind(db), writeTransaction: (body: any) => db.writeTransaction(tx => body({
      getOptional: tx.getOptional.bind(tx), execute: (sql: string, params: any[]) => { if (sql.startsWith("INSERT INTO offlineMeetingCommands")) throw new Error("Simulated durable commit failure"); return tx.execute(sql, params); },
    })) };
    let error = "";
    try { await saveMeetingCommand(fault, scope, "Owner", { version: 1, operationId: crypto.randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: "create-meeting", keys, title: "Must not partially persist", notes: "", scheduledAt: "2026-11-15T10:00:00Z", agendaTitle: "Opening discussion" }); }
    catch (value) { error = String(value); }
    const rows = await db.getAll("SELECT * FROM portableMeetingRows"); const queue = await db.getAll("SELECT * FROM ps_crud");
    await db.close(); return { error, rows: rows.length, queue: queue.length };
  });
  expect(result.error).toContain("durable commit failure"); expect(result.rows).toBe(0); expect(result.queue).toBe(0);
});
