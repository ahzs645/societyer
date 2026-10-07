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
  isInternalDocumentRecord,
  normalizeDocumentCategory,
} from "../shared/documentCategories";
import {
  documentReviewStatusLabel,
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

/* ------------------------------ review status ----------------------------- */

assert.equal(normalizeDocumentReviewStatus("NeedsReview"), "needs_review");
assert.equal(normalizeDocumentReviewStatus("needs review"), "needs_review");
assert.equal(normalizeDocumentReviewStatus("in_review"), "in_review");
assert.equal(normalizeDocumentReviewStatus("InReview"), "in_review");
assert.equal(normalizeDocumentReviewStatus(undefined), "none");
assert.equal(normalizeDocumentReviewStatus("Verified"), "approved");
assert.equal(normalizeDocumentReviewStatus("something odd"), "needs_review", "unknown statuses ask for review");
assert.equal(documentReviewStatusLabel("NeedsReview"), "Needs review");
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
      doc("d-candidate", "Import Candidate", { tags: ["import-session", "import-record"] }),
      doc("d-session", "Import Session", { tags: ["import-session"] }),
    ],
  },
});
const principal = (userId: string) => () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: userId, userId, societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("owner") }).registerAll(PORTABLE_FUNCTIONS);

const listed: any[] = await owner.runQuery("documents:list", { societyId: "soc" });
assert.deepEqual(listed.map((row) => row._id).sort(), ["d-audit", "d-custom", "d-fin", "d-fin-lower", "d-recovered"], "no document is hidden by its category; internal rows stay out");
const browse: any = await owner.runQuery("documents:browse", { societyId: "soc" });
assert.equal(browse.rows.length, 5);
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

console.log("Document category, review status and list projection checks passed.");
