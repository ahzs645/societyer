/** Original, deterministic B.C. ordinary-employment earnings rules. Money is CAD cents.
 * Unsupported employment agreements never inherit ordinary-policy results silently.
 */
export const BC_EARNINGS_RULES_VERSION = 'bc-ordinary-2026.5';
export const BC_EARNINGS_SOURCES = [
  { id: 'bc-esa', url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/00_96113_01', sections: '17–18, 36, 40, 44–46, 49.1, 57–58', reviewed: '2026-10-23' },
  { id: 'bc-minimum-wage', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/wages/minimum-wage', sections: 'Ordinary minimum wage, effective June 1, 2026', reviewed: '2026-10-23' },
  { id: 'bc-holidays', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays', sections: 'Published 2024, 2025 and 2026 statutory holiday calendars', reviewed: '2026-10-23' },
  { id: 'bc-vacation', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-7-section-58', sections: 'Fifth-year adjustment and vacation-pay wages', reviewed: '2026-10-23' },
  { id: 'bc-sick', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-6-section-49-1', sections: 'Calendar-year bank, partial days and average wages', reviewed: '2026-10-23' },
  { id: 'cra-continuous-vacation', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/special-payments/vacation-pay-public-holidays.html', sections: 'Vacation paid continuously or without vacation leave: bonus/irregular method', reviewed: '2026-10-23' },
] as const;

export type PayrollEarningsBases = { cashCents: number; taxableCents: number; pensionableCents: number; insurableCents: number; vacationableCents: number; ehtCents: number; workSafeCents: number };
export type ClassifiedEarning = {
  id?: string; date: string; code: string; label: string; amountCents: number;
  cash: boolean; taxable: boolean; pensionable: boolean; insurable: boolean; vacationable: boolean; eht: boolean; workSafe: boolean;
  kind: 'regular' | 'bonus' | 'benefit' | 'reimbursement' | 'vacation' | 'holiday' | 'sick' | 'overtime';
  /** CRA continuous vacation payments use the irregular/bonus method. */
  deductionTreatment?: 'regular' | 'bonus';
  minutes?: number; rateCents?: number; classificationEvidence?: string;
  /** Exact derived salary rate; display rateCents is rounded, calculation is not. */
  ratePrecision?: { numeratorCents: string; denominator: string };
};
export type BcWorkDay = {
  date: string; minutes: number; hourlyRateCents: number; holiday?: boolean; sickLeave?: 'paid' | 'unpaid';
  /** Ordinary minutes needing the weekly-rest premium, excluding minutes already paid at overtime/holiday rates. */
  restPremiumMinutes?: number;
  /** Explicit amounts of fixed salary already satisfying this day's leave entitlement. */
  salaryIncludedHolidayCents?: number; salaryIncludedSickCents?: number;
  /** Approved ordinary annual leave already paid inside fixed salary, not extra cash. */
  paidVacationMinutes?: number; salaryVacationSourceReference?: string;
};
/** One record per calendar day, excluding every overtime amount, including paid leave. */
export type BcWageHistoryDay = { date: string; nonOvertimeWagesCents: number; workedOrEarned: boolean };
export type BcEarningsInput = {
  /** Selected by the server from run type; supplementary runs cannot replay work. */
  mode?: 'regular' | 'adjustments_only';
  periodStart: string; periodEnd: string; payDate: string; employmentStartDate: string; employmentEndDate?: string;
  policy: 'ordinary_bc'; restPeriodsConfirmed: boolean;
  context: { from: string; to: string; complete: boolean }; workDays: BcWorkDay[];
  history?: BcWageHistoryDay[]; historyCompleteFrom?: string;
  vacation: { mode: 'accrue' | 'pay_each_cheque'; ratePercent?: number; eachChequeAgreementConfirmed?: boolean };
  sickBank?: { year: number; paidDaysUsed: number; unpaidDaysUsed: number };
  additionalEarnings?: ClassifiedEarning[];
  fifthYearVacationReconciliation?: { fifthYearGrossWagesCents: number; vacationAlreadyPaidCents: number; vacationAlreadyAccruedCents?: number; previousVacationRatePercent: number; reviewed: boolean; evidence: string };
  finalVacationPayout?: { priorAccruedCents: number; sourceEvidence: string };
  salaryVacationLiability?: { availableAccruedCents: number; sourceEvidence: string };
  vacationLiabilityPayout?: { amountCents: number; availableAccruedCents: number; sourceEvidence: string; treatment: 'vacation_leave' | 'unused_cashout' };
  salary?: { basis: 'monthly' | 'annual'; amountCents: number; normalWeeklyMinutes: number; averageWeeklyMinutes: number; periodSalaryCents: number; /** Reviewed fixed salary calendar; distinct from the hourly equivalent used for overtime. */ payPeriodsPerYear?: 24 | 26 | 27 | 52 | 53; calendarConfirmed?: boolean; calendarPeriodStart?: string; calendarPeriodEnd?: string; proration?: { basis: 'calendar_days'; reviewed: boolean; evidence: string }; /** Worked minutes whose underlying 1× wage is already in fixed salary, including any premium minutes. */ coveredStraightTimeMinutes: number };
};
export type BcEarningsResult = {
  lines: ClassifiedEarning[]; bases: PayrollEarningsBases; regularBases: PayrollEarningsBases; bonusBases: PayrollEarningsBases;
  vacationAccruedCents: number; minutes: { regular: number; overtime15: number; overtime2: number };
  priorVacationLiabilityReleasedCents: number;
  salaryVacationPaidCents: number; salaryVacationLiabilityReleasedCents: number; paidVacationMinutes: number; currentVacationPaidCents: number;
  ordinaryVacationLiabilityReleasedCents: number;
  sickBank?: { year: number; paidDaysUsed: number; unpaidDaysUsed: number };
  vacationReconciliation?: { requiredCents: number; adjustmentCents: number; currentPeriodVacationCents: number; evidence: string };
  warnings: string[]; blockers: string[]; rulesVersion: string; sources: typeof BC_EARNINGS_SOURCES;
};

const DAY = 86_400_000;
function dateMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use an ISO calendar date.');
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date.');
  return time;
}
function dateString(ms: number) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(date: string, days: number) { return dateString(dateMs(date) + days * DAY); }
function daysBetween(from: string, to: string) { return (dateMs(to) - dateMs(from)) / DAY; }
function integer(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be a nonnegative safe integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ''}.`);
  return value;
}
function money(value: number, label = 'Money') { return integer(value, label); }
/** Round a nonnegative exact ratio to the nearest cent, half up. */
function ratio(n: bigint, d: bigint) { if (d <= 0n) throw new Error('A positive divisor is required.'); const result = Number((n * 2n + d) / (d * 2n)); return money(result, 'Calculated amount'); }
function percentage(cents: number, percent: number) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000 || Math.abs(Math.round(percent * 1e6) / 1e6 - percent) > 1e-10) throw new Error('Use a percentage with at most six decimal places.');
  return ratio(BigInt(money(cents)) * BigInt(Math.round(percent * 1e6)), 100_000_000n);
}
function sum(values: number[]) { return values.reduce((total, amount) => money(total + amount, 'Total'), 0); }
function emptyBases(): PayrollEarningsBases { return { cashCents: 0, taxableCents: 0, pensionableCents: 0, insurableCents: 0, vacationableCents: 0, ehtCents: 0, workSafeCents: 0 }; }

export function classifyPayrollEarnings(lines: readonly ClassifiedEarning[]): PayrollEarningsBases {
  const bases = emptyBases();
  for (const line of lines) {
    dateMs(line.date); money(line.amountCents, 'Earning amount');
    if (!['regular', 'bonus', 'benefit', 'reimbursement', 'vacation', 'holiday', 'sick', 'overtime'].includes(line.kind) || !line.code?.trim() || !line.label?.trim()) throw new Error('Each earning needs a supported kind, code and label.');
    if (line.deductionTreatment !== undefined && !['regular', 'bonus'].includes(line.deductionTreatment)) throw new Error('Choose a supported deduction treatment.');
    for (const flag of ['cash', 'taxable', 'pensionable', 'insurable', 'vacationable', 'eht', 'workSafe'] as const) {
      if (typeof line[flag] !== 'boolean') throw new Error(`Explicit ${flag} classification is required.`);
      if (line[flag]) bases[`${flag}Cents` as keyof PayrollEarningsBases] = sum([bases[`${flag}Cents` as keyof PayrollEarningsBases], line.amountCents]);
    }
    if (line.kind === 'reimbursement' && !line.classificationEvidence?.trim()) throw new Error('Reimbursements need classification evidence; a label does not establish exemption.');
    if (!line.cash && line.insurable && !line.classificationEvidence?.trim()) throw new Error('An insurable noncash benefit needs reviewed classification evidence.');
  }
  return bases;
}

export function bcMinimumWageCents(workDate: string): number {
  dateMs(workDate);
  if (workDate < '2024-06-01' || workDate > '2026-12-31') throw new Error('Ordinary minimum-wage rules are reviewed only for June 2024 through 2026.');
  return workDate >= '2026-06-01' ? 1825 : workDate >= '2025-06-01' ? 1785 : 1740;
}
function anniversary(start: string, years: number) {
  dateMs(start); const year = Number(start.slice(0, 4)) + years;
  // A February 29 anniversary is February's last day in a non-leap year.
  const month = Number(start.slice(5, 7)), day = Number(start.slice(8, 10));
  return dateString(Date.UTC(year, month - 1, Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())));
}
export function bcVacationEntitlement(employmentStartDate: string, asOf: string) {
  const employedDays = daysBetween(employmentStartDate, asOf);
  return { ratePercent: asOf >= anniversary(employmentStartDate, 5) ? 6 : 4, weeks: asOf >= anniversary(employmentStartDate, 5) ? 3 : asOf >= anniversary(employmentStartDate, 1) ? 2 : 0, eligibleForPay: employedDays >= 5, fifthAnniversary: anniversary(employmentStartDate, 5) };
}
export function bcFifthYearVacationAdjustment(input: { fifthYearGrossWagesCents: number; vacationAlreadyPaidCents: number; vacationAlreadyAccruedCents?: number; vacationThisCalculationCents?: number; previousVacationRatePercent: number }) {
  const requiredCents = percentage(money(input.fifthYearGrossWagesCents), 6);
  percentage(0, input.previousVacationRatePercent);
  if (input.previousVacationRatePercent < 4 || input.previousVacationRatePercent > 6) throw new Error('Confirm the vacation rate actually paid during the fifth year.');
  money(input.vacationAlreadyPaidCents);
  const accountedCents = sum([input.vacationAlreadyPaidCents, money(input.vacationAlreadyAccruedCents ?? 0), money(input.vacationThisCalculationCents ?? 0)]);
  return { requiredCents, adjustmentCents: Math.max(0, requiredCents - accountedCents), unpaidEntitlementCents: Math.max(0, requiredCents - input.vacationAlreadyPaidCents), explanation: 'At the fifth anniversary, reconcile the fifth year to 6%; deduct vacation already paid, existing unpaid accrual and vacation recognized in the current calculation for those same wages.' };
}

export function bcAverageDayPay(input: { date: string; history: readonly BcWageHistoryDay[]; historyCompleteFrom: string }) {
  const from = addDays(input.date, -30); dateMs(input.historyCompleteFrom);
  if (input.historyCompleteFrom > from) throw new Error(`Complete wage history from ${from} is required for the 30-day average.`);
  const seen = new Set<string>();
  const rows = input.history.filter(day => { dateMs(day.date); money(day.nonOvertimeWagesCents); if (seen.has(day.date)) throw new Error('Wage history must contain at most one record per day.'); seen.add(day.date); return day.date >= from && day.date < input.date; });
  if (rows.some(row => row.nonOvertimeWagesCents > 0 && !row.workedOrEarned)) throw new Error('A day with earned wages must count as a worked/earned day.');
  const daysWorked = rows.filter(day => day.workedOrEarned).length;
  const wagesCents = sum(rows.map(day => day.nonOvertimeWagesCents));
  return { from, through: addDays(input.date, -1), daysWorked, wagesCents, averageCents: daysWorked ? ratio(BigInt(wagesCents), BigInt(daysWorked)) : 0 };
}

/** Reviewed official B.C. holiday dates; substituted days require a separate reviewed agreement. */
export const BC_STATUTORY_HOLIDAYS_2026 = ['2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-09-30', '2026-10-12', '2026-11-11', '2026-12-25'] as const;
export const BC_STATUTORY_HOLIDAYS = [
  '2024-01-01', '2024-02-19', '2024-03-29', '2024-05-20', '2024-07-01', '2024-08-05', '2024-09-02', '2024-09-30', '2024-10-14', '2024-11-11', '2024-12-25',
  '2025-01-01', '2025-02-17', '2025-04-18', '2025-05-19', '2025-07-01', '2025-08-04', '2025-09-01', '2025-09-30', '2025-10-13', '2025-11-11', '2025-12-25',
  ...BC_STATUTORY_HOLIDAYS_2026,
] as readonly string[];
export function bcStatutoryHolidayPay(input: { date: string; employmentStartDate: string; history: readonly BcWageHistoryDay[]; historyCompleteFrom: string }) {
  const average = bcAverageDayPay(input);
  const eligible = daysBetween(input.employmentStartDate, input.date) >= 30 && average.daysWorked >= 15;
  return { ...average, eligible, holidayPayCents: eligible ? average.averageCents : 0 };
}

export function calculateBcEarnings(input: BcEarningsInput): BcEarningsResult {
  const warnings: string[] = [], blockers: string[] = [], lines: ClassifiedEarning[] = [];
  const minutes = { regular: 0, overtime15: 0, overtime2: 0 };
  const isBonus = (line: ClassifiedEarning) => (line.deductionTreatment ?? (line.kind === 'bonus' ? 'bonus' : 'regular')) === 'bonus';
  const result = (): BcEarningsResult => ({ lines, bases: classifyPayrollEarnings(lines), regularBases: classifyPayrollEarnings(lines.filter(line => !isBonus(line))), bonusBases: classifyPayrollEarnings(lines.filter(isBonus)), vacationAccruedCents: 0, priorVacationLiabilityReleasedCents: 0, salaryVacationPaidCents: 0, salaryVacationLiabilityReleasedCents: 0, ordinaryVacationLiabilityReleasedCents: 0, paidVacationMinutes: 0, currentVacationPaidCents: 0, minutes, sickBank: input.sickBank ? { ...input.sickBank } : undefined, warnings, blockers, rulesVersion: BC_EARNINGS_RULES_VERSION, sources: BC_EARNINGS_SOURCES });
  try {
    dateMs(input.periodStart); dateMs(input.periodEnd); dateMs(input.payDate); dateMs(input.employmentStartDate);
    if (input.periodEnd < input.periodStart || daysBetween(input.periodStart, input.periodEnd) > 370) throw new Error('Use an ordered pay period of at most 371 days.');
    if (input.periodStart < '2024-06-01' || input.periodEnd > '2026-12-31') throw new Error('This B.C. earnings edition supports work from June 2024 through December 2026; deduction/payment-year coverage is validated separately.');
    const effectivePaidThrough = input.finalVacationPayout && input.employmentEndDate && input.employmentEndDate < input.periodEnd ? input.employmentEndDate : input.periodEnd;
    if (input.payDate < effectivePaidThrough) throw new Error('Pay date cannot precede the actual covered employment end.');
    if (input.employmentEndDate) { dateMs(input.employmentEndDate); if (input.employmentEndDate < input.employmentStartDate) throw new Error('Employment end cannot precede employment start.'); }
    if (input.policy !== 'ordinary_bc') throw new Error('Averaging agreements, overtime exemptions, specialized industries and collective-agreement substitutions require a separately reviewed engine.');
    const adjustmentsOnly = input.mode === 'adjustments_only';
    if (input.mode !== undefined && input.mode !== 'regular' && input.mode !== 'adjustments_only') throw new Error('Choose a supported earnings mode.');
    if (adjustmentsOnly && (input.workDays.length || input.salary || input.finalVacationPayout)) throw new Error('An adjustments-only run cannot include ordinary work, salary or final-vacation replay.');
    if (!adjustmentsOnly && input.restPeriodsConfirmed !== true) throw new Error('Review 32-hour weekly rest and 8-hour between-shift rest; daily totals cannot prove these requirements.');
    const firstSunday = addDays(input.periodStart, -new Date(dateMs(input.periodStart)).getUTCDay());
    const lastSaturday = addDays(input.periodEnd, 6 - new Date(dateMs(input.periodEnd)).getUTCDay());
    dateMs(input.context.from); dateMs(input.context.to);
    if (!adjustmentsOnly && (!input.context.complete || input.context.from > firstSunday || input.context.to < lastSaturday)) throw new Error(`Complete Sunday–Saturday work context from ${firstSunday} through ${lastSaturday} is required, including days outside this pay period.`);
    if (input.context.to < input.context.from || daysBetween(input.context.from, input.context.to) > 430) throw new Error('Work context must be an ordered range of at most 431 days.');
    if (!['accrue', 'pay_each_cheque'].includes(input.vacation.mode)) throw new Error('Choose accrued vacation or vacation paid each cheque.');
    if (input.vacation.mode === 'pay_each_cheque' && input.vacation.eachChequeAgreementConfirmed !== true) throw new Error('Vacation paid each cheque requires the employee’s written agreement.');
    const workDays = [...input.workDays].sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>(), weeklyMinutes = new Map<string, number>();
    const weeklyActualMinutes = new Map<string, number>();
    let salaryCovered = 0, salaryRate: number | undefined, salaryLeaveCredits = 0;
    let salaryRateFraction: { numerator: bigint; denominator: bigint } | undefined;
    const salaryCoveredByDate = new Map<string, number>(), salaryLeaveByDate = new Map<string, number>();
    const salaryPremiumCoveredByDate = new Map<string, number>();
    const salaryVacationCoveredByDate = new Map<string, number>();
    let paidVacationMinutes = 0, salaryVacationPaidCents = 0, salaryVacationLiabilityReleasedCents = 0;
    const exactWorkAmounts: Array<{ line: ClassifiedEarning; numerator: bigint; denominator: bigint }> = [];
    let salaryCalendarValidated = false;
    if (input.salary) {
      const salary = input.salary;
      money(salary.amountCents); money(salary.periodSalaryCents); integer(salary.normalWeeklyMinutes, 'Normal weekly minutes', 10_080); integer(salary.averageWeeklyMinutes, 'Average weekly minutes', 10_080); integer(salary.coveredStraightTimeMinutes, 'Salary-covered straight-time minutes');
      const divisor = Math.min(salary.normalWeeklyMinutes, salary.averageWeeklyMinutes);
      if (!divisor) throw new Error('Salaried overtime needs positive normal and average weekly hours.');
      salaryRateFraction = { numerator: BigInt(salary.amountCents) * BigInt(salary.basis === 'monthly' ? 12 * 60 : 60), denominator: BigInt(52 * divisor) };
      salaryRate = ratio(salaryRateFraction.numerator, salaryRateFraction.denominator);
      salaryCovered = salary.coveredStraightTimeMinutes;
      if (salary.payPeriodsPerYear !== undefined) {
        if (!salary.calendarConfirmed || ![24, 26, 27, 52, 53].includes(salary.payPeriodsPerYear)) throw new Error('Confirm the actual fixed-salary payroll calendar and number of pays.');
        const calendarStart = salary.calendarPeriodStart ?? input.periodStart, calendarEnd = salary.calendarPeriodEnd ?? input.periodEnd;
        dateMs(calendarStart); dateMs(calendarEnd);
        if (input.periodStart < calendarStart || input.periodEnd > calendarEnd) throw new Error('The actual covered period must lie within the reviewed normal salary calendar period.');
        const periodDays = daysBetween(calendarStart, calendarEnd) + 1;
        const expectedDays = salary.payPeriodsPerYear >= 52 ? 7 : salary.payPeriodsPerYear >= 26 ? 14 : null;
        const semiMonthEnd = new Date(Date.UTC(Number(calendarEnd.slice(0, 4)), Number(calendarEnd.slice(5, 7)), 0)).getUTCDate();
        const isSemiMonth = calendarStart.slice(0, 7) === calendarEnd.slice(0, 7) && ((calendarStart.endsWith('-01') && calendarEnd.endsWith('-15')) || (calendarStart.endsWith('-16') && Number(calendarEnd.slice(8)) === semiMonthEnd));
        if (expectedDays !== null ? periodDays !== expectedDays : !isSemiMonth) throw new Error('The fixed-salary period must match the reviewed weekly, biweekly or semimonthly calendar. Use an explicitly reviewed prorated period for another shape.');
        const activeFrom = input.employmentStartDate > input.periodStart ? input.employmentStartDate : input.periodStart;
        const activeTo = input.employmentEndDate && input.employmentEndDate < input.periodEnd ? input.employmentEndDate : input.periodEnd;
        const activeDays = Math.max(0, daysBetween(activeFrom, activeTo) + 1);
        if (activeDays < periodDays && (salary.proration?.basis !== 'calendar_days' || !salary.proration.reviewed || !salary.proration.evidence.trim())) throw new Error('A partial salary period requires the reviewed contract’s calendar-day proration basis and evidence. Other proration methods need a separate review.');
        const annualCents = BigInt(salary.amountCents) * BigInt(salary.basis === 'monthly' ? 12 : 1);
        const expectedSalaryCents = ratio(annualCents * BigInt(activeDays), BigInt(salary.payPeriodsPerYear * periodDays));
        if (salary.periodSalaryCents !== expectedSalaryCents) throw new Error('Fixed salary must match the actual reviewed annual/monthly amount and payroll calendar, including employment-date proration.');
        warnings.push(`Fixed salary: ${salary.payPeriodsPerYear} pays; normal calendar ${calendarStart} through ${calendarEnd}; ${activeDays}/${periodDays} active covered calendar days; ${(expectedSalaryCents / 100).toFixed(2)} CAD${activeDays < periodDays ? `; reviewed calendar-day proration: ${salary.proration!.evidence}` : ''}.`);
        salaryCalendarValidated = true;
      }
    }
    let sickPaidUsed = input.sickBank?.paidDaysUsed ?? 0, sickUnpaidUsed = input.sickBank?.unpaidDaysUsed ?? 0;
    if (input.sickBank) { integer(sickPaidUsed, 'Paid sick days used', 5); integer(sickUnpaidUsed, 'Unpaid sick days used', 3); }
    const history = input.history ?? [];
    for (const day of workDays) {
      dateMs(day.date); integer(day.minutes, 'Daily worked minutes', 1440); money(day.hourlyRateCents, 'Hourly rate');
      const vacationMinutes = integer(day.paidVacationMinutes ?? 0, 'Paid annual vacation minutes', 1440 - day.minutes);
      if (vacationMinutes && (!input.salary || !day.salaryVacationSourceReference?.trim())) throw new Error('Paid vacation minutes require fixed salary and a reviewed annual-leave source; hourly vacation cash remains an explicit earning or liability payout.');
      if (vacationMinutes && (day.sickLeave || BC_STATUTORY_HOLIDAYS.includes(day.date))) throw new Error('Annual vacation time cannot duplicate a sick-leave day or statutory holiday; review and correct the approved leave record.');
      if (seen.has(day.date)) throw new Error('Combine daily work into one record per employee/date; split shifts cannot reset daily overtime.');
      seen.add(day.date);
      if (day.date < input.context.from || day.date > input.context.to) throw new Error('A work day falls outside the declared complete context.');
      if ((day.minutes || vacationMinutes) && (day.date < input.employmentStartDate || (input.employmentEndDate && day.date > input.employmentEndDate))) throw new Error('Worked/paid vacation days must fall within employment dates.');
      const rate = salaryRate ?? day.hourlyRateCents;
      if (day.minutes && (salaryRateFraction ? salaryRateFraction.numerator < BigInt(bcMinimumWageCents(day.date)) * salaryRateFraction.denominator : rate < bcMinimumWageCents(day.date))) throw new Error(`Rate on ${day.date} is below the ordinary minimum wage effective on that work date.`);
      const sunday = addDays(day.date, -new Date(dateMs(day.date)).getUTCDay());
      const priorActualMinutes = weeklyActualMinutes.get(sunday) ?? 0;
      const salaryCoverableToday = input.salary ? Math.min(day.minutes + vacationMinutes, Math.max(0, input.salary.normalWeeklyMinutes - priorActualMinutes)) : 0;
      weeklyActualMinutes.set(sunday, priorActualMinutes + day.minutes + vacationMinutes);
      const counted = Math.min(480, day.minutes), before = weeklyMinutes.get(sunday) ?? 0;
      const weeklyOvertime = Math.max(0, counted - Math.max(0, 2400 - before));
      weeklyMinutes.set(sunday, before + counted);
      if (day.date < input.periodStart || day.date > input.periodEnd) continue;
      paidVacationMinutes += vacationMinutes;
      if (day.holiday && !BC_STATUTORY_HOLIDAYS.includes(day.date)) throw new Error('Only reviewed 2024–2026 B.C. statutory holidays are supported; substituted holidays require a separately reviewed agreement.');
      const isHoliday = day.holiday || BC_STATUTORY_HOLIDAYS.includes(day.date);
      let holidayEligible = false;
      if (isHoliday) {
        if (!input.historyCompleteFrom) throw new Error('Complete preceding 30-day wage history is required for statutory holiday eligibility.');
        const holiday = bcStatutoryHolidayPay({ date: day.date, employmentStartDate: input.employmentStartDate, history, historyCompleteFrom: input.historyCompleteFrom });
        holidayEligible = holiday.eligible;
        if (holidayEligible) {
          if (input.salary && day.salaryIncludedHolidayCents === undefined) throw new Error(`Confirm salary already covering statutory holiday ${day.date}, including an explicit zero, to prevent duplicate holiday pay.`);
          const included = input.salary ? money(day.salaryIncludedHolidayCents!, 'Holiday pay already included in salary') : 0;
          salaryLeaveCredits = sum([salaryLeaveCredits, included]);
          salaryLeaveByDate.set(day.date, sum([salaryLeaveByDate.get(day.date) ?? 0, included]));
          const additionalHoliday = Math.max(0, holiday.holidayPayCents - included);
          if (additionalHoliday) lines.push(ordinaryLine(day.date, 'STAT_AVERAGE', 'Statutory holiday average day (less amount already in salary)', additionalHoliday, 'holiday'));
          if (included) warnings.push(`${day.date}: fixed salary already includes ${(included / 100).toFixed(2)} CAD toward statutory holiday average pay; only any shortfall is added.`);
        }
        else warnings.push(`${day.date}: statutory holiday average pay and holiday premiums do not apply because 30-day employment / 15-of-30 eligibility is not met.`);
      }
      let regular = holidayEligible ? 0 : counted - weeklyOvertime;
      let overtime15 = holidayEligible ? Math.min(720, day.minutes) : Math.min(240, Math.max(0, day.minutes - 480)) + weeklyOvertime;
      const overtime2 = Math.max(0, day.minutes - 720);
      const restMinutes = integer(day.restPremiumMinutes ?? 0, 'Weekly-rest ordinary minutes not already paid an overtime/holiday premium', regular);
      regular -= restMinutes; overtime15 += restMinutes;
      minutes.regular += regular; minutes.overtime15 += overtime15; minutes.overtime2 += overtime2;
      let todayCoverage = Math.min(salaryCovered, holidayEligible && (day.salaryIncludedHolidayCents ?? 0) > 0 ? 0 : salaryCoverableToday);
      const coveredVacation = Math.min(todayCoverage, vacationMinutes); todayCoverage -= coveredVacation; salaryCovered -= coveredVacation;
      if (coveredVacation !== vacationMinutes) throw new Error('Paid annual leave declared inside salary exceeds covered normal salary time; review the work/leave schedule and salary coverage.');
      if (coveredVacation) salaryVacationCoveredByDate.set(day.date, coveredVacation);
      const coveredRegular = Math.min(todayCoverage, regular); salaryCovered -= coveredRegular; todayCoverage -= coveredRegular; regular -= coveredRegular;
      const covered15 = Math.min(todayCoverage, overtime15); salaryCovered -= covered15; todayCoverage -= covered15;
      const covered2 = Math.min(todayCoverage, overtime2); salaryCovered -= covered2;
      const coveredToday = coveredRegular + covered15 + covered2 + coveredVacation;
      if (coveredToday) salaryCoveredByDate.set(day.date, coveredToday);
      if (covered15 + covered2) salaryPremiumCoveredByDate.set(day.date, covered15 + covered2);
      const workLine = (code: string, label: string, workMinutes: number, multiplier: number, kind: ClassifiedEarning['kind']) => {
        const numerator = BigInt(workMinutes) * (salaryRateFraction?.numerator ?? BigInt(rate)) * BigInt(multiplier);
        const denominator = 120n * (salaryRateFraction?.denominator ?? 1n);
        const line = ordinaryLine(day.date, code, label, Number(numerator / denominator), kind, workMinutes, rate);
        if (salaryRateFraction) line.ratePrecision = { numeratorCents: String(salaryRateFraction.numerator), denominator: String(salaryRateFraction.denominator) };
        exactWorkAmounts.push({ line, numerator, denominator });
        lines.push(line);
      };
      if (regular) workLine('REGULAR', 'Regular earnings', regular, 2, 'regular');
      if (overtime15 - covered15) workLine(holidayEligible ? 'STAT_WORK_15' : 'OVERTIME_15', holidayEligible ? 'Statutory holiday worked × 1.5' : 'Overtime × 1.5', overtime15 - covered15, 3, 'overtime');
      if (covered15) workLine(holidayEligible ? 'STAT_SALARY_PREMIUM_15' : 'SALARY_PREMIUM_15', `${holidayEligible ? 'Statutory holiday' : 'Overtime'} × 1.5 (1× already in salary)`, covered15, 1, 'overtime');
      if (overtime2 - covered2) workLine('OVERTIME_2', 'Overtime × 2', overtime2 - covered2, 4, 'overtime');
      if (covered2) workLine('SALARY_PREMIUM_2', 'Overtime × 2 (1× already in salary)', covered2, 2, 'overtime');
      if (day.sickLeave) {
        if (daysBetween(input.employmentStartDate, day.date) < 90) throw new Error('Statutory paid/unpaid sick leave requires 90 consecutive days of employment.');
        if (!input.sickBank || input.sickBank.year !== Number(day.date.slice(0, 4))) throw new Error('A complete calendar-year sick-leave opening bank is required.');
        if (day.sickLeave === 'paid') {
          if (++sickPaidUsed > 5) throw new Error('The statutory five-paid-day calendar-year bank is exhausted.');
          if (!input.historyCompleteFrom) throw new Error('Paid sick leave requires complete preceding 30-day wage history.');
          const average = bcAverageDayPay({ date: day.date, history, historyCompleteFrom: input.historyCompleteFrom });
          if (!average.daysWorked) throw new Error('Paid sick leave needs reviewed wage history; no earned days were supplied for the 30-day average.');
          if (input.salary && day.salaryIncludedSickCents === undefined) throw new Error(`Confirm salary already covering sick leave ${day.date}, including an explicit zero, to prevent duplicate sick pay.`);
          const included = input.salary ? money(day.salaryIncludedSickCents!, 'Sick pay already included in salary') : 0;
          salaryLeaveCredits = sum([salaryLeaveCredits, included]);
          salaryLeaveByDate.set(day.date, sum([salaryLeaveByDate.get(day.date) ?? 0, included]));
          const additionalSick = Math.max(0, average.averageCents - included);
          if (additionalSick) lines.push(ordinaryLine(day.date, 'SICK_PAID', 'Paid sick leave (one full day, less amount already in salary)', additionalSick, 'sick'));
          if (day.minutes) warnings.push(`${day.date}: partial-day sick leave uses one full paid sick day and pays the full average in addition to wages for time worked.`);
        } else if (++sickUnpaidUsed > 3) throw new Error('The statutory three-unpaid-day calendar-year bank is exhausted.');
      }
    }
    if (input.salary && salaryLeaveCredits > input.salary.periodSalaryCents) throw new Error('Leave credited as already included in salary exceeds the full period salary.');
    if (salaryCovered > 0) throw new Error('Salary-covered straight-time minutes exceed the actual work within the contract’s normal weekly hours. Salary cannot cover extra hours that were never included; review leave/holiday coverage explicitly.');
    if (input.salary) {
      const salaryForWork = input.salary.periodSalaryCents - salaryLeaveCredits;
      const totalCovered = sum([...salaryCoveredByDate.values()]);
      if (salaryForWork && !totalCovered) throw new Error('Salary needs actual covered work minutes or explicit paid-leave credits to assign its earnings dates.');
      const requiredCoverageCents = ratio(BigInt(totalCovered) * salaryRateFraction!.numerator, 60n * salaryRateFraction!.denominator);
      if (!salaryCalendarValidated && salaryForWork < requiredCoverageCents) throw new Error('Fixed salary, after paid-leave credits, cannot fund the declared salary-covered work minutes at the actual regular wage. Provide the reviewed fixed payroll calendar for variable calendar periods, or correct the coverage/amount.');
      const allocation = [...salaryCoveredByDate].map(([date, covered]) => ({ date, minutes: covered, cents: Number(BigInt(salaryForWork) * BigInt(covered) / BigInt(totalCovered)), remainder: BigInt(salaryForWork) * BigInt(covered) % BigInt(totalCovered) }));
      const residual = salaryForWork - sum(allocation.map(row => row.cents));
      const order = [...allocation].sort((a, b) => a.remainder === b.remainder ? a.date.localeCompare(b.date) : a.remainder > b.remainder ? -1 : 1);
      for (let i = 0; i < residual; i++) order[i].cents++;
      for (const row of allocation) {
        lines.push(ordinaryLine(row.date, 'SALARY', 'Salary covering underlying straight-time wages', row.cents, 'regular', row.minutes, salaryRate));
        const premiumMinutes = salaryPremiumCoveredByDate.get(row.date) ?? 0, vacationMinutes = salaryVacationCoveredByDate.get(row.date) ?? 0;
        if (vacationMinutes) salaryVacationPaidCents = sum([salaryVacationPaidCents, ratio(BigInt(row.cents) * BigInt(vacationMinutes), BigInt(row.minutes))]);
        const requiredDayBase = ratio(BigInt(row.minutes - premiumMinutes - vacationMinutes) * BigInt(bcMinimumWageCents(row.date)) * salaryRateFraction!.denominator + BigInt(premiumMinutes) * salaryRateFraction!.numerator, 60n * salaryRateFraction!.denominator);
        if (row.cents < requiredDayBase) {
          const topUp = requiredDayBase - row.cents;
          lines.push(ordinaryLine(row.date, 'SALARY_WAGE_FLOOR', 'Salary adjustment to work-date minimum / covered overtime straight-time wage', topUp, 'regular'));
          warnings.push(`${row.date}: ${(topUp / 100).toFixed(2)} CAD added because calendar salary allocation must fund the work-date minimum for ordinary hours and the actual regular wage for covered premium hours.`);
        }
      }
      for (const [date, cents] of salaryLeaveByDate) if (cents) lines.push(ordinaryLine(date, 'SALARY_LEAVE', 'Salary already covering paid leave', cents, 'regular'));
    }
    if (paidVacationMinutes) {
      if (!input.salaryVacationLiability?.sourceEvidence.trim()) throw new Error('Salary annual leave needs reviewed prior vacation-liability history, including an explicit confirmed zero opening.');
      salaryVacationLiabilityReleasedCents = Math.min(salaryVacationPaidCents, money(input.salaryVacationLiability.availableAccruedCents, 'Available prior vacation liability'));
      warnings.push(`${paidVacationMinutes / 60} annual-leave hours are already inside salary; ${(salaryVacationLiabilityReleasedCents / 100).toFixed(2)} CAD releases existing vacation liability without extra cash or a second leave-time deduction.`);
    }
    if (exactWorkAmounts.length) {
      const denominator = exactWorkAmounts[0].denominator;
      const totalNumerator = exactWorkAmounts.reduce((value, row) => value + row.numerator, 0n);
      const target = ratio(totalNumerator, denominator);
      const residual = target - sum(exactWorkAmounts.map(row => row.line.amountCents));
      const order = [...exactWorkAmounts].sort((a, b) => {
        const aRemainder = a.numerator % denominator, bRemainder = b.numerator % denominator;
        return aRemainder === bRemainder ? 0 : aRemainder > bRemainder ? -1 : 1;
      });
      for (let i = 0; i < residual; i++) order[i].line.amountCents++;
    }
    // A holiday on a scheduled day off still attracts average-day pay: it must be
    // present in context rather than disappearing because there are zero hours.
    for (const holiday of BC_STATUTORY_HOLIDAYS) if (!adjustmentsOnly && holiday >= input.periodStart && holiday <= input.periodEnd && holiday >= input.employmentStartDate && (!input.employmentEndDate || holiday <= input.employmentEndDate) && !seen.has(holiday)) throw new Error(`Include a zero-minute work record for statutory holiday ${holiday}; a day off can still earn holiday pay.`);
    if ((input.additionalEarnings?.length ?? 0) > 1000) throw new Error('Use at most 1,000 additional earning lines per employee calculation.');
    for (const line of input.additionalEarnings ?? []) {
      if (line.date < input.periodStart || line.date > input.periodEnd) throw new Error('Additional earning dates must lie within this covered period.');
      if (line.kind === 'vacation') throw new Error('Use the explicit accrued-vacation payout input and reviewed liability/source relation; do not also add the same vacation amount as an ordinary earning.');
      lines.push({ ...line });
    }
    let ordinaryVacationLiabilityReleasedCents = 0;
    if (input.vacationLiabilityPayout) {
      const payout = input.vacationLiabilityPayout;
      const amount = money(payout.amountCents, 'Accrued vacation payout'), available = money(payout.availableAccruedCents, 'Available accrued vacation');
      if (!amount || !payout.sourceEvidence.trim() || !['vacation_leave', 'unused_cashout'].includes(payout.treatment)) throw new Error('Accrued vacation payout needs a positive amount, source evidence and actual leave/cashout treatment.');
      if (input.salaryVacationLiability && input.salaryVacationLiability.availableAccruedCents !== available) throw new Error('Salary leave and ordinary vacation payout must use the same reconciled prior vacation balance.');
      if (amount > available - salaryVacationLiabilityReleasedCents) throw new Error('Vacation payout exceeds the available prior liability after salary leave already paid from that balance.');
      const date = input.employmentEndDate && input.employmentEndDate < input.periodEnd ? input.employmentEndDate : input.periodEnd;
      const line = ordinaryLine(date, 'VACATION_LIABILITY_PAYOUT', payout.treatment === 'vacation_leave' ? 'Reviewed accrued vacation paid while taking leave' : 'Reviewed unused accrued vacation cash payment', amount, 'vacation');
      line.deductionTreatment = payout.treatment === 'vacation_leave' ? 'regular' : 'bonus';
      lines.push(line);
      ordinaryVacationLiabilityReleasedCents = amount;
      warnings.push(`${(amount / 100).toFixed(2)} CAD vacation cash is paid once from the reviewed existing liability; its current-year vacation accrual remains separate.`);
    }
    let vacationAccruedCents = 0;
    let vacationReconciliation: BcEarningsResult['vacationReconciliation'];
    const fifthAnniversary = anniversary(input.employmentStartDate, 5);
    const crossesAnniversary = !adjustmentsOnly && input.periodStart <= fifthAnniversary && input.periodEnd >= fifthAnniversary && (!input.employmentEndDate || input.employmentEndDate >= fifthAnniversary);
    let currentFifthYearVacationCents = 0;
    // Use each earning's work date at the anniversary boundary, not payment date.
    const byDate = new Map<string, number>();
    for (const line of lines) if (line.vacationable) byDate.set(line.date, sum([byDate.get(line.date) ?? 0, line.amountCents]));
    const vacationGroups = new Map<number, Array<{ date: string; cents: number }>>();
    for (const [date, cents] of byDate) {
      const statutory = bcVacationEntitlement(input.employmentStartDate, date);
      const rate = input.vacation.ratePercent ?? statutory.ratePercent;
      if (rate < statutory.ratePercent) throw new Error(`Vacation rate on ${date} cannot be below ${statutory.ratePercent}%.`);
      // Validate the rate even for a zero wage base.
      percentage(0, rate);
      vacationGroups.set(rate, [...(vacationGroups.get(rate) ?? []), { date, cents }]);
    }
    for (const [rate, rows] of vacationGroups) {
      const wageBase = sum(rows.map(row => row.cents)), amount = percentage(wageBase, rate);
      const shares = rows.filter(row => row.cents > 0).map(row => ({ ...row, amount: Number(BigInt(amount) * BigInt(row.cents) / BigInt(wageBase)), remainder: BigInt(amount) * BigInt(row.cents) % BigInt(wageBase) }));
      const residual = amount - sum(shares.map(row => row.amount));
      const order = [...shares].sort((a, b) => a.remainder === b.remainder ? a.date.localeCompare(b.date) : a.remainder > b.remainder ? -1 : 1);
      for (let i = 0; i < residual; i++) order[i].amount++;
      if (crossesAnniversary) currentFifthYearVacationCents = sum([currentFifthYearVacationCents, ...shares.filter(row => row.date >= anniversary(input.employmentStartDate, 4) && row.date < fifthAnniversary).map(row => row.amount)]);
      if (input.vacation.mode === 'pay_each_cheque') {
        for (const row of shares) if (row.amount) {
          const line = ordinaryLine(row.date, 'VACATION_PAID', `Vacation pay (${rate}%)`, row.amount, 'vacation');
          line.deductionTreatment = 'bonus';
          // Current vacation payment is not recursively included in its own base;
          // subsequent-year vacation-on-vacation is reconciled in annual records.
          line.vacationable = false; lines.push(line);
        }
      } else vacationAccruedCents = sum([vacationAccruedCents, amount]);
    }
    if (crossesAnniversary) {
      const reviewed = input.fifthYearVacationReconciliation;
      if (!reviewed?.reviewed || !reviewed.evidence.trim()) throw new Error('The fifth employment anniversary requires reviewed fifth-year gross wages, vacation already paid and reconciliation evidence.');
      if (input.vacation.mode === 'accrue' && reviewed.vacationAlreadyAccruedCents === undefined) throw new Error('Accrued vacation requires the existing unpaid fifth-year vacation accrual, including an explicit zero, to prevent duplicate expense.');
      if (input.vacation.mode === 'pay_each_cheque' && (reviewed.vacationAlreadyAccruedCents ?? 0) > 0 && (!input.finalVacationPayout || input.finalVacationPayout.priorAccruedCents < reviewed.vacationAlreadyAccruedCents! || !input.finalVacationPayout.sourceEvidence.trim())) throw new Error('An existing unpaid vacation accrual needs an explicit liability release before switching to cash vacation payment; do not expense it twice.');
      const adjustment = bcFifthYearVacationAdjustment({ ...reviewed, vacationThisCalculationCents: currentFifthYearVacationCents });
      vacationReconciliation = { requiredCents: adjustment.requiredCents, adjustmentCents: adjustment.adjustmentCents, currentPeriodVacationCents: currentFifthYearVacationCents, evidence: reviewed.evidence };
      if (input.vacation.mode === 'pay_each_cheque') {
        const line = ordinaryLine(fifthAnniversary, 'VACATION_5_YEAR_ADJUSTMENT', 'Reviewed fifth-year vacation reconciliation', adjustment.adjustmentCents, 'vacation');
        line.deductionTreatment = 'bonus';
        line.vacationable = false; lines.push(line);
      } else vacationAccruedCents = sum([vacationAccruedCents, adjustment.adjustmentCents]);
    }
    let priorVacationLiabilityReleasedCents = sum([salaryVacationLiabilityReleasedCents, ordinaryVacationLiabilityReleasedCents]);
    if (input.finalVacationPayout) {
      if (!input.employmentEndDate || input.employmentEndDate > input.periodEnd || !input.finalVacationPayout.sourceEvidence.trim()) throw new Error('Final vacation payout requires the actual employment end and reviewed opening vacation-liability source.');
      const fullPriorBalance = money(input.finalVacationPayout.priorAccruedCents, 'Previously accrued vacation balance');
      if (fullPriorBalance < priorVacationLiabilityReleasedCents) throw new Error('Final vacation opening cannot be smaller than the salary-leave/ordinary-payout liability already released in this calculation.');
      const terminalPriorBalance = fullPriorBalance - priorVacationLiabilityReleasedCents;
      priorVacationLiabilityReleasedCents = fullPriorBalance;
      const finalDate = input.employmentEndDate;
      if (terminalPriorBalance) { const line = ordinaryLine(finalDate, 'VACATION_PRIOR_LIABILITY', 'Final vacation payout of remaining previously accrued balance', terminalPriorBalance, 'vacation'); line.vacationable = false; line.deductionTreatment = 'bonus'; lines.push(line); }
      if (vacationAccruedCents) { const line = ordinaryLine(finalDate, 'VACATION_CURRENT_FINAL', 'Final vacation earned in this calculation', vacationAccruedCents, 'vacation'); line.vacationable = false; line.deductionTreatment = 'bonus'; lines.push(line); }
      vacationAccruedCents = 0;
    }
    const finalized = result();
    finalized.vacationAccruedCents = vacationAccruedCents;
    finalized.vacationReconciliation = vacationReconciliation;
    finalized.priorVacationLiabilityReleasedCents = priorVacationLiabilityReleasedCents;
    finalized.salaryVacationPaidCents = salaryVacationPaidCents;
    finalized.salaryVacationLiabilityReleasedCents = salaryVacationLiabilityReleasedCents;
    finalized.ordinaryVacationLiabilityReleasedCents = ordinaryVacationLiabilityReleasedCents;
    finalized.paidVacationMinutes = paidVacationMinutes;
    finalized.currentVacationPaidCents = sum(lines.filter(line => ['VACATION_PAID', 'VACATION_5_YEAR_ADJUSTMENT', 'VACATION_CURRENT_FINAL'].includes(line.code)).map(line => line.amountCents));
    finalized.sickBank = input.sickBank ? { year: input.sickBank.year, paidDaysUsed: sickPaidUsed, unpaidDaysUsed: sickUnpaidUsed } : undefined;
    if (vacationReconciliation) warnings.push('The reviewed fifth-year vacation adjustment is included once; retain the wage-base and prior-vacation reconciliation evidence.');
    return finalized;
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : 'Invalid B.C. earnings inputs.');
    // Partial results cannot masquerade as a payable calculation.
    lines.length = 0; minutes.regular = 0; minutes.overtime15 = 0; minutes.overtime2 = 0;
    return result();
  }
}
function ordinaryLine(date: string, code: string, label: string, amountCents: number, kind: ClassifiedEarning['kind'], minutes?: number, rateCents?: number): ClassifiedEarning {
  return { date, code, label, amountCents, kind, minutes, rateCents, cash: true, taxable: true, pensionable: true, insurable: true, vacationable: true, eht: true, workSafe: true };
}

export function bcSalaryHourlyEquivalent(input: { basis: 'monthly' | 'annual'; amountCents: number; normalWeeklyMinutes: number; averageWeeklyMinutes: number }) {
  money(input.amountCents); integer(input.normalWeeklyMinutes, 'Normal weekly minutes', 10_080); integer(input.averageWeeklyMinutes, 'Average weekly minutes', 10_080);
  const divisor = Math.min(input.normalWeeklyMinutes, input.averageWeeklyMinutes);
  if (!divisor) throw new Error('Normal and average weekly minutes must be positive.');
  return ratio(BigInt(input.amountCents) * BigInt(input.basis === 'monthly' ? 720 : 60), BigInt(52 * divisor));
}

/** Shared server adapter helper: overtime hours above the contract are never
 * silently claimed as straight time already paid in fixed salary. */
export function bcSalaryCoverageMinutes(input: { periodStart: string; periodEnd: string; normalWeeklyMinutes: number; workDays: readonly BcWorkDay[]; excludedDates?: readonly string[] }) {
  dateMs(input.periodStart); dateMs(input.periodEnd); integer(input.normalWeeklyMinutes, 'Normal weekly minutes', 10_080);
  const used = new Map<string, number>(), seen = new Set<string>(), excluded = new Set(input.excludedDates ?? []);
  let covered = 0;
  for (const day of [...input.workDays].sort((a, b) => a.date.localeCompare(b.date))) {
    dateMs(day.date); integer(day.minutes, 'Daily worked minutes', 1440);
    if (seen.has(day.date)) throw new Error('Combine daily work before determining salary coverage.');
    seen.add(day.date);
    const sunday = addDays(day.date, -new Date(dateMs(day.date)).getUTCDay()), before = used.get(sunday) ?? 0;
    const vacationMinutes = integer(day.paidVacationMinutes ?? 0, 'Paid annual vacation minutes', 1440 - day.minutes);
    const available = Math.min(day.minutes + vacationMinutes, Math.max(0, input.normalWeeklyMinutes - before));
    used.set(sunday, before + day.minutes + vacationMinutes);
    if (day.date >= input.periodStart && day.date <= input.periodEnd && !excluded.has(day.date)) covered += available;
  }
  return integer(covered, 'Salary-covered minutes');
}

/** Weekly/biweekly start is the explicitly selected normal earning-period start;
 * it is never guessed backwards from a possibly lagged payment date. */
export function bcSalaryCalendarBounds(input: { periodStart: string; payPeriodsPerYear: number }) {
  dateMs(input.periodStart);
  if ([52, 53].includes(input.payPeriodsPerYear)) return { calendarPeriodStart: input.periodStart, calendarPeriodEnd: addDays(input.periodStart, 6) };
  if ([26, 27].includes(input.payPeriodsPerYear)) return { calendarPeriodStart: input.periodStart, calendarPeriodEnd: addDays(input.periodStart, 13) };
  if (input.payPeriodsPerYear !== 24) throw new Error('Use a supported reviewed weekly, biweekly or semimonthly salary calendar.');
  const month = input.periodStart.slice(0, 7), day = Number(input.periodStart.slice(8));
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return day <= 15 ? { calendarPeriodStart: `${month}-01`, calendarPeriodEnd: `${month}-15` } : { calendarPeriodStart: `${month}-16`, calendarPeriodEnd: `${month}-${end}` };
}

export function validateBcPayTiming(input: { periodStart: string; periodEnd: string; payDate: string; frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'; termination?: { by: 'employer' | 'employee'; at: string; paidAt?: string } }) {
  dateMs(input.periodStart); dateMs(input.periodEnd); dateMs(input.payDate);
  const blockers: string[] = [];
  const days = daysBetween(input.periodStart, input.periodEnd) + 1;
  if (days <= 0 || days > 16) blockers.push('Ordinary B.C. pay periods must cover no more than 16 days.');
  if (input.frequency === 'monthly') blockers.push('Ordinary B.C. wages must be paid at least twice monthly.');
  const dueDate = addDays(input.periodEnd, 8);
  if (input.payDate < input.periodEnd || input.payDate > dueDate) blockers.push(`Regular wages are due by ${dueDate}, within eight days after period end.`);
  let finalPayDueAt: string | undefined;
  if (input.termination) {
    const at = Date.parse(input.termination.at);
    if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(input.termination.at) || !Number.isFinite(at)) throw new Error('Termination needs an exact timestamp and timezone offset.');
    finalPayDueAt = new Date(at + (input.termination.by === 'employer' ? 48 * 3_600_000 : 6 * DAY)).toISOString();
    if (input.termination.paidAt) {
      const paidAt = Date.parse(input.termination.paidAt);
      if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(input.termination.paidAt) || !Number.isFinite(paidAt)) throw new Error('Final payment needs an exact timestamp and timezone offset.');
      if (paidAt > Date.parse(finalPayDueAt)) blockers.push(`Final wages are due by ${finalPayDueAt} (${input.termination.by === 'employer' ? '48 hours' : 'six days'} after termination).`);
    }
  }
  return { dueDate, finalPayDueAt, blockers };
}

export const BC_EMPLOYER_COST_SOURCES = [
  { id: 'bc-eht', url: 'https://www2.gov.bc.ca/gov/content/taxes/employer-health-tax/employer-health-tax-overview', reviewed: '2026-10-23' },
  { id: 'bc-eht-nonprofit', url: 'https://www2.gov.bc.ca/gov/content/taxes/employer-health-tax/employer-health-tax-overview/eht-charitable-nonprofit', reviewed: '2026-10-23' },
  { id: 'bc-eht-associated', url: 'https://www2.gov.bc.ca/gov/content/taxes/employer-health-tax/employer-health-tax-overview/eht-associated-employers', reviewed: '2026-10-23' },
  { id: 'worksafe-2026', url: 'https://www.worksafebc.com/en/insurance/know-coverage-costs/industry-premium-rates/2026-rates', reviewed: '2026-10-23' },
  { id: 'worksafe-cap', url: 'https://www.worksafebc.com/en/law-policy/claims-rehabilitation/compensation-related-maximum-wage-rates', reviewed: '2026-10-23' },
] as const;
export const WORKSAFE_BC_2026_ASSESSABLE_LIMIT_CENTS = 12_750_000;
export type BcEhtConfiguration = {
  kind: 'ordinary' | 'charitable_nonprofit'; year: number; qualificationEvidence?: string;
  permanentEstablishmentDays?: number; associated?: boolean; allocatedExemptionCents?: number; allocationEvidence?: string;
  /** Combined remuneration of the associated ordinary-employer group, for this same calculation. */
  associatedGroupRemunerationCents?: number;
  /** Union of days when any associated employer had a B.C. permanent establishment. */
  associatedGroupPermanentEstablishmentDays?: number;
  location?: { id: string; evidence: string; qualifying: boolean };
};
/** Annual EHT liability, not an employee deduction. Explicit location means a reviewed
 * qualifying location, not a department, grant or bookkeeping dimension. */
export function calculateBcEmployerHealthTax(input: BcEhtConfiguration & { annualBcRemunerationCents: number }) {
  const remuneration = money(input.annualBcRemunerationCents, 'Annual B.C. remuneration');
  if (input.year !== 2026) throw new Error('EHT thresholds in this edition are reviewed for 2026 only.');
  if (!['ordinary', 'charitable_nonprofit'].includes(input.kind)) throw new Error('Choose a reviewed EHT employer classification.');
  const days = input.permanentEstablishmentDays ?? 365;
  integer(days, 'Days with a permanent B.C. establishment', 365);
  if (!days) { if (remuneration) throw new Error('B.C. remuneration with zero permanent-establishment days requires tax review.'); return { taxCents: 0, exemptionCents: 0, notchCents: 0, ratePercent: 0 }; }
  const nonprofit = input.kind === 'charitable_nonprofit';
  if (nonprofit && !input.qualificationEvidence?.trim()) throw new Error('Charitable/nonprofit EHT relief needs documented CRA charity registration or qualifying Income Tax Act exemption; society status alone is insufficient.');
  if (input.location && (!nonprofit || !input.location.qualifying || !input.location.evidence.trim() || !input.location.id.trim())) throw new Error('Separate EHT location relief requires documented qualifying charitable/nonprofit locations.');
  const ownMaximumExemption = ratio(BigInt(nonprofit ? 150_000_000 : 100_000_000) * BigInt(days), 365n);
  let groupDays = days;
  if (input.associated && !nonprofit) {
    if (input.associatedGroupPermanentEstablishmentDays === undefined && days < 365) throw new Error('A part-year associated employer needs the group’s union of permanent-establishment days; individual days cannot set group thresholds.');
    groupDays = input.associatedGroupPermanentEstablishmentDays ?? 365;
    integer(groupDays, 'Associated group permanent-establishment days', 365);
    if (groupDays < days) throw new Error('Associated group establishment days cannot be fewer than this employer’s own establishment days.');
  }
  const standardExemption = ratio(BigInt(nonprofit ? 150_000_000 : 100_000_000) * BigInt(groupDays), 365n);
  const notch = ratio(BigInt(nonprofit ? 450_000_000 : 150_000_000) * BigInt(groupDays), 365n);
  let exemption = standardExemption, groupRemuneration = remuneration;
  if (input.associated && !nonprofit) {
    if (input.associatedGroupRemunerationCents === undefined) throw new Error('Associated ordinary employers need the combined group remuneration.');
    groupRemuneration = money(input.associatedGroupRemunerationCents, 'Associated group remuneration');
    if (groupRemuneration < remuneration) throw new Error('The associated group remuneration cannot be below this employer’s remuneration.');
    if (groupRemuneration <= standardExemption) return { taxCents: 0, exemptionCents: ownMaximumExemption, notchCents: notch, ratePercent: 0 };
    if (groupRemuneration <= notch) {
      if (input.allocatedExemptionCents === undefined || !input.allocationEvidence?.trim()) throw new Error('Associated ordinary employers in the notch band need the shared exemption allocation and agreement evidence.');
      exemption = money(input.allocatedExemptionCents, 'Allocated exemption');
      if (exemption > ownMaximumExemption || exemption > standardExemption) throw new Error('The allocated exemption exceeds this employer’s own prorated maximum or the group exemption.');
    } else exemption = 0;
  }
  const ratePercent = groupRemuneration > notch ? 1.95 : remuneration > exemption ? nonprofit ? 2.925 : 5.85 : 0;
  const taxCents = ratePercent === 1.95 ? percentage(remuneration, 1.95) : percentage(Math.max(0, remuneration - exemption), ratePercent);
  return { taxCents, exemptionCents: exemption, notchCents: notch, ratePercent };
}

export function calculateBcLocationHealthTax(input: { year: number; qualificationEvidence: string; permanentEstablishmentDays?: number; locations: { id: string; evidence: string; qualifying: boolean; annualBcRemunerationCents: number }[] }) {
  if (!input.locations.length) throw new Error('Provide every qualifying EHT location and attribute nonqualifying-location remuneration reasonably to those locations.');
  const ids = new Set<string>();
  const locations = input.locations.map(location => {
    if (ids.has(location.id)) throw new Error('Each physical qualifying EHT location may claim one exemption only.');
    ids.add(location.id);
    return { id: location.id, ...calculateBcEmployerHealthTax({ year: input.year, kind: 'charitable_nonprofit', qualificationEvidence: input.qualificationEvidence, permanentEstablishmentDays: input.permanentEstablishmentDays, location, annualBcRemunerationCents: location.annualBcRemunerationCents }) };
  });
  const remuneration = sum(input.locations.map(location => location.annualBcRemunerationCents));
  const threshold = ratio(150_000_000n * BigInt(input.permanentEstablishmentDays ?? 365), 365n);
  return { locations, taxCents: sum(locations.map(location => location.taxCents)), registrationRequired: remuneration > threshold, annualBcRemunerationCents: remuneration };
}

export function calculateWorkSafeBc(input: { assessableCents: number; ytdAssessableCents: number; annualAssessableLimitCents: number; netRatePercent: number; rateEvidence: string }) {
  money(input.assessableCents); money(input.ytdAssessableCents); money(input.annualAssessableLimitCents);
  if (!input.rateEvidence?.trim()) throw new Error('Use the employer’s actual WorkSafeBC net classification rate and assessment evidence.');
  const currentAssessableCents = Math.min(input.assessableCents, Math.max(0, input.annualAssessableLimitCents - input.ytdAssessableCents));
  return { currentAssessableCents, remainingAssessableCents: Math.max(0, input.annualAssessableLimitCents - input.ytdAssessableCents - currentAssessableCents), premiumCents: percentage(currentAssessableCents, input.netRatePercent) };
}

export type BcEmployerCostInput = {
  earnings: PayrollEarningsBases; vacationAccruedCents: number; employerCppCents: number; employerCpp2Cents: number; employerEiCents: number;
  priorVacationLiabilityReleasedCents?: number;
  benefitsCents: number; pensionCents: number; benefitsAlreadyInEarningsCents?: number; pensionAlreadyInEarningsCents?: number;
  workSafe?: { netRatePercent: number; annualAssessableLimitCents: number; ytdAssessableCents: number; rateEvidence: string };
  eht?: BcEhtConfiguration & { annualBcRemunerationBeforeCents: number };
};
export type BcEmployerCostResult = {
  cashRemunerationCents: number; taxableGrossCents: number; vacationAccrualCents: number;
  employerCppCents: number; employerCpp2Cents: number; employerEiCents: number; workSafeCents: number; ehtCents: number; benefitsCents: number; pensionCents: number;
  /** Positive previously expensed vacation now paid; subtract from current expense. */
  vacationLiabilityReleasedCents?: number;
  totalEmployerCostCents: number; warnings: string[]; blockers: string[]; sources: typeof BC_EMPLOYER_COST_SOURCES;
};
export function calculateBcEmployerCosts(input: BcEmployerCostInput): BcEmployerCostResult {
  const warnings: string[] = [], blockers: string[] = [];
  const result: BcEmployerCostResult = { cashRemunerationCents: input.earnings.cashCents, taxableGrossCents: input.earnings.taxableCents, vacationAccrualCents: input.vacationAccruedCents, employerCppCents: input.employerCppCents, employerCpp2Cents: input.employerCpp2Cents, employerEiCents: input.employerEiCents, workSafeCents: 0, ehtCents: 0, benefitsCents: 0, pensionCents: 0, vacationLiabilityReleasedCents: input.priorVacationLiabilityReleasedCents ?? 0, totalEmployerCostCents: 0, warnings, blockers, sources: BC_EMPLOYER_COST_SOURCES };
  try {
    for (const amount of Object.values(input.earnings)) money(amount);
    for (const amount of [input.vacationAccruedCents, input.employerCppCents, input.employerCpp2Cents, input.employerEiCents, input.benefitsCents, input.pensionCents]) money(amount);
    money(result.vacationLiabilityReleasedCents!);
    if (result.vacationLiabilityReleasedCents! > input.earnings.cashCents) throw new Error('Previously accrued vacation released cannot exceed the cash actually paid.');
    const includedBenefits = money(input.benefitsAlreadyInEarningsCents ?? 0), includedPension = money(input.pensionAlreadyInEarningsCents ?? 0);
    if (includedBenefits > input.benefitsCents || includedPension > input.pensionCents) throw new Error('An already-included employer cost cannot exceed that actual cost.');
    if (sum([includedBenefits, includedPension]) > input.earnings.cashCents) throw new Error('Employer benefits/pension counted as already included cannot exceed cash remuneration; noncash benefits remain an actual employer cost.');
    result.benefitsCents = input.benefitsCents - includedBenefits; result.pensionCents = input.pensionCents - includedPension;
    if (!input.workSafe) blockers.push('Record the actual WorkSafeBC rate, annual assessable limit and same-employer YTD assessable earnings, including explicit zero/exemption evidence.');
    else result.workSafeCents = calculateWorkSafeBc({ ...input.workSafe, assessableCents: input.earnings.workSafeCents }).premiumCents;
    if (!input.eht) blockers.push('Review employer EHT classification, annual remuneration and exemption eligibility.');
    else {
      const before = money(input.eht.annualBcRemunerationBeforeCents);
      const previous = calculateBcEmployerHealthTax({ ...input.eht, annualBcRemunerationCents: before });
      const after = calculateBcEmployerHealthTax({ ...input.eht, associatedGroupRemunerationCents: input.eht.associatedGroupRemunerationCents === undefined ? undefined : sum([input.eht.associatedGroupRemunerationCents, input.earnings.ehtCents]), annualBcRemunerationCents: sum([before, input.earnings.ehtCents]) });
      result.ehtCents = after.taxCents - previous.taxCents;
      if (result.ehtCents < 0) throw new Error('The associated-employer threshold change creates a negative EHT liability adjustment. Review and record the annual tax credit/correction explicitly before finalizing employer costs; it cannot be silently replaced with zero.');
      warnings.push('EHT is the change in cumulative annual liability at supplied remuneration; reconcile the final annual employer/location return. It is not an employee deduction.');
    }
    // Cash remuneration already contains paid vacation and taxable cash benefits.
    // Actual noncash benefit/pension costs are additions unless explicitly included.
    result.totalEmployerCostCents = money(sum([result.cashRemunerationCents, result.vacationAccrualCents, result.employerCppCents, result.employerCpp2Cents, result.employerEiCents, result.workSafeCents, result.ehtCents, result.benefitsCents, result.pensionCents]) - result.vacationLiabilityReleasedCents!);
  } catch (error) { blockers.push(error instanceof Error ? error.message : 'Invalid employer costs.'); }
  return result;
}

export type PayrollCostAllocation = { label: string; shareBps: number; grantId?: string; fundRestrictionId?: string; programCode?: string };
export function allocatePayrollEmployerCosts(input: { costs: BcEmployerCostResult; allocations: readonly PayrollCostAllocation[] }) {
  if (input.costs.blockers.length) throw new Error('Resolve employer cost blockers before allocating a payable calculation.');
  if (!input.allocations.length || input.allocations.length > 100) throw new Error('Use between one and 100 explicit cost allocations.');
  if (sum(input.allocations.map(row => integer(row.shareBps, 'Allocation basis points', 10_000))) !== 10_000) throw new Error('Allocation percentages must total exactly 100%.');
  if (input.allocations.some(row => !row.label.trim())) throw new Error('Each allocation needs a descriptive label.');
  const components = ['cashRemunerationCents', 'vacationAccrualCents', 'employerCppCents', 'employerCpp2Cents', 'employerEiCents', 'workSafeCents', 'ehtCents', 'benefitsCents', 'pensionCents', 'vacationLiabilityReleasedCents'] as const;
  const rows = input.allocations.map(row => ({ ...row, amounts: {} as Record<typeof components[number], number>, totalCents: 0 }));
  for (const component of components) {
    // Allocate net cash expense and the old liability separately, then reconstruct
    // gross cash. This conserves both and prevents a rounding-only negative row.
    const componentAmount = component === 'cashRemunerationCents' ? input.costs.cashRemunerationCents - (input.costs.vacationLiabilityReleasedCents ?? 0) : input.costs[component] ?? 0;
    const amount = BigInt(money(componentAmount));
    const shares = rows.map((row, index) => ({ index, quotient: Number(amount * BigInt(row.shareBps) / 10_000n), remainder: amount * BigInt(row.shareBps) % 10_000n }));
    const residual = Number(amount) - sum(shares.map(share => share.quotient));
    // Largest-remainder allocation; source row order is the stable tie breaker.
    const order = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; i < residual; i++) order[i].quotient++;
    for (const share of shares) { rows[share.index].amounts[component] = share.quotient; if (component !== 'vacationLiabilityReleasedCents') rows[share.index].totalCents = sum([rows[share.index].totalCents, share.quotient]); }
  }
  for (const row of rows) row.amounts.cashRemunerationCents = sum([row.amounts.cashRemunerationCents, row.amounts.vacationLiabilityReleasedCents]);
  if (sum(rows.map(row => row.totalCents)) !== input.costs.totalEmployerCostCents) throw new Error('Employer cost components do not reconcile to the full employer cost.');
  return { rows, totalCents: input.costs.totalEmployerCostCents, rounding: 'Each cost component uses largest remainders; input order breaks equal remainders.' };
}

export const PAYROLL_MISC_SOURCES = [
  { id: 'cra-mileage', url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/benefits-allowances/automobile/automobile-motor-vehicle-allowances.html', reviewed: '2026-10-23' },
  { id: 'cra-status', url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4110/employee-self-employed.html', reviewed: '2026-10-23' },
  { id: 'bc-society-disclosure', url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/216_2015/', reviewed: '2026-10-23' },
] as const;
export function calculateReasonableMileage(input: { date: string; kilometres: number; priorYearKilometres: number; territory: boolean; businessPurpose: string; employeeOwnedVehicle: boolean; solelyBusinessDistance: boolean; noDuplicateReimbursement: boolean }) {
  dateMs(input.date);
  if (input.date.slice(0, 4) !== '2026') throw new Error('This reasonable automobile allowance schedule is reviewed for 2026 only.');
  if (!Number.isFinite(input.kilometres) || input.kilometres < 0 || input.kilometres > 1_000_000 || !Number.isFinite(input.priorYearKilometres) || input.priorYearKilometres < 0 || input.priorYearKilometres > 1_000_000 || Math.abs(Math.round(input.kilometres * 1000) / 1000 - input.kilometres) > 1e-9 || Math.abs(Math.round(input.priorYearKilometres * 1000) / 1000 - input.priorYearKilometres) > 1e-9) throw new Error('Use nonnegative kilometres with at most three decimal places and same-employer calendar-year prior kilometres.');
  if (!input.businessPurpose.trim()) throw new Error('Mileage needs an actual business purpose and travel record.');
  const firstRateCents = input.territory ? 77 : 73, subsequentRateCents = input.territory ? 71 : 67;
  const kmMilli = Math.round(input.kilometres * 1000), previous = Math.round(input.priorYearKilometres * 1000);
  const firstMilli = Math.min(kmMilli, Math.max(0, 5_000_000 - previous));
  const amountCents = ratio(BigInt(firstMilli) * BigInt(firstRateCents) + BigInt(kmMilli - firstMilli) * BigInt(subsequentRateCents), 1000n);
  const taxExempt = input.employeeOwnedVehicle && input.solelyBusinessDistance && input.noDuplicateReimbursement;
  return { amountCents, firstTierKilometres: firstMilli / 1000, subsequentKilometres: (kmMilli - firstMilli) / 1000, firstRateCents, subsequentRateCents, taxExempt, warnings: taxExempt ? [] : ['Reasonable-rate arithmetic alone does not establish tax exemption. Review vehicle ownership, business-only distance, duplicate/fixed allowances and supporting records.'], sources: PAYROLL_MISC_SOURCES };
}

export function reviewPaymentClassification(input: { relationship: 'employee' | 'office_holder' | 'independent_contractor' | 'unreviewed'; label: string; evidence?: string }) {
  if (!input.evidence?.trim() || input.relationship === 'unreviewed') return { reporting: 'review_required' as const, blocker: 'Review the actual employment/office/contract relationship; an honorarium label does not select T4A.' };
  if (input.relationship === 'employee' || input.relationship === 'office_holder') return { reporting: 'employment_t4' as const, blocker: undefined };
  return { reporting: 'contractor_information_return_review' as const, blocker: undefined };
}

export type SocietyRemunerationPayment = { recipientKey: string; date: string; amountCents: number; kind: 'director' | 'employee' | 'contractor'; positionOrService: string; directorCapacity?: 'director' | 'other'; remuneration: boolean; name?: string };
/** Actual remuneration paid in the statement period. Annual salary rates are not inputs. */
export function societyRemunerationDisclosure(input: { periodStart: string; periodEnd: string; payments: readonly SocietyRemunerationPayment[]; includeNames?: boolean }) {
  dateMs(input.periodStart); dateMs(input.periodEnd);
  if (input.periodEnd < input.periodStart) throw new Error('Use an ordered financial-statement period.');
  const rows = new Map<string, { recipientKey: string; kind: SocietyRemunerationPayment['kind']; kinds: SocietyRemunerationPayment['kind'][]; positionOrService: string; otherCapacities: string[]; amountCents: number; directorFeesCents: number; otherCapacityCents: number; name?: string }>();
  for (const payment of input.payments) {
    dateMs(payment.date); money(payment.amountCents);
    if (!payment.remuneration || payment.date < input.periodStart || payment.date > input.periodEnd) continue;
    if (!payment.recipientKey.trim() || !payment.positionOrService.trim()) throw new Error('Disclosure needs a stable recipient and position/service description.');
    const key = `${payment.kind === 'director' ? 'director' : 'worker'}:${payment.recipientKey}`;
    const row = rows.get(key) ?? { recipientKey: payment.recipientKey, kind: payment.kind, kinds: [], positionOrService: payment.positionOrService, otherCapacities: [], amountCents: 0, directorFeesCents: 0, otherCapacityCents: 0, ...(input.includeNames && payment.name ? { name: payment.name } : {}) };
    if (!row.kinds.includes(payment.kind)) row.kinds.push(payment.kind);
    if (!row.positionOrService.split(' / ').includes(payment.positionOrService)) row.positionOrService += ` / ${payment.positionOrService}`;
    row.amountCents = sum([row.amountCents, payment.amountCents]);
    if (payment.kind === 'director') {
      if (!payment.directorCapacity) throw new Error('Distinguish director fees from remuneration in another capacity.');
      if (payment.directorCapacity === 'director') row.directorFeesCents = sum([row.directorFeesCents, payment.amountCents]);
      else { row.otherCapacityCents = sum([row.otherCapacityCents, payment.amountCents]); if (!row.otherCapacities.includes(payment.positionOrService)) row.otherCapacities.push(payment.positionOrService); }
    }
    rows.set(key, row);
  }
  const directors = [...rows.values()].filter(row => row.kind === 'director' && row.amountCents > 0);
  const employeesAndContractors = [...rows.values()].filter(row => row.kind !== 'director' && row.amountCents >= 7_500_000);
  return { directors, employeesAndContractors, aggregate: { count: employeesAndContractors.length, amountCents: sum(employeesAndContractors.map(row => row.amountCents)) }, periodStart: input.periodStart, periodEnd: input.periodEnd, thresholdCents: 7_500_000, sources: PAYROLL_MISC_SOURCES };
}
