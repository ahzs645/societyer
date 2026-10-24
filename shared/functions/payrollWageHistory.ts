import type { PortableQueryCtx } from "../portable/ctx";
import type {
  BcEarningsInput,
  BcEarningsResult,
  BcWageHistoryDay,
} from "../payrollEarnings";
import { BC_STATUTORY_HOLIDAYS, calculateBcEarnings } from "../payrollEarnings";
import { deriveBcWageHistory } from "../payrollWageHistory";
import { getOwned } from "./access";
import type { PayrollRow } from "./payrollCalculationData";

export type NativeWageHistoryProof = {
  date: string;
  kind: "manual" | "native" | "current";
  calculationIds?: string[];
  nonOvertimeWagesCents: number;
  workedOrEarned: boolean;
};
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
const earns = (day: PayrollRow) =>
  day.minutes > 0 ||
  day.paidVacationMinutes > 0 ||
  day.sickLeave === "paid" ||
  (day.salaryIncludedHolidayCents ?? 0) > 0 ||
  (day.salaryIncludedSickCents ?? 0) > 0;
const active = (row: PayrollRow, asOf: string) =>
  row.status === "finalized" ||
  (row.status === "reversed" && row.reversedDate > asOf);
const key = (history: BcWageHistoryDay[]) =>
  JSON.stringify([...history].sort((a, b) => a.date.localeCompare(b.date)));
/** A cached, bounded get path: no extra pagination is used by payroll preview. */
export function frozenPayrollWageHistoryLoader(
  ctx: PortableQueryCtx,
  societyId: string,
) {
  const cache = new Map<string, Promise<PayrollRow>>();
  let bytes = 0;
  return (id: string) => {
    let promise = cache.get(id);
    if (!promise) {
      promise = (async () => {
        const row = await getOwned<PayrollRow>(
          ctx,
          "payrollCalculations",
          id,
          societyId,
        );
        bytes += new TextEncoder().encode(
          String(row.resultJson ?? "") + String(row.inputJson ?? ""),
        ).byteLength;
        if (bytes > 4000000)
          throw new Error(
            "Frozen daily wage history exceeds the complete 4 MB calculation source bound; reconcile reviewed historical sources before continuing.",
          );
        return row;
      })();
      cache.set(id, promise);
    }
    return promise;
  };
}
export async function retainedNativeWageHistory(args: {
  employeeId: string;
  work: PayrollRow[];
  runs: PayrollRow[];
  periodStart: string;
  periodEnd: string;
  payDate: string;
  load: (id: string) => Promise<PayrollRow>;
}) {
  const from = addDays(args.periodStart, -30),
    to = addDays(args.periodEnd, -1),
    history = new Map<string, BcWageHistoryDay>(),
    proof = new Map<string, NativeWageHistoryProof>(),
    unknown = new Set<string>(),
    sources: unknown[] = [],
    warnings: string[] = [];
  const calculations = new Set<string>(
    args.work
      .filter((w) => w.postedCalculationId && w.date >= from && w.date <= to)
      .map((w) => w.postedCalculationId),
  );
  for (const run of args.runs)
    if (
      run.source === "native" &&
      run.calculationId &&
      run.periodEnd >= from &&
      run.periodStart <= to &&
      run.payDate <= args.payDate &&
      (!run.reversedDate || run.reversedDate > args.payDate) &&
      run.lines?.some((line: any) => line.employeeId === args.employeeId)
    )
      calculations.add(run.calculationId);
  for (const id of calculations) {
    const row = await args.load(id);
    if (!active(row, args.payDate) || row.payDate > args.payDate) continue;
    const retained = JSON.parse(row.resultJson),
      employee = retained.employees?.find(
        (e: any) => e.employeeId === args.employeeId,
      );
    if (
      !employee ||
      employee.blockers?.length ||
      !employee.earningsInput ||
      !employee.earnings
    )
      throw new Error(
        "A posted native wage-history reference has no complete retained employee earnings snapshot.",
      );
    const derived = deriveBcWageHistory(
      employee.earningsInput,
      employee.earnings,
    );
    sources.push({
      calculationId: id,
      version: row.version,
      status: row.status,
      payDate: row.payDate,
      reversedDate: row.reversedDate,
      resultFingerprint: row.resultFingerprint,
      earningsInput: employee.earningsInput,
      earnings: employee.earnings,
    });
    for (const date of derived.unknownDates ?? [])
      if (date >= from && date <= to) unknown.add(date);
    for (const day of derived.history) {
      if (day.date < from || day.date > to) continue;
      const previous = history.get(day.date),
        amount =
          (previous?.nonOvertimeWagesCents ?? 0) + day.nonOvertimeWagesCents;
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new Error(
          "Retained native daily wage history has invalid monetary totals.",
        );
      const value = {
        date: day.date,
        nonOvertimeWagesCents: amount,
        workedOrEarned: Boolean(previous?.workedOrEarned || day.workedOrEarned),
      };
      history.set(day.date, value);
      const priorProof = proof.get(day.date);
      proof.set(day.date, {
        ...value,
        kind: "native",
        calculationIds: [...(priorProof?.calculationIds ?? []), id],
      });
    }
  }
  for (const day of args.work) {
    if (
      day.date < from ||
      day.date > to ||
      day.historicalNonOvertimeWagesCents === undefined
    )
      continue;
    const native = history.get(day.date);
    if (native && !unknown.has(day.date)) {
      if (native.nonOvertimeWagesCents !== day.historicalNonOvertimeWagesCents)
        warnings.push(
          `${day.date}: retained native non-overtime wages take precedence over the manually entered history; the source is counted once.`,
        );
      continue;
    }
    const value = {
      date: day.date,
      nonOvertimeWagesCents: day.historicalNonOvertimeWagesCents,
      workedOrEarned: day.workedOrEarned ?? earns(day),
    };
    history.set(day.date, value);
    proof.set(day.date, { ...value, kind: "manual" });
    unknown.delete(day.date);
  }
  return {
    history: [...history.values()],
    proof: [...proof.values()],
    unknown,
    sources,
    warnings,
  };
}
/** Resolve native current-period wages before using them for statutory averages.
 * Provisional zero seeds never leave this function: a payable result must reach
 * a fixed point using exact engine-derived daily wages on every referenced day. */
export function calculateEarningsWithNativeHistory(
  input: BcEarningsInput,
  retained: Awaited<ReturnType<typeof retainedNativeWageHistory>>,
  work: PayrollRow[],
) {
  const leaveDates = input.workDays
    .filter(
      (w) =>
        w.date >= input.periodStart &&
        w.date <= input.periodEnd &&
        (w.sickLeave === "paid" ||
          w.holiday ||
          BC_STATUTORY_HOLIDAYS.includes(w.date)),
    )
    .map((w) => w.date);
  const needed = (date: string) =>
    leaveDates.some((leave) => date >= addDays(leave, -30) && date < leave);
  const known = new Map(retained.history.map((day) => [day.date, day]));
  const blockers: string[] = [];
  for (const day of work)
    if (
      day.date < input.periodStart &&
      needed(day.date) &&
      earns(day) &&
      (!known.has(day.date) || retained.unknown.has(day.date))
    )
      blockers.push(
        `Holiday/sick eligibility needs reviewed non-overtime wage history for ${day.date}; no active finalized native or actual external source establishes this day's wages.`,
      );
  for (const date of retained.unknown)
    if (date < input.periodStart && needed(date))
      blockers.push(
        `Retained native wages on ${date} need an explicit reviewed non-overtime history source; no amount was inferred from current rates.`,
      );
  if (!leaveDates.length || blockers.length)
    return {
      earnings: calculateBcEarnings({ ...input, history: [...known.values()] }),
      input: { ...input, history: [...known.values()] },
      proof: retained.proof,
      blockers,
    };
  const seeds = new Map<string, BcWageHistoryDay>();
  for (const day of input.workDays.filter(
    (w) => w.date >= input.periodStart && w.date <= input.periodEnd,
  ))
    seeds.set(day.date, {
      date: day.date,
      nonOvertimeWagesCents: 0,
      workedOrEarned:
        day.minutes > 0 ||
        (day.paidVacationMinutes ?? 0) > 0 ||
        day.sickLeave === "paid" ||
        (day.salaryIncludedHolidayCents ?? 0) > 0 ||
        (day.salaryIncludedSickCents ?? 0) > 0,
    });
  for (const line of input.additionalEarnings ?? [])
    if (line.cash && line.kind !== "reimbursement" && line.amountCents > 0)
      seeds.set(line.date, {
        date: line.date,
        nonOvertimeWagesCents: 0,
        workedOrEarned: true,
      });
  let staged = [
      ...[...known.values()].filter((day) => day.date < input.periodStart),
      ...seeds.values(),
    ],
    finalProof = retained.proof,
    finalInput = { ...input, history: [...known.values()] },
    earnings = calculateBcEarnings(finalInput);
  for (let iteration = 0; iteration < 20; iteration++) {
    const nextInput = { ...input, history: staged };
    const next = calculateBcEarnings(nextInput);
    if (next.blockers.length)
      return {
        earnings: calculateBcEarnings(finalInput),
        input: finalInput,
        proof: finalProof,
        blockers: next.blockers,
      };
    const derived = deriveBcWageHistory(nextInput, next),
      current = new Map(
        derived.history
          .filter(
            (day) =>
              day.date >= input.periodStart && day.date <= input.periodEnd,
          )
          .map((day) => [day.date, day]),
      );
    for (const date of derived.unknownDates ?? [])
      if (needed(date)) {
        const manual = known.get(date);
        if (
          !manual ||
          retained.proof.find((p) => p.date === date)?.kind !== "manual"
        )
          blockers.push(
            `Current native wages on ${date} need an explicit reviewed non-overtime history source; their classification cannot be inferred.`,
          );
        else current.set(date, manual);
      }
    if (blockers.length)
      return {
        earnings: calculateBcEarnings(finalInput),
        input: finalInput,
        proof: finalProof,
        blockers,
      };
    const actual = [
      ...[...known.values()].filter((day) => day.date < input.periodStart),
      ...current.values(),
    ];
    finalProof = [
      ...retained.proof.filter((day) => day.date < input.periodStart),
      ...[...current.values()].map((day) => ({ ...day, kind: "current" as const })),
    ];
    finalInput = { ...input, history: actual };
    earnings = next;
    if (key(actual) === key(staged))
      return {
        earnings: calculateBcEarnings(finalInput),
        input: finalInput,
        proof: finalProof,
        blockers: [],
      };
    staged = actual;
  }
  return {
    earnings: calculateBcEarnings(finalInput),
    input: finalInput,
    proof: finalProof,
    blockers: [
      "Current native daily wages did not stabilize for the statutory average; review the dated wage sources before approval.",
    ],
  };
}
