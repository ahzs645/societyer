import type {
  EmployeeProfileFields,
  EmployerSettingsFields,
  PayrollEhtLocationOpening,
  PayrollEhtReconciliation,
  PayrollEmployerOverrides,
} from "./payrollCalculation";
import { calculateBcEmployerHealthTax } from "./payrollEarnings";
type PayrollRow = { _id: string; [key: string]: any };
export function payrollEhtLocations(
  employer: EmployerSettingsFields,
): PayrollEhtLocationOpening[] {
  return employer.ehtLocations?.length
    ? employer.ehtLocations
    : employer.ehtLocation
      ? [
          {
            ...employer.ehtLocation,
            openingRemunerationCents: employer.ehtOpeningRemunerationCents,
            openingSourceReference: employer.ehtOpeningSourceReference,
          },
        ]
      : [];
}
export function payrollLocationHistory(
  employer: EmployerSettingsFields,
  runs: PayrollRow[],
) {
  const locations = payrollEhtLocations(employer),
    before = new Map(locations.map((l) => [l.id, l.openingRemunerationCents])),
    blockers: string[] = [],
    employeeLocations = new Map<string, Set<string>>();
  if (employer.ehtEmployerClass !== "charitable_nonprofit" || !locations.length)
    return { locations, before, blockers, employeeLocations };
  if (!locations.some((l) => l.qualifying))
    blockers.push(
      "At least one evidenced qualifying physical nonprofit EHT location is required.",
    );
  const qualifying = locations.filter((l) => l.qualifying);
  for (const run of runs) {
    if (employer.ehtOpeningRepresentedPayRunIds.includes(run._id)) continue;
    if (!run.lines?.length) {
      blockers.push(
        `Run ${run._id} has no employee/location attribution. Reconcile it in the reviewed per-location employer opening.`,
      );
      continue;
    }
    for (const line of run.lines) {
      const amount = line.classifiedBases?.ehtCents;
      if (!Number.isSafeInteger(amount)) {
        blockers.push(`Run ${run._id} has no exact EHT remuneration basis.`);
        continue;
      }
      if (!amount) continue;
      const id =
        line.ehtLocationId ??
        (qualifying.length === 1 ? qualifying[0].id : undefined);
      if (
        !id ||
        !before.has(id) ||
        !locations.find((l) => l.id === id)?.qualifying
      ) {
        blockers.push(
          `Run ${run._id} has unattributed/nonqualifying-location remuneration. Supply explicit per-location opening balances representing this source instead of inferring from current staff or programs.`,
        );
        continue;
      }
      before.set(id, (before.get(id) ?? 0) + amount);
      if (
        line.employeeId &&
        run.source !== "native_reversal" &&
        !run.reversedDate
      ) {
        const ids = employeeLocations.get(line.employeeId) ?? new Set<string>();
        ids.add(id);
        employeeLocations.set(line.employeeId, ids);
      }
    }
  }
  for (const [id, amount] of before)
    if (!Number.isSafeInteger(amount) || amount < 0)
      blockers.push(
        `Location ${id} has invalid signed/opening remuneration; reconcile actual dated sources.`,
      );
  return { locations, before, blockers, employeeLocations };
}
export function payrollEmployeeEhtLocation(
  employer: EmployerSettingsFields,
  profile: EmployeeProfileFields,
  history: ReturnType<typeof payrollLocationHistory>,
  employeeId: string,
) {
  const qualifying = history.locations.filter((l) => l.qualifying);
  if (
    employer.ehtEmployerClass !== "charitable_nonprofit" ||
    !history.locations.length
  )
    return undefined;
  const id =
      profile.ehtLocationId ??
      (qualifying.length === 1 ? qualifying[0].id : undefined),
    location = qualifying.find((l) => l.id === id);
  if (!location)
    throw new Error(
      "Select the employee’s actual primary annual qualifying reporting location, or an evidenced reasonable attribution to a qualifying location; grants and departments cannot create exemptions.",
    );
  if (
    qualifying.length > 1 &&
    (!profile.ehtAttributionBasis || !profile.ehtAttributionEvidence)
  )
    throw new Error(
      "Confirm this employee’s actual primary annual physical reporting location and attribution evidence.",
    );
  const historic = history.employeeLocations.get(employeeId);
  if (historic && [...historic].some((previous) => previous !== id))
    throw new Error(
      "The employee’s annual EHT location differs from recorded history. Review/restate all affected YTD remuneration through explicit per-location opening balances representing those runs before changing annual attribution.",
    );
  return location;
}
export function payrollEhtReconciliation(
  employer: EmployerSettingsFields,
  history: ReturnType<typeof payrollLocationHistory>,
  current: Map<string, number>,
): PayrollEhtReconciliation | undefined {
  if (
    employer.ehtEmployerClass !== "charitable_nonprofit" ||
    !history.locations.length
  )
    return undefined;
  const locations = history.locations
    .filter((l) => l.qualifying)
    .map((l) => {
      const beforeCents = history.before.get(l.id) ?? 0,
        currentCents = current.get(l.id) ?? 0;
      const tax = (amount: number) =>
        calculateBcEmployerHealthTax({
          kind: "charitable_nonprofit",
          year: employer.year,
          qualificationEvidence: employer.ehtQualificationEvidence,
          permanentEstablishmentDays: employer.ehtPermanentEstablishmentDays,
          location: l,
          annualBcRemunerationCents: amount,
        }).taxCents;
      const taxBeforeCents = tax(beforeCents),
        taxAfterCents = tax(beforeCents + currentCents);
      return {
        ...l,
        beforeCents,
        currentCents,
        afterCents: beforeCents + currentCents,
        taxBeforeCents,
        taxAfterCents,
        taxDeltaCents: taxAfterCents - taxBeforeCents,
      };
    });
  return {
    locations,
    taxDeltaCents: locations.reduce((a, l) => a + l.taxDeltaCents, 0),
    complete: history.blockers.length === 0,
    warnings: history.blockers,
  };
}
export function payrollEmployeeEmployerTerms(
  employer: EmployerSettingsFields,
  profile: EmployeeProfileFields,
  recurring: { benefits: boolean; pension: boolean } = {
    benefits: true,
    pension: true,
  },
) {
  const o: PayrollEmployerOverrides | undefined = profile.employerOverrides;
  const needsUniform =
    (o?.eiEmployerMultiplier === undefined &&
      employer.eiEmployerMultiplier !== 1.4) ||
    (recurring.benefits &&
      o?.benefitsCentsPerPay === undefined &&
      employer.employerBenefitsCentsPerPay !== 0) ||
    (recurring.pension &&
      o?.pensionPercent === undefined &&
      employer.employerPensionPercent !== 0) ||
    (recurring.benefits &&
      o?.benefitsCentsPerPay === undefined &&
      o?.benefitsAlreadyInEarningsCentsPerPay === undefined &&
      (employer.benefitsAlreadyInEarningsCentsPerPay ?? 0) !== 0) ||
    (recurring.pension &&
      o?.pensionPercent === undefined &&
      o?.pensionAlreadyInEarningsCentsPerPay === undefined &&
      (employer.pensionAlreadyInEarningsCentsPerPay ?? 0) !== 0);
  if (needsUniform && !employer.uniformEmployerAssumptionsConfirmed)
    throw new Error(
      "Review uniform employer EI coverage and actual benefit/pension assumptions, or enter this employee’s actual covered-group/cost override. A reduced multiplier cannot silently cover unreviewed staff.",
    );
  return {
    eiEmployerMultiplier:
      o?.eiEmployerMultiplier ?? employer.eiEmployerMultiplier,
    reducedEiRateEvidence:
      o?.eiEmployerMultiplier === undefined
        ? employer.reducedEiRateEvidence
        : o.reducedEiRateEvidence,
    benefitsCentsPerPay:
      o?.benefitsCentsPerPay ?? employer.employerBenefitsCentsPerPay,
    pensionPercent: o?.pensionPercent ?? employer.employerPensionPercent,
    pensionBonusEligible:
      o?.pensionBonusEligible ?? employer.employerPensionBonusEligible,
    benefitsAlreadyInEarningsCentsPerPay:
      o?.benefitsAlreadyInEarningsCentsPerPay ??
      (o?.benefitsCentsPerPay !== undefined
        ? 0
        : employer.benefitsAlreadyInEarningsCentsPerPay),
    pensionAlreadyInEarningsCentsPerPay:
      o?.pensionAlreadyInEarningsCentsPerPay ??
      (o?.pensionPercent !== undefined
        ? 0
        : employer.pensionAlreadyInEarningsCentsPerPay),
  };
}
export function payrollPercentage(cents: number, percent: number) {
  const raw = String(percent),
    match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match)
    throw new Error(
      "Employer pension percentages support at most six decimal places.",
    );
  const numerator = BigInt(cents) * BigInt(match[1] + (match[2] ?? "")),
    denominator = 100n * 10n ** BigInt(match[2]?.length ?? 0);
  const result = Number((numerator * 2n + denominator) / (denominator * 2n));
  if (!Number.isSafeInteger(result))
    throw new Error("Employer pension cost exceeds safe integer cents.");
  return result;
}
