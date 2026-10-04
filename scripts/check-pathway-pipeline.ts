import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { pathwaySubmissionCapabilities } from "../convex/lib/pathwaySubmissionAdapters";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { activePipelineApprovals, evaluatePipeline, validatePipelineGraph, validatePipelineInputs, type PipelineGraph } from "../shared/pathways/pipeline";
import { requireCurrentSubmissionApproval } from "../shared/functions/pathways";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { StaticConvexClient } from "../src/lib/staticConvexClient";

const capabilities = await pathwaySubmissionCapabilities();
assert.deepEqual(capabilities.map(entry => [entry.adapterId, entry.mode, entry.available]), [["official-portal", "manual", false]], "uninstalled network adapters cannot appear available");

const branchGraph: PipelineGraph = { version: 1, inputFields: [{ key: "named", label: "Named", type: "boolean", required: true }], nodes: [
  { key: "named-review", title: "Named review", kind: "approval", dependsOn: [], condition: { field: "named", operator: "equals", value: true } },
  { key: "numbered-review", title: "Numbered review", kind: "approval", dependsOn: [], condition: { field: "named", operator: "equals", value: false } },
  { key: "submit", title: "Submit", kind: "submission", dependsOn: ["named-review", "numbered-review"], submission: { adapterId: "official-portal" } },
] };
validatePipelineGraph(branchGraph);
const branchSteps = [{ nodeKey: "named-review", state: "pending" as const }, { nodeKey: "numbered-review", state: "approved" as const }, { nodeKey: "submit", state: "pending" as const }];
assert.deepEqual(activePipelineApprovals(branchGraph, { named: false }, branchSteps, "submit").map(node => node.key), ["numbered-review"]);
assert.equal(evaluatePipeline(branchGraph, { named: false }, branchSteps).at(-1)!.state, "ready");
const onlySkipped = { ...branchGraph, nodes: [branchGraph.nodes[0], { ...branchGraph.nodes[2], dependsOn: ["named-review"] }] };
assert.equal(activePipelineApprovals(onlySkipped, { named: false }, branchSteps, "submit").length, 0, "a skipped-only review is not authority");
assert.throws(() => validatePipelineGraph({ ...branchGraph, nodes: [branchGraph.nodes[0], branchGraph.nodes[0]] }), /unique/);
assert.throws(() => validatePipelineGraph({ ...branchGraph, nodes: [{ ...branchGraph.nodes[0], dependsOn: ["missing"] }] }), /Unknown/);
assert.throws(() => validatePipelineGraph({ ...branchGraph, nodes: [{ ...branchGraph.nodes[0], dependsOn: ["named-review"] }] }), /cycle/);
assert.throws(() => validatePipelineGraph({ ...branchGraph, nodes: [{ ...branchGraph.nodes[0], condition: { field: "named", operator: "eval", value: "process.exit()" } }] }));
assert.throws(() => validatePipelineInputs(branchGraph, { named: "false" }));
assert.throws(() => validatePipelineInputs(branchGraph, { named: false, unknown: "x" }));
assert.throws(() => validatePipelineInputs(branchGraph, JSON.parse('{"__proto__":"x"}')));

// Exercise the same current-approval gate used by request, status and dispatch.
const branchDb = new MemoryDb({ seed: { users: [{ _id: "reviewer", societyId: "branch-society", role: "Admin", status: "Active" }] } });
const branchCtx: any = { db: branchDb, capabilities: makeCapabilities({}), principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "initiator", userId: "initiator" } };
const branchRun: any = { _id: "branch-run", societyId: "branch-society", graph: branchGraph, inputs: { named: false }, createdByUserId: "initiator" };
const approvedBranchSteps: any = branchSteps.map(step => ({ ...step, _id: step.nodeKey, ...(step.state === "approved" ? { approvedByUserId: "reviewer", approvedPayloadsJson: JSON.stringify({ submit: "digest" }) } : {}) }));
await requireCurrentSubmissionApproval(branchCtx, branchRun, approvedBranchSteps, "submit", "digest");
await assert.rejects(() => requireCurrentSubmissionApproval(branchCtx, { ...branchRun, graph: onlySkipped }, approvedBranchSteps, "submit", "digest"), /independent/);
await branchDb.patch("reviewer", { role: "Member" });
await assert.rejects(() => requireCurrentSubmissionApproval(branchCtx, branchRun, approvedBranchSteps, "submit", "digest"), /revoked/);

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./pathways.js": () => import("../convex/pathways"),
});
const issuer = betterAuthIssuer();
const atISO = new Date().toISOString();
const setup = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Pipeline test company", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", legalSubtype: "ordinary_private_company", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherSociety = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) users[role] = await ctx.db.insert("users", { societyId, displayName: role, email: `${role}@pipeline.test`, role, status: "Active", authSubject: role, authIssuer: issuer, createdAtISO: atISO });
  const draft = await ctx.db.insert("documents", { societyId, title: "Editable draft", category: "governance", tags: [], flaggedForDeletion: false, createdAtISO: atISO, content: "Prepared packet" });
  await ctx.db.insert("documentVersions", { societyId, documentId: draft, version: 1, storageProvider: "generated-inline", storageKey: "inline:draft", fileName: "draft.txt", sha256: "a".repeat(64), uploadedAtISO: atISO, isCurrent: true });
  const official = await ctx.db.insert("documents", { societyId, title: "Registry receipt", category: "Filing", tags: [], flaggedForDeletion: false, createdAtISO: atISO });
  await ctx.db.insert("documentVersions", { societyId, documentId: official, version: 1, storageProvider: "rustfs", storageKey: "official/receipt.pdf", fileName: "receipt.pdf", sha256: "b".repeat(64), uploadedAtISO: atISO, isCurrent: true });
  await ctx.db.insert("documentUploadHandles", { societyId, documentId: official, actorUserId: users.Owner, provider: "rustfs", stagingKey: "staging/receipt", storageKey: "official/receipt.pdf", fileName: "receipt.pdf", fileSizeBytes: 100, expiresAtISO: atISO, status: "consumed", sha256: "b".repeat(64) });
  const foreign = await ctx.db.insert("documents", { societyId: otherSociety, title: "Foreign", category: "Other", tags: [], flaggedForDeletion: false, createdAtISO: atISO });
  return { societyId, otherSociety, users, draft, official, foreign };
});
const owner = test.withIdentity({ issuer, subject: "Owner" });
const admin = test.withIdentity({ issuer, subject: "Admin" });
const member = test.withIdentity({ issuer, subject: "Member" });
await assert.rejects(() => test.mutation(api.pathways.start, { societyId: setup.societyId }), /Authentication/);
await assert.rejects(() => member.mutation(api.pathways.start, { societyId: setup.societyId }), /Permission tasks:write/);
await assert.rejects(() => owner.mutation(api.pathways.start, { societyId: setup.otherSociety }), /membership/);
await assert.rejects(() => test.withIdentity({ issuer: "https://wrong.test", subject: "Owner" }).mutation(api.pathways.start, { societyId: setup.societyId }), /Authentication|membership/);
const inputs = { proposedName: "Numbered company", registeredOffice: "Victoria", directors: "Director consent", namedCompany: false, shareStructure: "Common shares", recordsOffice: "Victoria" };
async function prepared(namedCompany = false) {
  const runId = await owner.mutation(api.pathways.start, { societyId: setup.societyId });
  await owner.mutation(api.pathways.saveInput, { runId, inputs: { ...inputs, namedCompany } });
  await owner.mutation(api.pathways.completeStep, { runId, nodeKey: "collect-information", notes: "Checked source records" });
  await assert.rejects(() => owner.mutation(api.pathways.saveInput, { runId, inputs }), /frozen/);
  if (namedCompany) {
    await assert.rejects(() => owner.mutation(api.pathways.completeStep, { runId, nodeKey: "name-approval", documentId: setup.draft }), /actual uploaded/);
    await owner.mutation(api.pathways.completeStep, { runId, nodeKey: "name-approval", documentId: setup.official });
  } else await owner.mutation(api.pathways.completeStep, { runId, nodeKey: "numbered-name" });
  await assert.rejects(() => owner.mutation(api.pathways.completeStep, { runId, nodeKey: "prepare-documents", documentId: setup.foreign }), /Record not found|membership/);
  await owner.mutation(api.pathways.completeStep, { runId, nodeKey: "prepare-documents", documentId: setup.draft });
  return runId;
}
const runId = await prepared();
await assert.rejects(() => owner.mutation(api.pathways.approve, { runId, nodeKey: "review" }), /independent/);
await assert.rejects(() => member.mutation(api.pathways.approve, { runId, nodeKey: "review" }), /Permission documents:write/);
await assert.rejects(() => owner.mutation(api.pathways.requestSubmission, { runId, nodeKey: "submit" }), /dependencies|blocked|ready/i);
await admin.mutation(api.pathways.approve, { runId, nodeKey: "review", notes: "Reviewed preparation, not registry acceptance" });
await test.run(ctx => ctx.db.patch(setup.users.Admin, { status: "Disabled" }));
await assert.rejects(() => owner.mutation(api.pathways.requestSubmission, { runId, nodeKey: "submit" }), /revoked/);
assert.equal((await owner.query(api.pathways.status, { societyId: setup.societyId })).runs[0].nodes.find((node: any) => node.key === "submit").canSubmit, false);
await test.run(ctx => ctx.db.patch(setup.users.Admin, { status: "Active" }));
const outboxes = await Promise.all([owner.mutation(api.pathways.requestSubmission, { runId, nodeKey: "submit" }), owner.mutation(api.pathways.requestSubmission, { runId, nodeKey: "submit" })]);
assert.equal(outboxes[0], outboxes[1]);
assert.equal((await test.run(ctx => ctx.db.query("pathwaySubmissionOutbox").collect())).length, 1);
assert.equal((await test.action(internal.pathways.dispatchSubmission, { submissionId: outboxes[0] })).status, "manual_required");
await assert.rejects(() => owner.mutation(api.pathways.completeStep, { runId, nodeKey: "retain-certificate", documentId: setup.official }), /dependencies|ready/i);
await assert.rejects(() => owner.mutation(api.pathways.recordManualReceipt, { runId, nodeKey: "submit", documentId: setup.draft, reference: "FAKE" }), /actual uploaded/);
await owner.mutation(api.pathways.recordManualReceipt, { runId, nodeKey: "submit", documentId: setup.official, reference: "Registry-123" });
await assert.rejects(() => owner.mutation(api.pathways.completeStep, { runId, nodeKey: "retain-certificate", documentId: setup.draft }), /actual uploaded/);
await owner.mutation(api.pathways.completeStep, { runId, nodeKey: "retain-certificate", documentId: setup.official });
const completed = await owner.query(api.pathways.status, { societyId: setup.societyId });
assert.equal(completed.runs[0].status, "completed");
assert.equal(completed.runs[0].submissions[0].status, "attested");
assert.equal((await test.run(ctx => ctx.db.get(setup.societyId)))!.incorporationNumber, undefined, "pipeline receipt never changes legal registration facts");

// A different permitted filer is pinned as requester and can use the server worker.
const filedByAdmin = await prepared(true);
await test.withIdentity({ issuer, subject: "Director" }).mutation(api.pathways.approve, { runId: filedByAdmin, nodeKey: "review" });
const adminOutbox = await admin.mutation(api.pathways.requestSubmission, { runId: filedByAdmin, nodeKey: "submit" });
await test.query(internal.pathways.authorizeSubmission, { submissionId: adminOutbox });
const original = await test.run(ctx => ctx.db.get(adminOutbox));
for (const patch of [{ documentIds: [] }, { idempotencyKey: "forged" }, { payloadJson: "{}" }, { adapterId: "arbitrary-network" }]) {
  await test.run(ctx => ctx.db.patch(adminOutbox, patch));
  await assert.rejects(() => test.query(internal.pathways.authorizeSubmission, { submissionId: adminOutbox }), /differs/);
  await test.run(ctx => ctx.db.patch(adminOutbox, { documentIds: original!.documentIds, idempotencyKey: original!.idempotencyKey, payloadJson: original!.payloadJson, adapterId: original!.adapterId }));
}
await test.run(ctx => ctx.db.patch(setup.users.Director, { role: "Member" }));
await assert.rejects(() => test.action(internal.pathways.dispatchSubmission, { submissionId: adminOutbox }), /revoked/);
await test.run(ctx => ctx.db.patch(setup.users.Director, { role: "Director" }));
await test.run(ctx => ctx.db.patch(setup.draft, { content: "Changed after review" }));
await assert.rejects(() => test.query(internal.pathways.authorizeSubmission, { submissionId: adminOutbox }), /Evidence changed/);
await test.run(ctx => ctx.db.patch(setup.draft, { content: "Prepared packet" }));
await test.run(ctx => ctx.db.patch(setup.users.Owner, { status: "Disabled" }));
await assert.rejects(() => test.query(internal.pathways.authorizeSubmission, { submissionId: adminOutbox }), /revoked/);
await test.run(ctx => ctx.db.patch(setup.users.Owner, { status: "Active" }));
await test.run(ctx => ctx.db.patch(filedByAdmin, { status: "imported_readonly" }));
await assert.rejects(() => test.query(internal.pathways.authorizeSubmission, { submissionId: adminOutbox }), /read-only/);
assert.equal((await admin.query(api.pathways.status, { societyId: setup.societyId })).runs.find((run: any) => run._id === filedByAdmin).submissions[0].canRecordReceipt, false);

// Actual local export/import preserves audit history but drops execution capability.
const seed = await test.run(async ctx => {
  const names = ["societies", "users", "documents", "documentVersions", "documentUploadHandles", "pathwayRuns", "pathwaySteps", "pathwaySubmissionOutbox", "pathwayAudit"];
  const tables: Record<string, any[]> = {};
  for (const name of names) tables[name] = await ctx.db.query(name as any).collect();
  return tables;
});
const source = new StaticConvexClient({ seed, databaseName: `pipeline-source-${Date.now()}` });
await source.query("pathways:status", { societyId: setup.societyId });
const snapshot = source.exportLocalWorkspaceSnapshot();
const restored = new StaticConvexClient({ seed: { societies: [] }, databaseName: `pipeline-restored-${Date.now()}` });
await restored.importLocalWorkspaceSnapshot(snapshot);
const restoredStatus = await restored.query("pathways:status", { societyId: setup.societyId });
assert.equal(restoredStatus.runs.length, 2);
assert.ok(restoredStatus.runs.every((run: any) => run.status === "imported_readonly" && run.audit.length > 0 && run.nodes.every((node: any) => !node.canComplete && !node.canApprove && !node.canSubmit)));
assert.equal(restoredStatus.runs.find((run: any) => run._id === runId).submissions[0].status, "attested");
assert.equal(restoredStatus.runs.find((run: any) => run._id === filedByAdmin).submissions[0].status, "blocked");
await assert.rejects(() => restored.mutation("pathways:requestSubmission", { runId: filedByAdmin, nodeKey: "submit" }), /read-only/);
console.log("Pathway pipeline passed: DAG/conditions, frozen evidence, independent current approval, idempotent handoff, uploaded receipts/certificates, trusted actor scope, and read-only backup restore.");
