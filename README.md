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

## Auth modes

Societyer now supports two identity modes:

- **`VITE_AUTH_MODE=none` / `AUTH_MODE=none`** — keep the current local/demo workflow. The user picker remains available and no auth server is required.
- **`VITE_AUTH_MODE=better-auth` / `AUTH_MODE=better-auth`** — enable Better Auth for real login/session handling. Start the auth sidecar alongside Vite:

```bash
npm run dev:full
```

Auth mode uses a small SQLite auth database configured by `AUTH_DB_PATH`, and maps signed-in identities into the existing Convex `users` / `members` records.

---

## What's in it

| Area | Page | Notes |
|---|---|---|
| Overview | `/` Dashboard | Compliance flags (≥3 directors, ≥1 BC resident, consents on file, PIPA policy, constitution & bylaws uploaded), stat tiles, upcoming meetings and filings |
| Overview | `/society` | Edit legal name, incorporation #, fiscal year end, addresses, purposes, charity / member-funded flags, privacy officer |
| People | `/members` | Register of members (s.20), class, voting rights, join date, status |
| People | `/directors` | Register of directors with BC-resident & consent-on-file checks, warnings when Act thresholds aren't met |
| Governance | `/meetings` | Board / Committee / AGM / SGM scheduling; AGM reminder about 14–60 day notice |
| Governance | `/meetings/:id` | Agenda, minutes (discussion, motions with vote counts, decisions, action items), AGM checklist, **mock AI minute generator** from raw transcript |
| Governance | `/elections` | Verified member elections with anonymous ballot storage, voter snapshots, and tallies |
| Governance | `/minutes` | All minutes across meetings, quorum and action status |
| Governance | `/conflicts` | s.56 disclosures with "left room" / "abstained" tracking |
| Compliance | `/filings` | Societies Online + CRA: AnnualReport, ChangeOfDirectors, ChangeOfAddress, BylawAmendment, T2, T1044, T3010, T4, GST/HST — mark filed with confirmation # and fee |
| Compliance | `/deadlines` | Rolling calendar; recurrence (Monthly/Quarterly/Annual); categories (Governance / Tax / Payroll / Privacy / Other) |
| Compliance | `/documents` | Constitution, bylaws, minutes, policies, financial statements; retention years; "flag for deletion" after 10-year threshold |
| Compliance | `/bylaw-rules` | Active bylaw rule set that drives notice windows, proxies, voting, proposal thresholds, quorum, and inspection defaults |
| Compliance | `/privacy` | PIPA checklist and records-inspection rules |
| Finance | `/financials` | Annual statements with revenue / expenses / net assets / restricted funds / audit status / board approval; remuneration disclosure ≥ $75k |
| System | `/settings` | Theme (light/dark), demo mode, seed/reset, Convex deployment info |

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
