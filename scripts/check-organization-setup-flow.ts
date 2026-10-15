// Lifecycle check for organization setup through the portable functions the app
// calls: create a preparing CBCA corporation → add a director and a share class
// → progress moves → "I've filed it" → undo → record the certificate → phase 3.
// Then permission and cross-workspace rejection on the portable runtime.
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import type { OrganizationSetupProgress } from "../shared/organizationSetup/types";
import {
  decideStepPortable,
  markSubmittedPortable,
  progressPortable,
  recordIncorporationPortable,
} from "../shared/functions/organizationSetup";
import { ROLES } from "../shared/functions/access";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities, type PortablePrincipal } from "../shared/portable/index";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { actionPermission } from "../shared/functions/actionPolicy";

const stepState = (progress: OrganizationSetupProgress, key: string) => progress.phases.flatMap((phase) => phase.steps).find((step) => step.key === key)?.state;

const client = new StaticConvexClient({ databaseName: `societyer-organization-setup-${Date.now()}`, seed: { societies: [] } });
const answers = {
  version: 1, previousUse: "new", organizationStage: "preparing", pathwayKey: "federal_cbca", incorporationActId: "ca-cbca",
  governanceStructure: "needs_review", classDetails: "", governanceDocuments: "need_to_prepare", peopleReadiness: "add_later", operatingRegions: "Ontario",
};
const created = await client.mutation("society:createWorkspace", {
  name: "Northstar Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation",
  formationStatus: "preparing", organizationStatus: "pre_incorporation", onboardingAnswersJson: JSON.stringify(answers),
}) as { societyId: string; workflowId: string; taskIds: string[] };
const societyId = created.societyId;

// One setup task instead of the old 5–6, with no "missing" number or date.
assert.equal(created.taskIds.length, 1);
const snapshot = client.exportLocalWorkspaceSnapshot();
const tasks = snapshot.tables.tasks.filter((task: any) => task.societyId === societyId);
assert.equal(tasks.length, 1);
assert.equal(tasks[0].title, "Finish setting up Northstar Corp.");
assert.ok(tasks[0].description.includes("/app/organization-setup"));
assert.ok(tasks[0].description.includes("Where you'll operate: Ontario"));
assert.doesNotMatch(tasks[0].description, /Missing profile fields|incorporation number|incorporation date|needs_review|add_later/);
assert.ok(snapshot.tables.workflows.some((workflow: any) => workflow._id === created.workflowId && workflow.recipe === "workspace_onboarding"), "the onboarding workflow record is still written");

let progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(progress.variant, "corporation_preparing");
assert.equal(progress.currentPhase, "prepare");
assert.equal(progress.next?.key, "office");
assert.equal(stepState(progress, "directors"), "todo");
assert.deepEqual(progress.savedAnswers?.slice(0, 1), ["Share classes: not decided yet"]);
const startDone = progress.counts.done;
assert.doesNotMatch(JSON.stringify(progress), new RegExp(societyId), "progress carries no record ids");

// Records move the progress.
await client.mutation("legalOperations:upsertRoleHolder", { societyId, roleType: "director", status: "proposed", fullName: "Dana Director" });
await client.mutation("legalOperations:upsertRightsClass", { societyId, className: "Common shares", classType: "share", status: "active" });
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(stepState(progress, "directors"), "done");
assert.equal(stepState(progress, "shares"), "done");
assert.equal(progress.counts.done, startDone + 2);

// "Doesn't apply" needs a reason, "later" moves a step out of the recommendation.
await assert.rejects(() => client.mutation("organizationSetup:decideStep", { societyId, stepKey: "isc", decision: "not_applicable" }), /Say why/);
await assert.rejects(() => client.mutation("organizationSetup:decideStep", { societyId, stepKey: "office", decision: "not_applicable", reason: "No office" }), /can't be marked/);
await assert.rejects(() => client.mutation("organizationSetup:decideStep", { societyId, stepKey: "file", decision: "later" }), /can't be put off/);
await assert.rejects(() => client.mutation("organizationSetup:decideStep", { societyId, stepKey: "members", decision: "later" }), /doesn't apply to this organization/);
await assert.rejects(() => client.mutation("organizationSetup:decideStep", { societyId, stepKey: "isc", decision: "not_applicable", reason: "x".repeat(301) }), /300 characters/);
const totalBefore = progress.counts.total;
await client.mutation("organizationSetup:decideStep", { societyId, stepKey: "isc", decision: "not_applicable", reason: "No one owns 25% or more" });
await client.mutation("organizationSetup:decideStep", { societyId, stepKey: "office", decision: "later" });
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(stepState(progress, "isc"), "not_applicable");
assert.equal(progress.counts.total, totalBefore - 1);
assert.equal(stepState(progress, "office"), "later");
assert.notEqual(progress.next?.key, "office");
await client.mutation("organizationSetup:decideStep", { societyId, stepKey: "office", decision: null });
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(stepState(progress, "office"), "todo", "undo puts the step back");

// "I've filed it" → submitted; again → rejected; undo → preparing.
await assert.rejects(() => client.mutation("organizationSetup:markSubmitted", { societyId, submittedOn: "2999-01-01" }), /future/);
await assert.rejects(() => client.mutation("organizationSetup:markSubmitted", { societyId, undo: true }), /Only a filing marked as submitted/);
assert.equal(await client.mutation("organizationSetup:markSubmitted", { societyId }), "submitted");
let profile = await client.query("society:getById", { id: societyId });
assert.equal(profile.formationStatus, "submitted");
assert.match(profile.filingSubmittedAtISO, /^\d{4}-\d{2}-\d{2}$/, "filed date defaults to today");
assert.equal(profile.filingReference, undefined, "the reference is optional");
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(progress.currentPhase, "file");
assert.equal(progress.phases.find((phase) => phase.key === "file")?.statusNote, "Waiting for Corporations Canada");
assert.equal(progress.next?.key, "certificate");
await assert.rejects(() => client.mutation("organizationSetup:markSubmitted", { societyId }), /already marked/);
assert.equal(await client.mutation("organizationSetup:markSubmitted", { societyId, undo: true }), "preparing");
profile = await client.query("society:getById", { id: societyId });
assert.equal(profile.formationStatus, "preparing");
assert.equal(profile.filingSubmittedAtISO, undefined);
await client.mutation("organizationSetup:markSubmitted", { societyId, submittedOn: "2026-01-20", reference: "CC-2026-0042" });
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(progress.phases.flatMap((phase) => phase.steps).find((step) => step.key === "file")?.note, "Filed on 2026-01-20 · Reference CC-2026-0042");

// Recording the certificate: a generated draft is refused, an uploaded file is accepted.
const draft = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId, packetKey: "federal-articles-preparation" }) as { draftDocumentId: string };
await assert.rejects(() => client.mutation("organizationSetup:recordIncorporation", {
  societyId, certificateDocumentId: draft.draftDocumentId, certificateDate: "2026-02-01", incorporationNumber: "1234567-8",
}), /generated draft|uploaded file/);
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(stepState(progress, "articles"), "in_progress", "the generated articles worksheet counts as started");
const certificateId = await client.mutation("documents:create", { societyId, title: "Certificate of incorporation", category: "governance", fileName: "certificate.pdf", mimeType: "application/pdf", tags: ["certificate"] }) as string;
await assert.rejects(() => client.mutation("organizationSetup:recordIncorporation", {
  societyId, certificateDocumentId: certificateId, certificateDate: "2026-02-01", incorporationNumber: "1234567-8",
}), /uploaded file/);
await client.mutation("documentVersions:recordUploadedVersion", { societyId, documentId: certificateId, storageProvider: "local-filesystem", storageKey: `test-fixtures/${societyId}/certificate.pdf`, fileName: "certificate.pdf", mimeType: "application/pdf", fileSizeBytes: 32, sha256: "b".repeat(64) });
await assert.rejects(() => client.mutation("organizationSetup:recordIncorporation", {
  societyId, certificateDocumentId: certificateId, certificateDate: "2026-02-01", incorporationNumber: "  ",
}), /number shown on the certificate/);
await assert.rejects(() => client.mutation("organizationSetup:recordIncorporation", {
  societyId, certificateDocumentId: certificateId, certificateDate: "2026-02-30", incorporationNumber: "1234567-8",
}), /valid date/);
assert.equal(await client.mutation("organizationSetup:recordIncorporation", {
  societyId, certificateDocumentId: certificateId, certificateDate: "2026-02-01", incorporationNumber: "1234567-8",
}), "incorporated");
profile = await client.query("society:getById", { id: societyId });
assert.equal(profile.formationStatus, "incorporated");
assert.equal(profile.organizationStatus, "active");
assert.equal(profile.incorporationNumber, "1234567-8");
assert.equal(profile.incorporationDate, "2026-02-01");
assert.equal(profile.anniversaryDate, "2026-02-01");
assert.equal(profile.certificateDate, "2026-02-01");
assert.equal(profile.certificateReference, "1234567-8", "the reference defaults to the number");
assert.equal(profile.certificateEvidenceDocumentId, certificateId);
const home = client.exportLocalWorkspaceSnapshot().tables.organizationRegistrations.find((row: any) => row.societyId === societyId && row.registrationType === "home");
assert.equal(home.status, "active");
assert.equal(home.registrationNumber, "1234567-8");
assert.equal(home.registrationDate, "2026-02-01");
progress = await client.query("organizationSetup:progress", { societyId }) as OrganizationSetupProgress;
assert.equal(progress.variant, "corporation_preparing");
assert.equal(progress.currentPhase, "organize");
assert.equal(stepState(progress, "certificate"), "done");
assert.equal(progress.phases.find((phase) => phase.key === "maintain")?.status, "ongoing");
await assert.rejects(() => client.mutation("organizationSetup:markSubmitted", { societyId, undo: true }), /Only a filing marked as submitted/);
const activity = client.exportLocalWorkspaceSnapshot().tables.activity.filter((row: any) => row.societyId === societyId && /^Setup:/.test(row.summary));
assert.ok(activity.length >= 6, "each setup action writes an activity row");
console.log("Organization setup lifecycle: one setup task, progress from records, skip decisions, filed/undo and certificate recording passed.");

/* ---------------- Permissions and cross-workspace isolation ---------------- */
for (const name of ["organizationSetup:decideStep", "organizationSetup:markSubmitted", "organizationSetup:recordIncorporation"]) {
  assert.equal(actionPermission(name, "mutation"), "society:write");
}
assert.equal(actionPermission("organizationSetup:progress", "query"), "society:read");

const issuer = betterAuthIssuer();
const preparing = { name: "Gate Corp.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", formationStatus: "preparing", organizationStatus: "pre_incorporation", isCharity: false, isMemberFunded: false };
const db = new MemoryDb({ seed: {
  societies: [{ _id: "company", ...preparing }, { _id: "other", ...preparing, name: "Other Corp." }],
  users: [
    ...ROLES.map((role) => ({ _id: role, societyId: "company", role, status: "Active", displayName: role, authSubject: role, authProvider: "better-auth", authIssuer: issuer })),
    { _id: "foreign", societyId: "other", role: "Owner", status: "Active", displayName: "Foreign", authSubject: "foreign", authProvider: "better-auth", authIssuer: issuer },
  ],
  documents: [{ _id: "foreignCertificate", societyId: "other", title: "Other certificate", storageId: "blob-1" }],
  roleHolders: [{ _id: "secretController", societyId: "company", roleType: "controller", status: "current", fullName: "Hidden Controller" }],
} });
let principal: PortablePrincipal = { kind: "user", runtime: "test", assurance: "verified-jwt", subject: "Owner", issuer, authProvider: "better-auth" };
const as = (subject: string) => { principal = { kind: "user", runtime: "test", assurance: "verified-jwt", subject, issuer, authProvider: "better-auth" }; };
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal })
  .register(definePortableQuery({ name: "organizationSetup:progress", handler: progressPortable }))
  .register(definePortableMutation({ name: "organizationSetup:decideStep", handler: decideStepPortable }))
  .register(definePortableMutation({ name: "organizationSetup:markSubmitted", handler: markSubmittedPortable }))
  .register(definePortableMutation({ name: "organizationSetup:recordIncorporation", handler: recordIncorporationPortable }));

for (const role of ["Director", "Member", "Viewer"]) {
  as(role);
  const visible = await runtime.runQuery<OrganizationSetupProgress>("organizationSetup:progress", { societyId: "company" });
  assert.equal(visible.variant, "corporation_preparing", `${role} can read progress`);
  await assert.rejects(() => runtime.runMutation("organizationSetup:decideStep", { societyId: "company", stepKey: "isc", decision: "later" }), /Permission society:write required/);
  await assert.rejects(() => runtime.runMutation("organizationSetup:markSubmitted", { societyId: "company" }), /Permission society:write required/);
  await assert.rejects(() => runtime.runMutation("organizationSetup:recordIncorporation", { societyId: "company", certificateDocumentId: "foreignCertificate", certificateDate: "2026-02-01", incorporationNumber: "1" }), /Permission society:write required/);
}
assert.equal((await db.get("company"))?.formationStatus, "preparing", "denied mutations change nothing");
// A member can't read the significant-control register, so the count stays hidden.
as("Member");
const memberView = await runtime.runQuery<OrganizationSetupProgress>("organizationSetup:progress", { societyId: "company" });
assert.equal(stepState(memberView, "isc"), "restricted");
as("Owner");
assert.equal(stepState(await runtime.runQuery<OrganizationSetupProgress>("organizationSetup:progress", { societyId: "company" }), "isc"), "done");
// Another workspace's owner can't read or change this one, and this owner can't use the other's document.
as("foreign");
await assert.rejects(() => runtime.runQuery("organizationSetup:progress", { societyId: "company" }), /not found|not a member|required/i);
await assert.rejects(() => runtime.runMutation("organizationSetup:markSubmitted", { societyId: "company" }), /not found|not a member|required/i);
as("Owner");
await assert.rejects(() => runtime.runMutation("organizationSetup:recordIncorporation", { societyId: "company", certificateDocumentId: "foreignCertificate", certificateDate: "2026-02-01", incorporationNumber: "1" }), /not found/);
await assert.rejects(() => runtime.runMutation("organizationSetup:decideStep", { societyId: "other", stepKey: "isc", decision: "later" }), /not found|not a member|required/i);
assert.equal((await db.get("other"))?.setupStepDecisions, undefined);
assert.equal(await runtime.runMutation("organizationSetup:markSubmitted", { societyId: "company" }), "submitted");
console.log("Organization setup permissions: read for every role, society:write for changes, no cross-workspace reads, writes or documents.");
