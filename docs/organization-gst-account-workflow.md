# Organization GST/HST account workflow

## Save the business account once

Open **Organization** (`/app/society`). The **Organization GST/HST account** card is visible above the editable organization profile. **Add GST/HST account** opens the existing organization identifier form with **GST/HST registration** selected.

Enter the full account from the organization's registration (nine digits, `RT`, four digits). Spaces and letter case are normalized. A nine-digit business number alone is not a GST/HST account. New entries start as **Needs review**; change the status to **Active** only after confirming the registration, and supply its effective date when known. Saving an active GST entry with an invalid account format is rejected by the existing backend validation.

**Manage tax identifiers** opens the **Tax and registry identifiers** section under **More organization details**. The same section can be linked directly with `/app/society#tax-identifiers`. GST/HST, BC PST and other identifiers remain distinct records; no account is duplicated onto each draft invoice.

## Invoices

The existing seller registration selection uses the invoice date, active status and supplied effective dates. New issued invoices retain their own registration snapshot for HTML, print, PDF and receipts. Changing the organization's current account does not rewrite previously issued invoices. Guided taxable items require the applicable eligible seller account before issuance. See [Invoice seller tax registrations](invoice-tax-registrations.md) for the exact gates and legacy behavior.

## GST/HST filings

When creating a **GST/HST return**, opening its **Mark filed** form, or viewing its filed record, Societyer shows the current organization account with a copy button and a link back to organization tax identifiers. The panel requires organization read access. It explicitly describes this as the current account and asks the user to confirm the account for the return and reporting period. It does not claim that today's number was used on an old return.

Missing, unconfirmed, invalid, inactive, future-dated and conflicting eligible accounts produce a specific review message instead of a copyable number. Duplicate records containing the same normalized account remain unambiguous. A bare business number is never expanded to an assumed `RT0001` account.

This reference panel does not calculate or submit a GST/HST return. CRA Filing pre-fill currently supports T2, T1044 and T3010 only. GST/HST reporting-period calculations, input tax credit review, adjustments and filed-account snapshots remain separate work. Filing submission stays external; **Mark filed** records the existing user-supplied submission evidence.

## Validation

```sh
node --import tsx scripts/check-gst-account-reference.tsx
node_modules/.bin/playwright test --config playwright.gst-account.config.ts
```

The first check covers account eligibility, ambiguous accounts, number display/copy, read permissions and the unsupported GST return-calculation boundary. The browser journey saves an organization account through its visible form, reloads it, checks it on a new filing and the mark-filed screen, and verifies the tax-identifier deep link at desktop and phone sizes. It uses synthetic local workspace data only.
