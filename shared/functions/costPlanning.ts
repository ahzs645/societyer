import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { hasPermission, requirePermissionPortable } from "./permissions";
import { validateCostPeriod, validatePlanningCost, validateStaffCostPlan, type CostPeriod, type PlanningCost, type StaffCostPlan } from "../costPlanning";
import { isCalendarDate } from "../invoicing";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import { organizationRuleScope } from "../entityRuleScope";
import { scheduleIsComplete } from "../businessRegisters";
import { isInternalTransfer } from "../transferCategories";

type Ctx = PortableQueryCtx;
type Row = { _id: string; societyId: string; [key: string]: any };
type Collection = "costs" | "staff" | "insurance" | "subscriptions" | "employees" | "budgets" | "actuals";
type ActualBankCostRecord = { _id: string; date: string; description: string; amountCents: number; spendCents: number; currency: string | null; status: string; included: boolean; excludedReason?: string };
const now = () => new Date().toISOString();
const sourceTables = { insurance: "insurancePolicies", subscription: "operatingSubscriptions" } as const;
const planningTables = { period: "costPlanningPeriods", cost: "costPlanningItems", staff: "staffCostPlans" } as const;
const label = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const explicitCurrency = (value: unknown) => { const result = label(value, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(result) || String(value ?? "").trim().length !== 3) throw new Error("Record an explicit three-letter source currency."); return result; };
async function read(ctx: Ctx, societyId: string) { return requirePermissionPortable(ctx, societyId, "financials:read"); }
async function write(ctx: Ctx, societyId: string) { return requirePermissionPortable(ctx, societyId, "financials:write"); }
function canReadEmployees(ctx: Ctx, role: unknown) { return hasPermission(String(role), "employees:read") && (ctx.principal.kind !== "service" || ctx.principal.scopes.some((scope) => ["*", "employees:*", "employees:read"].includes(scope))); }
function pageCursor(raw: string | null | undefined, scope: string) {
  if (!raw) return null;
  let value; try { value = JSON.parse(raw); } catch { throw new Error("Invalid planning page. Return to the first page."); }
  if (!value || value.scope !== scope || typeof value.cursor !== "string") throw new Error("This planning page belongs to another selection. Return to the first page.");
  return value.cursor as string;
}
function finishPage<T>(result: { page: T[]; isDone: boolean; continueCursor: string }, scope: string) { return { ...result, continueCursor: result.isDone ? "" : JSON.stringify({ scope, cursor: result.continueCursor }) }; }
async function organizationContext(ctx: Ctx, societyId: string) {
  const organization = await getOwnedOrganization(ctx, societyId);
  const today = resolutionCalendarDate(now(), resolutionTimeZone(organization)) ?? now().slice(0, 10);
  return { organization, today };
}
async function getOwnedOrganization(ctx: Ctx, societyId: string) { const found = await ctx.db.get(societyId, "societies"); if (!found) throw new Error("Organization not found."); return found; }

/** Same receivable-before-bank denomination precedence as the billing ledger,
 * using bounded metadata reads rather than loading journals/catalog/payroll. */
export async function booksCurrency(ctx: Ctx, societyId: string): Promise<{ baseCurrency: string | null; baseCurrencyWarning: string | null }> {
  const missing = { baseCurrency: null, baseCurrencyWarning: "The books currency could not be resolved unambiguously. Choose the planning currency explicitly; no source amount is converted." };
  const denomination = (row?: Row | null) => { try { return row ? explicitCurrency(row.currency) : null; } catch { return null; } };
  const result = (row?: Row | null) => { const baseCurrency = denomination(row); return baseCurrency ? { baseCurrency, baseCurrencyWarning: null } : missing; };
  const settings = await ctx.db.query<Row>("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first();
  if (settings?.receivableAccountId) return result(await getOwned<Row>(ctx, "financialAccounts", settings.receivableAccountId, societyId));
  const canonical = await ctx.db.query<Row>("financialAccounts").withIndex("by_society_code", (q) => q.eq("societyId", societyId).eq("code", "1100")).take(3);
  const receivable = canonical.filter((account) => account.accountType === "Asset" && account.subtype === "receivable");
  if (receivable.length > 1) return missing;
  if (receivable.length === 1) return result(receivable[0]);
  const typed = await ctx.db.query<Row>("financialAccounts").withIndex("by_society_type_subtype", (q) => q.eq("societyId", societyId).eq("accountType", "Asset").eq("subtype", "receivable")).take(2);
  if (typed.length > 1) return missing;
  if (typed.length) return result(typed[0]);
  const assets = await ctx.db.query<Row>("financialAccounts").withIndex("by_society_type", (q) => q.eq("societyId", societyId).eq("accountType", "Asset")).take(51);
  if (assets.length > 50) return missing;
  const named = assets.filter((account) => /accounts receivable/i.test(account.name ?? ""));
  if (named.length > 1) return missing;
  if (named.length) return result(named[0]);
  const banks = await ctx.db.query<Row>("financialAccounts").withIndex("by_society_type", (q) => q.eq("societyId", societyId).eq("accountType", "Bank")).take(2);
  if (banks.length !== 1) return missing;
  return result(banks[0]);
}

async function payrollReadiness(ctx: Ctx, societyId: string) {
  const settings = await ctx.db.query<Row>("payrollSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first();
  return { settingsSaved: Boolean(settings), providerName: label(settings?.providerName) || undefined, hasPayrollAccount: Boolean(settings?.payrollAccountNumber), remitterType: settings?.remitterType,
    scheduleComplete: Boolean(settings && scheduleIsComplete({ remitterType: settings.remitterType, cadence: settings.cadence, dueRule: settings.dueRule, dueValue: settings.dueValue })),
    workersCompProvider: label(settings?.workersCompProvider) || undefined, hasWorkersCompAccount: Boolean(settings?.workersCompAccount), workersCompCadence: settings?.workersCompCadence, workersCompFirstDueDate: settings?.workersCompFirstDueDate };
}
function budgetProjection(row: Row) { return { _id: row._id, name: row.name, currency: row.currency, limitCents: row.limitCents, startDate: row.startDate, endDate: row.endDate, archivedAtISO: row.archivedAtISO }; }

export async function workspacePortable(ctx: Ctx, args: { societyId: string; periodId?: string; cursor?: string | null; archived?: boolean }) {
  const user = await read(ctx, args.societyId), scope = JSON.stringify([args.societyId, "periods", Boolean(args.archived)]);
  const [page, selectedPeriod, organization, currency, readiness] = await Promise.all([
    ctx.db.query<Row>("costPlanningPeriods").withIndex("by_society_archive", (q) => q.eq("societyId", args.societyId).eq("archiveState", args.archived ? "archived" : "active")).order("desc").paginate({ numItems: 50, cursor: pageCursor(args.cursor, scope), maximumBytesRead: 1_500_000 }),
    args.periodId ? getOwned<Row>(ctx, "costPlanningPeriods", args.periodId, args.societyId) : Promise.resolve(null),
    organizationContext(ctx, args.societyId), booksCurrency(ctx, args.societyId), canReadEmployees(ctx, user.role) ? payrollReadiness(ctx, args.societyId) : Promise.resolve(null),
  ]);
  const paginated = finishPage(page, scope);
  const selectedBudget = selectedPeriod?.spendBudgetId ? budgetProjection(await getOwned<Row>(ctx, "spendBudgets", selectedPeriod.spendBudgetId, args.societyId)) : null;
  return { periods: paginated.page, selectedPeriod, selectedBudget, isDone: paginated.isDone, continueCursor: paginated.continueCursor, today: organization.today, ...currency,
    jurisdiction: organizationRuleScope(organization.organization).jurisdictionCode, organization: { name: organization.organization.name },
    links: { payroll: "/app/payroll?setup=1", employees: "/app/employees", spendBudgets: "/app/financials/spend" }, payrollReadiness: readiness };
}

function annualSourceDates(row: Row) {
  if (!isCalendarDate(row.startDate) || !isCalendarDate(row.renewalDate) || (row.endDate && !isCalendarDate(row.endDate))) throw new Error("Record exact insurance coverage and renewal dates before importing.");
  const [year, month, day] = row.startDate.split("-").map(Number);
  const anniversary = new Date(Date.UTC(year + 1, month - 1, Math.min(day, new Date(Date.UTC(year + 1, month, 0)).getUTCDate()))).toISOString().slice(0, 10);
  const finalDay = new Date(Date.parse(`${anniversary}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (![anniversary, finalDay].includes(row.endDate ?? row.renewalDate) || ![anniversary, finalDay].includes(row.renewalDate)) throw new Error("This policy does not record a consistent annual coverage term. Enter its cost manually with the correct cadence.");
  return { startDate: row.startDate, anchorDate: row.startDate };
}
function insuranceAmount(row: Row) {
  const amount = row.totalCostCents != null ? row.totalCostCents : row.premiumCents != null ? row.premiumCents + (row.policyFeeCents ?? 0) : undefined;
  if (amount == null || !Number.isSafeInteger(amount) || amount < 0 || (row.totalCostCents == null && [row.premiumCents, row.policyFeeCents ?? 0].some((value) => !Number.isSafeInteger(value) || value < 0))) throw new Error("Record an explicit insurance premium and any fee, or a total cost, before importing.");
  return amount as number;
}
function sourceDraft(kind: "insurance" | "subscription", row: Row, confirmedCurrency?: string): PlanningCost {
  if (kind === "insurance") {
    const currency = row.currency ? explicitCurrency(row.currency) : confirmedCurrency ? explicitCurrency(confirmedCurrency) : (() => { throw new Error("Insurance has no recorded currency. Confirm the premium currency explicitly before importing."); })();
    if (row.currency && confirmedCurrency && currency !== explicitCurrency(confirmedCurrency)) throw new Error("Keep the source's recorded currency; importing does not convert amounts.");
    const dates = annualSourceDates(row), amountCents = insuranceAmount(row);
    if (!["Active", "NeedsReview", "Lapsed", "Cancelled"].includes(row.status)) throw new Error("Review the insurance policy status before importing.");
    return validatePlanningCost({ name: label(`${label(row.kind)} · ${label(row.insurer)}`), category: "Insurance", currency, amountCents, cadence: "annual", ...dates, status: row.status === "Active" ? "committed" : row.status === "Cancelled" ? "paused" : "planned", sourceKind: kind, sourceId: row._id,
      notes: `Annual renewal estimate from policy ${label(row.policyNumber)}. Coverage ${row.startDate} to ${row.endDate ?? row.renewalDate}; renewal ${row.renewalDate}. Assumed payment at coverage start; future renewals keep this amount until edited. Currency explicitly confirmed as ${currency}.` });
  }
  const cadences: Record<string, PlanningCost["cadence"]> = { week: "weekly", month: "monthly", quarter: "quarterly", year: "annual", weekly: "weekly", monthly: "monthly", quarterly: "quarterly", annual: "annual" };
  const cadence = cadences[row.interval];
  if (!cadence || !isCalendarDate(row.nextRenewalDate)) throw new Error("Record a supported subscription interval and exact next renewal date before importing.");
  if (!["Active", "Planned", "Paused"].includes(row.status)) throw new Error("Review the subscription status before importing.");
  const currency = explicitCurrency(row.currency);
  if (confirmedCurrency && currency !== explicitCurrency(confirmedCurrency)) throw new Error("Keep the subscription's recorded currency; importing does not convert amounts.");
  return validatePlanningCost({ name: row.name, category: row.category || "Subscriptions", currency, amountCents: row.amountCents, cadence, startDate: row.nextRenewalDate, anchorDate: row.nextRenewalDate, status: row.status === "Active" ? "committed" : row.status === "Paused" ? "paused" : "planned", sourceKind: kind, sourceId: row._id, notes: `${label(row.vendorName) ? `Vendor: ${label(row.vendorName)}. ` : ""}Forecast starts at the recorded next renewal date; earlier coverage is not inferred.${row.notes ? ` ${label(row.notes, 1500)}` : ""}` });
}

export async function sourcePagePortable(ctx: Ctx, args: { societyId: string; collection: Collection; cursor?: string | null; periodId?: string; asOf?: string }) {
  await read(ctx, args.societyId);
  if (!["costs", "staff", "insurance", "subscriptions", "employees", "budgets", "actuals"].includes(args.collection)) throw new Error("Choose a supported planning source.");
  if (args.collection === "employees") await requirePermissionPortable(ctx, args.societyId, "employees:read");
  const scope = JSON.stringify([args.societyId, args.collection, args.periodId ?? "", args.asOf ?? ""]), cursor = pageCursor(args.cursor, scope);
  const { today } = await organizationContext(ctx, args.societyId);
  if (args.collection === "actuals") {
    if (!args.periodId) throw new Error("Select a saved planning period before loading actual bank spending.");
    const period = await getOwned<Row>(ctx, "costPlanningPeriods", args.periodId, args.societyId);
    if (args.asOf && (!isCalendarDate(args.asOf) || args.asOf > today)) throw new Error("Choose an actuals as-of date on or before today.");
    const asOf = args.asOf ?? today, to = period.endDate < asOf ? period.endDate : asOf;
    const actuals = { linked: Boolean(period.spendBudgetId), scope: "bank-budget-outflows", budgetId: period.spendBudgetId ?? null, budgetName: null as string | null, currency: period.currency, from: period.startDate, to, asOf, warning: null as string | null };
    if (!period.spendBudgetId) return { page: [], isDone: true, continueCursor: "", actuals: { ...actuals, warning: "Link this saved period to a spend budget to load its bank spending. Unlinked actuals are unavailable." } };
    const budget = await getOwned<Row>(ctx, "spendBudgets", period.spendBudgetId, args.societyId);
    if (budget.currency !== period.currency) throw new Error("The linked spend budget currency differs from the planning period. Choose a matching budget.");
    actuals.budgetName = budget.name;
    if (to < period.startDate) return { page: [], isDone: true, continueCursor: "", actuals: { ...actuals, warning: "The selected actuals date is before this period starts; no in-period bank spending has occurred yet." } };
    const result = await ctx.db.query<Row>("financialTransactions").withIndex("by_society_budget_date", (q) => q.eq("societyId", args.societyId).eq("spendBudgetId", period.spendBudgetId).gte("date", period.startDate).lte("date", to)).order("desc").paginate({ numItems: 50, cursor, maximumBytesRead: 2_000_000 });
    const accounts = new Map<string, Row>();
    const page: ActualBankCostRecord[] = [];
    for (const row of result.page) {
      if (!Number.isSafeInteger(row.amountCents)) throw new Error("A linked bank amount is invalid; review the source before totaling actuals.");
      if (row.amountCents >= 0) continue;
      let account = accounts.get(row.accountId); if (!account) { account = await getOwned<Row>(ctx, "financialAccounts", row.accountId, args.societyId); accounts.set(row.accountId, account); }
      let currency: string | null = null; try { currency = explicitCurrency(account.currency); } catch { /* An unknown denomination must remain visibly excluded. */ }
      const excludedReason = !["Bank", "Credit"].includes(account.accountType) ? "The source is not a bank or card account." : !currency ? "The bank account has no explicit source currency." : currency !== period.currency ? `Recorded in ${currency}; no exchange conversion is assumed.` : row.status && row.status !== "posted" ? "The bank record is not posted." : isInternalTransfer(row) ? "Internal transfers are excluded from spending." : undefined;
      page.push({ _id: row._id, date: row.date, description: label(row.description, 500), amountCents: row.amountCents, spendCents: excludedReason ? 0 : -row.amountCents, currency, status: row.status ?? "recorded", included: !excludedReason, excludedReason });
    }
    return { ...finishPage({ ...result, page }, scope), actuals };
  }
  const table = ({ costs: "costPlanningItems", staff: "staffCostPlans", insurance: "insurancePolicies", subscriptions: "operatingSubscriptions", employees: "employees", budgets: "spendBudgets" } as const)[args.collection];
  const result = await ctx.db.query<Row>(table).withIndex("by_society", (q) => q.eq("societyId", args.societyId)).order("desc").paginate({ numItems: 50, cursor, maximumBytesRead: 2_000_000 });
  const page = await Promise.all(result.page.map(async (row) => {
    if (args.collection === "costs" || args.collection === "staff") return row;
    if (args.collection === "employees") return { _id: row._id, name: `${label(row.firstName)} ${label(row.lastName)}`.trim(), position: label(row.role), employmentType: row.employmentType, startDate: row.startDate, endDate: row.endDate, status: row.startDate > today ? "upcoming" : row.endDate && row.endDate < today ? "ended" : "active" };
    if (args.collection === "budgets") return budgetProjection(row);
    const kind = args.collection === "insurance" ? "insurance" : "subscription";
    const imported = await ctx.db.query<Row>("costPlanningItems").withIndex("by_society_source", (q) => q.eq("societyId", args.societyId).eq("sourceKind", kind).eq("sourceId", row._id)).first();
    let amountCents: number | null = null, cadence: PlanningCost["cadence"] | null = null, missingReason: string | null = null;
    try {
      if (kind === "insurance" && !row.currency) {
        // Inspect completeness without inventing a denomination. The actual
        // import still requires the user's explicit currency confirmation.
        annualSourceDates(row); amountCents = insuranceAmount(row); cadence = "annual";
        if (!["Active", "NeedsReview", "Lapsed", "Cancelled"].includes(row.status)) throw new Error("Review the insurance policy status before importing.");
      } else { const draft = sourceDraft(kind, row); amountCents = draft.amountCents; cadence = draft.cadence; }
    } catch (error) { missingReason = error instanceof Error ? error.message : "Review this source before importing."; }
    let sourceCurrency: string | null = null; if (row.currency) { try { sourceCurrency = explicitCurrency(row.currency); } catch { /* Keep an invalid source denomination visibly unknown. */ } }
    return { _id: row._id, name: kind === "insurance" ? label(`${label(row.kind)} · ${label(row.insurer)}`) : label(row.name), category: kind === "insurance" ? "Insurance" : label(row.category), amountCents, currency: sourceCurrency, cadence, status: row.status, startDate: kind === "insurance" ? row.startDate : row.nextRenewalDate, endDate: kind === "insurance" ? row.endDate : undefined, renewalDate: kind === "insurance" ? row.renewalDate : row.nextRenewalDate, requiresCurrency: kind === "insurance" && !row.currency, importable: !missingReason, missingReason, importedCostId: imported?._id ?? null };
  }));
  return finishPage({ ...result, page }, scope);
}

async function audit(ctx: PortableMutationCtx, societyId: string) { const atISO = now(), userId = await principalUserId(ctx, societyId); return { createdByUserId: userId, createdAtISO: atISO, updatedByUserId: userId, updatedAtISO: atISO, archiveState: "active" }; }
export async function savePeriodPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; fields: CostPeriod }) {
  await write(ctx, args.societyId); const fields = validateCostPeriod(args.fields); const { _id: _ignored, ...clean } = fields;
  if (fields.spendBudgetId) { const budget = await getOwned<Row>(ctx, "spendBudgets", fields.spendBudgetId, args.societyId); if (budget.currency !== fields.currency) throw new Error("Choose a spend budget in the planning period's currency."); }
  const attribution = await audit(ctx, args.societyId);
  if (args.id) { await getOwned(ctx, "costPlanningPeriods", args.id, args.societyId); await ctx.db.patch(args.id, { ...clean, spendBudgetId: clean.spendBudgetId, updatedByUserId: attribution.updatedByUserId, updatedAtISO: attribution.updatedAtISO }); return args.id; }
  return ctx.db.insert("costPlanningPeriods", { societyId: args.societyId, ...clean, ...attribution });
}
export async function saveCostPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; fields: PlanningCost }) {
  await write(ctx, args.societyId); const { _id: _ignored, ...fields } = validatePlanningCost(args.fields), attribution = await audit(ctx, args.societyId);
  const old = args.id ? await getOwned<Row>(ctx, "costPlanningItems", args.id, args.societyId) : null;
  if (old ? fields.sourceKind !== old.sourceKind || fields.sourceId !== old.sourceId : fields.sourceKind !== "manual" || fields.sourceId) throw new Error("Use the explicit import action to link a source. Existing planning provenance cannot be changed.");
  if (old) { await ctx.db.patch(old._id, { ...fields, endDate: fields.endDate, notes: fields.notes, updatedByUserId: attribution.updatedByUserId, updatedAtISO: attribution.updatedAtISO }); return old._id; }
  return ctx.db.insert("costPlanningItems", { societyId: args.societyId, ...fields, ...attribution });
}
export async function saveStaffPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; fields: StaffCostPlan }) {
  await write(ctx, args.societyId); const { _id: _ignored, ...fields } = validateStaffCostPlan(args.fields), attribution = await audit(ctx, args.societyId);
  const old = args.id ? await getOwned<Row>(ctx, "staffCostPlans", args.id, args.societyId) : null;
  if (fields.employeeId && fields.employeeId !== old?.employeeId) { await requirePermissionPortable(ctx, args.societyId, "employees:read"); await getOwned(ctx, "employees", fields.employeeId, args.societyId); }
  if (old) { await ctx.db.patch(old._id, { ...fields, employeeId: fields.employeeId, endDate: fields.endDate, hoursPerWeek: fields.hoursPerWeek, vacationPercent: fields.vacationPercent, employerPercent: fields.employerPercent, monthlyBenefitsCents: fields.monthlyBenefitsCents, notes: fields.notes, updatedByUserId: attribution.updatedByUserId, updatedAtISO: attribution.updatedAtISO }); return old._id; }
  return ctx.db.insert("staffCostPlans", { societyId: args.societyId, ...fields, ...attribution });
}
export async function setArchivedPortable(ctx: PortableMutationCtx, args: { societyId: string; kind: "period" | "cost" | "staff"; id: string; archived: boolean }) {
  await write(ctx, args.societyId); const table = planningTables[args.kind]; if (!table) throw new Error("Choose a supported planning record.");
  await getOwned(ctx, table, args.id, args.societyId); await ctx.db.patch(args.id, { archiveState: args.archived ? "archived" : "active", archivedAtISO: args.archived ? now() : undefined, updatedAtISO: now(), updatedByUserId: await principalUserId(ctx, args.societyId) }); return args.id;
}
export async function importSourcePortable(ctx: PortableMutationCtx, args: { societyId: string; kind: "insurance" | "subscription"; sourceId: string; currency?: string }) {
  await write(ctx, args.societyId); const table = sourceTables[args.kind]; if (!table) throw new Error("Choose an insurance policy or operating subscription.");
  const source = await getOwned<Row>(ctx, table, args.sourceId, args.societyId);
  const old = await ctx.db.query<Row>("costPlanningItems").withIndex("by_society_source", (q) => q.eq("societyId", args.societyId).eq("sourceKind", args.kind).eq("sourceId", args.sourceId)).first();
  if (old) return old._id;
  const fields = sourceDraft(args.kind, source, args.currency), attribution = await audit(ctx, args.societyId);
  return ctx.db.insert("costPlanningItems", { societyId: args.societyId, ...fields, ...attribution });
}
