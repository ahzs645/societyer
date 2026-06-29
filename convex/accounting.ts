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
  upsertFundRestrictionPortable,
  upsertAccountMappingPortable,
  upsertJournalEntryPortable,
  postTransactionCandidatePortable,
  postTransactionCandidateAllocationPortable,
  backfillFinancialTransactionsToJournalPortable,
  postOpeningBalancesPortable,
  createReconciliationRunPortable,
  setReconciliationRunStatusPortable,
} from "../shared/functions/accounting";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const chartAccounts = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => chartAccountsPortable(toPortableQueryCtx(ctx), args),
});

export const fiscalPeriods = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => fiscalPeriodsPortable(toPortableQueryCtx(ctx), args),
});

export const counterparties = query({
  args: { societyId: v.id("societies"), kind: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => counterpartiesPortable(toPortableQueryCtx(ctx), args),
});

export const fundRestrictions = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => fundRestrictionsPortable(toPortableQueryCtx(ctx), args),
});

export const restrictedFundBalances = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => restrictedFundBalancesPortable(toPortableQueryCtx(ctx), args),
});

export const accountMappings = query({
  args: { societyId: v.id("societies"), provider: v.optional(v.string()), status: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => accountMappingsPortable(toPortableQueryCtx(ctx), args),
});

export const journalEntries = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: (ctx, args) => journalEntriesPortable(toPortableQueryCtx(ctx), args),
});

export const journalEntry = query({
  args: { id: v.id("journalEntries") },
  returns: v.any(),
  handler: (ctx, args) => journalEntryPortable(toPortableQueryCtx(ctx), args),
});

export const trialBalance = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => trialBalancePortable(toPortableQueryCtx(ctx), args),
});

export const generalLedger = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()), accountId: v.optional(v.id("financialAccounts")) },
  returns: v.any(),
  handler: (ctx, args) => generalLedgerPortable(toPortableQueryCtx(ctx), args),
});

export const exportCsv = query({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    fiscalYear: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => exportCsvPortable(toPortableQueryCtx(ctx), args),
});

export const boardAuditorPackage = query({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.optional(v.string()),
    packageKind: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => boardAuditorPackagePortable(toPortableQueryCtx(ctx), args),
});

export const ensureSocietyerConnection = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => ensureSocietyerConnectionPortable(toPortableMutationCtx(ctx), args),
});

export const seedSocietyChartOfAccounts = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => seedSocietyChartOfAccountsPortable(toPortableMutationCtx(ctx), args),
});

export const upsertFiscalPeriod = mutation({
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
  handler: (ctx, args) => upsertFiscalPeriodPortable(toPortableMutationCtx(ctx), args),
});

export const closeFiscalPeriod = mutation({
  args: { id: v.id("accountingFiscalPeriods"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => closeFiscalPeriodPortable(toPortableMutationCtx(ctx), args),
});

export const reopenFiscalPeriod = mutation({
  args: { id: v.id("accountingFiscalPeriods"), notes: v.optional(v.string()), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => reopenFiscalPeriodPortable(toPortableMutationCtx(ctx), args),
});

export const upsertCounterparty = mutation({
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
  handler: (ctx, args) => upsertCounterpartyPortable(toPortableMutationCtx(ctx), args),
});

export const upsertFundRestriction = mutation({
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
  handler: (ctx, args) => upsertFundRestrictionPortable(toPortableMutationCtx(ctx), args),
});

export const upsertAccountMapping = mutation({
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
  handler: (ctx, args) => upsertAccountMappingPortable(toPortableMutationCtx(ctx), args),
});

export const upsertJournalEntry = mutation({
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
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    lines: v.array(
      v.object({
        id: v.optional(v.id("journalLines")),
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        side: v.string(),
        description: v.optional(v.string()),
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
  handler: (ctx, args) => upsertJournalEntryPortable(toPortableMutationCtx(ctx), args),
});

export const postTransactionCandidate = mutation({
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
  handler: (ctx, args) => postTransactionCandidatePortable(toPortableMutationCtx(ctx), args),
});

export const postTransactionCandidateAllocation = mutation({
  args: {
    transactionCandidateId: v.id("transactionCandidates"),
    cashAccountId: v.id("financialAccounts"),
    allocations: v.array(
      v.object({
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        description: v.optional(v.string()),
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
  handler: (ctx, args) => postTransactionCandidateAllocationPortable(toPortableMutationCtx(ctx), args),
});

export const backfillFinancialTransactionsToJournal = mutation({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.optional(v.string()),
    limit: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => backfillFinancialTransactionsToJournalPortable(toPortableMutationCtx(ctx), args),
});

export const postOpeningBalances = mutation({
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
  handler: (ctx, args) => postOpeningBalancesPortable(toPortableMutationCtx(ctx), args),
});

export const createReconciliationRun = mutation({
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
  handler: (ctx, args) => createReconciliationRunPortable(toPortableMutationCtx(ctx), args),
});

export const setReconciliationRunStatus = mutation({
  args: { id: v.id("reconciliationRuns"), status: v.string(), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => setReconciliationRunStatusPortable(toPortableMutationCtx(ctx), args),
});
