# Manual invoice lifecycle

This workflow is for an organization that downloads an invoice and sends it to the client itself. Societyer records preparation, delivery, the client's response and settlement separately. The manual actions do not send an email or call a delivery provider.

## What changed

The earlier invoice flow used `draft → sent` for both finalizing a document and claiming delivery. A user had to mark an invoice sent to remove Draft. There was no distinct client-response record, and ordinary issued documents could pick up a later organization name, address or logo when rendered again.

The document lifecycle is now `draft → issued → sent`, with `void` available through the existing cancellation workflow. In the interface, issuing is called **Finalize**. Payment-derived states such as **Partially paid**, **Paid** and **Overdue** remain separate from the client's response. The invoice panel shows document, delivery and client-response information together.

## Organization setup

1. Open **Organization → Organization GST/HST account**. Add the full account from the business's registration, confirm its status and effective date, and review any conflicting entries. The number belongs to the organization, not to an individual draft. See [Organization GST/HST account workflow](organization-gst-account-workflow.md).
2. Review the organization's legal name, address, email and logo before finalizing the first invoice. Finalization captures these values, including fields that were absent.
3. Configure payment instructions and receiving methods under **Invoices → Invoice settings**. Review revenue, receivable, tax and deposit account mappings before relying on automatic ledger posting. Missing mappings remain visible through **Needs action** and the existing posting tools.

No actual business account or customer information is supplied by this change. New identifier entries start as **Needs review**; a valid format is not government verification.

## Operator workflow

| Step | Action | Recorded result |
| --- | --- | --- |
| Prepare | Create or edit an invoice and **Save draft** | Editable draft; draft downloads and printouts remain marked DRAFT. |
| Finalize | **Finalize & download**, or **Finalize without downloading** | Save first, capture the issuer and tax registrations, lock document details, record issuance and perform eligible ledger posting. The PDF no longer has the draft watermark. Sending is still unrecorded. |
| Send yourself | Attach the PDF to your own email, upload it to the client's portal, or use another delivery channel | No automatic state change in Societyer. A download is not evidence of delivery. |
| Record delivery | **Record external sending** | Save date, method, recipient, optional reference and notes, plus the recording actor and timestamp. The invoice becomes sent. |
| Record response | **Record client response** | Accepted, Changes requested, Disputed or Declined, with response date, responding person/organization and optional reference. A reason is required for non-acceptance. |
| Settle | **Record payment** | Preserve the existing partial/full payment, method, account, reference and reconciliation workflow. Payment receipts are available for qualifying issued or sent invoices with recorded payment. |
| Correct | Use the existing credit, refund, void/restore or duplicate/replacement workflow | Keep the original number and history. A response alone never changes the amount owed or reverses tax. |

Client response can be updated; previous events, notes, references and actors remain visible in the timeline. Recording acceptance is a team member's report of an external conversation, not an electronic signature or client-portal approval. A client can pay without first accepting in the application. A first payment on a draft finalizes it without inventing delivery.

Bulk **Finalize drafts** prepares selected drafts. Bulk **Record external sending** is only for selected finalized invoices that have actually been sent today; the confirmation explains this. Use an individual invoice to record another date or detailed evidence. An unchanged repeat does not duplicate issuance, sending or a client response with the same idempotency key.

## Document integrity

- The final download reads the saved, authorized invoice by ID after finalization. It does not render an unsaved editor buffer. If another view finalizes an invoice while an editor has unsaved changes, preview, print and download switch to the canonical saved record and the fields become read-only.
- A PDF failure after successful finalization is reported as a download failure. The invoice remains finalized; **Download PDF** retries without allocating another invoice.
- New finalized invoices preserve the issuer name, address, email, organization registration number, organization logo reference and selected tax registrations. They already preserve their template and receiving instructions. An absent historical value does not fall back to a newly configured value.
- Original logo blobs remain retained while referenced by an invoice, including prepared or voided invoices. Current organization logo replacement/removal does not delete those historical references.
- Draft identification is always visible on invoice output, including templates that hide optional status stamps or contain custom stamp text. Finalizing replaces a literal custom DRAFT stamp with the actual invoice state. Other document kinds retain their own presentation rules.
- Automation-prepared drafts can already contain captured document facts. Those drafts remain locked, cannot be deleted as ordinary drafts, and can be finalized from the invoice panel or duplicated to prepare a changed version.

This preserves the document's captured business facts. It is not an archive of the exact original PDF bytes. Re-exporting uses the current renderer and can show the current payment balance/status. For a byte-for-byte copy of what was sent, retain the actual sent PDF with the organization's records.

Legacy invoices lacking an issuer snapshot cannot recover historical business identity that was never stored; they keep the existing legacy rendering fallback. Legacy invoices lacking a tax-registration snapshot do not borrow today's tax numbers. There is no automatic backfill of historical identity or delivery evidence.

## Sending and automation boundaries

**Draft reminder email** is available for sent invoices and creates an Outbox draft. It does not send a message. The compatibility call `markSent({ draftEmail: true })` now finalizes and creates one idempotent email draft, but returns `sent: 0` and does not set sending evidence.

Optional Billing Automation remains a separate feature. Its reminder selector, schedule validation, preparation and claim gates all require the invoice's actual lifecycle to be sent. An already-queued reminder for a finalized but unsent invoice is cancelled before transport. Finalizing a manual invoice therefore does not cause the reminder system to perform its first delivery.

For separately configured automated deliveries, the workflow identifies Billing Automation as the sender and records the provider's acceptance date, actual accepted recipients and provider references. A delayed bookkeeping retry does not substitute its processing date for the original sending date. Provider acceptance is not proof that the recipient read the message.

## GST/HST behavior and remaining limits

The existing organization identifier registry is reused. GST/HST and BC PST remain separate accounts. Selection checks active status, the invoice date and any supplied effective date; ambiguity leaves the account unselected. Newly finalized invoices retain that selection in their own tax snapshot, and HTML, print, PDF and payment receipts read it.

Guided taxable lines enforce eligible seller-registration requirements. Existing manually entered tax rates retain their compatibility behavior; they do not acquire a new mandatory-registration blocker. Saving a GST account does not decide which sales are taxable. See [Invoice seller tax registrations](invoice-tax-registrations.md) for these gates and historical limitations.

GST/HST filing screens display the current organization account, with copy and setup links, when creating, marking filed or viewing a GST/HST return. The display explicitly asks the user to confirm the account for the return and period. It does not assert that today's account was used for an earlier filed return. This change does not calculate or submit GST/HST returns, reconcile input tax credits, or add filed-account snapshots.

The design separates issuance from acceptance and payment because [CRA's general GST/HST guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4022/general-information-gst-hst-registrants.html), under “GST/HST charged and not collected,” generally requires reporting charged tax in the invoice's reporting period even if it has not been collected. The application still needs correct accounting and tax configuration; a client response is not a tax adjustment.

The full GST account format is described in [CRA's business-number and program-account guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/business-registration/business-number-program-account/need-program-accounts.html). [CRA's input tax credit guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html) describes invoice documentation requirements. Capturing finalized facts and retaining event history is an implementation choice informed by [CRA's electronic-record controls](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/15-2/electronic-records.html); it is not a claim of a compliance certification.

## Implementation and release checks

`invoices.issue`, `invoices.document` and `invoices.recordClientResponse` are available through the shared portable registry and hosted Convex wrappers. Financial read/write authorization applies. Hosted schema additions are optional for existing records, and `by_issuer_logo` supports indexed retention checks. Frontend, portable registry and Convex functions/schema must be released together.

Focused checks:

```sh
npm run test:invoice-lifecycle
npm run test:gst-account
npm run test:invoices
npm run test:tax-guidance
npm run test:invoice-money
npm run test:invoice-corrections
npm run test:billing-automation
npm run test:invoice-lifecycle-ui
npm run test:gst-account-ui
```

The lifecycle suite covers portable and native Convex authorization/schema, batch preflight, ledger posting, retries, manual-send evidence, client responses, payment and void/restore behavior, immutable snapshots, and suppression of reminders before sending. Document checks render actual HTML and PDF files, extract their text, verify every draft page, check historical identity/tax/logo behavior, and validate receipt eligibility. Logo retention checks use both portable storage and native Convex stored bytes.

The browser journeys use synthetic persistent local workspaces at desktop and phone sizes. They exercise draft download, finalization, externally recorded delivery, accepted/changed responses, partial/full payments and reload persistence, plus an unsaved editor being finalized concurrently. The GST journey saves an account through the organization form and checks filing references and the setup deep link. These commands run in the organization/tax GitHub Actions workflow for matching pull requests and manual workflow dispatches. Successful browser checks are required by this release checklist; the workflow does not itself prevent a direct push or deployment to main.

Before production release, require successful browser journeys and the repository build/typecheck gates, deploy the compatible backend and frontend together, then perform one synthetic end-to-end acceptance check on the intended runtime. A unit test or local PDF check does not establish that a production deployment has been updated.
