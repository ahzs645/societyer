/**
 * GATE: the YCN certificate register converts into a ledger that agrees with
 * the certificates on every event date. Synthetic data only
 * (scripts/fixtures/ycnSynthetic.ts).
 */
import assert from "node:assert/strict";

import { deriveCurrentHoldings } from "../shared/equityLedger";
import { ycnShareRows } from "../shared/ycnAccessImport";
import {
  certificateHoldingsAsOf,
  convertYcnShareRegister,
  ledgerHoldingsAsOf,
  movementsAsLedgerRecords,
  reconcileShareRegister,
  ycnIssueType,
  type YcnShareRow,
} from "../shared/ycnShareConversion";
import { SYNTHETIC_ENTITY_IDS, syntheticYcnTables } from "./fixtures/ycnSynthetic";

const asObject = (map: Map<string, Map<string, number>>) =>
  Object.fromEntries([...map].map(([cls, holders]) => [cls, Object.fromEntries([...holders].sort())]));

// --- vocabulary ---------------------------------------------------------------
assert.equal(ycnIssueType("Allot"), "allot");
assert.equal(ycnIssueType("Transfer"), "transfer");
assert.equal(ycnIssueType("Certificate"), "certificate");
assert.equal(ycnIssueType("Subdivision"), "subdivision");
assert.equal(ycnIssueType("Consolidation"), "consolidation");
assert.equal(ycnIssueType("Redeem"), "redemption");
assert.equal(ycnIssueType("Redemption"), "redemption");
assert.equal(ycnIssueType("Cancel"), "cancellation");

// --- the synthetic register -----------------------------------------------------
const rows = ycnShareRows(syntheticYcnTables(), SYNTHETIC_ENTITY_IDS.primary);
assert.equal(rows.length, 18, "current rows only (the superseded edit is ignored)");
assert.ok(!rows.some((row) => row.cancelledOn?.startsWith("2999")), "the 2999 sentinel is an open end, not a date");

const result = convertYcnShareRegister(rows);
assert.equal(result.clean, true, JSON.stringify(result.issues));
assert.deepEqual(result.issues.map((issue) => issue.code), ["cancellation_without_successor"]);

// No negative quantities; every movement is a ledger kind.
for (const m of result.movements) {
  assert.ok(m.quantity > 0, `positive quantity: ${m.key}`);
  assert.ok(["issuance", "transfer", "subdivision", "consolidation", "redemption"].includes(m.transferType), m.transferType);
}

const summary = result.movements.map((m) => `${m.transferDate} ${m.transferType} ${m.classCode} ${m.sourceHolderId ?? "-"}>${m.destinationHolderId ?? "-"} ${m.quantity}`);
assert.deepEqual(summary, [
  "2005-03-01 issuance COMMON ->P001 100",
  "2005-03-01 issuance COMMON ->P002 100",
  "2009-11-16 issuance CLASSB ->P003 1",
  // Transfer: the source is the holder whose certificate pointed forward to the new one.
  "2011-04-12 transfer CLASSB P003>P004 1",
  "2011-06-21 issuance CLASSB ->P005 1",
  "2016-02-15 issuance COMMON ->P001 100",
  // Two certificates (2A, 3A) merged into 4A: two transfers, each with its own source.
  "2016-10-17 transfer CLASSB P004>P006 1",
  "2016-10-17 transfer CLASSB P005>P006 1",
  "2018-03-05 issuance COMMON ->P007 10",
  // Subdivision adds to the holder; the replacement certificate 5A is NOT another transfer.
  "2020-06-09 subdivision CLASSB ->P006 8",
  // Consolidation takes from the holder, with a positive quantity; replacements add nothing.
  "2020-09-22 consolidation COMMON P001>- 180",
  "2020-09-22 consolidation COMMON P002>- 90",
  "2020-09-22 consolidation COMMON P007>- 9",
  // No forward pointers: the holder who gave up shares is the source; the balance certificate is not a transfer.
  "2022-05-31 transfer COMMON P001>P004 8",
  // Cancelled with nothing replacing it: a redemption, not a cancellation.
  "2024-03-31 redemption CLASSB P006>- 10",
]);
const allotment = result.movements.find((m) => m.key.startsWith("issue:") && m.destinationHolderId === "P005");
assert.equal(allotment?.priceToOrganizationCents, 1000, "consideration goes to the price field");
assert.equal(allotment?.priceToOrganizationCurrency, "cad");
assert.equal(allotment?.considerationType, "Cash");

// Reconciliation: ledger = active certificates at the end of every event date.
assert.equal(result.reconciliation.ok, true);
assert.equal(result.reconciliation.ledgerValid, true);
assert.equal(result.reconciliation.mismatches.length, 0);
assert.deepEqual(result.reconciliation.dates, [
  "2005-03-01", "2009-11-16", "2011-04-12", "2011-06-21", "2016-02-15", "2016-10-17",
  "2018-03-05", "2020-06-09", "2020-09-22", "2022-05-31", "2024-03-31",
]);
assert.equal(result.reconciliation.checkedPoints, 40);
for (const date of result.reconciliation.dates) {
  assert.deepEqual(asObject(ledgerHoldingsAsOf(result.movements, date)), asObject(certificateHoldingsAsOf(rows, date)), date);
}
// Spot checks, including days between events.
assert.deepEqual(asObject(certificateHoldingsAsOf(rows, "2016-09-25")), { CLASSB: { P004: 1, P005: 1 }, COMMON: { P001: 200, P002: 100 } });
assert.deepEqual(asObject(ledgerHoldingsAsOf(result.movements, "2020-08-10")), { CLASSB: { P006: 10 }, COMMON: { P001: 200, P002: 100, P007: 10 } });
assert.deepEqual(asObject(ledgerHoldingsAsOf(result.movements, "2020-09-22")), { CLASSB: { P006: 10 }, COMMON: { P001: 20, P002: 10, P007: 1 } });
assert.deepEqual(asObject(ledgerHoldingsAsOf(result.movements, "2026-01-01")), { COMMON: { P001: 12, P002: 10, P004: 8, P007: 1 } });
// The equity ledger itself accepts the movements in order (no negative balances, sources available).
assert.equal(deriveCurrentHoldings(movementsAsLedgerRecords(result.movements)).reduce((sum, h) => sum + h.quantity, 0), 31);

// Certificates: back pointers (the reverse of YCN's forward pointer), no "Replacement" literal.
const back = Object.fromEntries(result.certificates.map((c) => [`${c.classCode}:${c.certificateNumber}`, c.replacesCertificateNumber ?? null]));
assert.deepEqual(back, {
  "CLASSB:1A": null, "CLASSB:2A": "1A", "CLASSB:3A": null, "CLASSB:4A": "2A", "CLASSB:5A": "4A",
  "COMMON:1": null, "COMMON:2": null, "COMMON:3": null, "COMMON:4": null,
  "COMMON:5": "1", "COMMON:6": "2", "COMMON:7": "4", "COMMON:8": "5", "COMMON:9": "5",
});
assert.deepEqual(result.certificates.find((c) => c.certificateNumber === "4A")?.replacesCertificateNumbers, ["2A", "3A"], "both merged certificates listed");
assert.deepEqual(result.certificates.find((c) => c.classCode === "COMMON" && c.certificateNumber === "5")?.replacesCertificateNumbers, ["1", "3"]);
assert.equal(result.certificates.find((c) => c.certificateNumber === "5A")?.origin, "replacement");
assert.ok(!result.certificates.some((c) => c.replacesCertificateNumber === "Replacement"));
assert.equal(result.certificates.length, 14, "delta rows are not certificates");

// The cancellation kind can be chosen.
const asCancellation = convertYcnShareRegister(rows, { cancellationKind: "cancellation" });
assert.equal(asCancellation.movements.at(-1)?.transferType, "cancellation");
assert.equal(asCancellation.clean, true);

// --- edge cases ---------------------------------------------------------------------
const r = (rowId: string, fields: Partial<YcnShareRow>): YcnShareRow => ({
  rowId, issuedOn: "2020-01-01", holderId: "A", classCode: "C", shares: 1, issueType: "allot", ...fields,
});

// A copied entity whose issue dates were reset: cancellations before issue are errors, and it is not clean.
const copied = convertYcnShareRegister([
  r("1", { issuedOn: "2020-07-14", cancelledOn: "2011-04-12", certificate: "1", shares: 1, replacedBy: "2" }),
  r("2", { issuedOn: "2020-07-14", holderId: "B", certificate: "2", shares: 1, issueType: "transfer" }),
]);
assert.equal(copied.clean, false);
assert.ok(copied.issues.some((issue) => issue.code === "cancelled_before_issued" && issue.severity === "error"));

// Several givers and several receivers with no pointers: inferred, and flagged.
const ambiguous = convertYcnShareRegister([
  r("1", { holderId: "A", certificate: "1", shares: 5, cancelledOn: "2021-01-01" }),
  r("2", { holderId: "B", certificate: "2", shares: 5, cancelledOn: "2021-01-01" }),
  r("3", { holderId: "C", certificate: "3", shares: 5, issuedOn: "2021-01-01", issueType: "transfer" }),
  r("4", { holderId: "D", certificate: "4", shares: 5, issuedOn: "2021-01-01", issueType: "transfer" }),
]);
assert.equal(ambiguous.reconciliation.ok, true);
assert.ok(ambiguous.issues.some((issue) => issue.code === "ambiguous_transfer_pairing" && issue.severity === "warning"));
assert.equal(ambiguous.movements.filter((m) => m.transferType === "transfer").length, 2);

// Forward pointers decide the pairing even when it is not the alphabetical one.
const pointed = convertYcnShareRegister([
  r("1", { holderId: "A", certificate: "1", shares: 5, cancelledOn: "2021-01-01", replacedBy: "4" }),
  r("2", { holderId: "B", certificate: "2", shares: 5, cancelledOn: "2021-01-01", replacedBy: "3" }),
  r("3", { holderId: "C", certificate: "3", shares: 5, issuedOn: "2021-01-01", issueType: "transfer" }),
  r("4", { holderId: "D", certificate: "4", shares: 5, issuedOn: "2021-01-01", issueType: "transfer" }),
]);
assert.deepEqual(pointed.movements.filter((m) => m.transferType === "transfer").map((m) => `${m.sourceHolderId}>${m.destinationHolderId}`).sort(), ["A>D", "B>C"]);
assert.ok(!pointed.issues.some((issue) => issue.code === "ambiguous_transfer_pairing"));

// Shares that appear with no allotment and no transferring holder are an error.
const orphan = convertYcnShareRegister([r("1", { holderId: "B", certificate: "9", shares: 3, issueType: "transfer" })]);
assert.equal(orphan.clean, false);
assert.ok(orphan.issues.some((issue) => issue.code === "unexplained_increase" && issue.severity === "error"));

// A replacement whose quantity does not add up is flagged.
const badReplacement = convertYcnShareRegister([
  r("1", { certificate: "1", shares: 5, cancelledOn: "2021-01-01" }),
  r("2", { certificate: "2", shares: 6, issuedOn: "2021-01-01", issueType: "certificate" }),
]);
assert.ok(badReplacement.issues.some((issue) => issue.code === "replacement_quantity"));
assert.equal(badReplacement.clean, false, "a replacement that adds shares does not reconcile");

// reconcileShareRegister catches a ledger that was edited after conversion.
const tampered = result.movements.map((m) => (m.transferType === "subdivision" ? { ...m, quantity: 7 } : m));
const tamperedCheck = reconcileShareRegister(rows, tampered);
assert.equal(tamperedCheck.ok, false);
assert.ok(tamperedCheck.mismatches.some((m) => m.date === "2020-06-09" && m.holderId === "P006" && m.certificates === 10 && m.ledger === 9));

console.log("OK ycn-share-conversion");
