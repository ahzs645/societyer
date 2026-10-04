import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableMutationCtx, toPortableQueryCtx } from "../convex/lib/portable";
import { overviewPortable as minuteBook } from "../shared/functions/minuteBook";
import { overviewPortable as registers, promoteBoardRoleToDirectorPortable, updateReviewPortable } from "../shared/functions/evidenceRegisters";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import { seedRegisterProjection } from "./fixtures/registerProjection";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./minuteBook.js": () => import("../convex/minuteBook"),
  "./evidenceRegisters.js": () => import("../convex/evidenceRegisters"),
} as any);
const fixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Register projection authority", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert("societies", { name: "Foreign register projection", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ["Owner", "Admin", "Director", "Viewer", "Member"]) users[role] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: role, email: `${role}@example.test`, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  return { societyId, foreignId, users, ...await seedRegisterProjection(ctx, societyId, "qualification-native") };
});
const actors = Object.fromEntries(Object.keys(fixture.users).map(role => [role, test.withIdentity({ issuer, subject: role })]));
for (const role of ["Owner", "Admin", "Director", "Viewer"]) {
  const binder = await actors[role].query(api.minuteBook.overview, { societyId: fixture.societyId });
  assert.equal(binder.financials.length, 1); assert.equal(binder.filings.length, 1); assert.equal(binder.proxies.length, 1);
  assert.deepEqual(binder.restrictedResources, []);
  const ledger = await actors[role].query(api.evidenceRegisters.overview, { societyId: fixture.societyId });
  assert.equal(ledger.boardRoleAssignments.length, 1);
  assert.equal(ledger.budgetSnapshots.length, ["Owner", "Admin"].includes(role) ? 2 : 1);
  assert.equal(ledger.budgetSnapshotLines.length, ["Owner", "Admin"].includes(role) ? 2 : 1);
  assert.equal(ledger.financialStatementImports.length, ["Owner", "Admin"].includes(role) ? 2 : 1);
  assert.equal(ledger.financialStatementImportLines.length, ["Owner", "Admin"].includes(role) ? 2 : 1);
  assert.equal(ledger.sourceEvidence.length, ["Owner", "Admin"].includes(role) ? 2 : 1);
  if (!["Owner", "Admin"].includes(role)) assert.ok(!JSON.stringify(ledger).includes("restricted source"), "Inherited source ACL also hides register notes and child lines");
}
const memberBinder = await actors.Member.query(api.minuteBook.overview, { societyId: fixture.societyId });
const memberRegisters = await actors.Member.query(api.evidenceRegisters.overview, { societyId: fixture.societyId });
assert.equal(memberBinder.items.length, 1); assert.equal(memberBinder.meetings.length, 1); assert.equal(memberBinder.documents.length, 1);
for (const field of ["financials", "filings", "proxies"]) assert.deepEqual(memberBinder[field], [], field);
for (const resource of ["financials", "filings", "proxies"]) assert.ok(memberBinder.restrictedResources.includes(resource));
for (const field of ["boardRoleAssignments", "boardRoleChanges", "budgetSnapshots", "budgetSnapshotLines"]) assert.deepEqual(memberRegisters[field], [], field);
assert.equal(memberRegisters.sourceEvidence.length, 1); assert.equal(memberRegisters.signingAuthorities.length, 1);
assert.ok(!JSON.stringify([memberBinder, memberRegisters]).includes("forbidden"));
assert.ok(!JSON.stringify([memberBinder, memberRegisters]).includes("restricted source"));
assert.ok(!memberBinder.checks.some((check: any) => check.key === "open_filings"));
await test.run(async native => {
  const portable = await toPortableQueryCtx(native);
  const scoped = (scopes: string[]) => ({ ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "projection-service", societyId: String(fixture.societyId), actorUserId: String(fixture.users.Owner), scopes } });
  const minuteOnly = await minuteBook(scoped(["minutes:read"]), { societyId: String(fixture.societyId) });
  assert.equal(minuteOnly.items.length, 1); assert.deepEqual(minuteOnly.meetings, []); assert.deepEqual(minuteOnly.documents, []); assert.deepEqual(minuteOnly.checks, []);
  const docsOnly = await registers(scoped(["documents:read"]), { societyId: String(fixture.societyId) });
  assert.equal(docsOnly.sourceEvidence.length, 2); assert.deepEqual(docsOnly.boardRoleAssignments, []); assert.deepEqual(docsOnly.budgetSnapshots, []);
  await requireFunctionAction(scoped(["documents:read"]), "evidenceRegisters:overview", "query", { societyId: String(fixture.societyId) });
  await assert.rejects(() => requireFunctionAction(scoped(["financials:read"]), "evidenceRegisters:overview", "query", { societyId: String(fixture.societyId) }), /Service scope documents:read required/);
  const financeOnly = await registers(scoped(["documents:read", "financials:read"]), { societyId: String(fixture.societyId) });
  assert.equal(financeOnly.budgetSnapshots.length, 2); assert.equal(financeOnly.sourceEvidence.length, 2);
  const docsBinder = await minuteBook(scoped(["documents:read", "minutes:read"]), { societyId: String(fixture.societyId) });
  assert.ok(!docsBinder.checks.some((check: any) => check.key === "meeting_minutes_gap"));
  const mutation = await toPortableMutationCtx(native);
  const reviewOnly = { ...mutation, principal: scoped(["documents:write"]).principal };
  await assert.rejects(() => promoteBoardRoleToDirectorPortable(reviewOnly, { assignmentId: fixture.assignment }), /Service scope directors:write required/);
  await assert.rejects(() => updateReviewPortable(reviewOnly, { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" }), /Service scope financials:write required/);
  const memberService = { ...scoped(["*"]), principal: { ...scoped(["*"]).principal, actorUserId: String(fixture.users.Member) } };
  assert.deepEqual((await registers(memberService, { societyId: String(fixture.societyId) })).budgetSnapshots, [], "Wildcard service scope never increases the current actor's role grants");
  const broken = new Proxy(portable.db, { get(target, key) { if (key === "query") return () => { throw new Error("Unexpected projection database failure"); }; return Reflect.get(target, key); } });
  await assert.rejects(() => registers({ ...scoped(["documents:read"]), db: broken }, { societyId: String(fixture.societyId) }), /Unexpected projection database failure/);
});
for (const actor of [actors.Member, actors.Viewer, actors.Director]) {
  await assert.rejects(() => actor.mutation(api.evidenceRegisters.promoteBoardRoleToDirector, { assignmentId: fixture.assignment }), /Permission .*:write required/);
  await assert.rejects(() => actor.mutation(api.evidenceRegisters.updateReview, { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" }), /Permission .*:write required/);
  await assert.rejects(() => actor.mutation(api.evidenceRegisters.finishFinancePaperlessReview, { societyId: fixture.societyId }), /Permission .*:write required/);
}
await test.run(async ctx => {
  assert.equal((await ctx.db.get(fixture.assignment))?.directorId, undefined);
  assert.equal((await ctx.db.get(fixture.budgets[0] as any))?.status, "NeedsReview");
});
for (const role of ["Owner", "Admin"]) {
  await actors[role].mutation(api.evidenceRegisters.promoteBoardRoleToDirector, { assignmentId: fixture.assignment });
  await actors[role].mutation(api.evidenceRegisters.updateReview, { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" });
  await actors[role].mutation(api.evidenceRegisters.finishFinancePaperlessReview, { societyId: fixture.societyId });
}
const evidence = await actors.Director.mutation(api.evidenceRegisters.createManual, { societyId: fixture.societyId, kind: "boardRoleAssignment", payload: { personName: "Director document-review evidence" } });
await actors.Director.mutation(api.evidenceRegisters.updateReview, { table: "boardRoleAssignments", id: evidence, notes: "Legitimate document evidence review" });
await assert.rejects(() => actors.Director.mutation(api.evidenceRegisters.updateReview, { table: "sourceEvidence", id: fixture.evidence[1], notes: "Denied source edit" }), /not found/);
const safe = await actors.Director.mutation(api.evidenceRegisters.finishSafePaperlessReview, { societyId: fixture.societyId });
assert.deepEqual(safe.restrictedResources, ["financials"]);
assert.equal(safe.restrictedDocumentEvidence, true);
await test.run(async ctx => assert.equal((await ctx.db.get(fixture.evidence[1] as any))?.notes, undefined));
for (const read of [api.minuteBook.overview, api.evidenceRegisters.overview]) {
  await assert.rejects(() => actors.Owner.query(read, { societyId: fixture.foreignId }), /membership|not found|not authorized/i);
  await assert.rejects(() => test.query(read, { societyId: fixture.societyId }), /principal|authentication|authorized/i);
}
// A private core document is inaccessible evidence, never a proven missing record.
const coreFixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Core ACL completeness", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ["Owner", "Viewer"]) await ctx.db.insert("users", { societyId, role, status: "Active", displayName: role, email: `${role}-core@example.test`, authIssuer: issuer, authSubject: `${role}-core`, createdAtISO: new Date().toISOString() });
  const documentId = await ctx.db.insert("documents", { societyId, title: "Private core qualification", category: "Constitution", tags: [], flaggedForDeletion: false, createdAtISO: new Date().toISOString() });
  return { societyId, documentId };
});
for (const role of ["Owner", "Viewer"]) {
  const binder = await test.withIdentity({ issuer, subject: `${role}-core` }).query(api.minuteBook.overview, { societyId: coreFixture.societyId });
  const core = binder.checks.find((row: any) => row.key === "missing_core_documents");
  assert.deepEqual(binder.restrictedResources, []);
  if (role === "Owner") {
    assert.equal(binder.documentCoverageLimited, false); assert.equal(binder.documents.length, 1);
    assert.equal(core?.count, 2); assert.equal(core?.detail, "Bylaws, Minutes"); assert.equal(core?.status, undefined);
  } else {
    assert.equal(binder.documentCoverageLimited, true); assert.equal(binder.documents.length, 0);
    assert.equal(core?.status, "unknown"); assert.equal(core?.count, null); assert.equal(core?.ok, null);
    assert.equal(core?.label, "Core document completeness"); assert.equal(core?.severity, "info");
    assert.ok(!JSON.stringify(binder).includes("Private core qualification"));
    for (const row of binder.checks.filter((check: any) => ["missing_core_documents", "missing_signatures", "policy_adoption_gaps", "paper_archive_gap", "policy_review_gaps"].includes(check.key))) assert.equal(row.status, "unknown");
  }
}
const aclBinder = await actors.Viewer.query(api.minuteBook.overview, { societyId: fixture.societyId });
assert.equal(aclBinder.documentCoverageLimited, true, "Inherited linked-row ACL also marks supporting coverage limited");
for (const bundle of aclBinder.recordBundles) {
  assert.equal(bundle.documentCoverageLimited, true);
  for (const gap of bundle.gaps.filter((gap: any) => ["minutes_source_gap", "materials_gap", "filing_evidence_gap", "policy_document_gap", "policy_review_gap", "policy_signature_gap", "written_resolution_signature_gap", "financials_statement_gap"].includes(gap.key))) {
    assert.equal(gap.status, "unknown"); assert.equal(gap.severity, "info");
  }
}
console.log("Register authority passed: role and service projections, restricted source/child ACL, ACL-limited core/document checks and bundle gaps, exact operational write gates, legitimate Director evidence review, cross-workspace/anonymous denial and unexpected errors preserved.");
