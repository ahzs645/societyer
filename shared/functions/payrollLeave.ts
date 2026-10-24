import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import { cleanVacationPeriod, cleanVacationRequest, PAYROLL_VACATION_SOURCES, vacationTimeBalance, type PayrollVacationAudit, type PayrollVacationPeriodFields, type PayrollVacationPeriodRecord, type PayrollVacationRequestFields, type PayrollVacationRequestRecord, type PayrollVacationStatus } from "../payrollLeave";

const active = (status: PayrollVacationStatus) => !["cancelled", "rejected"].includes(status);
async function authorize(ctx: PortableQueryCtx, societyId: string, write = false) { await requirePermissionPortable(ctx, societyId, write ? "financials:write" : "financials:read"); await requirePermissionPortable(ctx, societyId, "employees:read"); }
async function today(ctx: PortableQueryCtx, societyId: string) { const organization = await ctx.db.get(societyId, "societies"); if (!organization) throw new Error("Organization not found."); return resolutionCalendarDate(new Date().toISOString(), resolutionTimeZone(organization)) ?? new Date().toISOString().slice(0, 10); }
async function employee(ctx: PortableQueryCtx, societyId: string, id: string) { const row = await getOwned(ctx, "employees", id, societyId); return { _id: row._id, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), startDate: String(row.startDate ?? ""), ...(row.endDate ? { endDate: String(row.endDate) } : {}) }; }
async function requests(ctx: PortableQueryCtx, societyId: string, periodId: string) { const rows = await ctx.db.query<PayrollVacationRequestRecord>("payrollVacationRequests").withIndex("by_society_period", q => q.eq("societyId", societyId).eq("periodId", periodId)).take(501); if (rows.length > 500) throw new Error("This entitlement period exceeds the complete 500-request balance bound. Reconcile the actual source history before adding leave; no partial balance is reported."); return rows; }
function history(old: { version: number; history?: PayrollVacationAudit[] } | null, actorUserId: string, action: string, reason?: string) { if ((old?.history?.length ?? 0) >= 100) throw new Error("This record's 100-entry audit bound has been reached. Retain it and create a separately reviewed replacement rather than dropping history."); return [...old?.history ?? [], { atISO: new Date().toISOString(), actorUserId, action, previousVersion: old?.version ?? 0, ...(reason ? { reason } : {}) }]; }
function boundedText(value: unknown, name: string, required = false) { if (typeof value !== "string" || value.trim().length > 4000 || required && !value.trim()) { if (!required && value === undefined) return undefined; throw new Error(`${name} ${required ? "is required and " : ""}must contain at most 4,000 characters.`); } return value.trim(); }
function assertSize(value: unknown) { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 12000) throw new Error("This vacation record exceeds 12,000 UTF-8 bytes. Split the dates into smaller requests while retaining concise source evidence."); }
async function linkedWork(ctx: PortableQueryCtx, row: Pick<PayrollVacationRequestRecord, "_id" | "societyId" | "employeeId" | "days"> & { payrollPayoutCalculationId?: string }, preventPosted: boolean) {
  if (preventPosted && row.payrollPayoutCalculationId) {
    const calculation = await getOwned(ctx, "payrollCalculations", row.payrollPayoutCalculationId, row.societyId);
    if (calculation.status !== "reversed") throw new Error("Vacation included in a finalized payroll payout retains its actual absence source. Reverse/correct the native calculation before changing or cancelling this vacation record.");
  }
  for (const day of row.days) {
    const found = await ctx.db.query<PortableDoc>("payrollWorkDays").withIndex("by_society_employee_date", q => q.eq("societyId", row.societyId).eq("employeeId", row.employeeId).eq("date", day.date)).take(2);
    if (found.length > 1) throw new Error("Duplicate work-day history requires reconciliation before changing its linked vacation.");
    const work = day.payrollWorkDayId ? await getOwned(ctx, "payrollWorkDays", day.payrollWorkDayId, row.societyId) : found[0];
    if (!work) continue;
    if (work.employeeId !== row.employeeId || work.date !== day.date) throw new Error("A linked work record must belong to this employee and exact vacation date.");
    if (work.vacationRequestId && work.vacationRequestId !== row._id) throw new Error("This work date is linked to another vacation request. Reconcile the original absence before reusing it.");
    if (preventPosted && work.postedCalculationId && (work.vacationRequestId === row._id || day.payrollWorkDayId === work._id)) throw new Error("Vacation included in a finalized payroll work day is retained with that calculation. Reverse/correct the native calculation before changing its absence record.");
  }
}
function cursor(raw: string | null | undefined, scope: string) { if (!raw) return null; let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error("Invalid vacation page; restart from the first page."); } if (parsed.scope !== scope || typeof parsed.cursor !== "string") throw new Error("This vacation page belongs to another employee or entitlement period."); return parsed.cursor as string; }
export async function workspacePortable(ctx: PortableQueryCtx, args: { societyId: string; employeeId: string; collection: "periods" | "requests"; periodId?: string; cursor?: string | null }) {
  await authorize(ctx, args.societyId); const person = await employee(ctx, args.societyId, args.employeeId), asOf = await today(ctx, args.societyId);
  const scope = JSON.stringify([args.societyId, args.employeeId, args.collection, args.periodId ?? ""]), pageCursor = cursor(args.cursor, scope);
  if (args.collection === "requests") {
    if (!args.periodId) throw new Error("Select an entitlement period to view its complete request history.");
    const period = await getOwned<PayrollVacationPeriodRecord>(ctx, "payrollVacationPeriods", args.periodId, args.societyId); if (period.employeeId !== args.employeeId) throw new Error("Vacation entitlement period not found.");
    const all = await requests(ctx, args.societyId, period._id), balance = vacationTimeBalance(period, all, asOf);
    const result = await ctx.db.query<PayrollVacationRequestRecord>("payrollVacationRequests").withIndex("by_society_period", q => q.eq("societyId", args.societyId).eq("periodId", period._id)).order("desc").paginate({ numItems: 25, cursor: pageCursor, maximumBytesRead: 1_500_000 });
    return { page: result.page, isDone: result.isDone, continueCursor: result.isDone ? "" : JSON.stringify({ scope, cursor: result.continueCursor }), employee: person, today: asOf, period, balance, sources: PAYROLL_VACATION_SOURCES };
  }
  if (args.collection !== "periods") throw new Error("Select entitlement periods or leave requests.");
  // A period's complete 500-request × 12 KB balance read stays below the hosted
  // 8 MB transaction budget, even when the history is at its explicit bound.
  const result = await ctx.db.query<PayrollVacationPeriodRecord>("payrollVacationPeriods").withIndex("by_society_employee_service", q => q.eq("societyId", args.societyId).eq("employeeId", args.employeeId)).order("desc").paginate({ numItems: 1, cursor: pageCursor, maximumBytesRead: 1_500_000 });
  const page = await Promise.all(result.page.map(async period => ({ ...period, balance: vacationTimeBalance(period, await requests(ctx, args.societyId, period._id), asOf) })));
  return { page, isDone: result.isDone, continueCursor: result.isDone ? "" : JSON.stringify({ scope, cursor: result.continueCursor }), employee: person, today: asOf, sources: PAYROLL_VACATION_SOURCES };
}
export async function savePeriodPortable(ctx: PortableMutationCtx, args: { societyId: string; employeeId: string; id?: string; fields: PayrollVacationPeriodFields }) {
  await authorize(ctx, args.societyId, true); const person = await employee(ctx, args.societyId, args.employeeId), asOf = await today(ctx, args.societyId), cleaned = cleanVacationPeriod(args.fields, person.startDate, asOf);
  if (person.endDate && cleaned.rule.earnedOn > person.endDate) throw new Error("This employment ended before that service-year time entitlement was earned. Vacation money owing is handled separately in final pay.");
  const old = args.id ? await getOwned<PayrollVacationPeriodRecord>(ctx, "payrollVacationPeriods", args.id, args.societyId) : null;
  if (old && old.employeeId !== args.employeeId) throw new Error("An entitlement period cannot move to another employee.");
  const peers = await ctx.db.query<PayrollVacationPeriodRecord>("payrollVacationPeriods").withIndex("by_society_employee_service", q => q.eq("societyId", args.societyId).eq("employeeId", args.employeeId)).take(101);
  if (peers.length > 100) throw new Error("This employee exceeds the complete 100-entitlement-period bound.");
  if (peers.some(period => period._id !== old?._id && period.serviceYear === cleaned.fields.serviceYear)) throw new Error("This employee already has that employment-anniversary entitlement period.");
  if (cleaned.fields.openingCarryoverMinutes && peers.some(period => period._id !== old?._id && period.serviceYear < cleaned.fields.serviceYear)) throw new Error("Opening carryover is only for untracked prior history. Use the existing earlier entitlement's retained balance instead of counting its leave twice.");
  if (peers.some(period => period._id !== old?._id && period.serviceYear > cleaned.fields.serviceYear && period.openingCarryoverMinutes)) throw new Error("A later entitlement already carries an opening from untracked history. Reconcile that carryover before adding the earlier period to avoid double counting.");
  if (old && (await requests(ctx, args.societyId, old._id)).some(row => active(row.status))) {
    const immutable = ["serviceYear", "provinceOfEmployment", "normalWeeklyMinutes", "normalDailyMinutes", "openingThroughDate", "openingUsedMinutes", "openingCarryoverMinutes", "additionalEntitlementMinutes", "employmentStartDate"];
    const next: Record<string, unknown> = { ...cleaned.fields, employmentStartDate: person.startDate };
    if (immutable.some(field => JSON.stringify(next[field]) !== JSON.stringify((old as any)[field]))) throw new Error("Active vacation requests retain their reviewed entitlement/opening basis. Cancel/reconcile the requests before changing that basis.");
  }
  const now = new Date().toISOString(), row = { ...cleaned.fields, employmentStartDate: person.startDate, ...cleaned.rule, societyId: args.societyId, employeeId: args.employeeId, version: (old?.version ?? 0) + 1, history: history(old, await principalUserId(ctx, args.societyId), old ? "period_updated" : "period_created"), createdAtISO: old?.createdAtISO ?? now, updatedAtISO: now }; assertSize(row);
  if (old) { await ctx.db.replace(old._id, row); return old._id; } return ctx.db.insert("payrollVacationPeriods", row);
}
export async function saveRequestPortable(ctx: PortableMutationCtx, args: { societyId: string; employeeId: string; periodId: string; id?: string; fields: PayrollVacationRequestFields }) {
  await authorize(ctx, args.societyId, true); const person = await employee(ctx, args.societyId, args.employeeId), period = await getOwned<PayrollVacationPeriodRecord>(ctx, "payrollVacationPeriods", args.periodId, args.societyId);
  if (period.employeeId !== args.employeeId) throw new Error("Vacation entitlement period not found.");
  const old = args.id ? await getOwned<PayrollVacationRequestRecord>(ctx, "payrollVacationRequests", args.id, args.societyId) : null;
  if (old && (old.employeeId !== args.employeeId || old.periodId !== args.periodId)) throw new Error("A vacation request cannot move to another employee/entitlement.");
  if (old && old.status !== "requested") throw new Error("Approved, taken and resolved requests retain their dates and minutes. Cancel with a reviewed reason and create a replacement if correction is needed.");
  const cleaned = cleanVacationRequest(args.fields, period); if (person.endDate && cleaned.endDate > person.endDate) throw new Error("Vacation time cannot extend after the recorded employment end date; vacation money owed is a separate final-pay calculation.");
  const peers = await ctx.db.query<PayrollVacationRequestRecord>("payrollVacationRequests").withIndex("by_society_employee_start", q => q.eq("societyId", args.societyId).eq("employeeId", args.employeeId)).take(501);
  if (peers.length > 500 || !old && peers.length === 500) throw new Error("This employee exceeds the complete 500-request overlap bound. Reconcile historical records before adding leave; no partial check is used.");
  const dates = new Set(cleaned.fields.days.map(day => day.date));
  if (peers.some(row => row._id !== old?._id && active(row.status) && row.days.some(day => dates.has(day.date)))) throw new Error("Another active vacation request already records one of these dates, including requests against another entitlement. Record the absence once.");
  const existing = peers.filter(row => row.periodId === period._id); if (!old && existing.length >= 500) throw new Error("This period already contains 500 retained requests; reconcile it before adding another.");
  const now = new Date().toISOString(), row = { societyId: args.societyId, employeeId: args.employeeId, periodId: period._id, ...cleaned.fields, startDate: cleaned.startDate, endDate: cleaned.endDate, minutes: cleaned.minutes, status: "requested" as const, version: (old?.version ?? 0) + 1, history: history(old, await principalUserId(ctx, args.societyId), old ? "request_updated" : "request_created"), createdAtISO: old?.createdAtISO ?? now, updatedAtISO: now }; assertSize(row);
  await linkedWork(ctx, { ...row, _id: old?._id ?? "new-request" }, true);
  if (old) { await ctx.db.replace(old._id, row); return old._id; } return ctx.db.insert("payrollVacationRequests", row);
}
export async function transitionRequestPortable(ctx: PortableMutationCtx, args: { societyId: string; id: string; status: Exclude<PayrollVacationStatus, "requested">; reason?: string; expectedVersion?: number }) {
  await authorize(ctx, args.societyId, true); const row = await getOwned<PayrollVacationRequestRecord>(ctx, "payrollVacationRequests", args.id, args.societyId), period = await getOwned<PayrollVacationPeriodRecord>(ctx, "payrollVacationPeriods", row.periodId, args.societyId), asOf = await today(ctx, args.societyId);
  if (row.employeeId !== period.employeeId) throw new Error("Vacation request ownership is inconsistent.");
  if (args.expectedVersion !== undefined && args.expectedVersion !== row.version) throw new Error("This vacation record changed; reopen its current version before changing status.");
  if (row.status === args.status) return row._id;
  const allowed: Record<PayrollVacationStatus, string[]> = { requested: ["approved", "rejected", "cancelled"], approved: ["taken", "cancelled"], taken: ["cancelled"], cancelled: [], rejected: [] };
  if (!allowed[row.status].includes(args.status)) throw new Error("Use request → approved → taken, or record an explicit cancellation/rejection. Resolved requests are retained.");
  const reason = boundedText(args.reason, "Cancellation/rejection reason", args.status === "cancelled" || args.status === "rejected");
  await linkedWork(ctx, row, !(row.status === "approved" && args.status === "taken"));
  if (args.status === "taken" && row.endDate > asOf) throw new Error("Future vacation cannot be recorded as actually taken. Keep it approved until the absence has occurred.");
  if (args.status === "approved") { const balance = vacationTimeBalance(period, await requests(ctx, args.societyId, period._id), asOf); if (row.minutes > balance.uncommittedMinutes) throw new Error("This approval exceeds the uncommitted reviewed entitlement. Reconcile the opening, carryover or contractual policy before approving extra leave."); }
  const patch = { status: args.status, version: row.version + 1, history: history(row, await principalUserId(ctx, args.societyId), `status_${args.status}`, reason), updatedAtISO: new Date().toISOString() }; assertSize({ ...row, ...patch }); await ctx.db.patch(row._id, patch); return row._id;
}
