import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Accounting & budgeting tables (financial accounts, fiscal periods, journals,
 * transactions, reconciliation, budgets, subscriptions, budget snapshots),
 * extracted from convex/schema.ts (modularization). Spread back into
 * defineSchema({...}); generated data model and runtime are byte-identical.
 */
export const accountingTables = {
  financialAccounts: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    externalId: v.string(),
    code: v.optional(v.string()),
    name: v.string(),
    currency: v.string(),
    accountType: v.string(), // Bank | Credit | Income | Expense | Asset | Liability | Equity
    subtype: v.optional(v.string()),
    balanceCents: v.number(),
    isRestricted: v.boolean(),
    restrictedPurpose: v.optional(v.string()),
    sourceSystem: v.optional(v.string()), // societyer | ledgersmb | wave | csv | browser
    normalBalance: v.optional(v.string()), // debit | credit
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"])
    .index("by_society_code", ["societyId", "code"])
    .index("by_society_external", ["societyId", "externalId"]),

  accountingFiscalPeriods: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodLabel: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.string(), // open | closed | archived
    closedAtISO: v.optional(v.string()),
    closedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fiscal_year", ["societyId", "fiscalYear"])
    .index("by_society_status", ["societyId", "status"]),

  accountingCounterparties: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.string(), // vendor | customer | funder | member | employee | government | other
    provider: v.optional(v.string()), // ledgersmb | wave | societyer
    externalId: v.optional(v.string()),
    email: v.optional(v.string()),
    taxIdentifier: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_kind", ["societyId", "kind"])
    .index("by_society_external", ["societyId", "externalId"]),

  fundRestrictions: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    purpose: v.string(),
    status: v.string(), // active | released | archived
    linkedGrantId: v.optional(v.id("grants")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_grant", ["linkedGrantId"]),

  accountingAccountMappings: defineTable({
    societyId: v.id("societies"),
    provider: v.string(), // wave | ledgersmb | csv | browser | societyer
    externalAccountId: v.optional(v.string()),
    externalAccountCode: v.optional(v.string()),
    externalAccountName: v.string(),
    externalCategory: v.optional(v.string()),
    financialAccountId: v.id("financialAccounts"),
    confidence: v.optional(v.string()), // manual | high | medium | low
    status: v.string(), // active | inactive | needs_review
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_provider", ["societyId", "provider"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_account", ["financialAccountId"]),

  journalEntries: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    entryNumber: v.optional(v.string()),
    reference: v.optional(v.string()),
    date: v.string(),
    memo: v.string(),
    source: v.string(), // manual | ledgersmb | wave | csv | browser | receipt | grant | payroll | filing
    sourceExternalId: v.optional(v.string()),
    status: v.string(), // draft | posted | void
    fiscalYear: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    postedAtISO: v.optional(v.string()),
    voidedAtISO: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "date"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_source", ["societyId", "source"])
    .index("by_connection", ["connectionId"]),

  journalLines: defineTable({
    societyId: v.id("societies"),
    journalEntryId: v.id("journalEntries"),
    accountId: v.id("financialAccounts"),
    lineOrder: v.number(),
    amountCents: v.number(),
    side: v.string(), // debit | credit
    description: v.optional(v.string()),
    counterpartyId: v.optional(v.id("accountingCounterparties")),
    grantId: v.optional(v.id("grants")),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    transactionCandidateId: v.optional(v.id("transactionCandidates")),
    documentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalId: v.optional(v.string()),
    rawJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entry", ["journalEntryId"])
    .index("by_account", ["accountId"])
    .index("by_counterparty", ["counterpartyId"])
    .index("by_grant", ["grantId"])
    .index("by_fund_restriction", ["fundRestrictionId"]),

  financialTransactions: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    accountId: v.id("financialAccounts"),
    externalId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    category: v.optional(v.string()),
    categoryAccountExternalId: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    counterpartyExternalId: v.optional(v.string()),
    counterpartyResourceType: v.optional(v.string()), // vendor | customer
    // Reconciliation — match this bank line to an internal record so we can
    // prove the general ledger agrees with the bank statement.
    reconciledAtISO: v.optional(v.string()),
    reconciledByName: v.optional(v.string()),
    matchedKind: v.optional(v.string()), // filing | receipt | payroll | manual
    matchedId: v.optional(v.string()),
    reconciliationNote: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["accountId"])
    .index("by_society_date", ["societyId", "date"])
    .index("by_society_counterparty_external", ["societyId", "counterpartyExternalId"])
    .index("by_society_counterparty_external_type", ["societyId", "counterpartyExternalId", "counterpartyResourceType"])
    .index("by_society_category_account_external", ["societyId", "categoryAccountExternalId"])
    .index("by_society_category", ["societyId", "category"]),

  reconciliationRuns: defineTable({
    societyId: v.id("societies"),
    financialAccountId: v.id("financialAccounts"),
    statementDate: v.string(),
    statementBalanceCents: v.number(),
    bookBalanceCents: v.optional(v.number()),
    status: v.string(), // draft | ready | reconciled | reopened
    reconciledAtISO: v.optional(v.string()),
    reconciledByUserId: v.optional(v.id("users")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["financialAccountId"])
    .index("by_society_status", ["societyId", "status"]),

  reconciliationRunLines: defineTable({
    societyId: v.id("societies"),
    reconciliationRunId: v.id("reconciliationRuns"),
    journalLineId: v.optional(v.id("journalLines")),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    status: v.string(), // included | excluded | difference | adjustment
    amountCents: v.number(),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["reconciliationRunId"])
    .index("by_journal_line", ["journalLineId"])
    .index("by_financial_transaction", ["financialTransactionId"]),

  budgets: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    category: v.string(),
    plannedCents: v.number(),
    notes: v.optional(v.string()),
  }).index("by_society_fy", ["societyId", "fiscalYear"]),

  operatingSubscriptions: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    vendorName: v.optional(v.string()),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    interval: v.string(), // week | month | quarter | year
    status: v.string(), // Active | Planned | Paused
    nextRenewalDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  budgetSnapshots: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    periodLabel: v.optional(v.string()),
    sourceDate: v.optional(v.string()),
    currency: v.string(),
    totalIncomeCents: v.optional(v.number()),
    totalExpenseCents: v.optional(v.number()),
    netCents: v.optional(v.number()),
    endingBalanceCents: v.optional(v.number()),
    preparedByName: v.optional(v.string()),
    lastModifiedDate: v.optional(v.string()),
    sourcePageCount: v.optional(v.number()),
    importGroupKey: v.optional(v.string()),
    status: v.string(), // NeedsReview | Verified | Superseded
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fy", ["societyId", "fiscalYear"]),

  budgetSnapshotLines: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("budgetSnapshots"),
    lineType: v.string(), // income | expense | balance | note
    category: v.string(),
    parentCategory: v.optional(v.string()),
    rowKind: v.optional(v.string()), // detail | subtotal | tax | total | ytd | note
    sortOrder: v.optional(v.number()),
    description: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    projectedCents: v.optional(v.number()),
    ytdCents: v.optional(v.number()),
    sourcePage: v.optional(v.string()),
    rawLabel: v.optional(v.string()),
    rawAmountText: v.optional(v.string()),
    confidence: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"]),
};
