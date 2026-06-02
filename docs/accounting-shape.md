# Societyer Accounting Shape

Created: 2026-06-02

## Reference System

Societyer should borrow the shape of a real accounting system without embedding a full accounting application. The first reference target is LedgerSMB.

LedgerSMB is a useful reference because it is open source, double-entry, web-based, PostgreSQL-backed, and exposes the concepts Societyer needs to remain compatible with a proper bookkeeping system: chart of accounts, general ledger, journal entries, journal lines, invoices, payments, and counterparties. Its public feature documentation describes general ledger and journal entry support through double-entry accounting, and its schema documentation exposes account and journal-entry structures.

References:

- LedgerSMB site: https://ledgersmb.org/
- LedgerSMB features: https://ledgersmb.org/index.php/content/features
- LedgerSMB database schema index: https://docs.ledgersmb.org/database-schema/1.12.0/ledgersmb.html
- LedgerSMB GitHub repository: https://github.com/ledgersmb/LedgerSMB

Wave remains the first live connector already represented in the codebase, but it should not be the internal accounting shape. Wave's public API does not expose full readable bank/card ledger transactions, so Societyer keeps Wave as a provider and browser/CSV imports as intake sources. LedgerSMB is the first shape reference for durable internal accounting records.

## Design Goal

The user-facing product remains a simplified first-party Societyer finance module:

- Cash activity
- Restricted fund balances
- Grant spend
- Budget vs actual
- Reimbursements
- Receipts and source evidence
- Board package financial summaries
- Year-end export support
- Reconciliation

Underneath that UI, Societyer should maintain accounting-compatible records so it can later sync with LedgerSMB, Wave, Xero, QuickBooks, or another ledger provider.

## Data Flow

```text
External app / CSV / browser connector / document intake
        |
        v
transactionCandidates
        |
        v
review, match, code, approve
        |
        v
journalEntries + journalLines
        |
        v
Societyer finance views and audit evidence
        |
        v
optional provider sync / write-back
```

`transactionCandidates` are source rows. They can be incomplete, duplicated, messy, or unreviewed.

`journalEntries` and `journalLines` are the durable accounting layer. Posted entries must balance. Societyer summaries should move toward reading from posted journal lines, while existing `financialTransactions` remain available during migration.

## Internal Model

## Module Boundary

Keep the codebase modular:

- `convex/accounting.ts`: Societyer internal accounting core. Owns chart of accounts, fiscal periods, counterparties, fund restrictions, journal entries, journal lines, trial balance, and posting reviewed candidates.
- `convex/financialHub.ts`: provider-facing finance hub. Owns Wave/demo/browser connection state, imported financial accounts/transactions, budgets, operating subscriptions, provider sync, and high-level summary.
- `convex/reconciliation.ts`: bank/import reconciliation workflow. It can later attach reconciliation runs to posted journal lines, but should not own journal posting logic.
- `convex/importSessions.ts`: staging/review workflow. It can create `transactionCandidates`, but posting candidates into the ledger belongs in `convex/accounting.ts`.
- Provider adapters belong under `convex/providers/*` and should map external systems into the internal accounting shape without leaking provider-specific fields into the main UI.
- `convex/providers/ledgersmbAdapter.ts`: LedgerSMB normalization boundary. It maps LedgerSMB-shaped account and journal payloads into Societyer account/journal DTOs without owning persistence.

This boundary keeps the first-party Societyer finance UI provider-neutral while still allowing Wave, LedgerSMB, CSV, and browser imports to feed the same accounting core.

### `financialConnections`

Represents an external accounting or import source.

Examples:

- `wave`
- `ledgersmb`
- `csv`
- `browser`
- `demo`

### `financialAccounts`

Represents the chart of accounts. This table now supports both Societyer and provider-compatible account shape.

Important fields:

- `code`
- `name`
- `accountType`
- `subtype`
- `currency`
- `normalBalance`
- `externalId`
- `sourceSystem`
- `isRestricted`
- `restrictedPurpose`

LedgerSMB mapping:

- account/chart id -> `externalId`
- account number/code -> `code`
- description/label -> `name`
- category/type -> `accountType`
- normal balance -> `normalBalance`

### `accountingFiscalPeriods`

Represents open and closed fiscal periods.

Used for:

- year-end boundaries
- closed-period protection
- board reporting
- audit exports

### `accountingCounterparties`

Represents vendors, customers, funders, members, employees, governments, and other entities attached to accounting activity.

This avoids overloading free-text transaction descriptions.

### `fundRestrictions`

Represents restricted funds and donor/funder purpose constraints.

This is a Societyer-specific layer on top of normal accounting because societies need to prove restricted money was used for the permitted purpose.

### `accountingAccountMappings`

Represents provider-to-Societyer chart mappings.

Examples:

- Wave account/category -> Societyer account
- LedgerSMB account id/code -> Societyer account
- CSV column/category -> Societyer account
- browser connector normalized category -> Societyer account

This keeps provider sync modular. Provider adapters should look up or suggest mappings; they should not hard-code account ids in import logic.

### `transactionCandidates`

Represents imported or extracted source rows before posting.

Examples:

- Wave browser transaction rows
- bank statement CSV rows
- receipt extraction rows
- grant ledger intake rows
- financial statement imports

Candidates should not be treated as the general ledger.

`convex/accounting.ts` includes `postTransactionCandidate`, which converts one reviewed candidate into a balanced two-line journal entry:

- incoming cash: debit cash/bank, credit revenue/receivable/other offset
- outgoing cash: credit cash/bank, debit expense/asset/liability/other offset

More complex allocations should use `upsertJournalEntry` directly with more than two lines.

### `journalEntries`

Represents an accounting event header.

Important fields:

- `date`
- `memo`
- `source`
- `sourceExternalId`
- `status`
- `fiscalYear`
- `postedAtISO`
- `sourceDocumentIds`
- `rawJson`

LedgerSMB mapping:

- journal/transaction id -> `sourceExternalId`
- reference -> `reference`
- description -> `memo`
- transaction date -> `date`
- approved/posted state -> `status`

### `journalLines`

Represents debit/credit lines for a journal entry.

Important fields:

- `journalEntryId`
- `accountId`
- `amountCents`
- `side`
- `counterpartyId`
- `grantId`
- `fundRestrictionId`
- `financialTransactionId`
- `transactionCandidateId`
- `documentIds`

Each posted journal entry should have at least two lines and equal debit and credit totals.

### `reconciliationRuns`

Represents a statement reconciliation event for one financial account.

This is separate from per-transaction match fields so Societyer can track statement date, statement balance, book balance, status, source documents, and reviewer notes.

## Migration Approach

Do not remove `financialTransactions` yet.

Use this sequence:

1. Keep existing Wave/browser/CSV imports writing `financialTransactions` and/or `transactionCandidates`.
2. Add review actions that convert selected candidates into balanced `journalEntries` and `journalLines`.
3. Update summaries to prefer posted journal lines where available.
4. Keep `financialTransactions` as a bank/import source table during migration.
5. Add LedgerSMB sync adapter once the internal journal model is exercised locally.

## What Else To Bring Over

Bring over accounting concepts in this order. Do not bring over the full LedgerSMB application surface.

1. Chart of accounts template

   Added now as a Societyer-oriented starter chart in `convex/accounting.ts`. This gives small societies a sane account list while staying compatible with LedgerSMB-style account codes and normal balances.

2. Double-entry journal validation

   Added now. Posted entries must have at least two lines, positive amounts, valid debit/credit sides, and equal debit and credit totals.

3. Trial balance

   Added now as `accounting.trialBalance`. This is the first reporting primitive to prove posted journal lines are internally consistent.

4. Candidate posting workflow

   Added now as `accounting.postTransactionCandidate`. This creates the bridge from imported rows to real accounting records.

5. Fiscal period close controls

   Added now. `accounting.closeFiscalPeriod` and `accounting.reopenFiscalPeriod` control period status. Journal posting checks for closed periods unless an explicit adjustment override is passed.

6. Opening balances

   Added now as `accounting.postOpeningBalances`. A society can seed chart accounts, enter opening cash/liability/net-asset balances, and post one balanced opening entry.

7. Account mapping rules

   Added now as `accountingAccountMappings`. Imported provider accounts/categories should map to Societyer chart accounts through this table. Wave accounts/transaction categories and CSV/browser transaction candidates now produce provider-neutral mapping candidates; approved import-session transaction candidates include resolved mapping suggestions in backend notes when an active mapping exists.

8. Multi-line allocations

   Added now as `accounting.postTransactionCandidateAllocation`. One imported bank transaction can split across multiple accounts, grants, restrictions, and documents.

9. Reconciliation runs against journal lines

   Added now as `accounting.createReconciliationRun` and `accounting.setReconciliationRunStatus`. Existing transaction-level reconciliation can remain, but formal reconciliation now compares statement balances to posted journal lines for the account.

10. LedgerSMB adapter

   Started now as `convex/providers/ledgersmbAdapter.ts`. It normalizes LedgerSMB-like account, journal entry, and journal line payloads and includes endpoint/auth scaffolding for `LEDGERSMB_BASE_URL`, `LEDGERSMB_DATABASE`, basic auth, and bearer/API-key auth. The default API boundary reads `/api/accounts` and `/api/journal-entries`; callers can override paths through the generic client `get` method if a deployed LedgerSMB instance exposes a different route shape.

11. Export formats

   Added now as `accounting.exportCsv` for `chart_of_accounts`, `trial_balance`, `journal_entries`, and `general_ledger`. This returns CSV content for UI/API download flows.

## Remaining Product/UI Work

The backend shape now supports the accounting workflow. The next product work is to expose it safely:

- Financials setup screen: seed chart of accounts, enter opening balances, create fiscal periods.
- Candidate review screen: choose cash account, offset account, or multi-line allocations before posting.
- Journal screen: list entries, inspect lines, create manual adjusting entries.
- Reconciliation screen: create statement reconciliation runs and finalize runs when differences are resolved.
- Export buttons: call `accounting.exportCsv` and download the returned CSV.
- LedgerSMB connection screen: collect connection settings and use the adapter boundary once a live API path is selected.

## Provider Strategy

LedgerSMB is the first shape reference, not necessarily the first production connector.

Initial provider roles:

- LedgerSMB: reference model and future self-hosted sync target.
- Wave: current live accounting provider where API/browser import allows.
- CSV/browser imports: transaction intake for bank/card activity Wave does not expose through public API.

The provider adapter should map external account, journal, counterparty, and source identifiers onto Societyer tables without forcing the UI to become provider-specific.
