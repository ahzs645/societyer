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
 * Quarterly and accelerated remitters follow the schedule on their CRA
 * notice, so the organization enters that cadence and due day itself. Dates
 * are not moved for weekends or holidays. A record of employment and workers'
 * compensation reports are due on dates the organization sets.
 *
 * Pure TypeScript shared by the portable functions, the demo generators, the
 * pages and the gate (scripts/check-business-registers.ts). Dates are
 * calendar dates (YYYY-MM-DD) in the organization's time zone.
 */
import { addDays, addMonthsClamped, allocateProportionally, daysBetween, isCalendarDate } from "./invoicing";
import { TRANSFER_CATEGORY } from "./transferCategories";

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

export const REMITTER_TYPES = ["regular", "quarterly", "accelerated"] as const;
export type RemitterType = (typeof REMITTER_TYPES)[number];
export const REMITTER_TYPE_LABEL: Record<RemitterType, string> = {
  regular: "Regular (monthly)",
  quarterly: "Quarterly",
  accelerated: "Accelerated",
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

export type RemittanceSchedule = {
  remitterType: RemitterType | string;
  /** Quarterly and accelerated remitters: how often deductions are remitted. */
  cadence?: RemittanceCadence | string;
  dueRule?: RemittanceDueRule | string;
  /** The day of the following month, or the number of days after the period ends. */
  dueValue?: number;
};

export type Period = { start: string; end: string };

/** Whether the schedule says enough to compute due dates. */
export function scheduleIsComplete(schedule: RemittanceSchedule | null | undefined): boolean {
  if (!schedule) return false;
  if (schedule.remitterType === "regular") return true;
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
  if (!isCalendarDate(payDate) || !scheduleIsComplete(schedule)) return null;
  const cadence = schedule!.remitterType === "regular" ? "monthly" : schedule!.cadence;
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
  if (!scheduleIsComplete(schedule) || !isCalendarDate(period.end)) return null;
  if (schedule!.remitterType === "regular") return dayOfFollowingMonth(period.end, REGULAR_REMITTANCE_DUE_DAY);
  if (schedule!.dueRule === "days_after_period_end") return addDays(period.end, Math.round(Number(schedule!.dueValue)));
  return dayOfFollowingMonth(period.end, Number(schedule!.dueValue));
}

export type PayRunAmounts = {
  grossCents: number;
  cppEmployeeCents: number;
  eiEmployeeCents: number;
  incomeTaxCents: number;
  otherDeductionsCents?: number;
  cppEmployerCents: number;
  eiEmployerCents: number;
  netCents: number;
};

export const PAY_RUN_AMOUNT_FIELDS = [
  "grossCents",
  "cppEmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "otherDeductionsCents",
  "cppEmployerCents",
  "eiEmployerCents",
  "netCents",
] as const;

/** What the CRA is owed for one pay run: the employee deductions withheld plus the employer's CPP and EI. */
export function remittableCents(run: PayRunAmounts): number {
  return (
    Math.round(run.cppEmployeeCents || 0) +
    Math.round(run.eiEmployeeCents || 0) +
    Math.round(run.incomeTaxCents || 0) +
    Math.round(run.cppEmployerCents || 0) +
    Math.round(run.eiEmployerCents || 0)
  );
}

/** Gross minus every deduction, less the net actually paid. Zero when the run adds up. */
export function payRunDifferenceCents(run: PayRunAmounts): number {
  const deductions =
    Math.round(run.cppEmployeeCents || 0) +
    Math.round(run.eiEmployeeCents || 0) +
    Math.round(run.incomeTaxCents || 0) +
    Math.round(run.otherDeductionsCents || 0);
  return Math.round(run.grossCents || 0) - deductions - Math.round(run.netCents || 0);
}

/** Employer cost of a run: gross pay plus the employer's CPP and EI. */
export function employerCostCents(run: PayRunAmounts): number {
  return Math.round(run.grossCents || 0) + Math.round(run.cppEmployerCents || 0) + Math.round(run.eiEmployerCents || 0);
}

export type PayRunLine = PayRunAmounts & { employeeId?: string; employeeName: string };

/** Sum per-employee lines into run totals. */
export function sumPayRunLines(lines: ReadonlyArray<Partial<PayRunAmounts>>): Required<PayRunAmounts> {
  const total: Required<PayRunAmounts> = {
    grossCents: 0,
    cppEmployeeCents: 0,
    eiEmployeeCents: 0,
    incomeTaxCents: 0,
    otherDeductionsCents: 0,
    cppEmployerCents: 0,
    eiEmployerCents: 0,
    netCents: 0,
  };
  for (const line of lines) {
    for (const field of PAY_RUN_AMOUNT_FIELDS) total[field] += Math.round(Number(line[field] ?? 0) || 0);
  }
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
export function slipFilingDeadline(year: number): string {
  const next = Math.round(year) + 1;
  return `${next}-02-${pad2(daysInMonth(next, 2))}`;
}

export type SlipTotals = { employmentIncomeCents: number; cppCents: number; eiCents: number; incomeTaxCents: number };

/**
 * Slip amounts per employee for a calendar year, from the per-employee lines
 * of the pay runs paid in that year (pay date decides the year, as for T4s).
 */
export function slipTotalsFromPayRuns(
  runs: ReadonlyArray<{ payDate: string; lines?: ReadonlyArray<Partial<PayRunLine>> }>,
  year: number,
): Map<string, SlipTotals & { employeeName: string; employeeId?: string }> {
  const byEmployee = new Map<string, SlipTotals & { employeeName: string; employeeId?: string }>();
  for (const run of runs) {
    if (Number(String(run.payDate).slice(0, 4)) !== year) continue;
    for (const line of run.lines ?? []) {
      const key = line.employeeId ? `id:${line.employeeId}` : `name:${String(line.employeeName ?? "").trim().toLowerCase()}`;
      if (key === "name:") continue;
      const current = byEmployee.get(key) ?? { employeeName: String(line.employeeName ?? ""), employeeId: line.employeeId, employmentIncomeCents: 0, cppCents: 0, eiCents: 0, incomeTaxCents: 0 };
      current.employmentIncomeCents += Math.round(line.grossCents ?? 0);
      current.cppCents += Math.round(line.cppEmployeeCents ?? 0);
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

const CSV_HEADER_ALIASES: Record<string, string[]> = {
  periodStart: ["period start", "pay period start", "start date", "period from", "from"],
  periodEnd: ["period end", "pay period end", "end date", "period to", "to", "period ending"],
  payDate: ["pay date", "payment date", "cheque date", "paid on", "date paid", "pay day"],
  employeeName: ["employee", "employee name", "name", "worker"],
  grossCents: ["gross", "gross pay", "gross earnings", "total gross", "earnings"],
  cppEmployeeCents: ["cpp", "cpp employee", "employee cpp", "cpp/qpp", "cpp ee", "qpp"],
  eiEmployeeCents: ["ei", "ei employee", "employee ei", "ei ee", "ei premium"],
  incomeTaxCents: ["income tax", "federal tax", "tax", "tax withheld", "income tax withheld", "fed + prov tax"],
  otherDeductionsCents: ["other deductions", "other", "benefits", "union dues", "deductions other"],
  cppEmployerCents: ["cpp employer", "employer cpp", "cpp er", "er cpp"],
  eiEmployerCents: ["ei employer", "employer ei", "ei er", "er ei"],
  netCents: ["net", "net pay", "take home", "net amount"],
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
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const cleaned = raw.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return negative ? -cents : cents;
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

export type ImportedPayRun = Required<PayRunAmounts> & {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  lines: PayRunLine[];
};

export type PayrollCsvResult = { runs: ImportedPayRun[]; errors: string[]; columns: string[] };

/**
 * Read a payroll provider's register export. One row per employee per pay
 * run (or one row per run without an employee column); rows with the same
 * period and pay date form one run. Dates must be YYYY-MM-DD (or YYYY/MM/DD):
 * day-first and month-first dates can't be told apart. Missing employer CPP
 * defaults to the employee CPP and missing employer EI to 1.4 × employee EI,
 * the usual employer share; net defaults to gross minus deductions.
 */
export function parsePayrollCsv(text: string): PayrollCsvResult {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { runs: [], errors: ["The file has no data rows."], columns: [] };
  const headers = table[0].map(normalizeHeader);
  const column: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
    const index = headers.findIndex((header) => aliases.includes(header));
    if (index >= 0) column[field] = index;
  }
  for (const required of ["payDate", "grossCents"]) {
    if (column[required] === undefined) errors.push(`Missing a ${required === "payDate" ? "pay date" : "gross pay"} column.`);
  }
  if (errors.length) return { runs: [], errors, columns: Object.keys(column) };
  const runs = new Map<string, ImportedPayRun>();
  table.slice(1).forEach((cells, index) => {
    const lineNo = index + 2;
    const cell = (field: string) => (column[field] === undefined ? "" : String(cells[column[field]] ?? ""));
    const payDate = parseCsvDate(cell("payDate"));
    if (!payDate) { errors.push(`Row ${lineNo}: pay date must be YYYY-MM-DD.`); return; }
    const periodEnd = column.periodEnd === undefined ? payDate : parseCsvDate(cell("periodEnd"));
    const periodStart = column.periodStart === undefined ? (periodEnd ? monthStart(periodEnd) : null) : parseCsvDate(cell("periodStart"));
    if (!periodStart || !periodEnd) { errors.push(`Row ${lineNo}: period dates must be YYYY-MM-DD.`); return; }
    const amounts: Record<string, number> = {};
    for (const field of PAY_RUN_AMOUNT_FIELDS) {
      const value = parseAmountCents(cell(field));
      if (value === null) { errors.push(`Row ${lineNo}: "${cell(field)}" is not an amount.`); return; }
      amounts[field] = value;
    }
    if (column.cppEmployerCents === undefined) amounts.cppEmployerCents = amounts.cppEmployeeCents;
    if (column.eiEmployerCents === undefined) amounts.eiEmployerCents = Math.round(amounts.eiEmployeeCents * 1.4);
    if (column.netCents === undefined) {
      amounts.netCents = amounts.grossCents - amounts.cppEmployeeCents - amounts.eiEmployeeCents - amounts.incomeTaxCents - amounts.otherDeductionsCents;
    }
    const employeeName = cell("employeeName").trim();
    if (containsCardNumber(employeeName)) { errors.push(`Row ${lineNo}: the employee column holds a long number.`); return; }
    const key = `${periodStart}|${periodEnd}|${payDate}`;
    const run = runs.get(key) ?? {
      periodStart, periodEnd, payDate, lines: [],
      grossCents: 0, cppEmployeeCents: 0, eiEmployeeCents: 0, incomeTaxCents: 0, otherDeductionsCents: 0, cppEmployerCents: 0, eiEmployerCents: 0, netCents: 0,
    };
    for (const field of PAY_RUN_AMOUNT_FIELDS) run[field] += amounts[field];
    if (employeeName) run.lines.push({ employeeName, ...(amounts as Required<PayRunAmounts>) });
    runs.set(key, run);
  });
  return { runs: [...runs.values()].sort((a, b) => a.payDate.localeCompare(b.payDate)), errors, columns: Object.keys(column) };
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

export type RemittancePeriodTotal = { periodStart: string; periodEnd: string; dueDate: string | null; amountDueCents: number; payRunCount: number };

/** One remittance per period that has pay runs, its amount what those runs owe the CRA. */
export function remittancesFromPayRuns(runs: ReadonlyArray<PayRunAmounts & { payDate: string }>, schedule: RemittanceSchedule | null | undefined): RemittancePeriodTotal[] {
  const byPeriod = new Map<string, RemittancePeriodTotal>();
  for (const run of runs) {
    if (!isCalendarDate(run.payDate)) continue;
    const period = remittancePeriodFor(run.payDate, schedule) ?? { start: monthStart(run.payDate), end: monthEnd(run.payDate) };
    const key = `${period.start}|${period.end}`;
    const entry = byPeriod.get(key) ?? { periodStart: period.start, periodEnd: period.end, dueDate: remittanceDueDate(period, schedule), amountDueCents: 0, payRunCount: 0 };
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
      description: `${dollars(row.amountDueCents)} of CPP, EI and income tax to the CRA. From the payroll register.`,
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
    out.push({ sourceKey, title: `Issue a record of employment for ${roe.employeeName}`, description: "From the payroll register.", dueDate: roe.dueDate, category: "Payroll", done });
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
