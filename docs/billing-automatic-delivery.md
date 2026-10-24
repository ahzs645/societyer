# Automatic invoice and report delivery

Invoices → Automation provides sender settings, recurring invoice delivery, unpaid invoice reminders, saved financial report schedules, pause/resume, retry and delivery audits. A saved report also offers Schedule report. New settings and schedules are disabled until enabled by an authorized finance writer. Sender and recipient authorization must be confirmed.

Hosted Convex cron scans every five minutes, including when browsers are closed. Dates use the schedule's IANA timezone and local delivery time. Monthly dates retain the original day and clamp shorter months. A nonexistent DST time moves to the next valid wall time; repeated times run once. Recurring issue dates come from the recurring series, and paused/ended series do not issue another invoice. Due schedules are examined in durable batches of ten with a fixed scan clock. Paused sources and schedules awaiting recipient confirmation cannot hide later eligible work; completed scans revisit sources that have resumed. Each scheduled occurrence creates its invoice and durable delivery job atomically. A reminder is skipped if not yet due, paid or void, and a payment recorded after queuing cancels a pending reminder at claim.

Jobs persist a frozen JSON document snapshot and real native PDF in Convex storage before submission. Scheduled reports use the saved definition's exact filters, visible columns, calculations, section order and graphs, reading source records through separate pages of at most 200 records. Retries reuse the frozen PDF and per-recipient idempotency key; already accepted recipients are not resent. Outbox messages link each recipient to the job and its PDF. Audit history records preparation, provider submission, acceptance, errors and final invoice bookkeeping. Provider acceptance does not prove recipient delivery.

## Provider setup

Choose `SOCIETYER_EMAIL_PROVIDER=resend` or `microsoft365`. Configure secrets in the deployment environment, never in browser code or an invoice template.

Resend requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (or `RESEND_FROM`). The sender setting must match this mailbox. Delivery submits the PDF attachment with a stable `Idempotency-Key`. Resend retains these keys for 24 hours: an ambiguous submission older than 23 hours is held for provider reconciliation instead of being sent again with an expired key.

Microsoft 365 requires `MICROSOFT_MAIL_TENANT_ID`, `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` and `MICROSOFT_MAIL_SENDER`. Use dedicated application credentials with Microsoft Graph `Mail.ReadWrite` and `Mail.Send` application permissions, administrator consent and mailbox scope appropriate to the deployment. The sender setting must match this mailbox. The worker prepares a draft with a durable occurrence marker and an immutable message ID, persists the draft ID before submission, and probes that same message after an ambiguous response. It does not create a replacement message for an uncertain send. Check provider acceptance can probe an uncertain Microsoft message again; a draft still awaiting reconciliation is held rather than blindly resubmitted. Changing providers after submission is blocked until the original provider's message is reconciled.

Missing credentials or a sender mismatch produces a visible blocked job. Configure the provider and retry, or let cron retry automatically. Transient failures use exponential backoff, capped at two hours and six attempts; manual retry preserves accepted recipients and frozen content. Automatic delivery never uses the demo email transport. No live development or test emails are sent by the included checks.

## Local workspaces

The same portable schedules, occurrence records, invoices, recipient progress and audit are persisted in IndexedDB or the desktop row store. Run due schedules generates the same PDF locally. A connected native email capability must explicitly support PDF attachments and idempotent delivery; missing support produces an actionable blocked state and never marks a message accepted. Local retries retain the frozen PDF in the local job. The panel checks due schedules every minute while open. Use hosted scheduling for execution while the local app is closed.

## Checks

`npx tsx scripts/check-billing-automation.ts` exercises timezone/DST behavior, disabled defaults, consent and workspace permissions, enabled paused-source and unconfirmed-recipient prefixes, bounded cursor progress and hosted continuation clocks, independent schedule/history pagination, single recurring issuance, leases, frozen exact report filters and PDFs, real Node PDF output, connected-native partial-failure retries, payment-after-queue cancellation, and mocked Resend/Microsoft transport including attachments, provider switching, idempotency and ambiguous-send recovery.

`npx playwright test --config playwright.billing-automation.config.ts` checks the real local application flow, settings/schedule reload persistence, enable/pause controls, one recurring invoice, blocked native delivery and audit visibility. Tests use synthetic example.test addresses and mocked transport only.
