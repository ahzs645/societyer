import type { BcEarningsInput, BcEarningsResult, BcWageHistoryDay } from './payrollEarnings';

const overtimeCodes = new Set(['OVERTIME_15', 'OVERTIME_2', 'SALARY_PREMIUM_15', 'SALARY_PREMIUM_2']);
const wageCodes = new Set(['REGULAR', 'SALARY', 'SALARY_LEAVE', 'SALARY_WAGE_FLOOR', 'STAT_AVERAGE', 'SICK_PAID', 'STAT_WORK_15', 'STAT_SALARY_PREMIUM_15', 'VACATION_PAID']);
const coveredOvertimeCodes = new Set(['SALARY_PREMIUM_15', 'SALARY_PREMIUM_2']);
const validCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Daily ESA average-day-pay wages from the actual retained native calculation.
 * Never consults today's employee rates or turns unclassified provider amounts
 * into wage history. The complete original week has already classified overtime.
 */
export function deriveBcWageHistory(input: BcEarningsInput, result: BcEarningsResult): { history: BcWageHistoryDay[]; unknownDates?: string[]; warnings?: string[] } {
  const rows = new Map<string, BcWageHistoryDay>();
  const unknown = new Set<string>();
  const row = (date: string) => {
    let value = rows.get(date);
    if (!value) { value = { date, nonOvertimeWagesCents: 0, workedOrEarned: false }; rows.set(date, value); }
    return value;
  };
  for (const work of input.workDays) if (work.date >= input.periodStart && work.date <= input.periodEnd) {
    row(work.date).workedOrEarned = work.minutes > 0 || (work.paidVacationMinutes ?? 0) > 0;
    // Older emitted lines combine s36 rest premiums with s40 overtime. Their
    // legal averaging treatment cannot be separated from that mixed cash line.
    if (work.restPremiumMinutes) unknown.add(work.date);
  }
  for (const line of result.lines) row(line.date);
  if (result.blockers.length) return { history: [], unknownDates: [...rows.keys()].sort(), warnings: ['Blocked earnings cannot establish actual daily wage history.'] };
  // A custom cash earning's tax/CPP/EI flags do not establish whether it is
  // wages for ESA averaging (for example, a discretionary bonus). Review it.
  for (const extra of input.additionalEarnings ?? []) if (extra.cash && extra.kind !== 'reimbursement' && extra.amountCents) unknown.add(extra.date);
  // ESA s1 defines overtime wages by s37/s40, rather than holiday work under
  // s46. Holiday work premiums are retained; only ordinary overtime is removed.
  const holidayWorked = new Set(result.lines.filter(line => ['STAT_WORK_15', 'STAT_SALARY_PREMIUM_15'].includes(line.code)).map(line => line.date));
  const salaryOvertime = new Map<string, { numerator: bigint; denominator: bigint }>();
  for (const line of result.lines) {
    const value = row(line.date);
    if (line.amountCents > 0 && line.cash && line.kind !== 'reimbursement') value.workedOrEarned = true;
    if (!validCents(line.amountCents)) { unknown.add(line.date); continue; }
    if (!line.cash || line.kind === 'reimbursement') continue;
    if (line.code === 'VACATION_PAID' && line.amountCents && !result.lines.some(earned => earned.date === line.date && earned.code !== 'VACATION_PAID' && earned.cash && earned.amountCents > 0 && (wageCodes.has(earned.code) || overtimeCodes.has(earned.code)))) {
      // Current native vacation is allocated over the actual earning dates.
      // An older payment-date-only lump cannot invent a new earned Sunday.
      unknown.add(line.date);
    }
    if (!wageCodes.has(line.code) && !overtimeCodes.has(line.code)) { if (line.amountCents) unknown.add(line.date); continue; }
    if (wageCodes.has(line.code) || (['OVERTIME_2', 'SALARY_PREMIUM_2'].includes(line.code) && holidayWorked.has(line.date))) {
      value.nonOvertimeWagesCents += line.amountCents;
      if (!validCents(value.nonOvertimeWagesCents)) unknown.add(line.date);
    }
    if (coveredOvertimeCodes.has(line.code) && !(line.code === 'SALARY_PREMIUM_2' && holidayWorked.has(line.date))) {
      // The whole overtime wage is excluded, including its 1x component already
      // embedded in salary. The premium line retains exact derived-rate data.
      try {
        if (!Number.isSafeInteger(line.minutes) || line.minutes! < 0) throw new Error('Missing covered overtime minutes');
        let numerator: bigint, denominator: bigint;
        if (line.ratePrecision) {
          numerator = BigInt(line.ratePrecision.numeratorCents); denominator = BigInt(line.ratePrecision.denominator);
        } else if (input.salary) {
          const salary = input.salary;
          if (!validCents(salary.amountCents) || !Number.isSafeInteger(salary.normalWeeklyMinutes) || !Number.isSafeInteger(salary.averageWeeklyMinutes)) throw new Error('Invalid frozen salary');
          numerator = BigInt(salary.amountCents) * BigInt(salary.basis === 'monthly' ? 720 : 60);
          denominator = BigInt(52 * Math.min(salary.normalWeeklyMinutes, salary.averageWeeklyMinutes));
        } else throw new Error('Missing frozen exact salary rate');
        if (numerator < 0n || denominator <= 0n) throw new Error('Invalid exact salary rate');
        const amount = { numerator: numerator * BigInt(line.minutes!), denominator: denominator * 60n };
        const previous = salaryOvertime.get(line.date);
        if (previous) {
          if (previous.denominator !== amount.denominator) throw new Error('Inconsistent frozen salary rates');
          previous.numerator += amount.numerator;
        } else salaryOvertime.set(line.date, amount);
      } catch { unknown.add(line.date); }
    }
  }
  for (const work of input.workDays) if (work.date >= input.periodStart && work.date <= input.periodEnd && (work.minutes || work.paidVacationMinutes)) {
    if (!result.lines.some(line => line.date === work.date && line.cash && line.amountCents > 0 && (wageCodes.has(line.code) || overtimeCodes.has(line.code)))) unknown.add(work.date);
  }
  // Round the exact underlying salary-overtime cohort once and distribute cents
  // by largest remainder, matching the native work-earnings rounding convention.
  const portions = [...salaryOvertime].map(([date, fraction]) => ({ date, ...fraction }));
  if (portions.length) {
    const denominator = portions[0].denominator;
    if (portions.some(part => part.denominator !== denominator)) for (const part of portions) unknown.add(part.date);
    else {
      const total = portions.reduce((n, part) => n + part.numerator, 0n);
      const target = (total * 2n + denominator) / (2n * denominator);
      const shares = portions.map(part => ({ ...part, cents: part.numerator / denominator, remainder: part.numerator % denominator }));
      const residual = Number(target - shares.reduce((n, part) => n + part.cents, 0n));
      const ordered = [...shares].sort((a, b) => a.remainder === b.remainder ? a.date.localeCompare(b.date) : a.remainder > b.remainder ? -1 : 1);
      for (let index = 0; index < residual; index++) ordered[index].cents++;
      for (const share of shares) {
        const value = row(share.date), cents = Number(share.cents);
        if (!validCents(cents) || value.nonOvertimeWagesCents < cents) unknown.add(share.date);
        else value.nonOvertimeWagesCents -= cents;
      }
    }
  }
  const unknownDates = [...unknown].sort();
  return {
    history: [...rows.values()].filter(value => !unknown.has(value.date)).sort((a, b) => a.date.localeCompare(b.date)),
    ...(unknownDates.length ? { unknownDates, warnings: ['Some actual earning classifications or salary allocations require reviewed daily non-overtime wage history.'] } : {}),
  };
}
