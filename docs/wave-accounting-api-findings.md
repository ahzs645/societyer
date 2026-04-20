# Wave Accounting API Findings

Researched on 2026-04-20 against Wave's public developer documentation and the live GraphQL schema available to the Over the Edge Wave test connection.

## Summary

The Wave token is able to authenticate and read the selected business, accounts, vendors, products, and invoices. The missing credit-card and bank transaction rows are not caused by the test full-access token. They are missing because Wave's public Accounting GraphQL API does not expose a readable general-ledger transaction list.

OAuth does not appear to solve this. OAuth changes how a Wave user grants access and which scopes are attached to the token; it does not add fields that are absent from the public schema. Wave documents `transaction:write` and `transaction:*` scopes, but there is no documented `transaction:read` scope and no `business.transactions` or `account.transactions` query in the public API reference.

## Authentication

Wave supports two authentication modes:

- Full access token: development or personal integrations. The token is sent as `Authorization: Bearer <token>` and represents the creating user.
- OAuth 2: required for applications published or sold for other Wave users. As of the current docs, OAuth user authorization is limited to businesses with an active Pro or Wave Advisor subscription.

For Societyer, OAuth would be required for a production multi-user Wave connect flow, but it would not unlock historical bank or credit-card ledger rows unless Wave adds a readable transaction API.

Sources:

- [Wave Authentication](https://developer.waveapps.com/hc/en-us/articles/360018856751-Authentication)
- [Wave OAuth Guide](https://developer.waveapps.com/hc/en-us/articles/360019493652-OAuth-Guide)
- [Wave OAuth Scopes](https://developer.waveapps.com/hc/en-us/articles/360032818132-OAuth-Scopes)

## What We Can Read

The public API supports reading:

- Businesses and selected business details.
- Chart of accounts, including account type, subtype, status, currency, sequence, and balances.
- Customers.
- Vendors.
- Products and services.
- Sales taxes.
- Invoices and invoice line items.
- Specific invoice payments when fetching a specific invoice.
- Estimates.
- Currencies, countries, provinces, account types, and account subtypes.

Current Societyer support:

- The Wave cache already pulls accounts, vendors, products, available businesses, the selected business, and selected schema structures.
- Live cache currently includes vendor rows for the Over the Edge business.
- Account balances are available and can be shown per account.

## What We Cannot Read

The public API does not expose:

- A root `transactions` query.
- A `business.transactions` connection.
- An `account.transactions` connection.
- General ledger rows by account.
- Imported bank-feed transaction rows.
- Credit-card statement transaction rows.
- Vendor bill or vendor payment transaction history.
- A useful readable `Transaction` object beyond the created transaction id.

Wave's documented `Transaction` object only contains `id`. Money transaction APIs are write mutations, not list/read APIs.

This is why a Wave account like `Abduallah's Credit Card` can show a balance but still show zero synced transactions in Societyer.

Source:

- [Wave API Reference](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference)

## Partial Transaction Workarounds

### Invoice Payments

Invoice payment rows are the one useful read path that looks transaction-like. Wave documents `InvoicePayment` with payment date, amount, account, payment method, payment provider, accounting transaction id, and related invoice.

Important limitation: Wave documents that invoice payments are populated when a specific invoice is requested, not when listing invoices. To import them, Societyer would need to:

1. List invoices for the business.
2. Fetch each invoice by id.
3. Read `payments`.
4. Store those rows as Societyer transactions attached to the payment account where Wave provides one.

This would cover customer invoice payment activity. It would not cover arbitrary bank transactions, credit-card purchases, vendor expenses, journal entries, or bank-feed imports.

Probe result on 2026-04-20:

- Added a Convex diagnostic action: `waveCache:invoicePaymentProbe`.
- The probe lists invoices, then fetches each invoice by id and reads `payments`.
- The configured Over the Edge Wave business returned `0` invoices and `0` invoice payments.
- The full-access token had two accessible businesses: `Over the Edge Newspaper Society` and `Personal`.
- Probing both accessible businesses returned `0` invoices and `0` invoice payments.

Conclusion: the invoice-payment workaround is technically probeable, but the current test Wave account has no invoice payment rows to import. We should rerun this probe when a Wave business contains invoices with payments.

### CSV or Statement Import

For full bank and credit-card history, Societyer should support importing Wave exports or statement CSV files. These rows can then be mapped to Wave accounts using account ids, names, or user confirmation.

### Direct Bank Provider

If Societyer needs live bank/card transaction feeds, use a bank data provider directly. Wave can remain the source for accounts, balances, invoices, products, vendors, and write-back.

## What We Can Write

Wave supports these write operations in the public schema:

- Accounts: create, patch, archive.
- Customers: create, patch, delete.
- Invoices: create, patch, clone, delete, approve, mark sent, send.
- Invoice payments: create manual payment, patch payment, delete payment, send receipt.
- Products/services: create, patch, archive.
- Sales taxes: create, patch, archive.
- Estimates: create, approve, patch, delete, clone, convert to invoice, send.
- Money transactions: create one or bulk-create money transactions.

Money transaction write support is marked Beta and requires the business to not use classic accounting.

Key write limitations:

- `accountPatch` requires the account `sequence`.
- `invoiceSend` requires `Business.emailSendEnabled`.
- `moneyTransactionCreate` returns a created transaction id, not a full transaction read model.
- Because Wave does not expose transaction read/list, Societyer must keep its own local transaction copy for any transactions it writes.
- Public/multi-user integrations should use OAuth rather than full-access tokens.

## Vendor Data

Wave vendors can be read from `business.vendors` and `business.vendor(id)`.

Available vendor fields include:

- Name.
- First and last contact name.
- Display id / account number.
- Email.
- Mobile, phone, fax, toll-free.
- Website.
- Address.
- Internal notes.
- Default currency.
- Shipping details.
- Created and modified timestamps.
- Archived status.

Not found in the public schema:

- Vendor bills.
- Vendor bill payments.
- Vendor transaction history.
- `vendor.transactions`.

Recommended Societyer behavior:

- Keep pulling vendors into the Wave cache.
- Add a focused Vendors table/detail page similar to accounts.
- Link vendors to local expense/imported transaction rows when Societyer has CSV, receipt, or bank-provider data.
- Do not promise vendor payment history from Wave unless Wave exposes a new API.

## Recommended Societyer Implementation

1. Keep the current Wave account and balance sync.
2. Keep the clear empty-state message for bank/credit accounts explaining that Wave does not expose ledger rows.
3. Add an invoice payment importer using per-invoice detail fetches.
4. Store imported invoice payments with a source such as `wave_invoice_payment`.
5. Add CSV/statement import for bank and credit-card rows.
6. Treat Wave money-transaction writes as write-through with Societyer as the local source of truth for detailed rows.
7. Use OAuth only for the production connect flow, not as a fix for missing transaction reads.
