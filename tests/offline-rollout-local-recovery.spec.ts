import { expect, test } from "@playwright/test";

// These contracts use the actual IndexedDB implementation, including failed
// transactions and reopen. They never upload a vault to the hosted backend.
test("restore waits for startup and retains the restored vault after reopening", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDexieRowStore.ts";
    const { LocalDexieRowStore, LocalDexieDatabase } = await import(modulePath);
    const name = `recovery-startup-${crypto.randomUUID()}`;
    const original = LocalDexieRowStore.prototype.hydrate;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    LocalDexieRowStore.prototype.hydrate = async function(seed: Record<string, any[]>) {
      await gate;
      return original.call(this, seed);
    };
    const store = new LocalDexieRowStore({ societies: [{ _id: "old", name: "Old startup seed" }] }, { databaseName: name });
    LocalDexieRowStore.prototype.hydrate = original;
    let completed = false;
    const restoring = store.importSnapshot({ tables: { societies: [{ _id: "restored", name: "Restored organization" }] }, attachments: [
      { key: "reference", provider: "filesystem", storageKey: "documents/restored.txt", fileSizeBytes: 3, createdAtISO: "2026-10-01T00:00:00Z", updatedAtISO: "2026-10-01T00:00:00Z" },
    ] }).then(() => { completed = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      const waited = !completed;
      release();
      await restoring;
      await store.whenHydrated();
      const before = await store.exportSnapshot();
      store.db?.close();
      const reopened = new LocalDexieRowStore({}, { databaseName: name });
      await reopened.whenHydrated();
      const after = await reopened.exportSnapshot();
      reopened.db?.close();
      return { waited, before, after };
    } finally {
      release();
      await restoring;
      store.db?.close();
      await new LocalDexieDatabase(name).delete();
    }
  });
  expect(result.waited).toBe(true);
  expect(result.before.tables.societies.map((row: any) => row._id)).toEqual(["restored"]);
  expect(result.after.tables.societies.map((row: any) => row._id)).toEqual(["restored"]);
  expect(result.after.attachments).toHaveLength(1);
  expect(result.after.attachments[0].storageKey).toBe("documents/restored.txt");
});

test("failed storage restore rolls every table back without replacing the visible vault", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDexieRowStore.ts";
    const { LocalDexieRowStore, LocalDexieDatabase } = await import(modulePath);
    const name = `recovery-atomic-${crypto.randomUUID()}`;
    const store = new LocalDexieRowStore({}, { databaseName: name });
    await store.whenHydrated();
    await store.importSnapshot({ tables: { societies: [{ _id: "existing", name: "Keep existing organization" }], meetings: [{ _id: "existing-meeting", societyId: "existing", title: "Keep existing meeting" }] },
      attachments: [{ key: "old-file", provider: "filesystem", storageKey: "old.txt", createdAtISO: "2026-10-01T00:00:00Z", updatedAtISO: "2026-10-01T00:00:00Z" }] });
    const before = await store.exportSnapshot();
    const actualBulkPut = store.db.records.bulkPut.bind(store.db.records);
    store.db.records.bulkPut = async () => { throw new Error("Injected restore disk failure"); };
    let rejected = false;
    try {
      await store.importSnapshot({ tables: { societies: [{ _id: "replacement", name: "Must not replace" }] }, attachments: [] });
    } catch { rejected = true; }
    store.db.records.bulkPut = actualBulkPut;
    try {
      const visible = await store.exportSnapshot();
      store.db.close();
      const reopened = new LocalDexieRowStore({}, { databaseName: name });
      await reopened.whenHydrated();
      const persisted = await reopened.exportSnapshot();
      reopened.db?.close();
      return { rejected, before, visible, persisted };
    } finally {
      store.db?.close();
      await new LocalDexieDatabase(name).delete();
    }
  });
  expect(result.rejected).toBe(true);
  expect(result.visible.tables).toEqual(result.before.tables);
  expect(result.persisted.tables).toEqual(result.before.tables);
  expect(result.persisted.attachments).toEqual(result.before.attachments);
});

test("direct restore rejects corrupt records and strips hosted authority while retaining local history", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDexieRowStore.ts";
    const { LocalDexieRowStore, LocalDexieDatabase } = await import(modulePath);
    const name = `recovery-authority-${crypto.randomUUID()}`;
    const store = new LocalDexieRowStore({}, { databaseName: name });
    await store.whenHydrated();
    await store.importSnapshot({ tables: { societies: [{ _id: "local", name: "Original local organization" }] } });
    const invalid = [
      { tables: { societies: [{ name: "Missing identifier" }] } },
      { tables: { societies: [{ _id: "duplicate", name: "A" }, { _id: "duplicate", name: "B" }] } },
      { tables: JSON.parse('{"__proto__":[],"societies":[]}') },
      { tables: {}, attachments: [{ key: "file", provider: "filesystem", storageKey: "" }] },
      { tables: {}, attachments: [{ key: "file", provider: "filesystem", storageKey: "one" }, { key: "file", provider: "filesystem", storageKey: "two" }] },
    ];
    let rejected = 0;
    for (const snapshot of invalid) {
      try { await store.importSnapshot(snapshot); } catch { rejected++; }
    }
    const retained = await store.exportSnapshot();
    const input = { tables: { societies: [{ _id: "restored", name: "Restored local organization" }],
      users: [{ _id: "historical-user", societyId: "restored", role: "Owner", status: "Active", email: "history@example.test", authIssuer: "https://hosted.example.test", authSubject: "verified-before-export", externalIdentityId: "identity", authProvider: "clerk", emailVerifiedAtISO: "2026-10-01T00:00:00Z", lastLoginAtISO: "2026-10-01T00:00:00Z" }],
      externalIdentities: [{ _id: "identity", issuer: "https://hosted.example.test", subject: "verified-before-export", status: "Active" }],
      pathwayRuns: [{ _id: "history-run", status: "ready", inputsFrozen: false }],
      pathwaySubmissionOutbox: [{ _id: "submission", status: "queued" }],
    } };
    try {
      await store.importSnapshot(input);
      const restored = await store.exportSnapshot();
      return { rejected, retained, restored, originalSubject: input.tables.users[0].authSubject };
    } finally {
      store.db?.close();
      await new LocalDexieDatabase(name).delete();
    }
  });
  expect(result.rejected).toBe(5);
  expect(result.retained.tables.societies[0]._id).toBe("local");
  expect(result.restored.tables.externalIdentities).toBeUndefined();
  const user = result.restored.tables.users[0];
  expect(user._id).toBe("historical-user"); expect(user.role).toBe("Owner");
  for (const field of ["authIssuer", "authSubject", "externalIdentityId", "authProvider", "emailVerifiedAtISO", "lastLoginAtISO"]) expect(user[field]).toBeUndefined();
  expect(result.originalSubject).toBe("verified-before-export");
  expect(result.restored.tables.pathwayRuns[0].status).toBe("imported_readonly");
  expect(result.restored.tables.pathwaySubmissionOutbox[0].status).toBe("blocked");
});

// WP-K storage layout 2: heavy fields live in `recordFields`, out of the boot
// read and the row cache, and are loaded only on demand. Backups stay complete.
test("heavy fields stay out of the row cache, load on demand and survive reopen and backup", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDexieRowStore.ts";
    const { LocalDexieRowStore, LocalDexieDatabase } = await import(modulePath);
    const name = `heavy-fields-${crypto.randomUUID()}`;
    const longText = "Synthetic extracted text. ".repeat(400);
    try {
      const store = new LocalDexieRowStore({}, { databaseName: name });
      await store.whenHydrated();
      await store.importSnapshot({ tables: {
        societies: [{ _id: "s1", name: "Heavy field society" }],
        documents: [{ _id: "d1", societyId: "s1", title: "Big", content: longText }, { _id: "d2", societyId: "s1", title: "Small", content: "short" }],
      } });
      const cachedAfterImport = store.getRow("documents", "d1");
      await store.commitBatch([{ kind: "upsert", table: "documents", row: { _id: "d3", societyId: "s1", title: "Written", content: longText + "!" } }]);
      // A legacy (light-row) patch must keep the externalized content.
      store.patchRow("documents", "d1", { title: "Big (renamed)" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      store.db.close();
      const reopened = new LocalDexieRowStore({}, { databaseName: name });
      await reopened.whenHydrated();
      const light = reopened.getRow("documents", "d1");
      const external = reopened.externalFields("documents", "d1");
      const loaded = await reopened.loadExternalFields("documents", ["d1", "d2", "d3"]);
      const backup = await reopened.exportSnapshot();
      let syncError = "";
      try { reopened.exportSnapshotSync(); } catch (error) { syncError = String(error); }
      reopened.db.close();
      return {
        cachedAfterImport, light, external,
        loaded: Object.fromEntries([...loaded].map(([id, fields]: [string, Record<string, unknown>]) => [id, Object.keys(fields).map((key) => `${key}:${String(fields[key]).length}`)])),
        backup: backup.tables.documents.map((row: any) => ({ _id: row._id, title: row.title, contentLength: String(row.content ?? "").length })),
        syncError,
        longLength: longText.length,
      };
    } finally {
      await new LocalDexieDatabase(name).delete();
    }
  });
  expect(result.cachedAfterImport.content).toBeUndefined();
  expect(result.light).toMatchObject({ _id: "d1", title: "Big (renamed)" });
  expect(result.light.content).toBeUndefined();
  expect(result.external).toEqual(["content"]);
  expect(result.loaded).toEqual({ d1: [`content:${result.longLength}`], d3: [`content:${result.longLength + 1}`] });
  expect(result.backup).toEqual([
    { _id: "d1", title: "Big (renamed)", contentLength: result.longLength },
    { _id: "d2", title: "Small", contentLength: 5 },
    { _id: "d3", title: "Written", contentLength: result.longLength + 1 },
  ]);
  expect(result.syncError).toContain("exportSnapshot()");
});

test("a layout-1 vault is migrated in place to lazy heavy fields without losing data", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/localDexieRowStore.ts";
    const { LocalDexieRowStore, LocalDexieDatabase } = await import(modulePath);
    const name = `layout-migration-${crypto.randomUUID()}`;
    const source = { text: "Verbatim source minutes. ".repeat(300) };
    try {
      // Write a vault the way layout 1 did: whole rows in `records`, minutes
      // mirrored into the legacy v1 store, no storageLayout marker.
      const legacy = new LocalDexieDatabase(name);
      await legacy.open();
      const minutes = { _id: "m1", societyId: "s1", meetingId: "mt1", discussion: "Kept inline", sourceMeetingRecord: source };
      await legacy.records.bulkPut([
        { key: "societies:s1", table: "societies", id: "s1", value: { _id: "s1", name: "Legacy society" } },
        { key: "minutes:m1", table: "minutes", id: "m1", societyId: "s1", value: minutes },
      ]);
      await legacy.minutes.put(minutes);
      await legacy.meta.bulkPut([{ key: "schemaVersion", value: 3 }, { key: "workspace", value: { id: name, name: "Legacy", schemaVersion: 3, createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" } }]);
      legacy.close();

      const store = new LocalDexieRowStore({}, { databaseName: name });
      await store.whenHydrated();
      const cached = store.getRow("minutes", "m1");
      const stored = await store.db.records.get("minutes:m1");
      const fields = await store.db.recordFields.get("minutes:m1");
      const legacyMirror = await store.db.minutes.count();
      const layout = (await store.db.meta.get("storageLayout"))?.value;
      const backup = await store.exportSnapshot();
      store.db.close();
      return { cached, storedValueKeys: Object.keys(stored.value), storedExternal: stored.external, fieldKeys: Object.keys(fields?.fields ?? {}), legacyMirror, layout, backupMinutes: backup.tables.minutes[0], sourceLength: source.text.length };
    } finally {
      await new LocalDexieDatabase(name).delete();
    }
  });
  expect(result.cached.discussion).toBe("Kept inline");
  expect(result.cached.sourceMeetingRecord).toBeUndefined();
  expect(result.storedValueKeys).not.toContain("sourceMeetingRecord");
  expect(result.storedExternal).toEqual(["sourceMeetingRecord"]);
  expect(result.fieldKeys).toEqual(["sourceMeetingRecord"]);
  expect(result.legacyMirror).toBe(0);
  expect(result.layout).toBe(2);
  expect(result.backupMinutes.sourceMeetingRecord.text.length).toBe(result.sourceLength);
  expect(result.backupMinutes.discussion).toBe("Kept inline");
});
