# Societyer

A React + Convex app for tracking **BC Societies Act** compliance — registers, meetings & minutes, filings, deadlines, documents, conflicts of interest, financial statements, and PIPA privacy.

> Not legal advice. Statutory references (s.11, s.20, s.40, s.42, s.56, s.36 etc.) are based on the BC Societies Act as summarised in the accompanying compliance notes — verify against the current Act and your bylaws before acting.

---

## Stack

- **Vite + React 18 + TypeScript**
- **Convex** for live-reactive data (works against hosted Convex *or* a self-hosted `convex-backend`)
- **Express** auth/API sidecar for Better Auth, OpenAPI docs, API keys, webhooks, and local maintenance routes
- **Better Auth** for optional real login/session handling
- **react-router-dom**, **lucide-react**, **date-fns**, **i18next**, **zustand**
- Optional local services: RustFS object storage, n8n workflows, and BlitzBrowser-backed browser connectors

No CSS framework — a small set of hand-rolled tokens in `src/theme/tokens.css` mimic Twenty's design language.

---

## Quick start — self-hosted Convex (local, Docker)

The repo ships a `docker-compose.yml` that runs the official Convex backend/dashboard plus local support services. No need to clone anything else.

### 1. Bring up the Convex backend

```bash
cd /Users/ahmadjalil/github/societyer
npm install
cp .env.local.example .env.local
npm run docker:up        # (= docker compose up -d)
```

This starts:
- **Backend API** → http://127.0.0.1:3220
- **HTTP actions** → http://127.0.0.1:3221
- **Dashboard** → http://127.0.0.1:6792
- **RustFS S3 API** → http://127.0.0.1:9790
- **RustFS console** → http://127.0.0.1:9791
- **n8n workflow runtime** → http://127.0.0.1:5678
- **Auth/API gateway** → http://127.0.0.1:8787
- **API docs** → http://127.0.0.1:8787/api/docs

Tail logs: `npm run docker:logs`. Stop everything: `npm run docker:down`. Wipe the database: `docker compose down -v`.

### 2. Generate an admin key & configure env

```bash
npm run docker:admin-key    # prints the admin key — paste into .env.local
```

Your `.env.local` should end up looking like:

```
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3220"
CONVEX_SELF_HOSTED_ADMIN_KEY="<the key the script printed>"
VITE_CONVEX_URL="http://127.0.0.1:3220"
```

If you are using the RustFS service under OrbStack for document version uploads, create the local bucket and point Convex at the service domain:

```bash
npm run rustfs:setup
```

If the helper script can't find the binary in your image version, open the dashboard (http://127.0.0.1:6792) — it can generate one too.

### 3. Push the schema & start the app

```bash
npx convex dev           # terminal 1 — pushes ./convex to localhost:3210
npm run dev              # terminal 2 — Vite at http://localhost:5173
```

`docker:up` already starts the auth/API gateway container. If you stop that container and want to run the gateway directly on the host instead, use `npm run dev:full`.

### 4. Seed the demo society

- Click **Seed demo society** in the in-app demo banner, **or**
- `⌘K` → "Seed demo society" in the command palette, **or**
- `npm run convex:seed` from the terminal

In-app seed/reset calls go through the local API gateway so the Convex maintenance token never reaches the browser. Wipe with the settings page or `npm run convex:reset`.

---

## Quick start — hosted Convex (if you just want to try it)

```bash
npm install
npx convex dev           # will prompt you to log in; creates a free cloud deployment
npm run dev
```

## Quick start — frontend against Kubernetes

Use this when the Kubernetes stack is already running and you only want a local
Vite frontend pointed at the shared K8s Convex data:

```bash
npm install
npm run dev:k8s
```

The command starts Vite at http://127.0.0.1:5173 with:

```
VITE_CONVEX_URL=http://societyer.k8s.home:3220
VITE_AUTH_MODE=none
```

Override the backend URL if DNS is unavailable or you are working against a
different cluster:

```bash
VITE_CONVEX_URL=http://192.168.1.50:3220 npm run dev:k8s
```

This is for frontend work against existing deployed data. Convex function,
schema, or server/API changes still need to be deployed to the target K8s
runtime with a valid `CONVEX_SELF_HOSTED_ADMIN_KEY`.

---

## Demo mode

- The in-app banner appears whenever demo mode is on (default).
- Toggle in **Settings → Demo mode**.
- Append `?demo=0` to any URL to suppress it, `?demo=1` to force it on.
- The seeded society is **Riverside Community Society** — a fictional BC charity with 7 directors, 15 members, two past meetings (a 2025 AGM and a Q4 board meeting), minutes with motions/decisions/action items, filed and upcoming filings (annual report, T3010, T4, GST/HST, bylaw amendment, change of directors), recurring deadlines, a disclosed conflict of interest, FY2024-25 financials with remuneration disclosure, and a document repository with retention flags.

## Public site vs full app

- `/` opens the backend-backed workspace app. In auth-enabled deployments it
  gates into login; in no-auth deployments it opens the dashboard directly.
- `/demo` boots the same React app shell and `/app/...` routes in a browser-only in-memory fixture mode. It does not require Convex, auth, localStorage app state, IndexedDB, SQLite, or seeded backend data.
- Inside demo mode, app links are automatically scoped under `/demo`, so `/app/filings` becomes `/demo/app/filings`.
- `/app` remains supported as a workspace route alias for existing links.
- `/public/:slug` and other operational routes still expect the live app stack.

## Auth modes

Societyer now supports two identity modes:

- **`VITE_AUTH_MODE=none` / `AUTH_MODE=none`** — keep the current local/demo workflow. The user picker remains available and no auth server is required.
- **`VITE_AUTH_MODE=better-auth` / `AUTH_MODE=better-auth`** — enable Better Auth for real login/session handling. Start the auth sidecar alongside Vite:

```bash
npm run dev:full
```

Running the auth sidecar directly requires Node 22.5+ because Better Auth uses `node:sqlite`. The Docker auth-server service already uses Node 22.

## Configurable modules

Settings → Modules can enable or hide optional surfaces by society. Current module groups include:

- **Engagement**: Communications, volunteer management, and grant management.
- **Governance**: voting and resolutions, elections, proxies, auditors, director attestations, and court orders.
- **Compliance**: filing pre-fill, records retention/inspection, PIPA training, insurance, access custody, and public transparency.
- **Finance**: reconciliation, donation receipts, membership billing, employee records, and grant finance workflows.
- **Integrations**: Paperless-ngx, browser connectors, and workflow automation.

## Live integrations

- **Resend**: set `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` to turn digest emails and communications into real outbound email.
- **Twilio**: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` for SMS delivery and callback tracking.
- **Stripe**: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to enable real hosted checkout. Point Stripe webhooks at Convex HTTP route `/stripe/webhook`.
- **Wave**: set `WAVE_ACCESS_TOKEN` and `WAVE_BUSINESS_ID` to switch the accounting sync from demo data to live GraphQL fetches. `WAVE_CLIENT_ID` and `WAVE_CLIENT_SECRET` are reserved for OAuth setup and are reported only as present/missing in diagnostics; `WAVE_GRAPHQL_ENDPOINT` is an optional override for the default Wave GraphQL endpoint. The Financials page includes a Wave health check that reports only present/missing env status plus redacted provider diagnostics. See [docs/wave-accounting-api-findings.md](/Users/ahmadjalil/github/societyer/docs/wave-accounting-api-findings.md) for the current read/write limits, including Wave's lack of a public bank/credit-card ledger transaction read API.
- **Paperless-ngx**: set `PAPERLESS_NGX_URL` and `PAPERLESS_NGX_TOKEN`, then enable the Paperless-ngx module at `/app/paperless`. Documents can be sent to Paperless from `/app/documents`; Societyer creates contextual tags such as document category, filing kind, grant report, PIPA training, election evidence, and volunteer screening.
- **RustFS / S3-compatible storage**: set `RUSTFS_ENDPOINT`, `RUSTFS_BUCKET`, `RUSTFS_ACCESS_KEY`, and `RUSTFS_SECRET_KEY` for storage-backed document versions. The bundled Docker stack includes RustFS for local development.
- **OpenAI / Anthropic / Whisper-compatible transcription**: set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `WHISPER_API_KEY`, or `WHISPER_ENDPOINT` to move meeting transcription and minute drafting out of deterministic demo mode.
- **n8n**: set the `N8N_*` and `SOCIETYER_WORKFLOW_*` values to run workflow bridge recipes, including the committed UNBC and Over the Edge examples in [integrations/n8n](/Users/ahmadjalil/github/societyer/integrations/n8n).
- **Browser connectors**: run `npm run docker:connectors` and set `CONNECTOR_RUNNER_SECRET` to enable saved browser sessions, connector actions, and exports through BlitzBrowser.
- **Access custody vault**: set `SECRET_VAULT_ENCRYPTION_KEY` before storing client credentials in production. `/app/access-custody` encrypts stored values, keeps them hidden by default, and logs explicit reveals to the activity trail.
- **Filing evidence**: BC still has no public Societies Online filing API. This build improves the manual path by storing submission method, confirmation number, fee paid, and linked receipt/evidence documents when a filing is marked filed.

Auth mode uses a small SQLite auth database configured by `AUTH_DB_PATH`, and maps signed-in identities into the existing Convex `users` / `members` records.

## API gateway

The auth sidecar also mounts Societyer's REST API gateway:

- **OpenAPI JSON**: `/api/openapi.json`
- **Swagger UI**: `/api/docs`
- **Versioned API**: `/api/v1`

The gateway exposes society, people, governance, filings, documents, finance, volunteer, grant, workflow, plugin, webhook, API-client, and API-token resources backed by Convex. Local development can use trusted localhost requests; production should configure `SOCIETYER_API_PLATFORM_TOKEN`, `SOCIETYER_MAINTENANCE_TOKEN`, `API_TOKEN_PEPPER`, and `API_SECRET_ENCRYPTION_KEY`.

## GitHub Pages deployment

This repo now includes a GitHub Pages workflow at [.github/workflows/deploy-pages.yml](/Users/ahmadjalil/github/societyer/.github/workflows/deploy-pages.yml) and a custom-domain file at [public/CNAME](/Users/ahmadjalil/github/societyer/public/CNAME).

For the public site:

- `npm run build:pages` builds the app with stable `assets/index.js` and `assets/index.css` filenames, writes `dist/404.html` for SPA fallback, and writes `dist/demo/index.html` so `/demo` resolves directly.
- `/demo` uses [src/lib/staticConvex.ts](/Users/ahmadjalil/github/societyer/src/lib/staticConvex.ts) to satisfy the real frontend's Convex queries with in-memory fixture data, and [src/lib/staticRuntime.ts](/Users/ahmadjalil/github/societyer/src/lib/staticRuntime.ts) keeps demo-only app state out of persistent browser storage.
- The configured custom domain is `society.ahmadjalil.com`.
- In the GitHub repository settings, Pages should use **GitHub Actions** as the source.

---

## What's in it

| Area | Page | Notes |
|---|---|---|
| Workspace | `/` | Backend-backed app entry point; opens the dashboard after auth/no-auth resolution |
| Public | `/demo` Browser-only demo | The real app frontend using an in-memory Convex-compatible fixture client |
| Public | `/public/:slug` | Transparency center with optional volunteer and grant intake pages |
| Workspace | `/app`, `/app/society`, `/app/organization-details`, `/app/org-history` | Compliance dashboard, legal profile, organization identifiers/addresses/registrations, and source-backed history |
| People | `/app/members`, `/app/directors`, `/app/role-holders`, `/app/committees` | Member and director registers, role holders, committees, goals, tasks, and committee-linked work |
| Work | `/app/tasks`, `/app/deadlines`, `/app/commitments`, `/app/documents`, `/app/library` | Work tracking, recurring deadlines, obligation extraction, document workbench, document versions, and board/library packets |
| Meetings & votes | `/app/meetings`, `/app/agendas`, `/app/minutes`, `/app/elections`, `/app/proposals`, `/app/proxies` | Meeting packages, AGM workflow, motions, minutes, member proposals, anonymous ballots, written resolutions, and proxies |
| Governance records | `/app/conflicts`, `/app/attestations`, `/app/auditors`, `/app/governance-registers`, `/app/minute-book` | Conflict disclosures, annual director attestations, auditors, evidence registers, minute-book assembly, and bylaw-driven rules |
| Compliance | `/app/filings`, `/app/filings/prefill`, `/app/privacy`, `/app/retention`, `/app/inspections`, `/app/access-custody` | Registry/CRA filing tracker, filing pre-fill, PIPA program, records inspection, retention, insurance, and credential custody |
| Finance | `/app/financials`, `/app/finance-imports`, `/app/treasurer`, `/app/reconciliation`, `/app/receipts`, `/app/membership` | Financial years, Wave cache views, treasurer workflows, imports, reconciliation, donation receipts, and Stripe-backed billing |
| Engagement | `/app/communications`, `/app/volunteers`, `/app/grants`, `/app/transparency` | Campaigns, AGM notice proofs, volunteer screening/intake, grant pipeline/intake, and public transparency publishing |
| Workflows | `/app/workflows`, `/app/workflow-runs`, `/app/workflow-packages`, `/app/browser-connectors`, `/app/template-engine` | Workflow canvas, n8n bridge runs, generated document packages, browser-backed connectors, and template field mapping |
| Administration | `/app/users`, `/app/custom-fields`, `/app/imports`, `/app/paperless`, `/app/audit`, `/app/exports`, `/app/settings` | Users/roles, custom fields, import sessions, Paperless sync, audit log, redacted data export, modules, auth mode, and runtime settings |

Press `⌘K` (or `Ctrl+K`) anywhere for the command palette.

---

## Meeting transcription and minute drafting

`convex/minutes.ts` exports `generateDraft` as a Convex action. In demo mode it returns deterministic draft minutes; with provider env vars it can call the live LLM/transcription adapters:

- `OPENAI_API_KEY`, `OPENAI_MODEL`, or `OPENAI_MINUTES_MODEL` for OpenAI chat completions.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, or `ANTHROPIC_MINUTES_MODEL` for Anthropic messages.
- `WHISPER_API_KEY`, `WHISPER_ENDPOINT`, or `OPENAI_API_KEY` for audio transcription.

The meeting detail UI already uploads audio, tracks transcription jobs, stores the transcript, and pipes text into `generateDraft`.

---

## Useful scripts

- `npm run build` — Convex typecheck, TypeScript build, and Vite production build.
- `npm run build:pages` — GitHub Pages build with stable asset names and `/demo` fallback files.
- `npm run dev:k8s` — run a local Vite frontend against the Kubernetes Convex backend at `societyer.k8s.home:3220`.
- `npm run lint` / `npm run lint:convex` — ESLint for the app or Convex functions.
- `npm run test:smoke` — Playwright smoke tests.
- `npm run test:api-contract` — API gateway contract check.
- `npm run test:dashboard-compliance` — dashboard compliance rule check.
- `npm run test:org-details` — organization detail smoke check.
- `npm run test:pdf-ingestion` — PDF table normalization check.
- `npm run test:exports` / `npm run test:exports:db` — export coverage and database export validation.
- `npm run docker:connectors` — start the optional connector-runner, BlitzBrowser, and connector dashboard profile.
- `npm run connector-runner:typecheck` — typecheck the browser connector service.
- `npm run templates:json` / `npm run templates:exports` — regenerate starter policy template JSON and rendered documents.

---

## Project status

### Current

- BC society workspace records: society profile, members, directors, meetings, minutes, conflicts, filings, deadlines, documents, bylaws, privacy, financials, elections, grants, volunteers, transparency, and module settings.
- Public/static demo and backend-backed app modes: `/demo` runs without Convex or auth; `/app` runs against hosted or self-hosted Convex.
- Identity modes: `none` keeps the local/demo user picker; `better-auth` enables real login/session handling through the auth sidecar.
- Multi-society data model and workspace selection: the app can list society records and persists the selected society locally.
- Document files and versions: Convex storage uploads plus RustFS-backed document version uploads are wired into the document workflows.
- Filing support: Societies Online and CRA pre-fill payloads can be reviewed, copied, and exported for manual filing; filed records store submission method, confirmation number, fee, and evidence.
- Audit surfaces: the audit log page, election audit trail, exports with redaction, and access-custody reveal logging are available.
- Live integrations behind environment flags: Resend email, Twilio SMS, Stripe checkout/webhooks, Wave accounting sync, Paperless-ngx document sync/import, RustFS storage, LLM/transcription adapters, n8n workflows, and browser connectors.

### Beta

- Better Auth production rollout: login/session handling is implemented, but production deployments still need env hardening, domain/cookie review, and operational migration testing.
- Payment and email operations: Stripe and Resend paths exist, but should be tested against real provider accounts before depending on them for a society's live workflows.
- SMS operations: Twilio delivery and callbacks exist, but phone-number registration and consent workflows need provider-specific production review.
- Wave accounting: account, balance, vendor, product, invoice, and provider diagnostics are supported within Wave's public API limits; bank and credit-card ledger reads still require CSV/import or another data source.
- Paperless-ngx automation: document sync, tags, and source-document import flows exist and should be validated against each organization's Paperless taxonomy before broad use.
- Multi-society operations: multiple records and selection work, but account-level permissions, membership scoping, and admin controls need more production review.
- Workflow and browser automation: n8n bridge recipes and BlitzBrowser connector sessions are available for local/operator-driven workflows, but should be treated as controlled automation rather than unattended filing authority.

### Planned

- Direct Societies Online submission or browser-assisted filing beyond pre-fill review, subject to BC Registry access constraints.
- More robust speaker diarization and transcript review tooling for meeting minutes.
- Slack or other non-email deadline reminders.
- Deeper CRA T3010 / T2 line-item schedules and validation.
- Production-grade role/permission boundaries across societies, modules, and sensitive records.

### Deprecated

- Metadata-only document tracking as the expected document workflow. New document work should use storage-backed uploads, document versions, and Paperless sync where configured.
- Treating authentication and multi-society support as out of v1 scope. Both now exist in working form, with production hardening tracked under beta/planned.
- Describing Societies Online filing as unavailable wholesale. Direct API filing is still unavailable, but pre-fill review/export and evidence capture are current features.
