import assert from "node:assert/strict";
import JSZip from "jszip";
import { archiveDatabaseSnapshot, buildWorkspaceArchive, databaseSource, hashBytes, readWorkspaceArchiveFile } from "../src/lib/workspaceArchive";
import { LocalDexieRowStore } from "../src/lib/localDexieRowStore";
import { archiveFileRows } from "../src/lib/workspaceArchiveFiles";
import { preferredRestoredSocietyId } from "../src/lib/restoredSociety";
const database = { kind: "societyer.localWorkspaceSnapshot", exportedAtISO: "2026-10-06T12:00:00Z", tables: { societies: [{ _id: "s1", name: "Archive test" }], minutes: [{ _id: "m1", societyId: "s1", text: "µg/m³ · source wording", sourceMeetingRecord: { documents: [] } }] }, attachments: [], changes: [{ table: "minutes", id: "m1", op: "upsert", createdAtISO: "2026-10-06T11:00:00Z", snapshot: { text: "Earlier wording" } }] };
const content = new TextEncoder().encode("Exact original file bytes");
const result = await buildWorkspaceArchive(database, async add => {
 await add({ fileName: "../original.doc", provider: "local-filesystem", storageKey: "source/key", documentId: "d1", versionId: "v1", status: "included" }, new Blob([content]));
 await add({ fileName: "second-name.doc", status: "included" }, new Blob([content]));
 await add({ fileName: "external.pdf", status: "external", externalUrl: "https://example.com/source.pdf" });
 await add({ fileName: "missing.pdf", status: "unavailable", reason: "Not on this device" });
});
assert.equal(result.manifest.includedFiles, 1); assert.equal(result.manifest.externalFiles, 1); assert.equal(result.manifest.unavailableFiles, 1); assert.equal(result.manifest.completeStoredFiles, false);
assert.ok(!result.manifest.files[0].archivePath?.split("/").includes(".."));
const restored = await readWorkspaceArchiveFile(new File([result.blob], "backup.zip"));
assert.deepEqual(restored.database, database); assert.equal(restored.files.size, 1); assert.equal(await hashBytes(await restored.files.values().next().value!.arrayBuffer()), await hashBytes(content));
const local = new LocalDexieRowStore({});
const sha256 = await hashBytes(content);
await local.importSnapshot(archiveDatabaseSnapshot(restored.database), archiveFileRows(restored.manifest, restored.files));
assert.equal(await (await local.readRestoredFile({ provider: "local-filesystem", storageKey: "source/key" }))!.text(), "Exact original file bytes");
assert.equal(await (await local.readRestoredFile({ documentId: "d1" }))!.text(), "Exact original file bytes");
assert.equal(await (await local.readRestoredFile({ versionId: "v1" }))!.text(), "Exact original file bytes");
assert.deepEqual((await local.exportSnapshot()).changes[0].snapshot, database.changes[0].snapshot);
await local.importSnapshot((await local.exportSnapshot()), undefined, true);
assert.equal(await (await local.readRestoredFile({ documentId: "d1" }))!.text(), "Exact original file bytes");
const before = (await local.exportSnapshot()).tables;
await assert.rejects(local.importSnapshot({ ...database, changes: [{ bad: true }] } as any), /change history/); assert.deepEqual((await local.exportSnapshot()).tables, before);
const legacy = new JSZip(); legacy.file("legacy-backup.json", JSON.stringify(database)); legacy.file("summary.json", "{}");
assert.deepEqual((await readWorkspaceArchiveFile(new File([await legacy.generateAsync({ type: "uint8array" })], "old.zip"))).database, database);
assert.deepEqual((await readWorkspaceArchiveFile(new File([JSON.stringify(database)], "old.json"))).database, database);
const exported = archiveDatabaseSnapshot({ kind: "societyer.workspaceExport", generatedAtISO: database.exportedAtISO, tables: database.tables }); assert.equal(exported.kind, database.kind);
const tampered = await JSZip.loadAsync(await result.blob.arrayBuffer()); tampered.file("workspace.json", JSON.stringify({ ...database, tables: {} }));
await assert.rejects(readWorkspaceArchiveFile(new File([await tampered.generateAsync({ type: "uint8array" })], "damaged.zip")), /checksum/);
const damagedFile = await JSZip.loadAsync(await result.blob.arrayBuffer()); damagedFile.file(result.manifest.files[0].archivePath!, "different bytes");
await assert.rejects(readWorkspaceArchiveFile(new File([await damagedFile.generateAsync({ type: "uint8array" })], "damaged-file.zip")), /checksum/);
const unsafe = new JSZip(); unsafe.file("../escape.json", JSON.stringify(database));
await assert.rejects(readWorkspaceArchiveFile(new File([await unsafe.generateAsync({ type: "uint8array" })], "unsafe.zip")), /invalid file path/);
const wrongAlias = await JSZip.loadAsync(await result.blob.arrayBuffer());
const aliasManifest = JSON.parse(await wrongAlias.file("manifest.json")!.async("string"));
aliasManifest.files[1].archivePath = "files/unchecked-alias";
wrongAlias.file("files/unchecked-alias", "corrupted alias bytes");
wrongAlias.file("manifest.json", JSON.stringify(aliasManifest));
await assert.rejects(readWorkspaceArchiveFile(new File([await wrongAlias.generateAsync({ type: "uint8array" })], "alias.zip")), /inconsistent file aliases/);
// O-1: a restore opens the organization that was active at backup time, else
// the first non-demo organization — never the bundled demo just because its
// row comes first.
const demoFirst = { tables: { societies: [{ _id: "static_society_riverside", name: "Demo" }, { _id: "org_b", name: "Restored" }, { _id: "org_c", name: "Other" }] } };
assert.equal(preferredRestoredSocietyId(demoFirst), "org_b");
assert.equal(preferredRestoredSocietyId({ ...demoFirst, activeSocietyId: "org_c" }), "org_c");
assert.equal(preferredRestoredSocietyId({ ...demoFirst, activeSocietyId: "gone" }), "org_b");
assert.equal(preferredRestoredSocietyId({ tables: { societies: [{ _id: "static_society_riverside", name: "Demo" }] } }), "static_society_riverside");
const orgExport = archiveDatabaseSnapshot({ kind: "societyer.workspaceExport", generatedAtISO: "2026-10-06T12:00:00Z", society: { _id: "org_x", name: "Org" }, tables: { societies: [{ _id: "static_society_riverside", name: "Demo" }, { _id: "org_x", name: "Org" }] } });
assert.equal(preferredRestoredSocietyId(orgExport), "org_x", "an organization export reopens its organization");
await assert.rejects(readWorkspaceArchiveFile(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], "torn.zip")), /"torn\.zip" is not a readable ZIP backup/);
// Old builds read archives with JSZip and the version 1 manifest: a streamed archive stays readable by them.
{
  const old = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const manifest = JSON.parse(await old.file("manifest.json")!.async("string"));
  assert.equal(manifest.version, 1, "a small workspace is written in the format every build restores");
  const records = await old.file("workspace.json")!.async("uint8array");
  assert.equal(records.length, manifest.database.bytes);
  assert.equal(await hashBytes(records), manifest.database.sha256, "the streamed SHA-256 matches WebCrypto");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(records)), database);
  assert.equal(await hashBytes(await old.file(manifest.files[0].archivePath)!.async("uint8array")), await hashBytes(content));
}
// Version 2 (chunked records) round trip, including empty tables, unicode and a forced split into chunks.
{
  const big = { ...database, tables: { ...database.tables, empty: [], notes: Array.from({ length: 2500 }, (_, index) => ({ _id: `n${index}`, text: `Note ${index} µg/m³ ${"x".repeat(4000)}` })) } };
  const v2 = await buildWorkspaceArchive(big, async add => { await add({ fileName: "original.doc", status: "included" }, new Blob([content])); }, undefined, { format: 2 });
  assert.equal(v2.manifest.version, 2);
  assert.ok(v2.manifest.database.chunks!.filter(chunk => chunk.table === "notes").length >= 2, "a large table is split into chunks");
  assert.ok(v2.manifest.database.chunks!.some(chunk => chunk.table === "empty" && chunk.rows === 0), "empty tables survive");
  const back = await readWorkspaceArchiveFile(new File([v2.blob], "v2.zip"));
  assert.deepEqual(back.database, big);
  assert.equal(back.files.size, 1);
  const damagedChunk = await JSZip.loadAsync(await v2.blob.arrayBuffer());
  const firstChunk = v2.manifest.database.chunks![0].path;
  damagedChunk.file(firstChunk, (await damagedChunk.file(firstChunk)!.async("string")).replace("Archive test", "Archive tset"));
  await assert.rejects(readWorkspaceArchiveFile(new File([await damagedChunk.generateAsync({ type: "uint8array" })], "v2-damaged.zip")), /checksum/);
  const future = await JSZip.loadAsync(await v2.blob.arrayBuffer());
  future.file("manifest.json", JSON.stringify({ ...v2.manifest, version: 3 }));
  await assert.rejects(readWorkspaceArchiveFile(new File([await future.generateAsync({ type: "uint8array" })], "v3.zip")), /newer version/);
  // A streamed source (row batches) writes the same archive contents as the database object.
  const streamed = await buildWorkspaceArchive(databaseSource(big), async () => undefined, undefined, { format: 2 });
  assert.deepEqual((await readWorkspaceArchiveFile(new File([streamed.blob], "s.zip"))).database, big);
  const local2 = new LocalDexieRowStore({});
  await local2.importSnapshot(archiveDatabaseSnapshot(back.database));
  const source = await local2.exportSnapshotSource(100);
  const fromStore = await buildWorkspaceArchive(source, async () => undefined);
  const reread = await readWorkspaceArchiveFile(new File([fromStore.blob], "store.zip"));
  assert.ok(reread.manifest!.rowCount >= Object.values(big.tables).reduce((sum, rows) => sum + rows.length, 0));
  assert.deepEqual(reread.database.tables.notes.map((row: any) => row._id), big.tables.notes.map(row => row._id));
}
console.log("ZIP archive checks passed: exact records/files, deduplication, external/missing inventory, legacy JSON/ZIP, preserved journal, corruption/path rejection and invalid-import atomicity; JSZip (older builds) reads streamed version 1 archives; chunked version 2 round trip, chunk checksums, newer-version refusal and store streaming.");
