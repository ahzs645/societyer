# Interface Audit — Remediation Goal

Tracking doc for working through the five-audit findings (routing/nav, non-functional UI,
data wiring, core flows). Demo runtime + demo data must keep working: after wiring any new
mutation into the UI, run `npm run test:static-parity` (the static mirror handles generic
`create|update|upsert|issue|setStatus|remove` verbs automatically; anything else must be
handled in `src/lib/staticConvex.ts` or classified in `src/lib/staticConvexParity.ts`).

Status: **all audit findings implemented.** Demo fixtures untouched; parity gate green.

## Bucket 1 — Broken / actively wrong
- [x] `filingBot.run` fabricated filings → honest prep run: ends `manual_required`, no fake
  confirmation, no auto-"Filed"; UI relabelled "Prepare filing" with a "ready to submit"
  callout (`convex/filingBot.ts`, `src/components/FilingBotRunner.tsx`).
- [x] `/app/import-sessions` dead links (5×) → `/app/imports`.
- [x] "Configure Wave" dead button → real setup link; planned providers render a label.

## Bucket 2 — Built but not connected
- [x] Delete actions sweep — `committees.remove`, `goals.remove`, `filings.remove`
  (non-Filed), and all 12 `legalOperations.remove*` (template engine + formation/maintenance).
  Receipts (void) and attestations (sign; rows are joins) keep their existing semantics.
  `agendas.remove/removeItem` left as-is (agenda items use replace-all `syncForMeeting`).
- [x] RBAC: `usePermissions()` hook + "Your access" card on Users + gated role/user writes
  (server still enforces every write).
- [x] Webhooks/integration admin — new `/app/webhooks` page (endpoints + signed deliveries).
- [x] Accounting counterparties + fund-restrictions surfaces in the Accounting Workbench.
- [x] calendarSync — new `/app/calendar-sync` import flow (.ics paste/upload → import session).
- [x] Full export — already functional via paged `download`/`downloadWorkspace`; single-shot
  `exportTable`/`exportWorkspace` are redundant dead backend (optional cleanup, no UX gap).
- [x] Manual evidence entry (`evidenceRegisters.createManual`) — "Add record" on Governance
  registers.

## Bucket 3 — Needs better linking
- [x] Members detail page + `members/:id` route + "Open full profile" link.
- [x] Grant → Committee, Grant → Sources; Grant detail → Committee.
- [x] Meeting → Committee (header subtitle).
- [x] Committee roster → Directors; open-task rows → Tasks filtered by `?committeeId=`.
- [x] AGM steps → link the meeting's real Elections (with status) + approved minutes preview.

## Bucket 4 — Needs deeper implementation
- [x] AI Agents runner → real LLM (`aiChatActions.runAgentLive`), deterministic fallback.
- [x] Reconciliation records the real actor (was hard-coded "You").
- [x] Manual bank-transaction entry (`reconciliation.addManualTransaction`) — reconciliation
  usable without an integration.
- [x] Finance two-system bridge — bidirectional cross-links between bank reconciliation and
  ledger reconciliation + guidance to Backfill imports into the journal.
- [x] Wave invoice-vs-bank-transaction — rows labelled "Wave invoice — …" (Wave's public API
  exposes invoices, not bank lines); real bank lines come from the browser connector or
  manual entry.
- [x] Grants discovery → application ("Add to pipeline" on GrantSourceDetail).
- [~] Internal workflow runs are theatrical (`sleep`, `demo:true`). Left as a demo/visual
  device — the steps already perform real DB side-effects via the n8n/email/connector paths;
  de-theatricalising the internal provider's progression is cosmetic and out of scope.

## Notes
- `git` branch: `claude/quirky-noether-sf89ml`
</content>
