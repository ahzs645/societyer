import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import { assertNativePayrollBankPatch } from "../shared/functions/payrollPaymentGuard";
import { updateTransactionPortable, bulkUpdateTransactionsPortable, restoreTransactionsPortable } from "../shared/functions/financialHub";
import { patchTransactionWithJournal, upsertChartAccountPortable } from "../shared/functions/accounting";
import { matchPortable, markManualPortable, unmatchPortable } from "../shared/functions/reconciliation";
import { savePortable as saveLinesPortable } from "../shared/functions/transactionLines";
import { requireFunctionAction } from "../shared/functions/actionPolicy";

const societyId = "payroll-guard-society", userId = "payroll-guard-owner";
const transaction = { _id: "settled-bank", societyId, accountId: "payroll-bank", date: "2026-05-22", amountCents: -150000, category: "Payroll", matchedKind: "payroll", matchedId: "native-run", reconciledAtISO: "2026-05-22T12:00:00Z", description: "Recorded net wages" };
const fixture = {
  societies: [{ _id: societyId, name: "Synthetic payroll safeguards" }],
  users: [{ _id: userId, societyId, role: "Owner", status: "Active", displayName: "Synthetic owner" }],
  employees: [{ _id: "legacy-employee", societyId, firstName: "Legacy", lastName: "Worker" }],
  payRuns: [{ _id: "native-run", societyId, calculationId: "native-calculation" }],
  payrollCalculations: [{ _id: "native-calculation", societyId, status: "finalized" }],
  financialAccounts: [{ _id: "payroll-bank", societyId, accountType: "Bank", currency: "CAD", name: "Synthetic bank" }],
  payrollRemittanceSettlements: [{_id: "cra-settlement", societyId, transactionId: "cra-bank", amountCents: 12500, date: "2026-05-22"}],
  financialTransactions: [{...transaction, _id: "cra-bank", matchedKind: "payroll_remittance", matchedId: "cra-settlement", amountCents: -12500}, transaction, { ...transaction, _id: "legacy-bank", matchedId: "legacy-employee" }, { ...transaction, _id: "free-bank", matchedKind: undefined, matchedId: undefined }],
};
for (const mode of ["memory", "indexed-local"] as const) {
  const seed = JSON.parse(JSON.stringify(fixture));
  const db = mode === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed, { indexed: true }));
  const ctx = { db, capabilities: makeCapabilities({}), principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "payroll-guard-owner", userId, societyId } } as PortableMutationCtx;
  await db.transaction(async () => {
    const refusal = /finalized payroll payment/;
    await assertNativePayrollBankPatch(ctx, transaction, { date: transaction.date, amountCents: transaction.amountCents });
    for (const patch of [{ date: "2026-05-23" }, { amountCents: -149999 }, { category: "Unrelated expense" }]) {
      await assert.rejects(() => updateTransactionPortable(ctx, { id: transaction._id, patch }), refusal);
    }
    await updateTransactionPortable(ctx, { id: transaction._id, patch: { memo: "Reviewed supporting note" } });
    assert.equal((await db.get(transaction._id, "financialTransactions"))!.memo, "Reviewed supporting note");
    await assert.rejects(() => upsertChartAccountPortable(ctx, { societyId, id: "payroll-bank", name: "Synthetic bank", accountType: "Bank", currency: "USD" }), refusal);
    await assert.rejects(() => upsertChartAccountPortable(ctx, { societyId, id: "payroll-bank", name: "Synthetic bank", accountType: "Expense", currency: "CAD" }), refusal);
    await upsertChartAccountPortable(ctx, { societyId, id: "payroll-bank", name: "Renamed synthetic bank", accountType: "Bank", currency: "CAD" });
    assert.equal((await db.get("payroll-bank", "financialAccounts"))!.name, "Renamed synthetic bank");
    await assert.rejects(() => unmatchPortable(ctx, { txnId: transaction._id }), refusal);
    await assert.rejects(() => markManualPortable(ctx, { txnId: transaction._id, note: "Overwrite link" }), refusal);
    await assert.rejects(() => matchPortable(ctx, { txnId: transaction._id, matchedKind: "payroll", matchedId: "legacy-employee" }), refusal);
    await assert.rejects(() => matchPortable(ctx, { txnId: "free-bank", matchedKind: "payroll", matchedId: "native-run" }), /saved payroll calculation/);
    const cra = (await db.get("cra-bank", "financialTransactions"))!;
    await assert.rejects(() => unmatchPortable(ctx, {txnId: "cra-bank"}), refusal);
    await assert.rejects(() => updateTransactionPortable(ctx, {id: "cra-bank", patch:{amountCents:-12499}}), refusal);
    await assert.rejects(() => saveLinesPortable(ctx, {id: "cra-bank", lines:[{id:"a", amountCents:-12500, category:"Other"}]}), refusal);
    await assert.rejects(() => matchPortable(ctx, {txnId: "free-bank", matchedKind:"payroll_remittance", matchedId:"cra-settlement"}), /approved payroll remittance plan/);
    await assertNativePayrollBankPatch(ctx, cra, {amountCents: -12500});
    await unmatchPortable(ctx, { txnId: "legacy-bank" });
    assert.equal((await db.get("legacy-bank", "financialTransactions"))!.matchedKind, undefined, "legacy employee reconciliation still works");
    const bulk = await bulkUpdateTransactionsPortable(ctx, { societyId, ids: [transaction._id], patch: { category: "Unrelated expense" } });
    assert.equal(bulk.updated, 0); assert.equal(bulk.skippedLocked, 1);
    const restored = await restoreTransactionsPortable(ctx, { societyId, rows: [{ id: transaction._id, values: { category: "Unrelated expense" } }] });
    assert.equal(restored.restored, 0); assert.equal(restored.skippedLocked, 1);
    await assert.rejects(() => saveLinesPortable(ctx, { id: transaction._id, lines: [{ id: "a", amountCents: -75000, category: "Payroll" }, { id: "b", amountCents: -75000, category: "Other" }] }), refusal);
    let syncCalled = false;
    const sync = async () => { syncCalled = true; return "external" as const; };
    assert.equal(await patchTransactionWithJournal(ctx, sync, transaction, { category: "Other" }), false);
    assert.equal(syncCalled, false, "no journal mutation occurs after a protected source change");
    await assert.rejects(() => patchTransactionWithJournal(ctx, sync, transaction, { category: "Other" }, { onLocked: "throw" }), refusal);
    const row = (await db.get(transaction._id, "financialTransactions"))!;
    assert.equal(row.amountCents, -150000); assert.equal(row.date, "2026-05-22"); assert.equal(row.category, "Payroll"); assert.equal(row.matchedId, "native-run");
    await requireFunctionAction(ctx, "payroll:savePayRun", "mutation", { societyId, providerRunId: "PROVIDER-2026-ABC", correctionOfProviderRunId: "PREVIOUS-EXTERNAL", lines: [{ providerEmployeeId: "WORKER-22" }] });
    await assert.rejects(() => requireFunctionAction(ctx, "payroll:savePayRun", "mutation", { societyId, correctsRunId: "UNKNOWN-LOCAL-RUN" }), /Record not found/);
  });
}
console.log("Native payroll payment guards passed in memory and indexed-local: immutable settlement facts, reclassification/undo/split/relink protection, descriptive edits, preserved legacy reconciliation and scoped external provider identities.");
