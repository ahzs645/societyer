import { loadPublishedPayrollRulePortable } from "./payrollRules";
import { resolvePayrollTd1Portable } from "./payrollTd1";
import type { PortableQueryCtx } from "../portable/ctx";
import type {
  CalculationInput,
  EmployeeProfileFields,
  EmployerSettingsFields,
  PayrollCalculatedEmployee,
  PayrollCalculationPreview,
} from "../payrollCalculation";
import {
  calculatePayrollDeductions,
  deriveCppEligibility,
  emptyPayrollYtd,
  type PayrollDeductionYtd,
} from "../payrollDeductions";
import {
  BC_EARNINGS_RULES_VERSION,
  BC_STATUTORY_HOLIDAYS,
  bcSalaryCoverageMinutes,
  bcSalaryCalendarBounds,
  calculateBcEmployerCosts,
  allocatePayrollEmployerCosts,
  bcSalaryHourlyEquivalent,
  validateBcPayTiming,
  type BcEarningsInput,
  type ClassifiedEarning,
} from "../payrollEarnings";
import { validatePayrollStatement } from "../payrollReporting";
import {
  cleanPayrollInput,
  payrollJson,
} from "../payrollCalculationValidation";
import { getOwned } from "./access";
import {
  frozenPayrollWageHistoryLoader,
  retainedNativeWageHistory,
  calculateEarningsWithNativeHistory,
} from "./payrollWageHistory";
import {
  payrollLocationHistory,
  payrollEmployeeEhtLocation,
  payrollEhtReconciliation,
  payrollEmployeeEmployerTerms,
  payrollPercentage,
} from "../payrollEmployerConfiguration";
import {
  payrollBounded,
  payrollOrganization,
  payrollRead,
  payrollWorkVacationSource,
  type PayrollRow,
} from "./payrollCalculationData";

const DAY = 86400000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Payroll source could not be calculated.";
const sum = (values: number[]) => {
  const result = Number(values.reduce((a, b) => a + BigInt(b), 0n));
  if (!Number.isSafeInteger(result))
    throw new Error("Payroll amount exceeds safe integer cents.");
  return result;
};
export { canonicalPayroll, payrollFingerprint } from "../payrollProvenance";
import { payrollFingerprint } from "../payrollProvenance";
export const PAYROLL_YTD_FIELDS = Object.keys(
  emptyPayrollYtd(),
) as (keyof PayrollDeductionYtd)[];
function normalizeZeroSplits(ytd: PayrollDeductionYtd) {
  for (const [tax, keys] of [
    [
      "regularTaxCents",
      ["regularFederalTaxCents", "regularProvincialTaxCents"],
    ],
    ["bonusTaxCents", ["bonusFederalTaxCents", "bonusProvincialTaxCents"]],
  ] as const)
    if (ytd[tax] === 0)
      for (const key of keys) if (ytd[key] === undefined) ytd[key] = 0;
  return ytd;
}
const SPLITS = new Set([
  "regularFederalTaxCents",
  "regularProvincialTaxCents",
  "bonusFederalTaxCents",
  "bonusProvincialTaxCents",
]);
function addYtd(ytd: PayrollDeductionYtd, delta: PayrollDeductionYtd) {
  normalizeZeroSplits(ytd);
  delta = normalizeZeroSplits(structuredClone(delta));
  for (const key of PAYROLL_YTD_FIELDS) {
    if (
      SPLITS.has(key) &&
      (ytd[key] === undefined || delta[key] === undefined)
    ) {
      delete ytd[key];
      continue;
    }
    const value = sum([ytd[key] ?? 0, delta[key] ?? 0]);
    ytd[key] = value;
  }
}
export function payrollYtdDelta(
  before: PayrollDeductionYtd,
  after: PayrollDeductionYtd,
) {
  before = normalizeZeroSplits(structuredClone(before));
  return Object.fromEntries(
    PAYROLL_YTD_FIELDS.filter(
      (key) => after[key] !== undefined && before[key] !== undefined,
    ).map((key) => [key, sum([after[key]!, -before[key]!])]),
  ) as PayrollDeductionYtd;
}
function profileAt(profiles: PayrollRow[], date: string) {
  const found = profiles.filter(
    (p) => p.effectiveFrom <= date && (!p.effectiveTo || p.effectiveTo >= date),
  );
  if (found.length !== 1)
    throw new Error(
      `Exactly one effective employee profile is required on ${date}.`,
    );
  return found[0] as PayrollRow & EmployeeProfileFields;
}
function splitAmounts(lines: ClassifiedEarning[]) {
  return {
    nonCashTaxableCents: sum(
      lines.filter((l) => !l.cash && l.taxable).map((l) => l.amountCents),
    ),
    nonTaxableCashCents: sum(
      lines.filter((l) => l.cash && !l.taxable).map((l) => l.amountCents),
    ),
  };
}
export interface PayrollCalculationAdapter {
  readonly name: string;
  calculate(
    ctx: PortableQueryCtx,
    args: { societyId: string; input: CalculationInput },
    excludeCalculationId?: string,
  ): Promise<PayrollCalculationPreview>;
}
export const nativePayrollCalculationAdapter: PayrollCalculationAdapter = {
  name: "native-bc-reviewed",
  calculate: buildPayrollPreview,
};
export async function previewPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; input: CalculationInput },
) {
  return nativePayrollCalculationAdapter.calculate(ctx, args);
}

export async function buildPayrollPreview(
  ctx: PortableQueryCtx,
  args: { societyId: string; input: CalculationInput },
  excludeCalculationId?: string,
): Promise<PayrollCalculationPreview> {
  await payrollRead(ctx, args.societyId);
  const input = cleanPayrollInput(args.input),
    year = Number(input.payDate.slice(0, 4));
  const selectedRule = input.ruleEditionId
    ? await loadPublishedPayrollRulePortable(ctx, {societyId: args.societyId, id: input.ruleEditionId, payDate: input.payDate, province: "BC", method: input.method})
    : undefined;
  const { organization } = await payrollOrganization(ctx, args.societyId);
  const employerRows = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollEmployerProfiles")
      .withIndex("by_society_year", (q) =>
        q.eq("societyId", args.societyId).eq("year", year),
      ),
    1,
    "Employer year settings",
  );
  const employer = employerRows[0] as
    | (PayrollRow & EmployerSettingsFields)
    | undefined;
  const preview: PayrollCalculationPreview = {
    input,
    employees: [],
    warnings: [],
    blockers: [],
    sourceFingerprint: "",
    totals: {
      taxableCents: 0,
      cashCents: 0,
      cppEmployeeCents: 0,
      cpp2EmployeeCents: 0,
      eiEmployeeCents: 0,
      incomeTaxCents: 0,
      otherDeductionsCents: 0,
      netCents: 0,
      cppEmployerCents: 0,
      cpp2EmployerCents: 0,
      eiEmployerCents: 0,
      employerCostCents: 0,
    },
    rules: { editions: [], sources: [] },
    ...(selectedRule ? {ruleEdition: selectedRule.provenance} : {}),
  };
  if (!employer)
    preview.blockers.push(
      `Save employer settings and the actual ${year} pay calendar first.`,
    );
  if (year !== 2026)
    preview.blockers.push(
      `Native deduction rules for ${year} have not been reviewed. No other year's rates are substituted.`,
    );
  const wageHistoryStart = addDays(input.periodStart, -38),
    runSourceStart =
      wageHistoryStart < `${year}-01-01` ? wageHistoryStart : `${year}-01-01`;
  const loadFrozenWages = frozenPayrollWageHistoryLoader(ctx, args.societyId);
  const runPage = await ctx.db
    .query<PayrollRow>("payRuns")
    .withIndex("by_society_pay_date", (q) =>
      q
        .eq("societyId", args.societyId)
        .gte("payDate", runSourceStart)
        .lte("payDate", `${year}-12-31`),
    )
    .paginate({ numItems: 100, cursor: null, maximumBytesRead: 4000000 });
  if (!runPage.isDone)
    preview.blockers.push(
      "This payment year exceeds the complete 100-run/4 MB calculation source bound. Reconcile through explicit same-employer opening balances or an approved provider; no partial YTD was used.",
    );
  const runs = runPage.page
    .filter((run) => run.calculationId !== excludeCalculationId)
    .sort(
      (a, b) =>
        a.payDate.localeCompare(b.payDate) || a._id.localeCompare(b._id),
    );
  const futureRuns = runs.filter((run) => run.payDate > input.payDate);
  if (
    futureRuns.some((run) =>
      run.lines?.some((line: any) =>
        input.employeeIds.includes(line.employeeId),
      ),
    )
  )
    preview.blockers.push(
      "A later dated recorded payroll already exists for a selected employee. Calculate chronologically or explicitly reverse/correct later runs first.",
    );
  const historyRuns = runs.filter((run) => run.payDate <= input.payDate);
  const pastRuns = historyRuns.filter(
    (run) => Number(run.payDate.slice(0, 4)) === year,
  );
  const source: any[] = [
    {
      input,
      selectedRule,
      employer,
      organization: { name: organization.name, address: organization.address },
      runs,
    },
  ];
  const explicitRegularDate = (
    input as CalculationInput & { regularPayDate?: string }
  ).regularPayDate;
  if (employer) {
    if (explicitRegularDate && !employer.payDates.includes(explicitRegularDate))
      preview.blockers.push(
        "Choose the applicable regular pay date from the saved actual annual calendar.",
      );
    if (
      input.runType === "regular" &&
      explicitRegularDate &&
      explicitRegularDate !== input.payDate
    )
      preview.blockers.push(
        "A regular run must use its own scheduled payment date as the applicable regular period.",
      );
    preview.blockers.push(
      ...validateBcPayTiming({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        payDate: input.payDate,
        frequency: employer.payFrequency,
        ...(input.termination
          ? {
              termination: {
                by: input.termination.initiatedBy,
                at: input.termination.at,
                paidAt: input.termination.paidAt,
              },
            }
          : {}),
      }).blockers,
    );
    if (
      !employer.ehtOpeningConfirmed ||
      employer.ehtOpeningThroughDate >= input.payDate
    )
      preview.blockers.push(
        "Confirm employer EHT opening balances through a date before this payment.",
      );
    if (
      input.runType === "regular" &&
      !employer.payDates.includes(input.payDate)
    )
      preview.blockers.push(
        "The regular payment date must be in the employer's actual pay calendar.",
      );
  }
  let correctedRegularPayDate: string | undefined;
  if (input.correctionOfId) {
    const old = await getOwned<PayrollRow>(
      ctx,
      "payrollCalculations",
      input.correctionOfId,
      args.societyId,
    );
    source.push({ correction: old });
    correctedRegularPayDate =
      JSON.parse(old.inputJson).regularPayDate ?? old.payDate;
    if (
      old.status !== "reversed" ||
      old.year !== year ||
      !input.employeeIds.every((id) => old.employeeIds.includes(id))
    )
      preview.blockers.push(
        "A replacement correction must reference a reversed calculation for the same employer, payment year and employees.",
      );
  }
  let ehtBefore = employer?.ehtOpeningRemunerationCents ?? 0;
  for (const run of pastRuns) {
    if (employer?.ehtOpeningRepresentedPayRunIds.includes(run._id)) continue;
    if (
      !run.lines?.length ||
      run.lines.some((line: any) => !line.classifiedBases)
    ) {
      preview.blockers.push(
        `Recorded run ${run._id} has no complete EHT classifications. Explicitly reconcile it in the employer EHT opening.`,
      );
      continue;
    }
    ehtBefore = sum([
      ehtBefore,
      ...run.lines.map((line: any) => line.classifiedBases.ehtCents),
    ]);
  }
  const locationHistory = employer
    ? payrollLocationHistory(employer, pastRuns)
    : undefined;
  if (locationHistory) preview.blockers.push(...locationHistory.blockers);
  const currentLocationRemuneration = new Map<string, number>();
  let currentEht = 0;
  for (const employeeId of input.employeeIds) {
    const employee = await getOwned<PayrollRow>(
      ctx,
      "employees",
      employeeId,
      args.societyId,
    );
    const profiles = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollEmployeeProfiles")
        .withIndex("by_society_employee_from", (q) =>
          q.eq("societyId", args.societyId).eq("employeeId", employeeId),
        ),
      100,
      "Effective employee profiles",
    );
    const openings = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollOpeningBalances")
        .withIndex("by_society_employee_year", (q) =>
          q
            .eq("societyId", args.societyId)
            .eq("employeeId", employeeId)
            .eq("year", year),
        ),
      1,
      "Employee opening",
    );
    const opening = openings[0];
    const payout = input.vacationPayouts?.find(
      (p) => p.employeeId === employeeId,
    );
    const firstSunday = addDays(
        input.periodStart,
        -new Date(`${input.periodStart}T00:00:00Z`).getUTCDay(),
      ),
      lastSaturday = addDays(
        input.periodEnd,
        6 - new Date(`${input.periodEnd}T00:00:00Z`).getUTCDay(),
      );
    const historyFrom = addDays(input.periodStart, -30);
    const work = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollWorkDays")
        .withIndex("by_society_employee_date", (q) =>
          q
            .eq("societyId", args.societyId)
            .eq("employeeId", employeeId)
            .gte("date", historyFrom < firstSunday ? historyFrom : firstSunday)
            .lte("date", lastSaturday),
        ),
      101,
      "Daily work and wage history",
    );
    source.push({
      employee: {
        _id: employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        startDate: employee.startDate,
        endDate: employee.endDate,
        birthDate: employee.birthDate,
      },
      profiles,
      opening,
      work,
    });
    const ytd: PayrollDeductionYtd = normalizeZeroSplits(
        structuredClone(opening?.ytd ?? emptyPayrollYtd()),
      ),
      localBlockers: string[] = [],
      warnings: string[] = [];
    let priorCash = opening?.cashPaidCents ?? 0,
      priorNet = opening?.netPaidCents ?? 0,
      priorHours = opening?.insurableHours ?? 0,
      wcbBefore = opening?.workSafeAssessableCents ?? 0,
      vacationBalance = opening?.vacationBalanceCents ?? 0,
      sickPaid = opening?.sickPaidDaysUsed ?? 0,
      sickUnpaid = opening?.sickUnpaidDaysUsed ?? 0;
    const employeePrior: any[] = [];
    let vacationHistoryComplete = Boolean(opening);
    if (
      opening &&
      (opening.legalEmployerId !== args.societyId ||
        !opening.sameEmployerConfirmed ||
        opening.coveredThroughDate >= input.payDate)
    )
      localBlockers.push(
        "Employee opening must belong to this legal employer and precede the selected payment date.",
      );
    for (const run of pastRuns) {
      if (opening?.representedPayRunIds.includes(run._id)) continue;
      if (!run.lines?.length) {
        localBlockers.push(
          `Run ${run._id} has no employee identities. Reconcile it explicitly in this employee's opening or repair the import.`,
        );
        continue;
      }
      for (const line of run.lines.filter(
        (line: any) => line.employeeId === employeeId,
      )) {
        employeePrior.push({ run, line });
        if (
          line.vacationAccruedCents === undefined ||
          line.vacationPaidCents === undefined
        )
          vacationHistoryComplete = false;
        if (!line.deductionYtdDelta || !line.classifiedBases) {
          localBlockers.push(
            `Run ${run._id} is missing exact classified/YTD deduction history; include it in a confirmed opening instead of guessing bonus/CPP bases.`,
          );
          continue;
        }
        try {
          addYtd(ytd, line.deductionYtdDelta);
        } catch (error) {
          localBlockers.push(message(error));
        }
        priorCash = sum([priorCash, line.classifiedBases.cashCents]);
        priorNet = sum([priorNet, line.netCents]);
        if (line.insurableHours === undefined)
          warnings.push(
            `Recorded run ${run._id} has no actual insurable hours; ROE history remains incomplete.`,
          );
        else priorHours += line.insurableHours;
        wcbBefore = sum([wcbBefore, line.classifiedBases.workSafeCents]);
        vacationBalance = sum([
          vacationBalance,
          line.vacationAccruedCents ?? 0,
          -(line.vacationPaidCents ?? 0),
        ]);
        sickPaid += line.sickPaidDaysUsed ?? 0;
        sickUnpaid += line.sickUnpaidDaysUsed ?? 0;
      }
    }
    if (Object.values(ytd).some((value) => value < 0))
      localBlockers.push(
        "Recorded same-employer YTD becomes negative; reconcile dated reversals/openings.",
      );
    let profile: PayrollRow & EmployeeProfileFields;
    try {
      profile = profileAt(profiles, input.payDate);
    } catch (error) {
      preview.blockers.push(
        `${employee.firstName} ${employee.lastName}: ${message(error)}`,
      );
      continue;
    }
    if (!profile.ytdConfirmed)
      localBlockers.push(
        "Confirm complete same-employer payment-year history, including an explicit zero opening when there is no earlier pay.",
      );
    if (
      profile.provinceOfEmployment !== "BC" ||
      profile.employmentKind !== "ordinary"
    )
      localBlockers.push(
        "Native deductions support ordinary B.C. employment only; choose an approved provider for this employment policy/province.",
      );
    const selectedWork =
      input.runType === "bonus"
        ? []
        : work.filter(
            (w) => w.date >= input.periodStart && w.date <= input.periodEnd,
          );
    if (
      selectedWork.some(
        (w) =>
          w.postedCalculationId &&
          w.postedCalculationId !== excludeCalculationId,
      )
    )
      localBlockers.push(
        "Work in this period was already finalized. Use an explicit reversal/correction instead of paying it again.",
      );
    if (
      selectedWork.some(
        (w) => w.sickLeave && Number(w.date.slice(0, 4)) !== year,
      )
    )
      localBlockers.push(
        "Sick leave in a different work-calendar year needs that calendar year’s reviewed leave-bank history; a new payment-year zero opening cannot establish the earlier leave entitlement.",
      );
    if (
      (payout ||
        selectedWork.some((w) => w.paidVacationMinutes > 0) ||
        input.runType === "final") &&
      !vacationHistoryComplete
    )
      localBlockers.push(
        "Save a reviewed same-employer vacation money opening (including explicit zero), representing any prior sources with missing accrual/payout metadata, before paying/releasing that liability.",
      );
    for (const day of work.filter((w) => w.vacationRequestId)) {
      try {
        source.push({
          vacationRequest: await payrollWorkVacationSource(
            ctx,
            args.societyId,
            employeeId,
            day as any,
          ),
        });
      } catch (error) {
        localBlockers.push(message(error));
      }
    }
    if (
      payout?.treatment === "vacation_leave" &&
      profile.compensation !== "hourly"
    )
      localBlockers.push(
        "Salaried annual leave is already funded by fixed salary. Record paid vacation minutes and its source; a second vacation-leave cash payout would duplicate pay and insurable hours.",
      );
    if (
      payout?.treatment === "unused_cashout" &&
      ((payout.insurableMinutes ?? 0) !== 0 || payout.vacationRequestId)
    )
      localBlockers.push(
        "Unused vacation cashout does not create absence hours. Enter zero hours and a reviewed monetary source; do not link an annual-leave request.",
      );
    let payoutMinutes =
      payout?.treatment === "unused_cashout" ? 0 : payout?.insurableMinutes;

    let payoutDays: Array<{ date: string; minutes: number }> | undefined;
    if (payout?.vacationRequestId) {
      try {
        const request = await getOwned<PayrollRow>(
          ctx,
          "payrollVacationRequests",
          payout.vacationRequestId,
          args.societyId,
        );
        source.push({ payoutRequest: request });
        if (
          request.payrollPayoutCalculationId &&
          request.payrollPayoutCalculationId !== excludeCalculationId
        )
          throw new Error(
            "This actual vacation request was already funded/its hours recorded by a retained payroll payout. Use its retained payment or an explicit unpaid reversal/correction.",
          );
        for (const absence of request.days ?? []) {
          const work = await ctx.db
            .query<PayrollRow>("payrollWorkDays")
            .withIndex("by_society_employee_date", (q) =>
              q
                .eq("societyId", args.societyId)
                .eq("employeeId", employeeId)
                .eq("date", absence.date),
            )
            .first();
          if (
            work?.postedCalculationId &&
            work.paidVacationMinutes > 0 &&
            work.vacationRequestId === request._id
          )
            throw new Error(
              "This annual-leave request is already funded by finalized salary; a second vacation payout would duplicate cash/hours.",
            );
        }

        if (
          request.employeeId !== employeeId ||
          !["approved", "taken"].includes(request.status) ||
          !request.days?.length ||
          request.days.some(
            (d: any) => d.date < input.periodStart || d.date > input.periodEnd,
          )
        )
          throw new Error(
            "Vacation payout must link an owned approved/taken request for the same employee and covered absence dates.",
          );
        const minutes = request.days.reduce(
          (a: number, d: any) => a + d.minutes,
          0,
        );
        if (payoutMinutes !== undefined && payoutMinutes !== minutes)
          throw new Error(
            "Payout insurable minutes must match the actual approved/taken linked leave source.",
          );
        payoutMinutes = minutes;
        payoutDays = request.days;
      } catch (error) {
        localBlockers.push(message(error));
      }
    }
    const adjustments: ClassifiedEarning[] = [];
    for (const adjustment of input.adjustments?.filter(
      (a) => a.employeeId === employeeId,
    ) ?? []) {
      const code = await getOwned<PayrollRow>(
        ctx,
        "payrollEarningCodes",
        adjustment.earningCodeId,
        args.societyId,
      );
      source.push({ code });
      if (code.paymentKind === "vacation")
        localBlockers.push(
          "Use the explicit reviewed vacation liability payout controls for ordinary vacation money, so existing accrual is released once instead of charged again.",
        );
      if (!code.active)
        localBlockers.push(`Earning code ${code.code} is inactive.`);
      adjustments.push({
        date: adjustment.date,
        code: code.code,
        label: adjustment.label ?? code.name,
        amountCents: adjustment.amountCents,
        kind: code.paymentKind === "other" ? "regular" : code.paymentKind,
        ...code.classifications,
        classificationEvidence: code.classificationEvidence,
        ...(adjustment.hours !== undefined
          ? { minutes: Math.round(adjustment.hours * 60) }
          : {}),
        ...(adjustment.rateCents !== undefined
          ? { rateCents: adjustment.rateCents }
          : {}),
      });
    }
    const workDays: BcEarningsInput["workDays"] = [];
    for (const day of work.filter(
      (w) => input.runType !== "bonus" && w.date >= firstSunday,
    )) {
      try {
        const dayProfile = profileAt(profiles, day.date);
        if (
          dayProfile.compensation !== profile.compensation ||
          (profile.compensation !== "hourly" &&
            dayProfile.rateCents !== profile.rateCents)
        )
          localBlockers.push(
            "A salary/compensation change within this context requires a separately reviewed proration; split the effective payroll periods.",
          );
        workDays.push({
          date: day.date,
          minutes: day.minutes,
          hourlyRateCents:
            dayProfile.compensation === "hourly"
              ? dayProfile.rateCents
              : bcSalaryHourlyEquivalent({
                  basis: dayProfile.compensation,
                  amountCents: dayProfile.rateCents,
                  normalWeeklyMinutes: dayProfile.normalWeeklyMinutes,
                  averageWeeklyMinutes: dayProfile.averageWeeklyMinutes,
                }),
          holiday: day.holiday,
          sickLeave: day.sickLeave,
          paidVacationMinutes: day.paidVacationMinutes,
          salaryVacationSourceReference: day.salaryVacationSourceReference,
          restPremiumMinutes: day.restPremiumMinutes,
          salaryIncludedHolidayCents: day.salaryIncludedHolidayCents,
          salaryIncludedSickCents: day.salaryIncludedSickCents,
        });
      } catch (error) {
        localBlockers.push(message(error));
      }
    }
    for (const holiday of BC_STATUTORY_HOLIDAYS.filter(
      (d) =>
        input.runType !== "bonus" &&
        d >= input.periodStart &&
        d <= input.periodEnd &&
        d >= employee.startDate &&
        (!employee.endDate || d <= employee.endDate),
    ))
      if (!workDays.some((w) => w.date === holiday))
        workDays.push({
          date: holiday,
          minutes: 0,
          hourlyRateCents: profile.rateCents,
          holiday: true,
        });
    const retainedHistory = await retainedNativeWageHistory({
      employeeId,
      work,
      runs: historyRuns,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      load: loadFrozenWages,
    });
    source.push(...retainedHistory.sources);
    warnings.push(...retainedHistory.warnings);
    const history = retainedHistory.history;
    let earningsInput: BcEarningsInput = {
      mode: input.runType === "bonus" ? "adjustments_only" : "regular",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      employmentStartDate: employee.startDate,
      ...(employee.endDate ? { employmentEndDate: employee.endDate } : {}),
      policy: profile.policy,
      restPeriodsConfirmed: profile.restPeriodsConfirmed,
      context: {
        from: firstSunday,
        to: lastSaturday,
        complete:
          profile.historyCompleteFrom <= firstSunday &&
          profile.historyCompleteThrough >= lastSaturday,
      },
      workDays,
      history,
      historyCompleteFrom: profile.historyCompleteFrom,
      vacation: {
        mode: profile.vacationMode,
        ratePercent: profile.vacationRatePercent,
        eachChequeAgreementConfirmed:
          profile.vacationEachChequeAgreementConfirmed,
      },
      sickBank: {
        year: Number(input.periodStart.slice(0, 4)),
        paidDaysUsed: sickPaid,
        unpaidDaysUsed: sickUnpaid,
      },
      additionalEarnings: adjustments,
      ...(profile.fifthYearVacationReconciliation
        ? {
            fifthYearVacationReconciliation:
              profile.fifthYearVacationReconciliation,
          }
        : {}),
    };
    if (
      profile.compensation !== "hourly" &&
      employer &&
      input.runType !== "bonus"
    ) {
      const calendar = bcSalaryCalendarBounds({
        periodStart: input.periodStart,
        payPeriodsPerYear: employer.payDates.length,
      });
      const activeFrom =
          employee.startDate > input.periodStart
            ? employee.startDate
            : input.periodStart,
        activeTo =
          employee.endDate && employee.endDate < input.periodEnd
            ? employee.endDate
            : input.periodEnd,
        periodDays =
          Math.round(
            (Date.parse(calendar.calendarPeriodEnd) -
              Date.parse(calendar.calendarPeriodStart)) /
              DAY,
          ) + 1,
        activeDays = Math.max(
          0,
          Math.round((Date.parse(activeTo) - Date.parse(activeFrom)) / DAY) + 1,
        ),
        salaryNumerator =
          BigInt(profile.rateCents) *
          BigInt(profile.compensation === "monthly" ? 12 : 1) *
          BigInt(activeDays),
        salaryDenominator = BigInt(employer.payDates.length * periodDays);
      const periodSalary = Number(
        (salaryNumerator * 2n + salaryDenominator) / (salaryDenominator * 2n),
      );
      if (selectedWork.some((w) => w.paidVacationMinutes > 0))
        earningsInput.salaryVacationLiability = {
          availableAccruedCents: Math.max(0, vacationBalance),
          sourceEvidence:
            opening?.sourceReference ??
            "Reviewed retained same-employer vacation liability history",
        };
      earningsInput.salary = {
        basis: profile.compensation,
        amountCents: profile.rateCents,
        normalWeeklyMinutes: profile.normalWeeklyMinutes,
        averageWeeklyMinutes: profile.averageWeeklyMinutes,
        periodSalaryCents: periodSalary,
        payPeriodsPerYear: employer.payDates.length as 24 | 26 | 27 | 52 | 53,
        calendarConfirmed: true,
        ...calendar,
        proration: profile.salaryProration,
        coveredStraightTimeMinutes: bcSalaryCoverageMinutes({
          workDays,
          normalWeeklyMinutes: profile.normalWeeklyMinutes,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          excludedDates: workDays
            .filter((w) => (w.salaryIncludedHolidayCents ?? 0) > 0)
            .map((w) => w.date),
        }),
      };
      warnings.push(
        "Salary coverage uses recorded non-holiday worked minutes and explicit salary leave credits; review the frozen input before approval.",
      );
    }
    if (payout)
      earningsInput.vacationLiabilityPayout = {
        amountCents: payout.amountCents,
        availableAccruedCents: Math.max(0, vacationBalance),
        sourceEvidence: payout.sourceReference,
        treatment: payout.treatment,
      };
    let historyCalculation = calculateEarningsWithNativeHistory(
      earningsInput,
      retainedHistory,
      work,
    );
    earningsInput = historyCalculation.input;
    let earnings = historyCalculation.earnings;
    if (input.runType === "final") {
      if (!input.termination)
        localBlockers.push(
          "Final payroll requires termination timestamp and initiating party to verify final-pay deadlines.",
        );
      if (!employee.endDate)
        localBlockers.push(
          "Record the actual employment end date before calculating final vacation settlement.",
        );
      if (vacationBalance < 0)
        localBlockers.push(
          "Reconcile the negative recorded vacation liability before final pay.",
        );
      earningsInput.finalVacationPayout = {
        priorAccruedCents: Math.max(0, vacationBalance),
        sourceEvidence:
          opening?.sourceReference ??
          "Reviewed retained same-employer native accrual/pay-run history",
      };
      historyCalculation = calculateEarningsWithNativeHistory(
        earningsInput,
        retainedHistory,
        work,
      );
      earningsInput = historyCalculation.input;
      earnings = historyCalculation.earnings;
    }
    const priorVacationReleased =
        earnings.priorVacationLiabilityReleasedCents ?? 0,
      currentVacationPaid = earnings.currentVacationPaidCents ?? 0;
    localBlockers.push(...historyCalculation.blockers, ...earnings.blockers);
    warnings.push(...earnings.warnings);
    const result: PayrollCalculatedEmployee = {
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      provinceOfEmployment: profile.provinceOfEmployment,
      profileId: profile._id,
      earnings,
      earningsInput,
      wageHistoryProvenance: historyCalculation.proof,
      openingId: opening?._id,
      ytdBefore: ytd,
      workDayIds: selectedWork.map((w) => w._id),
      vacationBalanceBeforeCents: vacationBalance,
      vacationBalanceComplete: vacationHistoryComplete,
      priorVacationLiabilityReleasedCents: priorVacationReleased,
      currentVacationPaidCents: currentVacationPaid,
      warnings,
      blockers: localBlockers,
    };
    if (employer && !localBlockers.length && !preview.blockers.length)
      try {
        if (profile.cpp.exempt)
          throw new Error(
            "A manual CPP exemption cannot override dated eligibility. Record birth date and effective CPT30/disability events; other nonpensionable employment requires a reviewed policy.",
          );
        if (!employee.birthDate)
          throw new Error(
            "Record the employee birth date in the protected employee record to establish CPP eligibility.",
          );
        const perRunCost = input.employerCostOverrides?.find(
          (c) => c.employeeId === employeeId,
        );
        const priorOrdinarySamePeriod = employeePrior.some(
          (p) =>
            !p.run.reversedDate &&
            p.run.source !== "native_reversal" &&
            p.run.periodStart === input.periodStart &&
            p.run.periodEnd === input.periodEnd &&
            p.line.deductionYtdDelta?.regularTaxableCents > 0,
        );
        const chargeRecurringBenefits =
          input.runType !== "bonus" &&
          !priorOrdinarySamePeriod &&
          (input.runType === "regular" ||
            selectedWork.some(
              (w) =>
                w.minutes > 0 ||
                w.paidVacationMinutes > 0 ||
                w.sickLeave === "paid",
            ) ||
            (earningsInput.salary?.periodSalaryCents ?? 0) > 0);
        const employeeEmployerTerms = payrollEmployeeEmployerTerms(
          employer,
          profile,
          {
            benefits:
              chargeRecurringBenefits &&
              perRunCost?.benefitsCents === undefined,
            pension: perRunCost?.pensionCents === undefined,
          },
        );
        const ehtLocation = payrollEmployeeEhtLocation(
          employer,
          profile,
          locationHistory!,
          employeeId,
        );
        if (ehtLocation) {
          result.ehtLocationId = ehtLocation.id;
          result.ehtAttributionBasis =
            profile.ehtAttributionBasis ?? "primary_reporting";
          result.ehtAttributionEvidence =
            profile.ehtAttributionEvidence ?? ehtLocation.evidence;
        }
        const cpp = deriveCppEligibility({
          payDate: input.payDate,
          birthDate: employee.birthDate,
          elections: profile.cpp.elections,
          disabilityPeriods: profile.cpp.disabilityPeriods,
        });
        const matchingRegular = employeePrior
          .filter(
            (p) =>
              p.run.periodStart === input.periodStart &&
              p.run.periodEnd === input.periodEnd &&
              p.run.source !== "native_reversal" &&
              !p.run.reversedDate &&
              p.line.deductionYtdDelta?.regularTaxableCents > 0,
          )
          .at(-1)?.run;
        const applicableRegularDate =
          explicitRegularDate ??
          (employer.payDates.includes(input.payDate)
            ? input.payDate
            : (correctedRegularPayDate ?? matchingRegular?.payDate));
        if (
          !applicableRegularDate ||
          !employer.payDates.includes(applicableRegularDate)
        )
          throw new Error(
            "Select the applicable regular pay date from the reviewed annual calendar for this off-cycle/final payment; the CRA pay-period number cannot be inferred from an early actual payment date.",
          );
        const periodNumber =
          employer.payDates.indexOf(applicableRegularDate) + 1;
        const previous = employeePrior
          .filter(
            (p) =>
              p.line.deductionYtdDelta?.regularTaxableCents > 0 &&
              p.run.source !== "native_reversal" &&
              !p.run.reversedDate,
          )
          .at(-1)?.line;
        if (
          input.runType === "bonus" &&
          previous &&
          !previous.regularClassifiedBases &&
          previous.deductionYtdDelta.bonusTaxableCents > 0
        )
          throw new Error(
            "The prior mixed regular/bonus run has no separate regular cash basis. Supply an exact provider reconciliation before calculating another bonus.",
          );
        const resolvedTd1 = await resolvePayrollTd1Portable(ctx, {societyId: args.societyId, employeeId: employee._id, payDate: input.payDate, baseTd1: profile.td1, baseDeductions: profile.deductions});
        source.push({employeeId: employee._id, td1Declarations: resolvedTd1.sourceDeclarations});
        if (resolvedTd1.sourceDeclarations.length) result.td1Declarations = resolvedTd1.sourceDeclarations;
        const deductions = calculatePayrollDeductions({
          payDate: input.payDate,
          provinceOfEmployment: profile.provinceOfEmployment,
          method: input.method,
          payPeriodsPerYear: employer.payDates.length,
          periodNumber,
          regular: earnings.regularBases,
          bonus: earnings.bonusBases,
          ...(previous
            ? {
                previousRegular: {
                  cashCents:
                    previous.regularClassifiedBases?.cashCents ??
                    previous.classifiedBases.cashCents,
                  taxableCents: previous.deductionYtdDelta.regularTaxableCents,
                  pensionableCents:
                    previous.deductionYtdDelta.regularPensionableCents,
                  insurableCents:
                    previous.deductionYtdDelta.regularInsurableCents,
                },
              }
            : {}),
          ytd,
          ytdConfirmed: profile.ytdConfirmed,
          td1: resolvedTd1.td1,
          cpp,
          ei: {
            exempt: profile.eiExempt,
            employerMultiplier: employeeEmployerTerms.eiEmployerMultiplier,
            reducedRateEvidence: employeeEmployerTerms.reducedEiRateEvidence,
          },
          deductions: resolvedTd1.deductions,
          ytdEmployerMatches: true,
          employmentKind: profile.employmentKind,
        }, selectedRule ? {rateSet: selectedRule.rateSet, ruleEdition: {id: selectedRule.provenance.id, version: selectedRule.provenance.version, sourceReferences: selectedRule.provenance.sourceEvidence.map(item => item.url)}} : undefined);
        result.deductions = deductions;
        result.ytdAfter = deductions.closingYtd;
        warnings.push(...deductions.warnings);
        const taxableTrueBonus = earnings.lines
          .filter((l) => l.kind === "bonus" && l.taxable)
          .reduce((a, l) => a + l.amountCents, 0);
        if (
          perRunCost?.pensionCents === undefined &&
          employeeEmployerTerms.pensionPercent > 0 &&
          taxableTrueBonus > 0 &&
          employeeEmployerTerms.pensionBonusEligible === undefined
        )
          throw new Error(
            "Review whether the actual pension plan includes bonus remuneration, or enter this run’s actual reviewed pension cost.",
          );
        const pensionBase =
          earnings.bases.taxableCents -
          (employeeEmployerTerms.pensionBonusEligible === false
            ? taxableTrueBonus
            : 0);
        const employerCostInput = {
          earnings: earnings.bases,
          priorVacationLiabilityReleasedCents: priorVacationReleased,
          vacationAccruedCents: earnings.vacationAccruedCents,
          employerCppCents: deductions.cppEmployerCents,
          employerCpp2Cents: deductions.cpp2EmployerCents,
          employerEiCents: deductions.eiEmployerCents,
          benefitsCents:
            perRunCost?.benefitsCents ??
            (chargeRecurringBenefits
              ? employeeEmployerTerms.benefitsCentsPerPay
              : 0),
          pensionCents:
            perRunCost?.pensionCents ??
            payrollPercentage(
              pensionBase,
              employeeEmployerTerms.pensionPercent,
            ),
          benefitsAlreadyInEarningsCents:
            perRunCost?.benefitsAlreadyInEarningsCents ??
            (perRunCost?.benefitsCents !== undefined
              ? 0
              : chargeRecurringBenefits
                ? employeeEmployerTerms.benefitsAlreadyInEarningsCentsPerPay
                : 0),
          pensionAlreadyInEarningsCents:
            perRunCost?.pensionAlreadyInEarningsCents ??
            (perRunCost?.pensionCents !== undefined
              ? 0
              : employeeEmployerTerms.pensionAlreadyInEarningsCentsPerPay),
          workSafe: {
            netRatePercent: employer.workSafeRatePer100Dollars,
            annualAssessableLimitCents: employer.workSafeAssessableLimitCents,
            ytdAssessableCents: wcbBefore,
            rateEvidence: employer.workSafeRateEvidence,
          },
          eht: {
            kind: employer.ehtEmployerClass,
            year,
            qualificationEvidence: employer.ehtQualificationEvidence,
            permanentEstablishmentDays: employer.ehtPermanentEstablishmentDays,
            associated: employer.ehtAssociated,
            allocatedExemptionCents: employer.ehtExemptionAllocationCents,
            allocationEvidence: employer.ehtAllocationEvidence,
            associatedGroupRemunerationCents:
              employer.ehtAssociatedGroupRemunerationCents === undefined
                ? undefined
                : employer.ehtAssociatedGroupRemunerationCents +
                  (ehtBefore - employer.ehtOpeningRemunerationCents) +
                  currentEht,
            associatedGroupPermanentEstablishmentDays:
              employer.associatedGroupPermanentEstablishmentDays,
            location: ehtLocation ?? employer.ehtLocation,
            annualBcRemunerationBeforeCents: ehtLocation
              ? (locationHistory!.before.get(ehtLocation.id) ?? 0) +
                (currentLocationRemuneration.get(ehtLocation.id) ?? 0)
              : ehtBefore + currentEht,
          },
        };
        result.employerCostInput = employerCostInput;
        result.employerCosts = calculateBcEmployerCosts(employerCostInput);
        localBlockers.push(...result.employerCosts.blockers);
        warnings.push(...result.employerCosts.warnings);
        currentEht += earnings.bases.ehtCents;
        if (ehtLocation)
          currentLocationRemuneration.set(
            ehtLocation.id,
            (currentLocationRemuneration.get(ehtLocation.id) ?? 0) +
              earnings.bases.ehtCents,
          );
        if (!result.employerCosts.blockers.length)
          result.allocations = allocatePayrollEmployerCosts({
            costs: result.employerCosts,
            allocations: profile.fundingAllocations?.length
              ? profile.fundingAllocations
              : [{ label: "General operations", shareBps: 10000 }],
          }).rows;
        const other =
          deductions.totalDeductionsCents -
          deductions.cppEmployeeCents -
          deductions.cpp2EmployeeCents -
          deductions.eiEmployeeCents -
          deductions.incomeTaxCents;
        const hours =
          (earnings.minutes.regular +
            earnings.minutes.overtime15 +
            earnings.minutes.overtime2 +
            selectedWork.reduce(
              (a, w) =>
                a + (w.insurablePaidLeaveMinutes ?? w.paidVacationMinutes ?? 0),
              0,
            )) /
          60;
        const alreadyIncludedPayoutMinutes =
          payoutDays?.reduce(
            (a, day) =>
              a +
              Math.min(
                day.minutes,
                selectedWork.find((w) => w.date === day.date)
                  ?.insurablePaidLeaveMinutes ?? 0,
              ),
            0,
          ) ?? 0;
        if (
          payoutMinutes &&
          payout?.treatment === "vacation_leave" &&
          !payoutDays &&
          selectedWork.some((w) => (w.insurablePaidLeaveMinutes ?? 0) > 0)
        )
          throw new Error(
            "This payout’s undated leave hours overlap possible inclusive workday paid-leave hours. Link the approved/taken request to reconcile dates, or keep one actual hours source.",
          );
        result.insurableHours =
          hours + ((payoutMinutes ?? 0) - alreadyIncludedPayoutMinutes) / 60;
        result.insurableHoursComplete =
          !(payout && payoutMinutes === undefined) &&
          !earnings.lines.some(
            (l) =>
              (l.kind === "holiday" || l.kind === "sick") &&
              l.insurable &&
              l.amountCents > 0 &&
              selectedWork.find((w) => w.date === l.date)
                ?.insurablePaidLeaveMinutes === undefined,
          );
        if (!result.insurableHoursComplete)
          warnings.push(
            "Paid-leave insurable hours were not supplied; ROE requires reviewed actual hours, not an amount-derived estimate.",
          );
        if (!localBlockers.length)
          result.statement = validatePayrollStatement({
            schemaVersion: 1,
            calculationId: "preview",
            calculationVersion: 1,
            statementNumber: `PREVIEW-${employeeId.slice(-8)}`,
            status: "draft",
            employer: { name: organization.name },
            employee: {
              employeeId,
              name: result.employeeName,
              provinceOfEmployment: profile.provinceOfEmployment,
            },
            currency: "CAD",
            ...input,
            earnings: earnings.lines.map(
              (l, i) =>
                ({
                  key: `earning-${i}`,
                  label: l.label,
                  code: l.code,
                  date: l.date,
                  ...(l.minutes === undefined ? {} : { hours: l.minutes / 60 }),
                  ...(l.rateCents === undefined
                    ? {}
                    : { rateCents: l.rateCents }),
                  amountCents: l.amountCents,
                  ...Object.fromEntries(
                    [
                      "cash",
                      "taxable",
                      "pensionable",
                      "insurable",
                      "vacationable",
                      "eht",
                      "workSafe",
                    ].map((k) => [
                      `${k}Cents`,
                      l[k as keyof ClassifiedEarning] ? l.amountCents : 0,
                    ]),
                  ),
                }) as any,
            ),
            totals: {
              grossCents: earnings.bases.taxableCents,
              taxableCents: earnings.bases.taxableCents,
              cashCents: earnings.bases.cashCents,
              ...splitAmounts(earnings.lines),
              cppEmployeeCents: deductions.cppEmployeeCents,
              cpp2EmployeeCents: deductions.cpp2EmployeeCents,
              eiEmployeeCents: deductions.eiEmployeeCents,
              federalTaxCents: deductions.federalTaxCents,
              provincialTaxCents: deductions.provincialTaxCents,
              additionalIncomeTaxCents: deductions.additionalIncomeTaxCents,
              incomeTaxCents: deductions.incomeTaxCents,
              otherDeductionsCents: other,
              netCents: deductions.netCashCents,
              cppEmployerCents: deductions.cppEmployerCents,
              cpp2EmployerCents: deductions.cpp2EmployerCents,
              eiEmployerCents: deductions.eiEmployerCents,
              employerCostCents: result.employerCosts.totalEmployerCostCents,
            },
            otherDeductions: other
              ? [
                  {
                    label:
                      "Registered plans, union dues, maintenance and other authorized deductions",
                    amountCents: other,
                  },
                ]
              : [],
            employerCosts: [
              ...(priorVacationReleased
                ? [
                    {
                      label:
                        "Previously accrued vacation liability released (not a new expense)",
                      amountCents: -priorVacationReleased,
                    },
                  ]
                : []),
              {
                label: "Vacation accrual",
                amountCents: result.employerCosts.vacationAccrualCents,
              },
              {
                label: "WorkSafeBC",
                amountCents: result.employerCosts.workSafeCents,
              },
              {
                label: "Employer health tax",
                amountCents: result.employerCosts.ehtCents,
              },
              {
                label: "Employer benefits",
                amountCents: result.employerCosts.benefitsCents,
              },
              {
                label: "Employer pension",
                amountCents: result.employerCosts.pensionCents,
              },
            ],
            yearToDate: {
              year,
              grossCents:
                deductions.closingYtd.regularTaxableCents +
                deductions.closingYtd.bonusTaxableCents,
              taxableCents:
                deductions.closingYtd.regularTaxableCents +
                deductions.closingYtd.bonusTaxableCents,
              cashCents: priorCash + earnings.bases.cashCents,
              cppEmployeeCents: deductions.closingYtd.cppCents,
              cpp2EmployeeCents: deductions.closingYtd.cpp2Cents,
              eiEmployeeCents: deductions.closingYtd.eiCents,
              incomeTaxCents:
                deductions.closingYtd.regularTaxCents +
                deductions.closingYtd.bonusTaxCents +
                deductions.closingYtd.additionalTaxCents,
              netCents: priorNet + deductions.netCashCents,
              pensionableCents:
                deductions.closingYtd.regularPensionableCents +
                deductions.closingYtd.bonusPensionableCents,
              insurableCents:
                deductions.closingYtd.regularInsurableCents +
                deductions.closingYtd.bonusInsurableCents,
              ...(result.insurableHoursComplete &&
              !warnings.some((w) => w.includes("no actual insurable hours"))
                ? { insurableHours: priorHours + result.insurableHours! }
                : {}),
            },
            rules: {
              edition: deductions.ruleSet.id,
              method: input.method,
              sources: [
                ...earnings.sources.map((s) => s.url),
                ...deductions.ruleSet.sources.map((s: any) =>
                  typeof s === "string" ? s : s.url,
                ),
                ...(deductions.ruleEdition?.sourceReferences ?? []),
              ],
              explanations: deductions.explanations.map(
                (e) => `${e.factor}: ${e.label} (${e.formula})`,
              ),
            },
            warnings,
          });
        const totals = preview.totals;
        totals.taxableCents += earnings.bases.taxableCents;
        totals.cashCents += earnings.bases.cashCents;
        for (const key of [
          "cppEmployeeCents",
          "cpp2EmployeeCents",
          "eiEmployeeCents",
          "incomeTaxCents",
          "cppEmployerCents",
          "cpp2EmployerCents",
          "eiEmployerCents",
        ] as const)
          totals[key] += deductions[key];
        totals.otherDeductionsCents += other;
        totals.netCents += deductions.netCashCents;
        totals.employerCostCents += result.employerCosts.totalEmployerCostCents;
        preview.rules.editions.push(deductions.ruleSet.id);
        preview.rules.sources.push(...earnings.sources.map((s) => s.url), ...deductions.ruleSet.sources.map((s: any) => typeof s === "string" ? s : s.url), ...(deductions.ruleEdition?.sourceReferences ?? []));
      } catch (error) {
        localBlockers.push(message(error));
      }
    preview.employees.push(result);
    preview.blockers.push(
      ...localBlockers.map((b) => `${result.employeeName}: ${b}`),
    );
  }
  if (employer && locationHistory)
    try {
      preview.ehtReconciliation = payrollEhtReconciliation(
        employer,
        locationHistory,
        currentLocationRemuneration,
      );
    } catch (error) {
      preview.blockers.push(message(error));
    }
  preview.rules.editions = [...new Set(preview.rules.editions)];
  preview.rules.sources = [...new Set(preview.rules.sources)];
  preview.blockers = [...new Set(preview.blockers)];
  preview.sourceFingerprint = await payrollFingerprint({
    sources: source,
    rulesVersion: BC_EARNINGS_RULES_VERSION,
    editions: preview.rules.editions,
  });
  payrollJson(preview, 750000);
  return preview;
}
