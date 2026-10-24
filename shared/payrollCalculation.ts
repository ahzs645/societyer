import type {
  PayrollDeductionInput,
  PayrollDeductionResult,
  PayrollDeductionYtd,
  PayrollTaxMethod,
} from "./payrollDeductions";
import type { PayrollRuleProvenance } from "./payrollRules";
import type { PayrollTd1Declaration } from "./payrollTd1Settings";
import type { PayrollStatement } from "./payrollReporting";
import type {
  BcEarningsInput,
  BcEarningsResult,
  BcEmployerCostInput,
  BcEmployerCostResult,
  PayrollCostAllocation,
} from "./payrollEarnings";

export type PayrollFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly";
export type PayrollRunType =
  | "regular"
  | "bonus"
  | "off_cycle"
  | "final"
  | "correction";
export type PayrollPaymentMethod =
  | "bank_transfer"
  | "direct_deposit"
  | "cheque"
  | "cash"
  | "other";
export type PayrollCalculationStatus =
  | "draft"
  | "approved"
  | "finalized"
  | "reversed";
export type PayrollClassifications = {
  cash: boolean;
  taxable: boolean;
  pensionable: boolean;
  insurable: boolean;
  vacationable: boolean;
  eht: boolean;
  workSafe: boolean;
};
export type PayrollEhtLocationOpening = {
  id: string;
  evidence: string;
  qualifying: boolean;
  openingRemunerationCents: number;
  openingSourceReference: string;
};
export type PayrollEmployerOverrides = {
  eiEmployerMultiplier?: number;
  reducedEiRateEvidence?: string;
  eiCoverageGroup?: string;
  benefitsCentsPerPay?: number;
  pensionPercent?: number;
  pensionBonusEligible?: boolean;
  benefitsAlreadyInEarningsCentsPerPay?: number;
  pensionAlreadyInEarningsCentsPerPay?: number;
  evidence: string;
};
export type PayrollEhtReconciliation = {
  locations: Array<{
    id: string;
    evidence: string;
    qualifying: boolean;
    openingRemunerationCents: number;
    openingSourceReference?: string;
    beforeCents: number;
    currentCents: number;
    afterCents: number;
    taxBeforeCents: number;
    taxAfterCents: number;
    taxDeltaCents: number;
  }>;
  taxDeltaCents: number;
  complete?: boolean;
  warnings?: string[];
};
export type PayrollEmployerSettingsFields = {
  year: number;
  payFrequency: PayrollFrequency;
  payDates: string[];
  eiEmployerMultiplier: number;
  reducedEiRateEvidence?: string;
  uniformEmployerAssumptionsConfirmed?: boolean;
  ehtLocations?: PayrollEhtLocationOpening[];
  ehtEmployerClass: "ordinary" | "charitable_nonprofit";
  ehtQualificationEvidence?: string;
  ehtOpeningRemunerationCents: number;
  ehtOpeningThroughDate: string;
  ehtOpeningConfirmed: boolean;
  ehtOpeningSourceReference: string;
  ehtOpeningRepresentedPayRunIds: string[];
  ehtAssociated: boolean;
  ehtAssociatedGroupRemunerationCents?: number;
  associatedGroupPermanentEstablishmentDays?: number;
  ehtExemptionAllocationCents?: number;
  ehtAllocationEvidence?: string;
  ehtPermanentEstablishmentDays: number;
  ehtLocation?: { id: string; evidence: string; qualifying: boolean };
  workSafeRatePer100Dollars: number;
  workSafeAssessableLimitCents: number;
  workSafeClassificationCode: string;
  workSafeRateEvidence: string;
  employerBenefitsCentsPerPay: number;
  employerPensionPercent: number;
  employerPensionBonusEligible?: boolean;
  benefitsAlreadyInEarningsCentsPerPay?: number;
  pensionAlreadyInEarningsCentsPerPay?: number;
  ledger?: {
    wagesExpenseAccountId?: string;
    employerExpenseAccountId?: string;
    netPayLiabilityAccountId?: string;
    deductionsLiabilityAccountId?: string;
    benefitsLiabilityAccountId?: string;
  };
};
export type PayrollEmployeeProfileFields = {
  effectiveFrom: string;
  effectiveTo?: string;
  provinceOfEmployment: string;
  employmentKind:
    | "ordinary"
    | "commission"
    | "pension"
    | "nonresident"
    | "quebec_transfer";
  salaryProration?: {
    basis: "calendar_days";
    reviewed: boolean;
    evidence: string;
  };
  compensation: "hourly" | "monthly" | "annual";
  rateCents: number;
  normalWeeklyMinutes: number;
  averageWeeklyMinutes: number;
  policy: "ordinary_bc";
  restPeriodsConfirmed: boolean;
  historyCompleteFrom: string;
  historyCompleteThrough: string;
  ytdConfirmed: boolean;
  vacationMode: "accrue" | "pay_each_cheque";
  vacationRatePercent?: number;
  vacationEachChequeAgreementConfirmed?: boolean;
  td1: {
    confirmed: boolean;
    federalClaimCents?: number;
    provincialClaimCents?: number;
    multipleEmployers?: boolean;
    federalMultipleEmployers?: boolean;
    provincialMultipleEmployers?: boolean;
    federalTaxExempt?: boolean;
    provincialTaxExempt?: boolean;
    additionalTaxCents?: number;
    taxExempt?: boolean;
    declarationReference: string;
  };
  cpp: {
    exempt: boolean;
    exemptionReason?: string;
    evidenceReference?: string;
    elections?: Array<{
      action: "stop" | "restart";
      receivedDate: string;
      retirementPensionConfirmed: boolean;
      evidence: string;
    }>;
    disabilityPeriods?: Array<{
      consideredDisabledDate: string;
      noLongerDisabledDate?: string;
      evidence: string;
    }>;
  };
  eiExempt: boolean;
  eiExemptionEvidence?: string;
  deductions?: NonNullable<PayrollDeductionInput["deductions"]>;
  portalUserId?: string;
  notes?: string;
  fundingAllocations?: PayrollCostAllocation[];
  ehtLocationId?: string;
  ehtAttributionBasis?: "primary_reporting" | "reasonable_allocation";
  ehtAttributionEvidence?: string;
  employerOverrides?: PayrollEmployerOverrides;
  fifthYearVacationReconciliation?: {
    fifthYearGrossWagesCents: number;
    vacationAlreadyPaidCents: number;
    vacationAlreadyAccruedCents?: number;
    previousVacationRatePercent: number;
    reviewed: boolean;
    evidence: string;
  };
};
export type PayrollEarningCodeFields = {
  code: string;
  name: string;
  paymentKind:
    | "regular"
    | "bonus"
    | "benefit"
    | "reimbursement"
    | "vacation"
    | "other";
  classifications: PayrollClassifications;
  classificationEvidence: string;
  active: boolean;
};
export type PayrollWorkDayFields = {
  paidVacationMinutes?: number;
  salaryVacationSourceReference?: string;
  vacationRequestId?: string;
  date: string;
  minutes: number;
  holiday?: boolean;
  sickLeave?: "paid" | "unpaid";
  restPremiumMinutes?: number;
  salaryIncludedHolidayCents?: number;
  salaryIncludedSickCents?: number;
  insurablePaidLeaveMinutes?: number;
  historicalNonOvertimeWagesCents?: number;
  workedOrEarned?: boolean;
  notes?: string;
};
export type PayrollOpeningBalanceFields = {
  year: number;
  coveredThroughDate: string;
  sameEmployerConfirmed: boolean;
  ytd: PayrollDeductionYtd;
  insurableHours: number;
  cashPaidCents: number;
  netPaidCents: number;
  vacationBalanceCents: number;
  workSafeAssessableCents: number;
  sickPaidDaysUsed: number;
  sickUnpaidDaysUsed: number;
  sourceProvider?: string;
  sourceReference: string;
  /** Only these existing runs are already represented by this opening. All
   * other owned recorded/native runs are added exactly once. */
  representedPayRunIds: string[];
  provinceOfEmployment?: string;
  employerCppCents?: number;
  employerCpp2Cents?: number;
};
export type PayrollCalculationAdjustment = {
  employeeId: string;
  earningCodeId: string;
  date: string;
  amountCents: number;
  label?: string;
  hours?: number;
  rateCents?: number;
};
export type PayrollEmployerCostOverride = {
  employeeId: string;
  benefitsCents?: number;
  pensionCents?: number;
  benefitsAlreadyInEarningsCents?: number;
  pensionAlreadyInEarningsCents?: number;
  evidence: string;
};
export type PayrollVacationPayout = {
  employeeId: string;
  amountCents: number;
  sourceReference: string;
  treatment: "vacation_leave" | "unused_cashout";
  insurableMinutes?: number;
  vacationRequestId?: string;
};
export type PayrollCalculationInput = {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  regularPayDate?: string;
  ruleEditionId?: string;
  runType: PayrollRunType;
  employeeIds: string[];
  method: PayrollTaxMethod;
  employerCostOverrides?: PayrollEmployerCostOverride[];
  vacationPayouts?: PayrollVacationPayout[];
  adjustments?: PayrollCalculationAdjustment[];
  correctionOfId?: string;
  termination?: {
    at: string;
    initiatedBy: "employer" | "employee";
    paidAt?: string;
  };
};
export type PayrollCalculatedEmployee = {
  employeeId: string;
  employeeName: string;
  provinceOfEmployment: string;
  profileId: string;
  earnings: BcEarningsResult;
  earningsInput: BcEarningsInput;
  wageHistoryProvenance?: Array<{
    date: string;
    kind: "manual" | "native" | "current";
    calculationIds?: string[];
    nonOvertimeWagesCents: number;
    workedOrEarned: boolean;
  }>;
  deductions?: PayrollDeductionResult;
  td1Declarations?: PayrollTd1Declaration[];
  employerCosts?: BcEmployerCostResult;
  employerCostInput?: BcEmployerCostInput;
  allocations?: Array<
    PayrollCostAllocation & {
      totalCents: number;
      amounts: Record<string, number>;
    }
  >;
  openingId?: string;
  ytdBefore: PayrollDeductionYtd;
  ytdAfter?: PayrollDeductionYtd;
  vacationBalanceBeforeCents?: number;
  vacationBalanceComplete?: boolean;
  ehtLocationId?: string;
  ehtAttributionBasis?: "primary_reporting" | "reasonable_allocation";
  ehtAttributionEvidence?: string;
  workDayIds: string[];
  insurableHours?: number;
  insurableHoursComplete?: boolean;
  priorVacationLiabilityReleasedCents?: number;
  currentVacationPaidCents?: number;
  warnings: string[];
  blockers: string[];
  statement?: PayrollStatement;
};
export type PayrollCalculationPreview = {
  input: PayrollCalculationInput;
  ruleEdition?: PayrollRuleProvenance;
  employees: PayrollCalculatedEmployee[];
  warnings: string[];
  blockers: string[];
  sourceFingerprint: string;
  totals: {
    taxableCents: number;
    cashCents: number;
    cppEmployeeCents: number;
    cpp2EmployeeCents: number;
    eiEmployeeCents: number;
    incomeTaxCents: number;
    otherDeductionsCents: number;
    netCents: number;
    cppEmployerCents: number;
    cpp2EmployerCents: number;
    eiEmployerCents: number;
    employerCostCents: number;
  };
  ehtReconciliation?: PayrollEhtReconciliation;
  rules: { editions: string[]; sources: string[] };
};
export type PayrollCalculationRecord = {
  _id: string;
  societyId: string;
  version: number;
  status: PayrollCalculationStatus;
  input: PayrollCalculationInput;
  result: PayrollCalculationPreview;
  sourceFingerprint: string;
  approvedAtISO?: string;
  finalizedAtISO?: string;
  reversedDate?: string;
  reversalReason?: string;
  payRunId?: string;
  journalEntryIds?: string[];
  ledgerSnapshot?: PayrollEmployerSettingsFields["ledger"];
  payments?: Array<{
    key: string;
    employeeId?: string;
    transactionId: string;
    date: string;
    amountCents: number;
    reference: string;
    method?: PayrollPaymentMethod;
    payee?: string;
    destinationReference?: string;
    recordedAtISO: string;
    journalEntryId?: string;
  }>;
  createdAtISO: string;
  updatedAtISO: string;
};
export type PayrollCalculationCollection =
  | "employer"
  | "profiles"
  | "codes"
  | "work"
  | "openings"
  | "calculations"
  | "calculation"
  | "employees"
  | "recorded_runs"
  | "accounts"
  | "funds"
  | "grants"
  | "transactions";
export type PayrollCalculationWorkspace = {
  page: Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string;
  detail?: PayrollCalculationRecord | null;
  today: string;
  organization: { name: string };
  year: number;
};

export type EmployerSettingsFields = PayrollEmployerSettingsFields;
export type EmployeeProfileFields = PayrollEmployeeProfileFields;
export type EarningCodeFields = PayrollEarningCodeFields;
export type WorkDayFields = PayrollWorkDayFields;
export type OpeningBalanceFields = PayrollOpeningBalanceFields;
export type CalculationInput = PayrollCalculationInput;
