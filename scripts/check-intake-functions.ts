/** Gate for the portable intake staging functions (shared/functions/intake.ts):
 * a synthetic pipeline run is staged through intake:* mutations on the local
 * runtime, extractions are re-verified server-side, reviewers decide fields,
 * provenance links native rows, and role/sensitivity rules are enforced. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { extractBytes } from "../shared/intake/extract";
import { libreOfficeConverter, sha256Hex } from "../shared/intake/node/extractFile";
import { runIntakePipeline } from "../shared/intake/pipeline";
import { stageRunInWorkspace } from "../shared/intake/stageRun";
import { writeSyntheticFixtures } from "./lib/intake-synthetic-fixtures";

for (const name of ["intake:listRuns", "intake:getExtraction"]) assert.equal(actionPermission(name, "query"), "settings:read");
for (const name of ["intake:createRun", "intake:saveExtraction", "intake:reviewField", "intake:recordProvenance"]) assert.equal(actionPermission(name, "mutation"), "settings:write");
assert.equal(actionPermission("intakeActions:extractRun", "action"), "settings:write");

const society = "society_intake";
const db = new MemoryDb({ seed: {
  societies: [{ _id: society, name: "Lakeside Clean Air Society" }, { _id: "society_other", name: "Other" }],
  users: [
    { _id: "user_owner", societyId: society, role: "Owner", status: "Active" },
    { _id: "user_director", societyId: society, role: "Director", status: "Active" },
    { _id: "user_member", societyId: society, role: "Member", status: "Active" },
    { _id: "user_outsider", societyId: "society_other", role: "Owner", status: "Active" },
  ],
  meetings: [{ _id: "meeting_1", societyId: society, title: "Board", scheduledAt: "2025-05-13T12:00:00.000Z", type: "Board", status: "Held", attendeeIds: [] }, { _id: "meeting_other", societyId: "society_other", title: "Other", scheduledAt: "2025-05-13T12:00:00.000Z", type: "Board", status: "Held", attendeeIds: [] }],
} });
let actor = "user_owner";
const runtime = new PortableRuntime({
  db,
  capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: actor, userId: actor, societyId: actor === "user_outsider" ? "society_other" : society }),
}).registerAll(PORTABLE_FUNCTIONS);
const as = (user: string) => { actor = user; };

// Run the deterministic pipeline on the synthetic fixture and stage it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-functions-"));
const fixtures = await writeSyntheticFixtures(dir);
const run = await runIntakePipeline(fs.readdirSync(dir).map((name) => ({ fileKey: `local:${name}`, name, path: name, acquisitionStatus: "local" as const, read: async () => new Uint8Array(fs.readFileSync(path.join(dir, name))) })), {
  name: "Synthetic fixture", sourceKind: "local_folder", sourceRoot: dir, extract: (file, bytes) => extractBytes(file.name, bytes, { convertLegacy: libreOfficeConverter }), hash: sha256Hex,
});
const build = buildImportBundle(run);
const coverage = coverageReport(run, build);
as("user_owner");
const staged = await stageRunInWorkspace((name, args) => runtime.runMutation(name, args), society, run, run.extracts, coverage);
assert.equal(staged.extractions, 6);
assert.equal(db.dump("intakeFiles").length, Object.keys(fixtures.files).length);
assert.equal(db.dump("intakeExtracts").length, 6);
assert.equal(db.dump("intakeExtractions").length, 6);
assert.ok(db.dump("intakeProcessingLog").length > 0);

const runs = await runtime.runQuery("intake:listRuns", { societyId: society });
assert.equal(runs.length, 1);
assert.equal(runs[0].status, "extracted");
assert.ok(runs[0].coverage.coverage > 0.9);
const detail = await runtime.runQuery("intake:getRun", { societyId: society, runId: staged.runId });
assert.equal(detail.counts.extractions, 6);
const queue = await runtime.runQuery("intake:listExtractions", { societyId: society, runId: staged.runId });
assert.equal(queue[0].motions >= queue[queue.length - 1].motions, true, "review queue is risk-ordered");
const board = queue.find((row: any) => row.date === "2025-05-13");
assert.equal(board.motions, 6);
assert.equal(board.verification.mismatched, 0, "server-side re-verification found every deterministic quote");

// Side-by-side review payload: extraction + blocks + reviews.
const review = await runtime.runQuery("intake:getExtraction", { societyId: society, extractionId: board._id });
assert.ok(review.extract.blocks.some((block: any) => block.kind === "table" && block.rows?.length));
assert.equal(review.extraction.record.motions[2].movedBy.value.nameAsWritten, "Avery Quill");

// A fabricated quote is caught when saved, whoever produced it.
const forged = JSON.parse(JSON.stringify(review.extraction));
forged.record.motions[0].text = { value: "dissolve the society", status: "stated", confidence: 0.99, locators: [{ kind: "block", blockIndex: 0, quote: "MOTION to dissolve the society (Carried)" }] };
await runtime.runMutation("intake:saveExtraction", { societyId: society, runId: staged.runId, fileKey: forged.fileKey, extraction: { fileId: forged.fileKey, docClass: forged.docClass, schemaVersion: forged.schemaVersion, engine: "llm", model: "test:fake", record: forged.record, unsupported: [], references: [] } });
const forgedRow = db.dump("intakeExtractions").find((row: any) => row.engine === "llm")!;
assert.equal((forgedRow as any).verification.mismatched, 1);
assert.equal((forgedRow as any).record.motions[0].text.verification, "span_mismatch");
await assert.rejects(() => runtime.runMutation("intake:saveExtraction", { societyId: society, runId: staged.runId, fileKey: forged.fileKey, extraction: { fileId: forged.fileKey, docClass: "meetingMinutes", schemaVersion: "x", engine: "llm", record: { motions: "not a list" }, unsupported: [], references: [] } }), /does not match the intake schema/);

// Field review decisions.
await runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[2].movedBy", decision: "accept" });
await runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[3].outcome", decision: "edit", editedValue: "carried", note: "Outcome confirmed against the signed copy." });
await runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "quorum.stated", decision: "cant_represent", gap: { infoType: "quorum.count", suggestedTarget: "minutes.quorumPresentCount", description: "Head-count of directors present has no native field." } });
await assert.rejects(() => runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[99].text", decision: "accept" }), /Unknown field path/);
await assert.rejects(() => runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[0].text", decision: "approve" }), /Decision must be/);
await assert.rejects(() => runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[0].text", decision: "cant_represent" }), /Describe what/);
const reviews = db.dump("intakeFieldReviews");
assert.equal(reviews.length, 3);
assert.ok((reviews.find((row: any) => row.decision === "cant_represent") as any).gap.locators.length);
assert.equal((db.dump("intakeExtractions").find((row: any) => row._id === board._id) as any).status, "in_review");

// Provenance: only owned rows of tracked tables, always with a locator.
const locator = review.extraction.record.date.locators[0];
await runtime.runMutation("intake:recordProvenance", { societyId: society, entries: [{ targetTable: "meetings", targetId: "meeting_1", fieldPath: "scheduledAt", extractionId: board._id, locator: { ...locator, junk: "dropped" }, value: "2025-05-13", decision: "accept" }] });
const provenance = await runtime.runQuery("intake:provenanceForRecord", { societyId: society, targetTable: "meetings", targetId: "meeting_1" });
assert.equal(provenance.length, 1);
assert.equal(provenance[0].fileKey, board.fileKey);
assert.equal("junk" in provenance[0].locator, false, "locators are sanitised to the contract");
await assert.rejects(() => runtime.runMutation("intake:recordProvenance", { societyId: society, entries: [{ targetTable: "meetings", targetId: "meeting_other", fieldPath: "title", locator }] }));
await assert.rejects(() => runtime.runMutation("intake:recordProvenance", { societyId: society, entries: [{ targetTable: "users", targetId: "user_owner", fieldPath: "role", locator }] }), /not tracked/);

// Roles: Directors can read the queue but not restricted content or write; Members see nothing.
const restrictedFile = db.dump("intakeFiles").find((row: any) => row.fileKey === board.fileKey)!;
await db.patch(restrictedFile._id, { sensitivity: "restricted" });
as("user_director");
assert.equal((await runtime.runQuery("intake:listExtractions", { societyId: society, runId: staged.runId })).length, 7);
await assert.rejects(() => runtime.runQuery("intake:getExtraction", { societyId: society, extractionId: board._id }), /settings:write/);
await assert.rejects(() => runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[0].text", decision: "accept" }), /settings:write/);
as("user_member");
await assert.rejects(() => runtime.runQuery("intake:listRuns", { societyId: society }), /settings:read/);
as("user_outsider");
// Rows are scoped to their workspace: another workspace's id never resolves.
await assert.rejects(() => runtime.runQuery("intake:getRun", { societyId: "society_other", runId: staged.runId }), /not found/);

// Promoted extractions are final.
as("user_owner");
await runtime.runMutation("intake:setExtractionStatus", { societyId: society, extractionId: board._id, status: "promoted" });
await assert.rejects(() => runtime.runMutation("intake:reviewField", { societyId: society, extractionId: board._id, fieldPath: "motions[0].text", decision: "accept" }), /final/);
await assert.rejects(() => runtime.runMutation("intake:setExtractionStatus", { societyId: society, extractionId: board._id, status: "pending_review" }), /final/);
fs.rmSync(dir, { recursive: true, force: true });

console.log("PASS intake functions: a pipeline run stages through portable intake:* mutations; extractions are schema-validated and span-re-verified server-side; field reviews, can't-represent gaps and provenance are recorded; settings/documents/restricted permissions and workspace ownership are enforced");
