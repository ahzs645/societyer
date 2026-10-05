# External provider qualification

Reconciled source baseline: `66b8dcd`. The remaining-provider review fixes unconfigured delivery/payment/archive operations returning simulated success, enforces current module/role/document permissions, and binds shared provider accounts to operator-approved workspaces.

## Executed qualification

- `npm run test:provider-gap-qualification`: 33 native-handler and HTTP protocol fixture groups. Actual Convex handlers exercise explicit demo mode, configured/unconfigured adapters, authorization, module disabling, malformed/unauthorized/network failures, read retry, signed Stripe HTTP callbacks, event/session replay, demo/foreign subscription collisions, native grant ingestion/deduplication, and honest failed email delivery. Manual Paperless sync reads actual loopback source bytes through signed object-storage URLs, uploads multipart data, records a queued task and refreshes completion. Restricted documents stay hidden in sync queries. Provider completion recorders are internal-only and independently recheck the current actor, module and document authority; privileged-helper denial preserves records.
- `npm run test:provider-runner-qualification`: six groups against an actual runner process and loopback WebSocket/CDP protocol fixture. Readiness checks authenticate and probe `Browser.getVersion`, fail with 503, and recover; invalid/foreign sessions fail closed.
- `npm run test:provider-workspace-gateway`: five groups against the mounted Express gateway, actual Clerk signature verification and native Convex membership/import handlers. Missing/foreign provider bindings, Viewer/foreign workspace and disabled modules cause zero runner calls or import/run writes. Mismatched provider output is rejected before staging; a valid assigned business produces real review/import records.
- `tests/interface-provider-boundaries.spec.ts`: eight Chromium UI cases at widths 320, 390, 768 and 1440. Fresh local setup, honest unavailable Paperless controls, invalid fee draft retention, saved plan persistence, disabled offline checkout, no unexpected page errors, no provider network calls and no horizontal overflow.

Sanitized result artifacts are in `artifacts/offline/provider-{gap-qualification,runner-qualification,workspace-gateway}.json` and `artifacts/interface/provider-boundary-qualification.json`. These are protocol fixtures and browser local-mode tests, **not qualification of external provider accounts, OCR accuracy, deliverability, payments, or a persistent provider login**. No messages, charges or external account writes were performed.

## Operator configuration

Configure secrets in the server/Convex environment, never client bundles or tenant-editable settings. Names below identify the required configuration; values are intentionally omitted.

| Integration | Configuration names and remaining work |
| --- | --- |
| Paperless | `PAPERLESS_NGX_URL`, `PAPERLESS_NGX_TOKEN`, `PAPERLESS_SOCIETY_ID`. The global token authorizes exactly one operator-assigned Societyer workspace. Configure and test the actual archive/OCR service. |
| Wave | `WAVE_ACCESS_TOKEN`, `WAVE_BUSINESS_ID`, `SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON`; optional `WAVE_GRAPHQL_ENDPOINT`. The JSON object maps Societyer workspace IDs to approved Wave business IDs. Configure this in both Convex and gateway environments. Provider-account permission and actual Wave data fidelity remain unqualified. |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` or `RESEND_FROM`; `RESEND_WEBHOOK_SECRET` for signed callbacks. Register/verify the sender and callback, then qualify delivery without treating acceptance as delivery. |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`; optional `TWILIO_STATUS_CALLBACK_URL`. Qualify sender permissions and signed delivery callbacks. |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL` or `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL`. Register the real webhook and qualify with an operator-controlled Stripe test account. Live recurring subscriptions are managed in Stripe; a verified webhook updates Societyer. Local cancellation cannot stop recurring provider charges. |
| Browser runner | `CONNECTOR_RUNNER_BASE_URL`, `CONNECTOR_RUNNER_SECRET`, `BLITZBROWSER_CDP_URL`. An actual supported browser service and persistent authenticated provider session remain required. No real provider login was exercised. |
| Grants | Existing configured RSS/Atom/JSON feed URLs and outbound policy. RSS returning unrelated HTML now fails clearly. Unsupported HTML extraction or application submission remains manual. |
| Calendar | Existing ICS import and scoped published feeds are available. Google/Microsoft OAuth write-back is not implemented; no invented credentials or successful external calendar writes are claimed. |

Missing or foreign operator bindings fail before external calls. Tenant-edited business IDs and Paperless tag prefixes do not grant provider authority. Saved records remain readable subject to their existing document permissions.

The assigned Paperless archive is broader than an individual Societyer document ACL: discovering/bulk importing or pulling an external archive document requires current `settings:write` plus the existing document permissions (Owner/Admin). A Director can manually upload a document only with current document edit/download access; restricted linked materials remain protected. Simulated document bytes cannot be uploaded to a live archive.

Paperless automatic upload is disabled. New `autoUpload: true` settings are rejected and the UI directs users to manual sync. Historical settings stay readable for compatibility. An automatic worker needs an explicit actor-aware design that rechecks current workspace/module/role/document authority before every dispatch and is separately qualified; the previous unauthenticated scheduler dispatch was removed.

Provider errors do not expose response bodies or credentials. Adapter requests have bounded timeouts; irreversible deliveries and checkout calls are not automatically retried as though they were idempotent. Stripe event handling is transactionally idempotent by verified event ID and checkout session.
