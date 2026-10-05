import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableMutationCtx } from "../convex/lib/portable";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import { createFromBundlePortable, bulkSetStatusPortable, getPortable, applyApprovedDocumentsPortable } from "../shared/functions/importSessions";
import { ensureImportSourceDocuments, insertSourceEvidenceForAppliedRecord } from "../shared/functions/importSessionHelpers/importSessionMergeAndApply";
import { sourceCatalogForRecords } from "../shared/functions/importSessionHelpers/importSessionMetadata";
import { normalizeSourcePayload } from "../shared/functions/importSessionHelpers/importSessionNormalize";

// Synthetic content: no live source, tenant, storage provider or authentication service is required.
const source = {
  externalId: "drive:synthetic-source",
  externalSystem: "google-drive",
  title: "Board minutes original",
  fileName: "minutes.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  fileSizeBytes: 4096,
  url: "https://drive.google.com/file/d/synthetic-source/view",
  sha256: "b".repeat(64),
  extractedText: "Board meeting\nQuorum not reached.\nApproval deferred to next meeting.",
  extractionMethod: "docx-xml",
  category: "Minutes",
  confidence: "Review",
};
assert.equal(normalizeSourcePayload(source).url, source.url);
assert.equal(normalizeSourcePayload(source).extractedText, source.extractedText);
assert.equal(normalizeSourcePayload(source).extractionMethod, source.extractionMethod);

const bundle = {
  metadata: { organizationName: "Provenance fixture", createdFrom: "Google Drive" },
  sources: [source],
  documentMap: [{ ...source, sections: ["meetings"], sourceExternalIds: [source.externalId] }],
};
function assertProvenance(document: any) {
  assert.equal(document.url, source.url, "Original Drive URL must remain attached after promotion");
  assert.equal(document.category, source.category, "Canonical document category must take precedence over lowercase target module labels");
  assert.equal(document.fileName, source.fileName);
  assert.equal(document.mimeType, source.mimeType);
  assert.equal(document.fileSizeBytes, source.fileSizeBytes);
  const content = JSON.parse(document.content);
  assert.equal(content.extractedText, source.extractedText, "Full extracted body must survive, including internal line breaks");
  assert.equal(content.extractionMethod, source.extractionMethod, "Reviewers need the actual extraction method");
  assert.equal(content.sha256, source.sha256);
  assert.equal(content.externalSystem, source.externalSystem);
  assert.equal(content.externalId, source.externalId);
  assert.equal(document.reviewStatus, "in_review", "Promotion must retain source review status");
}
async function exercise(ctx: any, societyId: string) {
  await requireFunctionAction(ctx, "importSessions:createFromBundle", "mutation", { societyId });
  const sessionId = await createFromBundlePortable(ctx, { societyId, bundle });
  const detail = await getPortable(ctx, { sessionId });
  const sourceRecord = detail.records.find((row: any) => row.recordKind === "source");
  const candidate = detail.records.find((row: any) => row.recordKind === "documentCandidate");
  assert.equal(sourceRecord.payload.extractedText, source.extractedText, "Session normalization must preserve source text");
  assert.equal(sourceRecord.payload.extractionMethod, source.extractionMethod);

  assert.deepEqual(await applyApprovedDocumentsPortable(ctx, { sessionId }), { documents: 0 }, "Pending candidates cannot be promoted");
  await bulkSetStatusPortable(ctx, { sessionId, status: "Approved", recordIds: [candidate._id] });
  await requireFunctionAction(ctx, "importSessions:applyApprovedDocuments", "mutation", { sessionId });
  assert.deepEqual(await applyApprovedDocumentsPortable(ctx, { sessionId }), { documents: 1 });
  const applied = await getPortable(ctx, { sessionId });
  const promoted = applied.records.find((row: any) => row.recordKind === "documentCandidate");
  const document = await ctx.db.get(promoted.importedTargets.documents);
  assertProvenance(document);
  assert.deepEqual(JSON.parse(document.content).sourceExternalIds, [source.externalId]);
  assert.deepEqual(await applyApprovedDocumentsPortable(ctx, { sessionId }), { documents: 0 }, "Repeated candidate promotion is idempotent");

  // Exercise source placeholders used by minutes/section imports independently of documentCandidate promotion.
  const catalog = sourceCatalogForRecords([sourceRecord]);
  const ids = await ensureImportSourceDocuments(ctx, societyId, [source.externalId], "Minutes", "Source review required", catalog);
  assert.equal(ids.length, 1);
  assertProvenance(await ctx.db.get(ids[0]));
  await ctx.db.insert("sourceEvidence", {
    societyId, externalSystem: source.externalSystem, externalId: source.externalId,
    sourceDocumentId: ids[0], evidenceKind: "provenance", sourceTitle: source.title, sensitivity: "standard", accessLevel: "internal", summary: "Synthetic source provenance", status: "NeedsReview",
    createdAtISO: new Date().toISOString(),
  });
  assert.deepEqual(await ensureImportSourceDocuments(ctx, societyId, [source.externalId], "Minutes", "Reuse source", catalog), ids, "An existing source evidence link reuses the original document");
  await insertSourceEvidenceForAppliedRecord(ctx, societyId, {
    recordKind: "financialStatement", title: "Statement evidence", sourceExternalIds: [source.externalId],
    riskFlags: [], payload: { title: "Statement evidence", sourceExternalIds: [source.externalId] },
  }, "synthetic-financial-target", ids);
  const linkedEvidence = await ctx.db.query("sourceEvidence").withIndex("by_target", (q: any) => q.eq("targetTable", "financials").eq("targetId", "synthetic-financial-target")).first();
  assert.equal(linkedEvidence.externalSystem, "google-drive", "Section evidence must infer Google Drive from the source ID even without explicit system metadata");
  assert.equal(linkedEvidence.sourceDocumentId, ids[0]);
  return sessionId;
}

const db = new MemoryDb({ seed: { societies: [{ _id: "fixture", name: "Provenance fixture" }], users: [{ _id: "owner", societyId: "fixture", role: "Owner", status: "Active" }] } });
const memory = {
  db, capabilities: makeCapabilities({}),
  principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "source-provenance-test", societyId: "fixture", actorUserId: "owner", scopes: ["settings:write", "settings:read", "documents:write", "documents:read"] },
  runQuery: async () => { throw new Error("Unexpected nested query"); },
  runMutation: async () => { throw new Error("Unexpected nested mutation"); },
};
const memorySession = await exercise(memory, "fixture");
const before = db.dump("documents");
await assert.rejects(() => requireFunctionAction({ ...memory, principal: { ...memory.principal, scopes: ["settings:read", "documents:read"] } }, "importSessions:applyApprovedDocuments", "mutation", { sessionId: memorySession }), /settings:write/);
assert.deepEqual(db.dump("documents"), before, "Read-only action denial must perform no writes");

const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./importSessions.js": () => import("../convex/importSessions"),
});
const issuer = betterAuthIssuer();
const fixture = await native.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Provenance fixture", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ["Owner", "Director"]) await ctx.db.insert("users", { societyId, role, status: "Active", email: `${role}@fixture.invalid`, displayName: role, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  const owner = await ctx.db.query("users").filter(q => q.eq(q.field("role"), "Owner")).first();
  const portable = await toPortableMutationCtx(ctx);
  const service = { ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "source-provenance-test", societyId: String(societyId), actorUserId: String(owner!._id), scopes: ["settings:write", "settings:read", "documents:write", "documents:read"] } };
  const sessionId = await exercise(service, String(societyId));
  return { societyId, sessionId };
});
const nativeBefore = await native.run(ctx => ctx.db.query("documents").collect());
await assert.rejects(() => native.withIdentity({ issuer, subject: "Director" }).mutation(api.importSessions.applyApprovedDocuments, { sessionId: fixture.sessionId as any }), /settings:write/);
assert.deepEqual(await native.run(ctx => ctx.db.query("documents").collect()), nativeBefore, "Public native read-only denial must preserve all source records");
console.log("Source provenance passed on MemoryDb and native schema: source normalization, candidate promotion, source placeholders, evidence reuse/platform/link preservation, idempotence, pending review, and read-only denial.");
