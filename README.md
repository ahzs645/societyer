# Societyer

A React + Convex app for tracking **BC Societies Act** compliance — registers, meetings & minutes, filings, deadlines, documents, conflicts of interest, financial statements, and PIPA privacy.

The UI is inspired by [Twenty](https://github.com/twentyhq/twenty) (dense sidebar, monochrome + blue accent, data-first tables, command palette with `⌘K`).

> Not legal advice. Statutory references (s.11, s.20, s.42, s.56, s.36 etc.) are based on the BC Societies Act as summarised in the accompanying compliance notes — verify against the current Act and your bylaws before acting.

---

## Stack

- **Vite + React 18 + TypeScript**
- **Convex** for live-reactive data (works against hosted Convex *or* a self-hosted `convex-backend`)
- **react-router-dom**, **lucide-react**, **date-fns**

No CSS framework — a small set of hand-rolled tokens in `src/theme/tokens.css` mimic Twenty's design language.

---

## Quick start — self-hosted Convex (local, Docker)

The repo ships a `docker-compose.yml` that runs the official `convex-backend` and `convex-dashboard` images locally. No need to clone anything else.

### 1. Bring up the Convex backend

```bash
cd /Users/ahmadjalil/github/societyer
npm install
npm run docker:up        # (= docker compose up -d)
```

This starts:
- **Backend API** → http://127.0.0.1:3220
- **HTTP actions** → http://127.0.0.1:3221
- **Dashboard** → http://127.0.0.1:6792

Tail logs: `npm run docker:logs`. Stop everything: `npm run docker:down`. Wipe the database: `docker compose down -v`.

### 2. Generate an admin key & configure env

```bash
cp .env.local.example .env.local
npm run docker:admin-key    # prints the admin key — paste into .env.local
```

Your `.env.local` should end up looking like:

```
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3220"
CONVEX_SELF_HOSTED_ADMIN_KEY="<the key the script printed>"
VITE_CONVEX_URL="http://127.0.0.1:3220"
```

If the helper script can't find the binary in your image version, open the dashboard (http://127.0.0.1:6792) — it can generate one too.

### 3. Push the schema & start the app

```bash
npx convex dev           # terminal 1 — pushes ./convex to localhost:3210
npm run dev              # terminal 2 — Vite at http://localhost:5173
```

### 4. Seed the demo society

- Click **Seed demo society** in the in-app demo banner, **or**
- `⌘K` → "Seed demo society" in the command palette, **or**
- `npm run convex:seed` (= `npx convex run seed:run`)

Wipe with `npm run convex:reset`.

---

## Quick start — hosted Convex (if you just want to try it)

```bash
npm install
npx convex dev           # will prompt you to log in; creates a free cloud deployment
npm run dev
```

---

## Demo mode

- The in-app banner appears whenever demo mode is on (default).
- Toggle in **Settings → Demo mode**.
- Append `?demo=0` to any URL to suppress it, `?demo=1` to force it on.
- The seeded society is **Riverside Community Society** — a fictional BC charity with 7 directors, 15 members, two past meetings (a 2025 AGM and a Q4 board meeting), minutes with motions/decisions/action items, filed and upcoming filings (annual report, T3010, T4, GST/HST, bylaw amendment, change of directors), recurring deadlines, a disclosed conflict of interest, FY2024-25 financials with remuneration disclosure, and a document repository with retention flags.

## Public site vs full app

- `/` is now the marketing page for the public custom domain.
- `/demo` boots the same React app shell and `/app/...` routes in a browser-only in-memory fixture mode. It does not require Convex, auth, localStorage app state, IndexedDB, SQLite, or seeded backend data.
- Inside demo mode, app links are automatically scoped under `/demo`, so `/app/filings` becomes `/demo/app/filings`.
- `/app` remains the real workspace route for the backend-backed application.
- `/public/:slug` and other operational routes still expect the live app stack.

## Auth modes

Societyer now supports two identity modes:

- **`VITE_AUTH_MODE=none` / `AUTH_MODE=none`** — keep the current local/demo workflow. The user picker remains available and no auth server is required.
- **`VITE_AUTH_MODE=better-auth` / `AUTH_MODE=better-auth`** — enable Better Auth for real login/session handling. Start the auth sidecar alongside Vite:

```bash
npm run dev:full
```

## New operating modules

- **Communications**: `/app/communications` adds reusable templates, campaign history, member contact preferences, AGM notice delivery proofs, and live email sending when Resend is configured.
- **Volunteers**: `/app/volunteers` adds volunteer intake, committee alignment, screening expiry tracking, and annual renewal dates.
- **Grants**: `/app/grants` adds grant pipeline stages, report deadlines, linked restricted-purpose tracking, and board-facing summaries.
- **Public transparency**: `/app/transparency` manages what is published; `/public/:slug` renders the public-facing transparency page without exposing the private app.

## Live integrations

- **Resend**: set `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` to turn digest emails and communications into real outbound email.
- **Stripe**: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to enable real hosted checkout. Point Stripe webhooks at Convex HTTP route `/stripe/webhook`.
- **Wave**: set `WAVE_ACCESS_TOKEN` and `WAVE_BUSINESS_ID` to switch the accounting sync from demo data to live GraphQL fetches.
- **Paperless-ngx**: set `PAPERLESS_NGX_URL` and `PAPERLESS_NGX_TOKEN`, then enable the Paperless-ngx module at `/app/paperless`. Documents can be sent to Paperless from `/app/documents`; Societyer creates contextual tags such as document category, filing kind, grant report, PIPA training, election evidence, and volunteer screening.
- **Access custody vault**: set `SECRET_VAULT_ENCRYPTION_KEY` before storing client credentials in production. `/app/access-custody` encrypts stored values, keeps them hidden by default, and logs explicit reveals to the activity trail.
- **Filing evidence**: BC still has no public Societies Online filing API. This build improves the manual path by storing submission method, confirmation number, fee paid, and linked receipt/evidence documents when a filing is marked filed.

Auth mode uses a small SQLite auth database configured by `AUTH_DB_PATH`, and maps signed-in identities into the existing Convex `users` / `members` records.

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
| Public | `/` Marketing page | Product positioning, feature overview, and CTA into the static walkthrough |
| Public | `/demo` Browser-only demo | The real app frontend using an in-memory Convex-compatible fixture client |
| Overview | `/app` Dashboard | Compliance flags (≥3 directors, ≥1 BC resident, consents on file, PIPA policy, constitution & bylaws uploaded), stat tiles, upcoming meetings and filings |
| Overview | `/app/society` | Edit legal name, incorporation #, fiscal year end, addresses, purposes, charity / member-funded flags, privacy officer |
| People | `/app/members` | Register of members (s.20), class, voting rights, join date, status |
| People | `/app/directors` | Register of directors with BC-resident & consent-on-file checks, warnings when Act thresholds aren't met |
| Governance | `/app/meetings` | Board / Committee / AGM / SGM scheduling; AGM reminder about 14–60 day notice |
| Governance | `/app/meetings/:id` | Agenda, minutes (discussion, motions with vote counts, decisions, action items), AGM checklist, **mock AI minute generator** from raw transcript |
| Governance | `/app/elections` | Verified member elections with anonymous ballot storage, voter snapshots, and tallies |
| Governance | `/app/minutes` | All minutes across meetings, quorum and action status |
| Governance | `/app/conflicts` | s.56 disclosures with "left room" / "abstained" tracking |
| Compliance | `/app/filings` | Societies Online + CRA: AnnualReport, ChangeOfDirectors, ChangeOfAddress, BylawAmendment, T2, T1044, T3010, T4, GST/HST — mark filed with confirmation # and fee |
| Compliance | `/app/deadlines` | Rolling calendar; recurrence (Monthly/Quarterly/Annual); categories (Governance / Tax / Payroll / Privacy / Other) |
| Compliance | `/app/documents` | Constitution, bylaws, minutes, policies, financial statements; retention years; "flag for deletion" after 10-year threshold |
| Compliance | `/app/bylaw-rules` | Active bylaw rule set that drives notice windows, proxies, voting, proposal thresholds, quorum, and inspection defaults |
| Compliance | `/app/privacy` | PIPA checklist and records-inspection rules |
| Finance | `/app/financials` | Annual statements with revenue / expenses / net assets / restricted funds / audit status / board approval; remuneration disclosure ≥ $75k |
| System | `/app/settings` | Theme (light/dark), demo mode, seed/reset, Convex deployment info |

Press `⌘K` (or `Ctrl+K`) anywhere for the command palette.

---

## Swapping the mock AI minute generator for a real LLM

`convex/minutes.ts` exports `generateDraft` — a mutation that parses a transcript heuristically. To use a real model:

1. Convert it to a Convex **action** (so it can do `fetch`).
2. Call your LLM of choice (Anthropic / OpenAI / local Ollama).
3. Write the structured result via `ctx.runMutation(api.minutes.create, ...)`.
4. The UI (`MeetingDetail.tsx`) needs no change — it already pipes the transcript into `generateDraft`.

---

## Roadmap / not in v1

- File uploads to Convex storage for Documents (right now they're metadata-only)
- Authentication & multi-society workspaces
- Societies Online filing export (pre-filled PDFs)
- Real LLM minute generation + speaker diarization
- Email/Slack reminders for upcoming deadlines
- Audit log of every mutation
- CRA T3010 / T2 line-item tracking
