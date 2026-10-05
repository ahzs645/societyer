import assert from "node:assert/strict";
import { summarizeRecords } from "../shared/functions/importSessionHelpers/importSessionMetadata";
import { approvedImportRecordNeedsApply, isActiveImportSession } from "../shared/importSessionState";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { createFromBundlePortable, bulkSetStatusPortable, applyApprovedDocumentsPortable, applyApprovedSectionRecordsPortable, listPortable } from "../shared/functions/importSessions";

const approved = (recordKind: string, importedTargets: any = {}) => ({ recordKind, importedTargets, status: "Approved" });
const mixed = [approved("documentCandidate", { documents: "doc" }), approved("insurancePolicy"), approved("financialStatement")];
assert.equal(summarizeRecords(mixed).approvedUnapplied, 2);
assert.ok(isActiveImportSession({ summary: summarizeRecords(mixed) }), "A partially applied mixed-module batch must stay active");
assert.ok(approvedImportRecordNeedsApply(approved("insurancePolicy", { documents: "wrong-target" })), "A document link does not complete an insurance promotion");
assert.equal(approvedImportRecordNeedsApply(approved("motion", { meetings: "meeting" })), false);
assert.equal(approvedImportRecordNeedsApply(approved("motion", { orgHistory: "history" })), false);
assert.ok(isActiveImportSession({ summary: { byStatus: { Approved: 3 }, documentsApplied: 1, meetingsApplied: 2 } }), "Legacy aggregate counts cannot prove per-record completion");
assert.equal(isActiveImportSession({ summary: summarizeRecords([approved("documentCandidate", { documents: "doc" }), approved("insurancePolicy", { sections: "policy" })]) }), false);
assert.equal(isActiveImportSession({ summary: summarizeRecords([{ recordKind: "source", status: "Rejected" }]) }), false);

const db = new MemoryDb({ seed: { societies: [{ _id: "society", name: "Mixed fixture" }], users: [{ _id: "owner", societyId: "society", role: "Owner", status: "Active" }] } });
const ctx = {
  db, capabilities: makeCapabilities({}),
  principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "completion-test", societyId: "society", actorUserId: "owner", scopes: ["settings:write", "settings:read", "documents:write", "documents:read", "financials:write"] },
  runQuery: async () => { throw new Error("Unexpected nested query"); },
  runMutation: async () => { throw new Error("Unexpected nested mutation"); },
};
const sessionId = await createFromBundlePortable(ctx, { societyId: "society", bundle: {
  documentMap: [{ title: "Original policy", externalSystem: "google-drive", externalId: "google-drive:test", category: "Policy", sections: ["insurance"] }],
  insurancePolicies: [{ title: "Synthetic policy", policyNumber: "TEST", coverageSummary: "Synthetic reviewed coverage", effectiveDate: "2025-01-01", expiryDate: "2026-01-01", sourceExternalIds: [], confidence: "High", importReadiness: "ready" }],
} });
await bulkSetStatusPortable(ctx, { sessionId, status: "Approved" });
assert.deepEqual(await applyApprovedDocumentsPortable(ctx, { sessionId }), { documents: 1 });
const partial = (await listPortable(ctx, { societyId: "society" }))[0];
assert.equal(partial.summary.approvedUnapplied, 1);
assert.ok(isActiveImportSession(partial), "Create docs must leave the insurance candidate visible");
const promotion = await applyApprovedSectionRecordsPortable(ctx, { sessionId });
assert.equal(promotion.total, 1);
const complete = (await listPortable(ctx, { societyId: "society" }))[0];
assert.equal(complete.summary.approvedUnapplied, 0);
assert.equal(isActiveImportSession(complete), false, "Batch completes only after the remaining insurance candidate is applied");

// Existing stored summaries are recomputed at query time without mutating data.
const stored = await db.get(sessionId);
const payload = JSON.parse(stored!.content);
delete payload.summary.approvedUnapplied;
await db.patch(sessionId, { content: JSON.stringify(payload) });
const before = db.dump("documents");
const legacy = (await listPortable(ctx, { societyId: "society" }))[0];
assert.equal(legacy.summary.approvedUnapplied, 0);
assert.equal(isActiveImportSession(legacy), false);
assert.deepEqual(db.dump("documents"), before, "Legacy summary repair is read-only");
console.log("Import completion passed: mixed docs/insurance stay active through partial promotion, kind-specific targets, legacy summaries, and final completion.");
