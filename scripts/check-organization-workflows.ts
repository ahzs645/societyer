import assert from "node:assert/strict";
import { resolveOrganizationContext, assertBusinessCorporationAction, assertOfficialReceiptOrganization } from "../shared/organization/resolveContext";
import { assessOrganizationWorkflow } from "../shared/organization/assessWorkflow";
import type { OrganizationSource, OrganizationWorkflow } from "../shared/organization/types";
import { ROUTE_IDENTITY, routeAllowedForOrganization, routeAllowedForEntityKind } from "../src/lib/routeIdentity";
import { projectCharityRegistrationHistory, type CharityRegistrationRevision } from "../shared/receipting/registration";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, definePortableMutation, makeCapabilities, type TransactionalDb } from "../shared/portable/index";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { upsertRightsClassPortable } from "../shared/functions/rightsClasses";
import { upsertRightsholdingTransferPortable } from "../shared/functions/rightsholdingTransfers";
import { createPortable as createDividend, setStatusPortable as setDividendStatus } from "../shared/functions/dividends";

const society: OrganizationSource = { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", isMemberFunded: false };
const company: OrganizationSource = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act", legalSubtype: "ordinary_private_company" };
const nonprofit: OrganizationSource = { entityType: "corporation__nfp_", jurisdictionCode: "CA-FED", actFormedUnder: "canada_not_for_profit_corporations_act" };
const ontario: OrganizationSource = { ...company, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", legalSubtype: undefined };
const conflict: OrganizationSource = { ...company, actFormedUnder: "societies_act" };
const assess = (organization: OrganizationSource, action: OrganizationWorkflow) => assessOrganizationWorkflow(resolveOrganizationContext(organization), action);

assert.equal(assess(society, "members.record").readiness, "ready");
assert.equal(assess(society, "shares.record").applicability, "not_applicable");
assert.equal(assess(company, "members.record").applicability, "not_applicable");
assert.equal(assess(company, "shares.record").readiness, "ready");
assert.equal(assess(nonprofit, "members.record").coverage, "records_only");
assert.equal(assess(nonprofit, "members.record").readiness, "ready", "unsupported CNCA guidance does not prevent member records");
assert.equal(assess(nonprofit, "shares.record").applicability, "not_applicable");
assert.equal(assess(nonprofit, "governance.review").readiness, "needs_review");
assert.equal(resolveOrganizationContext(nonprofit).governanceProfile, undefined);
assert.equal(resolveOrganizationContext({ ...nonprofit, jurisdictionCode: "CA-FED-CBCA" }).identity.jurisdictionCode, "CA-FED", "legacy Act-specific code normalizes to formation place");
assert.equal(resolveOrganizationContext({ ...nonprofit, jurisdictionCode: "CA-FED-CBCA" }).governanceProfile, undefined, "normalization does not confer CBCA rules on a nonprofit");

assert.equal(assess(ontario, "governance.review").readiness, "ready");
assert.equal(assess(ontario, "incorporation.prepare").coverage, "unavailable");
assert.equal(assess(ontario, "incorporation.prepare").readiness, "needs_review", "a supported ongoing profile does not enable incorporation preparation");
assert.equal(assess({ ...company, legalSubtype: "benefit_company" }, "incorporation.prepare").readiness, "needs_review");
assert.equal(assess({ ...society, isMemberFunded: true, legalSubtype: "member_funded_society" }, "governance.review").readiness, "needs_review", "a member-funded checkbox is not reviewed exception evidence");
assert.equal(assess({ ...company, distributing: true }, "incorporation.prepare").readiness, "needs_review");

for (const incomplete of [{}, { ...society, jurisdictionCode: undefined }, { ...society, actFormedUnder: undefined }, { ...society, jurisdictionCode: "unknown" }]) {
  assert.equal(resolveOrganizationContext(incomplete).governanceProfile, undefined, "new action assessment does not use historical BC fallback");
  assert.equal(assess(incomplete, "governance.review").readiness, "needs_information");
}
for (const contradictory of [conflict, { ...society, homeJurisdictionCode: "CA-ON" }, { ...society, kind: "corporation" }, { ...company, jurisdictionCode: "US-CA" }]) {
  assert.equal(resolveOrganizationContext(contradictory).identity.status, "conflict");
  assert.equal(assess(contradictory, "shares.record").readiness, "needs_review");
  assert.throws(() => assertBusinessCorporationAction(contradictory), /recorded business-corporation identity/);
}
assert.equal(resolveOrganizationContext({ ...ontario, homeJurisdictionCode: "CA-ON" }).identity.status, "recorded", "same place in a legacy alias is not a conflict");
assert.equal(resolveOrganizationContext({ ...society, isCharity: false }).legacyClaims.charityStatus, undefined, "false remains a legacy claim, not confirmed nonregistration");
const cooperative = { entityType: "cooperative", jurisdictionCode: "CA-BC" };
assert.equal(resolveOrganizationContext(cooperative).governanceModel, "cooperative");
assert.equal(assess(cooperative, "members.record").readiness, "ready");
assert.equal(assess(cooperative, "shares.record").applicability, "undetermined", "cooperatives are not assumed universally non-share");
assert.match(assess(cooperative, "shares.record").reasons[0].message, /may have its own membership and share structure/);

for (const form of ["sole_proprietorship", "partnership", "unincorporated_association"]) {
  assert.equal(assess({ entityType: form, jurisdictionCode: "CA-BC" }, "incorporation.prepare").applicability, "not_applicable", "unincorporated records do not need an incorporation certificate");
}

// Explicit form-aware route checks are shared by the sidebar, command palette,
// breadcrumbs and direct-URL guard. Shared rights records remain reachable.
for (const path of ["/app/members", "/app/membership"]) {
  assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY[path], nonprofit), true, path);
  assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY[path], company), false, path);
  assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY[path], {}), false, path);
}
for (const path of ["/app/dividends", "/app/certificate-register", "/app/significant-individuals"]) {
  for (const org of [society, nonprofit, cooperative, {}, conflict, undefined]) assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY[path], org), false, path);
  assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY[path], company), true, path);
}
assert.equal(routeAllowedForEntityKind({ entityKinds: ["corporation"] }, "organization"), false);
assert.equal(routeAllowedForEntityKind({ entityKinds: ["corporation"] }, undefined), false);
assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY["/app/rights-ledger"], society), true, "membership classes stay available");
assert.equal(routeAllowedForOrganization(ROUTE_IDENTITY["/app/receipts"], company), true, "acknowledgements are activity-based; official issuance has its own gate");

// Registration is independent of legal form; pending, stale, incomplete and
// conflicted evidence cannot become an organization-side receipting permission.
const applied: CharityRegistrationRevision = {
  _id: "reg-1", societyId: "org", registrationType: "CA-CRA-CHARITY", revisionNumber: 1,
  status: "applied", evidenceReviewed: false, evidenceDocumentIds: [], recordedByUserId: "owner", recordedAtISO: "2026-01-01T12:00:00Z",
};
const registered: CharityRegistrationRevision = {
  ...applied, _id: "reg-2", revisionNumber: 2, supersedesId: applied._id, status: "registered", evidenceReviewed: true,
  charityNumber: "123456789RR0001", registeredName: "Harbour Community Society", registeredAddress: "10 Example Street, Vancouver, BC",
  effectiveFrom: "2026-04-01", evidenceDocumentIds: ["decision"], evidenceSnapshots: [{ documentId: "decision", fingerprint: "a".repeat(64) }], reviewedByUserId: "reviewer", reviewedAtISO: "2026-04-20T12:00:00Z",
};
const receiptAssessment = (history: CharityRegistrationRevision[], onDate = "2026-11-07", source: OrganizationSource = society) => assessOrganizationWorkflow(resolveOrganizationContext(source), "official_receipt.prepare", { charityRegistrations: history, onDate });
assert.equal(receiptAssessment([]).readiness, "blocked");
assert.equal(receiptAssessment([applied]).readiness, "blocked");
assert.equal(receiptAssessment([applied, { ...registered, evidenceReviewed: false }]).readiness, "blocked");
assert.equal(receiptAssessment([applied, registered], "2026-03-31").readiness, "blocked");
assert.equal(receiptAssessment([applied, { ...registered, supersedesId: "elsewhere" }]).readiness, "needs_review");
const readyRegistration = receiptAssessment([applied, registered]);
assert.equal(readyRegistration.applicability, "applies");
assert.equal(readyRegistration.readiness, "needs_information", "organization approval is not gift eligibility or a signed receipt");
assert.equal(readyRegistration.reasons[0].code, "GIFT_REVIEW_REQUIRED");
assert.deepEqual(readyRegistration.evidenceIds, ["decision"]);
const redacted = assessOrganizationWorkflow(resolveOrganizationContext(society), "official_receipt.prepare", {
  charityRegistrations: projectCharityRegistrationHistory([applied, registered]), onDate: "2026-11-07",
});
assert.equal(redacted.readiness, readyRegistration.readiness);
assert.deepEqual(redacted.evidenceIds, [], "public profile assessment does not reveal document identifiers");
assert.equal(receiptAssessment([applied, registered], "2026-11-07", { ...society, isMemberFunded: true }).readiness, "needs_review");
assert.equal(receiptAssessment([applied, registered], "2026-11-07", { ...society, isMemberFunded: false, legalSubtype: "member_funded_society" }).readiness, "needs_review");
assert.throws(() => assertOfficialReceiptOrganization({ ...society, isMemberFunded: false, legalSubtype: "member_funded_society" }), /member-funded claim/);
assert.throws(() => assertOfficialReceiptOrganization(conflict), /governing Act does not match/);
assert.equal(assess(society, "donation.acknowledge").readiness, "ready");
assert.ok(!("authorized" in readyRegistration), "the pure organization assessment does not grant actor permissions");

// Direct API writes must enforce the same legal-form boundary even with no UI.
// Test both portable databases, preserving historical rows and rollback on rejection.
function runtime(db: TransactionalDb) {
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
    .register(definePortableMutation({ name: "legalOperations:upsertRightsClass", handler: upsertRightsClassPortable }))
    .register(definePortableMutation({ name: "legalOperations:upsertRightsholdingTransfer", handler: upsertRightsholdingTransferPortable }))
    .register(definePortableMutation({ name: "dividends:create", handler: createDividend }))
    .register(definePortableMutation({ name: "dividends:setStatus", handler: setDividendStatus }));
}
const dividendArgs = { declaredOn: "2026-11-01", shareClass: "Common", perShareAmount: "0.25", sharesOutstanding: 100, currency: "CAD", nowISO: "2026-11-07T12:00:00Z" };
for (const backend of ["memory", "local"] as const) {
  for (const source of [society, nonprofit, cooperative, {}, conflict]) {
    const societyId = "organization-test";
    const seed = {
      ...portableTestSeed(societyId), societies: [{ _id: societyId, name: "Example organization", ...source }],
      rightsClasses: [{ _id: "legacy-share", societyId, className: "Legacy share entry", classType: "share", status: "active" }],
      dividends: [{ _id: "legacy-dividend", societyId, ...dividendArgs, status: "draft" }],
    };
    const db = backend === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
    const rt = runtime(db);
    const before = await db.query("rightsClasses").collect();
    await assert.rejects(rt.runMutation("legalOperations:upsertRightsClass", { societyId, className: "Common", classType: "share", status: "active" }), /recorded business-corporation identity/);
    await assert.rejects(rt.runMutation("legalOperations:upsertRightsholdingTransfer", { societyId, transferType: "issuance", status: "posted", rightsClassId: "legacy-share", destinationHolderName: "Example", quantity: 10, transferDate: "2026-11-01" }), /recorded business-corporation identity/);
    await assert.rejects(rt.runMutation("dividends:create", { societyId, ...dividendArgs }), /recorded business-corporation identity/);
    await assert.rejects(rt.runMutation("dividends:setStatus", { id: "legacy-dividend", status: "declared", solvencyConfirmedAt: "2026-11-01", solvencyBasis: "Example", nowISO: dividendArgs.nowISO }), /recorded business-corporation identity/);
    assert.deepEqual(await db.query("rightsClasses").collect(), before, "rejected share operations write nothing");
    assert.deepEqual(await db.query("rightsholdingTransfers").collect(), []);
    assert.deepEqual(await db.query("rightsHoldings").collect(), []);
    assert.equal((await db.query("dividends").collect()).length, 1, "the historical declaration is preserved");
    await rt.runMutation("dividends:setStatus", { id: "legacy-dividend", status: "cancelled", nowISO: dividendArgs.nowISO });
    assert.equal((await db.get("legacy-dividend", "dividends"))?.status, "cancelled", "historical declarations remain correctable by cancellation");
    const membershipId = await rt.runMutation("legalOperations:upsertRightsClass", { societyId, className: "Regular members", classType: "membership", status: "active" });
    assert.equal((await db.get(String(membershipId), "rightsClasses"))?.classType, "membership", "shared member classes are not blocked by a company guard");
  }
  const societyId = "business-test";
  const seed = { ...portableTestSeed(societyId), societies: [{ _id: societyId, name: "Example company", ...company }] };
  const db = backend === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const rt = runtime(db);
  const classId = await rt.runMutation("legalOperations:upsertRightsClass", { societyId, className: "Common", classType: "share", status: "active" });
  const transfer = { societyId, transferType: "issuance", status: "posted", rightsClassId: classId, destinationHolderName: "Example shareholder", quantity: 10, transferDate: "2026-11-01" };
  await assert.rejects(rt.runMutation("legalOperations:upsertRightsholdingTransfer", transfer), /consideration|fully paid/, "the new form gate does not replace existing statutory checks");
  await rt.runMutation("legalOperations:upsertRightsholdingTransfer", { ...transfer, considerationType: "cash", fullyPaidConfirmedAt: "2026-11-01" });
  assert.equal((await db.query("rightsHoldings").collect())[0]?.quantity, 10);
  await rt.runMutation("dividends:create", { societyId, ...dividendArgs });
  assert.equal((await db.query("dividends").collect()).length, 1);
}

console.log("Organization workflow checks passed: explicit identity, independent coverage/readiness, nonprofit member routes, dated charity evidence, and company-only writes on both portable databases.");
