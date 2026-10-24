import { emptyPayrollYtd, type PayrollDeductionYtd } from "./payrollDeductions";
import type {
  CalculationInput,
  EarningCodeFields,
  EmployeeProfileFields,
  EmployerSettingsFields,
  OpeningBalanceFields,
  WorkDayFields,
} from "./payrollCalculation";

export function payrollObject(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Enter valid payroll fields.");
  return raw as Record<string, any>;
}
export function payrollText(
  raw: unknown,
  name: string,
  max = 200,
  optional = false,
): string {
  if (optional && (raw == null || raw === "")) return "";
  if (typeof raw !== "string" || !raw.trim() || raw.length > max)
    throw new Error(`${name} must contain 1–${max} characters.`);
  return raw.trim();
}
export function payrollDate(raw: unknown, name = "Date"): string {
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    !Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ||
    new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw
  )
    throw new Error(`${name} must be an exact calendar date.`);
  return raw;
}
export function payrollInteger(
  raw: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
  signed = false,
): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    (!signed && raw < 0) ||
    Math.abs(raw) > maximum
  )
    throw new Error(
      `${name} must be supported integer${name.toLowerCase().includes("cents") ? " cents" : " values"}.`,
    );
  return raw;
}
export function payrollNumber(
  raw: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < 0 ||
    raw > maximum
  )
    throw new Error(`${name} must be a number between zero and ${maximum}.`);
  return raw;
}
export function payrollBoolean(raw: unknown, name: string): boolean {
  if (typeof raw !== "boolean") throw new Error(`Confirm ${name} explicitly.`);
  return raw;
}
function choice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof raw !== "string" || !allowed.includes(raw as T))
    throw new Error(`Choose a supported ${name}.`);
  return raw as T;
}
function optionalText(raw: unknown, name: string, max = 4000) {
  return payrollText(raw, name, max, true) || undefined;
}
function optionalDate(raw: unknown, name: string) {
  return raw == null || raw === "" ? undefined : payrollDate(raw, name);
}
function optionalCents(raw: unknown, name: string) {
  return raw == null ? undefined : payrollInteger(raw, `${name} cents`);
}
export function payrollYear(raw: unknown) {
  const year = payrollInteger(raw, "Payment year", 2100);
  if (year < 2024)
    throw new Error(
      "Record a supported payment year (2024–2100); native rate coverage is checked separately.",
    );
  return year;
}
function idList(raw: unknown, name: string, max: number): string[] {
  if (!Array.isArray(raw) || raw.length > max)
    throw new Error(`${name} supports at most ${max} records.`);
  const result = raw.map((id) => payrollText(id, name, 1000));
  if (new Set(result).size !== result.length)
    throw new Error(`${name} contains duplicate records.`);
  return result;
}
function defined<T>(value: T): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, field]) => field !== undefined,
    ),
  ) as T;
}
export function payrollJson(value: unknown, max = 700000): string {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > max)
    throw new Error(
      `The payroll snapshot exceeds ${max.toLocaleString("en-CA")} UTF-8 bytes. Calculate a smaller employee batch.`,
    );
  return json;
}

export function cleanPayrollEmployer(raw: unknown): EmployerSettingsFields {
  const row = payrollObject(raw),
    year = payrollYear(row.year),
    payFrequency = choice(
      row.payFrequency,
      ["weekly", "biweekly", "semimonthly", "monthly"] as const,
      "pay frequency",
    );
  const payDates = idList(row.payDates, "Annual regular pay calendar", 54)
    .map((day) => payrollDate(day, "Pay calendar date"))
    .sort();
  if (payDates.some((date) => Number(date.slice(0, 4)) !== year))
    throw new Error(
      "Every regular pay date must belong to the employer schedule year.",
    );
  const counts = {
    weekly: [52, 53],
    biweekly: [26, 27],
    semimonthly: [24],
    monthly: [12],
  }[payFrequency];
  if (!counts.includes(payDates.length))
    throw new Error(
      `Record the complete ${counts.join(" or ")}-date annual regular pay calendar; off-cycle runs do not change its count.`,
    );
  const monthlyCounts = Array.from(
    { length: 12 },
    (_, month) =>
      payDates.filter((date) => Number(date.slice(5, 7)) === month + 1).length,
  );
  if (
    payFrequency === "semimonthly" &&
    monthlyCounts.some((count) => count !== 2)
  )
    throw new Error(
      "A semimonthly calendar requires exactly two actual regular payment dates in every month.",
    );
  if (payFrequency === "monthly" && monthlyCounts.some((count) => count !== 1))
    throw new Error(
      "A monthly calendar requires one actual regular payment date in every month.",
    );
  if (payFrequency === "weekly" || payFrequency === "biweekly") {
    const minimum = payFrequency === "weekly" ? 4 : 11,
      maximum = payFrequency === "weekly" ? 10 : 17;
    for (let i = 1; i < payDates.length; i++) {
      const gap =
        (Date.parse(payDates[i]) - Date.parse(payDates[i - 1])) / 86400000;
      if (gap < minimum || gap > maximum)
        throw new Error(
          "The actual pay calendar does not follow its declared weekly/biweekly frequency, allowing short holiday shifts. Review the calendar before calculating withholding.",
        );
    }
  }
  const multiplier = payrollNumber(
    row.eiEmployerMultiplier,
    "Employer EI multiplier",
    1.4,
  );
  if (multiplier <= 0)
    throw new Error("Employer EI multiplier must be positive.");
  const reducedEiRateEvidence = optionalText(
    row.reducedEiRateEvidence,
    "Approved reduced EI evidence",
  );
  if (multiplier !== 1.4 && !reducedEiRateEvidence)
    throw new Error(
      "Retain actual CRA approval evidence for a reduced EI employer multiplier.",
    );
  const openingDate = payrollDate(
    row.ehtOpeningThroughDate,
    "EHT opening coverage date",
  );
  if (openingDate > `${year}-12-31` || openingDate < `${year - 1}-12-31`)
    throw new Error(
      "EHT opening coverage must be in this payment year or its preceding December 31.",
    );
  if (openingDate < `${year}-01-01` && row.ehtOpeningRemunerationCents !== 0)
    throw new Error(
      "Current-year EHT opening remuneration must be zero before January 1.",
    );
  const associated = payrollBoolean(
    row.ehtAssociated,
    "EHT association status",
  );
  const ledgerRow = row.ledger == null ? undefined : payrollObject(row.ledger);
  const ledger = ledgerRow
    ? defined(
        Object.fromEntries(
          [
            "wagesExpenseAccountId",
            "employerExpenseAccountId",
            "netPayLiabilityAccountId",
            "deductionsLiabilityAccountId",
            "benefitsLiabilityAccountId",
          ].map((key) => [
            key,
            optionalText(ledgerRow[key], "Ledger account", 1000),
          ]),
        ),
      )
    : undefined;
  const location =
    row.ehtLocation == null ? undefined : payrollObject(row.ehtLocation);
  const ehtLocations =
    row.ehtLocations == null
      ? undefined
      : Array.isArray(row.ehtLocations) && row.ehtLocations.length <= 100
        ? row.ehtLocations.map((raw) => {
            const location = payrollObject(raw),
              qualifying = payrollBoolean(
                location.qualifying,
                "actual location qualification",
              ),
              openingRemunerationCents = payrollInteger(
                location.openingRemunerationCents,
                "Location opening remuneration",
              );
            if (!qualifying && openingRemunerationCents)
              throw new Error(
                "Attribute nonqualifying-location remuneration to an evidenced qualifying location on a reasonable basis before claiming nonprofit location relief.",
              );
            return {
              id: payrollText(location.id, "Physical location identifier", 200),
              evidence: payrollText(
                location.evidence,
                "Physical location qualification evidence",
                4000,
              ),
              qualifying,
              openingRemunerationCents,
              openingSourceReference: payrollText(
                location.openingSourceReference,
                "Location opening source",
                4000,
              ),
            };
          })
        : (() => {
            throw new Error("Enter at most 100 actual EHT locations.");
          })();
  if (ehtLocations) {
    if (new Set(ehtLocations.map((l) => l.id)).size !== ehtLocations.length)
      throw new Error(
        "Each actual physical qualifying EHT location may appear only once.",
      );
    if (
      ehtLocations.reduce((a, l) => a + l.openingRemunerationCents, 0) !==
      row.ehtOpeningRemunerationCents
    )
      throw new Error(
        "Location opening remuneration must reconcile exactly to the employer EHT opening; no amount may be omitted or duplicated.",
      );
    if (row.ehtEmployerClass !== "charitable_nonprofit")
      throw new Error(
        "Multiple location exemptions require the reviewed charitable/nonprofit EHT class.",
      );
  }
  return defined({
    ehtLocations,
    uniformEmployerAssumptionsConfirmed:
      row.uniformEmployerAssumptionsConfirmed == null
        ? undefined
        : payrollBoolean(
            row.uniformEmployerAssumptionsConfirmed,
            "uniform EI coverage and actual benefit/pension costs",
          ),
    year,
    payFrequency,
    payDates,
    eiEmployerMultiplier: multiplier,
    reducedEiRateEvidence,
    ehtEmployerClass: choice(
      row.ehtEmployerClass,
      ["ordinary", "charitable_nonprofit"] as const,
      "EHT employer class",
    ),
    ehtQualificationEvidence: optionalText(
      row.ehtQualificationEvidence,
      "EHT qualification evidence",
    ),
    ehtOpeningRemunerationCents: payrollInteger(
      row.ehtOpeningRemunerationCents,
      "EHT opening remuneration cents",
    ),
    ehtOpeningThroughDate: openingDate,
    ehtOpeningConfirmed: payrollBoolean(
      row.ehtOpeningConfirmed,
      "same-employer EHT opening",
    ),
    ehtOpeningSourceReference: payrollText(
      row.ehtOpeningSourceReference,
      "EHT opening source",
      4000,
      !row.ehtOpeningConfirmed,
    ),
    ehtOpeningRepresentedPayRunIds: idList(
      row.ehtOpeningRepresentedPayRunIds,
      "EHT represented runs",
      200,
    ),
    ehtAssociated: associated,
    ehtAssociatedGroupRemunerationCents: optionalCents(
      row.ehtAssociatedGroupRemunerationCents,
      "Associated group remuneration",
    ),
    associatedGroupPermanentEstablishmentDays:
      row.associatedGroupPermanentEstablishmentDays == null
        ? undefined
        : payrollInteger(
            row.associatedGroupPermanentEstablishmentDays,
            "Associated group permanent-establishment days",
            (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000,
          ),
    ehtExemptionAllocationCents: optionalCents(
      row.ehtExemptionAllocationCents,
      "Allocated EHT exemption",
    ),
    ehtAllocationEvidence: optionalText(
      row.ehtAllocationEvidence,
      "EHT allocation evidence",
    ),
    ehtPermanentEstablishmentDays: payrollInteger(
      row.ehtPermanentEstablishmentDays,
      "B.C. permanent establishment days",
      366,
    ),
    ehtLocation: location
      ? {
          id: payrollText(location.id, "EHT qualifying location"),
          evidence: payrollText(
            location.evidence,
            "Location qualification evidence",
            4000,
          ),
          qualifying: payrollBoolean(
            location.qualifying,
            "location qualification",
          ),
        }
      : undefined,
    workSafeRatePer100Dollars: payrollNumber(
      row.workSafeRatePer100Dollars,
      "WorkSafe net rate per $100",
      100,
    ),
    workSafeAssessableLimitCents: payrollInteger(
      row.workSafeAssessableLimitCents,
      "WorkSafe yearly assessable limit cents",
    ),
    workSafeClassificationCode: payrollText(
      row.workSafeClassificationCode,
      "WorkSafe classification",
      200,
    ),
    workSafeRateEvidence: payrollText(
      row.workSafeRateEvidence,
      "WorkSafe rate evidence",
      4000,
    ),
    employerBenefitsCentsPerPay: payrollInteger(
      row.employerBenefitsCentsPerPay,
      "Employer benefits cents",
    ),
    employerPensionPercent: payrollNumber(
      row.employerPensionPercent,
      "Employer pension percent",
      100,
    ),
    employerPensionBonusEligible:
      row.employerPensionBonusEligible == null
        ? undefined
        : payrollBoolean(
            row.employerPensionBonusEligible,
            "actual pension plan bonus eligibility",
          ),
    benefitsAlreadyInEarningsCentsPerPay: optionalCents(
      row.benefitsAlreadyInEarningsCentsPerPay,
      "Benefits already included",
    ),
    pensionAlreadyInEarningsCentsPerPay: optionalCents(
      row.pensionAlreadyInEarningsCentsPerPay,
      "Pension already included",
    ),
    ledger,
  } as EmployerSettingsFields);
}

export function cleanPayrollProfile(raw: unknown): EmployeeProfileFields {
  const row = payrollObject(raw),
    from = payrollDate(row.effectiveFrom, "Effective from"),
    to = optionalDate(row.effectiveTo, "Effective to");
  if (to && to < from)
    throw new Error("Profile end precedes its effective date.");
  const td1 = payrollObject(row.td1),
    cpp = payrollObject(row.cpp),
    allocations = row.fundingAllocations;
  const fundingAllocations =
    allocations == null
      ? undefined
      : Array.isArray(allocations) &&
          allocations.length > 0 &&
          allocations.length <= 100
        ? allocations.map((input) => {
            const value = payrollObject(input);
            return defined({
              label: payrollText(value.label, "Funding allocation label"),
              shareBps: payrollInteger(
                value.shareBps,
                "Allocation basis points",
                10000,
              ),
              grantId: optionalText(value.grantId, "Grant", 1000),
              fundRestrictionId: optionalText(
                value.fundRestrictionId,
                "Restricted fund",
                1000,
              ),
              programCode: optionalText(value.programCode, "Program code", 100),
            });
          })
        : (() => {
            throw new Error("Enter one to 100 funding allocations.");
          })();
  if (
    fundingAllocations &&
    fundingAllocations.reduce((sum, item) => sum + item.shareBps, 0) !== 10000
  )
    throw new Error(
      "Funding allocations must total exactly 10,000 basis points (100%).",
    );
  const deductions =
    row.deductions == null ? undefined : payrollObject(row.deductions);
  const cleanedDeductions = deductions
    ? defined(
        Object.fromEntries(
          [
            "registeredPlanCents",
            "unionDuesCents",
            "maintenanceCents",
            "bonusRegisteredPlanCents",
            "otherCashCents",
            "authorizedAnnualDeductionCents",
            "annualZoneDeductionCents",
            "annualFederalCreditCents",
            "annualProvincialCreditCents",
          ].map((key) => [key, optionalCents(deductions[key], key)]),
        ),
      )
    : undefined;
  const elections =
    cpp.elections == null
      ? undefined
      : Array.isArray(cpp.elections) && cpp.elections.length <= 100
        ? cpp.elections.map((value: unknown) => {
            const event = payrollObject(value);
            return {
              action: choice(
                event.action,
                ["stop", "restart"] as const,
                "CPP election",
              ),
              receivedDate: payrollDate(
                event.receivedDate,
                "CPP election receipt",
              ),
              retirementPensionConfirmed: payrollBoolean(
                event.retirementPensionConfirmed,
                "CPP retirement pension",
              ),
              evidence: payrollText(event.evidence, "CPT30 evidence", 4000),
            };
          })
        : (() => {
            throw new Error("Enter at most 100 CPP election events.");
          })();
  const disabilityPeriods =
    cpp.disabilityPeriods == null
      ? undefined
      : Array.isArray(cpp.disabilityPeriods) &&
          cpp.disabilityPeriods.length <= 100
        ? cpp.disabilityPeriods.map((value: unknown) => {
            const event = payrollObject(value),
              consideredDisabledDate = payrollDate(
                event.consideredDisabledDate,
                "CPP disability date",
              ),
              noLongerDisabledDate = optionalDate(
                event.noLongerDisabledDate,
                "CPP disability end",
              );
            if (
              noLongerDisabledDate &&
              noLongerDisabledDate < consideredDisabledDate
            )
              throw new Error("Disability end precedes its start.");
            return defined({
              consideredDisabledDate,
              noLongerDisabledDate,
              evidence: payrollText(
                event.evidence,
                "Disability evidence",
                4000,
              ),
            });
          })
        : (() => {
            throw new Error("Enter at most 100 disability periods.");
          })();
  const override =
    row.employerOverrides == null
      ? undefined
      : payrollObject(row.employerOverrides);
  const employerOverrides = override
    ? defined({
        eiEmployerMultiplier:
          override.eiEmployerMultiplier == null
            ? undefined
            : payrollNumber(
                override.eiEmployerMultiplier,
                "Employee covered-group EI multiplier",
                1.4,
              ),
        reducedEiRateEvidence: optionalText(
          override.reducedEiRateEvidence,
          "Covered-group reduced EI approval evidence",
        ),
        eiCoverageGroup: optionalText(
          override.eiCoverageGroup,
          "EI coverage group",
          200,
        ),
        benefitsCentsPerPay: optionalCents(
          override.benefitsCentsPerPay,
          "Actual employee benefit cost",
        ),
        pensionPercent:
          override.pensionPercent == null
            ? undefined
            : payrollNumber(
                override.pensionPercent,
                "Actual employee pension percent",
                100,
              ),
        pensionBonusEligible:
          override.pensionBonusEligible == null
            ? undefined
            : payrollBoolean(
                override.pensionBonusEligible,
                "actual employee pension bonus eligibility",
              ),
        benefitsAlreadyInEarningsCentsPerPay: optionalCents(
          override.benefitsAlreadyInEarningsCentsPerPay,
          "Employee benefits already in cash",
        ),
        pensionAlreadyInEarningsCentsPerPay: optionalCents(
          override.pensionAlreadyInEarningsCentsPerPay,
          "Employee pension already in cash",
        ),
        evidence: payrollText(
          override.evidence,
          "Reviewed actual employee coverage and employer-cost evidence",
          4000,
        ),
      })
    : undefined;
  if (
    employerOverrides?.eiEmployerMultiplier !== undefined &&
    (employerOverrides.eiEmployerMultiplier <= 0 ||
      (employerOverrides.eiEmployerMultiplier !== 1.4 &&
        (!employerOverrides.reducedEiRateEvidence ||
          !employerOverrides.eiCoverageGroup)))
  )
    throw new Error(
      "A reduced employee EI multiplier requires the actual covered group and CRA approval evidence; uncovered staff use an explicit 1.4 override.",
    );
  const ehtLocationId = optionalText(
      row.ehtLocationId,
      "Annual primary EHT reporting location",
      200,
    ),
    ehtAttributionBasis =
      row.ehtAttributionBasis == null
        ? undefined
        : choice(
            row.ehtAttributionBasis,
            ["primary_reporting", "reasonable_allocation"] as const,
            "annual remuneration attribution",
          ),
    ehtAttributionEvidence = optionalText(
      row.ehtAttributionEvidence,
      "Actual annual location attribution evidence",
    );
  if (ehtLocationId && (!ehtAttributionBasis || !ehtAttributionEvidence))
    throw new Error(
      "An annual primary EHT location needs the actual reporting/reasonable-allocation basis and evidence.",
    );
  const proration =
    row.salaryProration == null
      ? undefined
      : payrollObject(row.salaryProration);
  const fifth =
    row.fifthYearVacationReconciliation == null
      ? undefined
      : payrollObject(row.fifthYearVacationReconciliation);
  return defined({
    employerOverrides,
    ehtLocationId,
    ehtAttributionBasis,
    ehtAttributionEvidence,
    salaryProration: proration
      ? {
          basis: choice(
            proration.basis,
            ["calendar_days"] as const,
            "salary proration basis",
          ),
          reviewed: payrollBoolean(
            proration.reviewed,
            "contract salary proration",
          ),
          evidence: payrollText(
            proration.evidence,
            "Salary proration evidence",
            4000,
            !proration.reviewed,
          ),
        }
      : undefined,
    fifthYearVacationReconciliation: fifth
      ? {
          fifthYearGrossWagesCents: payrollInteger(
            fifth.fifthYearGrossWagesCents,
            "Fifth-year gross cents",
          ),
          vacationAlreadyPaidCents: payrollInteger(
            fifth.vacationAlreadyPaidCents,
            "Vacation already paid cents",
          ),
          vacationAlreadyAccruedCents: optionalCents(
            fifth.vacationAlreadyAccruedCents,
            "Vacation already accrued",
          ),
          previousVacationRatePercent: payrollNumber(
            fifth.previousVacationRatePercent,
            "Previous vacation percent",
            100,
          ),
          reviewed: payrollBoolean(
            fifth.reviewed,
            "fifth-year vacation reconciliation",
          ),
          evidence: payrollText(
            fifth.evidence,
            "Vacation reconciliation evidence",
            4000,
            !fifth.reviewed,
          ),
        }
      : undefined,
    effectiveFrom: from,
    effectiveTo: to,
    provinceOfEmployment: payrollText(
      row.provinceOfEmployment,
      "Province of employment",
      20,
    ).toUpperCase(),
    employmentKind: choice(
      row.employmentKind,
      [
        "ordinary",
        "commission",
        "pension",
        "nonresident",
        "quebec_transfer",
      ] as const,
      "employment kind",
    ),
    compensation: choice(
      row.compensation,
      ["hourly", "monthly", "annual"] as const,
      "compensation",
    ),
    rateCents: payrollInteger(row.rateCents, "Wage or salary cents"),
    normalWeeklyMinutes: payrollInteger(
      row.normalWeeklyMinutes,
      "Normal weekly minutes",
      10080,
    ),
    averageWeeklyMinutes: payrollInteger(
      row.averageWeeklyMinutes,
      "Average weekly minutes",
      10080,
    ),
    policy: choice(row.policy, ["ordinary_bc"] as const, "employment policy"),
    restPeriodsConfirmed: payrollBoolean(
      row.restPeriodsConfirmed,
      "weekly and daily rest",
    ),
    historyCompleteFrom: payrollDate(
      row.historyCompleteFrom,
      "Complete history from",
    ),
    historyCompleteThrough: payrollDate(
      row.historyCompleteThrough,
      "Complete history through",
    ),
    ytdConfirmed: payrollBoolean(
      row.ytdConfirmed,
      "complete same-employer payroll history",
    ),
    vacationMode: choice(
      row.vacationMode,
      ["accrue", "pay_each_cheque"] as const,
      "vacation mode",
    ),
    vacationRatePercent:
      row.vacationRatePercent == null
        ? undefined
        : payrollNumber(row.vacationRatePercent, "Vacation percent", 100),
    vacationEachChequeAgreementConfirmed:
      row.vacationEachChequeAgreementConfirmed == null
        ? undefined
        : payrollBoolean(
            row.vacationEachChequeAgreementConfirmed,
            "written each-cheque vacation agreement",
          ),
    td1: defined({
      confirmed: payrollBoolean(td1.confirmed, "TD1 declaration evidence"),
      declarationReference: payrollText(
        td1.declarationReference,
        "Employer-recorded TD1 evidence",
        4000,
        !td1.confirmed,
      ),
      federalClaimCents: optionalCents(
        td1.federalClaimCents,
        "Federal TD1 claim",
      ),
      provincialClaimCents: optionalCents(
        td1.provincialClaimCents,
        "B.C. TD1 claim",
      ),
      multipleEmployers:
        td1.multipleEmployers == null
          ? undefined
          : payrollBoolean(
              td1.multipleEmployers,
              "multiple-employer TD1 status",
            ),
      ...Object.fromEntries(["federalMultipleEmployers", "provincialMultipleEmployers", "federalTaxExempt", "provincialTaxExempt"].filter(key => td1[key] != null).map(key => [key, payrollBoolean(td1[key], key)])),
      additionalTaxCents: optionalCents(
        td1.additionalTaxCents,
        "Additional requested tax",
      ),
      taxExempt:
        td1.taxExempt == null
          ? undefined
          : payrollBoolean(td1.taxExempt, "TD1 tax exemption"),
    }),
    cpp: defined({
      exempt: payrollBoolean(cpp.exempt, "CPP exemption status"),
      exemptionReason: payrollText(
        cpp.exemptionReason,
        "CPP exemption reason",
        4000,
        !cpp.exempt,
      ),
      evidenceReference: payrollText(
        cpp.evidenceReference,
        "CPP exemption evidence",
        4000,
        !cpp.exempt,
      ),
      elections,
      disabilityPeriods,
    }),
    eiExempt: payrollBoolean(row.eiExempt, "EI exemption status"),
    eiExemptionEvidence: payrollText(
      row.eiExemptionEvidence,
      "EI exemption evidence",
      4000,
      !row.eiExempt,
    ),
    deductions: cleanedDeductions,
    portalUserId: optionalText(
      row.portalUserId,
      "Linked employee portal user",
      1000,
    ),
    notes: optionalText(row.notes, "Payroll notes"),
    fundingAllocations,
  } as EmployeeProfileFields);
}
export function cleanPayrollCode(raw: unknown): EarningCodeFields {
  const row = payrollObject(raw),
    flags = payrollObject(row.classifications),
    code = payrollText(row.code, "Earning code", 32).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]*$/.test(code))
    throw new Error(
      "Use a letter-led earning code with letters, numbers, underscores or dashes.",
    );
  return {
    code,
    name: payrollText(row.name, "Earning name"),
    paymentKind: choice(
      row.paymentKind,
      [
        "regular",
        "bonus",
        "benefit",
        "reimbursement",
        "vacation",
        "other",
      ] as const,
      "earning kind",
    ),
    classifications: Object.fromEntries(
      [
        "cash",
        "taxable",
        "pensionable",
        "insurable",
        "vacationable",
        "eht",
        "workSafe",
      ].map((key) => [
        key,
        payrollBoolean(flags[key], `${key} classification`),
      ]),
    ) as EarningCodeFields["classifications"],
    classificationEvidence: payrollText(
      row.classificationEvidence,
      "Reviewed earning classification evidence",
      4000,
    ),
    active: payrollBoolean(row.active, "earning-code active status"),
  };
}
export function cleanPayrollWork(raw: unknown): WorkDayFields {
  const row = payrollObject(raw),
    minutes = payrollInteger(row.minutes, "Worked minutes", 1440),
    rest =
      row.restPremiumMinutes == null
        ? undefined
        : payrollInteger(
            row.restPremiumMinutes,
            "Rest premium minutes",
            minutes,
          );
  const historical = optionalCents(
      row.historicalNonOvertimeWagesCents,
      "Historical non-overtime wages",
    ),
    workedOrEarned =
      row.workedOrEarned == null
        ? minutes > 0
        : payrollBoolean(row.workedOrEarned, "worked or earned day");
  if (historical && !workedOrEarned)
    throw new Error(
      "A historical earned amount must count as a worked/earned day.",
    );
  const paidVacationMinutes =
    row.paidVacationMinutes == null
      ? undefined
      : payrollInteger(row.paidVacationMinutes, "Paid vacation minutes", 1440);
  if (
    paidVacationMinutes &&
    row.insurablePaidLeaveMinutes != null &&
    row.insurablePaidLeaveMinutes < paidVacationMinutes
  )
    throw new Error(
      "Inclusive paid-leave insurable minutes cannot be smaller than the recorded annual vacation minutes.",
    );
  if (minutes + (paidVacationMinutes ?? 0) > 1440)
    throw new Error(
      "Worked and paid vacation minutes cannot exceed one calendar day.",
    );
  if (paidVacationMinutes && !row.salaryVacationSourceReference)
    throw new Error(
      "Paid salary vacation requires a reviewed leave/request source reference.",
    );
  return defined({
    paidVacationMinutes,
    salaryVacationSourceReference: optionalText(
      row.salaryVacationSourceReference,
      "Salary vacation source reference",
    ),
    vacationRequestId: optionalText(
      row.vacationRequestId,
      "Vacation request",
      1000,
    ),
    date: payrollDate(row.date, "Work date"),
    minutes,
    restPremiumMinutes: rest,
    salaryIncludedHolidayCents: optionalCents(
      row.salaryIncludedHolidayCents,
      "Holiday amount already included in salary",
    ),
    salaryIncludedSickCents: optionalCents(
      row.salaryIncludedSickCents,
      "Sick amount already included in salary",
    ),
    insurablePaidLeaveMinutes:
      row.insurablePaidLeaveMinutes == null
        ? undefined
        : payrollInteger(
            row.insurablePaidLeaveMinutes,
            "Paid leave insurable minutes",
            1440,
          ),
    holiday:
      row.holiday == null
        ? undefined
        : payrollBoolean(row.holiday, "holiday flag"),
    sickLeave:
      row.sickLeave == null
        ? undefined
        : choice(row.sickLeave, ["paid", "unpaid"] as const, "sick leave"),
    historicalNonOvertimeWagesCents: historical,
    workedOrEarned,
    notes: optionalText(row.notes, "Work-day notes"),
  });
}
export function cleanPayrollOpening(raw: unknown): OpeningBalanceFields {
  const row = payrollObject(raw),
    year = payrollYear(row.year),
    coveredThroughDate = payrollDate(
      row.coveredThroughDate,
      "Opening coverage date",
    ),
    input = payrollObject(row.ytd),
    ytd = {} as PayrollDeductionYtd;
  for (const key of Object.keys(emptyPayrollYtd()) as Array<
    keyof PayrollDeductionYtd
  >) {
    const optional = /(?:Federal|Provincial)TaxCents$/.test(key);
    if (!optional || input[key] != null)
      ytd[key] = payrollInteger(input[key], `Opening ${key}`);
  }
  if (
    coveredThroughDate < `${year - 1}-12-31` ||
    coveredThroughDate > `${year}-12-31`
  )
    throw new Error(
      "Opening coverage must be this payment year or its preceding December 31.",
    );
  if (
    coveredThroughDate < `${year}-01-01` &&
    Object.values(ytd).some((amount) => amount !== 0)
  )
    throw new Error(
      "Payment-year YTD must be zero before January 1; prior-year balances cannot reduce this employer's current-year deductions.",
    );
  return {
    provinceOfEmployment: optionalText(
      row.provinceOfEmployment,
      "Opening province of employment",
      20,
    )?.toUpperCase(),
    employerCppCents: optionalCents(
      row.employerCppCents,
      "Opening employer CPP",
    ),
    employerCpp2Cents: optionalCents(
      row.employerCpp2Cents,
      "Opening employer CPP2",
    ),
    year,
    coveredThroughDate,
    sameEmployerConfirmed: payrollBoolean(
      row.sameEmployerConfirmed,
      "same legal employer",
    ),
    ytd,
    insurableHours: payrollNumber(
      row.insurableHours,
      "Opening insurable hours",
      100000,
    ),
    cashPaidCents: payrollInteger(row.cashPaidCents, "Opening cash cents"),
    netPaidCents: payrollInteger(row.netPaidCents, "Opening net cents"),
    vacationBalanceCents: payrollInteger(
      row.vacationBalanceCents,
      "Opening vacation balance cents",
    ),
    workSafeAssessableCents: payrollInteger(
      row.workSafeAssessableCents,
      "Opening WorkSafe assessable cents",
    ),
    sickPaidDaysUsed: payrollInteger(
      row.sickPaidDaysUsed,
      "Paid sick days used",
      5,
    ),
    sickUnpaidDaysUsed: payrollInteger(
      row.sickUnpaidDaysUsed,
      "Unpaid sick days used",
      3,
    ),
    sourceProvider: optionalText(row.sourceProvider, "Opening provider"),
    sourceReference: payrollText(
      row.sourceReference,
      "Opening source reference",
      4000,
    ),
    representedPayRunIds: idList(
      row.representedPayRunIds,
      "Represented pay runs",
      200,
    ),
  };
}
export function cleanPayrollInput(raw: unknown): CalculationInput {
  const row = payrollObject(raw),
    periodStart = payrollDate(row.periodStart, "Period start"),
    periodEnd = payrollDate(row.periodEnd, "Period end"),
    payDate = payrollDate(row.payDate, "Payment date"),
    regularPayDate = optionalDate(
      row.regularPayDate,
      "Applicable regular pay date",
    );
  if (regularPayDate && regularPayDate.slice(0, 4) !== payDate.slice(0, 4))
    throw new Error(
      "Applicable regular pay date must be in the actual payment year.",
    );
  if (
    periodEnd < periodStart ||
    Date.parse(`${periodEnd}T00:00Z`) - Date.parse(`${periodStart}T00:00Z`) >
      366 * 86400000
  )
    throw new Error("Use an ordered payroll period of at most one year.");
  const employeeIds = idList(row.employeeIds, "Selected employees", 10);
  if (!employeeIds.length) throw new Error("Select at least one employee.");
  const adjustments =
    row.adjustments == null
      ? undefined
      : Array.isArray(row.adjustments) && row.adjustments.length <= 100
        ? row.adjustments.map((input) => {
            const value = payrollObject(input),
              employeeId = payrollText(
                value.employeeId,
                "Adjustment employee",
                1000,
              ),
              date = payrollDate(value.date, "Earning date");
            if (
              !employeeIds.includes(employeeId) ||
              date < periodStart ||
              date > periodEnd
            )
              throw new Error(
                "Each adjustment must belong to a selected employee and work period.",
              );
            return defined({
              employeeId,
              earningCodeId: payrollText(
                value.earningCodeId,
                "Earning code",
                1000,
              ),
              date,
              amountCents: payrollInteger(
                value.amountCents,
                "Additional earning cents",
              ),
              label: optionalText(value.label, "Earning description", 200),
              hours:
                value.hours == null
                  ? undefined
                  : payrollNumber(value.hours, "Earning hours", 10000),
              rateCents: optionalCents(value.rateCents, "Earning rate"),
            });
          })
        : (() => {
            throw new Error("Enter at most 100 additional earnings.");
          })();
  const employerCostOverrides =
    row.employerCostOverrides == null
      ? undefined
      : Array.isArray(row.employerCostOverrides) &&
          row.employerCostOverrides.length <= 10
        ? row.employerCostOverrides.map((raw) => {
            const cost = payrollObject(raw),
              employeeId = payrollText(
                cost.employeeId,
                "Employer cost employee",
                1000,
              );
            if (!employeeIds.includes(employeeId))
              throw new Error(
                "A per-run employer cost must belong to a selected employee.",
              );
            return defined({
              employeeId,
              benefitsCents: optionalCents(
                cost.benefitsCents,
                "Actual per-run benefit cost",
              ),
              pensionCents: optionalCents(
                cost.pensionCents,
                "Actual per-run pension cost",
              ),
              benefitsAlreadyInEarningsCents: optionalCents(
                cost.benefitsAlreadyInEarningsCents,
                "Per-run benefit already in cash",
              ),
              pensionAlreadyInEarningsCents: optionalCents(
                cost.pensionAlreadyInEarningsCents,
                "Per-run pension already in cash",
              ),
              evidence: payrollText(
                cost.evidence,
                "Actual per-run employer-cost evidence",
                4000,
              ),
            });
          })
        : (() => {
            throw new Error(
              "Enter at most one actual per-run employer-cost override per employee.",
            );
          })();
  if (
    employerCostOverrides &&
    new Set(employerCostOverrides.map((c) => c.employeeId)).size !==
      employerCostOverrides.length
  )
    throw new Error(
      "Combine each employee’s actual per-run employer-cost override.",
    );
  const vacationPayouts =
    row.vacationPayouts == null
      ? undefined
      : Array.isArray(row.vacationPayouts) && row.vacationPayouts.length <= 10
        ? row.vacationPayouts.map((raw) => {
            const payout = payrollObject(raw),
              employeeId = payrollText(
                payout.employeeId,
                "Vacation payout employee",
                1000,
              ),
              amountCents = payrollInteger(
                payout.amountCents,
                "Vacation payout cents",
              );
            if (!employeeIds.includes(employeeId) || amountCents <= 0)
              throw new Error(
                "A vacation payout must name a selected employee and a positive actual amount.",
              );
            return defined({
              employeeId,
              amountCents,
              sourceReference: payrollText(
                payout.sourceReference,
                "Reviewed vacation liability/payout source",
                4000,
              ),
              treatment: choice(
                payout.treatment,
                ["vacation_leave", "unused_cashout"] as const,
                "vacation payout income-tax treatment",
              ),
              insurableMinutes:
                payout.insurableMinutes == null
                  ? undefined
                  : payrollInteger(
                      payout.insurableMinutes,
                      "Actual paid-vacation insurable minutes",
                      100000,
                    ),
              vacationRequestId: optionalText(
                payout.vacationRequestId,
                "Vacation request",
                1000,
              ),
            });
          })
        : (() => {
            throw new Error(
              "Enter at most one vacation liability payout per selected employee.",
            );
          })();
  if (
    vacationPayouts &&
    new Set(vacationPayouts.map((p) => p.employeeId)).size !==
      vacationPayouts.length
  )
    throw new Error(
      "Combine each employee’s ordinary vacation payout into one reviewed source.",
    );
  if (row.runType === "final" && vacationPayouts?.length)
    throw new Error(
      "Final payroll settles all vacation automatically; do not add a second ordinary payout.",
    );
  const termination =
    row.termination == null ? undefined : payrollObject(row.termination);
  const timestamp = (value: unknown) => {
    const result = payrollText(
      value,
      "Actual termination/payment timestamp",
      80,
    );
    if (
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(result) ||
      !Number.isFinite(Date.parse(result))
    )
      throw new Error("Record an exact timestamp with its timezone offset.");
    return result;
  };
  return defined({
    employerCostOverrides,
    vacationPayouts,
    periodStart,
    periodEnd,
    payDate,
    regularPayDate,
    ruleEditionId: optionalText(row.ruleEditionId, "Published rule edition", 1000),
    employeeIds,
    runType: choice(
      row.runType,
      ["regular", "bonus", "off_cycle", "final", "correction"] as const,
      "run type",
    ),
    method: choice(row.method, ["option1", "option2"] as const, "CRA method"),
    adjustments,
    correctionOfId: optionalText(
      row.correctionOfId,
      "Corrected calculation",
      1000,
    ),
    termination: termination
      ? defined({
          at: timestamp(termination.at),
          initiatedBy: choice(
            termination.initiatedBy,
            ["employer", "employee"] as const,
            "termination initiator",
          ),
          paidAt: termination.paidAt
            ? timestamp(termination.paidAt)
            : undefined,
        })
      : undefined,
  });
}
