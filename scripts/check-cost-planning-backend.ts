import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import * as planner from "../shared/functions/costPlanning";
import { projectCostPeriod, type CostPeriod, type PlanningCost, type StaffCostPlan } from "../shared/costPlanning";

const societyId = "planner_organization", foreignSocietyId = "foreign_organization", ownerId = "planner_owner", viewerId = "planner_viewer";
const seed = {
  societies: [{ _id: societyId, name: "Student cost planning", jurisdictionCode: "CA-BC", entityType: "society" }, { _id: foreignSocietyId, name: "Elsewhere" }],
  users: [{ _id: ownerId, societyId, role: "Owner", status: "Active", authIssuer: "https://planner.test", authSubject: "planner-owner" }, { _id: viewerId, societyId, role: "Viewer", status: "Active" }],
  financialAccounts: [{ _id: "planner_ar_cad", societyId, accountType: "Asset", subtype: "receivable", code: "1100", currency: "CAD", name: "Accounts receivable" }, { _id: "planner_ar_usd", societyId, accountType: "Asset", subtype: "receivable", code: "USD-AR", currency: "USD", name: "USD receivable" }, { _id: "planner_bank", societyId, accountType: "Bank", currency: "CAD", name: "Chequing" }, { _id: "planner_usd_bank", societyId, accountType: "Bank", currency: "USD", name: "USD chequing" }, { _id: "planner_unknown_bank", societyId, accountType: "Bank", currency: "", name: "Unreviewed account" }, { _id: "foreign_bank", societyId: foreignSocietyId, accountType: "Bank", currency: "CAD", name: "Foreign bank" }],
  invoiceSettings: [{ _id: "planner_settings", societyId, receivableAccountId: "planner_ar_usd" }],
  payrollSettings: [{ _id: "planner_payroll", societyId, providerName: "Recorded provider", payrollAccountNumber: "NEVER-EXPOSE-RP", remitterType: "regular", workersCompProvider: "WorkSafeBC", workersCompAccount: "NEVER-EXPOSE-WCB", workersCompCadence: "annual", workersCompFirstDueDate: "2026-03-01" }],
  employees: [{ _id: "planner_employee", societyId, firstName: "Avery", lastName: "Planner", role: "Coordinator", startDate: "2025-09-01", employmentType: "PartTime", annualSalaryCents: 4500000, hourlyWageCents: 2500, sinSecretVaultItemId: "NEVER-EXPOSE-SIN", birthDate: "1998-02-03", addressLine1: "NEVER-EXPOSE-ADDRESS", email: "private@example.test", phone: "NEVER-EXPOSE-PHONE", notes: "NEVER-EXPOSE-NOTES" }, { _id: "foreign_employee", societyId: foreignSocietyId, firstName: "Foreign", lastName: "Person" }],
  spendBudgets: [{ _id: "planner_budget", societyId, name: "Semester operating budget", currency: "CAD", limitCents: 2000000, startDate: "2026-01-01", endDate: "2026-12-31", memberUserIds: ["PRIVATE-MEMBERSHIP"], notes: "PRIVATE-BUDGET-NOTES" }, { _id: "planner_usd_budget", societyId, name: "USD budget", currency: "USD", limitCents: 2000000, startDate: "2026-01-01" }, { _id: "foreign_budget", societyId: foreignSocietyId, name: "Foreign budget", currency: "CAD", limitCents: 2000000, startDate: "2026-01-01" }],
};
function trackedContext(db: PortableMutationCtx["db"], principal: PortableMutationCtx["principal"], forbidden: string[] = []) {
  let paginations = 0;
  const blocked = new Set(forbidden);
  const proxy = new Proxy(db, { get(target, key) {
    if (key === "query") return (table: string) => {
      assert.ok(!blocked.has(table), `unexpected private/unbounded table read: ${table}`);
      const query = target.query(table);
      const wrapped = new Proxy(query, { get(inner, method) {
        const value = Reflect.get(inner, method);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => { if (method === "paginate") { paginations++; assert.ok(paginations <= 1, "Convex permits only one pagination per invocation"); } const result = value.apply(inner, args); return result === inner ? wrapped : result; };
      } });
      return wrapped;
    };
    if (key === "get") return (id: string, table?: string) => { assert.ok(!table || !blocked.has(table), `unexpected private table get: ${table}`); return target.get(id, table); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { ctx: { db: proxy, principal, capabilities: makeCapabilities({}) } as PortableMutationCtx, count: () => paginations };
}
const owner = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "planner-owner", issuer: "https://planner.test", userId: ownerId, societyId } as const;
const verifiedOwner = { ...owner, assurance: "verified-jwt" } as const;
const financeService = { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "planner-service", actorUserId: ownerId, societyId, scopes: ["financials:read", "financials:write"] } as const;
const period: CostPeriod = { name: "Winter 2026", startDate: "2026-01-01", endDate: "2026-04-30", currency: "CAD", allocationCents: 500000, openingBalanceCents: -10000, reserveCents: 50000, basis: "allocated", includePlanned: true, spendBudgetId: "planner_budget" };
const cost: PlanningCost = { name: "Monthly software", category: "Technology", currency: "CAD", amountCents: 12000, cadence: "monthly", startDate: "2026-01-01", anchorDate: "2026-01-01", status: "committed", sourceKind: "manual" };
const staff: StaffCostPlan = { name: "Student coordinator", employeeId: "planner_employee", currency: "CAD", startDate: "2026-01-01", status: "planned", compensation: "hourly", rateCents: 2500, hoursPerWeek: 10, payFrequency: "biweekly", payAnchorDate: "2026-01-16", vacationPercent: 4, employerPercent: 7, monthlyBenefitsCents: 1000, assumptionsConfirmed: true };

for (const runtime of ["memory", "indexed-local"] as const) {
  const raw = runtime === "memory" ? new MemoryDb({ seed: JSON.parse(JSON.stringify(seed)) }) : new LocalStoreDb(new MemoryRowStore(JSON.parse(JSON.stringify(seed)), { indexed: true }));
  await raw.transaction(async () => {
  const make = (principal: PortableMutationCtx["principal"] = owner, forbidden: string[] = []) => trackedContext(raw, principal, forbidden);
  const ctx = make().ctx;
  const periodId = await planner.savePeriodPortable(ctx, { societyId, fields: { ...period, _id: "forged-id", createdByUserId: "forged-actor" } as any });
  const saved = await raw.get(periodId, "costPlanningPeriods");
  assert.equal(saved!.createdByUserId, ownerId); assert.notEqual(periodId, "forged-id");
  const duplicate = await planner.savePeriodPortable(ctx, { societyId, fields: { ...period, _id: periodId, name: "Summer 2026", startDate: "2026-05-01", endDate: "2026-08-31" } });
  assert.notEqual(duplicate, periodId, "duplicating a term creates an independent saved period");
  await assert.rejects(() => planner.savePeriodPortable(ctx, { societyId, fields: { ...period, spendBudgetId: "foreign_budget" } }), /not found/);
  await assert.rejects(() => planner.savePeriodPortable(ctx, { societyId, fields: { ...period, spendBudgetId: "planner_usd_budget" } }), /currency/);
  await assert.rejects(() => planner.savePeriodPortable(ctx, { societyId, fields: { ...period, endDate: "2026-02-30" } }), /valid/);
  await assert.rejects(() => planner.savePeriodPortable(ctx, { societyId, fields: { ...period, endDate: "2028-01-01" } }), /two calendar years/);
  await assert.rejects(() => planner.savePeriodPortable(ctx, { societyId, fields: { ...period, reserveCents: 1.5 } }), /integer cents/);
  const workspace = await planner.workspacePortable(make().ctx, { societyId, periodId });
  assert.equal(workspace.baseCurrency, "USD", "mapped receivable books currency wins with no organization currency");
  assert.equal(workspace.selectedPeriod!._id, periodId); assert.equal(workspace.selectedBudget!.name, "Semester operating budget");
  assert.equal(workspace.payrollReadiness!.hasPayrollAccount, true); assert.equal(workspace.payrollReadiness!.scheduleComplete, true);
  assert.ok(!JSON.stringify(workspace).includes("NEVER-EXPOSE")); assert.ok(!JSON.stringify(workspace).includes("PRIVATE-MEMBERSHIP"));
  const protectedWorkspace = make(financeService, ["employees", "payrollSettings", "payRuns", "journalEntries", "financialTransactions"]);
  const safeWorkspace = await planner.workspacePortable(protectedWorkspace.ctx, { societyId });
  assert.equal(safeWorkspace.payrollReadiness, null); assert.equal(protectedWorkspace.count(), 1);
  await assert.rejects(() => planner.sourcePagePortable(make(financeService).ctx, { societyId, collection: "employees" }), /Service scope employees:read/);
  const employeeService = { ...financeService, scopes: [...financeService.scopes, "employees:read"] };
  const employees = await planner.sourcePagePortable(make(employeeService).ctx, { societyId, collection: "employees" });
  assert.equal(employees.page.length, 1); assert.equal((employees.page[0] as any).name, "Avery Planner");
  for (const privateField of ["NEVER-EXPOSE", "private@example.test", "4500000", "birthDate", "address", "sinSecret", "hourlyWage", "annualSalary"]) assert.ok(!JSON.stringify(employees).includes(privateField), `${runtime}: private employee field leaked: ${privateField}`);
  const viewer = { ...owner, userId: viewerId };
  await planner.workspacePortable(make(viewer).ctx, { societyId });
  await assert.rejects(() => planner.saveCostPortable(make(viewer).ctx, { societyId, fields: cost }), /financials:write/);
  await assert.rejects(() => planner.workspacePortable(make(verifiedOwner).ctx, { societyId: foreignSocietyId }), /membership/);
  const foreignPeriod = await raw.insert("costPlanningPeriods", { ...period, societyId: foreignSocietyId, archiveState: "active" });
  await assert.rejects(() => planner.workspacePortable(make(verifiedOwner).ctx, { societyId, periodId: foreignPeriod }), /not found/);
  await assert.rejects(() => planner.setArchivedPortable(ctx, { societyId, kind: "period", id: foreignPeriod, archived: true }), /not found/);
  const costId = await planner.saveCostPortable(ctx, { societyId, fields: cost });
  const staffId = await planner.saveStaffPortable(ctx, { societyId, fields: staff });
  await assert.rejects(() => planner.saveStaffPortable(ctx, { societyId, fields: { ...staff, employeeId: "foreign_employee" } }), /not found/);
  await assert.rejects(() => planner.saveStaffPortable(make(financeService).ctx, { societyId, fields: staff }), /employees:read/);
  await planner.saveStaffPortable(make(financeService).ctx, { societyId, id: staffId, fields: { ...staff, rateCents: 2600 } });
  await planner.saveStaffPortable(make(financeService).ctx, { societyId, id: staffId, fields: { ...staff, employeeId: undefined, hoursPerWeek: undefined, monthlyBenefitsCents: undefined } });
  assert.equal((await raw.get(staffId, "staffCostPlans"))!.employeeId, undefined, "manual unlinking is explicit and persists");
  assert.equal((await raw.get(staffId, "staffCostPlans"))!.monthlyBenefitsCents, undefined, "clearing an optional assumption removes its old value");
  const auditBefore = (await raw.get(costId, "costPlanningItems"))!.createdAtISO;
  await planner.setArchivedPortable(ctx, { societyId, kind: "cost", id: costId, archived: true });
  assert.ok((await raw.get(costId, "costPlanningItems"))!.archivedAtISO);
  assert.equal((await planner.sourcePagePortable(make().ctx, { societyId, collection: "costs" })).page.length, 1, "archived reusable costs remain available for restore UI");
  await planner.setArchivedPortable(ctx, { societyId, kind: "cost", id: costId, archived: false });
  assert.equal((await raw.get(costId, "costPlanningItems"))!.archivedAtISO, undefined); assert.equal((await raw.get(costId, "costPlanningItems"))!.createdAtISO, auditBefore);

  const policyId = await raw.insert("insurancePolicies", { societyId, kind: "GeneralLiability", insurer: "Planner insurer", policyNumber: "PLANNER-SAMPLE", startDate: "2025-09-01", endDate: "2026-08-31", renewalDate: "2026-08-31", premiumCents: 100000, policyFeeCents: 10000, totalCostCents: 120000, status: "Active", claimIncidents: [{ notes: "PRIVATE-CLAIM" }], sourceDocumentIds: ["PRIVATE-POLICY-DOC"] });
  const insuranceSource = await planner.sourcePagePortable(make().ctx, { societyId, collection: "insurance" });
  assert.equal((insuranceSource.page[0] as any).requiresCurrency, true); assert.equal((insuranceSource.page[0] as any).currency, null); assert.equal((insuranceSource.page[0] as any).amountCents, 120000);
  assert.ok(!JSON.stringify(insuranceSource).includes("PRIVATE-"));
  await assert.rejects(() => planner.importSourcePortable(ctx, { societyId, kind: "insurance", sourceId: policyId }), /currency.*explicitly/);
  const insuranceCostId = await planner.importSourcePortable(ctx, { societyId, kind: "insurance", sourceId: policyId, currency: "CAD" });
  const insuranceCost = await raw.get(insuranceCostId, "costPlanningItems");
  assert.equal(insuranceCost!.amountCents, 120000); assert.equal(insuranceCost!.anchorDate, "2025-09-01"); assert.equal(insuranceCost!.endDate, undefined, "future renewal estimates continue after the current policy term");
  const insuranceProjection = projectCostPeriod(period, [insuranceCost as PlanningCost], []);
  assert.equal(insuranceProjection.cashCents, 0); assert.equal(insuranceProjection.allocatedCents, 39452, "120 days of an annual policy is allocated without a spurious first two-year cycle");
  await raw.patch(policyId, { totalCostCents: 999999 });
  assert.equal(await planner.importSourcePortable(ctx, { societyId, kind: "insurance", sourceId: policyId, currency: "CAD" }), insuranceCostId);
  assert.equal((await raw.get(insuranceCostId, "costPlanningItems"))!.amountCents, 120000, "re-importing never silently overwrites editable planning assumptions");
  await planner.saveCostPortable(ctx, { societyId, id: insuranceCostId, fields: { ...(insuranceCost as PlanningCost), amountCents: 125000 } });
  await assert.rejects(() => planner.saveCostPortable(ctx, { societyId, fields: { ...cost, sourceKind: "insurance", sourceId: policyId } }), /explicit import/);
  const missingPremium = await raw.insert("insurancePolicies", { societyId, kind: "Other", insurer: "Missing premium", policyNumber: "MISSING", startDate: "2025-09-01", renewalDate: "2026-09-01", status: "Active" });
  await assert.rejects(() => planner.importSourcePortable(ctx, { societyId, kind: "insurance", sourceId: missingPremium, currency: "CAD" }), /premium/);
  const foreignPolicy = await raw.insert("insurancePolicies", { societyId: foreignSocietyId, kind: "Other", insurer: "Foreign", policyNumber: "FOREIGN" });
  await assert.rejects(() => planner.importSourcePortable(ctx, { societyId, kind: "insurance", sourceId: foreignPolicy, currency: "CAD" }), /not found/);
  const subscriptionId = await raw.insert("operatingSubscriptions", { societyId, name: "Document software", category: "Technology", amountCents: 4500, currency: "USD", interval: "month", status: "Paused", nextRenewalDate: "2026-01-15", notes: "Editable supplier record" });
  await assert.rejects(() => planner.importSourcePortable(ctx, { societyId, kind: "subscription", sourceId: subscriptionId, currency: "CAD" }), /does not convert/);
  const subscriptionCostId = await planner.importSourcePortable(ctx, { societyId, kind: "subscription", sourceId: subscriptionId });
  const subscriptionCost = await raw.get(subscriptionCostId, "costPlanningItems"); assert.equal(subscriptionCost!.currency, "USD"); assert.equal(subscriptionCost!.cadence, "monthly"); assert.equal(subscriptionCost!.status, "paused"); assert.equal(subscriptionCost!.startDate, "2026-01-15");
  assert.equal(await planner.importSourcePortable(ctx, { societyId, kind: "subscription", sourceId: subscriptionId }), subscriptionCostId);
  const incompleteSubscription = await raw.insert("operatingSubscriptions", { societyId, name: "Undated", category: "Technology", amountCents: 5000, currency: "CAD", interval: "year", status: "Active" });
  await assert.rejects(() => planner.importSourcePortable(ctx, { societyId, kind: "subscription", sourceId: incompleteSubscription }), /renewal date/);

  for (let index = 0; index < 55; index++) await planner.savePeriodPortable(ctx, { societyId, fields: { ...period, name: `Paged term ${index}` } });
  const first = await planner.workspacePortable(make().ctx, { societyId }); assert.equal(first.periods.length, 50); assert.equal(first.isDone, false);
  const second = await planner.workspacePortable(make().ctx, { societyId, cursor: first.continueCursor, periodId }); assert.equal(second.periods.length, 7); assert.equal(second.selectedPeriod!._id, periodId); assert.equal(second.isDone, true);
  assert.equal(new Set([...first.periods, ...second.periods].map((row) => row._id)).size, 57);
  await assert.rejects(() => planner.workspacePortable(make().ctx, { societyId, archived: true, cursor: first.continueCursor }), /another selection/);
  await planner.setArchivedPortable(ctx, { societyId, kind: "period", id: periodId, archived: true });
  assert.equal((await planner.workspacePortable(make().ctx, { societyId, archived: true })).periods.length, 1);
  await planner.setArchivedPortable(ctx, { societyId, kind: "period", id: periodId, archived: false });
  for (let index = 0; index < 55; index++) await planner.saveCostPortable(ctx, { societyId, fields: { ...cost, name: `Paged cost ${index}` } });
  const firstCosts = await planner.sourcePagePortable(make().ctx, { societyId, collection: "costs" }); const nextCosts = await planner.sourcePagePortable(make().ctx, { societyId, collection: "costs", cursor: firstCosts.continueCursor });
  assert.equal(firstCosts.page.length, 50); assert.equal(nextCosts.page.length, 8); assert.equal(nextCosts.isDone, true);
  await assert.rejects(() => planner.sourcePagePortable(make().ctx, { societyId, collection: "staff", cursor: firstCosts.continueCursor }), /another selection/);

  const unlinked = await planner.savePeriodPortable(ctx, { societyId, fields: { ...period, spendBudgetId: undefined } });
  const noActuals = await planner.sourcePagePortable(make().ctx, { societyId, collection: "actuals", periodId: unlinked }); assert.equal(noActuals.actuals!.linked, false); assert.match(noActuals.actuals!.warning!, /unavailable/);
  for (let index = 0; index < 55; index++) await raw.insert("financialTransactions", { societyId, accountId: "planner_bank", spendBudgetId: "planner_budget", date: "2026-02-01", description: `Actual spending ${index}`, amountCents: -100, status: "posted" });
  const bankLine = { societyId, accountId: "planner_bank", spendBudgetId: "planner_budget", date: "2026-02-01", description: "Excluded line", amountCents: -99999, status: "posted" };
  for (const patch of [{ amountCents: 99999 }, { status: "pending" }, { accountId: "planner_usd_bank" }, { accountId: "planner_unknown_bank" }, { category: "Transfer" }, { spendBudgetId: undefined }, { spendBudgetId: "planner_usd_budget" }, { date: "2025-12-31" }, { date: "2026-05-01" }, { societyId: foreignSocietyId }]) await raw.insert("financialTransactions", { ...bankLine, ...patch });
  await raw.insert("expenseReports", { societyId, spendBudgetId: "planner_budget", amountCents: 999999, status: "paid" });
  let actualCursor: string | null = null; const actualRows: any[] = [];
  do { const invocation = make(owner, ["expenseReports", "payRuns", "journalEntries"]); const page = await planner.sourcePagePortable(invocation.ctx, { societyId, collection: "actuals", periodId, asOf: "2026-04-30", cursor: actualCursor }); assert.equal(invocation.count(), 1); assert.equal(page.actuals!.currency, "CAD"); actualRows.push(...page.page); actualCursor = page.isDone ? null : page.continueCursor; } while (actualCursor);
  assert.equal(actualRows.filter((row) => row.included).length, 55); assert.equal(actualRows.reduce((total, row) => total + row.spendCents, 0), 5500, "actual spending is only posted CAD bank outflow assigned to this budget/window, with no claims or forecast mixed in");
  assert.ok(actualRows.some((row) => row.currency === "USD" && row.excludedReason)); assert.ok(actualRows.some((row) => row.currency === null && row.excludedReason)); assert.ok(actualRows.some((row) => row.status === "pending" && row.excludedReason));
  const corruptLink = await raw.insert("financialTransactions", { ...bankLine, accountId: "foreign_bank" });
  await assert.rejects(() => planner.sourcePagePortable(make().ctx, { societyId, collection: "actuals", periodId }), /not found/); await raw.delete(corruptLink);
  await assert.rejects(() => planner.sourcePagePortable(make().ctx, { societyId, collection: "actuals" }), /saved planning period/);
  assert.equal((await raw.query("payRuns").collect()).length, 0); assert.equal((await raw.query("journalEntries").collect()).length, 0, "forecasts do not post payroll, payments or journals");
  });
  assert.equal((await planner.workspacePortable(trackedContext(raw, owner).ctx, { societyId })).periods.length, 50, `${runtime}: committed records remain queryable through the bounded period index`);
}
console.log("Cost planning backend passed in memory and indexed-local runtimes: persisted assumptions, private projections, scoped imports, currency/ownership validation, archival/pagination and separate complete bank actuals.");
