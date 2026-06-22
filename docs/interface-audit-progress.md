# Interface Audit — Remediation Goal

Tracking doc for working through the five-audit findings (routing/nav, non-functional UI,
data wiring, core flows). Demo runtime + demo data must keep working: after wiring any new
mutation into the UI, run `npm run test:static-parity` (the static mirror handles generic
`create|update|upsert|issue|setStatus|remove` verbs automatically; anything else must be
handled in `src/lib/staticConvex.ts` or classified in `src/lib/staticConvexParity.ts`).

## Bucket 1 — Broken / actively wrong
- [x] `filingBot.run` fabricates filings (fake confirmation #, force-marks "Filed") → now an honest prep run: ends `manual_required`, no fake confirmation, no auto-"Filed"; UI relabelled "Prepare filing" with a "ready to submit" callout (`convex/filingBot.ts`, `src/components/FilingBotRunner.tsx`)
- [x] `/app/import-sessions` dead links (5×) → `/app/imports` (`IntegrationMarketplace.tsx`, `BrowserConnectors.tsx`)
- [x] "Configure Wave" dead button → real `setupHref` link to the Wave connector; planned providers now render a non-clickable "Coming soon" label (`features/financials/components/FinancialDashboardCards.tsx`, `Financials.tsx`)

## Bucket 2 — Built but not connected
- [~] Delete actions sweep — wired `committees.remove` (CommitteeDetail), `goals.remove`
  (GoalDetail), `filings.remove` (non-Filed rows only). Receipts (void) and attestations
  (sign; rows are joins) intentionally keep their existing semantics. Remaining follow-up:
  the 12 `legalOperations.remove*` and `agendas.remove/removeItem`. (All demo-safe via the
  generic CRUD mirror — parity gate stays green.)
- [ ] RBAC: surface `permissions.myPermissions` (at least read-side gating signal)
- [ ] Webhooks/integration admin (apiPlatform) — surface or defer
- [ ] Accounting counterparties / fund-restrictions / mappings / GL — surface or defer
- [ ] calendarSync module — wire or defer
- [ ] Full export (`exports.exportTable`/`exportWorkspace`) button
- [ ] Manual evidence entry (`evidenceRegisters.createManual`)

## Bucket 3 — Needs better linking
- [x] Members detail page (`src/pages/MemberDetail.tsx`) + `members/:id` route + "Open full profile" link from the register drawer (reuses mirrored `members.list`, demo-safe)
- [x] Grant → Committee, Grant → Sources (`Grants.tsx`)
- [x] Meeting → Committee (subtitle link in `MeetingDetail.tsx`)
- [x] Committee roster → Director + open-tasks rows → filtered Tasks; Tasks now honors `?committeeId=` (`CommitteeDetail.tsx`, `Tasks.tsx`)
- [x] Grant detail → Committee (`GrantPanels.internal.dossierPanels.tsx`)
- [ ] AGM steps → link Elections / Written-Resolutions records (deferred — needs AGM data-model change, tracked in Bucket 4)

## Bucket 4 — Needs deeper implementation
- [x] AI Agents runner → real LLM. New `aiChatActions.runAgentLive` action runs the agent
  through the same Vercel AI SDK loop chat uses (agent-scoped system prompt via new
  `aiAgents.getAgentRunContext`, load_skills/learn_tools/execute_tool tools, persisted via
  `aiAgents._recordAgentRun`). Falls back to the deterministic `runAgent` mutation when no
  provider key is set, so demo/offline still works. UI (`AiAgents.tsx`) now calls the action.
- [ ] Wave live sync pulls invoices not bank transactions; no manual "add bank transaction"
- [ ] Bridge the two finance reconciliation/transaction systems
- [ ] Grants discovery → application connection (`GrantSourceDetail.tsx` "Add to pipeline")
- [ ] Internal workflow runs are theatrical (`sleep`, `demo:true`)

## Notes
- `git` branch: `claude/quirky-noether-sf89ml`
</content>
</invoke>
