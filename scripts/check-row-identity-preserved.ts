// Rows keep their durable identity (`entityId`) and creation time through every local write path, so a
// backup restored into a fresh profile re-exports with identical rows (not only identical ids).
//
// Found on a full-archive backup round trip: `ctx.db.replace` (used by minutes section sync for agenda
// items) dropped `_creationTime` and `entityId`, and the legacy row API (`upsertRow`, used for uploaded
// document versions) wrote rows without an `entityId`; the restore migration then minted new ones, so the
// re-export differed from the backup on ~2,000 rows.
import assert from "node:assert/strict";
import { MemoryDb, LocalStoreDb, MemoryRowStore, looksLikeEntityId } from "../shared/portable/index";
import { preservedSystemFields } from "../shared/portable/ids";
import { LocalDexieRowStore, migrateLocalWorkspaceSnapshotTables } from "../src/lib/localDexieRowStore";

// 1. Portable engines: replace keeps the system fields it is not given (Convex keeps _creationTime).
for (const [label, db] of [["MemoryDb", new MemoryDb()], ["LocalStoreDb", new LocalStoreDb(new MemoryRowStore())]] as const) {
  const id = await db.transaction(() => db.insert("agendaItems", { societyId: "s1", agendaId: "a1", order: 0, title: "Call to order", type: "discussion", depth: 0 }));
  const before = await db.get(id);
  assert.ok(before?.entityId && looksLikeEntityId(before.entityId, "agendaItems"), `${label}: insert mints an entityId`);
  assert.equal(typeof before?._creationTime, "number", `${label}: insert sets _creationTime`);
  await db.transaction(() => db.replace(id, { societyId: "s1", agendaId: "a1", order: 1, title: "Adoption of the agenda", type: "motion", depth: 0 }));
  const after = await db.get(id);
  assert.equal(after?.title, "Adoption of the agenda", `${label}: replace writes the new fields`);
  assert.equal(after?.order, 1);
  assert.equal(after?.entityId, before!.entityId, `${label}: replace keeps the entityId`);
  assert.equal(after?._creationTime, before!._creationTime, `${label}: replace keeps _creationTime`);
  assert.ok(!("presenter" in (after ?? {})), `${label}: replace still drops fields the new document leaves out`);
  await db.transaction(() => db.replace(id, { title: "Supplied identity", entityId: "agendaItems_SUPPLIED" }));
  assert.equal((await db.get(id))?.entityId, "agendaItems_SUPPLIED", `${label}: a supplied entityId wins`);
}
assert.deepEqual(preservedSystemFields(null, {}), {});
assert.deepEqual(preservedSystemFields({ _creationTime: 5, entityId: "x_1" }, { _creationTime: 7 }), { entityId: "x_1" });

// 2. Legacy row API (static dispatch writes, e.g. documentVersions:recordUploadedVersion).
const store = new LocalDexieRowStore({});
store.upsertRow("documentVersions", { _id: "documentVersions_1", documentId: "documents_1", version: 1, isCurrent: true, fileName: "a.pdf" });
const first = store.getRow("documentVersions", "documentVersions_1");
assert.ok(first?.entityId && looksLikeEntityId(first.entityId, "documentVersions"), "legacy upsert mints an entityId for a new row");
assert.equal(typeof first?._creationTime, "number", "legacy upsert sets _creationTime for a new row");
// A hand-built row for an existing id (no system fields) keeps the stored identity and creation time.
store.upsertRow("documentVersions", { _id: "documentVersions_1", documentId: "documents_1", version: 1, isCurrent: false, fileName: "a.pdf" });
const second = store.getRow("documentVersions", "documentVersions_1");
assert.equal(second?.isCurrent, false);
assert.equal(second?.entityId, first!.entityId, "legacy upsert keeps the stored entityId");
assert.equal(second?._creationTime, first!._creationTime, "legacy upsert keeps the stored _creationTime");
// Rows that carry their own system fields are written as given.
store.upsertRow("documentVersions", { _id: "documentVersions_2", entityId: "documentVersions_GIVEN", _creationTime: 42 });
assert.equal(store.getRow("documentVersions", "documentVersions_2")?.entityId, "documentVersions_GIVEN");
assert.equal(store.getRow("documentVersions", "documentVersions_2")?._creationTime, 42);

// 3. Round trip: the restore migration finds nothing to mint, so restored rows equal the exported rows.
const snapshot = await store.exportSnapshot();
const migrated = migrateLocalWorkspaceSnapshotTables(snapshot.tables as any);
assert.deepEqual(
  (migrated.documentVersions ?? []).map((row: any) => [row._id, row.entityId, row._creationTime]),
  (snapshot.tables.documentVersions ?? []).map((row: any) => [row._id, row.entityId, row._creationTime]),
  "restoring a backup keeps every exported entityId",
);

console.log("✓ row identity: replace and legacy upserts keep entityId/_creationTime; restore mints nothing new");
