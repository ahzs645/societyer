/**
 * Gate: open document category model and review-status vocabulary
 * (findings D-04, D-12, D-16). Synthetic fixtures only.
 *
 * - every non-internal document is listed whatever its category, and known
 *   categories match in any spelling ("financial-statement" = FinancialStatement);
 * - the category facet is built from the data, not an allow-list;
 * - `documents:browse` returns a light projection without content blobs;
 * - "NeedsReview" and friends normalize to one review vocabulary;
 * - the local row clone keeps exact JSON semantics.
 */
import assert from "node:assert/strict";
import {
  categoryMatchKey,
  documentCategoryFacets,
  documentCategoryGroupKey,
  documentCategoryLabel,
  documentCategoryOptions,
  governanceSlotForCategory,
  isInternalDocumentRecord,
  normalizeDocumentCategory,
} from "../shared/documentCategories";
import {
  documentReviewStatusLabel,
  documentNeedsAttention,
  reviewStatusAfterTransposition,
  normalizeDocumentReviewStatus,
  normalizeEvidenceReviewStatus,
  storedDocumentReviewStatus,
} from "../shared/documentReviewStatus";
import { documentProvenance, readableFields } from "../shared/documentProvenance";
import { jsonClone } from "../shared/portable/localRowStore";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { actionPermission } from "../shared/functions/actionPolicy";
import { governingDocumentSlots } from "../shared/governingDocuments";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

/* ------------------------------ normalization ----------------------------- */

assert.equal(categoryMatchKey("Financial-Statement"), "financialstatement");
for (const spelling of ["FinancialStatement", "financial-statement", "Financial Statement", "financial statements", " FINANCIAL_STATEMENT "]) {
  assert.equal(normalizeDocumentCategory(spelling), "FinancialStatement", spelling);
}
assert.equal(normalizeDocumentCategory("policies"), "Policy");
assert.equal(normalizeDocumentCategory("by-laws"), "Bylaws");
assert.equal(normalizeDocumentCategory("governance"), "governance", "catalog drafts keep their lowercase key");
assert.equal(normalizeDocumentCategory("Recovered  source review"), "Recovered source review");
assert.equal(normalizeDocumentCategory("Board Packages"), "Board Packages", "unknown categories keep their label");
assert.equal(normalizeDocumentCategory(""), "Other");
assert.equal(documentCategoryGroupKey("board packages"), documentCategoryGroupKey("Board Packages"), "unknown categories fold by case");
assert.equal(documentCategoryLabel("FinancialStatement"), "Financial statement");
assert.equal(documentCategoryLabel("MeetingPackage"), "Meeting Package");
assert.equal(documentCategoryLabel("meeting-package"), "Meeting package");
assert.equal(isInternalDocumentRecord({ category: "Import Candidate", tags: [] }), true);
assert.equal(isInternalDocumentRecord({ category: "import candidate", tags: [] }), true);
assert.equal(isInternalDocumentRecord({ category: "Other", tags: ["import-session"] }), true);
assert.equal(isInternalDocumentRecord({ category: "Recovered source review", tags: ["source-review"] }), false);

const facets = documentCategoryFacets([
  { category: "FinancialStatement" }, { category: "financial-statement" }, { category: "Other" },
  { category: "Recovered source review" }, { category: "Recovered source review" }, { category: "Recovered source review" },
]);
assert.deepEqual(facets.map((facet) => [facet.label, facet.count]), [
  ["Recovered source review", 3],
  ["Financial statement", 2],
  ["Other", 1],
], "facets merge spellings, sort by use, Other last");
const options = documentCategoryOptions(["Audit", "Recovered source review", "Import Candidate", "Board Packages"]);
assert.ok(options.some((option) => option.value === "Board Packages"), "categories in use are offered");
assert.ok(!options.some((option) => option.value === "Import Candidate"), "internal categories are never offered");
assert.equal(options.filter((option) => option.value === "Audit").length, 1, "no duplicate options");

/* -------------------------- governing documents by entity ------------------ */

const labels = (audience: Parameters<typeof documentCategoryOptions>[1]) => documentCategoryOptions([], audience).map((option) => option.label);
assert.ok(labels({ corporation: false }).includes("Constitution") && labels({ corporation: false }).includes("Bylaws"), "a society keeps its constitution and bylaws");
assert.ok(!labels({ corporation: false }).includes("Articles of incorporation"), "a society is not offered articles of incorporation");
assert.ok(labels({ corporation: true }).includes("Articles of incorporation") && labels({ corporation: true }).includes("Certificate of incorporation"), "a corporation files articles and a certificate");
assert.ok(labels({ corporation: true }).includes("By-laws") && !labels({ corporation: true }).includes("Constitution"), "a corporation has by-laws, not a constitution");
assert.ok(labels({ corporation: true, bcCompany: true }).includes("Articles") && !labels({ corporation: true, bcCompany: true }).some((label) => /by-?laws/i.test(label)), "a BC company has articles only");
assert.ok(documentCategoryOptions(["Constitution"], { corporation: true }).some((option) => option.value === "Constitution"), "a category in use is never hidden");
assert.equal(normalizeDocumentCategory("Articles of Incorporation"), "ArticlesOfIncorporation");
assert.equal(governanceSlotForCategory("ArticlesOfIncorporation", { corporation: true }), "constitutionDocId");
assert.equal(governanceSlotForCategory("CertificateOfIncorporation", { corporation: true }), "constitutionDocId");
assert.equal(governanceSlotForCategory("Bylaws", { corporation: true, bcCompany: true }), undefined);
assert.equal(governanceSlotForCategory("Constitution", { corporation: false }), "constitutionDocId");
assert.equal(governanceSlotForCategory("CertificateOfIncorporation", { corporation: false }), undefined);
assert.equal(governanceSlotForCategory("Minutes", { corporation: true }), undefined);

/* ------------------------------ review status ----------------------------- */

assert.equal(normalizeDocumentReviewStatus("NeedsReview"), "needs_review");
assert.equal(normalizeDocumentReviewStatus("needs review"), "needs_review");
assert.equal(normalizeDocumentReviewStatus("in_review"), "in_review");
assert.equal(normalizeDocumentReviewStatus("InReview"), "in_review");
assert.equal(normalizeDocumentReviewStatus(undefined), "none");
assert.equal(normalizeDocumentReviewStatus("Verified"), "approved");
assert.equal(normalizeDocumentReviewStatus("something odd"), "needs_review", "unknown statuses ask for review");
assert.equal(documentReviewStatusLabel("NeedsReview"), "Needs review");
assert.equal(normalizeDocumentReviewStatus("transposed"), "transposed");
assert.equal(documentReviewStatusLabel("transposed"), "Transposed");
assert.equal(documentNeedsAttention("transposed"), false, "transposed documents are not in the review backlog");
assert.equal(reviewStatusAfterTransposition("in_review"), "transposed");
assert.equal(reviewStatusAfterTransposition("NeedsReview"), "transposed");
assert.equal(reviewStatusAfterTransposition("needs_signature"), undefined, "a deliberate status is kept");
assert.equal(reviewStatusAfterTransposition("approved"), undefined);
assert.equal(storedDocumentReviewStatus("none"), undefined);
assert.equal(normalizeEvidenceReviewStatus("needs_review"), "NeedsReview");
assert.equal(normalizeEvidenceReviewStatus("linked"), "Linked");

/* -------------------------------- provenance ------------------------------ */

const drive = documentProvenance({
  url: "https://drive.google.com/file/d/AbCdEfGhIjKlMn123/view",
  tags: ["google-drive-import", "google-drive:abcdefghijklmn123"],
  content: JSON.stringify({ externalSystem: "google-drive", externalId: "google-drive:AbCdEfGhIjKlMn123", sha256: "A".repeat(64), sourceDate: "2021-11-03", extractedText: "Minutes of the board\n\n\nMoved and carried." }),
});
assert.equal(drive.sha256, "a".repeat(64));
assert.equal(drive.sourceSystem, "google-drive");
assert.equal(drive.sourceDate, "2021-11-03");
assert.equal(drive.excerpt, "Minutes of the board\nMoved and carried.");
const nested = documentProvenance({ content: JSON.stringify({ source: { id: "x1", url: "https://drive.google.com/file/d/x1zzzzzzzzzz/view", path: "Archive/Board/2012.xlsx", sha256: "b".repeat(64) } }) });
assert.equal(nested.sha256, "b".repeat(64));
assert.equal(nested.sourcePath, "Archive/Board/2012.xlsx");
assert.equal(documentProvenance({ content: "Plain markdown" }).contentKind, "text");
const fields = readableFields({ scope: "Local test only", sourceRecovery: { attempted: 3, downloaded: 2 }, knownUnresolved: ["One", "Two"], sheets: { Board: [["Name", "Office"], ["A. Person", "Director"]] } });
assert.deepEqual(fields.map((field) => [field.label, field.kind]), [["Scope", "text"], ["Source recovery", "group"], ["Known unresolved", "list"], ["Sheets", "group"]]);
assert.equal(fields[3].children?.[0].kind, "table");

/* ------------------------------- row clone -------------------------------- */

const tricky = { a: 1, b: undefined, c: [1, undefined, () => 1, NaN], d: { e: -0, f: Infinity, g: new Date("2020-01-01T00:00:00Z") }, h: "text", i: null };
assert.deepEqual(jsonClone(tricky), JSON.parse(JSON.stringify(tricky)), "jsonClone matches a JSON round trip");
const shared = { content: "x".repeat(10_000) };
assert.notEqual(jsonClone(shared), shared, "objects are detached");

/* ------------------------- portable list + browse ------------------------- */

assert.equal(actionPermission("documents:browse", "query"), "documents:read");
assert.equal(actionPermission("documents:mergeDuplicates", "mutation"), "documents:write");

const now = "2026-01-01T00:00:00.000Z";
const doc = (id: string, category: string, extra: Record<string, unknown> = {}) => ({ _id: id, societyId: "soc", title: id, category, createdAtISO: now, flaggedForDeletion: false, tags: [], ...extra });
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Society" }],
    users: [
      { _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner Person" },
      { _id: "viewer", societyId: "soc", role: "Viewer", status: "Active" },
    ],
    documents: [
      doc("d-recovered", "Recovered source review", { reviewStatus: "NeedsReview", content: JSON.stringify({ source: { sha256: "c".repeat(64) }, extractedText: "x".repeat(5000) }) }),
      doc("d-fin-lower", "financial-statement", { reviewStatus: "in_review" }),
      doc("d-fin", "FinancialStatement"),
      doc("d-audit", "Audit", { content: JSON.stringify({ scope: "Synthetic local test scope" }) }),
      doc("d-custom", "Board Packages"),
      doc("d-candidate", "Import Candidate", { tags: ["import-session", "import-record"], content: JSON.stringify({ recordKind: "source", payload: { sha256: "d".repeat(64) } }) }),
      doc("d-canonical", "Other", { content: JSON.stringify({ externalId: "google-drive:OTHER", sha256: "d".repeat(64) }) }),
      doc("d-session", "Import Session", { tags: ["import-session"] }),
    ],
    sourceEvidence: [
      { _id: "se-cand", societyId: "soc", sourceDocumentId: "d-candidate", externalSystem: "google-drive", externalId: "google-drive:ORIGINAL", sourceTitle: "Terms of reference.pdf", evidenceKind: "import_support", sensitivity: "standard", accessLevel: "internal", summary: "s", status: "NeedsReview", createdAtISO: now },
    ],
  },
});
const principal = (userId: string) => () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: userId, userId, societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("owner") }).registerAll(PORTABLE_FUNCTIONS);

const listed: any[] = await owner.runQuery("documents:list", { societyId: "soc" });
assert.deepEqual(listed.map((row) => row._id).sort(), ["d-audit", "d-canonical", "d-custom", "d-fin", "d-fin-lower", "d-recovered"], "no document is hidden by its category; internal rows stay out");
const browse: any = await owner.runQuery("documents:browse", { societyId: "soc" });
assert.equal(browse.rows.length, 6);
for (const row of browse.rows) {
  assert.equal("content" in row, false, "browse rows never carry content");
  assert.equal("sourcePayloadJson" in row, false);
}
const byId = new Map(browse.rows.map((row: any) => [row._id, row]));
assert.equal((byId.get("d-fin-lower") as any).categoryValue, "FinancialStatement");
assert.equal((byId.get("d-fin-lower") as any).categoryKey, (byId.get("d-fin") as any).categoryKey);
assert.equal((byId.get("d-recovered") as any).reviewStatus, "needs_review");
assert.equal((byId.get("d-recovered") as any).hasContent, true);
assert.equal((byId.get("d-recovered") as any).sha256, "c".repeat(64));
assert.equal(browse.summary.needsReview, 2);

const queues: any = await owner.runQuery("documents:reviewQueues", { societyId: "soc" });
assert.ok(queues.counts.documents >= 5, "quick-access queues see every category");
const recentIds = new Set(queues.recent.map((row: any) => row._id));
assert.ok(queues.workInProgress.every((row: any) => !recentIds.has(row._id)), "work in progress does not repeat recent documents");

await owner.runMutation("documents:updateReviewStatus", { id: "d-recovered", reviewStatus: "NeedsReview" });
assert.equal((await db.get("d-recovered"))?.reviewStatus, "needs_review", "writers store the normalized status");
const created = await owner.runMutation("documents:create", { societyId: "soc", title: "Statement", category: "financial statement", tags: [] });
assert.equal((await db.get(String(created)))?.category, "FinancialStatement", "new documents store the canonical category");

// Evidence citing a staged import candidate points at the canonical document
// (here an exact byte duplicate retained under another source id) (D-20).
const registers: any = await owner.runQuery("evidenceRegisters:overview", { societyId: "soc" });
const cited = registers.sourceEvidence.find((row: any) => row._id === "se-cand");
assert.equal(cited.sourceDocumentKind, "candidate");
assert.equal(cited.canonicalDocumentId, "d-canonical");

console.log("Document category, review status and list projection checks passed.");

/* ------------- governing documents: re-file, link, replace, unlink ------------- */

assert.equal(actionPermission("society:linkGoverningDocument", "mutation"), "society:write");
assert.equal(actionPermission("documents:updateCategory", "mutation"), "documents:write");
assert.deepEqual(governingDocumentSlots({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" }).map((slot) => slot.label), ["Articles", "By-laws"]);
assert.deepEqual(governingDocumentSlots({ entityType: "society", jurisdictionCode: "CA-BC" }).map((slot) => slot.label), ["Constitution", "Bylaws"]);

const cbcaCorp = { name: "Synthetic Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", formationStatus: "incorporated", organizationStatus: "active" };
const bcCo = { name: "Synthetic Holdings Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", legalSubtype: "ordinary_private_company", formationStatus: "incorporated", organizationStatus: "active" };
const govDoc = (id: string, societyId: string, title: string, category: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, societyId, title, category, createdAtISO: now, flaggedForDeletion: false, tags: [], ...extra });
const issuer = betterAuthIssuer();
const govDb = new MemoryDb({
  seed: {
    societies: [{ _id: "corp", ...cbcaCorp }, { _id: "bcco", ...bcCo }, { _id: "other", ...cbcaCorp, name: "Other Corp." }],
    // Hosted (verified) identities: a trusted local workspace file owns every
    // society in it, so isolation is checked as a hosted runtime sees it.
    users: [
      { _id: "corp-owner", societyId: "corp", role: "Owner", status: "Active", displayName: "Corp Owner" },
      { _id: "corp-viewer", societyId: "corp", role: "Viewer", status: "Active" },
      { _id: "bc-owner", societyId: "bcco", role: "Owner", status: "Active" },
      { _id: "other-owner", societyId: "other", role: "Owner", status: "Active" },
    ].map((user) => ({ ...user, authSubject: user._id, authProvider: "better-auth", authIssuer: issuer })),
    documents: [
      govDoc("g-draft", "corp", "Draft articles", "Other"),
      govDoc("g-second", "corp", "Articles (signed)", "Other"),
      govDoc("g-bylaws", "corp", "By-law No. 1", "Other"),
      govDoc("g-session", "corp", "Import", "Import Session", { tags: ["import-session"] }),
      govDoc("g-bc", "bcco", "BC articles", "Other"),
      govDoc("g-foreign", "other", "Foreign articles", "ArticlesOfIncorporation"),
    ],
  },
});
const as = (userId: string) => new PortableRuntime({
  db: govDb, capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "verified-jwt" as const, subject: userId, issuer, authProvider: "better-auth" }),
}).registerAll(PORTABLE_FUNCTIONS);
const corpOwner = as("corp-owner");
const corpRow = async () => (await govDb.get("corp")) as any;

// Re-filing an existing document as articles fills the empty field, like an upload.
const refiled: any = await corpOwner.runMutation("documents:updateCategory", { id: "g-draft", category: "articles of incorporation" });
assert.equal(refiled.category, "ArticlesOfIncorporation");
assert.equal(refiled.filledField, "constitutionDocId");
assert.equal(refiled.filledLabel, "Articles");
assert.equal((await corpRow()).constitutionDocId, "g-draft", "re-categorising fills the empty articles field");
// A second document re-filed as articles never replaces the one on file.
const second: any = await corpOwner.runMutation("documents:updateCategory", { id: "g-second", category: "ArticlesOfIncorporation" });
assert.equal(second.filledField, null);
assert.equal((await corpRow()).constitutionDocId, "g-draft", "re-categorising never replaces a linked document");
// Filing the linked document away from its category keeps it linked.
await corpOwner.runMutation("documents:updateCategory", { id: "g-draft", category: "Other" });
assert.equal((await corpRow()).constitutionDocId, "g-draft", "moving a linked document away does not unlink it");
// Undo re-files without filling the profile.
await corpOwner.runMutation("documents:updateCategory", { id: "g-bylaws", category: "Bylaws", fillProfile: false });
assert.equal((await corpRow()).bylawsDocId, undefined, "fillProfile: false only re-files");
await corpOwner.runMutation("documents:updateCategory", { id: "g-bylaws", category: "Other", fillProfile: false });
// A connector metadata merge that re-files a document fills the empty field too.
await corpOwner.runMutation("documents:mergeConnectorDocumentMetadata", { documentId: "g-bylaws", category: "Bylaws" });
assert.equal((await corpRow()).bylawsDocId, "g-bylaws");
await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "bylawsDocId", documentId: null });
await corpOwner.runMutation("documents:updateCategory", { id: "g-bylaws", category: "Other", fillProfile: false });

// Choose a document on the profile: replace, with and without re-filing it.
const replaced: any = await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: "g-second" });
assert.equal(replaced.previousDocumentId, "g-draft");
assert.equal(replaced.categoryChange, null, "a document already filed as articles is not re-filed");
assert.equal((await corpRow()).constitutionDocId, "g-second");
const chosen: any = await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "bylawsDocId", documentId: "g-bylaws", updateCategory: true });
assert.deepEqual(chosen.categoryChange, { from: "Other", to: "Bylaws" });
assert.equal((await govDb.get("g-bylaws"))?.category, "Bylaws", "the chosen document can be re-filed");
assert.equal((await corpRow()).bylawsDocId, "g-bylaws");
const kept: any = await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: "g-draft", updateCategory: false });
assert.equal(kept.categoryChange, null);
assert.equal((await govDb.get("g-draft"))?.category, "Other", "re-filing is optional");

// Unlink, then undo by linking the previous document again.
const unlinked: any = await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: null });
assert.equal(unlinked.previousDocumentId, "g-draft");
assert.equal((await corpRow()).constitutionDocId, undefined, "unlink clears the field");
assert.equal((await govDb.get("g-draft"))?.category, "Other", "unlinking leaves the document alone");
await corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: unlinked.previousDocumentId });
assert.equal((await corpRow()).constitutionDocId, "g-draft");
const govActivity = (await govDb.query("activity").collect()).filter((row: any) => row.societyId === "corp" && /^governing-document-/.test(row.action));
assert.deepEqual(govActivity.map((row: any) => row.action), [
  "governing-document-unlinked", "governing-document-replaced", "governing-document-linked",
  "governing-document-replaced", "governing-document-unlinked", "governing-document-linked",
], "each link, replace and unlink writes an activity row");

// Another workspace's document is never accepted, and nothing changes.
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: "g-foreign" }), /not found/);
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "bylawsDocId", documentId: "g-foreign", updateCategory: true }), /not found/);
await assert.rejects(() => corpOwner.runMutation("documents:updateCategory", { id: "g-foreign", category: "Other" }), /not found|not a member|required/i);
assert.equal((await corpRow()).constitutionDocId, "g-draft");
assert.equal((await govDb.get("g-foreign"))?.category, "ArticlesOfIncorporation");
// Another workspace's owner can't link into this one, even its own document.
const otherOwner = as("other-owner");
await assert.rejects(() => otherOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: "g-foreign" }), /not found|not a member|required/i);
await assert.rejects(() => otherOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: null }), /not found|not a member|required/i);
assert.equal((await corpRow()).constitutionDocId, "g-draft");
assert.ok(govActivity.every((row: any) => !/Foreign/.test(row.summary)), "no activity mentions another workspace's document");
// Internal bookkeeping rows are not documents to link.
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: "g-session" }), /not found/);

// Only the fields this organization keeps.
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "privacyPolicyDocId", documentId: "g-draft" }), /doesn't keep that document/);
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "certificateEvidenceDocumentId", documentId: "g-draft" }), /doesn't keep that document/);
await assert.rejects(() => corpOwner.runMutation("society:linkGoverningDocument", { societyId: "corp", field: "name", documentId: null }), /doesn't keep that document/);
const bcOwner = as("bc-owner");
await assert.rejects(() => bcOwner.runMutation("society:linkGoverningDocument", { societyId: "bcco", field: "bylawsDocId", documentId: "g-bc" }), /doesn't keep that document/, "a BC company has no separate by-laws");
const bcLinked: any = await bcOwner.runMutation("society:linkGoverningDocument", { societyId: "bcco", field: "constitutionDocId", documentId: "g-bc", updateCategory: true });
assert.deepEqual(bcLinked.categoryChange, { from: "Other", to: "ArticlesOfIncorporation" });

// Viewers can't change the profile.
await assert.rejects(() => as("corp-viewer").runMutation("society:linkGoverningDocument", { societyId: "corp", field: "constitutionDocId", documentId: null }), /Permission society:write required/);
assert.equal((await corpRow()).constitutionDocId, "g-draft");

console.log("Governing documents: re-filing fills an empty field and never replaces; link, replace, unlink and re-file from the profile; other workspaces and wrong fields rejected.");
