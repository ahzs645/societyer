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
