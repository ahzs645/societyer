import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from "../shared/portable/index";
import { upsertJournalEntryPortable, generalLedgerPortable, postTransactionCandidateAllocationPortable } from "../shared/functions/accounting";
import { upsertBudgetPortable, budgetsPortable } from "../shared/functions/financialHub";
import { budgetVariancePortable } from "../shared/functions/treasury";
import { buildProgramSummary } from "../shared/accountingStatements";
const db = new MemoryDb({ seed: {} });
const runtime = () => new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "program-fixture-owner" }) });
const mutate = (name: string, handler: any) => runtime().register(definePortableMutation({ name, handler })).runMutation(name, {});
const query = (name: string, handler: any) => runtime().register(definePortableQuery({ name, handler })).runQuery(name, {});
const seed = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Program accounting fixture", fiscalYearEnd: "12-31" });
  await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", authSubject: "program-fixture-owner" });
  const cash = await ctx.db.insert("financialAccounts", { societyId, name: "Bank", accountType: "Bank", currency: "CAD" });
  const expense = await ctx.db.insert("financialAccounts", { societyId, name: "Communications", accountType: "Expense", currency: "CAD" });
  const foreignSociety = await ctx.db.insert("societies", { name: "Foreign society" });
  const foreignAccount = await ctx.db.insert("financialAccounts", { societyId: foreignSociety, name: "Foreign", accountType: "Expense", currency: "CAD" });
  const candidate = await ctx.db.insert("transactionCandidates", { societyId, transactionDate: "2025-06-02", amountCents: -300, description: "Candidate communications", status: "NeedsReview" });
  return { societyId, cash, expense, foreignAccount, candidate };
});
await mutate("journal", (ctx: any) => upsertJournalEntryPortable(ctx, {
  societyId: seed.societyId, date: "2025-06-01", memo: "Education materials", source: "manual", status: "posted", fiscalYear: "2025",
  lines: [{ accountId: seed.cash, side: "credit", amountCents: 500 }, { accountId: seed.expense, side: "debit", amountCents: 500, programCode: "101-9 EDUCATION" }],
}));
await mutate("allocation", (ctx: any) => postTransactionCandidateAllocationPortable(ctx, {
  transactionCandidateId: seed.candidate, cashAccountId: seed.cash,
  allocations: [{ accountId: seed.expense, amountCents: 300, programCode: " 101-9 EDUCATION " }], fiscalYear: "2025",
}));
const budgetArgs = { societyId: seed.societyId, fiscalYear: "2025", category: "Communications", plannedCents: 1000, programCode: "101-9 EDUCATION", accountId: seed.expense, currency: "CAD" };
await mutate("budget", (ctx: any) => upsertBudgetPortable(ctx, budgetArgs));
await assert.rejects(() => mutate("foreign-budget", (ctx: any) => upsertBudgetPortable(ctx, { ...budgetArgs, accountId: seed.foreignAccount })));
await assert.rejects(() => mutate("wrong-currency", (ctx: any) => upsertBudgetPortable(ctx, { ...budgetArgs, currency: "USD" })));
await assert.rejects(() => mutate("fractional-budget", (ctx: any) => upsertBudgetPortable(ctx, { ...budgetArgs, plannedCents: 0.5 })));
await assert.rejects(() => mutate("bank-budget", (ctx: any) => upsertBudgetPortable(ctx, { ...budgetArgs, accountId: seed.cash })));
const ledger: any = await query("ledger", (ctx: any) => generalLedgerPortable(ctx, { societyId: seed.societyId }));
const budgets: any = await query("budgets", (ctx: any) => budgetsPortable(ctx, { societyId: seed.societyId, fiscalYear: "2025" }));
assert.equal(ledger.filter((line: any) => line.programCode === "101-9 EDUCATION").length, 2);
const programs = buildProgramSummary(ledger, budgets, "2025-01-01", "2025-12-31", "2025");
assert.equal(programs[0].actualCents, 800); assert.equal(programs[0].budgetCents, 1000); assert.equal(programs[0].varianceCents, -200);
const legacy: any = await query("legacy-variance", (ctx: any) => budgetVariancePortable(ctx, { societyId: seed.societyId, fiscalYear: "2025" }));
assert.deepEqual(legacy, [], "Program budgets must not be counted using whole-category bank actuals.");
console.log("Portable program tracking passed: journal/candidate code persistence, budget/actual grouping, tenant and currency rejection, cents validation, legacy summary isolation.");
