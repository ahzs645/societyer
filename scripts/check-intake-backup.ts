import assert from "node:assert/strict";
import { buildIntakeBackup } from "./build-intake-backup";
import { StaticConvexClient } from "../src/lib/staticConvex";

const organization = { name: "Intake test society", jurisdictionCode: "CA-BC", entityType: "society" };
const externalId = "gdrive:test-document";
const bundle = {
  metadata: { name: "Drive test batch", createdFrom: "Google Drive" },
  documentMap: [{ title: "Test source", externalId, sourceExternalIds: [externalId], confidence: "Review" }],
  facts: [{ title: "Unverified historical claim", value: "Source statement", sourceExternalIds: [externalId], confidence: "Review" }],
};
const result = await buildIntakeBackup(organization, [bundle]);
assert.equal(result.snapshot.kind, "societyer.localWorkspaceSnapshot");
assert.equal(result.snapshot.workspace.schemaVersion, 3);
assert.equal(result.recordCount, 2);
assert.equal(result.snapshot.tables.societies.length, 1);
assert.equal(result.snapshot.tables.societies[0].name, organization.name);
assert.equal(result.snapshot.tables.societies[0].incorporationNumber, undefined);
assert.equal(result.snapshot.attachments.length, 0);
assert.equal(result.snapshot.tables.organizationHistoryItems?.length ?? 0, 0);

const restored = new StaticConvexClient({ seed: { societies: [{ _id: "replace_me", name: "Old workspace" }] } });
await restored.mutation("seedRecordTableMetadata:ensureForSociety", { societyId: "replace_me" });
await restored.importLocalWorkspaceSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
assert.equal((await restored.query("society:list", {})).some((society: { _id: string }) => society._id === "replace_me"), false);
const session = await restored.query("importSessions:get", { sessionId: result.sessionIds[0] });
assert.equal(session.records.length, 2);
for (const record of session.records) {
  assert.equal(record.status, "Pending");
  assert.deepEqual(record.importedTargets, {});
  assert.ok(record.sourceExternalIds.includes(externalId));
}
await assert.rejects(buildIntakeBackup({ name: "No jurisdiction" }, [bundle]), /jurisdictionCode/);
await assert.rejects(buildIntakeBackup(organization, []), /At least one/);
await assert.rejects(buildIntakeBackup(organization, [{ inventedRecords: [{ title: "Lost record" }] }]));
console.log("Intake backup: pending records, provenance, replacement semantics, invalid input, and JSON roundtrip passed.");
