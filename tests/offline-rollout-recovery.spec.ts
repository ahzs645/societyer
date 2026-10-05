import { test, expect } from "@playwright/test";

/** Actual PowerSync WASM/IndexedDB/SDK outbox. The transport outcomes are
 * deliberately injected; native command/replication proof lives separately. */
for (const scenario of ["permanent-dependency", "transient-retry", "accepted-ack-replay", "authorization-quarantine"] as const) {
  test(`real SQLite recovery: ${scenario}`, async ({ page }) => {
    await page.goto("/login");
    const outcome = await page.evaluate(async scenario => {
      const databaseModule = "/src/offline/database.ts";
      const connectorModule = "/src/offline/meetingConnector.ts";
      const storeModule = "/src/offline/meetingStore.ts";
      const { openDatabase } = await import(databaseModule);
      const { MeetingConnector } = await import(connectorModule);
      const { saveMeetingCommand, newKeys, exportMeetingRecovery, prepareFile } = await import(storeModule);
      const scope = { deployment: location.origin, issuer: "contract-real-sqlite", subject: crypto.randomUUID(), societyId: crypto.randomUUID() };
      const keys = newKeys();
      let db = await openDatabase(scope);
      let calls = 0, denied = 0;
      const file = await prepareFile(new File(["Durable authored bytes"], "authored.txt", { type: "text/plain" }));
      const command = { version: 1, operationId: crypto.randomUUID(), kind: "create-meeting", meetingUuid: keys.meeting,
        keys, baseRevision: 0, title: "Durable recovery", scheduledAt: "2026-11-15T10:00:00Z", notes: "Authored notes", agendaTitle: "Authored agenda", file: file.descriptor };
      try {
        await saveMeetingCommand(db, scope, "Owner", command, file);
        if (scenario === "permanent-dependency") {
          await saveMeetingCommand(db, scope, "Owner", { version: 1, operationId: crypto.randomUUID(), meetingUuid: keys.meeting,
            kind: "edit-minutes", baseRevision: 1, discussion: "Dependent authored minutes" });
        }
        let mode = scenario;
        const connector = new MeetingConnector(scope, { async applyCommand() {
          calls++;
          if (mode === "permanent-dependency") throw new Error("REVISION_CONFLICT: actual command was changed elsewhere.");
          if (mode === "authorization-quarantine") throw new Error("Permission meetings:write required");
          if (mode === "transient-retry") throw new Error("Network request failed");
          return { accepted: true, revision: 1, replay: false, mappings: [] };
        } }, () => true, undefined, { async onAuthorizationDenied() { denied++; } });
        let failure: string | null = null;
        if (scenario === "accepted-ack-replay") {
          const original = db.getNextCrudTransaction.bind(db);
          let interrupt = true;
          db.getNextCrudTransaction = async (...args: unknown[]) => {
            const transaction = await original(...args);
            if (transaction && interrupt) {
              interrupt = false;
              transaction.complete = async () => { throw new Error("Interrupted after durable receipt before SDK acknowledgement"); };
            }
            return transaction;
          };
        }
        try { await connector.uploadData(db); } catch (error) { failure = String(error); }
        const before = await exportMeetingRecovery(db, scope);
        if (scenario === "transient-retry") mode = "accepted-ack-replay";
        if (scenario !== "authorization-quarantine") await connector.uploadData(db);
        const result = await exportMeetingRecovery(db, scope);
        const hasSdkTransaction = Boolean(await db.getNextCrudTransaction());
        await db.close(); db = await openDatabase(scope);
        const afterReopen = await exportMeetingRecovery(db, scope);
        return { calls, denied, failure, before, result, afterReopen, hasSdkTransaction };
      } finally { await db.disconnectAndClear(); await db.close(); }
    }, scenario);
    expect(outcome.hasSdkTransaction).toBe(false);
    expect(outcome.result.pending).toHaveLength(0);
    expect(outcome.afterReopen.pending).toHaveLength(0);
    expect(outcome.afterReopen.files).toHaveLength(1);
    expect(outcome.afterReopen.files[0].origin).toBe("authored");
    expect(outcome.afterReopen.rows.length).toBeGreaterThan(0);
    if (scenario === "permanent-dependency") {
      expect(outcome.calls).toBe(1);
      expect(outcome.result.history).toHaveLength(2);
      expect(outcome.result.history.map((row: { state: string }) => row.state)).toEqual(["quarantined", "quarantined"]);
      expect(JSON.stringify(outcome.result.history)).toContain("DEPENDENCY_QUARANTINED");
      expect(JSON.stringify(outcome.result.history)).toContain("Dependent authored minutes");
    } else if (scenario === "transient-retry") {
      expect(outcome.before.pending).toHaveLength(1);
      expect(outcome.before.history[0].state).toBe("review");
      expect(outcome.failure).toContain("Network request failed");
      expect(outcome.calls).toBe(2);
      expect(outcome.result.history[0].state).toBe("accepted");
    } else if (scenario === "accepted-ack-replay") {
      expect(outcome.before.pending).toHaveLength(1);
      expect(outcome.before.history[0].state).toBe("accepted");
      expect(outcome.failure).toContain("Interrupted after durable receipt");
      expect(outcome.calls).toBe(1);
      expect(outcome.result.history[0].state).toBe("accepted");
    } else {
      expect(outcome.denied).toBe(1);
      expect(outcome.calls).toBe(1);
      expect(outcome.result.history[0].state).toBe("quarantined");
      expect(JSON.stringify(outcome.result.history)).toContain("AUTHORIZATION_REJECTED");
    }
  });
}

test("accepted preparation becomes revocable server content while authored recovery remains", async ({ page }) => {
  await page.goto("/login");
  const evidence = await page.evaluate(async () => {
    const databaseModule = "/src/offline/database.ts", storeModule = "/src/offline/meetingStore.ts", connectorModule = "/src/offline/meetingConnector.ts", preparationModule = "/src/offline/meetingPreparation.ts";
    const { openDatabase } = await import(databaseModule);
    const { newKeys, prepareFile, saveMeetingCommand, hydrateMeetingSnapshots, exportMeetingRecovery } = await import(storeModule);
    const { MeetingConnector } = await import(connectorModule);
    const { purgeDownloadedPreparation } = await import(preparationModule);
    const scope = { deployment: location.origin, issuer: "contract-real-sqlite", subject: crypto.randomUUID(), societyId: crypto.randomUUID() };
    const keys = newKeys(), db = await openDatabase(scope);
    try {
      const file = await prepareFile(new File(["Original authored bytes"], "authored.txt"));
      await saveMeetingCommand(db, scope, "Owner", { version: 1, operationId: crypto.randomUUID(), meetingUuid: keys.meeting, kind: "create-meeting", keys,
        baseRevision: 0, title: "Original authored title", notes: "Original authored notes", scheduledAt: "2026-11-15T10:00:00Z", agendaTitle: "Original authored agenda", file: file.descriptor }, file);
      const connector = new MeetingConnector(scope, { async applyCommand() { return { accepted: true, revision: 1, mappings: [], replay: false }; } }, () => true);
      await connector.uploadData(db);
      await hydrateMeetingSnapshots(db, scope, [{ meetingUuid: keys.meeting, revision: 2, title: "Other actor restricted title", scheduledAt: "2026-11-15T10:00:00Z", notes: "Other actor restricted notes",
        ids: { minutes: crypto.randomUUID(), agenda: crypto.randomUUID(), items: [crypto.randomUUID()] }, editable: true, discussion: "Other actor restricted minutes", agenda: ["Restricted agenda"], files: [] }]);
      const before = await exportMeetingRecovery(db, scope);
      await purgeDownloadedPreparation(db);
      const after = await exportMeetingRecovery(db, scope);
      return { before, after };
    } finally { await db.disconnectAndClear(); await db.close(); }
  });
  expect(JSON.stringify(evidence.before.rows)).toContain("Other actor restricted notes");
  expect(evidence.before.rows).toHaveLength(4);
  expect(JSON.stringify(evidence.before.rows)).not.toContain("Original authored agenda");
  expect(evidence.after.rows).toHaveLength(0);
  expect(JSON.stringify(evidence.after)).not.toContain("Other actor restricted");
  expect(evidence.after.history).toHaveLength(1);
  expect(evidence.after.history[0].state).toBe("accepted");
  expect(JSON.stringify(evidence.after.history)).toContain("Original authored notes");
  expect(evidence.after.files).toHaveLength(1);
  expect(evidence.after.files[0].origin).toBe("authored");
});

test("browser offline state blocks an existing transport and retains untouched SDK work", async ({ page, context }) => {
  await page.goto("/login");
  // Browser/CDP may leave an already-open WebSocket alive. Native offline state
  // must block upload independently of that socket's ability to send packets.
  await page.evaluate(async () => {
    const paths = ["/src/offline/database.ts", "/src/offline/meetingConnector.ts", "/src/offline/meetingStore.ts"];
    const modules = await Promise.all(paths.map(path => import(path)));
    const scope = { deployment: location.origin, issuer: "contract-real-sqlite", subject: crypto.randomUUID(), societyId: crypto.randomUUID() };
    (globalThis as any).__rolloutOfflineTest = { modules, scope, db: await modules[0].openDatabase(scope) };
  });
  await context.setOffline(true);
  try {
    const evidence = await page.evaluate(async () => {
      const databaseModule = "/src/offline/database.ts", connectorModule = "/src/offline/meetingConnector.ts", storeModule = "/src/offline/meetingStore.ts";
      void databaseModule; void connectorModule; void storeModule;
      const prepared = (globalThis as any).__rolloutOfflineTest;
      const { MeetingConnector } = prepared.modules[1];
      const { saveMeetingCommand, newKeys, exportMeetingRecovery } = prepared.modules[2];
      const { scope, db } = prepared;
      const keys = newKeys(); let calls = 0;
      try {
        await saveMeetingCommand(db, scope, "Owner", { version: 1, operationId: crypto.randomUUID(), meetingUuid: keys.meeting, kind: "create-meeting", keys,
          baseRevision: 0, title: "Offline transport fence", scheduledAt: "2026-11-15T10:00:00Z", notes: "Unsent authored notes", agendaTitle: "Offline" });
        const connector = new MeetingConnector(scope, { async applyCommand() { calls++; return { accepted: true, revision: 1, replay: false, mappings: [] }; } }, () => true);
        let failure = "";
        try { await connector.uploadData(db); } catch (error) { failure = String(error); }
        return { online: navigator.onLine, calls, failure, recovery: await exportMeetingRecovery(db, scope) };
      } finally { await db.disconnectAndClear(); await db.close(); }
    });
    expect(evidence.online).toBe(false); expect(evidence.calls).toBe(0);
    expect(evidence.failure).toMatch(/offline|network/i);
    expect(evidence.recovery.pending).toHaveLength(1);
    expect(evidence.recovery.history[0].state).toBe("waiting");
  } finally { await context.setOffline(false); }
});
