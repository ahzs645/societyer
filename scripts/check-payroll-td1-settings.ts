import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import type { PayrollTd1ApplyArgs, PayrollTd1ReviewedForm } from "../shared/payrollTd1Settings";
import * as td1 from "../shared/functions/payrollTd1";
import { addDaysToDateOnly } from "../shared/dateOnly";

const societyId = "td1-society", employeeId = "td1-employee", otherEmployee = "td1-second", userId = "td1-owner";
const today = new Date().toISOString().slice(0, 10), year = Number(today.slice(0, 4));
const january = `${year}-01-01`, tomorrow = addDaysToDateOnly(today, 1)!;
const principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: userId, issuer: "https://td1.test", userId, societyId } as const;
const seed = {
  societies: [{ _id: societyId, name: "Sample payroll organization" }, { _id: "foreign", name: "Foreign" }],
  users: [{ _id: userId, societyId, role: "Owner", status: "Active", authSubject: principal.subject, authIssuer: principal.issuer }],
  employees: [{ _id: employeeId, societyId, firstName: "Sample", lastName: "Worker", startDate: "2020-01-01", sinSecretVaultItemId: "NEVER-EXPOSE-IDENTITY" }, { _id: otherEmployee, societyId, firstName: "Second", startDate: "2020-01-01" }, { _id: "foreign-worker", societyId: "foreign" }],
  payrollEmployeeProfiles: [{ _id: "profile", societyId, employeeId, effectiveFrom: "2020-01-01", td1: { confirmed: true, federalClaimCents: 1645200, provincialClaimCents: 1321600, multipleEmployers: true, taxExempt: true, additionalTaxCents: 9000 }, deductions: { annualZoneDeductionCents: 123400, registeredPlanCents: 2500 } }],
};
const form = (kind: "federal" | "BC", overrides: Partial<PayrollTd1ReviewedForm> = {}): PayrollTd1ReviewedForm => ({ form: kind, year, totalClaimCents: kind === "federal" ? 1645200 : 1321600, multipleEmployers: false, totalIncomeLessThanClaims: false, source: { method: "acroform", mediaType: "application/pdf", pageCount: 2, sha256: "a".repeat(64) }, signedFormReviewed: true, fieldsReviewed: true, residencyConfirmed: "resident", ...overrides });

for (const runtime of ["memory", "indexed-local"] as const) {
  const db = runtime === "memory" ? new MemoryDb({ seed: structuredClone(seed) }) : new LocalStoreDb(new MemoryRowStore(structuredClone(seed), { indexed: true }));
  const ctx = { db, principal, capabilities: makeCapabilities({}) } as PortableMutationCtx;
  const mutate = <T>(fn: () => Promise<T>) => db.transaction(fn);
  const apply = (forms: PayrollTd1ReviewedForm[], extra: Partial<PayrollTd1ApplyArgs> = {}) => mutate(() => td1.applyReviewedPortable(ctx, { societyId, employeeId, effectiveFrom: january, receivedOn: january, forms, ...extra }));
  const baseline = { confirmed: true, federalClaimCents: 1645200, provincialClaimCents: 1321600, multipleEmployers: true, taxExempt: true, additionalTaxCents: 9000 };
  const resolve = (date = today, target = employeeId) => td1.resolvePayrollTd1Portable(ctx, { societyId, employeeId: target, payDate: date, baseTd1: baseline, baseDeductions: { annualZoneDeductionCents: 123400, registeredPlanCents: 2500 } });
  const first = await apply([form("federal", { additionalTaxCents: 2500, annualZoneDeductionCents: 50000 }), form("BC", { totalClaimCents: 0, multipleEmployers: true })]);
  assert.equal(first.declarationIds.length, 2);
  assert.deepEqual((await apply([form("federal", { additionalTaxCents: 2500, annualZoneDeductionCents: 50000 }), form("BC", { totalClaimCents: 0, multipleEmployers: true })])).declarationIds, first.declarationIds, "same import retries reuse immutable declarations");
  const selected = await resolve();
  assert.equal(selected.td1.federalMultipleEmployers, false); assert.equal(selected.td1.provincialMultipleEmployers, true);
  assert.equal(selected.td1.federalTaxExempt, false); assert.equal(selected.td1.provincialTaxExempt, false);
  assert.equal(selected.td1.additionalTaxCents, 2500); assert.equal(selected.deductions.annualZoneDeductionCents, 50000); assert.equal(selected.deductions.registeredPlanCents, 2500);
  assert.equal(selected.sourceDeclarations.length, 2);
  const future = await apply([form("federal", { totalClaimCents: 1700000, totalIncomeLessThanClaims: true })], { effectiveFrom: tomorrow, receivedOn: today });
  assert.equal((await resolve()).td1.federalClaimCents, 1645200, "a future declaration cannot change an earlier payment");
  const next = await resolve(tomorrow);
  assert.equal(next.td1.federalClaimCents, 1700000); assert.equal(next.td1.federalTaxExempt, true); assert.equal(next.td1.additionalTaxCents, 0);
  assert.equal(next.td1.provincialMultipleEmployers, true, "a federal update preserves the separately effective BC declaration");
  assert.equal(next.deductions.annualZoneDeductionCents, 0, "a newly reviewed blank federal zone field clears a superseded profile deduction");
  assert.equal((await db.get(first.declarationIds[0], "payrollTd1Declarations"))?.totalClaimCents, 1645200, "new declaration never edits retained prior evidence");
  assert.equal((await resolve(`${year + 1}-01-01`)).sourceDeclarations.length, 0, "year-specific reviewed indexed amounts do not silently carry into a later withholding year");

  const forged = await apply([{ ...form("BC", { totalClaimCents: 1400000 }), _id: "forged", societyId: "foreign", employeeId: "foreign-worker", signature: "NEVER-EXPOSE-IDENTITY", fullText: "NEVER-EXPOSE-IDENTITY", sin: "NEVER-EXPOSE-IDENTITY", source: { ...form("BC").source, filename: "NEVER-EXPOSE-IDENTITY" } } as any], { employeeId: otherEmployee });
  const stored = await db.get(forged.declarationIds[0], "payrollTd1Declarations");
  assert.equal(stored?.societyId, societyId); assert.equal(stored?.employeeId, otherEmployee); assert.notEqual(stored?._id, "forged");
  assert.equal(stored?.originalStored, false); assert.equal(stored?.employeeElectronicSignatureCertified, false); assert.equal(stored?.recordedByUserId, userId);
  assert.ok(!JSON.stringify(stored).includes("NEVER-EXPOSE-IDENTITY"), "only reviewed allowlisted tax fields and hash are persisted");

  const rejected: Array<[PayrollTd1ReviewedForm, RegExp]> = [
    [form("federal", { totalClaimCents: 100, multipleEmployers: true }), /zero total claim/],
    [form("BC", { totalClaimCents: 0, totalIncomeLessThanClaims: true }), /positive total claim/],
    [form("federal", { fieldsReviewed: false }), /verify.*every field/],
    [form("federal", { signedFormReviewed: false }), /verify.*signed/],
    [form("federal", { multipleEmployers: undefined as any }), /missing checkbox/],
    [form("federal", { residencyConfirmed: "nonresident" as any }), /Non-resident/],
    [form("BC", { additionalTaxCents: 100 }), /federal form/],
    [form("BC", { annualZoneDeductionCents: 100 }), /federal form/],
    [form("federal", { year: year + 1 }), /withholding year/],
    [form("federal", { sourceFormYear: year + 1 }), /later year's form/],
    [form("federal", { sourceFormYear: year - 1 }), /prior form/],
    [form("federal", { reviewReference: "123-456-789" }), /without a SIN/],
    [form("federal", { totalClaimCents: -1 }), /integer/],
    [form("federal", { source: { method: "ocr", mediaType: "application/pdf", pageCount: 2 } }), /SHA-256/],
    [form("federal", { source: { method: "manual", mediaType: "text/plain", pageCount: 1 } }), /Employer review reference/],
  ];
  for (const [bad, reason] of rejected) await assert.rejects(apply([bad]), reason);
  await assert.rejects(apply([form("BC"), form("BC")]), /without duplicates/);
  await assert.rejects(apply([form("federal")], { receivedOn: tomorrow, effectiveFrom: tomorrow }), /actual past\/current/);
  await assert.rejects(apply([form("federal")], { effectiveFrom: january, receivedOn: today }), /on or after receipt/);
  await assert.rejects(apply([form("federal")], { employeeId: "foreign-worker" }), /not found/);
  await apply([form("federal", { sourceFormYear: year - 1, priorYearReviewed: true, priorYearReviewReference: "Reviewed current indexed claim worksheet" })], { employeeId: otherEmployee });

  // Exercise actual one-query history paging with more than a page of immutable
  // revisions, and reject cursor replay under another employee's authorization.
  for (let i = 0; i < 28; i++) await apply([form("BC", { totalClaimCents: 1321600 + i })]);
  const page = await td1.workspacePortable(ctx, { societyId, employeeId });
  assert.equal(page.page.length, 25); assert.equal(page.isDone, false); assert.ok(page.continueCursor);
  const second = await td1.workspacePortable(ctx, { societyId, employeeId, cursor: page.continueCursor });
  assert.equal(second.isDone, true); assert.ok(second.page.length > 0);
  assert.equal(new Set([...page.page, ...second.page].map(row => row._id)).size, page.page.length + second.page.length);
  await assert.rejects(td1.workspacePortable(ctx, { societyId, employeeId: otherEmployee, cursor: page.continueCursor }), /another employee/);
  assert.ok(!JSON.stringify(page).includes("NEVER-EXPOSE-IDENTITY"));
  await mutate(() => db.patch(userId, { role: "Director" }));
  await td1.workspacePortable(ctx, { societyId, employeeId });
  await assert.rejects(apply([form("BC")]), /permission|authorized/i);
  const financeOnly = { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "finance-only", societyId, actorUserId: userId, scopes: ["financials:read"] } as const;
  await assert.rejects(td1.workspacePortable({ ...ctx, principal: financeOnly }, { societyId, employeeId }), /scope|employees:read|permission/i);
  console.log(`TD1 settings portable checks passed (${runtime}): reviewed pair, per-jurisdiction flags, dated/year resolution, zone reset, immutable/idempotent evidence, privacy allowlist, invalid inputs, full pagination and permissions.`);
}
