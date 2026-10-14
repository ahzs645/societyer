/**
 * PORTABLE FUNCTIONS: the business registers.
 *
 * payroll: workspace / saveSettings / savePayRun / importPayRuns / removePayRun /
 *   recordRemittance / saveSlip / generateSlips / removeSlip / saveRoe / removeRoe /
 *   syncDeadlines
 * corporateCards: workspace / upsertCard / removeCard / upsertStatement /
 *   removeStatement / setStatementReconciled
 * investments: workspace / reserves / upsert / remove
 *
 * Record-keeping only: nothing here runs payroll, issues a card or moves money.
 * Remittance rows are rebuilt from the pay runs whenever a run or the schedule
 * changes, and the deadlines the registers generate (remittances, slip filing,
 * records of employment, workers' compensation, maturity reminders) are kept
 * in line on the deadlines table under `payroll:` / `investments:` source keys,
 * the same way agreements keep their obligations there.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import {
  COMPOUNDING,
  INVESTMENT_KINDS,
  INVESTMENT_KIND_LABEL,
  MATURITY_REMINDER_DAYS,
  PAY_RUN_AMOUNT_FIELDS,
  REMITTANCE_CADENCES,
  REMITTANCE_DUE_RULES,
  REMITTER_TYPES,
  ROE_STATUSES,
  SLIP_STATUSES,
  SLIP_TYPES,
  WORKERS_COMP_CADENCES,
  accruedInterestCents,
  assertCardLast4,
  assertNoCardNumber,
  belongsToCard,
  holdingStatus,
  holdingValueCents,
  interestEarnedCents,
  investedReserves,
  isCalendarDate,
  isRegisterDeadlineKey,
  maturityReminders,
  periodLabel,
  registerDeadlines,
  remittancesFromPayRuns,
  payRunDifferenceCents,
  reconcileStatement,
  remittableCents,
  remittanceDueDate,
  remittancePeriodFor,
  remittanceStatus,
  scheduleIsComplete,
  slipFilingDeadline,
  slipTotalsFromPayRuns,
  sumPayRunLines,
  type RegisterDeadline,
  type RemittanceSchedule,
} from "../businessRegisters";

// Rows are read loosely: each handler validates what it writes and projects what it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function nowISO() {
  return new Date().toISOString();
}

async function organizationToday(ctx: PortableQueryCtx, societyId: string) {
  const organization = await ctx.db.get(societyId, "societies");
  const iso = nowISO();
  return resolutionCalendarDate(iso, resolutionTimeZone(organization as any)) ?? iso.slice(0, 10);
}

async function canRead(ctx: PortableQueryCtx, societyId: string, permission: Permission): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, permission);
    return true;
  } catch (error) {
    if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:[a-z]+ required\.$/.test(error.message)) return false;
    throw error;
  }
}

async function actorName(ctx: PortableQueryCtx, societyId: string): Promise<string | undefined> {
  try {
    const user: any = await requireSocietyMembership(ctx, societyId);
    return user.displayName ?? user.name ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function compact<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function cents(value: unknown, label: string, { allowNegative = false } = {}): number {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n)) throw new Error(`${label}: enter an amount.`);
  if (!allowNegative && n < 0) throw new Error(`${label}: enter an amount of zero or more.`);
  if (Math.abs(n) > 1_000_000_000_00) throw new Error(`${label}: the amount is too large.`);
  return n;
}

function requireDate(value: unknown, label: string): string {
  if (!isCalendarDate(value)) throw new Error(`${label}: enter a date.`);
  return value;
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireDate(value, label);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(String(value))) throw new Error(`${label}: choose one of the listed options.`);
  return value as T;
}

async function rows(ctx: PortableQueryCtx, table: string, societyId: string): Promise<Row[]> {
  return (await ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as Row[];
}

/* ================================================================ payroll */

async function loadSettings(ctx: PortableQueryCtx, societyId: string): Promise<Row | null> {
  const found = await rows(ctx, "payrollSettings", societyId);
  return found.sort((a, b) => String(a._id).localeCompare(String(b._id)))[0] ?? null;
}

function scheduleOf(settings: Row | null): RemittanceSchedule {
  if (!settings) return { remitterType: "regular" };
  return { remitterType: settings.remitterType, cadence: settings.cadence, dueRule: settings.dueRule, dueValue: settings.dueValue };
}

/**
 * Bring the remittance rows in line with the pay runs: one row per remittance
 * period that has pay runs, its amount the sum of what those runs owe the CRA.
 * Rows that recorded a payment are kept even when their runs are gone.
 */
async function rebuildRemittances(ctx: PortableMutationCtx, societyId: string) {
  const schedule = scheduleOf(await loadSettings(ctx, societyId));
  const wanted = new Map(remittancesFromPayRuns((await rows(ctx, "payRuns", societyId)) as any, schedule).map((item) => [`${item.periodStart}|${item.periodEnd}`, item]));
  const existing = await rows(ctx, "payrollRemittances", societyId);
  const seen = new Set<string>();
  for (const row of existing) {
    const key = `${row.periodStart}|${row.periodEnd}`;
    const item = wanted.get(key);
    if (item && !seen.has(key)) {
      seen.add(key);
      const dueDate = item.dueDate ?? undefined;
      if (row.amountDueCents !== item.amountDueCents || row.dueDate !== dueDate) {
        await ctx.db.patch(row._id, { amountDueCents: item.amountDueCents, dueDate, updatedAtISO: nowISO() });
      }
      continue;
    }
    if (row.paidOn || (row.paidCents ?? 0) > 0) {
      if (row.amountDueCents !== 0) await ctx.db.patch(row._id, { amountDueCents: 0, updatedAtISO: nowISO() });
      continue;
    }
    await ctx.db.delete(row._id);
  }
  for (const [key, item] of wanted) {
    if (seen.has(key)) continue;
    await ctx.db.insert("payrollRemittances", compact({
      societyId,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      dueDate: item.dueDate ?? undefined,
      amountDueCents: item.amountDueCents,
      createdAtISO: nowISO(),
      updatedAtISO: nowISO(),
    }));
  }
}

function formatDollars(centsValue: number) {
  return `$${(centsValue / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Every deadline the payroll and investment registers want on the Deadlines page right now. */
async function wantedRegisterDeadlines(ctx: PortableQueryCtx, societyId: string, today: string, existing: Row[]): Promise<RegisterDeadline[]> {
  return registerDeadlines(
    {
      remittances: await rows(ctx, "payrollRemittances", societyId),
      slips: await rows(ctx, "payrollSlips", societyId),
      payDates: (await rows(ctx, "payRuns", societyId)).map((run: Row) => String(run.payDate)),
      roes: (await rows(ctx, "recordsOfEmployment", societyId)).map((roe: Row) => ({ ...roe, _id: String(roe._id) })),
      settings: await loadSettings(ctx, societyId),
      holdings: (await rows(ctx, "investmentHoldings", societyId)).map((holding: Row) => ({ ...holding, _id: String(holding._id) })),
    },
    today,
    existing,
  );
}

async function registerDeadlineRows(ctx: PortableQueryCtx, societyId: string): Promise<Row[]> {
  return (await rows(ctx, "deadlines", societyId)).filter((row) => isRegisterDeadlineKey(row.sourceKey));
}

/** How many generated deadlines would change on a sync (read-only). */
async function pendingDeadlineChanges(ctx: PortableQueryCtx, societyId: string, today: string): Promise<number> {
  const existing = await registerDeadlineRows(ctx, societyId);
  const wanted = await wantedRegisterDeadlines(ctx, societyId, today, existing);
  const byKey = new Map(existing.map((row) => [String(row.sourceKey), row]));
  let changes = 0;
  const wantedKeys = new Set<string>();
  for (const item of wanted) {
    wantedKeys.add(item.sourceKey);
    const row = byKey.get(item.sourceKey);
    if (!row) { if (!item.done) changes += 1; continue; }
    const open = (row.status ?? (row.done ? "complete" : "open")) === "open";
    if (!open) continue;
    if (item.done || row.title !== item.title || row.dueDate !== item.dueDate || (row.description ?? undefined) !== item.description) changes += 1;
  }
  for (const row of existing) {
    const open = (row.status ?? (row.done ? "complete" : "open")) === "open";
    if (open && !wantedKeys.has(String(row.sourceKey))) changes += 1;
  }
  return changes;
}

/**
 * Bring the generated payroll and investment deadlines in line with the
 * registers. Open rows are updated, completed or removed; completed rows are
 * history and are never touched.
 */
export async function syncRegisterDeadlines(ctx: PortableMutationCtx, societyId: string, today?: string) {
  const asOf = today ?? (await organizationToday(ctx, societyId));
  const existing = await registerDeadlineRows(ctx, societyId);
  const wanted = await wantedRegisterDeadlines(ctx, societyId, asOf, existing);
  const wantedByKey = new Map(wanted.map((item) => [item.sourceKey, item]));
  let created = 0, updated = 0, removed = 0, completed = 0;
  const seen = new Set<string>();
  for (const row of existing) {
    const key = String(row.sourceKey);
    const open = (row.status ?? (row.done ? "complete" : "open")) === "open";
    const item = wantedByKey.get(key);
    if (!open) { if (item) seen.add(key); continue; }
    if (!item || seen.has(key)) { await ctx.db.delete(row._id); removed += 1; continue; }
    seen.add(key);
    if (item.done) { await ctx.db.patch(row._id, { status: "complete", done: true }); completed += 1; continue; }
    const patch = compact({
      title: item.title !== row.title ? item.title : undefined,
      dueDate: item.dueDate !== row.dueDate ? item.dueDate : undefined,
      description: item.description !== row.description ? item.description : undefined,
      category: item.category !== row.category ? item.category : undefined,
    });
    if (Object.keys(patch).length) { await ctx.db.patch(row._id, patch); updated += 1; }
  }
  for (const item of wanted) {
    if (seen.has(item.sourceKey) || item.done) continue;
    await ctx.db.insert("deadlines", {
      societyId,
      title: item.title.slice(0, 200),
      description: item.description,
      dueDate: item.dueDate,
      category: item.category,
      status: "open",
      done: false,
      recurrence: "None",
      sourceKey: item.sourceKey,
    });
    created += 1;
  }
  return { created, updated, removed, completed };
}

function decoratePayRun(run: Row) {
  return {
    ...run,
    lines: run.lines ?? [],
    headcount: (run.lines ?? []).length,
    remittableCents: remittableCents(run as any),
    differenceCents: payRunDifferenceCents(run as any),
  };
}

export async function payrollWorkspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const settings = await loadSettings(ctx, societyId);
  const schedule = scheduleOf(settings);
  const runs = (await rows(ctx, "payRuns", societyId)).map(decoratePayRun).sort((a, b) => b.payDate.localeCompare(a.payDate));
  const remittances = (await rows(ctx, "payrollRemittances", societyId))
    .map((row) => {
      const status = remittanceStatus(row as any, today);
      const periodRuns = runs.filter((run) => run.payDate >= row.periodStart && run.payDate <= row.periodEnd);
      return { ...row, status, period: periodLabel(row.periodStart, row.periodEnd), payRunCount: periodRuns.length, outstandingCents: Math.max(0, row.amountDueCents - (row.paidCents ?? 0)) };
    })
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const slips = (await rows(ctx, "payrollSlips", societyId))
    .map((row) => ({ ...row, filingDeadline: slipFilingDeadline(row.year) }))
    .sort((a, b) => b.year - a.year || a.slipType.localeCompare(b.slipType) || a.recipientName.localeCompare(b.recipientName));
  const roes = (await rows(ctx, "recordsOfEmployment", societyId)).sort((a, b) => String(b.lastDayPaid).localeCompare(String(a.lastDayPaid)));
  const employees = (await canRead(ctx, societyId, "employees:read"))
    ? (await rows(ctx, "employees", societyId))
        .map((row) => ({ _id: row._id, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), role: row.role, active: !row.endDate || row.endDate >= today, annualSalaryCents: row.annualSalaryCents, province: row.province }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : null;
  const year = Number(today.slice(0, 4));
  const ytd = runs.filter((run) => Number(run.payDate.slice(0, 4)) === year);
  const open = remittances.filter((row) => row.status !== "paid" && row.amountDueCents > 0);
  const nextDue = open.filter((row) => row.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0] ?? null;
  const lastYear = year - 1;
  const lastYearSlips = slips.filter((slip) => slip.year === lastYear);
  return {
    today,
    settings: settings ?? { remitterType: "regular" },
    scheduleComplete: scheduleIsComplete(schedule),
    runs,
    remittances,
    slips,
    roes,
    employees,
    summary: {
      year,
      ytdGrossCents: ytd.reduce((sum, run) => sum + run.grossCents, 0),
      ytdRemittableCents: ytd.reduce((sum, run) => sum + run.remittableCents, 0),
      ytdRunCount: ytd.length,
      openRemittanceCount: open.length,
      overdueRemittanceCount: open.filter((row) => row.status === "overdue").length,
      outstandingCents: open.reduce((sum, row) => sum + row.outstandingCents, 0),
      nextRemittance: nextDue ? { dueDate: nextDue.dueDate, amountCents: nextDue.outstandingCents, period: nextDue.period, status: nextDue.status } : null,
      slipYear: lastYear,
      slipDeadline: slipFilingDeadline(lastYear),
      slipCount: lastYearSlips.length,
      slipsFiled: lastYearSlips.filter((slip) => slip.status === "filed").length,
      roesToIssue: roes.filter((roe) => roe.status !== "issued").length,
    },
    deadlineChanges: await pendingDeadlineChanges(ctx, societyId, today),
  };
}

export async function payrollSaveSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; remitterType: string; cadence?: string; dueRule?: string; dueValue?: number; payrollAccountNumber?: string; providerName?: string; workersCompProvider?: string; workersCompAccount?: string; workersCompCadence?: string; workersCompFirstDueDate?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const remitterType = oneOf(args.remitterType, REMITTER_TYPES, "Remitter type");
  const regular = remitterType === "regular";
  const fields = {
    remitterType,
    cadence: regular ? undefined : oneOf(args.cadence, REMITTANCE_CADENCES, "Remittance cadence"),
    dueRule: regular ? undefined : oneOf(args.dueRule, REMITTANCE_DUE_RULES, "Due date rule"),
    dueValue: regular ? undefined : Math.round(Number(args.dueValue)),
    payrollAccountNumber: cleanText(args.payrollAccountNumber, 40),
    providerName: cleanText(args.providerName, 120),
    workersCompProvider: cleanText(args.workersCompProvider, 60),
    workersCompAccount: cleanText(args.workersCompAccount, 60),
    workersCompCadence: args.workersCompCadence ? oneOf(args.workersCompCadence, WORKERS_COMP_CADENCES, "Workers' compensation cadence") : undefined,
    workersCompFirstDueDate: optionalDate(args.workersCompFirstDueDate, "Workers' compensation due date"),
    updatedAtISO: nowISO(),
  };
  if (!regular && !scheduleIsComplete(fields)) {
    throw new Error(fields.dueRule === "day_of_next_month" ? "Due day: enter a day from 1 to 31." : "Due days: enter 1 to 120 days after the period ends.");
  }
  if (fields.workersCompCadence && !fields.workersCompFirstDueDate) throw new Error("Workers' compensation: enter the next due date.");
  const existing = await loadSettings(ctx, args.societyId);
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("payrollSettings", compact({ societyId: args.societyId, ...fields }));
  await rebuildRemittances(ctx, args.societyId);
  await syncRegisterDeadlines(ctx, args.societyId);
}

type PayRunInput = {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  grossCents?: number;
  cppEmployeeCents?: number;
  eiEmployeeCents?: number;
  incomeTaxCents?: number;
  otherDeductionsCents?: number;
  cppEmployerCents?: number;
  eiEmployerCents?: number;
  netCents?: number;
  lines?: Array<Record<string, any>>;
  providerName?: string;
  transactionId?: string;
  notes?: string;
};

async function normalizePayRun(ctx: PortableQueryCtx, societyId: string, input: PayRunInput) {
  const periodStart = requireDate(input.periodStart, "Period start");
  const periodEnd = requireDate(input.periodEnd, "Period end");
  const payDate = requireDate(input.payDate, "Pay date");
  if (periodEnd < periodStart) throw new Error("Period end: pick a date on or after the period start.");
  const lines: Array<Record<string, unknown>> = [];
  for (const [index, line] of (input.lines ?? []).entries()) {
    const employeeName = cleanText(line.employeeName, 120);
    if (!employeeName) throw new Error(`Line ${index + 1}: name the employee.`);
    assertNoCardNumber(employeeName, `Line ${index + 1}`);
    if (line.employeeId) await getOwned(ctx, "employees", String(line.employeeId), societyId);
    const amounts: Record<string, number> = {};
    for (const field of PAY_RUN_AMOUNT_FIELDS) amounts[field] = cents(line[field], `Line ${index + 1}`);
    lines.push(compact({ employeeId: line.employeeId ? String(line.employeeId) : undefined, employeeName, ...amounts }));
  }
  const totals = lines.length
    ? sumPayRunLines(lines as any)
    : Object.fromEntries(PAY_RUN_AMOUNT_FIELDS.map((field) => [field, cents((input as any)[field], "Amounts")])) as Record<string, number>;
  if (!(totals.grossCents > 0)) throw new Error("Gross pay: enter the run's gross pay.");
  if (input.transactionId) await getOwned(ctx, "financialTransactions", input.transactionId, societyId);
  assertNoCardNumber(input.notes, "Notes");
  return compact({
    periodStart,
    periodEnd,
    payDate,
    ...totals,
    otherDeductionsCents: totals.otherDeductionsCents || undefined,
    lines: lines.length ? lines : undefined,
    providerName: cleanText(input.providerName, 120),
    transactionId: input.transactionId || undefined,
    notes: cleanText(input.notes, 2000),
  });
}

export async function payrollSavePayRunPortable(ctx: PortableMutationCtx, args: PayRunInput & { id?: string; societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const fields = await normalizePayRun(ctx, args.societyId, args);
  let id = args.id;
  if (id) {
    const before = await getOwned(ctx, "payRuns", id, args.societyId);
    await ctx.db.patch(id, { ...fields, lines: fields.lines, otherDeductionsCents: fields.otherDeductionsCents, transactionId: fields.transactionId, notes: fields.notes, providerName: fields.providerName, source: before.source ?? "manual", updatedAtISO: nowISO() });
  } else {
    id = await ctx.db.insert("payRuns", { societyId: args.societyId, ...fields, source: "manual", createdAtISO: nowISO(), updatedAtISO: nowISO() });
  }
  await rebuildRemittances(ctx, args.societyId);
  await syncRegisterDeadlines(ctx, args.societyId);
  return id;
}

/** Add pay runs read from a payroll provider's export. A run with the same period and pay date is skipped, not duplicated. */
export async function payrollImportPayRunsPortable(ctx: PortableMutationCtx, args: { societyId: string; providerName?: string; runs: PayRunInput[] }) {
  await requireSocietyMembership(ctx, args.societyId);
  if (!Array.isArray(args.runs) || !args.runs.length) throw new Error("Choose a file with at least one pay run.");
  if (args.runs.length > 500) throw new Error("Import up to 500 pay runs at a time.");
  const existing = await rows(ctx, "payRuns", args.societyId);
  const keys = new Set(existing.map((run) => `${run.periodStart}|${run.periodEnd}|${run.payDate}`));
  const employees = await rows(ctx, "employees", args.societyId);
  const byName = new Map(employees.map((row) => [`${row.firstName ?? ""} ${row.lastName ?? ""}`.trim().toLowerCase(), row._id]));
  let created = 0, skipped = 0;
  for (const input of args.runs) {
    const key = `${input.periodStart}|${input.periodEnd}|${input.payDate}`;
    if (keys.has(key)) { skipped += 1; continue; }
    const lines = (input.lines ?? []).map((line) => ({ ...line, employeeId: line.employeeId ?? byName.get(String(line.employeeName ?? "").trim().toLowerCase()) }));
    const fields = await normalizePayRun(ctx, args.societyId, { ...input, lines, providerName: input.providerName ?? args.providerName });
    await ctx.db.insert("payRuns", { societyId: args.societyId, ...fields, source: "import", createdAtISO: nowISO(), updatedAtISO: nowISO() });
    keys.add(key);
    created += 1;
  }
  await rebuildRemittances(ctx, args.societyId);
  await syncRegisterDeadlines(ctx, args.societyId);
  return { created, skipped };
}

export async function payrollRemovePayRunPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const run = await requireOwnedRow(ctx, "payRuns", id);
  await ctx.db.delete(id);
  await rebuildRemittances(ctx, run.societyId);
  await syncRegisterDeadlines(ctx, run.societyId);
}

/** Record (or clear) the payment of a remittance. Societyer records it; the payment itself is made in the CRA's or the bank's systems. */
export async function payrollRecordRemittancePortable(
  ctx: PortableMutationCtx,
  args: { id: string; paidCents?: number; paidOn?: string; confirmationNumber?: string; transactionId?: string; notes?: string; clear?: boolean },
) {
  const row = await requireOwnedRow(ctx, "payrollRemittances", args.id);
  if (args.clear) {
    await ctx.db.patch(args.id, { paidCents: undefined, paidOn: undefined, confirmationNumber: undefined, transactionId: undefined, updatedAtISO: nowISO() });
  } else {
    if (args.transactionId) await getOwned(ctx, "financialTransactions", args.transactionId, row.societyId);
    assertNoCardNumber(args.notes, "Notes");
    await ctx.db.patch(args.id, {
      paidCents: cents(args.paidCents ?? row.amountDueCents, "Amount paid"),
      paidOn: requireDate(args.paidOn, "Paid on"),
      confirmationNumber: cleanText(args.confirmationNumber, 60),
      transactionId: args.transactionId || undefined,
      notes: cleanText(args.notes, 2000),
      updatedAtISO: nowISO(),
    });
  }
  await syncRegisterDeadlines(ctx, row.societyId);
}

async function normalizeSlip(ctx: PortableQueryCtx, societyId: string, args: Record<string, any>) {
  const year = Math.round(Number(args.year));
  if (!(year >= 2000 && year <= 2100)) throw new Error("Tax year: enter a year.");
  const recipientName = cleanText(args.recipientName, 120);
  if (!recipientName) throw new Error("Recipient: name the person the slip is for.");
  assertNoCardNumber(recipientName, "Recipient");
  if (args.employeeId) await getOwned(ctx, "employees", args.employeeId, societyId);
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, societyId);
  const status = oneOf(args.status ?? "draft", SLIP_STATUSES, "Status");
  assertNoCardNumber(args.notes, "Notes");
  return compact({
    year,
    slipType: oneOf(args.slipType, SLIP_TYPES, "Slip type"),
    employeeId: args.employeeId || undefined,
    recipientName,
    employmentIncomeCents: cents(args.employmentIncomeCents, "Income"),
    cppCents: cents(args.cppCents, "CPP"),
    eiCents: cents(args.eiCents, "EI"),
    incomeTaxCents: cents(args.incomeTaxCents, "Income tax"),
    otherIncomeCents: args.otherIncomeCents ? cents(args.otherIncomeCents, "Other income") : undefined,
    status,
    issuedOn: optionalDate(args.issuedOn, "Given on"),
    filedOn: status === "filed" ? optionalDate(args.filedOn, "Filed on") : undefined,
    confirmationNumber: cleanText(args.confirmationNumber, 60),
    documentId: args.documentId || undefined,
    notes: cleanText(args.notes, 2000),
  });
}

export async function payrollSaveSlipPortable(ctx: PortableMutationCtx, args: Record<string, any> & { id?: string; societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const fields = await normalizeSlip(ctx, args.societyId, args);
  let id = args.id;
  if (id) {
    await getOwned(ctx, "payrollSlips", id, args.societyId);
    await ctx.db.patch(id, { ...fields, otherIncomeCents: fields.otherIncomeCents, issuedOn: fields.issuedOn, filedOn: fields.filedOn, confirmationNumber: fields.confirmationNumber, documentId: fields.documentId, employeeId: fields.employeeId, notes: fields.notes, updatedAtISO: nowISO() });
  } else {
    id = await ctx.db.insert("payrollSlips", { societyId: args.societyId, ...fields, createdAtISO: nowISO(), updatedAtISO: nowISO() });
  }
  await syncRegisterDeadlines(ctx, args.societyId);
  return id;
}

/** Draft T4 slips for a year from the per-employee lines of its pay runs. Draft slips are refreshed; issued and filed slips are left alone. */
export async function payrollGenerateSlipsPortable(ctx: PortableMutationCtx, { societyId, year }: { societyId: string; year: number }) {
  await requireSocietyMembership(ctx, societyId);
  const taxYear = Math.round(Number(year));
  if (!(taxYear >= 2000 && taxYear <= 2100)) throw new Error("Tax year: enter a year.");
  const runs = await rows(ctx, "payRuns", societyId);
  const totals = slipTotalsFromPayRuns(runs as any, taxYear);
  if (!totals.size) throw new Error(`No pay runs in ${taxYear} list employees. Add per-employee lines to the runs first.`);
  const slips = (await rows(ctx, "payrollSlips", societyId)).filter((slip) => slip.year === taxYear && slip.slipType === "T4");
  let created = 0, updated = 0, kept = 0;
  for (const entry of totals.values()) {
    const match = slips.find((slip) => (entry.employeeId && slip.employeeId === entry.employeeId) || slip.recipientName.toLowerCase() === entry.employeeName.toLowerCase());
    const amounts = { employmentIncomeCents: entry.employmentIncomeCents, cppCents: entry.cppCents, eiCents: entry.eiCents, incomeTaxCents: entry.incomeTaxCents };
    if (match) {
      if (match.status !== "draft") { kept += 1; continue; }
      await ctx.db.patch(match._id, { ...amounts, updatedAtISO: nowISO() });
      updated += 1;
      continue;
    }
    await ctx.db.insert("payrollSlips", compact({ societyId, year: taxYear, slipType: "T4", employeeId: entry.employeeId, recipientName: entry.employeeName, ...amounts, status: "draft", createdAtISO: nowISO(), updatedAtISO: nowISO() }));
    created += 1;
  }
  await syncRegisterDeadlines(ctx, societyId);
  return { created, updated, kept };
}

export async function payrollRemoveSlipPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const slip = await requireOwnedRow(ctx, "payrollSlips", id);
  await ctx.db.delete(id);
  await syncRegisterDeadlines(ctx, slip.societyId);
}

export async function payrollSaveRoePortable(ctx: PortableMutationCtx, args: Record<string, any> & { id?: string; societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  let employeeName = cleanText(args.employeeName, 120);
  if (args.employeeId) {
    const employee = await getOwned(ctx, "employees", args.employeeId, args.societyId);
    employeeName = employeeName ?? `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim();
  }
  if (!employeeName) throw new Error("Employee: choose who the record of employment is for.");
  assertNoCardNumber(args.notes, "Notes");
  const status = oneOf(args.status ?? "to_issue", ROE_STATUSES, "Status");
  const fields = compact({
    employeeId: args.employeeId || undefined,
    employeeName,
    reasonCode: cleanText(args.reasonCode, 4) ?? "K",
    lastDayPaid: requireDate(args.lastDayPaid, "Last day paid"),
    dueDate: optionalDate(args.dueDate, "Due date"),
    status,
    issuedOn: status === "issued" ? requireDate(args.issuedOn, "Issued on") : undefined,
    serialNumber: cleanText(args.serialNumber, 40),
    notes: cleanText(args.notes, 2000),
  });
  let id = args.id;
  if (id) {
    await getOwned(ctx, "recordsOfEmployment", id, args.societyId);
    await ctx.db.patch(id, { ...fields, employeeId: fields.employeeId, dueDate: fields.dueDate, issuedOn: fields.issuedOn, serialNumber: fields.serialNumber, notes: fields.notes, updatedAtISO: nowISO() });
  } else {
    id = await ctx.db.insert("recordsOfEmployment", { societyId: args.societyId, ...fields, createdAtISO: nowISO(), updatedAtISO: nowISO() });
  }
  await syncRegisterDeadlines(ctx, args.societyId);
  return id;
}

export async function payrollRemoveRoePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const roe = await requireOwnedRow(ctx, "recordsOfEmployment", id);
  await ctx.db.delete(id);
  await syncRegisterDeadlines(ctx, roe.societyId);
}

/** Refresh the generated payroll and investment deadlines (after deadlines were completed elsewhere, or a date passed). */
export async function payrollSyncDeadlinesPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return syncRegisterDeadlines(ctx, societyId);
}

/* ========================================================== corporate cards */

async function cardTransactions(ctx: PortableQueryCtx, card: Row): Promise<Row[]> {
  if (!card.financialAccountId) return [];
  const txns = (await ctx.db.query("financialTransactions").withIndex("by_account", (q) => q.eq("accountId", card.financialAccountId)).collect()) as Row[];
  return txns.filter((txn) => txn.societyId === card.societyId && belongsToCard(txn, card.last4));
}

export async function cardsWorkspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const cards = await rows(ctx, "corporateCards", societyId);
  const statements = await rows(ctx, "cardStatements", societyId);
  const accounts = (await rows(ctx, "financialAccounts", societyId)).filter((row) => row.accountType === "Credit" || row.subtype === "credit_card");
  const documentIds = new Set<string>([...cards.map((card) => card.agreementDocumentId), ...statements.map((row) => row.documentId)].filter(Boolean).map(String));
  const documents = new Map<string, string>();
  if (documentIds.size && (await canRead(ctx, societyId, "documents:read"))) {
    for (const id of documentIds) {
      const doc = await ctx.db.get<Row>(id, "documents");
      if (doc && doc.societyId === societyId) documents.set(id, doc.title ?? doc.fileName ?? "Document");
    }
  }
  const txnsByCard = new Map<string, Row[]>();
  for (const card of cards) txnsByCard.set(card._id, await cardTransactions(ctx, card));
  const decoratedStatements = statements
    .map((statement) => {
      const card = cards.find((row) => row._id === statement.cardId);
      const recon = reconcileStatement(statement as any, txnsByCard.get(statement.cardId) ?? []);
      return {
        ...statement,
        cardLabel: card ? `${card.nickname ?? card.issuer} ••${card.last4}` : "Card",
        cardholderName: card?.cardholderName,
        documentTitle: statement.documentId ? documents.get(String(statement.documentId)) : undefined,
        ...recon,
      };
    })
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const decoratedCards = cards
    .map((card) => {
      const account = accounts.find((row) => row._id === card.financialAccountId);
      const own = decoratedStatements.filter((row) => row.cardId === card._id);
      const latest = own[0];
      const txns = txnsByCard.get(card._id) ?? [];
      const balanceCents = account ? -Math.round(account.balanceCents ?? 0) : undefined;
      return {
        ...card,
        accountName: account?.name,
        agreementTitle: card.agreementDocumentId ? documents.get(String(card.agreementDocumentId)) : undefined,
        balanceCents,
        availableCents: card.limitCents !== undefined && balanceCents !== undefined ? card.limitCents - balanceCents : undefined,
        statementCount: own.length,
        unreconciledCount: own.filter((row) => row.status !== "reconciled").length,
        latestStatementEnd: latest?.periodEnd,
        receiptsMissing: txns.filter((txn) => txn.amountCents < 0 && txn.receiptStatus === "missing").length,
      };
    })
    .sort((a, b) => (a.status === b.status ? a.cardholderName.localeCompare(b.cardholderName) : a.status === "active" ? -1 : 1));
  const active = decoratedCards.filter((card) => card.status === "active");
  return {
    today,
    cards: decoratedCards,
    statements: decoratedStatements,
    accounts: accounts.map((row) => ({ _id: row._id, name: row.name })),
    summary: {
      activeCards: active.length,
      totalLimitCents: active.reduce((sum, card) => sum + (card.limitCents ?? 0), 0),
      balanceCents: [...new Map(active.filter((card) => card.financialAccountId).map((card) => [card.financialAccountId, card.balanceCents ?? 0])).values()].reduce((sum, n) => sum + n, 0),
      toReconcile: decoratedStatements.filter((row) => row.status !== "reconciled").length,
      withDifference: decoratedStatements.filter((row) => row.status === "difference").length,
      receiptsMissing: decoratedStatements.filter((row) => row.status !== "reconciled").reduce((sum, row) => sum + row.receiptsMissing, 0),
    },
  };
}

export async function cardsUpsertCardPortable(ctx: PortableMutationCtx, args: Record<string, any> & { id?: string; societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const last4 = assertCardLast4(args.last4);
  const cardholderName = cleanText(args.cardholderName, 120);
  if (!cardholderName) throw new Error("Cardholder: name the person who holds the card.");
  const issuer = cleanText(args.issuer, 120);
  if (!issuer) throw new Error("Issuer: name the bank or card issuer.");
  for (const [field, label] of [["cardholderName", "Cardholder"], ["issuer", "Issuer"], ["nickname", "Card name"], ["notes", "Notes"], ["network", "Network"]] as const) {
    assertNoCardNumber(args[field], label);
  }
  if (args.employeeId) await getOwned(ctx, "employees", args.employeeId, args.societyId);
  if (args.financialAccountId) await getOwned(ctx, "financialAccounts", args.financialAccountId, args.societyId);
  if (args.agreementDocumentId) await getOwned(ctx, "documents", args.agreementDocumentId, args.societyId);
  const status = oneOf(args.status ?? "active", ["active", "closed"] as const, "Status");
  const fields = {
    nickname: cleanText(args.nickname, 80),
    cardholderName,
    employeeId: args.employeeId || undefined,
    last4,
    issuer,
    network: cleanText(args.network, 40),
    limitCents: args.limitCents === undefined || args.limitCents === null || args.limitCents === "" ? undefined : cents(args.limitCents, "Credit limit"),
    financialAccountId: args.financialAccountId || undefined,
    agreementDocumentId: args.agreementDocumentId || undefined,
    status,
    openedOn: optionalDate(args.openedOn, "Opened"),
    closedOn: status === "closed" ? optionalDate(args.closedOn, "Closed") : undefined,
    notes: cleanText(args.notes, 2000),
    updatedAtISO: nowISO(),
  };
  if (args.id) {
    await getOwned(ctx, "corporateCards", args.id, args.societyId);
    await ctx.db.patch(args.id, fields);
    return args.id;
  }
  return ctx.db.insert("corporateCards", compact({ societyId: args.societyId, ...fields, createdAtISO: nowISO() }));
}

export async function cardsRemoveCardPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "corporateCards", id);
  const statements = await ctx.db.query("cardStatements").withIndex("by_card", (q) => q.eq("cardId", id)).collect();
  if (statements.length) throw new Error("This card has statements. Close the card instead, or remove its statements first.");
  await ctx.db.delete(id);
}

export async function cardsUpsertStatementPortable(ctx: PortableMutationCtx, args: Record<string, any> & { id?: string; societyId: string; cardId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "corporateCards", args.cardId, args.societyId);
  const periodStart = requireDate(args.periodStart, "Period start");
  const periodEnd = requireDate(args.periodEnd, "Period end");
  if (periodEnd < periodStart) throw new Error("Period end: pick a date on or after the period start.");
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, args.societyId);
  assertNoCardNumber(args.notes, "Notes");
  const fields = {
    cardId: args.cardId,
    periodStart,
    periodEnd,
    statementDate: optionalDate(args.statementDate, "Statement date"),
    paymentDueDate: optionalDate(args.paymentDueDate, "Payment due"),
    previousBalanceCents: cents(args.previousBalanceCents, "Previous balance", { allowNegative: true }),
    statementBalanceCents: cents(args.statementBalanceCents, "Statement balance", { allowNegative: true }),
    documentId: args.documentId || undefined,
    notes: cleanText(args.notes, 2000),
    updatedAtISO: nowISO(),
  };
  if (args.id) {
    const before = await getOwned(ctx, "cardStatements", args.id, args.societyId);
    const changedAmounts = before.statementBalanceCents !== fields.statementBalanceCents || before.previousBalanceCents !== fields.previousBalanceCents || before.periodStart !== periodStart || before.periodEnd !== periodEnd;
    // Changing what a reconciled statement says reopens it.
    await ctx.db.patch(args.id, { ...fields, ...(changedAmounts ? { reconciledAtISO: undefined, reconciledByName: undefined } : {}) });
    return args.id;
  }
  const duplicate = (await rows(ctx, "cardStatements", args.societyId)).find((row) => row.cardId === args.cardId && row.periodStart === periodStart && row.periodEnd === periodEnd);
  if (duplicate) throw new Error("This card already has a statement for that period.");
  return ctx.db.insert("cardStatements", compact({ societyId: args.societyId, ...fields, createdAtISO: nowISO() }));
}

export async function cardsRemoveStatementPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "cardStatements", id);
  await ctx.db.delete(id);
}

/** Mark a statement reconciled (only when it agrees with the feed) or reopen it. */
export async function cardsSetStatementReconciledPortable(ctx: PortableMutationCtx, { id, reconciled }: { id: string; reconciled: boolean }) {
  const statement = await requireOwnedRow(ctx, "cardStatements", id);
  if (!reconciled) {
    await ctx.db.patch(id, { reconciledAtISO: undefined, reconciledByName: undefined, updatedAtISO: nowISO() });
    return;
  }
  const card = await getOwned(ctx, "corporateCards", String(statement.cardId), statement.societyId);
  const recon = reconcileStatement({ ...(statement as any), reconciledAtISO: undefined }, await cardTransactions(ctx, card));
  if (recon.differenceCents !== 0) throw new Error(`The statement is ${formatDollars(Math.abs(recon.differenceCents))} ${recon.differenceCents > 0 ? "higher" : "lower"} than the card lines in the feed. Find the difference before reconciling.`);
  await ctx.db.patch(id, { reconciledAtISO: nowISO(), reconciledByName: await actorName(ctx, statement.societyId), updatedAtISO: nowISO() });
}

/* ============================================================ investments */

function decorateHolding(row: Row, today: string, funds: Map<string, string>) {
  return {
    ...row,
    kindLabel: INVESTMENT_KIND_LABEL[row.kind as keyof typeof INVESTMENT_KIND_LABEL] ?? row.kind,
    fundName: row.fundRestrictionId ? funds.get(String(row.fundRestrictionId)) : undefined,
    effectiveStatus: holdingStatus(row as any, today),
    interestEarnedCents: interestEarnedCents(row as any, today),
    accruedInterestCents: accruedInterestCents(row as any, today),
    valueCents: holdingValueCents(row as any, today),
    daysToMaturity: row.maturityDate && isCalendarDate(row.maturityDate) ? Math.round((Date.parse(`${row.maturityDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : undefined,
    reminders: row.status === "redeemed" ? [] : maturityReminders(row.maturityDate).filter((item) => item.date >= today),
  };
}

export async function investmentsWorkspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const fundRows = await rows(ctx, "fundRestrictions", societyId);
  const funds = new Map(fundRows.map((row) => [row._id, row.name]));
  const holdings = (await rows(ctx, "investmentHoldings", societyId))
    .map((row) => decorateHolding(row, today, funds))
    .sort((a, b) => (a.status === "redeemed" ? 1 : 0) - (b.status === "redeemed" ? 1 : 0) || String(a.maturityDate ?? "9999").localeCompare(String(b.maturityDate ?? "9999")));
  return {
    today,
    holdings,
    funds: fundRows.filter((row) => row.status !== "archived").map((row) => ({ _id: row._id, name: row.name })),
    reserves: investedReserves(holdings as any, today),
    reminderDays: MATURITY_REMINDER_DAYS,
    deadlineChanges: await pendingDeadlineChanges(ctx, societyId, today),
  };
}

/** The invested-reserves figure alone, for the Financials overview. */
export async function investmentsReservesPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  return { today, ...investedReserves((await rows(ctx, "investmentHoldings", societyId)) as any, today) };
}

export async function investmentsUpsertPortable(ctx: PortableMutationCtx, args: Record<string, any> & { id?: string; societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 120);
  if (!name) throw new Error("Name: say what the holding is, e.g. \"Operating reserve GIC\".");
  const institution = cleanText(args.institution, 120);
  if (!institution) throw new Error("Institution: name the bank or dealer.");
  for (const [field, label] of [["name", "Name"], ["institution", "Institution"], ["notes", "Notes"]] as const) assertNoCardNumber(args[field], label);
  const accountLast4 = cleanText(args.accountLast4, 8);
  if (accountLast4 && !/^\d{4}$/.test(accountLast4)) throw new Error("Account: enter only the last 4 digits.");
  const kind = oneOf(args.kind, INVESTMENT_KINDS, "Type");
  const startDate = requireDate(args.startDate, "Start date");
  const maturityDate = optionalDate(args.maturityDate, "Maturity date");
  if (maturityDate && maturityDate <= startDate) throw new Error("Maturity date: pick a date after the start date.");
  if ((kind === "gic" || kind === "term_deposit") && !maturityDate) throw new Error("Maturity date: GICs and term deposits need one.");
  const rate = args.ratePercent === undefined || args.ratePercent === null || args.ratePercent === "" ? undefined : Number(args.ratePercent);
  if (rate !== undefined && !(rate >= 0 && rate <= 25)) throw new Error("Rate: enter a yearly rate from 0 to 25%.");
  if (args.fundRestrictionId) await getOwned(ctx, "fundRestrictions", args.fundRestrictionId, args.societyId);
  if (args.financialAccountId) await getOwned(ctx, "financialAccounts", args.financialAccountId, args.societyId);
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, args.societyId);
  const status = oneOf(args.status ?? "active", ["active", "redeemed"] as const, "Status");
  const fields = {
    name,
    kind,
    institution,
    accountLast4,
    principalCents: cents(args.principalCents, "Principal"),
    ratePercent: rate,
    compounding: args.compounding ? oneOf(args.compounding, COMPOUNDING, "Interest") : rate !== undefined ? "simple" : undefined,
    startDate,
    maturityDate,
    interestPaidCents: args.interestPaidCents ? cents(args.interestPaidCents, "Interest paid") : undefined,
    currentValueCents: args.currentValueCents === undefined || args.currentValueCents === null || args.currentValueCents === "" ? undefined : cents(args.currentValueCents, "Current value"),
    // A holding tied to a restricted fund is restricted.
    restricted: Boolean(args.restricted || args.fundRestrictionId),
    fundRestrictionId: args.fundRestrictionId || undefined,
    financialAccountId: args.financialAccountId || undefined,
    documentId: args.documentId || undefined,
    autoRenew: args.autoRenew === undefined ? undefined : Boolean(args.autoRenew),
    status,
    redeemedOn: status === "redeemed" ? optionalDate(args.redeemedOn, "Redeemed on") : undefined,
    notes: cleanText(args.notes, 2000),
    updatedAtISO: nowISO(),
  };
  let id = args.id;
  if (id) {
    await getOwned(ctx, "investmentHoldings", id, args.societyId);
    await ctx.db.patch(id, fields);
  } else {
    id = await ctx.db.insert("investmentHoldings", compact({ societyId: args.societyId, ...fields, createdAtISO: nowISO() }));
  }
  await syncRegisterDeadlines(ctx, args.societyId);
  return id;
}

export async function investmentsRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const holding = await requireOwnedRow(ctx, "investmentHoldings", id);
  await ctx.db.delete(id);
  await syncRegisterDeadlines(ctx, holding.societyId);
}
