/**
 * Business registers: payroll records, corporate cards and invested reserves.
 *
 * Societyer keeps records about money; it never moves it. These registers are
 * the record-keeping side of payroll, company cards and reserve investments:
 * what was paid and withheld, what is owed to the Canada Revenue Agency and
 * when, which year-end slips are filed, what each card statement says against
 * the card lines in the bank feed, and what the organization holds in GICs,
 * term deposits and savings.
 *
 * Due-date rules implemented here, and only these:
 *  - Regular remitters: source deductions are due on the 15th of the month
 *    after the month the employees were paid.
 *  - T4, T4A and RL-1 slips and summaries for a calendar year are due on the
 *    last day of February of the following year.
 * Quarterly and accelerated threshold 1/2 schedules follow CRA rules. Legacy
 * custom schedules remain available. CRA deadlines move to the next business
 * day for weekends and recognized holidays. A record of employment and workers'
 * compensation reports are due on dates the organization sets.
 *
 * Pure TypeScript shared by the portable functions, the demo generators, the
 * pages and the gate (scripts/check-business-registers.ts). Dates are
 * calendar dates (YYYY-MM-DD) in the organization's time zone.
 */
import { addDays, addMonthsClamped, allocateProportionally, daysBetween, isCalendarDate } from "./invoicing";
import { TRANSFER_CATEGORY } from "./transferCategories";
import type { PayrollDeductionYtd } from "./payrollDeductions";

export { addDays, daysBetween, isCalendarDate };

/* ------------------------------------------------------------- dates */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First day of the month containing `date`. */
export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** Last day of the month containing `date`. */
export function monthEnd(date: string) {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

/** Day `day` of the month after the month containing `date`, clamped to that month's length. */
function dayOfFollowingMonth(date: string, day: number) {
  const next = addMonthsClamped(monthStart(date), 1);
  const [y, m] = next.split("-").map(Number);
  return `${y}-${pad2(m)}-${pad2(Math.min(Math.max(1, Math.round(day)), daysInMonth(y, m)))}`;
}

/* ------------------------------------------------------------- payroll */

export const REMITTER_TYPES = ["regular", "quarterly", "accelerated_threshold_1", "accelerated_threshold_2", "accelerated"] as const;
export type RemitterType = (typeof REMITTER_TYPES)[number];
export const REMITTER_TYPE_LABEL: Record<RemitterType, string> = {
  regular: "Regular (monthly)",
  quarterly: "Quarterly",
  accelerated_threshold_1: "Accelerated — threshold 1",
  accelerated_threshold_2: "Accelerated — threshold 2",
  accelerated: "Custom schedule (legacy accelerated)",
};

export const REMITTANCE_CADENCES = ["monthly", "twice_monthly", "quarterly"] as const;
export type RemittanceCadence = (typeof REMITTANCE_CADENCES)[number];
export const REMITTANCE_CADENCE_LABEL: Record<RemittanceCadence, string> = {
  monthly: "Monthly",
  twice_monthly: "Twice a month",
  quarterly: "Quarterly",
};

export const REMITTANCE_DUE_RULES = ["day_of_next_month", "days_after_period_end"] as const;
export type RemittanceDueRule = (typeof REMITTANCE_DUE_RULES)[number];
export const REMITTANCE_DUE_RULE_LABEL: Record<RemittanceDueRule, string> = {
  day_of_next_month: "Day of the following month",
  days_after_period_end: "Days after the period ends",
};

/** The regular-remitter rule: the 15th of the month after pay day. */
export const REGULAR_REMITTANCE_DUE_DAY = 15;

export type RemittanceScheduleRule = {
  remitterType: RemitterType | string;
  /** Quarterly and accelerated remitters: how often deductions are remitted. */
  cadence?: RemittanceCadence | string;
  dueRule?: RemittanceDueRule | string;
  /** The day of the following month, or the number of days after the period ends. */
  dueValue?: number;
  /** CRA recognizes provincial holidays where the employer is situated. */
  province?: string;
};
export type RemittanceScheduleChange = RemittanceScheduleRule & { effectiveFrom: string; noticeReference: string };
export type RemittanceSchedule = RemittanceScheduleRule & { remittanceBaseline?: RemittanceScheduleRule; remittanceScheduleHistory?: RemittanceScheduleChange[] };
export function remittanceRule(schedule: RemittanceScheduleRule): RemittanceScheduleRule {
  return Object.fromEntries(Object.entries({ remitterType: schedule.remitterType, province: schedule.province || "BC", ...(schedule.remitterType === "accelerated" || schedule.remitterType === "quarterly" && schedule.dueRule ? { cadence: schedule.cadence, dueRule: schedule.dueRule, dueValue: schedule.dueValue } : {}) }).filter(([, value]) => value !== undefined)) as RemittanceScheduleRule;
}
export function remittanceScheduleForPayDate(payDate: string, schedule: RemittanceSchedule): RemittanceScheduleRule {
  let selected: RemittanceScheduleRule = schedule.remittanceBaseline || remittanceRule(schedule);
  for (const change of [...schedule.remittanceScheduleHistory || []].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) if (change.effectiveFrom <= payDate) selected = change;
  return remittanceRule(selected);
}

export type Period = { start: string; end: string };

export const PAYROLL_DEADLINE_SOURCES = {
  cra: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions/how-when-remit-due-dates.html",
  holidays: "https://www.canada.ca/en/revenue-agency/services/tax/public-holidays.html",
  bc: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays",
  reviewedOn: "2026-10-23",
} as const;
function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return `${year}-${pad2(month)}-${pad2(1 + (weekday - first + 7) % 7 + (occurrence - 1) * 7)}`;
}
function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
/** Actual holiday dates from CRA's list, plus B.C. Family Day; weekends are handled separately. */
export function craPayrollHolidays(year: number, province = "BC"): Set<string> {
  if (province.toUpperCase() !== "BC") throw new Error("The reviewed payroll remittance calendar currently covers B.C. plus CRA federal holidays. Select a supported calendar.");
  const easter = easterSunday(year), may25 = `${year}-05-25`, victoria = addDays(may25, -((new Date(`${may25}T00:00:00Z`).getUTCDay() + 6) % 7 || 7));
  const result = new Set([`${year}-01-01`, addDays(easter, -2), addDays(easter, 1), victoria, `${year}-07-01`, nthWeekday(year, 9, 1, 1), ...(year >= 2021 ? [`${year}-09-30`] : []), nthWeekday(year, 10, 1, 2), `${year}-11-11`, `${year}-12-25`, `${year}-12-26`]);
  result.add(nthWeekday(year, 8, 1, 1));
  if (province.toUpperCase() === "BC" && year >= 2013) result.add(nthWeekday(year, 2, 1, year < 2019 ? 2 : 3));
  return result;
}
export function isCraPayrollBusinessDay(date: string, province = "BC") {
  if (!isCalendarDate(date)) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !craPayrollHolidays(Number(date.slice(0, 4)), province).has(date);
}
export function nextCraPayrollBusinessDay(date: string, province = "BC") {
  if (!isCalendarDate(date)) throw new Error("Choose a valid payroll deadline date.");
  let candidate = date;
  while (!isCraPayrollBusinessDay(candidate, province)) candidate = addDays(candidate, 1);
  return candidate;
}
export function addCraPayrollWorkingDays(date: string, count: number, province = "BC") {
  if (!isCalendarDate(date) || !Number.isSafeInteger(count) || count < 0 || count > 366) throw new Error("Choose a valid date and working-day count.");
  let candidate = date, remaining = count;
  while (remaining > 0) { candidate = addDays(candidate, 1); if (isCraPayrollBusinessDay(candidate, province)) remaining--; }
  return candidate;
}

/** Whether the schedule says enough to compute due dates. */
export function scheduleIsComplete(schedule: RemittanceSchedule | null | undefined): boolean {
  if (!schedule) return false;
  if (["regular", "accelerated_threshold_1", "accelerated_threshold_2"].includes(schedule.remitterType) || schedule.remitterType === "quarterly" && !schedule.dueRule) return true;
  return (
    (REMITTANCE_CADENCES as readonly string[]).includes(String(schedule.cadence)) &&
    (REMITTANCE_DUE_RULES as readonly string[]).includes(String(schedule.dueRule)) &&
    Number.isFinite(Number(schedule.dueValue)) &&
    Number(schedule.dueValue) >= 1 &&
    Number(schedule.dueValue) <= (schedule.dueRule === "day_of_next_month" ? 31 : 120)
  );
}

/** The remittance period a pay date falls in, or null when the schedule is incomplete. */
export function remittancePeriodFor(payDate: string, schedule: RemittanceSchedule | null | undefined): Period | null {
  if (schedule?.remittanceScheduleHistory?.length) schedule = remittanceScheduleForPayDate(payDate, schedule);
  if (!isCalendarDate(payDate) || !scheduleIsComplete(schedule)) return null;
  if (schedule!.remitterType === "accelerated_threshold_2") {
    const day = Number(payDate.slice(8)), start = day <= 7 ? 1 : day <= 14 ? 8 : day <= 21 ? 15 : 22, end = start === 22 ? Number(monthEnd(payDate).slice(8)) : start + 6;
    return { start: `${payDate.slice(0, 7)}-${pad2(start)}`, end: `${payDate.slice(0, 7)}-${pad2(end)}` };
  }
  const cadence = schedule!.remitterType === "regular" ? "monthly" : schedule!.remitterType === "quarterly" ? schedule!.cadence || "quarterly" : schedule!.remitterType === "accelerated_threshold_1" ? "twice_monthly" : schedule!.cadence;
  if (cadence === "twice_monthly") {
    const day = Number(payDate.slice(8, 10));
    return day <= 15
      ? { start: monthStart(payDate), end: `${payDate.slice(0, 7)}-15` }
      : { start: `${payDate.slice(0, 7)}-16`, end: monthEnd(payDate) };
  }
  if (cadence === "quarterly") {
    const [y, m] = payDate.split("-").map(Number);
    const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return { start: `${y}-${pad2(firstMonth)}-01`, end: monthEnd(`${y}-${pad2(firstMonth + 2)}-01`) };
  }
  return { start: monthStart(payDate), end: monthEnd(payDate) };
}

/** When the deductions withheld in `period` are due to the CRA, or null when the schedule is incomplete. */
export function remittanceDueDate(period: Period, schedule: RemittanceSchedule | null | undefined): string | null {
  if (schedule?.remittanceScheduleHistory?.length) schedule = remittanceScheduleForPayDate(period.start, schedule);
  if (!scheduleIsComplete(schedule) || !isCalendarDate(period.end)) return null;
  const province = schedule!.province || "BC";
  if (schedule!.remitterType === "accelerated_threshold_2") return addCraPayrollWorkingDays(period.end, 3, province);
  const date = schedule!.remitterType === "regular" || schedule!.remitterType === "quarterly" && !schedule!.dueRule ? dayOfFollowingMonth(period.end, REGULAR_REMITTANCE_DUE_DAY)
    : schedule!.remitterType === "accelerated_threshold_1" ? Number(period.end.slice(8)) === 15 ? `${period.end.slice(0, 7)}-25` : dayOfFollowingMonth(period.end, 10)
    : schedule!.dueRule === "days_after_period_end" ? addDays(period.end, Math.round(Number(schedule!.dueValue))) : dayOfFollowingMonth(period.end, Number(schedule!.dueValue));
  return nextCraPayrollBusinessDay(date, province);
}

export type PayRunAmounts = {
  grossCents: number;
  nonCashTaxableCents?: number;
  nonTaxableCashCents?: number;
  cppEmployeeCents: number;
  cpp2EmployeeCents?: number;
  eiEmployeeCents: number;
  incomeTaxCents: number;
  federalTaxCents?: number;
  provincialTaxCents?: number;
  additionalIncomeTaxCents?: number;
  otherDeductionsCents?: number;
  cppEmployerCents: number;
  cpp2EmployerCents?: number;
  eiEmployerCents: number;
  netCents: number;
};

export const PAY_RUN_AMOUNT_FIELDS = [
  "grossCents",
  "nonCashTaxableCents",
  "nonTaxableCashCents",
  "cppEmployeeCents",
  "cpp2EmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "otherDeductionsCents",
  "cppEmployerCents",
  "cpp2EmployerCents",
  "eiEmployerCents",
  "netCents",
] as const;

/** What the CRA is owed for one pay run: the employee deductions withheld plus the employer's CPP and EI. */
export function remittableCents(run: PayRunAmounts): number {
  return (
    Math.round(run.cppEmployeeCents || 0) +
    Math.round(run.cpp2EmployeeCents || 0) +
    Math.round(run.eiEmployeeCents || 0) +
    Math.round(run.incomeTaxCents || 0) +
    Math.round(run.cppEmployerCents || 0) +
    Math.round(run.cpp2EmployerCents || 0) +
    Math.round(run.eiEmployerCents || 0)
  );
}

/** Taxable gross − non-cash benefits + non-taxable cash − deductions − net cash paid. */
export function payRunDifferenceCents(run: PayRunAmounts): number {
  const deductions =
    Math.round(run.cppEmployeeCents || 0) +
    Math.round(run.cpp2EmployeeCents || 0) +
    Math.round(run.eiEmployeeCents || 0) +
    Math.round(run.incomeTaxCents || 0) +
    Math.round(run.otherDeductionsCents || 0);
  return Math.round(run.grossCents || 0) - Math.round(run.nonCashTaxableCents || 0) + Math.round(run.nonTaxableCashCents || 0) - deductions - Math.round(run.netCents || 0);
}

/** Basic employer cost: taxable gross plus employer CPP, CPP2 and EI. Full costing lives in the calculation snapshot. */
export function employerCostCents(run: PayRunAmounts): number {
  return Math.round(run.grossCents || 0) + Math.round(run.cppEmployerCents || 0) + Math.round(run.cpp2EmployerCents || 0) + Math.round(run.eiEmployerCents || 0);
}

export const PAY_RUN_TYPES = ["regular", "bonus", "off_cycle", "final", "correction", "reversal"] as const;
export type PayRunType = typeof PAY_RUN_TYPES[number];
export type PayRunIdentity = { providerName?: string; providerRunId?: string; runType?: PayRunType; correctsRunId?: string; correctionOfProviderRunId?: string };
export function payRunImportKey(run: PayRunIdentity & { periodStart: string; periodEnd: string; payDate: string }) {
  const provider = (run.providerName || "").trim().toLowerCase(), type = run.runType || "regular", correction = (run.correctionOfProviderRunId || run.correctsRunId || "").trim(), providerRunId = run.providerRunId?.trim();
  return JSON.stringify(providerRunId ? [provider, "provider", providerRunId, type, correction] : [provider, "period", run.periodStart, run.periodEnd, run.payDate, type, correction]);
}
export type PayRunClassifiedBases = { cashCents: number; taxableCents: number; pensionableCents: number; insurableCents: number; vacationableCents: number; ehtCents: number; workSafeCents: number };
export type PayRunLine = PayRunAmounts & { employeeId?: string; providerEmployeeId?: string; employeeName: string; provinceOfEmployment?: string; ehtLocationId?: string; ehtAttributionBasis?: "primary_reporting" | "reasonable_allocation"; ehtAttributionEvidence?: string; vacationAccruedCents?: number; vacationPaidCents?: number; sickPaidDaysUsed?: number; sickUnpaidDaysUsed?: number; deductionYtdDelta?: PayrollDeductionYtd; classifiedBases?: PayRunClassifiedBases; regularClassifiedBases?: PayRunClassifiedBases; bonusClassifiedBases?: PayRunClassifiedBases; insurableHours?: number };

/** Sum per-employee lines into run totals. */
export type PayRunTotals = Required<Omit<PayRunAmounts, "federalTaxCents" | "provincialTaxCents" | "additionalIncomeTaxCents">> & Pick<PayRunAmounts, "federalTaxCents" | "provincialTaxCents" | "additionalIncomeTaxCents">;
export function sumPayRunLines(lines: ReadonlyArray<Partial<PayRunAmounts>>): PayRunTotals {
  const total: PayRunTotals = {
    grossCents: 0,
    nonCashTaxableCents: 0,
    nonTaxableCashCents: 0,
    cppEmployeeCents: 0,
    cpp2EmployeeCents: 0,
    eiEmployeeCents: 0,
    incomeTaxCents: 0,
    otherDeductionsCents: 0,
    cppEmployerCents: 0,
    cpp2EmployerCents: 0,
    eiEmployerCents: 0,
    netCents: 0,
  };
  for (const line of lines) {
    for (const field of PAY_RUN_AMOUNT_FIELDS) total[field] += Math.round(Number(line[field] ?? 0) || 0);
  }
  for (const field of ["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"] as const) if (lines.length && lines.every((line) => line[field] !== undefined)) total[field] = lines.reduce((sum, line) => sum + Number(line[field] || 0), 0);
  return total;
}

export type RemittanceStatus = "paid" | "partial" | "overdue" | "due" | "unscheduled";

export function remittanceStatus(
  row: { amountDueCents: number; paidCents?: number; paidOn?: string; dueDate?: string | null },
  today: string,
): RemittanceStatus {
  const paid = Math.round(row.paidCents ?? 0);
  if (row.paidOn && paid >= row.amountDueCents) return "paid";
  if (!row.dueDate) return "unscheduled";
  if (row.dueDate < today) return paid > 0 ? "partial" : "overdue";
  return paid > 0 ? "partial" : "due";
}

export const REMITTANCE_STATUS_LABEL: Record<RemittanceStatus, string> = {
  paid: "Paid",
  partial: "Part paid",
  overdue: "Overdue",
  due: "Due",
  unscheduled: "Set the schedule",
};

/* ------------------------------------------------------- year-end slips */

export const SLIP_TYPES = ["T4", "T4A", "RL-1"] as const;
export type SlipType = (typeof SLIP_TYPES)[number];
export const SLIP_TYPE_LABEL: Record<SlipType, string> = {
  T4: "T4 (employment income)",
  T4A: "T4A (pension, other income)",
  "RL-1": "RL-1 (Québec employment income)",
};

export const SLIP_STATUSES = ["draft", "issued", "filed"] as const;
export type SlipStatus = (typeof SLIP_STATUSES)[number];
export const SLIP_STATUS_LABEL: Record<SlipStatus, string> = { draft: "Draft", issued: "Given to recipient", filed: "Filed" };

/** T4, T4A and RL-1 slips and summaries for `year` are due on the last day of February of the next year. */
export function slipFilingDeadline(year: number, province = "BC"): string {
  const next = Math.round(year) + 1;
  return nextCraPayrollBusinessDay(`${next}-02-${pad2(daysInMonth(next, 2))}`, province);
}

export type SlipTotals = { employmentIncomeCents: number; cppCents: number; cpp2Cents: number; eiCents: number; incomeTaxCents: number };

/**
 * Slip amounts per employee for a calendar year, from the per-employee lines
 * of the pay runs paid in that year (pay date decides the year, as for T4s).
 */
export function slipTotalsFromPayRuns(
  runs: ReadonlyArray<{ payDate: string; providerName?: string; lines?: ReadonlyArray<Partial<PayRunLine>> }>,
  year: number,
): Map<string, SlipTotals & { employeeName: string; employeeId?: string; providerEmployeeId?: string; providerName?: string }> {
  const byEmployee = new Map<string, SlipTotals & { employeeName: string; employeeId?: string; providerEmployeeId?: string; providerName?: string }>();
  for (const run of runs) {
    if (Number(String(run.payDate).slice(0, 4)) !== year) continue;
    for (const line of run.lines ?? []) {
      const key = line.employeeId ? `id:${line.employeeId}` : line.providerEmployeeId ? `provider:${String(run.providerName || "").trim().toLowerCase()}:${line.providerEmployeeId}` : `name:${String(line.employeeName ?? "").trim().toLowerCase()}`;
      if (key === "name:") continue;
      const current = byEmployee.get(key) ?? { employeeName: String(line.employeeName ?? ""), employeeId: line.employeeId, providerEmployeeId: line.providerEmployeeId, providerName: run.providerName, employmentIncomeCents: 0, cppCents: 0, cpp2Cents: 0, eiCents: 0, incomeTaxCents: 0 };
      current.employmentIncomeCents += Math.round(line.grossCents ?? 0);
      current.cppCents += Math.round(line.cppEmployeeCents ?? 0);
      current.cpp2Cents += Math.round(line.cpp2EmployeeCents ?? 0);
      current.eiCents += Math.round(line.eiEmployeeCents ?? 0);
      current.incomeTaxCents += Math.round(line.incomeTaxCents ?? 0);
      byEmployee.set(key, current);
    }
  }
  return byEmployee;
}

/* --------------------------------------------------- records of employment */

export const ROE_STATUSES = ["to_issue", "issued"] as const;
export type RoeStatus = (typeof ROE_STATUSES)[number];
export const ROE_STATUS_LABEL: Record<RoeStatus, string> = { to_issue: "To issue", issued: "Issued" };

export const ROE_REASONS = [
  { value: "A", label: "A: Shortage of work" },
  { value: "D", label: "D: Illness or injury" },
  { value: "E", label: "E: Quit" },
  { value: "F", label: "F: Maternity" },
  { value: "M", label: "M: Dismissal or suspension" },
  { value: "N", label: "N: Leave of absence" },
  { value: "P", label: "P: Parental" },
  { value: "K", label: "K: Other" },
] as const;

/* ----------------------------------------------- workers' compensation */

export const WORKERS_COMP_PROVIDERS = ["WorkSafeBC", "WSIB", "Other"] as const;
export const WORKERS_COMP_CADENCES = ["annual", "quarterly", "monthly"] as const;
export type WorkersCompCadence = (typeof WORKERS_COMP_CADENCES)[number];
export const WORKERS_COMP_CADENCE_LABEL: Record<WorkersCompCadence, string> = { annual: "Annually", quarterly: "Quarterly", monthly: "Monthly" };

const CADENCE_MONTHS: Record<WorkersCompCadence, number> = { annual: 12, quarterly: 3, monthly: 1 };

/**
 * The next workers' compensation report or premium date: the first date in the
 * series (`firstDueDate` advanced by the cadence) that is not already done.
 * `doneDates` are the dates already completed on the Deadlines page.
 */
export function nextWorkersCompDueDate(firstDueDate: string, cadence: WorkersCompCadence | string, doneDates: ReadonlySet<string>): string | null {
  if (!isCalendarDate(firstDueDate)) return null;
  const months = CADENCE_MONTHS[cadence as WorkersCompCadence];
  if (!months) return null;
  let date = firstDueDate;
  for (let index = 0; index < 400 && doneDates.has(date); index += 1) date = addMonthsClamped(firstDueDate, months * (index + 1));
  return date;
}

/* ------------------------------------------------------------- cards */

/** Exactly four digits: the only part of a card number Societyer keeps. */
export function isValidCardLast4(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

/** Thirteen or more digits in a row (spaces or dashes allowed between them): looks like a card number. */
export function containsCardNumber(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /(?:\d[ -]?){12,}\d/.test(text);
}

/** Throws unless `last4` is exactly four digits. Never echoes the input back. */
export function assertCardLast4(last4: unknown): string {
  const value = typeof last4 === "string" ? last4.trim() : "";
  if (!isValidCardLast4(value)) throw new Error("Card: enter only the last 4 digits of the card number.");
  return value;
}

/** Throws when free text holds what looks like a full card number. */
export function assertNoCardNumber(text: unknown, label: string) {
  if (containsCardNumber(text)) throw new Error(`${label}: remove the card number. Keep only the last 4 digits in the Last 4 field.`);
}

/** Transactions on a card account that belong to one card. Lines that name another card's last 4 are left out. */
export function belongsToCard(txn: { method?: string; description?: string }, last4: string): boolean {
  const hint = /(?:••|\*{2,}|x{2,}|ending in\s*)(\d{4})\b/i.exec(`${txn.method ?? ""} ${txn.description ?? ""}`);
  return !hint || hint[1] === last4;
}

export type CardTxn = {
  date: string;
  amountCents: number;
  category?: string;
  status?: string;
  receiptStatus?: string;
  method?: string;
  description?: string;
};

export type StatementInput = {
  periodStart: string;
  periodEnd: string;
  /** What was owed at the start of the period (positive = owed). */
  previousBalanceCents?: number;
  /** What the statement says is owed at the end of the period. */
  statementBalanceCents: number;
  reconciledAtISO?: string;
};

export type StatementReconciliation = {
  transactionCount: number;
  purchasesCents: number;
  creditsCents: number;
  paymentsCents: number;
  /** Previous balance + purchases − credits − payments. */
  expectedBalanceCents: number;
  /** Statement balance − expected balance. Zero when the feed agrees with the statement. */
  differenceCents: number;
  receiptsMissing: number;
  pendingCount: number;
  status: "reconciled" | "balanced" | "difference";
};

/**
 * Compare a card statement with the card lines in the bank feed for its
 * period. Charges are negative feed amounts; refunds are positive; payments
 * to the card are transfers. Pending lines are counted but not totalled.
 */
export function reconcileStatement(statement: StatementInput, txns: ReadonlyArray<CardTxn>): StatementReconciliation {
  let purchasesCents = 0;
  let creditsCents = 0;
  let paymentsCents = 0;
  let receiptsMissing = 0;
  let pendingCount = 0;
  let transactionCount = 0;
  for (const txn of txns) {
    if (txn.date < statement.periodStart || txn.date > statement.periodEnd) continue;
    if (txn.status === "pending") {
      pendingCount += 1;
      continue;
    }
    transactionCount += 1;
    const amount = Math.round(txn.amountCents || 0);
    if (amount < 0) {
      purchasesCents += -amount;
      if (txn.receiptStatus === "missing") receiptsMissing += 1;
    } else if (txn.category === TRANSFER_CATEGORY) paymentsCents += amount;
    else creditsCents += amount;
  }
  const expectedBalanceCents = Math.round(statement.previousBalanceCents ?? 0) + purchasesCents - creditsCents - paymentsCents;
  const differenceCents = Math.round(statement.statementBalanceCents) - expectedBalanceCents;
  return {
    transactionCount,
    purchasesCents,
    creditsCents,
    paymentsCents,
    expectedBalanceCents,
    differenceCents,
    receiptsMissing,
    pendingCount,
    status: statement.reconciledAtISO ? "reconciled" : differenceCents === 0 ? "balanced" : "difference",
  };
}

export const STATEMENT_STATUS_LABEL: Record<StatementReconciliation["status"], string> = {
  reconciled: "Reconciled",
  balanced: "Ready to reconcile",
  difference: "Difference",
};

/* ------------------------------------------------------- investments */

export const INVESTMENT_KINDS = ["gic", "term_deposit", "savings", "investment_account", "other"] as const;
export type InvestmentKind = (typeof INVESTMENT_KINDS)[number];
export const INVESTMENT_KIND_LABEL: Record<InvestmentKind, string> = {
  gic: "GIC",
  term_deposit: "Term deposit",
  savings: "Savings account",
  investment_account: "Investment account",
  other: "Other",
};

export const COMPOUNDING = ["simple", "annual", "monthly"] as const;
export type Compounding = (typeof COMPOUNDING)[number];
export const COMPOUNDING_LABEL: Record<Compounding, string> = { simple: "Simple interest", annual: "Compounded annually", monthly: "Compounded monthly" };

export const HOLDING_STATUSES = ["active", "redeemed"] as const;

/** Days before maturity that a reminder lands on the Deadlines page. */
export const MATURITY_REMINDER_DAYS = [30, 7] as const;

export type Holding = {
  principalCents: number;
  ratePercent?: number;
  compounding?: Compounding | string;
  startDate: string;
  maturityDate?: string;
  interestPaidCents?: number;
  /** Market value for investment accounts; replaces principal + accrued when set. */
  currentValueCents?: number;
  restricted?: boolean;
  status?: string;
};

/** Interest earned from the start date to `asOf` (or maturity, if sooner). Actual/365. */
export function interestEarnedCents(holding: Holding, asOf: string): number {
  const rate = Number(holding.ratePercent ?? 0) / 100;
  if (!(rate > 0) || !isCalendarDate(holding.startDate)) return 0;
  const end = holding.maturityDate && isCalendarDate(holding.maturityDate) && holding.maturityDate < asOf ? holding.maturityDate : asOf;
  const days = Math.max(0, daysBetween(holding.startDate, end));
  const years = days / 365;
  const principal = Math.max(0, Math.round(holding.principalCents || 0));
  let earned: number;
  if (holding.compounding === "annual") earned = principal * (Math.pow(1 + rate, years) - 1);
  else if (holding.compounding === "monthly") earned = principal * (Math.pow(1 + rate / 12, years * 12) - 1);
  else earned = principal * rate * years;
  return Math.round(earned);
}

/** Interest earned but not yet paid out. */
export function accruedInterestCents(holding: Holding, asOf: string): number {
  return Math.max(0, interestEarnedCents(holding, asOf) - Math.round(holding.interestPaidCents ?? 0));
}

/** What the holding is worth today for reserves: market value when given, else principal plus accrued interest. */
export function holdingValueCents(holding: Holding, asOf: string): number {
  if (holding.status === "redeemed") return 0;
  if (typeof holding.currentValueCents === "number" && Number.isFinite(holding.currentValueCents)) return Math.round(holding.currentValueCents);
  return Math.round(holding.principalCents || 0) + accruedInterestCents(holding, asOf);
}

export type HoldingStatus = "active" | "maturing" | "matured" | "redeemed";
export const HOLDING_STATUS_LABEL: Record<HoldingStatus, string> = { active: "Active", maturing: "Maturing soon", matured: "Matured", redeemed: "Redeemed" };

export function holdingStatus(holding: Holding, asOf: string): HoldingStatus {
  if (holding.status === "redeemed") return "redeemed";
  if (holding.maturityDate && isCalendarDate(holding.maturityDate)) {
    if (holding.maturityDate <= asOf) return "matured";
    if (daysBetween(asOf, holding.maturityDate) <= MATURITY_REMINDER_DAYS[0]) return "maturing";
  }
  return "active";
}

/** Reminder dates before maturity (30 and 7 days by default). */
export function maturityReminders(maturityDate: string | undefined, offsets: readonly number[] = MATURITY_REMINDER_DAYS): Array<{ daysBefore: number; date: string }> {
  if (!maturityDate || !isCalendarDate(maturityDate)) return [];
  return offsets.map((daysBefore) => ({ daysBefore, date: addDays(maturityDate, -daysBefore) }));
}

export type InvestedReserves = {
  totalCents: number;
  restrictedCents: number;
  unrestrictedCents: number;
  principalCents: number;
  accruedCents: number;
  activeCount: number;
  nextMaturity: { name: string; date: string; daysAway: number } | null;
};

/** The "invested reserves" figure: every holding not redeemed, at today's value, split restricted and unrestricted. */
export function investedReserves(holdings: ReadonlyArray<Holding & { name?: string }>, asOf: string): InvestedReserves {
  const out: InvestedReserves = { totalCents: 0, restrictedCents: 0, unrestrictedCents: 0, principalCents: 0, accruedCents: 0, activeCount: 0, nextMaturity: null };
  for (const holding of holdings) {
    if (holding.status === "redeemed") continue;
    const value = holdingValueCents(holding, asOf);
    out.totalCents += value;
    if (holding.restricted) out.restrictedCents += value;
    else out.unrestrictedCents += value;
    out.principalCents += Math.round(holding.principalCents || 0);
    out.accruedCents += accruedInterestCents(holding, asOf);
    out.activeCount += 1;
    if (holding.maturityDate && isCalendarDate(holding.maturityDate) && holding.maturityDate >= asOf) {
      if (!out.nextMaturity || holding.maturityDate < out.nextMaturity.date) {
        out.nextMaturity = { name: holding.name ?? "", date: holding.maturityDate, daysAway: daysBetween(asOf, holding.maturityDate) };
      }
    }
  }
  return out;
}

/* ------------------------------------------------- payroll provider CSV */

export const PAYROLL_CSV_FIELD_LABELS = {
  periodStart: "Period start", periodEnd: "Period end", payDate: "Pay date", employeeName: "Employee name", providerEmployeeId: "Provider employee ID",
  providerName: "Provider", providerRunId: "Provider run ID", runType: "Run type", correctionOfProviderRunId: "Corrects provider run ID",
  grossCents: "Taxable gross", nonCashTaxableCents: "Non-cash taxable benefits", nonTaxableCashCents: "Non-taxable cash / reimbursements",
  cppEmployeeCents: "Employee CPP", cpp2EmployeeCents: "Employee CPP2", eiEmployeeCents: "Employee EI", incomeTaxCents: "Combined income tax",
  federalTaxCents: "Federal income tax", provincialTaxCents: "Provincial income tax", additionalIncomeTaxCents: "Additional TD1 tax", otherDeductionsCents: "Other deductions",
  cppEmployerCents: "Employer CPP", cpp2EmployerCents: "Employer CPP2", eiEmployerCents: "Employer EI", netCents: "Net cash pay",
} as const;
export type PayrollCsvField = keyof typeof PAYROLL_CSV_FIELD_LABELS;
const CSV_HEADER_ALIASES: Record<PayrollCsvField, string[]> = {
  periodStart: ["period start", "pay period start", "start date", "period from", "from"],
  periodEnd: ["period end", "pay period end", "end date", "period to", "to", "period ending"],
  payDate: ["pay date", "payment date", "cheque date", "paid on", "date paid", "pay day"],
  employeeName: ["employee", "employee name", "name", "worker"],
  providerEmployeeId: ["employee id", "employee number", "employee code", "provider employee id", "worker id", "payroll id"],
  providerName: ["provider", "provider name", "payroll provider"], providerRunId: ["run id", "pay run id", "payroll run id", "provider run id", "payroll number"],
  runType: ["run type", "pay run type", "payroll type"], correctionOfProviderRunId: ["corrects run id", "correction of", "original run id", "corrects provider run id"],
  grossCents: ["gross", "gross pay", "gross earnings", "total gross", "earnings", "taxable gross"],
  nonCashTaxableCents: ["non cash taxable", "non cash taxable benefits", "noncash benefits", "taxable non cash benefits"],
  nonTaxableCashCents: ["non taxable cash", "reimbursements", "non taxable reimbursements", "non taxable cash / reimbursements"],
  cppEmployeeCents: ["cpp", "cpp employee", "employee cpp", "cpp/qpp", "cpp ee", "qpp"],
  cpp2EmployeeCents: ["cpp2", "cpp 2", "cpp2 employee", "employee cpp2", "cpp2 ee", "second cpp"],
  eiEmployeeCents: ["ei", "ei employee", "employee ei", "ei ee", "ei premium"],
  incomeTaxCents: ["income tax", "tax", "tax withheld", "income tax withheld", "fed + prov tax", "combined income tax"],
  federalTaxCents: ["federal tax", "federal income tax", "fed tax", "federal withholding"],
  provincialTaxCents: ["provincial tax", "provincial income tax", "prov tax", "bc tax", "provincial withholding"],
  additionalIncomeTaxCents: ["additional tax", "additional income tax", "extra withholding", "td1 additional tax"],
  otherDeductionsCents: ["other deductions", "other", "benefits", "union dues", "deductions other"],
  cppEmployerCents: ["cpp employer", "employer cpp", "cpp er", "er cpp"],
  cpp2EmployerCents: ["cpp2 employer", "employer cpp2", "cpp2 er", "er cpp2"],
  eiEmployerCents: ["ei employer", "employer ei", "ei er", "er ei"],
  netCents: ["net", "net pay", "take home", "net amount", "net cash pay"],
};
function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_]+/g, " ").replace(/[()$]/g, "").replace(/\s+/g, " ").trim();
}

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseAmountCents(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[$,\s]/g, "");
  const signed = /^\(.*\)$/.test(normalized) ? `-${normalized.slice(1, -1)}` : normalized;
  if (!/^-?\d+(\.\d{0,2})?$/.test(signed)) return null;
  return Math.round(Number(signed) * 100);
}

function parseCsvDate(value: string): string | null {
  const raw = value.trim();
  if (isCalendarDate(raw)) return raw;
  const slash = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(raw);
  if (slash) {
    const iso = `${slash[1]}-${pad2(Number(slash[2]))}-${pad2(Number(slash[3]))}`;
    return isCalendarDate(iso) ? iso : null;
  }
  return null;
}

export type ImportedPayRun = PayRunTotals & PayRunIdentity & {
  periodStart: string; periodEnd: string; payDate: string; lines: PayRunLine[];
  sourceMissingFields?: string[]; missingValuesConfirmed?: boolean;
};
export type PayrollCsvOptions = { mapping?: Partial<Record<PayrollCsvField, number | null>>; providerName?: string; confirmMissingAsZero?: boolean; standardEmployerShares?: boolean };
export type PayrollCsvResult = {
  runs: ImportedPayRun[]; errors: string[]; warnings: string[]; columns: string[]; headers: string[];
  mapping: Array<{ field: PayrollCsvField; label: string; column: number | null; header?: string }>;
  missingCells: Array<{ row: number; field: string }>; requiresReview: boolean; taxMode: "combined" | "split" | "missing";
};

/** Explicit mappings and missing-cell provenance keep absent deductions distinct from confirmed zeroes. */
export function parsePayrollCsv(text: string, options: PayrollCsvOptions = {}): PayrollCsvResult {
  const result: PayrollCsvResult = { runs: [], errors: [], warnings: [], columns: [], headers: [], mapping: [], missingCells: [], requiresReview: false, taxMode: "missing" };
  if (text.length > 2_000_000) { result.errors.push("Choose a payroll CSV smaller than 2 MB."); return result; }
  const table = parseCsv(text);
  if (table.length < 2) { result.errors.push("The file has no data rows."); return result; }
  if (table.length > 5001) { result.errors.push("Import at most 5,000 employee rows at a time."); return result; }
  result.headers = table[0];
  const headers = table[0].map(normalizeHeader), column: Partial<Record<PayrollCsvField, number>> = {};
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES) as Array<[PayrollCsvField, string[]]>) {
    const custom = options.mapping?.[field];
    const index = custom === null ? -1 : custom !== undefined ? custom : headers.findIndex((header) => aliases.includes(header));
    if (index >= 0 && index < headers.length) column[field] = index;
    result.mapping.push({ field, label: PAYROLL_CSV_FIELD_LABELS[field], column: column[field] ?? null, header: column[field] === undefined ? undefined : table[0][index] });
  }
  result.columns = Object.keys(column);
  for (const required of ["payDate", "grossCents"] as const) if (column[required] === undefined) result.errors.push(`Missing a ${required === "payDate" ? "pay date" : "gross pay"} column.`);
  if (result.errors.length) return result;
  result.taxMode = column.incomeTaxCents !== undefined ? "combined" : column.federalTaxCents !== undefined || column.provincialTaxCents !== undefined ? "split" : "missing";
  const runs = new Map<string, ImportedPayRun>();
  table.slice(1).forEach((cells, index) => {
    const row = index + 2, cell = (field: PayrollCsvField) => column[field] === undefined ? "" : String(cells[column[field]!] ?? "");
    const payDate = parseCsvDate(cell("payDate"));
    if (!payDate) { result.errors.push(`Row ${row}: pay date must be YYYY-MM-DD.`); return; }
    const periodEnd = column.periodEnd === undefined ? payDate : parseCsvDate(cell("periodEnd")), periodStart = column.periodStart === undefined ? periodEnd && monthStart(periodEnd) : parseCsvDate(cell("periodStart"));
    if (!periodStart || !periodEnd || periodStart > periodEnd) { result.errors.push(`Row ${row}: choose valid period dates in YYYY-MM-DD order.`); return; }
    const rowMissing: string[] = []; let invalid = false;
    const amount = (field: PayrollCsvField) => {
      const value = cell(field), parsed = parseAmountCents(value);
      if (parsed === null && value.trim()) { result.errors.push(`Row ${row}: ${PAYROLL_CSV_FIELD_LABELS[field]} is not an amount.`); invalid = true; return 0; }
      if (parsed === null) { rowMissing.push(field); result.missingCells.push({ row, field }); return 0; }
      if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 100_000_000_000) { result.errors.push(`Row ${row}: amount is too large.`); invalid = true; return 0; }
      return parsed;
    };
    const amounts = Object.fromEntries(PAY_RUN_AMOUNT_FIELDS.filter((field) => field !== "incomeTaxCents" && field !== "netCents" && !["cppEmployerCents", "cpp2EmployerCents", "eiEmployerCents"].includes(field)).map((field) => [field, amount(field)])) as PayRunTotals;
    for (const field of ["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"] as const) if (column[field] !== undefined && cell(field).trim()) amounts[field] = amount(field);
    if (column.incomeTaxCents !== undefined) {
      amounts.incomeTaxCents = amount("incomeTaxCents");
      if (column.federalTaxCents !== undefined && column.provincialTaxCents !== undefined && cell("federalTaxCents").trim() && cell("provincialTaxCents").trim()) {
        const split = (amounts.federalTaxCents || 0) + (amounts.provincialTaxCents || 0) + (amounts.additionalIncomeTaxCents || 0);
        if (split !== amounts.incomeTaxCents) { result.errors.push(`Row ${row}: combined income tax disagrees with federal plus provincial tax. Correct the mapping.`); invalid = true; }
      }
    } else if (result.taxMode === "split") amounts.incomeTaxCents = (amounts.federalTaxCents ?? amount("federalTaxCents")) + (amounts.provincialTaxCents ?? amount("provincialTaxCents")) + (amounts.additionalIncomeTaxCents || 0);
    else amounts.incomeTaxCents = amount("incomeTaxCents");
    for (const [employer, employee, multiplier] of [["cppEmployerCents", "cppEmployeeCents", 1], ["cpp2EmployerCents", "cpp2EmployeeCents", 1], ["eiEmployerCents", "eiEmployeeCents", 1.4]] as const) {
      if (options.standardEmployerShares && !cell(employer).trim()) amounts[employer] = Math.round(amounts[employee] * multiplier);
      else amounts[employer] = amount(employer);
    }
    amounts.netCents = cell("netCents").trim() ? amount("netCents") : amounts.grossCents - amounts.nonCashTaxableCents + amounts.nonTaxableCashCents - amounts.cppEmployeeCents - amounts.cpp2EmployeeCents - amounts.eiEmployeeCents - amounts.incomeTaxCents - amounts.otherDeductionsCents;
    if (invalid) return;
    const rawType = cell("runType").trim().toLowerCase().replace(/[ -]+/g, "_"), runType = (rawType || "regular") as PayRunType;
    if (!(PAY_RUN_TYPES as readonly string[]).includes(runType)) { result.errors.push(`Row ${row}: choose regular, bonus, off_cycle, final, correction or reversal as the run type.`); return; }
    const providerRunId = cell("providerRunId").trim(), correctionOfProviderRunId = cell("correctionOfProviderRunId").trim(), providerName = cell("providerName").trim() || options.providerName;
    if (runType !== "regular" && !providerRunId) { result.errors.push(`Row ${row}: non-regular runs need a provider run ID to distinguish additional payrolls.`); return; }
    if (["correction", "reversal"].includes(runType) && !correctionOfProviderRunId) { result.errors.push(`Row ${row}: identify the original provider run being corrected.`); return; }
    const providerEmployeeId = cell("providerEmployeeId").trim(), employeeName = cell("employeeName").trim() || providerEmployeeId;
    if (containsCardNumber(employeeName)) { result.errors.push(`Row ${row}: the employee column holds a long number.`); return; }
    const identity = { periodStart, periodEnd, payDate, providerName, ...(providerRunId ? { providerRunId } : {}), runType, ...(correctionOfProviderRunId ? { correctionOfProviderRunId } : {}) };
    const key = payRunImportKey(identity), previous = runs.get(key), run: ImportedPayRun = previous ?? { ...sumPayRunLines([]), ...identity, lines: [] };
    if (run.periodStart !== periodStart || run.periodEnd !== periodEnd || run.payDate !== payDate) { result.errors.push(`Row ${row}: the same provider run ID has conflicting dates.`); return; }
    if (providerEmployeeId && run.lines.some((line) => line.providerEmployeeId === providerEmployeeId)) { result.errors.push(`Row ${row}: duplicate employee ID within one run. Consolidate the employee's earnings first.`); return; }
    for (const field of PAY_RUN_AMOUNT_FIELDS) run[field] += amounts[field];
    for (const field of ["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"] as const) run[field] = amounts[field] === undefined || previous && previous[field] === undefined ? undefined : Number(previous?.[field] || 0) + amounts[field]!;
    if (employeeName) run.lines.push({ employeeName, ...(providerEmployeeId ? { providerEmployeeId } : {}), ...amounts });
    run.sourceMissingFields = [...new Set([...(run.sourceMissingFields || []), ...rowMissing])];
    run.missingValuesConfirmed = !!options.confirmMissingAsZero;
    runs.set(key, run);
  });
  result.runs = [...runs.values()].sort((a, b) => a.payDate.localeCompare(b.payDate));
  if (result.missingCells.length) result.warnings.push(`${result.missingCells.length} missing deduction or contribution cells are not confirmed zeroes. Map them or explicitly confirm zero values.`);
  if (options.standardEmployerShares) result.warnings.push("You selected matching employer CPP/CPP2 and standard 1.4× EI for missing employer amounts. Verify any approved reduced EI rate separately.");
  if (column.providerRunId === undefined) result.warnings.push("No provider run ID is mapped. Only regular payroll can use the legacy period/provider identity.");
  result.requiresReview = result.missingCells.length > 0 && !options.confirmMissingAsZero;
  return result;
}

/* ------------------------------------------------------ deadline feed */

export type RegisterDeadline = {
  sourceKey: string;
  title: string;
  description: string;
  dueDate: string;
  category: string;
  /** Done in the register: an open generated deadline is completed, never re-created. */
  done: boolean;
};

export const REGISTER_DEADLINE_PREFIXES = ["payroll:", "investments:"] as const;

export function isRegisterDeadlineKey(key: unknown): key is string {
  return typeof key === "string" && REGISTER_DEADLINE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Split a whole amount over weights so the parts add up exactly (largest remainder). */
export function splitCents(total: number, weights: number[]): number[] {
  if (total < 0) return allocateProportionally(-total, weights).map((part) => -part);
  return allocateProportionally(total, weights);
}

/* ----------------------------------------------- remittances from pay runs */

export type RemittancePeriodTotal = { periodStart: string; periodEnd: string; dueDate: string | null; amountDueCents: number; payRunCount: number; schedule?: RemittanceScheduleRule };

/** One remittance per period that has pay runs, its amount what those runs owe the CRA. */
export function remittancesFromPayRuns(runs: ReadonlyArray<PayRunAmounts & { payDate: string }>, schedule: RemittanceSchedule | null | undefined): RemittancePeriodTotal[] {
  const byPeriod = new Map<string, RemittancePeriodTotal>();
  for (const run of runs) {
    if (!isCalendarDate(run.payDate)) continue;
    const effective = schedule ? remittanceScheduleForPayDate(run.payDate, schedule) : null;
    const nativePeriod = remittancePeriodFor(run.payDate, effective) ?? { start: monthStart(run.payDate), end: monthEnd(run.payDate) };
    const period = { ...nativePeriod };
    for (const change of schedule?.remittanceScheduleHistory || []) {
      if (change.effectiveFrom <= run.payDate && change.effectiveFrom > period.start) period.start = change.effectiveFrom;
      if (change.effectiveFrom > run.payDate && change.effectiveFrom <= period.end) period.end = addDays(change.effectiveFrom, -1);
    }
    const key = `${period.start}|${period.end}`;
    const entry = byPeriod.get(key) ?? { periodStart: period.start, periodEnd: period.end, dueDate: remittanceDueDate(nativePeriod, effective), amountDueCents: 0, payRunCount: 0, ...(effective ? { schedule: remittanceRule(effective) } : {}) };
    entry.amountDueCents += remittableCents(run);
    entry.payRunCount += 1;
    byPeriod.set(key, entry);
  }
  return [...byPeriod.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/* ------------------------------------------------- generated deadlines */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A period as people say it: "April 2026" for a whole calendar month,
 * "Sep 1–15, 2026" within a month, otherwise "Dec 16, 2025 – Jan 15, 2026".
 */
export function periodLabel(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sd === 1 && sy === ey && sm === em && end === monthEnd(start)) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy === ey && sm === em) return `${MONTH_ABBR[sm - 1]} ${sd}–${ed}, ${sy}`;
  if (sy === ey) return `${MONTH_ABBR[sm - 1]} ${sd} – ${MONTH_ABBR[em - 1]} ${ed}, ${sy}`;
  return `${MONTH_ABBR[sm - 1]} ${sd}, ${sy} – ${MONTH_ABBR[em - 1]} ${ed}, ${ey}`;
}

/** "Nov 28, 2026" for a calendar date. */
export function humanDate(date: string) {
  if (!isCalendarDate(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

function dollars(centsValue: number) {
  return `$${(centsValue / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type RegisterDeadlineInput = {
  remittances: ReadonlyArray<{ periodStart: string; periodEnd: string; dueDate?: string | null; amountDueCents: number; paidCents?: number; paidOn?: string }>;
  slips: ReadonlyArray<{ year: number; slipType: string; status: string }>;
  payDates: ReadonlyArray<string>;
  roes: ReadonlyArray<{ _id: string; employeeName: string; dueDate?: string; status: string }>;
  settings: { workersCompFirstDueDate?: string; workersCompCadence?: string; workersCompProvider?: string } | null;
  holdings: ReadonlyArray<{ _id: string; name: string; maturityDate?: string; status?: string; autoRenew?: boolean }>;
};

type ExistingDeadline = { sourceKey?: string; status?: string; done?: boolean };

const isOpenDeadline = (row: ExistingDeadline) => (row.status ?? (row.done ? "complete" : "open")) === "open";

/**
 * Every deadline the payroll and investment registers want on the Deadlines
 * page. Open work is listed; work already done in a register is listed only
 * when a generated deadline for it is still open (so a sync completes it).
 */
export function registerDeadlines(input: RegisterDeadlineInput, today: string, existing: ReadonlyArray<ExistingDeadline>): RegisterDeadline[] {
  const out: RegisterDeadline[] = [];
  const openKeys = new Set(existing.filter(isOpenDeadline).map((row) => String(row.sourceKey)));
  const completedKeys = new Set(existing.filter((row) => !isOpenDeadline(row)).map((row) => String(row.sourceKey)));

  // CRA remittances.
  for (const row of input.remittances) {
    if (!row.dueDate || row.amountDueCents <= 0) continue;
    const sourceKey = `payroll:remit:${row.periodStart}`;
    const done = remittanceStatus({ ...row, dueDate: row.dueDate }, today) === "paid";
    if (done && !openKeys.has(sourceKey)) continue;
    out.push({
      sourceKey,
      title: `Remit payroll source deductions for ${periodLabel(row.periodStart, row.periodEnd)}`,
      description: `${dollars(row.amountDueCents)} of CPP, CPP2, EI and income tax to the CRA. From the payroll register.`,
      dueDate: row.dueDate,
      category: "Payroll",
      done,
    });
  }

  // Year-end slips: one deadline per slip type and year with pay runs or slips.
  const years = new Map<string, { year: number; type: string; total: number; filed: number }>();
  for (const slip of input.slips) {
    const key = `${slip.slipType}:${slip.year}`;
    const entry = years.get(key) ?? { year: slip.year, type: slip.slipType, total: 0, filed: 0 };
    entry.total += 1;
    if (slip.status === "filed") entry.filed += 1;
    years.set(key, entry);
  }
  for (const payDate of input.payDates) {
    const year = Number(String(payDate).slice(0, 4));
    if (year && !years.has(`T4:${year}`)) years.set(`T4:${year}`, { year, type: "T4", total: 0, filed: 0 });
  }
  for (const entry of [...years.values()].sort((a, b) => a.year - b.year || a.type.localeCompare(b.type))) {
    const sourceKey = `payroll:slips:${entry.type}:${entry.year}`;
    const done = entry.total > 0 && entry.filed === entry.total;
    const dueDate = slipFilingDeadline(entry.year);
    if (done && !openKeys.has(sourceKey)) continue;
    // A past year with pay runs but no slips at all is not raised after the fact.
    if (!done && !openKeys.has(sourceKey) && !completedKeys.has(sourceKey) && dueDate < today && entry.total === 0) continue;
    out.push({
      sourceKey,
      title: `File ${entry.type} slips and summary for ${entry.year}`,
      description: entry.total
        ? `${entry.filed} of ${entry.total} slips filed. From the payroll register.`
        : `Prepare ${entry.type} slips from the ${entry.year} pay runs. From the payroll register.`,
      dueDate,
      category: "Payroll",
      done,
    });
  }

  // Records of employment with a due date.
  for (const roe of input.roes) {
    if (!roe.dueDate) continue;
    const sourceKey = `payroll:roe:${roe._id}`;
    const done = roe.status === "issued";
    if (done && !openKeys.has(sourceKey)) continue;
    out.push({ sourceKey, title: "Issue a record of employment", description: "Open the protected payroll register for employee details and issuance evidence.", dueDate: roe.dueDate, category: "Payroll", done });
  }

  // Workers' compensation: the next date in the series not already completed.
  const settings = input.settings;
  if (settings?.workersCompFirstDueDate && settings.workersCompCadence) {
    const prefix = "payroll:workers-comp:";
    const doneDates = new Set([...completedKeys].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
    const dueDate = nextWorkersCompDueDate(settings.workersCompFirstDueDate, settings.workersCompCadence, doneDates);
    if (dueDate) {
      const provider = settings.workersCompProvider && settings.workersCompProvider !== "Other" ? settings.workersCompProvider : "the workers' compensation board";
      out.push({ sourceKey: `${prefix}${dueDate}`, title: `Report payroll and pay premiums to ${provider}`, description: "From the payroll register.", dueDate, category: "Payroll", done: false });
    }
  }

  // Maturity reminders while a holding is held.
  for (const holding of input.holdings) {
    const held = holding.status !== "redeemed";
    for (const reminder of maturityReminders(holding.maturityDate)) {
      const sourceKey = `investments:maturity:${holding._id}:${reminder.daysBefore}`;
      const done = !held || (holding.maturityDate ?? "") < today;
      if (done && !openKeys.has(sourceKey)) continue;
      out.push({
        sourceKey,
        title: `${holding.name} matures in ${reminder.daysBefore} days`,
        description: `Matures ${humanDate(String(holding.maturityDate))}${holding.autoRenew ? " and renews automatically unless you tell the institution otherwise" : ""}. Decide whether to renew, move or redeem it. From the investments register.`,
        dueDate: reminder.date,
        category: "Other",
        done,
      });
    }
  }
  return out;
}
