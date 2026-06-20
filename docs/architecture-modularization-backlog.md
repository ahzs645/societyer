# Architecture Modularization Backlog

This backlog tracks focused modularization work for the largest Societyer files. The goal is incremental extraction with unchanged behavior, not a broad rewrite.

## Access-Control Hardening

- [ ] Add shared Convex helpers for meeting-material authorization in `convex/lib/access/materialAccess.ts`.
- [ ] Add shared Convex helpers for document authorization in `convex/lib/access/documentAccess.ts`.
- [ ] Wire document queries, file URL/download actions, meeting package queries, and document review queries through the shared helpers before treating fine-grained access grants as a security boundary.
- [ ] Add focused tests or script checks for board, member, attendee, committee, restricted, and explicit-grant access cases.

## Frontend Monoliths

- [ ] Split `src/pages/MeetingDetail.tsx` into a route container plus feature modules for meeting package, material access, join details, transcript/minutes editing, export helpers, and source documents.
- [ ] Split `src/pages/Financials.tsx` into financial dashboard, Wave cache explorer, Wave resource/detail views, account detail views, provider controls, operating subscriptions, and table column helpers.
- [ ] Split `src/pages/Grants.tsx` into grant list/detail/edit pages, dossier panels, requirement editors, grant parsing/sanitizing helpers, and evidence grouping helpers.

## Static Runtime

- [ ] Split `src/lib/staticConvex.ts` into domain fixtures, static query handlers, static mutation/action handlers, and shared lookup utilities.
- [ ] Keep static data files small enough that feature teams can edit one domain without touching unrelated fixtures.

## Corporation And Rule-Pack Expansion

- [ ] Use `docs/corporation-rulepacks-project-plan.md` as the implementation plan for federal corporation support, OpenFisca-style compliance rule packs, and Captable/OCF-style equity records.
- [ ] Keep `societies` / `societyId` as compatibility storage keys until the organization facade and jurisdiction module contract are stable.
- [ ] Move BC-specific filing, director, and bylaw defaults into jurisdiction-aware modules before adding more province-specific behavior.

## Convex Backend Monoliths

- [ ] Organize `convex/schema.ts` with reusable validators and domain sections for large repeated shapes while keeping Convex's single schema export intact.
- [ ] Split `convex/importSessions.ts` into discovery, extraction, transposition, import-session persistence, and Paperless-specific adapters.
- [ ] Split `convex/paperless.ts` into connection health, document sync, source pull, discovery, and OCR/import helpers.

## From the 2026-06 codebase audit

Scoped follow-ups identified during the audit. Items already addressed are noted.

### Static-mirror offline gaps (highest priority)
- [ ] Implement static handlers for the **70 pending writes** in `src/lib/staticConvexParity.ts`
  (`STATIC_PENDING_WRITES`) so they persist in offline/desktop mode instead of throwing/warning.
  Highest impact first: `elections:castBallot`, `signatures:sign`, `attestations:sign`,
  `writtenResolutions:sign`, `agm:init`/`markStep`, the `bylawAmendments:*` lifecycle,
  `reconciliation:match`/`markManual`/`unmatch`, `users:setRole`, `notifications:markRead`
  and friends. Each removed entry is enforced green by `npm run test:static-parity`.
- [ ] Object-shaped queries that fall back to `[]` can crash on destructure
  (`reconciliation:overview`, `minuteBook:overview`, `dashboard:navCounts`,
  `legalOperations:formationMaintenance`, `filings:guidance`) — give them shaped offline fallbacks.

### Dead backend code (deferred — needs `convex codegen` + gateway-ref verification)
- [ ] Prune the fully-dead `convex/fieldMetadata.ts` module and the unreferenced subset of
  `convex/views.ts` / `convex/objectMetadata.ts` (half-migrated Twenty-CRM-style metadata layer):
  either finish wiring the record-table feature or remove it.
- [ ] Remove the dead `convex/calendarSync.ts` module and the dead public surface of
  `convex/permissions.ts` (`check`/`myPermissions`/`listAll`).
- [ ] Remove the `legalOperations` remove-handler cluster (12 unused delete mutations) and the
  unused `accounting`/`inventoryHub` upserts — after confirming no REST-gateway string refs.
- [ ] Drop the orphan `inventoryLots` table and either write a producer for
  `grantOpportunityCandidates` (read in 3 places, never written) or remove it.
- Verify each deletion against `server/api-gateway.ts` (string `module:fn` refs) and re-run
  `npx convex codegen` before relying on the generated API.

### Consistency / type-safety
- [ ] Converge the fragmented table strategy (20 metadata-layer / 20 `<DataTable>` / 22 raw
  `<table>` pages) onto one canonical approach.
- [ ] Decide i18n intent: only 1 of ~100 pages calls `useTranslation()` though i18n is wired in nav.
- [ ] Eliminate the `as any` cast clusters in `convex/communications.ts` (64) and
  `convex/importSessionMergeAndApply.ts` (53) with a typed adapter each (live runtime paths).
- [ ] `tsconfig.server.json` does not typecheck clean (~20 pre-existing errors in `convex/`
  files pulled in under the server config) and is not wired into any gate; fix or scope it.

### Test coverage gaps (no gate today)
- [ ] Add gate scripts for money/governance domains with zero coverage: `reconciliation`,
  `treasury`/`financialHub`, `workflows`/`workflowCatalog`, `elections`, `paperless`, `retention`.

### Done in the 2026-06 audit pass
- [x] Fixed the 8 typecheck errors blocking `npm run build`.
- [x] Added the static-mirror write parity gate (`npm run test:static-parity`) + ledger.
- [x] Documented the client-asserted auth posture (`docs/security-and-auth-posture.md`).
- [x] Documented that provider secrets need `npx convex env set`; added `PAPERLESS_NGX_*`.
- [x] Pruned 4 orphan components + 2 dead queries; made `ApiKeysPage` reachable.
- [x] Extracted `<PageLoading/>` across 86 page guards.

## Working Rules

- Extract by dependency direction: pure helpers first, then presentational components, then stateful feature panels.
- Keep route files as orchestration shells: data loading, high-level state, mutations/actions, and navigation.
- Prefer small behavior-preserving PR-sized slices over multi-file rewrites.
- Do not enforce new access rules until the shared helpers are wired into all relevant read/download paths.
