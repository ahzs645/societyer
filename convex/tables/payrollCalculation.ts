import { defineTable } from "convex/server";
import { v } from "convex/values";
import { payrollDeductionYtdDeltaValidator } from "./businessRegisters";

const frequency = v.union(
  v.literal("weekly"),
  v.literal("biweekly"),
  v.literal("semimonthly"),
  v.literal("monthly"),
);
const runType = v.union(
  v.literal("regular"),
  v.literal("bonus"),
  v.literal("off_cycle"),
  v.literal("final"),
  v.literal("correction"),
);
const classifications = v.object({
  cash: v.boolean(),
  taxable: v.boolean(),
  pensionable: v.boolean(),
  insurable: v.boolean(),
  vacationable: v.boolean(),
  eht: v.boolean(),
  workSafe: v.boolean(),
});
const fundingAllocation = v.object({
  label: v.string(),
  shareBps: v.number(),
  grantId: v.optional(v.id("grants")),
  fundRestrictionId: v.optional(v.id("fundRestrictions")),
  programCode: v.optional(v.string()),
});
const ledger = v.object({
  wagesExpenseAccountId: v.optional(v.id("financialAccounts")),
  employerExpenseAccountId: v.optional(v.id("financialAccounts")),
  netPayLiabilityAccountId: v.optional(v.id("financialAccounts")),
  deductionsLiabilityAccountId: v.optional(v.id("financialAccounts")),
  benefitsLiabilityAccountId: v.optional(v.id("financialAccounts")),
});
const employer = {
  uniformEmployerAssumptionsConfirmed: v.optional(v.boolean()),
  ehtLocations: v.optional(
    v.array(
      v.object({
        id: v.string(),
        evidence: v.string(),
        qualifying: v.boolean(),
        openingRemunerationCents: v.number(),
        openingSourceReference: v.string(),
      }),
    ),
  ),
  year: v.number(),
  payFrequency: frequency,
  payDates: v.array(v.string()),
  eiEmployerMultiplier: v.number(),
  reducedEiRateEvidence: v.optional(v.string()),
  ehtEmployerClass: v.union(
    v.literal("ordinary"),
    v.literal("charitable_nonprofit"),
  ),
  ehtQualificationEvidence: v.optional(v.string()),
  ehtOpeningRemunerationCents: v.number(),
  ehtOpeningThroughDate: v.string(),
  ehtOpeningConfirmed: v.boolean(),
  ehtOpeningSourceReference: v.string(),
  ehtOpeningRepresentedPayRunIds: v.array(v.id("payRuns")),
  ehtAssociated: v.boolean(),
  ehtAssociatedGroupRemunerationCents: v.optional(v.number()),
  associatedGroupPermanentEstablishmentDays: v.optional(v.number()),
  ehtExemptionAllocationCents: v.optional(v.number()),
  ehtAllocationEvidence: v.optional(v.string()),
  ehtPermanentEstablishmentDays: v.number(),
  ehtLocation: v.optional(
    v.object({ id: v.string(), evidence: v.string(), qualifying: v.boolean() }),
  ),
  workSafeRatePer100Dollars: v.number(),
  workSafeAssessableLimitCents: v.number(),
  workSafeClassificationCode: v.string(),
  workSafeRateEvidence: v.string(),
  employerBenefitsCentsPerPay: v.number(),
  employerPensionPercent: v.number(),
  employerPensionBonusEligible: v.optional(v.boolean()),
  benefitsAlreadyInEarningsCentsPerPay: v.optional(v.number()),
  pensionAlreadyInEarningsCentsPerPay: v.optional(v.number()),
  ledger: v.optional(ledger),
};
const deductions = v.object({
  registeredPlanCents: v.optional(v.number()),
  unionDuesCents: v.optional(v.number()),
  maintenanceCents: v.optional(v.number()),
  bonusRegisteredPlanCents: v.optional(v.number()),
  otherCashCents: v.optional(v.number()),
  authorizedAnnualDeductionCents: v.optional(v.number()),
  annualZoneDeductionCents: v.optional(v.number()),
  annualFederalCreditCents: v.optional(v.number()),
  annualProvincialCreditCents: v.optional(v.number()),
});
const profile = {
  ehtLocationId: v.optional(v.string()),
  ehtAttributionBasis: v.optional(
    v.union(v.literal("primary_reporting"), v.literal("reasonable_allocation")),
  ),
  ehtAttributionEvidence: v.optional(v.string()),
  employerOverrides: v.optional(
    v.object({
      eiEmployerMultiplier: v.optional(v.number()),
      reducedEiRateEvidence: v.optional(v.string()),
      eiCoverageGroup: v.optional(v.string()),
      benefitsCentsPerPay: v.optional(v.number()),
      pensionPercent: v.optional(v.number()),
      pensionBonusEligible: v.optional(v.boolean()),
      benefitsAlreadyInEarningsCentsPerPay: v.optional(v.number()),
      pensionAlreadyInEarningsCentsPerPay: v.optional(v.number()),
      evidence: v.string(),
    }),
  ),
  effectiveFrom: v.string(),
  effectiveTo: v.optional(v.string()),
  provinceOfEmployment: v.string(),
  employmentKind: v.union(
    v.literal("ordinary"),
    v.literal("commission"),
    v.literal("pension"),
    v.literal("nonresident"),
    v.literal("quebec_transfer"),
  ),
  compensation: v.union(
    v.literal("hourly"),
    v.literal("monthly"),
    v.literal("annual"),
  ),
  rateCents: v.number(),
  salaryProration: v.optional(
    v.object({
      basis: v.literal("calendar_days"),
      reviewed: v.boolean(),
      evidence: v.string(),
    }),
  ),
  normalWeeklyMinutes: v.number(),
  averageWeeklyMinutes: v.number(),
  policy: v.literal("ordinary_bc"),
  restPeriodsConfirmed: v.boolean(),
  historyCompleteFrom: v.string(),
  historyCompleteThrough: v.string(),
  ytdConfirmed: v.boolean(),
  vacationMode: v.union(v.literal("accrue"), v.literal("pay_each_cheque")),
  vacationRatePercent: v.optional(v.number()),
  vacationEachChequeAgreementConfirmed: v.optional(v.boolean()),
  td1: v.object({
    confirmed: v.boolean(),
    federalClaimCents: v.optional(v.number()),
    provincialClaimCents: v.optional(v.number()),
    multipleEmployers: v.optional(v.boolean()),
    federalMultipleEmployers: v.optional(v.boolean()),
    provincialMultipleEmployers: v.optional(v.boolean()),
    federalTaxExempt: v.optional(v.boolean()),
    provincialTaxExempt: v.optional(v.boolean()),
    additionalTaxCents: v.optional(v.number()),
    taxExempt: v.optional(v.boolean()),
    declarationReference: v.string(),
  }),
  cpp: v.object({
    exempt: v.boolean(),
    exemptionReason: v.optional(v.string()),
    evidenceReference: v.optional(v.string()),
    elections: v.optional(
      v.array(
        v.object({
          action: v.union(v.literal("stop"), v.literal("restart")),
          receivedDate: v.string(),
          retirementPensionConfirmed: v.boolean(),
          evidence: v.string(),
        }),
      ),
    ),
    disabilityPeriods: v.optional(
      v.array(
        v.object({
          consideredDisabledDate: v.string(),
          noLongerDisabledDate: v.optional(v.string()),
          evidence: v.string(),
        }),
      ),
    ),
  }),
  eiExempt: v.boolean(),
  eiExemptionEvidence: v.optional(v.string()),
  deductions: v.optional(deductions),
  portalUserId: v.optional(v.id("users")),
  notes: v.optional(v.string()),
  fundingAllocations: v.optional(v.array(fundingAllocation)),
  fifthYearVacationReconciliation: v.optional(
    v.object({
      fifthYearGrossWagesCents: v.number(),
      vacationAlreadyPaidCents: v.number(),
      vacationAlreadyAccruedCents: v.optional(v.number()),
      previousVacationRatePercent: v.number(),
      reviewed: v.boolean(),
      evidence: v.string(),
    }),
  ),
};
const code = {
  code: v.string(),
  name: v.string(),
  paymentKind: v.union(
    v.literal("regular"),
    v.literal("bonus"),
    v.literal("benefit"),
    v.literal("reimbursement"),
    v.literal("vacation"),
    v.literal("other"),
  ),
  classifications,
  classificationEvidence: v.string(),
  active: v.boolean(),
};
const work = {
  paidVacationMinutes: v.optional(v.number()),
  salaryVacationSourceReference: v.optional(v.string()),
  vacationRequestId: v.optional(v.id("payrollVacationRequests")),
  date: v.string(),
  minutes: v.number(),
  holiday: v.optional(v.boolean()),
  sickLeave: v.optional(v.union(v.literal("paid"), v.literal("unpaid"))),
  restPremiumMinutes: v.optional(v.number()),
  salaryIncludedHolidayCents: v.optional(v.number()),
  salaryIncludedSickCents: v.optional(v.number()),
  insurablePaidLeaveMinutes: v.optional(v.number()),
  historicalNonOvertimeWagesCents: v.optional(v.number()),
  workedOrEarned: v.optional(v.boolean()),
  notes: v.optional(v.string()),
};
const opening = {
  year: v.number(),
  coveredThroughDate: v.string(),
  sameEmployerConfirmed: v.boolean(),
  ytd: payrollDeductionYtdDeltaValidator,
  insurableHours: v.number(),
  cashPaidCents: v.number(),
  netPaidCents: v.number(),
  vacationBalanceCents: v.number(),
  workSafeAssessableCents: v.number(),
  sickPaidDaysUsed: v.number(),
  sickUnpaidDaysUsed: v.number(),
  sourceProvider: v.optional(v.string()),
  sourceReference: v.string(),
  representedPayRunIds: v.array(v.id("payRuns")),
  provinceOfEmployment: v.optional(v.string()),
  employerCppCents: v.optional(v.number()),
  employerCpp2Cents: v.optional(v.number()),
};
export const payrollEmployerFieldsValidator = v.object(employer);
export const payrollEmployeeProfileFieldsValidator = v.object(profile);
export const payrollEarningCodeFieldsValidator = v.object(code);
export const payrollWorkDayFieldsValidator = v.object(work);
export const payrollOpeningFieldsValidator = v.object(opening);
export const payrollCalculationInputValidator = v.object({
  periodStart: v.string(),
  periodEnd: v.string(),
  payDate: v.string(),
  regularPayDate: v.optional(v.string()),
  ruleEditionId: v.optional(v.id("payrollRuleEditions")),
  employerCostOverrides: v.optional(
    v.array(
      v.object({
        employeeId: v.id("employees"),
        benefitsCents: v.optional(v.number()),
        pensionCents: v.optional(v.number()),
        benefitsAlreadyInEarningsCents: v.optional(v.number()),
        pensionAlreadyInEarningsCents: v.optional(v.number()),
        evidence: v.string(),
      }),
    ),
  ),
  vacationPayouts: v.optional(
    v.array(
      v.object({
        employeeId: v.id("employees"),
        amountCents: v.number(),
        sourceReference: v.string(),
        treatment: v.union(
          v.literal("vacation_leave"),
          v.literal("unused_cashout"),
        ),
        insurableMinutes: v.optional(v.number()),
        vacationRequestId: v.optional(v.id("payrollVacationRequests")),
      }),
    ),
  ),
  runType,
  employeeIds: v.array(v.id("employees")),
  method: v.union(v.literal("option1"), v.literal("option2")),
  adjustments: v.optional(
    v.array(
      v.object({
        employeeId: v.id("employees"),
        earningCodeId: v.id("payrollEarningCodes"),
        date: v.string(),
        amountCents: v.number(),
        label: v.optional(v.string()),
        hours: v.optional(v.number()),
        rateCents: v.optional(v.number()),
      }),
    ),
  ),
  correctionOfId: v.optional(v.id("payrollCalculations")),
  termination: v.optional(
    v.object({
      at: v.string(),
      initiatedBy: v.union(v.literal("employer"), v.literal("employee")),
      paidAt: v.optional(v.string()),
    }),
  ),
});
const audit = {
  societyId: v.id("societies"),
  createdByUserId: v.string(),
  createdAtISO: v.string(),
  updatedByUserId: v.string(),
  updatedAtISO: v.string(),
  version: v.number(),
};
const payment = v.object({
  key: v.string(),
  employeeId: v.optional(v.id("employees")),
  transactionId: v.id("financialTransactions"),
  date: v.string(),
  amountCents: v.number(),
  reference: v.string(),
  method: v.optional(
    v.union(
      v.literal("bank_transfer"),
      v.literal("direct_deposit"),
      v.literal("cheque"),
      v.literal("cash"),
      v.literal("other"),
    ),
  ),
  payee: v.optional(v.string()),
  destinationReference: v.optional(v.string()),
  recordedByUserId: v.string(),
  recordedAtISO: v.string(),
  journalEntryId: v.optional(v.id("journalEntries")),
  bankMirrorEntryIds: v.optional(v.array(v.id("journalEntries"))),
});
export const payrollCalculationTables = {
  payrollEmployerProfiles: defineTable({ ...audit, ...employer })
    .index("by_society", ["societyId"])
    .index("by_society_year", ["societyId", "year"]),
  payrollEmployeeProfiles: defineTable({
    ...audit,
    ...profile,
    employeeId: v.id("employees"),
  })
    .index("by_society", ["societyId"])
    .index("by_society_employee_from", [
      "societyId",
      "employeeId",
      "effectiveFrom",
    ]),
  payrollEarningCodes: defineTable({ ...audit, ...code })
    .index("by_society", ["societyId"])
    .index("by_society_code", ["societyId", "code"]),
  payrollWorkDays: defineTable({
    ...audit,
    ...work,
    employeeId: v.id("employees"),
    postedCalculationId: v.optional(v.id("payrollCalculations")),
    reversedCalculationIds: v.optional(v.array(v.id("payrollCalculations"))),
  })
    .index("by_society", ["societyId"])
    .index("by_society_employee_date", ["societyId", "employeeId", "date"])
    .index("by_society_date", ["societyId", "date"]),
  payrollOpeningBalances: defineTable({
    ...audit,
    ...opening,
    employeeId: v.id("employees"),
    legalEmployerId: v.id("societies"),
  })
    .index("by_society", ["societyId"])
    .index("by_society_employee_year", ["societyId", "employeeId", "year"])
    .index("by_society_year", ["societyId", "year"]),
  payrollCalculations: defineTable({
    ...audit,
    year: v.number(),
    periodStart: v.string(),
    periodEnd: v.string(),
    payDate: v.string(),
    runType,
    employeeIds: v.array(v.id("employees")),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("finalized"),
      v.literal("reversed"),
    ),
    inputJson: v.string(),
    resultJson: v.string(),
    sourceFingerprint: v.string(),
    resultFingerprint: v.string(),
    approvedAtISO: v.optional(v.string()),
    approvedByUserId: v.optional(v.string()),
    finalizedAtISO: v.optional(v.string()),
    finalizedByUserId: v.optional(v.string()),
    finalizeKey: v.optional(v.string()),
    payRunId: v.optional(v.id("payRuns")),
    journalEntryIds: v.optional(v.array(v.id("journalEntries"))),
    ledgerSnapshot: v.optional(ledger),
    reversedDate: v.optional(v.string()),
    reversalReason: v.optional(v.string()),
    reversalKey: v.optional(v.string()),
    reversalPayRunId: v.optional(v.id("payRuns")),
    reversalJournalEntryIds: v.optional(v.array(v.id("journalEntries"))),
    correctionOfId: v.optional(v.id("payrollCalculations")),
    payments: v.optional(v.array(payment)),
  })
    .index("by_society", ["societyId"])
    .index("by_society_year", ["societyId", "year"])
    .index("by_society_pay_date", ["societyId", "payDate"])
    .index("by_society_finalize_key", ["societyId", "finalizeKey"]),
};
