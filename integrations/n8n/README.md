# Societyer n8n Bridge

## Local setup

1. Copy `.env.local.example` to `.env.local` and set:
   - `SOCIETYER_WORKFLOW_CALLBACK_SECRET`
   - `N8N_ENCRYPTION_KEY`
   - `UNBC_AFFILIATE_TEMPLATE_PATH`
   - `UNBC_KEY_REQUEST_TEMPLATE_PATH` if you want to run the key/access request workflow
2. Set the same bridge values for Convex actions if your local Convex runtime
   does not inherit `.env.local`:
   ```bash
   npx convex env set SOCIETYER_WORKFLOW_CALLBACK_SECRET "same-secret-as-env-local"
   npx convex env set N8N_WEBHOOK_BASE_URL "http://n8n:5678/webhook"
   npx convex env set N8N_UNBC_AFFILIATE_WEBHOOK_PATH "societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id"
   npx convex env set N8N_UNBC_KEY_REQUEST_WEBHOOK_PATH "societyer-unbc-key-access-request/societyer%2520webhook/societyer/unbc-key-access-request"
   npx convex env set N8N_OTE_KEYCARD_WEBHOOK_PATH "societyer-ote-individual-access-request/societyer%2520webhook/societyer/ote-individual-access-request"
   npx convex env set N8N_AGM_DATE_DEADLINES_WEBHOOK_PATH "societyer-agm-date-deadlines/societyer%2520webhook/societyer/governance/agm-date-deadlines"
   npx convex env set N8N_FILING_DUE_NOTIFY_OFFICER_WEBHOOK_PATH "societyer-filing-due-notify-officer/societyer%2520webhook/societyer/governance/filing-due-notify-officer"
   npx convex env set N8N_CONFLICT_DISCLOSED_AGENDA_ITEM_WEBHOOK_PATH "societyer-conflict-disclosed-agenda-item/societyer%2520webhook/societyer/governance/conflict-disclosed-agenda-item"
   npx convex env set SOCIETYER_WORKFLOW_CALLBACK_URL "http://host.docker.internal:8787/api/v1/workflow-callbacks/n8n"
   npx convex env set SOCIETYER_WORKFLOW_PDF_FILL_URL "http://host.docker.internal:8787/api/v1/workflow-pdf/unbc-affiliate-id/fill"
   ```
3. Start the local services:
   ```bash
   docker compose up -d
   npm run dev:full
   ```
4. Open n8n at `http://127.0.0.1:5678`.
5. Import `integrations/n8n/unbc-affiliate-id.workflow.json`.
   Import `integrations/n8n/unbc-key-access-request.workflow.json` as well for the Facilities key/access form.
   Import `integrations/n8n/ote-individual-access-request.workflow.json` for the Over the Edge individual access workflow.
   Import the governance-native n8n recipes as needed:
   - `integrations/n8n/agm-date-deadlines.workflow.json`
   - `integrations/n8n/filing-due-notify-officer.workflow.json`
   - `integrations/n8n/conflict-disclosed-agenda-item.workflow.json`
6. Activate the imported workflow.
7. In Societyer, create the `UNBC Affiliate ID Request` workflow and open its canvas.

The imported workflow expects Societyer to run the PDF fill service at
`http://host.docker.internal:8787/api/v1/workflow-pdf/unbc-affiliate-id/fill`
because n8n runs inside Docker on local macOS.

On n8n 2.16, the active production webhook for this imported workflow is
registered under the published workflow path, so the UNBC path is:
`societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id`.

The Over the Edge individual access workflow defaults to n8n and posts selected
director/volunteer/employee intake to:
`societyer-ote-individual-access-request/societyer%2520webhook/societyer/ote-individual-access-request`.
That n8n workflow calls Societyer's callback endpoint with `run.completed`; the
Outbox draft is then queued by Societyer from the configured Email node.

## Governance n8n recipes

The governance recipes are n8n-only. Societyer exposes catalog/setup metadata,
stores the webhook link, and records n8n callbacks; it does not run internal
workflow logic for these recipes.

- AGM date set -> generate deadlines:
  `societyer-agm-date-deadlines/societyer%2520webhook/societyer/governance/agm-date-deadlines`
- Filing due in 14 days -> notify officer:
  `societyer-filing-due-notify-officer/societyer%2520webhook/societyer/governance/filing-due-notify-officer`
- Conflict disclosed -> add board agenda item:
  `societyer-conflict-disclosed-agenda-item/societyer%2520webhook/societyer/governance/conflict-disclosed-agenda-item`

The committed templates are intentionally conservative: they accept the
Societyer webhook payload, prepare governance-specific metadata, and call the
Societyer callback endpoint. Add the actual API calls for creating deadlines,
sending officer notifications, or staging board agenda items inside n8n.

The UNBC PDF file is intentionally not committed. The local template path is
read from `UNBC_AFFILIATE_TEMPLATE_PATH`.

The key/access request PDF is also intentionally not committed. Set
`UNBC_KEY_REQUEST_TEMPLATE_PATH` to the local fillable PDF path, for example:
`/Users/ahmadjalil/Downloads/201019-keyrequestform-fillable (1).pdf`.
