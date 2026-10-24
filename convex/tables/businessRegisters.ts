import { defineTable } from "convex/server";
import { v } from "convex/values";

export const payrollDeductionYtdDeltaValidator = v.object({
  regularTaxableCents: v.number(), regularPensionableCents: v.number(), regularInsurableCents: v.number(), bonusTaxableCents: v.number(), bonusPensionableCents: v.number(), bonusInsurableCents: v.number(),
  cppCents: v.number(), cpp2Cents: v.number(), eiCents: v.number(), employerEiCents: v.number(), bonusCppCents: v.number(), bonusEiCents: v.number(), cppAdditionalRegularCents: v.number(), cppAdditionalBonusCents: v.number(),
  registeredPlanCents: v.number(), unionDuesCents: v.number(), maintenanceCents: v.number(), bonusRegisteredPlanCents: v.number(), regularTaxCents: v.number(), bonusTaxCents: v.number(), additionalTaxCents: v.number(),
  regularFederalTaxCents: v.optional(v.number()), regularProvincialTaxCents: v.optional(v.number()), bonusFederalTaxCents: v.optional(v.number()), bonusProvincialTaxCents: v.optional(v.number()),
});
export const payrollClassifiedBasesValidator = v.object({ cashCents: v.number(), taxableCents: v.number(), pensionableCents: v.number(), insurableCents: v.number(), vacationableCents: v.number(), ehtCents: v.number(), workSafeCents: v.number() });
const remittanceRuleFields = { remitterType: v.string(), province: v.optional(v.string()), cadence: v.optional(v.string()), dueRule: v.optional(v.string()), dueValue: v.optional(v.number()) };
const remittanceRuleValidator = v.object(remittanceRuleFields);

/**
 * Business registers: payroll records (pay runs, CRA source-deduction
 * remittances, year-end slips, records of employment), corporate cards and
 * their monthly statements, and reserve investments (GICs, term deposits,
 * savings and investment accounts).
 *
 * Record-keeping only: Societyer does not run payroll, issue cards or move
 * money. Card rows keep the last four digits of a card number and never the
 * full number. Due dates, reconciliation and interest live in
 * shared/businessRegisters.ts; generated deadlines carry a `payroll:` or
 * `investments:` sourceKey on the deadlines table.
 */

export const payRunLineValidator = v.object({
  employeeId: v.optional(v.id("employees")),
  providerEmployeeId: v.optional(v.string()),
  employeeName: v.string(),
  provinceOfEmployment: v.optional(v.string()),
  ehtLocationId: v.optional(v.string()), ehtAttributionBasis: v.optional(v.union(v.literal("primary_reporting"), v.literal("reasonable_allocation"))), ehtAttributionEvidence: v.optional(v.string()),
  vacationAccruedCents: v.optional(v.number()), vacationPaidCents: v.optional(v.number()), sickPaidDaysUsed: v.optional(v.number()), sickUnpaidDaysUsed: v.optional(v.number()),
  grossCents: v.number(),
  nonCashTaxableCents: v.optional(v.number()),
  nonTaxableCashCents: v.optional(v.number()),
  cppEmployeeCents: v.number(),
  cpp2EmployeeCents: v.optional(v.number()),
  eiEmployeeCents: v.number(),
  incomeTaxCents: v.number(),
  federalTaxCents: v.optional(v.number()), provincialTaxCents: v.optional(v.number()), additionalIncomeTaxCents: v.optional(v.number()),
  deductionYtdDelta: v.optional(payrollDeductionYtdDeltaValidator),
  classifiedBases: v.optional(payrollClassifiedBasesValidator),
  regularClassifiedBases: v.optional(payrollClassifiedBasesValidator),
  bonusClassifiedBases: v.optional(payrollClassifiedBasesValidator),
  insurableHours: v.optional(v.number()),
  otherDeductionsCents: v.optional(v.number()),
  cppEmployerCents: v.number(),
  cpp2EmployerCents: v.optional(v.number()),
  eiEmployerCents: v.number(),
  netCents: v.number(),
});

export const businessRegisterTables = {
  payrollSettings: defineTable({
    societyId: v.id("societies"),
    remitterType: v.string(), // regular | quarterly | accelerated
    province: v.optional(v.string()),
    cadence: v.optional(v.string()), // monthly | twice_monthly | quarterly (non-regular remitters)
    dueRule: v.optional(v.string()), // day_of_next_month | days_after_period_end
    dueValue: v.optional(v.number()),
    remittanceBaseline: v.optional(remittanceRuleValidator),
    remittanceScheduleHistory: v.optional(v.array(v.object({ ...remittanceRuleFields, effectiveFrom: v.string(), noticeReference: v.string() }))),
    payrollAccountNumber: v.optional(v.string()), // CRA payroll program account (RP)
    providerName: v.optional(v.string()),
    workersCompProvider: v.optional(v.string()), // WorkSafeBC | WSIB | Other
    workersCompAccount: v.optional(v.string()),
    workersCompCadence: v.optional(v.string()), // annual | quarterly | monthly
    workersCompFirstDueDate: v.optional(v.string()),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  payRuns: defineTable({
    societyId: v.id("societies"),
    periodStart: v.string(),
    periodEnd: v.string(),
    payDate: v.string(),
    grossCents: v.number(),
    nonCashTaxableCents: v.optional(v.number()),
    nonTaxableCashCents: v.optional(v.number()),
    cppEmployeeCents: v.number(),
    cpp2EmployeeCents: v.optional(v.number()),
    eiEmployeeCents: v.number(),
    incomeTaxCents: v.number(),
    federalTaxCents: v.optional(v.number()), provincialTaxCents: v.optional(v.number()), additionalIncomeTaxCents: v.optional(v.number()),
    otherDeductionsCents: v.optional(v.number()),
    cppEmployerCents: v.number(),
    cpp2EmployerCents: v.optional(v.number()),
    eiEmployerCents: v.number(),
    netCents: v.number(),
    lines: v.optional(v.array(payRunLineValidator)),
    source: v.string(), // manual | import
    providerName: v.optional(v.string()),
    providerRunId: v.optional(v.string()),
    runType: v.optional(v.string()),
    correctsRunId: v.optional(v.id("payRuns")),
    correctionOfProviderRunId: v.optional(v.string()),
    sourceMissingFields: v.optional(v.array(v.string())),
    missingValuesConfirmed: v.optional(v.boolean()),
    calculationId: v.optional(v.id("payrollCalculations")),
    reversedDate: v.optional(v.string()),
    reversalId: v.optional(v.id("payRuns")),
    transactionId: v.optional(v.id("financialTransactions")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_pay_date", ["societyId", "payDate"]),

  payrollRemittances: defineTable({
    societyId: v.id("societies"),
    payrollAccountNumber: v.optional(v.string()),
    rpAccountEvidence: v.optional(v.string()),
    rpAccountConfirmedAtISO: v.optional(v.string()),
    rpAccountConfirmedByUserId: v.optional(v.id("users")),
    periodStart: v.string(),
    periodEnd: v.string(),
    dueDate: v.optional(v.string()),
    schedule: v.optional(remittanceRuleValidator),
    amountDueCents: v.number(),
    paidCents: v.optional(v.number()),
    paidOn: v.optional(v.string()),
    confirmationNumber: v.optional(v.string()),
    transactionId: v.optional(v.id("financialTransactions")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  payrollSlips: defineTable({
    societyId: v.id("societies"),
    year: v.number(),
    slipType: v.string(), // T4 | T4A | RL-1
    employeeId: v.optional(v.id("employees")),
    providerEmployeeId: v.optional(v.string()),
    providerName: v.optional(v.string()),
    recipientName: v.string(),
    employmentIncomeCents: v.number(),
    cppCents: v.number(),
    cpp2Cents: v.optional(v.number()), // T4 box 16A (separate from box 16)
    eiCents: v.number(),
    incomeTaxCents: v.number(),
    otherIncomeCents: v.optional(v.number()),
    status: v.string(), // draft | issued | filed
    issuedOn: v.optional(v.string()),
    filedOn: v.optional(v.string()),
    confirmationNumber: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_year", ["societyId", "year"]),

  recordsOfEmployment: defineTable({
    societyId: v.id("societies"),
    employeeId: v.optional(v.id("employees")),
    employeeName: v.string(),
    reasonCode: v.string(),
    lastDayPaid: v.string(),
    dueDate: v.optional(v.string()),
    status: v.string(), // to_issue | issued
    issuedOn: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]).index("by_society_serial", ["societyId", "serialNumber"]),

  corporateCards: defineTable({
    societyId: v.id("societies"),
    nickname: v.optional(v.string()),
    cardholderName: v.string(),
    employeeId: v.optional(v.id("employees")),
    // The last four digits only. The full card number is never stored.
    last4: v.string(),
    issuer: v.string(),
    network: v.optional(v.string()), // Visa | Mastercard | Amex | Other
    limitCents: v.optional(v.number()),
    financialAccountId: v.optional(v.id("financialAccounts")),
    agreementDocumentId: v.optional(v.id("documents")),
    status: v.string(), // active | closed
    openedOn: v.optional(v.string()),
    closedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  cardStatements: defineTable({
    societyId: v.id("societies"),
    cardId: v.id("corporateCards"),
    periodStart: v.string(),
    periodEnd: v.string(),
    statementDate: v.optional(v.string()),
    paymentDueDate: v.optional(v.string()),
    previousBalanceCents: v.number(),
    statementBalanceCents: v.number(),
    documentId: v.optional(v.id("documents")),
    reconciledAtISO: v.optional(v.string()),
    reconciledByName: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_card", ["cardId"]),

  investmentHoldings: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.string(), // gic | term_deposit | savings | investment_account | other
    institution: v.string(),
    accountLast4: v.optional(v.string()),
    principalCents: v.number(),
    ratePercent: v.optional(v.number()),
    compounding: v.optional(v.string()), // simple | annual | monthly
    startDate: v.string(),
    maturityDate: v.optional(v.string()),
    interestPaidCents: v.optional(v.number()),
    currentValueCents: v.optional(v.number()),
    restricted: v.boolean(),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    financialAccountId: v.optional(v.id("financialAccounts")),
    documentId: v.optional(v.id("documents")),
    autoRenew: v.optional(v.boolean()),
    status: v.string(), // active | redeemed
    redeemedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
};
