// Share ledger rules for corporations: class votes count non-voting shares,
// deleting or voiding a posted entry re-validates the ledger, structured
// share-class rights, the redemption flow, issuance/transfer posting gates,
// certificate integrity, holdingsAsOf and same-day sequence.
// Synthetic fixtures only.

import assert from "node:assert/strict";
import { convexTest } from "convex-test";

import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  MemoryDb,
  PortableRuntime,
  definePortableMutation,
  definePortableQuery,
  makeCapabilities,
} from "../shared/portable/index";
import {
  compareLedgerEntries,
  holdingsAsOf,
  ledgerPostingIssues,
  shareClassRightsIssues,
  sharesUnderRedemptionNotice,
  validateLedger,
  type RightsholdingTransferRecord,
} from "../shared/equityLedger";
import {
  removeRightsholdingTransferPortable,
  upsertRightsholdingTransferPortable,
} from "../shared/functions/rightsholdingTransfers";
import { upsertRightsClassPortable } from "../shared/functions/rightsClasses";
import * as certificateFns from "../shared/functions/shareCertificates";
import { certificateConservationIssues, duplicateCertificateNumber, reconcileCertificatesWithLedger } from "../shared/shareCertificates";
import { buildShareholderElectorate, classSeparateResolutionNote } from "../shared/shareholderElectorate";
import { corporateElectionPreview } from "../shared/functions/electionElectorate";
import { transferConsentRequired } from "../shared/operativeArticles";
import { FAMILY_HOLDING_COMPANY_PRESET } from "../shared/shareClassPresets";
import { CORPORATE_LEGAL_SOURCES } from "../shared/corporateLegalSources";
import { PORTABLE_TEST_AUTH_SUBJECT, PORTABLE_TEST_IDENTITY, portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

const iso = "2026-01-01T00:00:00.000Z";
const base = { societyId: "s", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso };
const row = (fields: Partial<RightsholdingTransferRecord>): RightsholdingTransferRecord => ({ ...base, transferType: "issuance", status: "posted", ...fields } as RightsholdingTransferRecord);

// --- holdingsAsOf and same-day sequence ------------------------------------------
{
  const issuance = { ...row({ transferType: "issuance", transferDate: "2026-02-01", rightsClassId: "c", destinationHolderName: "Holder A", quantity: 100, sequence: 0 }), _creationTime: 2 };
  const transfer = { ...row({ transferType: "transfer", transferDate: "2026-02-01", rightsClassId: "c", sourceHolderName: "Holder A", destinationHolderName: "Holder B", quantity: 40, sequence: 1 }), _creationTime: 1 };
  const byCreation = [transfer, issuance].sort((a, b) => a._creationTime - b._creationTime);
  assert.throws(() => validateLedger(byCreation), /exceeds source balance/, "creation order alone posts the transfer first");
  const sequenced = [transfer, issuance].sort(compareLedgerEntries);
  assert.deepEqual(sequenced.map((r) => r.transferType), ["issuance", "transfer"], "sequence orders same-day rows");
  validateLedger(sequenced);
  const unsequenced = { ...row({ transferType: "issuance", transferDate: "2026-02-01", rightsClassId: "c", destinationHolderName: "Holder C", quantity: 1 }), _creationTime: 0 };
  assert.equal([unsequenced, transfer, issuance].sort(compareLedgerEntries)[2], unsequenced, "rows without a sequence follow sequenced rows on the same date");
  const later = row({ transferType: "transfer", transferDate: "2026-03-01", rightsClassId: "c", sourceHolderName: "Holder B", destinationHolderName: "Holder A", quantity: 10 });
  const draft = row({ transferType: "issuance", status: "draft", transferDate: "2026-01-15", rightsClassId: "c", destinationHolderName: "Holder D", quantity: 5 });
  const all = [later, draft, transfer, issuance];
  assert.deepEqual(holdingsAsOf(all, "2026-01-31"), [], "nothing before the first posted row");
  assert.deepEqual(holdingsAsOf(all, "2026-02-01").map((h) => [h.holderKey, h.quantity]), [["name:Holder A", 60], ["name:Holder B", 40]], "end of the issue day includes the same-day transfer");
  assert.deepEqual(holdingsAsOf(all, "2026-03-01T12:00:00Z").map((h) => [h.holderKey, h.quantity]), [["name:Holder A", 70], ["name:Holder B", 30]]);
  assert.throws(() => holdingsAsOf(all, "March 2026"), /ISO date/);
}

// --- structured share-class rights -----------------------------------------------
{
  assert.deepEqual(shareClassRightsIssues({}), []);
  assert.deepEqual(shareClassRightsIssues({ dividendEntitlement: "discretionary_by_class", redemption: { byCompany: true, byHolder: false, priceCents: 1000, minNoticeDays: 10, nonProRataPermitted: true, includesDeclaredUnpaid: true }, liquidationRank: 1, maxAuthorized: 1000 }), []);
  assert.match(shareClassRightsIssues({ dividendEntitlement: "cumulative_fixed" }).join(" "), /needs the rate/, "cumulative needs a rate");
  assert.match(shareClassRightsIssues({ dividendEntitlement: "fixed_rate" }).join(" "), /needs the rate/, "fixed needs a rate");
  assert.deepEqual(shareClassRightsIssues({ dividendEntitlement: "cumulative_fixed", dividendRateBps: 500 }), []);
  assert.match(shareClassRightsIssues({ dividendEntitlement: "discretionary_by_class", dividendRateBps: 500 }).join(" "), /applies only/);
  assert.match(shareClassRightsIssues({ redemption: { byCompany: true, byHolder: false, priceCents: -1 } }).join(" "), /cannot be negative/);
  assert.match(shareClassRightsIssues({ redemption: { byCompany: false, byHolder: false, priceCents: 1000 } }).join(" "), /apply only to a class redeemable/);
  assert.match(shareClassRightsIssues({ parValueCents: 0 }).join(" "), /Par value/);
  assert.match(shareClassRightsIssues({ maxAuthorized: 2.5 }).join(" "), /whole number/);
  assert.match(shareClassRightsIssues({ liquidationRank: 0 }).join(" "), /starting at 1/);
  // The preset is valid, never claims a cumulative rate, and every redeemable class carries terms.
  for (const cls of FAMILY_HOLDING_COMPANY_PRESET.classes) assert.deepEqual(shareClassRightsIssues(cls), [], cls.className);
  assert.deepEqual(FAMILY_HOLDING_COMPANY_PRESET.classes.map((c) => c.votesPerShare), [1, 1, 0, 0]);
  assert.ok(FAMILY_HOLDING_COMPANY_PRESET.classes.every((c) => c.dividendEntitlement === "discretionary_by_class"));
}

// --- posting gates (pure) -------------------------------------------------------
{
  const bc = { isCorporation: true, isBcCompany: true, otherTransfers: [] as RightsholdingTransferRecord[] };
  const issue = row({ transferType: "issuance", transferDate: "2026-04-01", rightsClassId: "c", destinationHolderName: "Holder A", quantity: 10 });
  assert.match(ledgerPostingIssues(issue, bc).join(" "), /fully paid \(Business Corporations Act, s\. 64\(2\)\)/);
  assert.doesNotMatch(ledgerPostingIssues(issue, { ...bc, isBcCompany: false }).join(" "), /Business Corporations Act/, "no BC citation outside BC");
  assert.deepEqual(ledgerPostingIssues(issue, { ...bc, isCorporation: false }), [], "society ledgers are not gated");
  assert.deepEqual(ledgerPostingIssues({ ...issue, status: "draft" }, bc), [], "drafts are not gated");
  assert.deepEqual(ledgerPostingIssues({ ...issue, considerationType: "cash", fullyPaidConfirmedAt: "2026-04-01" }, bc), []);
  assert.deepEqual(ledgerPostingIssues({ ...issue, considerationType: "stock dividend" }, bc), [], "shares issued as a dividend are deemed fully paid (s. 65)");
  assert.match(ledgerPostingIssues({ ...issue, considerationType: "cash", fullyPaidConfirmedAt: "2026-04-02" }, bc).join(" "), /after the issue date/);
  assert.match(ledgerPostingIssues({ ...issue, considerationType: "cash", fullyPaidConfirmedAt: "2026-04-01", priceToOrganizationCents: 500 }, { ...bc, rightsClass: { parValueCents: 100, className: "Par shares" } }).join(" "), /at least its par value/);
  assert.match(ledgerPostingIssues({ ...issue, considerationType: "cash", fullyPaidConfirmedAt: "2026-04-01", priceToOrganizationCents: -1 }, bc).join(" "), /cannot be negative/);

  const transfer = row({ transferType: "transfer", transferDate: "2026-05-01", rightsClassId: "c", sourceHolderName: "Holder A", destinationHolderName: "Holder B", quantity: 5 });
  assert.match(ledgerPostingIssues(transfer, { ...bc, transferConsentRequired: true }).join(" "), /directors' consent/);
  assert.deepEqual(ledgerPostingIssues({ ...transfer, directorConsentDocumentId: "doc" }, { ...bc, transferConsentRequired: true }), []);
  assert.deepEqual(ledgerPostingIssues(transfer, bc), [], "no consent gate unless the articles require it");

  const issued = row({ transferType: "issuance", transferDate: "2026-04-01", rightsClassId: "c", destinationHolderName: "Holder A", quantity: 10, considerationType: "cash", fullyPaidConfirmedAt: "2026-04-01" });
  const notice = row({ transferType: "redemption", status: "draft", transferDate: "2026-05-20", redemptionNoticeDate: "2026-04-25", rightsClassId: "c", sourceHolderName: "Holder A", quantity: 8 });
  assert.deepEqual(sharesUnderRedemptionNotice([issued, notice], "c", "name:Holder A", "2026-05-01"), { quantity: 8, noticeDates: ["2026-04-25"] });
  assert.equal(sharesUnderRedemptionNotice([issued, notice], "c", "name:Holder A", "2026-04-24").quantity, 0, "before the notice");
  assert.match(ledgerPostingIssues(transfer, { ...bc, otherTransfers: [issued, notice] }).join(" "), /under a redemption notice dated 2026-04-25.*at most 2/);
  assert.deepEqual(ledgerPostingIssues({ ...transfer, quantity: 2 }, { ...bc, otherTransfers: [issued, notice] }), [], "free shares can still move");
  assert.deepEqual(ledgerPostingIssues(transfer, { ...bc, otherTransfers: [issued, { ...notice, status: "void" }] }), [], "a withdrawn (void) notice frees the shares");

  const redeemable = { className: "Class B", redemption: { byCompany: true, byHolder: false, priceCents: 1000, minNoticeDays: 10 } };
  const redemption = row({ transferType: "redemption", transferDate: "2026-05-20", rightsClassId: "c", sourceHolderName: "Holder A", quantity: 8 });
  assert.match(ledgerPostingIssues(redemption, { ...bc, rightsClass: { className: "Common" } }).join(" "), /not recorded as redeemable.*s\. 77\(a\)/);
  assert.match(ledgerPostingIssues(redemption, { ...bc, rightsClass: redeemable }).join(" "), /10 days' notice.*insolvent.*s\. 79/);
  assert.match(ledgerPostingIssues({ ...redemption, redemptionNoticeDate: "2026-05-15", solvencyConfirmedAt: "2026-05-19" }, { ...bc, rightsClass: redeemable }).join(" "), /5 days before/);
  assert.deepEqual(ledgerPostingIssues({ ...redemption, redemptionNoticeDate: "2026-05-10", solvencyConfirmedAt: "2026-05-19" }, { ...bc, rightsClass: redeemable }), []);
  assert.deepEqual(ledgerPostingIssues({ ...redemption, redemptionNoticeWaivedOn: "2026-05-18", solvencyConfirmedAt: "2026-05-19" }, { ...bc, rightsClass: redeemable }), [], "a recorded waiver satisfies notice");
  assert.match(ledgerPostingIssues({ ...redemption, redemptionNoticeWaivedOn: "2026-05-18", solvencyConfirmedAt: "2026-05-21" }, { ...bc, rightsClass: redeemable }).join(" "), /after the redemption date/);
}

// --- portable runtime: BC company workspace -------------------------------------
const bcCompany = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
const federal = { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" };
function seedFor(societyId: string, organization: Record<string, unknown>) {
  const seed = portableTestSeed(societyId);
  return {
    ...seed,
    societies: [{ ...seed.societies[0], name: `Synthetic ${societyId}`, ...organization }],
    roleHolders: ["Holder A", "Holder B"].map((fullName, index) => ({ _id: `${societyId}_h${index}`, societyId, fullName, roleType: "shareholder", status: "current" })),
    documents: [{ _id: `${societyId}_consent`, societyId, title: "Directors' consent to transfer" }],
  };
}
function runtime(seed: Record<string, any[]>) {
  const rt = new PortableRuntime({ db: new MemoryDb({ seed }), capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
    .register(definePortableMutation({ name: "transfer", handler: upsertRightsholdingTransferPortable }))
    .register(definePortableMutation({ name: "removeTransfer", handler: removeRightsholdingTransferPortable }))
    .register(definePortableMutation({ name: "upsertClass", handler: upsertRightsClassPortable }))
    .register(definePortableMutation({ name: "createCertificate", handler: certificateFns.createPortable }))
    .register(definePortableMutation({ name: "updateCertificate", handler: certificateFns.updatePortable }))
    .register(definePortableQuery({ name: "reconcile", handler: certificateFns.reconcilePortable }))
    .register(definePortableQuery({ name: "preview", handler: (ctx, args: any) => corporateElectionPreview(ctx, args.societyId, args.review) }))
    .register(definePortableQuery({ name: "rows", handler: async (ctx, args: any) => ctx.db.query(args.table).withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect() }));
  return {
    mutation: (name: string, args: Record<string, unknown>) => rt.runMutation<any>(name, args),
    query: (name: string, args: Record<string, unknown>) => rt.runQuery<any>(name, args),
  };
}

{
  const societyId = "bc_co";
  const rt = runtime(seedFor(societyId, bcCompany));
  const [holderA, holderB] = [`${societyId}_h0`, `${societyId}_h1`];
  await assert.rejects(rt.mutation("upsertClass", { societyId, className: "Bad", classType: "share", dividendEntitlement: "cumulative_fixed" }), /needs the rate/);
  await assert.rejects(rt.mutation("upsertClass", { societyId, className: "Bad", classType: "share", redemption: { byCompany: true, byHolder: false, priceCents: -5 } }), /cannot be negative/);
  const common = await rt.mutation("upsertClass", { societyId, className: "Common", classType: "share", votesPerShare: 1, maxAuthorized: 100 });
  const classB = await rt.mutation("upsertClass", { societyId, className: "Class B Non-Voting Preferred", classType: "share", votesPerShare: 0, dividendEntitlement: "discretionary_by_class", redemption: { byCompany: true, byHolder: false, priceCents: 1000, minNoticeDays: 10, nonProRataPermitted: true }, liquidationRank: 1, articlesPart: "Part 22", singularDescription: "Class B Non-Voting Preferred Share", pluralDescription: "Class B Non-Voting Preferred Shares" });
  const storedB = (await rt.query("rows", { table: "rightsClasses", societyId })).find((r: any) => r._id === classB);
  assert.equal(storedB.redemption.minNoticeDays, 10); assert.equal(storedB.articlesPart, "Part 22"); assert.equal(storedB.pluralDescription, "Class B Non-Voting Preferred Shares");

  const paid = { considerationType: "cash", status: "posted" };
  await assert.rejects(rt.mutation("transfer", { societyId, transferType: "issuance", status: "posted", transferDate: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 60 }), /fully paid \(Business Corporations Act, s\. 64\(2\)\)/, "issuance needs the fully-paid confirmation");
  const issueA = await rt.mutation("transfer", { societyId, ...paid, transferType: "issuance", transferDate: "2026-01-10", fullyPaidConfirmedAt: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 60 });
  await rt.mutation("transfer", { societyId, ...paid, transferType: "issuance", transferDate: "2026-01-10", fullyPaidConfirmedAt: "2026-01-09", rightsClassId: common, destinationRoleHolderId: holderB, quantity: 40 });
  await assert.rejects(rt.mutation("transfer", { societyId, ...paid, transferType: "issuance", transferDate: "2026-01-11", fullyPaidConfirmedAt: "2026-01-11", rightsClassId: common, destinationRoleHolderId: holderB, quantity: 1 }), /above its authorized maximum of 100/);
  await assert.rejects(rt.mutation("upsertClass", { id: common, societyId, className: "Common", classType: "share", votesPerShare: 1, maxAuthorized: 50 }), /100 shares of this class are already issued/);

  // Deleting or voiding a posted issuance that a later transfer depends on is refused.
  const transferAB = await rt.mutation("transfer", { societyId, status: "posted", transferType: "transfer", transferDate: "2026-02-01", rightsClassId: common, sourceRoleHolderId: holderA, destinationRoleHolderId: holderB, quantity: 50 });
  await assert.rejects(rt.mutation("removeTransfer", { id: issueA }), /Deleting this issuance dated 2026-01-10 would leave the ledger inconsistent: Transfer quantity 50 exceeds source balance 0/);
  await assert.rejects(rt.mutation("transfer", { id: issueA, societyId, ...paid, status: "void", transferType: "issuance", transferDate: "2026-01-10", fullyPaidConfirmedAt: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 60 }), /Voiding this issuance/);
  assert.equal((await rt.query("rows", { table: "rightsholdingTransfers", societyId })).length, 3, "refused delete leaves the row");
  await rt.mutation("removeTransfer", { id: transferAB });
  await rt.mutation("transfer", { id: issueA, societyId, ...paid, status: "void", transferType: "issuance", transferDate: "2026-01-10", fullyPaidConfirmedAt: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 60 });
  await rt.mutation("removeTransfer", { id: issueA });
  const commonHoldings = (await rt.query("rows", { table: "rightsHoldings", societyId })).filter((h: any) => h.rightsClassId === common);
  assert.deepEqual(commonHoldings.map((h: any) => h.quantity), [40], "holdings re-derived after the removals");

  // Redemption: notice outstanding freezes transfers; posted redemption returns shares to unissued capital.
  await rt.mutation("transfer", { societyId, ...paid, transferType: "issuance", transferDate: "2026-03-01", fullyPaidConfirmedAt: "2026-03-01", rightsClassId: classB, destinationRoleHolderId: holderA, quantity: 30 });
  const redemption = await rt.mutation("transfer", { societyId, transferType: "redemption", status: "draft", transferDate: "2026-04-20", redemptionNoticeDate: "2026-04-05", rightsClassId: classB, sourceRoleHolderId: holderA, quantity: 20, priceToVendorCents: 20000 });
  await assert.rejects(rt.mutation("transfer", { societyId, status: "posted", transferType: "transfer", transferDate: "2026-04-10", rightsClassId: classB, sourceRoleHolderId: holderA, destinationRoleHolderId: holderB, quantity: 15 }), /redemption notice dated 2026-04-05.*at most 10/);
  await rt.mutation("transfer", { societyId, status: "posted", transferType: "transfer", transferDate: "2026-04-10", rightsClassId: classB, sourceRoleHolderId: holderA, destinationRoleHolderId: holderB, quantity: 10 });
  const redemptionArgs = { id: redemption, societyId, transferType: "redemption", status: "posted", transferDate: "2026-04-20", redemptionNoticeDate: "2026-04-05", rightsClassId: classB, sourceRoleHolderId: holderA, quantity: 20, priceToVendorCents: 20000 };
  await assert.rejects(rt.mutation("transfer", redemptionArgs), /insolvent.*s\. 79/, "solvency confirmation required");
  await assert.rejects(rt.mutation("transfer", { ...redemptionArgs, redemptionNoticeDate: "2026-04-15", solvencyConfirmedAt: "2026-04-19" }), /5 days before/);
  await assert.rejects(rt.mutation("transfer", { ...redemptionArgs, rightsClassId: common, sourceRoleHolderId: holderB, solvencyConfirmedAt: "2026-04-19" }), /not recorded as redeemable/);
  await assert.rejects(rt.mutation("transfer", { ...redemptionArgs, quantity: 25, solvencyConfirmedAt: "2026-04-19" }), /Redemption quantity 25 exceeds source balance 20/, "the holder must have the shares");
  await rt.mutation("transfer", { ...redemptionArgs, solvencyConfirmedAt: "2026-04-19", solvencyBasis: "Interim balance sheet reviewed by the directors" });
  const stored = (await rt.query("rows", { table: "rightsholdingTransfers", societyId })).find((r: any) => r._id === redemption);
  assert.equal(stored.transferType, "redemption", "posted as a redemption, not a cancellation");
  const bHoldings = (await rt.query("rows", { table: "rightsHoldings", societyId })).filter((h: any) => h.rightsClassId === classB);
  assert.deepEqual(bHoldings.map((h: any) => [h.holderRoleHolderId, h.quantity]).sort(), [[holderB, 10]], "redeemed shares leave the holder");
  await rt.mutation("transfer", { societyId, status: "posted", transferType: "transfer", transferDate: "2026-04-21", rightsClassId: classB, sourceRoleHolderId: holderB, destinationRoleHolderId: holderA, quantity: 5 });

  // Certificates: unique numbers; reconciliation with the ledger; conservation on transfer.
  const cert = (certificateNumber: string, holderName: string, shares: number, issuedOn: string, extra: Record<string, unknown> = {}) =>
    rt.mutation("createCertificate", { societyId, certificateNumber, holderName, shareClass: "Common", shares, issuedOn, nowISO: iso, ...extra });
  const c1 = await cert("C-1", "Holder B", 40, "2026-01-10");
  await assert.rejects(cert(" c-1 ", "Holder A", 1, "2026-01-10"), /already used/, "case-insensitive duplicate");
  const c2 = await cert("C-2", "Holder A", 5, "2026-01-10");
  await assert.rejects(rt.mutation("updateCertificate", { id: c2, patch: { certificateNumber: "C-1" } }), /already used/);
  await assert.rejects(rt.mutation("updateCertificate", { id: c2, patch: { shares: 0 } }), /positive integer/);
  let report = await rt.query("reconcile", { societyId, asOf: "2026-06-30" });
  assert.equal(report.balanced, false);
  assert.ok(report.issues.some((i: string) => /certificates show 5 Common shares for Holder A, but the ledger shows none/.test(i)), report.issues.join("\n"));
  assert.ok(report.notes.some((n: string) => /Holder A holds 5 Class B/.test(n)), "uncertificated holdings are a note");
  await rt.mutation("updateCertificate", { id: c2, patch: { cancelledOn: "2026-01-10" } });
  await rt.mutation("updateCertificate", { id: c1, patch: { cancelledOn: "2026-06-01" } });
  await cert("C-3", "Holder A", 15, "2026-06-01", { replacesCertificateNumber: "C-1" });
  await cert("C-4", "Holder B", 20, "2026-06-01", { replacesCertificateNumber: "C-1" });
  report = await rt.query("reconcile", { societyId, asOf: "2026-06-30" });
  assert.ok(report.issues.some((i: string) => /Certificate C-1 \(40 Common shares of Holder B\).*15 transferred plus 20 balance = 35/.test(i)), report.issues.join("\n"));
  assert.ok(report.issues.some((i: string) => /Holder B: outstanding certificates show 20 Common shares but the ledger shows 40/.test(i)));
  const before = await rt.query("reconcile", { societyId, asOf: "2026-05-31" });
  assert.ok(before.rows.some((r: any) => r.holderName === "Holder B" && r.className === "Common" && r.status === "matched" && r.certificateShares === 40), "as of an earlier date the old certificate matches");

  // Separate class vote: non-voting Class B shares each carry one vote.
  const review = { recordDateISO: "2026-04-30", recordDateBasis: "", rightsBasis: "", ledgerBasis: "", votingMethod: "per_share", representatives: [], classIds: [classB] };
  const preview = await rt.query("preview", { societyId, review });
  assert.equal(preview.voteBasis, "class_separate_resolution");
  assert.deepEqual(preview.votingHolders.map((h: any) => [h.fullName, h.totalVotes]), [["Holder A", 5], ["Holder B", 5]]);
  assert.ok(preview.votingHolders.every((h: any) => h.classVotes.every((c: any) => c.basis === "class_separate_resolution" && c.votesPerShare === 1)));
  assert.deepEqual(preview.classTotals, [{ rightsClassId: classB, className: "Class B Non-Voting Preferred", holders: 2, shares: 10, votes: 10 }]);
  assert.ok(preview.reviewNotes.some((n: string) => /s\. 61/.test(n) && /s\. 173\(9\)/.test(n)), "BC citation for a BC company");
  const ordinary = await rt.query("preview", { societyId, review: { ...review, classIds: undefined } });
  assert.equal(ordinary.voteBasis, "general");
  assert.ok(ordinary.holders.every((h: any) => h.classVotes.every((c: any) => c.rightsClassId !== classB || c.votes === 0)), "an ordinary poll gives non-voting shares no vote");
}

// --- consent gate, a non-BC company, and a society -------------------------------
{
  const societyId = "consent_co";
  const rt = runtime(seedFor(societyId, { ...federal, operativeArticles: { transferConsentRequired: true } }));
  assert.equal(transferConsentRequired({ operativeArticles: { transferConsentRequired: true } }), true);
  assert.equal(transferConsentRequired({}), false);
  const common = await rt.mutation("upsertClass", { societyId, className: "Common", classType: "share", votesPerShare: 1 });
  const [holderA, holderB] = [`${societyId}_h0`, `${societyId}_h1`];
  await assert.rejects(rt.mutation("transfer", { societyId, status: "posted", transferType: "issuance", transferDate: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 10 }), (error: Error) => /fully paid/.test(error.message) && !/Business Corporations Act/.test(error.message), "federal company: rule without a BC citation");
  await rt.mutation("transfer", { societyId, status: "posted", transferType: "issuance", considerationType: "past services", transferDate: "2026-01-10", fullyPaidConfirmedAt: "2026-01-10", rightsClassId: common, destinationRoleHolderId: holderA, quantity: 10 });
  const move = { societyId, status: "posted", transferType: "transfer", transferDate: "2026-02-10", rightsClassId: common, sourceRoleHolderId: holderA, destinationRoleHolderId: holderB, quantity: 4 };
  await assert.rejects(rt.mutation("transfer", move), /directors' consent/);
  await rt.mutation("transfer", { ...move, directorConsentDocumentId: `${societyId}_consent` });
  const preview = await rt.query("preview", { societyId, review: { recordDateISO: "2026-03-01", recordDateBasis: "", rightsBasis: "", ledgerBasis: "", votingMethod: "per_share", representatives: [], classIds: [common] } });
  assert.ok(preview.reviewNotes.some((n: string) => /Confirm the class-vote rule/.test(n)) && !preview.reviewNotes.some((n: string) => /Business Corporations Act/.test(n)), "no BC citation for a federal company");

  const society = "plain_society";
  const srt = runtime(seedFor(society, { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" }));
  const membership = await srt.mutation("upsertClass", { societyId: society, className: "Voting members", classType: "membership" });
  await srt.mutation("transfer", { societyId: society, status: "posted", transferType: "issuance", transferDate: "2026-01-10", rightsClassId: membership, destinationRoleHolderId: `${society}_h0`, quantity: 1 });
}

// --- pure electorate and certificate helpers -------------------------------------
{
  const classes = [{ _id: "common", votesPerShare: 1 }, { _id: "b", votesPerShare: 0, className: "Class B" }];
  const holdings = [{ holderRoleHolderId: "p", rightsClassId: "common", quantity: 10 }, { holderRoleHolderId: "q", rightsClassId: "b", quantity: 7 }];
  const roleHolders = [{ _id: "p", fullName: "Holder P" }, { _id: "q", fullName: "Holder Q" }];
  const general = buildShareholderElectorate({ classes, holdings, roleHolders, recordDateISO: "2026-09-30", holdingsAsOfISO: "2026-09-30" });
  assert.equal(general.totalVotes, 10); assert.equal(general.voteBasis, "general");
  const classVote = buildShareholderElectorate({ classes, holdings, roleHolders, recordDateISO: "2026-09-30", holdingsAsOfISO: "2026-09-30", classIds: ["b"] });
  assert.equal(classVote.totalVotes, 7, "non-voting class: one vote per share in its class vote");
  assert.equal(classVote.complete, true);
  assert.deepEqual(classVote.votingHolders.map((h) => h.fullName), ["Holder Q"]);
  // An unrecorded general multiplier does not block a class vote.
  const unknown = buildShareholderElectorate({ classes: [{ _id: "x", votingRights: "As set out in Part 23" }], holdings: [{ holderRoleHolderId: "q", rightsClassId: "x", quantity: 3 }], roleHolders, recordDateISO: "2026-09-30", holdingsAsOfISO: "2026-09-30", classIds: ["x"] });
  assert.equal(unknown.totalVotes, 3); assert.equal(unknown.complete, true);
  assert.match(classSeparateResolutionNote({ isBcCompany: true, classCount: 2 }), /Each class consents separately/);
  assert.doesNotMatch(classSeparateResolutionNote({ isBcCompany: true, classCount: 1 }), /Each class consents separately/);
  assert.equal(duplicateCertificateNumber([{ certificateNumber: "4A", _id: "x" }], "4a", "x"), undefined, "a row does not clash with itself");
  assert.deepEqual(certificateConservationIssues([
    { certificateNumber: "1", holderName: "A", shareClass: "Common", shares: 10, issuedOn: "2026-01-01", cancelledOn: "2026-02-01" },
    { certificateNumber: "2", holderName: "B", shareClass: "Common", shares: 4, issuedOn: "2026-02-01", replacesCertificateNumber: "1" },
    { certificateNumber: "3", holderName: "A", shareClass: "Common", shares: 6, issuedOn: "2026-02-01", replacesCertificateNumber: "1" },
  ]), [], "cancelled = transferred + balance");
  const linked = reconcileCertificatesWithLedger({
    certificates: [{ certificateNumber: "9", holderName: "Old name", shareClass: "anything", shares: 3, issuedOn: "2026-01-01", rightsClassId: "common", holderRoleHolderId: "p" }],
    holdings: [{ rightsClassId: "common", holderKey: "roleHolder:p", quantity: 3 }],
    classes: [{ _id: "common", className: "Common" }], roleHolders, asOfISO: "2026-01-01",
  });
  assert.equal(linked.balanced, true, "ledger links override names");
}

// --- the Convex wrappers ---------------------------------------------------------
{
  process.env.AUTH_MODE = "better-auth";
  process.env.VITE_AUTH_MODE = "better-auth";
  process.env.BETTER_AUTH_BASE_URL = PORTABLE_TEST_IDENTITY.issuer;
  const t = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./legalOperations.js": () => import("../convex/legalOperations"),
    "./shareCertificates.js": () => import("../convex/shareCertificates"),
  } as any);
  const ids = await t.run(async (ctx: any) => {
    const societyId = await ctx.db.insert("societies", { name: "Synthetic BC Holdings Ltd.", ...bcCompany, isCharity: false, isMemberFunded: false, updatedAt: 0 });
    await ctx.db.insert("users", { societyId, email: "owner@portable-fixture.test", displayName: "Owner", role: "Owner", status: "Active", authProvider: PORTABLE_TEST_IDENTITY.issuer, authSubject: PORTABLE_TEST_AUTH_SUBJECT, authIssuer: PORTABLE_TEST_IDENTITY.issuer, createdAtISO: iso });
    const holder = await ctx.db.insert("roleHolders", { societyId, roleType: "shareholder", status: "current", fullName: "Holder A", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso });
    return { societyId, holder };
  });
  const authed = t.withIdentity(PORTABLE_TEST_IDENTITY);
  const classId = await authed.mutation(api.legalOperations.upsertRightsClass, {
    societyId: ids.societyId, className: "Class C Non-Voting Preferred", classType: "share", status: "needs_review", votesPerShare: 0,
    dividendEntitlement: "discretionary_by_class", maxAuthorized: 1000, liquidationRank: 1, preEmptiveRights: false,
    redemption: { byCompany: true, byHolder: false, priceCents: 1000, includesDeclaredUnpaid: true, minNoticeDays: 10, nonProRataPermitted: true },
  });
  const issuance = await authed.mutation(api.legalOperations.upsertRightsholdingTransfer, { societyId: ids.societyId, transferType: "issuance", status: "posted", transferDate: "2026-01-05", sequence: 0, considerationType: "cash", fullyPaidConfirmedAt: "2026-01-05", rightsClassId: classId, destinationRoleHolderId: ids.holder, quantity: 50 });
  const redemption = await authed.mutation(api.legalOperations.upsertRightsholdingTransfer, { societyId: ids.societyId, transferType: "redemption", status: "posted", transferDate: "2026-03-01", redemptionNoticeWaivedOn: "2026-02-25", solvencyConfirmedAt: "2026-02-28", solvencyBasis: "Directors reviewed the balance sheet", rightsClassId: classId, sourceRoleHolderId: ids.holder, quantity: 20 });
  await assert.rejects(authed.mutation(api.legalOperations.removeRightsholdingTransfer, { id: issuance }), /Deleting this issuance.*Redemption quantity 20 exceeds source balance 0/);
  await authed.mutation(api.legalOperations.removeRightsholdingTransfer, { id: redemption });
  const report = await authed.query(api.shareCertificates.reconcile, { societyId: ids.societyId, asOf: "2026-03-31" });
  assert.deepEqual(report.rows.map((r: any) => [r.holderName, r.ledgerShares, r.status]), [["Holder A", 50, "uncertificated"]]);
}

// --- sources --------------------------------------------------------------------
for (const id of ["BC-BCA-SHARE-RIGHTS", "BC-BCA-SHARE-ISSUE", "BC-BCA-REDEMPTION", "BC-BCA-SHARE-TRANSFER"]) {
  const source = CORPORATE_LEGAL_SOURCES.find((s) => s.id === id);
  assert.ok(source, id);
  assert.match(source!.url, /^https:\/\/www\.bclaws\.gov\.bc\.ca\//, id);
  assert.equal(source!.status, "in_force");
}

console.log("Share ledger rule checks passed: separate class votes count every share, delete/void re-validation, structured class rights and preset, redemption flow and transfer freeze, fully-paid and consent gates, authorized maximum, certificate uniqueness and reconciliation, holdingsAsOf and same-day sequence.");
