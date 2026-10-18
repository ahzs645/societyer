import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  chartAccountsPortable,
  fiscalPeriodsPortable,
  counterpartiesPortable,
  fundRestrictionsPortable,
  restrictedFundBalancesPortable,
  accountMappingsPortable,
  journalEntriesPortable,
  journalEntryPortable,
  trialBalancePortable,
  generalLedgerPortable,
  exportCsvPortable,
  boardAuditorPackagePortable,
  ensureSocietyerConnectionPortable,
  seedSocietyChartOfAccountsPortable,
  upsertFiscalPeriodPortable,
  closeFiscalPeriodPortable,
  reopenFiscalPeriodPortable,
  upsertCounterpartyPortable,
  setAccountParentPortable,
  upsertFundRestrictionPortable,
  upsertAccountMappingPortable,
  upsertJournalEntryPortable,
  postTransactionCandidatePortable,
  postTransactionCandidateAllocationPortable,
  backfillFinancialTransactionsToJournalPortable,
  backfillPreviewPortable,
  postOpeningBalancesPortable,
  createReconciliationRunPortable,
  setReconciliationRunStatusPortable,
  booksSettingsPortable,
  updateBooksSettingsPortable,
  booksReportPortable,
  booksReportLinesPortable,
  generalLedgerReportPortable,
  journalEntryRegisterPortable,
  chartOfAccountsRegisterPortable,
  upsertChartAccountPortable,
  voidJournalEntryPortable,
} from "../shared/functions/accounting";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const chartAccounts = authorizedQuery("accounting:chartAccounts", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => chartAccountsPortable(await toPortableQueryCtx(ctx), args),
});

export const fiscalPeriods = authorizedQuery("accounting:fiscalPeriods", query)({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => fiscalPeriodsPortable(await toPortableQueryCtx(ctx), args),
});

export const counterparties = authorizedQuery("accounting:counterparties", query)({
  args: { societyId: v.id("societies"), kind: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => counterpartiesPortable(await toPortableQueryCtx(ctx), args),
});

export const fundRestrictions = authorizedQuery("accounting:fundRestrictions", query)({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => fundRestrictionsPortable(await toPortableQueryCtx(ctx), args),
});

export const restrictedFundBalances = authorizedQuery("accounting:restrictedFundBalances", query)({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => restrictedFundBalancesPortable(await toPortableQueryCtx(ctx), args),
});

export const accountMappings = authorizedQuery("accounting:accountMappings", query)({
  args: { societyId: v.id("societies"), provider: v.optional(v.string()), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => accountMappingsPortable(await toPortableQueryCtx(ctx), args),
});

export const journalEntries = authorizedQuery("accounting:journalEntries", query)({
  args: { societyId: v.id("societies"), status: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => journalEntriesPortable(await toPortableQueryCtx(ctx), args),
});

export const journalEntry = authorizedQuery("accounting:journalEntry", query)({
  args: { id: v.id("journalEntries") },
  returns: v.any(),
  handler: async (ctx, args) => journalEntryPortable(await toPortableQueryCtx(ctx), args),
});

export const trialBalance = authorizedQuery("accounting:trialBalance", query)({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => trialBalancePortable(await toPortableQueryCtx(ctx), args),
});

export const generalLedger = authorizedQuery("accounting:generalLedger", query)({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()), accountId: v.optional(v.id("financialAccounts")) },
  returns: v.any(),
  handler: async (ctx, args) => generalLedgerPortable(await toPortableQueryCtx(ctx), args),
});

export const exportCsv = authorizedQuery("accounting:exportCsv", query)({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    fiscalYear: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => exportCsvPortable(await toPortableQueryCtx(ctx), args),
});

export const boardAuditorPackage = authorizedQuery("accounting:boardAuditorPackage", query)({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.optional(v.string()),
    packageKind: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => boardAuditorPackagePortable(await toPortableQueryCtx(ctx), args),
});

export const ensureSocietyerConnection = authorizedMutation("accounting:ensureSocietyerConnection", mutation)({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => ensureSocietyerConnectionPortable(await toPortableMutationCtx(ctx), args),
});

export const seedSocietyChartOfAccounts = authorizedMutation("accounting:seedSocietyChartOfAccounts", mutation)({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => seedSocietyChartOfAccountsPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertFiscalPeriod = authorizedMutation("accounting:upsertFiscalPeriod", mutation)({
  args: {
    id: v.optional(v.id("accountingFiscalPeriods")),
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodLabel: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertFiscalPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const closeFiscalPeriod = authorizedMutation("accounting:closeFiscalPeriod", mutation)({
  args: { id: v.id("accountingFiscalPeriods"), lockBooks: v.optional(v.boolean()), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => closeFiscalPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const reopenFiscalPeriod = authorizedMutation("accounting:reopenFiscalPeriod", mutation)({
  args: { id: v.id("accountingFiscalPeriods"), notes: v.optional(v.string()), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => reopenFiscalPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const setAccountParent = authorizedMutation("accounting:setAccountParent", mutation)({
  args: {
    id: v.id("financialAccounts"),
    parentAccountId: v.optional(v.id("financialAccounts")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => setAccountParentPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertCounterparty = authorizedMutation("accounting:upsertCounterparty", mutation)({
  args: {
    id: v.optional(v.id("accountingCounterparties")),
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.string(),
    provider: v.optional(v.string()),
    externalId: v.optional(v.string()),
    email: v.optional(v.string()),
    taxIdentifier: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertCounterpartyPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertFundRestriction = authorizedMutation("accounting:upsertFundRestriction", mutation)({
  args: {
    id: v.optional(v.id("fundRestrictions")),
    societyId: v.id("societies"),
    name: v.string(),
    purpose: v.string(),
    status: v.string(),
    linkedGrantId: v.optional(v.id("grants")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertFundRestrictionPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertAccountMapping = authorizedMutation("accounting:upsertAccountMapping", mutation)({
  args: {
    id: v.optional(v.id("accountingAccountMappings")),
    societyId: v.id("societies"),
    provider: v.string(),
    externalAccountId: v.optional(v.string()),
    externalAccountCode: v.optional(v.string()),
    externalAccountName: v.string(),
    externalCategory: v.optional(v.string()),
    financialAccountId: v.id("financialAccounts"),
    confidence: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertAccountMappingPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertJournalEntry = authorizedMutation("accounting:upsertJournalEntry", mutation)({
  args: {
    id: v.optional(v.id("journalEntries")),
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    entryNumber: v.optional(v.string()),
    reference: v.optional(v.string()),
    date: v.string(),
    memo: v.string(),
    source: v.string(),
    sourceExternalId: v.optional(v.string()),
    status: v.string(),
    fiscalYear: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    rawJson: v.optional(v.string()),
    basis: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    lines: v.array(
      v.object({
        id: v.optional(v.id("journalLines")),
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        side: v.string(),
        description: v.optional(v.string()),
        programCode: v.optional(v.string()),
        counterpartyId: v.optional(v.id("accountingCounterparties")),
        grantId: v.optional(v.id("grants")),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
        financialTransactionId: v.optional(v.id("financialTransactions")),
        transactionCandidateId: v.optional(v.id("transactionCandidates")),
        documentIds: v.optional(v.array(v.id("documents"))),
        sourceExternalId: v.optional(v.string()),
        rawJson: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertJournalEntryPortable(await toPortableMutationCtx(ctx), args),
});

export const postTransactionCandidate = authorizedMutation("accounting:postTransactionCandidate", mutation)({
  args: {
    transactionCandidateId: v.id("transactionCandidates"),
    cashAccountId: v.id("financialAccounts"),
    offsetAccountId: v.id("financialAccounts"),
    counterpartyId: v.optional(v.id("accountingCounterparties")),
    grantId: v.optional(v.id("grants")),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    fiscalYear: v.optional(v.string()),
    memo: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => postTransactionCandidatePortable(await toPortableMutationCtx(ctx), args),
});

export const postTransactionCandidateAllocation = authorizedMutation("accounting:postTransactionCandidateAllocation", mutation)({
  args: {
    transactionCandidateId: v.id("transactionCandidates"),
    cashAccountId: v.id("financialAccounts"),
    allocations: v.array(
      v.object({
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        description: v.optional(v.string()),
        programCode: v.optional(v.string()),
        counterpartyId: v.optional(v.id("accountingCounterparties")),
        grantId: v.optional(v.id("grants")),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
        documentIds: v.optional(v.array(v.id("documents"))),
      }),
    ),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    fiscalYear: v.optional(v.string()),
    memo: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => postTransactionCandidateAllocationPortable(await toPortableMutationCtx(ctx), args),
});

const backfillCategoryChoice = v.object({ category: v.string(), accountId: v.id("financialAccounts") });

export const backfillPreview = authorizedQuery("accounting:backfillPreview", query)({
  args: {
    societyId: v.id("societies"),
    categoryChoices: v.optional(v.array(backfillCategoryChoice)),
    includeBeforeOpening: v.optional(v.boolean()),
    useSuspense: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => backfillPreviewPortable(await toPortableQueryCtx(ctx), args),
});

export const backfillFinancialTransactionsToJournal = authorizedMutation("accounting:backfillFinancialTransactionsToJournal", mutation)({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.optional(v.string()),
    limit: v.optional(v.number()),
    categoryChoices: v.optional(v.array(backfillCategoryChoice)),
    includeBeforeOpening: v.optional(v.boolean()),
    useSuspense: v.optional(v.boolean()),
    transactionIds: v.optional(v.array(v.id("financialTransactions"))),
    rememberMappings: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => backfillFinancialTransactionsToJournalPortable(await toPortableMutationCtx(ctx), args),
});

export const postOpeningBalances = authorizedMutation("accounting:postOpeningBalances", mutation)({
  args: {
    societyId: v.id("societies"),
    date: v.string(),
    fiscalYear: v.optional(v.string()),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    memo: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    lines: v.array(
      v.object({
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        side: v.string(),
        description: v.optional(v.string()),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => postOpeningBalancesPortable(await toPortableMutationCtx(ctx), args),
});

export const createReconciliationRun = authorizedMutation("accounting:createReconciliationRun", mutation)({
  args: {
    societyId: v.id("societies"),
    financialAccountId: v.id("financialAccounts"),
    statementDate: v.string(),
    statementBalanceCents: v.number(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => createReconciliationRunPortable(await toPortableMutationCtx(ctx), args),
});

export const setReconciliationRunStatus = authorizedMutation("accounting:setReconciliationRunStatus", mutation)({
  args: { id: v.id("reconciliationRuns"), status: v.string(), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => setReconciliationRunStatusPortable(await toPortableMutationCtx(ctx), args),
});

// Fund (all | unrestricted | a fund restriction id) plus generic dimensions:
// { kind: "programCode" | "counterparty" | "tag", values } (shared/booksReports.ts).
const reportFilter = v.optional(v.object({
  fund: v.optional(v.string()),
  dimensions: v.optional(v.array(v.object({ kind: v.string(), values: v.array(v.string()) }))),
}));

export const booksSettings = authorizedQuery("accounting:booksSettings", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => booksSettingsPortable(await toPortableQueryCtx(ctx), args),
});

export const updateBooksSettings = authorizedMutation("accounting:updateBooksSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    booksStartDate: v.optional(v.union(v.string(), v.null())),
    accountingBasis: v.optional(v.string()),
    closeDate: v.optional(v.union(v.string(), v.null())),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateBooksSettingsPortable(await toPortableMutationCtx(ctx), args),
});

export const booksReport = authorizedQuery("accounting:booksReport", query)({
  args: {
    societyId: v.id("societies"),
    report: v.string(),
    from: v.string(),
    to: v.string(),
    frequency: v.string(),
    basis: v.optional(v.string()),
    currency: v.optional(v.string()),
    filter: reportFilter,
    asOf: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => booksReportPortable(await toPortableQueryCtx(ctx), args),
});

export const booksReportLines = authorizedQuery("accounting:booksReportLines", query)({
  args: {
    societyId: v.id("societies"),
    accountIds: v.array(v.id("financialAccounts")),
    scope: v.string(),
    from: v.optional(v.string()),
    to: v.string(),
    basis: v.optional(v.string()),
    currency: v.optional(v.string()),
    filter: reportFilter,
  },
  returns: v.any(),
  handler: async (ctx, args) => booksReportLinesPortable(await toPortableQueryCtx(ctx), args),
});

export const generalLedgerReport = authorizedQuery("accounting:generalLedgerReport", query)({
  args: {
    societyId: v.id("societies"),
    from: v.string(),
    to: v.string(),
    accountId: v.optional(v.id("financialAccounts")),
    basis: v.optional(v.string()),
    currency: v.optional(v.string()),
    filter: reportFilter,
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => generalLedgerReportPortable(await toPortableQueryCtx(ctx), args),
});

export const journalEntryRegister = authorizedQuery("accounting:journalEntryRegister", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => journalEntryRegisterPortable(await toPortableQueryCtx(ctx), args),
});

export const chartOfAccountsRegister = authorizedQuery("accounting:chartOfAccountsRegister", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => chartOfAccountsRegisterPortable(await toPortableQueryCtx(ctx), args),
});

export const upsertChartAccount = authorizedMutation("accounting:upsertChartAccount", mutation)({
  args: {
    id: v.optional(v.id("financialAccounts")),
    societyId: v.id("societies"),
    code: v.optional(v.string()),
    name: v.string(),
    accountType: v.string(),
    subtype: v.optional(v.string()),
    normalBalance: v.optional(v.string()),
    currency: v.optional(v.string()),
    parentAccountId: v.optional(v.id("financialAccounts")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertChartAccountPortable(await toPortableMutationCtx(ctx), args),
});

export const voidJournalEntry = authorizedMutation("accounting:voidJournalEntry", mutation)({
  args: { id: v.id("journalEntries"), reason: v.optional(v.string()), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => voidJournalEntryPortable(await toPortableMutationCtx(ctx), args),
});
