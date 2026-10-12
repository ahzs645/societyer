import assert from "node:assert/strict";
import {
  CLASS_BY_CLASS_TAX_CAUTION,
  addTwoCalendarMonths,
  classByClassWarnings,
  decimalToCentsHalfUp,
  dividendDeclarationProblems,
  dividendEntitlements,
  dividendTotalForShares,
  formatDecimalAmount,
  legacyPerShareCents,
  normalizePerShareAmount,
  parseDecimalAmount,
  perShareAmountFromCents,
  reconcileTotals,
  rowPerShareAmount,
  totalDeclaredByClass,
} from "../shared/dividends";
import { holdingsAsOf, toDividendHoldingRows, undatedPostedTransfers } from "../shared/dividendHoldingsAsOf";
import { buildDividendResolutionContext } from "../shared/dividendResolution";
import { CORPORATE_LEGAL_SOURCES } from "../shared/corporateLegalSources";
import * as dividendFns from "../shared/functions/dividends";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

/**
 * Dividend declarations (lawyer-records item 8): exact decimal per-share
 * rates, shares outstanding from the ledger at the record date with a
 * per-holder snapshot, the solvency gate before "declared" (BC BCA s. 70 (2)),
 * the s. 171 (2) (a) record-date limit for BC companies, explicit excluded
 * classes, the ±1% reconciliation as a warning, and a tax caution that never
 * claims a tax result. All fixtures are synthetic.
 */

// --- exact decimal arithmetic ------------------------------------------------
assert.deepEqual(parseDecimalAmount("0.0125"), { units: 125n, scale: 4 });
assert.equal(parseDecimalAmount("-1"), null, "negative rates are rejected");
assert.equal(parseDecimalAmount("1e-3"), null, "exponents are rejected");
assert.equal(parseDecimalAmount("1,000.00"), null, "thousands separators are rejected");
assert.equal(parseDecimalAmount("0.12345678901"), null, "more than 10 decimals is rejected");
assert.equal(normalizePerShareAmount("0.5"), "0.50");
assert.equal(normalizePerShareAmount("1"), "1.00");
assert.equal(normalizePerShareAmount("0.012500"), "0.0125", "trailing zeros past two decimals are trimmed");
assert.equal(perShareAmountFromCents(125), "1.25");
assert.equal(perShareAmountFromCents(5), "0.05");
assert.equal(formatDecimalAmount({ units: 7n, scale: 3 }), "0.007");
assert.deepEqual(legacyPerShareCents("0.25"), { cents: 25, exact: true });
assert.deepEqual(legacyPerShareCents("0.0125"), { cents: 1, exact: false }, "1.25 cents rounds half up to 1 for the legacy column only");
assert.equal(decimalToCentsHalfUp({ units: 5n, scale: 3 }), 1, "0.005 rounds half up to one cent");
assert.equal(decimalToCentsHalfUp({ units: 4n, scale: 3 }), 0);
// Float arithmetic would give 0.1 * 3 = 0.30000000000000004; the BigInt path is exact.
assert.equal(dividendTotalForShares("0.1", 3).totalAmount, "0.30");
assert.deepEqual(dividendTotalForShares("0.0125", 1000), { totalAmount: "12.50", totalCents: 1250 });
assert.equal(dividendTotalForShares("0.333333", 3).totalAmount, "0.999999");
assert.equal(dividendTotalForShares("0.333333", 3).totalCents, 100);
assert.equal(rowPerShareAmount({ perShareAmount: "0.0125", perShareCents: 1 }), "0.0125", "the decimal string is authoritative");
assert.equal(rowPerShareAmount({ perShareCents: 250 }), "2.50", "older rows fall back to their cents");

// --- the reconciliation stays a ±1% warning ------------------------------------
assert.equal(reconcileTotals(100000, 100900).reconciled, true, "0.9% is within tolerance");
assert.equal(reconcileTotals(100000, 102000).reconciled, false, "2% is flagged");
assert.equal(reconcileTotals(0, 1).reconciled, true, "1-cent floor");

// --- holdings as at the record date (equityLedger.holdingsAsOf without undated rows) ---
const ledger = [
  { societyId: "s", transferType: "issuance", status: "posted", transferDate: "2026-01-10", rightsClassId: "B", destinationRoleHolderId: "alex", quantity: 60, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
  { societyId: "s", transferType: "issuance", status: "posted", transferDate: "2026-01-10", rightsClassId: "B", destinationHolderName: "Birch Holdings Ltd.", quantity: 40, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
  { societyId: "s", transferType: "transfer", status: "posted", transferDate: "2026-03-02", rightsClassId: "B", sourceRoleHolderId: "alex", destinationRoleHolderId: "casey", quantity: 20, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
  { societyId: "s", transferType: "issuance", status: "draft", transferDate: "2026-02-01", rightsClassId: "B", destinationRoleHolderId: "alex", quantity: 999, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
  { societyId: "s", transferType: "issuance", status: "posted", rightsClassId: "B", destinationRoleHolderId: "alex", quantity: 5, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "" },
];
const atFeb = toDividendHoldingRows(holdingsAsOf(ledger, "2026-02-28"));
assert.deepEqual(atFeb.map((row) => [row.holderKey, row.quantity]).sort(), [["name:Birch Holdings Ltd.", 40], ["roleHolder:alex", 60]], "drafts and undated rows are excluded; the March transfer is after the record date");
const atTransferDay = toDividendHoldingRows(holdingsAsOf(ledger, "2026-03-02"));
assert.equal(atTransferDay.find((row) => row.holderKey === "roleHolder:casey")?.quantity, 20, "a transfer on the record date counts (end of day)");
assert.equal(undatedPostedTransfers(ledger).length, 1);
assert.throws(() => holdingsAsOf(ledger, "not-a-date"), /valid as-of date/);
assert.deepEqual(toDividendHoldingRows({ "roleHolder:alex": { B: 60 } }), [{ rightsClassId: "B", holderKey: "roleHolder:alex", quantity: 60 }], "the nested result shape is accepted too");

// --- per-holder entitlement snapshot ---------------------------------------------
const snapshot = dividendEntitlements(atFeb, "B", "0.0125", (key) => (key === "roleHolder:alex" ? "Alex Rivera" : undefined));
assert.equal(snapshot.sharesOutstanding, 100);
assert.deepEqual(snapshot.entitlements.map((e) => [e.holderName, e.shares, e.amount, e.amountCents]), [
  ["Alex Rivera", 60, "0.75", 75],
  ["Birch Holdings Ltd.", 40, "0.50", 50],
]);
assert.equal(snapshot.totalAmount, "1.25");
assert.equal(snapshot.roundingDifferenceCents, 0);
const thirds = dividendEntitlements([
  { rightsClassId: "B", holderKey: "name:A", quantity: 1 },
  { rightsClassId: "B", holderKey: "name:B", quantity: 1 },
  { rightsClassId: "B", holderKey: "name:C", quantity: 1 },
], "B", "0.005");
assert.equal(thirds.totalCents, 2, "exact total 0.015 rounds to 2 cents");
assert.equal(thirds.payableCents, 3, "each holder's 0.005 rounds up to one cent");
assert.equal(thirds.roundingDifferenceCents, 1, "the rounding difference is reported, not hidden");

// --- the declaration gate ------------------------------------------------------
assert.deepEqual(dividendDeclarationProblems({ status: "draft" }, "bc_company"), [], "a draft needs no solvency evidence");
const unconfirmed = dividendDeclarationProblems({ status: "declared" }, "bc_company");
assert.equal(unconfirmed.length, 1);
assert.match(unconfirmed[0], /s\. 70 \(2\)/, "BC wording cites s. 70 (2)");
assert.match(unconfirmed[0], /insolvent/);
const federal = dividendDeclarationProblems({ status: "declared" }, "other_corporation");
assert.ok(!/Business Corporations Act|s\. 70/.test(federal[0]), "no BC citation for another corporate statute");
assert.ok(dividendDeclarationProblems({ status: "declared", solvencyConfirmedAt: "2026-04-01", solvencyBasis: "short" }, "bc_company").length === 1, "a basis needs substance");
assert.deepEqual(dividendDeclarationProblems({ status: "declared", solvencyConfirmedAt: "2026-04-01", solvencyBasis: "Reviewed March statements and 12-month cash forecast." }, "bc_company"), []);
assert.ok(dividendDeclarationProblems({ status: "paid", solvencyConfirmedAt: "2026-04-01", solvencyBasis: "Reviewed March statements." }, "bc_company").some((p) => /payment date/.test(p)), "paid needs a payment date");
// s. 171 (2) (a): record date not more than 2 months before payment (BC only).
assert.equal(addTwoCalendarMonths("2026-12-31"), "2027-02-28");
assert.deepEqual(dividendDeclarationProblems({ recordDate: "2026-04-30", paymentDate: "2026-06-30" }, "bc_company"), [], "exactly two months is allowed");
assert.ok(dividendDeclarationProblems({ recordDate: "2026-04-30", paymentDate: "2026-07-01" }, "bc_company").some((p) => /s\. 171 \(2\) \(a\)/.test(p)));
assert.deepEqual(dividendDeclarationProblems({ recordDate: "2026-04-30", paymentDate: "2026-07-01" }, "other_corporation"), [], "the BC limit is not applied to other statutes");
assert.ok(dividendDeclarationProblems({ recordDate: "2026-05-02", paymentDate: "2026-05-01" }, "other_corporation").some((p) => /after the payment date/.test(p)));
assert.ok(dividendDeclarationProblems({ rightsClassId: "B", excludedClassIds: ["B"] }, "bc_company").some((p) => /excluded/.test(p)));

// --- class-by-class warnings and the tax caution ----------------------------------
const warnings = classByClassWarnings(
  { id: "B", className: "Class B Non-Voting Preferred", dividendEntitlement: "discretionary_by_class" },
  [
    { id: "A", className: "Class A Voting Preferred", dividendEntitlement: "cumulative_fixed" },
    { id: "C", className: "Class C Non-Voting Preferred" },
    { id: "D", className: "Class D", dividendEntitlement: "discretionary_by_class" },
  ],
);
assert.equal(warnings.length, 2);
assert.match(warnings[0], /Class A .*cumulative fixed dividend/);
assert.match(warnings[1], /Class C .*not recorded/);
assert.match(CLASS_BY_CLASS_TAX_CAUTION, /TOSI/);
assert.match(CLASS_BY_CLASS_TAX_CAUTION, /attribution/);
assert.match(CLASS_BY_CLASS_TAX_CAUTION, /does not assess tax/);
assert.match(CLASS_BY_CLASS_TAX_CAUTION, /tax advice/);
assert.ok(!/(tax[- ]free|tax[- ]efficient|tax[- ]effective|saves? tax|no tax|avoid)/i.test(CLASS_BY_CLASS_TAX_CAUTION), "the caution never claims a tax result");

// --- verified source record ----------------------------------------------------------
const source = CORPORATE_LEGAL_SOURCES.find((row) => row.id === "BC-BCA-DIVIDENDS");
assert.ok(source, "BC-BCA-DIVIDENDS source exists");
assert.match(source!.section, /70/);
assert.match(source!.url, /#section70$/);
assert.match(source!.summary, /insolvent/);
assert.match(source!.summary, /two months/);

// --- packet context keeps the exact rate ---------------------------------------------
const context = buildDividendResolutionContext([
  { shareClass: "Class B", perShareCents: 1, perShareAmount: "0.0125", totalCents: 1250, currency: "C$", recordDate: "2026-04-30", paymentDate: "2026-05-15", excludedClassNames: ["Class A", "Class C"], solvencyConfirmed: true },
]);
assert.equal(context.declarations[0].perShare, "C$0.0125", "the packet never rounds the declared rate");
assert.equal(context.recordDate, "2026-04-30");
assert.equal(context.excludedClasses, "Class A, Class C");
assert.equal(context.solvencyConfirmed, true);

// --- totals prefer the stored exact total ----------------------------------------------
assert.deepEqual(totalDeclaredByClass([{ declaredOn: "2026-01-01", shareClass: "B", perShareCents: 1, sharesOutstanding: 1000, currency: "CAD", totalCents: 1250 }]), { B: 1250 });

// --- portable handlers: ledger snapshot, gate, status flow ------------------------------
const societyId = "dividend-fixture";
const membership = portableTestSeed(societyId);
function runtime(society: Record<string, unknown>) {
  const db = new MemoryDb({
    seed: {
      ...membership,
      societies: [{ ...membership.societies[0], ...society }],
      rightsClasses: [
        { _id: "A", societyId, className: "Class A Voting Preferred", classType: "share", status: "active", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
        { _id: "B", societyId, className: "Class B Non-Voting Preferred", classType: "share", status: "active", dividendEntitlement: "discretionary_by_class", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
        { _id: "M", societyId, className: "Members", classType: "membership", status: "active", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
      ],
      roleHolders: [
        { _id: "alex", societyId, roleType: "shareholder", status: "current", fullName: "Alex Rivera", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
        { _id: "casey", societyId, roleType: "shareholder", status: "current", fullName: "Casey Rivera", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "", updatedAtISO: "" },
      ],
      rightsholdingTransfers: ledger.map((row, index) => ({ ...row, _id: `t${index}`, societyId })),
      writtenResolutions: [{ _id: "wr1", societyId, title: "Directors' resolution: Class B dividend", text: "", kind: "Ordinary", body: "directors", circulatedAtISO: "2026-04-20T00:00:00Z" }],
    },
  });
  const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
    .register(definePortableQuery({ name: "dividends:preview", handler: dividendFns.previewPortable }))
    .register(definePortableQuery({ name: "dividends:options", handler: dividendFns.optionsPortable }))
    .register(definePortableQuery({ name: "dividends:list", handler: dividendFns.listPortable }))
    .register(definePortableQuery({ name: "dividends:summary", handler: dividendFns.summaryPortable }))
    .register(definePortableMutation({ name: "dividends:create", handler: dividendFns.createPortable }))
    .register(definePortableMutation({ name: "dividends:setStatus", handler: dividendFns.setStatusPortable }));
  return { rt, db };
}
const bcCompany = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
const { rt, db } = runtime(bcCompany);
const base = { societyId, declaredOn: "2026-04-20", rightsClassId: "B", perShareAmount: "0.0125", currency: "CAD", recordDate: "2026-02-28", paymentDate: "2026-04-25", excludedClassIds: ["A"] };

const options = await rt.runQuery("dividends:options", { societyId }) as any;
assert.equal(options.scope, "bc_company");
assert.deepEqual(options.classes.map((c: any) => c.className), ["Class A Voting Preferred", "Class B Non-Voting Preferred"], "membership classes are not offered");
assert.equal(options.resolutions[0]._id, "wr1");

const preview = await rt.runQuery("dividends:preview", base) as any;
assert.equal(preview.ok, true);
assert.equal(preview.sharesOutstanding, 100, "shares outstanding come from the ledger at the record date");
assert.equal(preview.sharesSource, "ledger");
assert.equal(preview.snapshot.entitlements[0].holderName, "Alex Rivera");
assert.ok(preview.warnings.some((w: string) => /no transfer date/.test(w)), "undated ledger rows are reported");
assert.ok(preview.warnings.some((w: string) => /Class A .*not recorded/.test(w)), "excluded class without recorded rights is flagged");
const badPreview = await rt.runQuery("dividends:preview", { ...base, paymentDate: "2026-05-15" }) as any;
assert.equal(badPreview.ok, false, "a problem is returned, not thrown");
assert.match(badPreview.error, /s\. 171/);

await assert.rejects(rt.runMutation("dividends:create", { ...base, status: "declared", nowISO: "2026-04-20T12:00:00Z" }), /s\. 70 \(2\)/, "declared without solvency confirmation is refused");
const draftId = await rt.runMutation("dividends:create", { ...base, sharesOutstanding: 90, expectedTotalCents: 2000, notes: "Synthetic fixture", nowISO: "2026-04-20T12:00:00Z" }) as string;
const draft = await db.get(draftId) as any;
assert.equal(draft.status, "draft");
assert.equal(draft.shareClass, "Class B Non-Voting Preferred");
assert.equal(draft.perShareAmount, "0.0125");
assert.equal(draft.perShareCents, 1, "legacy column rounded; decimal kept");
assert.equal(draft.sharesOutstanding, 100, "the ledger count overrides a hand-typed count");
assert.equal(draft.totalCents, 125);
assert.equal(draft.totalAmount, "1.25");
assert.deepEqual(draft.excludedClassIds, ["A"]);
assert.equal(draft.entitlements.length, 2);
assert.match(draft.notes, /total mismatch/, "the ±1% check is a warning note, not a refusal");

const summaryBefore = await rt.runQuery("dividends:summary", { societyId }) as any;
assert.deepEqual(summaryBefore.byClass, {}, "drafts are not declared totals");
await assert.rejects(rt.runMutation("dividends:setStatus", { id: draftId, status: "declared", nowISO: "2026-04-21T00:00:00Z" }), /solvency/);
await rt.runMutation("dividends:setStatus", { id: draftId, status: "declared", solvencyConfirmedAt: "2026-04-20", solvencyBasis: "Reviewed March statements and cash forecast.", declaredByResolutionId: "wr1", nowISO: "2026-04-21T00:00:00Z" });
assert.equal((await db.get(draftId) as any).status, "declared");
assert.equal((await db.get(draftId) as any).declaredByResolutionId, "wr1");
await rt.runMutation("dividends:setStatus", { id: draftId, status: "paid", nowISO: "2026-04-25T00:00:00Z" });
const summaryAfter = await rt.runQuery("dividends:summary", { societyId }) as any;
assert.deepEqual(summaryAfter.byClass, { "Class B Non-Voting Preferred": 125 });
await assert.rejects(rt.runMutation("dividends:setStatus", { id: draftId, status: "declared", nowISO: "2026-04-26T00:00:00Z" }), /paid dividend/);

// A class with no ledger rows needs a hand-entered count and says so.
const manualId = await rt.runMutation("dividends:create", { societyId, declaredOn: "2026-04-20", rightsClassId: "A", perShareAmount: "1", sharesOutstanding: 10, currency: "CAD", recordDate: "2026-04-01", nowISO: "2026-04-20T12:00:00Z" }) as string;
assert.equal((await db.get(manualId) as any).sharesSource, "manual");
await assert.rejects(rt.runMutation("dividends:create", { societyId, declaredOn: "2026-04-20", rightsClassId: "A", perShareAmount: "1", currency: "CAD", recordDate: "2026-04-01", nowISO: "x" }), /no posted .* holdings/);
// Older callers (integer cents, typed class, typed count) still work.
const legacyId = await rt.runMutation("dividends:create", { societyId, declaredOn: "2026-01-15", shareClass: "Common", perShareCents: 250, sharesOutstanding: 1000, currency: "CAD", nowISO: "2026-01-15T00:00:00Z" }) as string;
assert.equal((await db.get(legacyId) as any).totalCents, 250000);
assert.equal((await db.get(legacyId) as any).perShareAmount, "2.50");

// A federal corporation is not held to the BC s. 171 limit, and its gate has no BC citation.
const federalRt = runtime({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" }).rt;
const fedPreview = await federalRt.runQuery("dividends:preview", { ...base, paymentDate: "2026-05-15" }) as any;
assert.equal(fedPreview.ok, true);
await assert.rejects(federalRt.runMutation("dividends:create", { ...base, status: "declared", nowISO: "x" }), (error: Error) => !/s\. 70/.test(error.message) && /solvency/.test(error.message));

console.log("OK dividend-declarations");
