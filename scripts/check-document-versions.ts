/**
 * Gate: document duplicates and version groups (finding D-14, schema A8), the
 * import contract for version fields, and the cross-session import review
 * queue (findings D-06 to D-10). Synthetic fixtures only.
 */
import assert from "node:assert/strict";
import {
  buildDocumentGroups,
  detectSourceVersionStatus,
  EMPTY_SHA256,
  normalizeSourceVersionStatus,
  versionNameKey,
} from "../shared/documentVersioning";
import { deriveReviewRisk, legalWeightFor, missingFactsFor } from "../shared/importReviewRisk";
import { distinguishSessionNames } from "../shared/importSessionLabels";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";

/* ------------------------------ status words ------------------------------ */

assert.equal(detectSourceVersionStatus("2021_11_03_Operations_APPROVED Minutes.pdf"), "approved");
assert.equal(detectSourceVersionStatus("Minutes-DRAFT-28-Feb-2012.docx"), "draft");
assert.equal(detectSourceVersionStatus("Balance Sheet Dec 31, 2024 (Revised).xls"), "revised");
assert.equal(detectSourceVersionStatus("Service Agreement_SIGNED.pdf"), "signed");
assert.equal(detectSourceVersionStatus("Final draft budget.xlsx"), "draft", "a final draft is a draft");
assert.equal(detectSourceVersionStatus("Annual report FINAL.pdf"), "final");
assert.equal(detectSourceVersionStatus("Unsigned consent form.pdf"), undefined);
assert.equal(detectSourceVersionStatus("Newsletter spring"), undefined);
assert.equal(normalizeSourceVersionStatus("Executed"), "signed");
assert.equal(normalizeSourceVersionStatus("adopted"), "approved");
assert.equal(normalizeSourceVersionStatus("whatever"), undefined);

/* ------------------------------ name grouping ----------------------------- */

assert.equal(versionNameKey("Minutes-DRAFT-28-Feb-2012.docx"), versionNameKey("Minutes 28 Feb 2012 APPROVED.pdf"));
assert.notEqual(versionNameKey("Minutes 28 Feb 2012.pdf"), versionNameKey("Minutes 27 Mar 2012.pdf"), "dates keep different meetings apart");
assert.equal(versionNameKey("Balance Sheet Dec 31, 2024.xls"), versionNameKey("Balance Sheet Dec 31, 2024 (Revised).xls"));
assert.equal(versionNameKey("Budget v2.xlsx"), versionNameKey("Budget v3 FINAL.xlsx"));
assert.equal(versionNameKey("Report (1).pdf"), versionNameKey("Report.pdf") ?? undefined);
assert.equal(versionNameKey("#23834.pdf"), undefined, "invoice numbers are too generic to group");
assert.equal(versionNameKey("Minutes.pdf"), undefined, "one generic word never groups");
assert.notEqual(versionNameKey("Minutes v2 2021 05 18.pdf"), versionNameKey("Minutes v2 2021 06 15.pdf"), "a version marker never eats the date");

/* ------------------------------ group builder ----------------------------- */

const sha = (c: string) => c.repeat(64);
const groups = buildDocumentGroups([
  { _id: "a1", title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", sha256: sha("a"), createdAtISO: "2026-01-01" },
  { _id: "a2", title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", sha256: sha("a"), createdAtISO: "2026-01-02" },
  { _id: "a3", title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", externalIds: ["google-drive:ABC123"], createdAtISO: "2026-01-03" },
  { _id: "a4", title: "Consent agenda package.pdf", externalIds: ["GOOGLE-DRIVE:abc123"], sha256: sha("a"), createdAtISO: "2026-01-04" },
  { _id: "m1", fileName: "Board minutes 2012-02-28 DRAFT.docx", createdAtISO: "2026-01-01" },
  { _id: "m2", fileName: "Board minutes 2012-02-28 APPROVED.pdf", createdAtISO: "2026-01-01" },
  { _id: "m3", fileName: "Board minutes 2012-03-27.pdf", createdAtISO: "2026-01-01" },
  { _id: "e1", fileName: "Failed download one.pdf", sha256: EMPTY_SHA256 },
  { _id: "e2", fileName: "Failed download two.pdf", sha256: EMPTY_SHA256 },
  { _id: "x1", fileName: "Board minutes 2012-02-28 copy.pdf", versionGroupKey: "separate", createdAtISO: "2026-01-01" },
  { _id: "k1", fileName: "Scan 001.pdf", duplicateOfDocumentId: "k2" },
  { _id: "k2", fileName: "Signed bylaws 2016.pdf" },
]);
assert.equal(groups.get("a1")?.duplicateCount, 4, "same bytes and same Drive id (any case) form one duplicate set");
assert.equal(groups.get("a1")?.isDuplicate, false, "the oldest copy is canonical");
assert.equal(groups.get("a2")?.isDuplicate, true);
assert.equal(groups.get("a2")?.canonicalId, "a1");
assert.equal(groups.get("a2")?.duplicateReason, "sha256");
assert.equal(groups.get("a3")?.duplicateReason, "source");
assert.equal(groups.get("a1")?.versionCount, 1, "a duplicate set counts as one version");
assert.equal(groups.get("m1")?.versionCount, 2, "draft and approved minutes of one meeting are versions");
assert.equal(groups.get("m1")?.versionKey, groups.get("m2")?.versionKey);
assert.equal(groups.get("m1")?.sourceVersionStatus, "draft");
assert.equal(groups.get("m2")?.sourceVersionStatus, "approved");
assert.equal(groups.get("m2")?.sourceVersionStatusDetected, true);
assert.equal(groups.get("m3")?.versionKey, undefined, "a different meeting date is not a version");
assert.equal(groups.get("e1")?.duplicateCount, 1, "empty-file hashes never make duplicates");
assert.equal(groups.get("x1")?.versionKey, "explicit:separate", "an explicit key overrides name matching");
assert.equal(groups.get("k1")?.isDuplicate, true, "a person's duplicate mark groups the copies");
assert.equal(groups.get("k1")?.canonicalId, "k2");
assert.equal(groups.get("k1")?.duplicateReason, "marked");

/* ------------------------------- review risk ------------------------------ */

assert.equal(legalWeightFor("meetingMinutes"), "high");
assert.equal(legalWeightFor("source", "Org history sources"), "low");
assert.equal(legalWeightFor("documentCandidate", "meetings"), "medium");
assert.deepEqual(missingFactsFor("motion", { motionText: "That the budget be approved" }), ["meeting date", "outcome"]);
const boilerplate = "Needs review: machine extraction does not establish source accuracy, approval, ownership, or financial posting eligibility.";
const plain = deriveReviewRisk({ recordKind: "source", targetModule: "Org history sources", title: "Newsletter 2015-04.pdf", payload: { notes: boilerplate, sourceDate: "2015-04-01", extractedText: "x".repeat(400) }, riskFlags: ["needs review", "restricted"] });
assert.equal(plain.level, "low", "uniform keyword flags no longer make every candidate risky");
assert.equal(plain.restricted, undefined);
const minutes = deriveReviewRisk({ recordKind: "meetingMinutes", targetModule: "meetings", title: "Board minutes", payload: {}, riskFlags: ["needs review"] });
assert.equal(minutes.level, "high");
assert.ok(minutes.reasons.includes("missing meeting date"));
const payroll = deriveReviewRisk({ recordKind: "source", targetModule: "Org history sources", title: "Payroll 2019.xlsx", payload: { sourceDate: "2019", extractedText: "x".repeat(400) } });
assert.match(payroll.restricted ?? "", /payroll/);

/* ------------------------------ session labels ---------------------------- */

const labels = distinguishSessionNames([
  "Drive source review Example mentioned 73",
  "Drive source review Example mentioned 74",
  "Ownership review 1",
  "Insurance",
]);
assert.equal(labels[0].primary, "…Example mentioned 73");
assert.equal(labels[1].primary, "…Example mentioned 74");
assert.notEqual(labels[0].primary, labels[1].primary, "sibling batches never share a label");
assert.equal(labels[2].primary, "Ownership review 1");
assert.equal(labels[3].primary, "Insurance");
assert.equal(labels[0].full, "Drive source review Example mentioned 73");

/* ---------------------- portable handlers (synthetic) ---------------------- */

const now = "2026-01-01T00:00:00.000Z";
const doc = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, societyId: "soc", title: id, category: "Minutes", createdAtISO: now, flaggedForDeletion: false, tags: [], ...extra });
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Society" }],
    users: [{ _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner Person" }],
    meetings: [{ _id: "mt1", societyId: "soc", type: "Board", title: "Board", scheduledAt: "2012-02-28T19:00:00Z", status: "Held", electronic: false, attendeeIds: [] }],
    documents: [
      doc("p1", { title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", content: JSON.stringify({ sha256: sha("d"), externalId: "google-drive:PKG1" }) }),
      doc("p2", { title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", content: JSON.stringify({ sha256: sha("d") }), tags: ["meeting-pack"] }),
      doc("p3", { title: "Consent agenda package.pdf", fileName: "Consent agenda package.pdf", tags: ["google-drive:pkg1"] }),
      doc("v1", { title: "Board minutes 2012-02-28 DRAFT.docx", fileName: "Board minutes 2012-02-28 DRAFT.docx" }),
      doc("v2", { title: "Board minutes 2012-02-28 APPROVED.pdf", fileName: "Board minutes 2012-02-28 APPROVED.pdf" }),
    ],
    meetingMaterials: [{ _id: "mm1", societyId: "soc", meetingId: "mt1", documentId: "p2", order: 1, requiredForMeeting: false, accessLevel: "board", createdAtISO: now }],
    sourceEvidence: [{ _id: "se1", societyId: "soc", sourceDocumentId: "p3", externalSystem: "google-drive", sourceTitle: "pkg", evidenceKind: "provenance", targetTable: "meetings", targetId: "mt1", sensitivity: "standard", accessLevel: "internal", summary: "s", status: "NeedsReview", createdAtISO: now }],
  },
});
const principal = () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner", userId: "owner", societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal }).registerAll(PORTABLE_FUNCTIONS);

const browse: any = await owner.runQuery("documents:browse", { societyId: "soc" });
const row = (id: string) => browse.rows.find((item: any) => item._id === id);
assert.equal(row("p1").duplicateCount, 3);
assert.equal(row("p2").isDuplicate, true);
assert.equal(row("p3").linkedRecordCount, 1, "evidence links are counted once for the whole list");
assert.equal(row("v1").versionCount, 2);
assert.equal(row("v2").sourceVersionStatus, "approved");
assert.equal(browse.summary.duplicateSets, 1);
assert.equal(browse.summary.versionGroups, 1);

const panel: any = await owner.runQuery("documents:versionsFor", { id: "v1" });
assert.deepEqual(panel.versions.map((item: any) => item._id), ["v1", "v2"], "draft before approved");
const dupPanel: any = await owner.runQuery("documents:versionsFor", { id: "p2" });
assert.deepEqual(dupPanel.duplicates.map((item: any) => item._id), ["p1", "p2", "p3"]);

await owner.runMutation("documents:markDuplicate", { id: "v1", duplicateOfDocumentId: "v2" });
await assert.rejects(() => owner.runMutation("documents:markDuplicate", { id: "v2", duplicateOfDocumentId: "v1" }), /already marked as a copy/);
await assert.rejects(() => owner.runMutation("documents:markDuplicate", { id: "v2", duplicateOfDocumentId: "v2" }), /different document/);
await owner.runMutation("documents:clearDuplicate", { id: "v1" });
assert.equal((await db.get("v1"))?.duplicateOfDocumentId, undefined);
await assert.rejects(() => owner.runMutation("documents:setVersionInfo", { id: "v1", sourceVersionStatus: "maybe" }), /draft, final, approved, signed or revised/);
await owner.runMutation("documents:setVersionInfo", { id: "v1", sourceVersionStatus: "Draft", supersedesDocumentId: null, versionGroupKey: "Board minutes 2012-02-28" });
assert.equal((await db.get("v1"))?.sourceVersionStatus, "draft");
await owner.runMutation("documents:setVersionInfo", { id: "v2", supersedesDocumentId: "v1", versionGroupKey: "Board minutes 2012-02-28" });
const explicitPanel: any = await owner.runQuery("documents:versionsFor", { id: "v2" });
assert.deepEqual(explicitPanel.versions.map((item: any) => item._id), ["v1", "v2"]);
assert.equal(explicitPanel.versions[0].supersededById, "v2");

const merged: any = await owner.runMutation("documents:mergeDuplicates", { keepId: "p1", duplicateIds: ["p2", "p3"] });
assert.deepEqual(merged, { merged: 2, repointed: 2 });
assert.equal((await db.get("mm1"))?.documentId, "p1", "meeting materials follow the kept copy");
assert.equal((await db.get("se1"))?.sourceDocumentId, "p1", "source evidence follows the kept copy");
assert.equal((await db.get("p2"))?.duplicateOfDocumentId, "p1");
assert.ok((await db.get("p2"))?.archivedAtISO, "copies are archived, not deleted");
assert.ok(((await db.get("p1"))?.tags as string[]).includes("meeting-pack"), "tags are combined");

/* --------------------- import contract: version fields --------------------- */

const bundle = {
  documentMap: [
    { title: "Statement of operations 2024.xls", fileName: "Statement of operations 2024.xls", externalId: "google-drive:STMT1", sourceExternalIds: ["google-drive:STMT1"], category: "financial-statement", sections: ["financials"], sha256: sha("e"), extractedText: "Revenue 100" },
    { title: "Statement of operations 2024 (Revised).xls", fileName: "Statement of operations 2024 (Revised).xls", externalId: "google-drive:STMT2", sourceExternalIds: ["google-drive:STMT2"], category: "Financial Statement", sections: ["financials"], supersedesExternalId: "google-drive:STMT1", versionGroupKey: "Statement of operations 2024" },
  ],
};
const sessionA = await owner.runMutation("importSessions:createFromBundle", { societyId: "soc", name: "Drive source review Example mentioned 1", bundle: { documentMap: [bundle.documentMap[0]] } });
const sessionB = await owner.runMutation("importSessions:createFromBundle", {
  societyId: "soc",
  name: "Drive source review Example mentioned 2",
  bundle: {
    documentMap: [bundle.documentMap[1]],
    meetingMinutes: [{ title: "Board minutes (no date)", meetingTitle: "Board" }],
    sources: [{ title: "Newsletter 2015-04.pdf", externalId: "google-drive:NEWS", sourceDate: "2015-04-01", extractedText: "x".repeat(300), notes: "machine extraction does not establish financial posting eligibility" }],
  },
});

const queue: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc" });
assert.equal(queue.progress.total, 4);
assert.equal(queue.progress.pending, 4);
assert.equal(queue.total, 4, "one queue across both sessions");
assert.equal(queue.items[0].recordKind, "meetingMinutes", "legal records missing facts come first");
assert.equal(queue.items[0].risk.level, "high");
assert.equal(queue.items.at(-1).recordKind, "source");
assert.equal(queue.items.at(-1).risk.level, "low");
assert.deepEqual(queue.facets.sessions.map((facet: any) => facet.count).sort(), [1, 3]);
assert.ok(queue.items.every((item: any) => typeof item.sessionName === "string"));
const onlyA: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc", sessionId: sessionA });
assert.equal(onlyA.total, 1);
assert.equal(onlyA.facets.sessions.length, 2, "the session facet still counts the other session");
const docsOnly: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc", recordKind: "documentCandidate" });
assert.equal(docsOnly.total, 2);
const searchHit: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc", search: "revised" });
assert.equal(searchHit.total, 1);
const firstDoc = docsOnly.items.find((item: any) => item.sessionId === sessionA);
assert.equal(firstDoc.sha256, sha("e"));
assert.equal(firstDoc.excerpt, "Revenue 100");
const full: any = await owner.runQuery("importSessions:getRecord", { recordId: firstDoc._id });
assert.equal(full.payload.extractedText, "Revenue 100");

// Approve both document candidates through the existing per-session mutations.
for (const item of docsOnly.items) await owner.runMutation("importSessions:updateRecord", { recordId: item._id, status: "Approved" });
const afterApprove: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc" });
assert.equal(afterApprove.progress.reviewed, 2, "progress counts decisions across sessions");
assert.equal(afterApprove.total, 2);
await owner.runMutation("importSessions:applyApprovedDocuments", { sessionId: sessionA });
await owner.runMutation("importSessions:applyApprovedDocuments", { sessionId: sessionB });
const all = (await db.query("documents").collect()).filter((d: any) => d.category !== "Import Candidate" && d.category !== "Import Session");
const original = all.find((d: any) => d.title === "Statement of operations 2024.xls") as any;
const revised = all.find((d: any) => d.title === "Statement of operations 2024 (Revised).xls") as any;
assert.equal(original.category, "FinancialStatement", "imported categories are normalized");
assert.equal(revised.category, "FinancialStatement");
assert.equal(revised.sourceVersionStatus, "revised", "the source's own version word is kept");
assert.equal(revised.supersedesDocumentId, original._id, "supersedes resolves the source id to the document");
assert.equal(revised.versionGroupKey, "Statement of operations 2024");

const pending: any = await owner.runQuery("importSessions:pendingByTarget", { societyId: "soc" });
assert.equal(pending.pending, 2);

/* -------------------------- delete-session impact -------------------------- */

const impact: any = await owner.runQuery("importSessions:removalImpact", { sessionId: sessionA });
assert.equal(impact.records, 1);
assert.equal(impact.approved, 1);
assert.equal(impact.applied, 1);
assert.equal(impact.linkedDocuments, 1, "documents created from the session are counted");
await owner.runMutation("importSessions:removeSession", { sessionId: sessionA });
const afterDelete = await db.get(original._id) as any;
assert.ok(afterDelete.tags.includes("import-session-removed"), "created documents are flagged, not left dangling");
assert.ok(!afterDelete.content.includes(`"importSessionId":"${sessionA}"`));
assert.match(afterDelete.content, /importSessionRemoved/);
const afterQueue: any = await owner.runQuery("importSessions:reviewQueue", { societyId: "soc", status: "all" });
assert.equal(afterQueue.progress.total, 3);

console.log("Document version, duplicate, import version-field and review-queue checks passed.");
