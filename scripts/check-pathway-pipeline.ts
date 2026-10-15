import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { pathwaySubmissionCapabilities } from "../convex/lib/pathwaySubmissionAdapters";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { activePipelineApprovals, evaluatePipeline, validatePipelineGraph, validatePipelineInputs, type PipelineGraph } from "../shared/pathways/pipeline";
import { requireCurrentSubmissionApproval } from "../shared/functions/pathways";
import { getPathway } from "../shared/pathways/registry";
import { effectivePathwayInputs, pathwayWorkspaceDefaults, readPathwayInputSources, type PathwayWorkspaceFacts } from "../shared/pathways/workspaceDefaults";
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

// Workspace defaults: each source, and what the user typed in the run always wins.
const federalGraph = getPathway("federal_cbca")!.pipeline!;
const bcCompanyGraph = getPathway("bc_company")!.pipeline!;
const societyGraph = getPathway("bc_society")!.pipeline!;
const companyFacts: PathwayWorkspaceFacts = {
  society: false,
  profile: { name: "Founder Labs Inc.", numbered: true, registeredOfficeAddress: "1 Old Street, Ottawa", purposes: "Not used by companies" },
  addresses: [
    { type: "registered_office", status: "past", street: "9 Former Road", city: "Ottawa", country: "Canada" },
    { type: "registered_office", status: "proposed", street: "100 Queen St", unit: "Suite 4", city: "Ottawa", provinceState: "ON", postalCode: "K1P 1J9", country: "Canada" },
    { type: "records_office", status: "current", street: "5 Records Way", city: "Victoria", provinceState: "BC", country: "Canada" },
  ],
  roleHolders: [
    { roleType: "director", status: "proposed", fullName: "Jane Founder", citizenshipResidency: "a_canadian_citizen_ordinarily_resident_in_canada" },
    { roleType: "director", status: "former", fullName: "Gone Director" },
    { roleType: "director", status: "current", firstName: "Alex", lastName: "Abroad", citizenshipResidency: "not_a_canadian_citizen_and_not_a_permanent_resident_in_canada__as_defined_above_" },
  ],
  controllers: [{ roleType: "controller", status: "proposed", fullName: "Jane Founder" }],
  rightsClasses: [
    { className: "Common", classType: "share", status: "proposed" },
    { className: "Retired", classType: "share", status: "inactive" },
    { className: "Members", classType: "membership", status: "active" },
  ],
  setupClassDetails: "One class of common shares",
};
const companyDefaults = pathwayWorkspaceDefaults(federalGraph, companyFacts);
assert.equal(companyDefaults.proposedName.value, "Founder Labs Inc.");
assert.equal(companyDefaults.proposedName.source, "profile");
assert.equal(companyDefaults.namedCompany.value, false, "the numbered-name choice comes from the profile flag");
assert.equal(companyDefaults.registeredOffice.value, "Suite 4, 100 Queen St, Ottawa, ON, K1P 1J9, Canada", "a proposed structured office beats the legacy text");
assert.equal(companyDefaults.registeredOffice.href, "/app/society#registered-office");
assert.equal(companyDefaults.directors.value, "Alex Abroad (not a resident Canadian); Jane Founder (proposed, resident Canadian)", "current and proposed directors with residency; former ones are left out");
assert.equal(companyDefaults.directors.label, "Directors register");
assert.equal(companyDefaults.shareStructure.value, "Common (proposed)", "active and proposed share classes only");
assert.equal(companyDefaults.significantControl.value, "Jane Founder (proposed)");
assert.equal(companyDefaults.recordsOffice, undefined, "federal pathways have no records office input");
assert.equal(companyDefaults.purposes, undefined, "companies have no purposes input");
assert.equal(pathwayWorkspaceDefaults(bcCompanyGraph, companyFacts).recordsOffice.value, "5 Records Way, Victoria, BC, Canada");
assert.equal(pathwayWorkspaceDefaults(bcCompanyGraph, { ...companyFacts, addresses: [] , recordsLocations: [{ address: "Records room, 2 Bay St" }] }).recordsOffice.value, "Records room, 2 Bay St");
const legacy = pathwayWorkspaceDefaults(federalGraph, { ...companyFacts, addresses: [{ type: "registered_office", status: "current", street: "1 Legacy Street", city: "Needs review", country: "Canada" }], rightsClasses: [], profile: { name: "Named Co.", numbered: false } });
assert.equal(legacy.registeredOffice.value, "1 Legacy Street, Canada", "placeholder address parts are dropped");
assert.equal(legacy.namedCompany.value, true);
assert.equal(legacy.shareStructure.value, "One class of common shares");
assert.equal(legacy.shareStructure.source, "setup-answers", "setup answers fill the share structure when no class exists");
assert.equal(pathwayWorkspaceDefaults(federalGraph, { ...companyFacts, addresses: [], profile: { name: "Named Co." } }).registeredOffice, undefined, "no office recorded, no default");
assert.equal(pathwayWorkspaceDefaults(federalGraph, { ...companyFacts, profile: { name: "Unchosen" } }).namedCompany, undefined, "an unset numbered flag is not a choice");
assert.equal(pathwayWorkspaceDefaults(federalGraph, { society: false }).directors, undefined, "unreadable registers give no defaults");
const societyDefaults = pathwayWorkspaceDefaults(societyGraph, {
  society: true, profile: { name: "Harbour Society", purposes: "To run a community harbour." },
  roleHolders: companyFacts.roleHolders,
  societyDirectors: [
    { firstName: "Sam", lastName: "Chair", status: "Active", isBCResident: true, residentCanadianStatus: "yes", consentOnFile: true },
    { firstName: "Old", lastName: "Board", status: "Resigned" },
  ],
});
assert.equal(societyDefaults.directors.value, "Sam Chair (BC resident, resident Canadian, consent on file)", "societies use the directors table, not role holders");
assert.equal(societyDefaults.directors.href, "/app/directors");
assert.equal(societyDefaults.purposes.value, "To run a community harbour.");
assert.equal(societyDefaults.namedCompany, undefined);
const merged = effectivePathwayInputs(federalGraph, { proposedName: "Typed Name Ltd.", directors: "" }, companyDefaults);
assert.equal(merged.inputs.proposedName, "Typed Name Ltd.", "a typed value is never overwritten");
assert.equal(merged.inputs.directors, "", "even a value the user cleared stays theirs");
assert.deepEqual(merged.sources.proposedName, { kind: "user" });
assert.equal(merged.inputs.registeredOffice, companyDefaults.registeredOffice.value);
assert.equal((merged.sources.registeredOffice as any).label, "Registered office address");
assert.deepEqual(readPathwayInputSources(JSON.stringify({ a: { kind: "user" }, b: { kind: "workspace", source: "profile", label: "Forged", href: "https://evil.example" }, c: { kind: "workspace", source: "unknown" } })), { a: { kind: "user" }, b: { kind: "workspace", source: "profile", label: "Organization profile", href: "/app/society" } }, "stored sources never carry forged links");
validatePipelineInputs(federalGraph, merged.inputs);

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
  "./organizationSetup.js": () => import("../convex/organizationSetup"),
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

// A self-review is refused while anyone else in the workspace could review.
const contested = await prepared();
await assert.rejects(() => owner.mutation(api.pathways.approve, { runId: contested, nodeKey: "review", confirmSelfReview: true }), /independent/);
assert.equal((await owner.query(api.pathways.status, { societyId: setup.societyId })).runs.find((run: any) => run._id === contested).nodes.find((node: any) => node.key === "review").canSelfReview, false);

// Solo founder: workspace facts fill the run, and the only reviewer may check it themselves.
const roleRow = (societyId: any, roleType: string, fullName: string, extra: Record<string, unknown> = {}) => ({ societyId, roleType, status: "proposed", fullName, citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: atISO, updatedAtISO: atISO, ...extra });
const solo = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Solo Founder Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation", numbered: true, formationStatus: "preparing", organizationStatus: "preparing_incorporation", onboardingAnswersJson: JSON.stringify({ version: 1, previousUse: "new", organizationStage: "preparing", pathwayKey: "federal_cbca", governanceStructure: "single_class", classDetails: "", governanceDocuments: "need_to_prepare", peopleReadiness: "add_later", operatingRegions: "" }), isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ownerId = await ctx.db.insert("users", { societyId, displayName: "Solo Owner", email: "solo@pipeline.test", role: "Owner", status: "Active", authSubject: "SoloOwner", authIssuer: issuer, createdAtISO: atISO });
  // People who can never review: a member, a disabled admin, an invited director.
  await ctx.db.insert("users", { societyId, displayName: "Solo Member", email: "member@solo.test", role: "Member", status: "Active", authSubject: "SoloMember", authIssuer: issuer, createdAtISO: atISO });
  await ctx.db.insert("users", { societyId, displayName: "Disabled Admin", email: "disabled@solo.test", role: "Admin", status: "Disabled", authSubject: "SoloDisabled", authIssuer: issuer, createdAtISO: atISO });
  await ctx.db.insert("users", { societyId, displayName: "Invited Director", email: "invited@solo.test", role: "Director", status: "Invited", authSubject: "SoloInvited", authIssuer: issuer, createdAtISO: atISO });
  await ctx.db.insert("organizationAddresses", { societyId, type: "registered_office", status: "proposed", street: "100 Queen St", city: "Ottawa", provinceState: "ON", country: "Canada", createdAtISO: atISO, updatedAtISO: atISO });
  await ctx.db.insert("roleHolders", roleRow(societyId, "director", "Jane Founder", { citizenshipResidency: "a_canadian_citizen_ordinarily_resident_in_canada" }));
  await ctx.db.insert("roleHolders", roleRow(societyId, "controller", "Jane Founder"));
  await ctx.db.insert("rightsClasses", { societyId, className: "Common", classType: "share", status: "proposed", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: atISO, updatedAtISO: atISO });
  // Another workspace's people never appear here.
  await ctx.db.insert("roleHolders", roleRow(setup.otherSociety, "director", "Foreign Director"));
  const packet = await ctx.db.insert("documents", { societyId, title: "Solo packet", category: "governance", tags: [], flaggedForDeletion: false, createdAtISO: atISO, content: "Prepared packet" });
  return { societyId, ownerId, packet };
});
const soloOwner = test.withIdentity({ issuer, subject: "SoloOwner" });
const soloMember = test.withIdentity({ issuer, subject: "SoloMember" });
const soloRun = await soloOwner.mutation(api.pathways.start, { societyId: solo.societyId });
const soloStatus = async (as = soloOwner) => (await as.query(api.pathways.status, { societyId: solo.societyId })).runs.find((run: any) => run._id === soloRun);
let open = await soloStatus();
assert.deepEqual(open.inputs, { proposedName: "Solo Founder Corp.", namedCompany: false, registeredOffice: "100 Queen St, Ottawa, ON, Canada", directors: "Jane Founder (proposed, resident Canadian)", shareStructure: "Common (proposed)", significantControl: "Jane Founder (proposed)" });
assert.equal(open.inputSources.directors.kind, "workspace");
assert.equal(open.inputSources.directors.label, "Directors register");
assert.deepEqual(open.savedInputs, {}, "nothing is saved into the run until the user types it");
assert.equal(open.workspaceDefaults.registeredOffice.value, "100 Queen St, Ottawa, ON, Canada");
assert.ok(!JSON.stringify(open).includes("Foreign Director"), "no cross-workspace rows");
// Read permissions still apply: a member without directors:read or settings:read sees no people.
const memberView = await soloStatus(soloMember);
assert.equal(memberView.inputs.directors, undefined);
assert.equal(memberView.inputs.significantControl, undefined);
assert.equal(memberView.inputs.proposedName, "Solo Founder Corp.");
// A typed value stays; untouched values follow the workspace until frozen.
await soloOwner.mutation(api.pathways.saveInput, { runId: soloRun, inputs: { proposedName: "Typed Founder Name Inc." } });
await test.run(async ctx => {
  await ctx.db.patch(solo.societyId, { name: "Renamed On Profile Corp." });
  await ctx.db.insert("roleHolders", roleRow(solo.societyId, "director", "Ben Second"));
});
open = await soloStatus();
assert.equal(open.inputs.proposedName, "Typed Founder Name Inc.", "the workspace never overwrites a typed value");
assert.deepEqual(open.inputSources.proposedName, { kind: "user" });
assert.equal(open.inputs.directors, "Ben Second (proposed); Jane Founder (proposed, resident Canadian)", "untouched inputs stay in sync");
// The first step uses the workspace values without a separate save, and freezes them with their sources.
await soloOwner.mutation(api.pathways.completeStep, { runId: soloRun, nodeKey: "collect-information" });
const frozenRun = await test.run(ctx => ctx.db.get(soloRun));
assert.equal(frozenRun!.inputsFrozen, true);
assert.equal(frozenRun!.inputs.directors, "Ben Second (proposed); Jane Founder (proposed, resident Canadian)");
assert.equal(frozenRun!.inputs.proposedName, "Typed Founder Name Inc.");
assert.equal(JSON.parse(frozenRun!.inputSourcesJson!).registeredOffice.source, "registered-office");
await test.run(ctx => ctx.db.insert("roleHolders", roleRow(solo.societyId, "director", "After Freeze")));
open = await soloStatus();
assert.equal(open.inputs.directors, frozenRun!.inputs.directors, "frozen inputs no longer follow the workspace");
assert.equal(open.inputSources.directors.label, "Directors register");
assert.ok(open.audit.some((row: any) => row.event === "inputs.frozen" && JSON.parse(row.detailJson).fromWorkspace.directors === "Directors register"));
assert.equal(open.nodes.find((node: any) => node.key === "name-approval").state, "skipped", "the numbered-name choice drove the branch");
await soloOwner.mutation(api.pathways.completeStep, { runId: soloRun, nodeKey: "numbered-name" });
await soloOwner.mutation(api.pathways.completeStep, { runId: soloRun, nodeKey: "prepare-documents", documentId: solo.packet });
open = await soloStatus();
const soloReview = open.nodes.find((node: any) => node.key === "review");
assert.equal(soloReview.canApprove, false, "four-eyes stays the default");
assert.equal(soloReview.canSelfReview, true, "no one else holds documents:write as a reviewer");
assert.equal(soloReview.independentReviewerAvailable, false);
assert.equal((await soloOwner.query(api.pathways.status, { societyId: solo.societyId })).selfReviewConfirmation, "No one else can review this; I've checked it myself");
await assert.rejects(() => soloOwner.mutation(api.pathways.approve, { runId: soloRun, nodeKey: "review" }), /confirm/i, "self-review needs the explicit confirmation");
// Re-checked at approval time: someone who could review joins, then leaves.
const lateAdmin = await test.run(ctx => ctx.db.insert("users", { societyId: solo.societyId, displayName: "Late Admin", email: "late@solo.test", role: "Admin", status: "Active", authSubject: "SoloLate", authIssuer: issuer, createdAtISO: atISO }));
await assert.rejects(() => soloOwner.mutation(api.pathways.approve, { runId: soloRun, nodeKey: "review", confirmSelfReview: true }), /independent/);
assert.equal((await soloStatus()).nodes.find((node: any) => node.key === "review").canSelfReview, false);
await test.run(ctx => ctx.db.patch(lateAdmin, { status: "Disabled" }));
await soloOwner.mutation(api.pathways.approve, { runId: soloRun, nodeKey: "review", confirmSelfReview: true, notes: "Checked the packet against the registry guide" });
const reviewStep = await test.run(ctx => ctx.db.query("pathwaySteps").withIndex("by_run_node", q => q.eq("runId", soloRun).eq("nodeKey", "review")).unique());
assert.equal(reviewStep!.state, "approved");
assert.equal(reviewStep!.approvedByUserId, solo.ownerId);
assert.equal(reviewStep!.selfReviewedByUserId, solo.ownerId);
assert.ok(reviewStep!.selfReviewedAtISO);
assert.equal(reviewStep!.selfReviewConfirmation, "No one else can review this; I've checked it myself");
open = await soloStatus();
const reviewed = open.nodes.find((node: any) => node.key === "review");
assert.equal(reviewed.selfReview.byName, "You");
assert.equal(reviewed.selfReview.confirmation, "No one else can review this; I've checked it myself");
assert.equal(reviewed.selfReview.secondReviewerAvailable, false);
const selfAudit = open.audit.find((row: any) => row.event === "review.self-approved");
assert.ok(selfAudit, "the self-review is in the run history");
assert.equal(JSON.parse(selfAudit.detailJson).selfReview.confirmation, "No one else can review this; I've checked it myself");
assert.equal(JSON.parse(selfAudit.detailJson).selfReview.byUserId, solo.ownerId);
// The recorded self-review authorizes the filing handoff; a forged one does not.
const soloOutbox = await soloOwner.mutation(api.pathways.requestSubmission, { runId: soloRun, nodeKey: "submit" });
await test.query(internal.pathways.authorizeSubmission, { submissionId: soloOutbox });
await test.run(ctx => ctx.db.patch(reviewStep!._id, { selfReviewConfirmation: "I promise" }));
await assert.rejects(() => test.query(internal.pathways.authorizeSubmission, { submissionId: soloOutbox }), /authority is invalid/);
await test.run(ctx => ctx.db.patch(reviewStep!._id, { selfReviewConfirmation: "No one else can review this; I've checked it myself" }));
// A second reviewer added later gets a gentle note; nothing is blocked.
await test.run(ctx => ctx.db.patch(lateAdmin, { status: "Active" }));
open = await soloStatus();
assert.equal(open.nodes.find((node: any) => node.key === "review").selfReview.secondReviewerAvailable, true);
await test.query(internal.pathways.authorizeSubmission, { submissionId: soloOutbox });
assert.equal(open.submissions[0].status, "manual_required");
// The setup view counts the self-reviewed step as reviewed.
const setupProgress = await soloOwner.query(api.organizationSetup.progress, { societyId: solo.societyId });
const setupReview = setupProgress!.phases.flatMap((phase: any) => phase.steps).find((step: any) => step.key === "review");
assert.equal(setupReview?.state, "done");

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
assert.equal(restoredStatus.runs.length, 3);
assert.ok(restoredStatus.runs.every((run: any) => run.status === "imported_readonly" && run.audit.length > 0 && run.nodes.every((node: any) => !node.canComplete && !node.canApprove && !node.canSelfReview && !node.canSubmit)));
assert.equal(restoredStatus.runs.find((run: any) => run._id === runId).submissions[0].status, "attested");
assert.equal(restoredStatus.runs.find((run: any) => run._id === filedByAdmin).submissions[0].status, "blocked");
await assert.rejects(() => restored.mutation("pathways:requestSubmission", { runId: filedByAdmin, nodeKey: "submit" }), /read-only/);
console.log("Pathway pipeline passed: DAG/conditions, workspace defaults (each source, typed values kept, frozen with sources), solo self-review (only without another reviewer, confirmed, recorded), frozen evidence, independent current approval, idempotent handoff, uploaded receipts/certificates, trusted actor scope, and read-only backup restore.");
