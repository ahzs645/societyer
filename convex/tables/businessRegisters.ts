import { defineTable } from "convex/server";
import { v } from "convex/values";

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
  employeeName: v.string(),
  grossCents: v.number(),
  cppEmployeeCents: v.number(),
  eiEmployeeCents: v.number(),
  incomeTaxCents: v.number(),
  otherDeductionsCents: v.optional(v.number()),
  cppEmployerCents: v.number(),
  eiEmployerCents: v.number(),
  netCents: v.number(),
});

export const businessRegisterTables = {
  payrollSettings: defineTable({
    societyId: v.id("societies"),
    remitterType: v.string(), // regular | quarterly | accelerated
    cadence: v.optional(v.string()), // monthly | twice_monthly | quarterly (non-regular remitters)
    dueRule: v.optional(v.string()), // day_of_next_month | days_after_period_end
    dueValue: v.optional(v.number()),
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
    cppEmployeeCents: v.number(),
    eiEmployeeCents: v.number(),
    incomeTaxCents: v.number(),
    otherDeductionsCents: v.optional(v.number()),
    cppEmployerCents: v.number(),
    eiEmployerCents: v.number(),
    netCents: v.number(),
    lines: v.optional(v.array(payRunLineValidator)),
    source: v.string(), // manual | import
    providerName: v.optional(v.string()),
    transactionId: v.optional(v.id("financialTransactions")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_pay_date", ["societyId", "payDate"]),

  payrollRemittances: defineTable({
    societyId: v.id("societies"),
    periodStart: v.string(),
    periodEnd: v.string(),
    dueDate: v.optional(v.string()),
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
    recipientName: v.string(),
    employmentIncomeCents: v.number(),
    cppCents: v.number(),
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
  }).index("by_society", ["societyId"]),

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
