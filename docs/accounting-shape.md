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

### `transactionCandidates`

Represents imported or extracted source rows before posting.

Examples:

- Wave browser transaction rows
- bank statement CSV rows
- receipt extraction rows
- grant ledger intake rows
- financial statement imports

Candidates should not be treated as the general ledger.

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

## Provider Strategy

LedgerSMB is the first shape reference, not necessarily the first production connector.

Initial provider roles:

- LedgerSMB: reference model and future self-hosted sync target.
- Wave: current live accounting provider where API/browser import allows.
- CSV/browser imports: transaction intake for bank/card activity Wave does not expose through public API.

The provider adapter should map external account, journal, counterparty, and source identifiers onto Societyer tables without forcing the UI to become provider-specific.

