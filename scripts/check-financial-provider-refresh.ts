import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import { assertProviderConnectionRemovable, importBrowserWaveTransactionsPortable, refreshFinancialProviderDataPortable, type ProviderAccountInput, type ProviderTransactionInput } from "../shared/functions/financialProviderRefresh";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const societyId = "provider-society", ownerId = "provider-owner", connectionId = "provider-connection";
const principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "provider-owner", issuer: "https://provider-refresh.test", userId: ownerId, societyId } as const;
const account: ProviderAccountInput = { externalId: "bank-main", name: "Provider bank", currency: "CAD", accountType: "Bank", balanceCents: 700000, isRestricted: false };
const native: ProviderTransactionInput = { externalId: "pay-native", accountExternalId: account.externalId, date: "2026-06-15", description: "Provider payroll outflow", amountCents: -12345, category: "Provider category" };
const invoice = { ...native, externalId: "invoice-receipt", amountCents: 50000 }, bill = { ...native, externalId: "bill-payment", amountCents: -40000 };
const sourceTransaction = (id: string, input: ProviderTransactionInput, extra = {}) => ({ _id: id, societyId, connectionId, accountId: "provider-account", externalId: input.externalId, date: input.date, description: input.description, amountCents: input.amountCents, ...extra });
const seed = {
  societies: [{ _id: societyId, name: "Provider refresh sample" }, { _id: "foreign", name: "Other organization" }],
  users: [{ _id: ownerId, societyId, role: "Owner", status: "Active", authSubject: principal.subject, authIssuer: principal.issuer }],
  financialConnections: [{ _id: connectionId, societyId, provider: "wave", externalBusinessId: "business-approved", syncMode: "browser", status: "connected" }],
  financialAccounts: [{ _id: "provider-account", societyId, connectionId, ...account, code: "1001", subtype: "chequing", sourceSystem: "wave" }, { _id: "other-account", societyId, connectionId, ...account, externalId: "bank-other", code: "1002" }],
  financialTransactions: [
    sourceTransaction("native-bank", native, { matchedKind: "payroll", matchedId: "native-run", reconciledAtISO: "2026-06-15T18:00:00Z", category: "Payroll payable", accountingAccountId: "payable", memo: "Keep local note", receiptDocumentId: "receipt", tagIds: ["tag"], spendBudgetId: "budget" }),
    sourceTransaction("invoice-bank", invoice, { matchedKind: "invoice", matchedId: "invoice", category: "Accounts receivable", reconciledAtISO: "2026-06-15T18:00:00Z" }),
    sourceTransaction("bill-bank", bill, { matchedKind: "bill", matchedId: "bill", category: "Accounts payable", reconciledAtISO: "2026-06-15T18:00:00Z" }),
    sourceTransaction("omitted-bank", { ...native, externalId: "omitted-source" }, { matchedKind: "payroll", matchedId: "native-run" }),
    sourceTransaction("manual-bank", { ...native, externalId: "manually-coded", amountCents: -11000 }, { category: "Local category", categorizedBy: "manual", ruleId: "rule", lines: [{ amountCents: -11000, category: "Local allocation" }], reviewedAtISO: "2026-06-16T00:00:00Z" }),
    sourceTransaction("posted-bank", { ...native, externalId: "posted-unmatched", amountCents: -22000 }),
  ],
  payRuns: [{ _id: "native-run", societyId, calculationId: "calculation" }],
  payrollCalculations: [{ _id: "calculation", societyId, status: "finalized", payments: [{ transactionId: "native-bank", amountCents: 12345, date: native.date }] }],
  invoices: [{ _id: "invoice", societyId, payments: [{ transactionId: "invoice-bank", amountCents: 50000 }] }],
  bills: [{ _id: "bill", societyId, payments: [{ transactionId: "bill-bank", amountCents: 40000 }] }],
  journalEntries: [{ _id: "posted-entry", societyId, status: "posted", source: "financialTransactionBackfill" }],
  journalLines: [{ _id: "posted-line", societyId, journalEntryId: "posted-entry", financialTransactionId: "posted-bank", amountCents: 22000 }],
};
const previousBinding = process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON;
process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = JSON.stringify({ [societyId]: "business-approved" });
try {
  for (const runtime of ["memory", "indexed-local"] as const) {
    const db = runtime === "memory" ? new MemoryDb({ seed: structuredClone(seed) }) : new LocalStoreDb(new MemoryRowStore(structuredClone(seed), { indexed: true }));
    const ctx = { db, principal, capabilities: makeCapabilities({}) } as PortableMutationCtx;
    const refresh = (accounts = [account], transactions = [native, invoice, bill]) => db.transaction(() => refreshFinancialProviderDataPortable(ctx, { societyId, connectionId, accounts, transactions }));
    const first = await refresh();
    assert.equal(first.insertedAccounts, 0); assert.equal(first.insertedTransactions, 0); assert.equal(first.updatedTransactions, 3);
    assert.equal(first.retainedAccounts, 1); assert.equal(first.retainedTransactions, 3);
    const preserved = await db.get("native-bank", "financialTransactions");
    assert.equal(preserved?.matchedId, "native-run"); assert.equal(preserved?.category, "Payroll payable"); assert.equal(preserved?.receiptDocumentId, "receipt"); assert.equal(preserved?.memo, "Keep local note");
    assert.deepEqual(preserved?.tagIds, ["tag"]); assert.equal((await db.get("provider-account", "financialAccounts"))?.code, "1001");
    assert.ok(await db.get("omitted-bank", "financialTransactions"), "a missing provider row retains its actual payment evidence");
    assert.equal((await db.get("calculation", "payrollCalculations"))?.payments[0].transactionId, "native-bank");
    assert.equal((await db.get("invoice", "invoices"))?.payments[0].transactionId, "invoice-bank");
    assert.equal((await db.get("bill", "bills"))?.payments[0].transactionId, "bill-bank");
    const sameAgain = await refresh([account], [{ ...native, description: "Refreshed provider description" }, invoice, bill]);
    assert.equal(sameAgain.insertedTransactions, 0); assert.equal((await db.get("native-bank", "financialTransactions"))?.description, "Refreshed provider description", "unchanged source facts refresh successfully after payment");
    for (const changed of [{ ...native, amountCents: -12346 }, { ...native, date: "2026-06-16" }, { ...native, accountExternalId: "bank-other" }]) {
      await assert.rejects(refresh([account], [changed]), /recorded payment|finalized payroll/);
    }
    await assert.rejects(refresh([{ ...account, currency: "USD" }]), /currency and account type/);
    await assert.rejects(refresh([{ ...account, accountType: "Asset" }]), /currency and account type/);
    assert.equal((await db.get("provider-account", "financialAccounts"))?.currency, "CAD");
    for (const source of [invoice, bill]) await assert.rejects(refresh([account], [{ ...source, amountCents: source.amountCents + 1 }]), /recorded payment/);
    await assert.rejects(refresh([account], [{ ...native, externalId: "posted-unmatched", amountCents: -22001 }]), /posted journal/);
    await assert.rejects(refresh([account], [{ ...native, accountExternalId: "source-missing" }]), /missing from the source/);
    await assert.rejects(refresh([account], [native, { ...native, amountCents: -1 }]), /conflicting duplicate/);
    await assert.rejects(db.transaction(() => assertProviderConnectionRemovable(ctx, societyId, connectionId)), /recorded payment|posted bank journal/);
    const coded = await refresh([account], [{ ...native, externalId: "manually-coded", amountCents: -11000, category: "Provider overwrite" }]);
    assert.equal(coded.updatedTransactions, 1); assert.equal((await db.get("manual-bank", "financialTransactions"))?.category, "Local category");
    const inserted = await refresh([account], [{ ...native, externalId: "new-source", amountCents: 100 }]);
    assert.equal(inserted.insertedTransactions, 1);
    const imported = await db.transaction(() => importBrowserWaveTransactionsPortable(ctx, { societyId, businessId: "business-approved", accounts: [account], transactions: [native] }));
    assert.equal(imported.connectionId, connectionId); assert.equal(imported.insertedTransactions, 0);
    await assert.rejects(db.transaction(() => importBrowserWaveTransactionsPortable(ctx, { societyId, businessId: "foreign-business", accounts: [], transactions: [] })), /not assigned/);
    await assert.rejects(db.transaction(() => importBrowserWaveTransactionsPortable(ctx, { societyId, businessId: "business-approved", profileKey: "profile", profileSocietyId: "foreign", accounts: [], transactions: [] })), /another society/);
    await assert.rejects(db.transaction(() => refreshFinancialProviderDataPortable(ctx, { societyId: "foreign", connectionId, accounts: [], transactions: [] })), /not found/);
    await db.transaction(() => db.insert("financialConnections", { _id: "clean-connection", societyId, provider: "wave" }));
    await assertProviderConnectionRemovable(ctx, societyId, "clean-connection");
  }
  const hosted = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./authorization.js": () => import("../convex/authorization"),
    "./financialHub.js": () => import("../convex/financialHub"),
  });
  const issuer = betterAuthIssuer();
  const fixture = await hosted.run(async ctx => {
    const now = new Date().toISOString();
    const societyId = await ctx.db.insert("societies", { name: "Hosted source refresh sample", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    await ctx.db.insert("users", { societyId, displayName: "Provider owner", email: "provider@example.test", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "provider-hosted-owner", createdAtISO: now });
    const connectionId = await ctx.db.insert("financialConnections", { societyId, provider: "wave", status: "connected", demo: true, externalBusinessId: "business-approved", syncMode: "browser", connectedAtISO: now });
    const accountId = await ctx.db.insert("financialAccounts", { societyId, connectionId, ...account, balanceCents: 700000, code: "1001" });
    const calculationId = await ctx.db.insert("payrollCalculations", { societyId, year: 2026, periodStart: "2026-06-01", periodEnd: "2026-06-15", payDate: "2026-06-15", runType: "regular", employeeIds: [], status: "finalized", inputJson: "{}", resultJson: "{}", sourceFingerprint: "fixture", resultFingerprint: "fixture", version: 1, createdByUserId: "fixture", updatedByUserId: "fixture", createdAtISO: now, updatedAtISO: now });
    const payRunId = await ctx.db.insert("payRuns", { societyId, periodStart: "2026-06-01", periodEnd: "2026-06-15", payDate: "2026-06-15", grossCents: 12345, cppEmployeeCents: 0, eiEmployeeCents: 0, incomeTaxCents: 0, cppEmployerCents: 0, eiEmployerCents: 0, netCents: 12345, calculationId, source: "native", createdAtISO: now, updatedAtISO: now });
    const transactionId = await ctx.db.insert("financialTransactions", { societyId, connectionId, accountId, externalId: native.externalId, date: native.date, description: native.description, amountCents: native.amountCents, matchedKind: "payroll", matchedId: payRunId, reconciledAtISO: now, category: "Payroll payable", memo: "Retain actual source" });
    await ctx.db.patch(calculationId, { payments: [{ key: "payment", transactionId, date: native.date, amountCents: 12345, reference: "Actual outflow", recordedByUserId: "fixture", recordedAtISO: now }] });
    return { societyId, connectionId, accountId, transactionId, calculationId };
  });
  process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = JSON.stringify({ [fixture.societyId]: "business-approved" });
  const owner = hosted.withIdentity({ issuer, subject: "provider-hosted-owner" });
  // Both real registered source entry points validate against the full schema.
  await hosted.mutation(internal.financialHub._replaceSyncedData, { societyId: fixture.societyId, connectionId: fixture.connectionId, accounts: [{ ...account, balanceCents: 800000 }], transactions: [native] });
  const publicArgs = { societyId: fixture.societyId, businessId: "business-approved", accounts: [account], transactions: [native] };
  assert.equal((await owner.mutation(api.financialHub.importBrowserWaveTransactions, publicArgs)).connectionId, fixture.connectionId);
  await assert.rejects(owner.mutation(api.financialHub.importBrowserWaveTransactions, { ...publicArgs, transactions: [{ ...native, amountCents: -12346 }] }), /recorded payment|finalized payroll/);
  await assert.rejects(hosted.mutation(internal.financialHub._replaceSyncedData, { societyId: fixture.societyId, connectionId: fixture.connectionId, accounts: [{ ...account, balanceCents: 0, currency: "USD" }], transactions: [native] }), /currency and account type/);
  await hosted.mutation(internal.financialHub._replaceSyncedData, { societyId: fixture.societyId, connectionId: fixture.connectionId, accounts: [], transactions: [] });
  const retained = await hosted.run(async ctx => ({ bank: await ctx.db.get(fixture.transactionId), account: await ctx.db.get(fixture.accountId), calculation: await ctx.db.get(fixture.calculationId) }));
  assert.equal(retained.bank?.matchedKind, "payroll"); assert.equal(retained.bank?.memo, "Retain actual source");
  assert.equal(retained.account?.currency, "CAD"); assert.equal(retained.account?.code, "1001");
  assert.equal(retained.calculation?.payments?.[0].transactionId, fixture.transactionId);
  await hosted.run(ctx => ctx.db.patch(fixture.connectionId, { demo: true }));
  await assert.rejects(owner.mutation(api.financialHub.removeDemoData, { societyId: fixture.societyId }), /recorded payment|posted bank journal/);
} finally {
  if (previousBinding === undefined) delete process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON;
  else process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = previousBinding;
}
console.log("Financial provider refresh checks passed (hosted Convex functions + memory + indexed local): stable IDs, native/invoice/bill payment references, missing source retention, immutable posted facts, local metadata, unchanged refreshes, source ownership and operator bindings.");
