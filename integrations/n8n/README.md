# Societyer n8n Bridge

## Local setup

1. Copy `.env.local.example` to `.env.local` and set:
   - `SOCIETYER_WORKFLOW_CALLBACK_SECRET`
   - `N8N_ENCRYPTION_KEY`
   - `UNBC_AFFILIATE_TEMPLATE_PATH`
2. Set the same bridge values for Convex actions if your local Convex runtime
   does not inherit `.env.local`:
   ```bash
   npx convex env set SOCIETYER_WORKFLOW_CALLBACK_SECRET "same-secret-as-env-local"
   npx convex env set N8N_WEBHOOK_BASE_URL "http://n8n:5678/webhook"
   npx convex env set N8N_UNBC_AFFILIATE_WEBHOOK_PATH "societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id"
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
6. Activate the imported workflow.
7. In Societyer, create the `UNBC Affiliate ID Request` workflow and open its canvas.

The imported workflow expects Societyer to run the PDF fill service at
`http://host.docker.internal:8787/api/v1/workflow-pdf/unbc-affiliate-id/fill`
because n8n runs inside Docker on local macOS.

On n8n 2.16, the active production webhook for this imported workflow is
registered under the published workflow path, so the UNBC path is:
`societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id`.

The UNBC PDF file is intentionally not committed. The local template path is
read from `UNBC_AFFILIATE_TEMPLATE_PATH`.
