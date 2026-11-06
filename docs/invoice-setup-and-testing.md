# Invoice payment and branding setup

## Required to create a usable invoice

1. Open the intended society and confirm its legal name, mailing address, contact email and applicable tax registration. Brandkit artwork changes presentation; these organization facts continue to come from the society's records.
2. Sign in with financial write access. The built-in Owner and Admin roles can change receiving methods, templates and invoices. Directors and Viewers can review financial records but cannot make these changes. Export/download permissions are checked separately in the interface.
3. Open **Invoices → More actions → Invoice settings**. You can also use **Manage payment methods** directly in the invoice editor; both entry points use the same saved society methods and editor. Set the number prefix, next number and default payment terms. The next number must exceed all invoice numbers already allocated.
4. Choose **Add payment method** for each receiving option. Give it a recognizable name, choose **EFT / bank transfer**, **E-transfer**, **Cheque**, **Cash**, **Card / payment link**, or **Other**, and enter the payment details. For EFT, include the account holder, bank, institution, transit, account number and required payment reference. For e-transfer, include the receiving email and instructions. The account details are free text: Societyer checks that details are present, but does not verify a real bank account or initiate a transfer.
5. Check **Use by default on new invoices** for one or more methods, then save. Up to 20 methods can be saved. Leaving all default boxes unchecked is allowed. Optional **Payment instructions** are copied as additional instructions alongside the selected methods.
6. Create an invoice, choose its customer, currency, issue date, terms, line items and applicable taxes, and check **Payment methods on this invoice**. The initial selection follows the society defaults; it can be changed for this invoice. Review the preview and download a sample PDF before issuing.

Saving a card method or HTTPS payment URL prints receiving information; it does not provision a merchant account, hosted checkout, automatic collection or settlement reconciliation. Use an existing payment provider's URL if accepting card payments. The selected methods describe how the customer can pay. Actual receipts are recorded through **Record payment** and retain their amount, method, date, reference and destination account independently.

## Branding and custom designs

Open **Invoices → Setup → Templates**, start from the gallery or **New template**, and use the designer's Branding section:

- **Import Brandkit** accepts a Brandkit ZIP or JSON profile with the logo and colors. Save the branded template as the default to use that brand in the gallery and on new documents. See [Brandkit imports](brandkit-imports.md) for supported geometry and font mappings.
- **Upload custom logo** accepts PNG or JPEG files up to 175 KB, with at most 4096 pixels per side and 12 megapixels. The image is embedded in the template and copied to invoices, so it does not require a separate image-hosting service. A custom logo overrides the selected Brandkit logo while retaining the chosen document palette and typography. Remove the custom logo to restore the underlying brand or society logo.
- Set the accent color, typography, logo dimensions/alignment, page size, margins, labels, visible fields, columns and footer. Choose **Preview PDF** to inspect the actual PDF renderer and pagination. The live HTML preview is useful for editing, but it is not an exact PDF page-break preview.
- Check **Use for new invoices by default** before saving to make a reusable design the default. Templates can be duplicated, exported as JSON and imported again. Brandkit JSON imports and complete template JSON imports serve different purposes.

Brandkit lettering remains vector artwork. Document text uses bundled font families, and the interface names any fallback. Raw SVG image uploads and remote font downloads are not part of the custom-logo flow. Use the supported Brandkit JSON format for vector logos, or PNG/JPEG for custom artwork.

The invoice editor and invoice-detail preview display the generated PDF with its original page proportions on desktop and mobile. Use the shared page and zoom controls or pinch to read small text. The preview refreshes after you pause typing; downloads use the same PDF renderer and invoice data.

Information icons beside each payment method show its receiving details on desktop hover, keyboard activation, or mobile tap. The selected method shows the saved details that will appear on that invoice. Click/tap again, press Escape, or click outside to close the detail popover.

For long invoices, enable repeating headers/footers and page numbers in the template designer so continuation pages can be identified when printed or separated.

## Taxes and final prices

A line or catalog item can carry more than one tax, such as **GST 5% + PST 7%** in British Columbia. Each tax is calculated on the pre-tax amount, rounded per rate, and shown as its own amount on the invoice. Both post to **Sales tax collected** unless a tax has its own account: under **More actions → Edit GL account mapping → Sales tax by type**, choose a liability account for each tax you remit separately, such as a PST payable account. Mapping affects new postings only; existing entries stay where they are.

Enter what the customer should pay at any of three levels. All three use the invoice totals calculation, so the preview matches what is saved:

- **Catalog item:** choose the taxes, then set **Price entered** to **Tax included**, or use **Set final price** to work out a before-tax price.
- **Invoice or quote line:** use **Set final price**. The final price covers the whole line, including its quantity.
- **Whole invoice or quote:** use **Set final total** in the totals area. Line prices change in proportion, and shipping and discounts stay as entered. **Tax on all lines** can apply one tax choice first, or keep each line's own tax. Applying a total overrides those lines' price-list rates, like any manually entered price.

Before-tax prices are in whole cents and each tax rounds separately, so a few totals cannot be reached and the closest is shown with the difference. Tax-included prices reach any total on a single line at quantity 1. Choosing a tax is your decision: Societyer does not know which goods or services are exempt from a tax, and the rates are presets to check against current rules.

## Saved documents and changed defaults

Newly saved invoices retain a snapshot of their receiving details, additional payment instructions and document template. Editing a saved payment method, changing defaults, deleting a method or changing a reusable template does not rewrite these snapshots. A retained method removed from society settings can still appear as **saved with invoice** when editing that invoice. Retaining it while changing another selection preserves the original bank details; remove it explicitly if it no longer belongs on that invoice.

Duplicates retain the source invoice's receiving details and design. A recurring series created from an invoice retains that source's snapshots; a new standalone series starts with the society's defaults. New dues and repair invoices use the current society defaults. Quote conversion uses the current receiving defaults while preserving the accepted quote's document design.

Older records created before receiving-method snapshots existed cannot recover historical payment information that was never stored. Their legacy payment instructions may fall back to the current society setting until they are saved with a snapshot. Existing invoices are not silently migrated or reissued by this change.

## Additional setup for accounting and sending

Payment details alone are enough to print receiving instructions. Accurate ledger posting needs additional finance setup:

- Configure the society's books and base currency, bank/deposit accounts, and relevant accounting dates.
- Use **Invoices → More actions → Edit GL account mapping** to choose revenue mappings, accounts receivable, sales tax collected and the default deposit account. A catalog item's revenue account takes precedence over its category mapping and the default revenue account. Unmapped or otherwise blocked invoices show **Needs action**; **Post existing invoices to the ledger** can post earlier eligible invoices after setup is fixed.
- For same-currency invoices, destination accounts and linked deposits must match the invoice currency. For an invoice using explicit FX, receipts use the books currency and must match the converted settlement amount; enter the actual exchange rate and source in the receipt form. A foreign-currency price list does not imply a conversion.
- Receiving instructions do not select a ledger deposit account automatically. When recording a receipt, select or confirm its destination, payment method and reference, or link the matching bank transaction.

Ordinary **Mark as sent** and reminder actions can create an Outbox draft; they do not prove an email was delivered. Set the customer's email and optional reply-to address, download the invoice PDF, attach it, send through the chosen mail workflow and record dispatch in the Outbox. The manual Outbox interface explicitly asks users to send from their own inbox. Billing Automation is a separate optional delivery feature requiring its own provider, recipient and scheduling setup; merely choosing a receiving method or recurring invoice does not configure delivery.

## Runtime and deployment requirements

The public **/demo** interface uses fictional, in-memory data and can exercise the real shared handlers without a Convex server. It is appropriate for appearance and interaction review, but changes are not a durable society configuration. Use a configured persistent runtime—hosted/self-hosted Convex, browser IndexedDB or desktop storage—for real records. Local browser tests use an isolated IndexedDB workspace to verify persistence across reloads without touching production.

Hosted use requires the updated frontend and the updated Convex invoice functions/schema to be deployed together. The receiving-method and logo fields on existing tables are optional, so existing records remain compatible. The hosted Brandkit validator must include the portable profile's schema marker, logo variants, source typography and provenance; a successful local demo alone cannot verify that a remote deployment has this update.

Use the existing workspace export/backup flow for real records. Invoice settings, templates, invoices and recurring series are included in workspace exports. No payment-provider credentials or online payment service are required to create and download an invoice with manual receiving instructions.

## Verification

`npx tsx scripts/check-invoice-payment-methods.ts` exercises the shared handlers through the same application authorization and transaction boundary used by the local runtime. It covers defaults, explicit and empty selections, edits/deletions without changing stored bank details, duplicate/recurring/dues/repair/quote generation, email draft content, invalid or foreign method IDs, 60 reproducible varied invoice scenarios, financial write permissions, disabled memberships and verified-identity society isolation.

Also run the repository's invoice, Brandkit, browser and build checks:

```sh
npm run test:invoices
npm run test:brandkit
npm run test:invoice-payment-methods
npm run test:invoice-branding-setup
npm run test:invoice-payment-branding-ui
npm run test:invoice-preview-controls-ui
npm run test:invoice-commerce-ui
npm run test:invoice-preferences
npm run test:static-parity
npm run convex:typecheck
npm run build
```

The dedicated browser suite passed all four flows: persistent payment defaults/selections, custom-logo upload and palette changes, seeded multi-currency/Unicode/multipage invoices, and the public demo issuing an invoice. A focused mobile/public-demo check also verified separate 40-pixel payment choices and recording a partial EFT receipt with Direct deposit preselected. Six exported sample PDFs and desktop/mobile screenshots are available in the task review artifacts.

Verification also included a successful push to an isolated local Convex deployment and calls to the deployed, authorized invoice/settings/template functions using synthetic society data. The smoke check saved a portable Brandkit profile plus uploaded logo, created a multi-method invoice from the default template, then changed/deleted settings and confirmed the original and its duplicate retained their saved receiving details.

Browser checks and PDF generation establish behavior in the tested runtime. They do not establish that a production deployment is updated, that real receiving details are correct, that a bank transfer settles or that an email reaches a recipient. A real operational acceptance check should use the society's actual configured deployment, a reviewed receiving method, a downloaded invoice and its normal payment/sending workflow.
