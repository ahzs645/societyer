# YCN → Societyer: Implementation Status

What was actually built from the YCN reuse backlog, where it lives, how it's
tested, and what remains. All work is on `claude/excel-database-analysis-ubftpj`.

## Architecture (the modular pattern, end to end)

```
shared/*.ts        pure, framework-free logic        ← unit-tested via scripts/check-*.ts
   ↑ imported by
convex/*.ts        thin persistence/query wrappers   ← typecheck-verified (convex:typecheck)
   ↑ called by
src/pages/*.tsx    React surfaces (useQuery/useSociety) + src/lib/staticConvex.ts mirror for offline
```

Every gate stays green between commits: `npm run convex:typecheck`,
`npx tsc -p tsconfig.json` (app), `npm run test:static-parity`.

## Modules delivered

| Layer | Module | Test | Plugs into |
|---|---|---|---|
| Foundation | `shared/nlg.ts` (`actorGrammar`, `looksLikeOrganization`) | `test:nlg-grammar` | renderContext, doc generation |
| Foundation | `shared/ycnDate.ts` (float-date codec) | `test:ycn-date-codec` | legacy YCN/Access import boundary |
| Foundation | `shared/versionedRegister.ts` (bitemporal supersede model) | `test:versioned-register` | registerDiff, future edit-history |
| Foundation | `shared/referenceField.ts` (strict/free constraint) | `test:reference-field` | customFields / fieldMetadata wiring |
| Binding | `shared/templateAssembly.ts` (`{token}/{#if}/{#each}`) | `test:template-assembly` | packetRendering, doc generation |
| Binding | `shared/renderContext.ts` (`buildRenderContext`) | `test:render-context` | societyRenderContext, templates |
| Binding | (integration) | `test:document-binding` | proves grammar binds in prose |
| Logic | `shared/registerHistory.ts` (`activeAsOf`, `roleHoldersAsOf`) | `test:register-history` | convex/registerHistory, PIT register UI |
| Logic | `shared/significantIndividuals.ts` (BC transparency register) | `test:significant-individuals` | convex/significantIndividualSteps |
| Logic | `shared/peopleDirectory.ts` (dedup, prefix search) | `test:people-directory` | convex/peopleDirectory |
| Logic | `shared/corporationSettings.ts` (AGM/FYE → deadlines) | `test:corporation-settings` | convex/corporationSettings |
| Logic | `shared/dividends.ts` (per-share × outstanding) | `test:dividends` | convex/dividends |
| Logic | `shared/serviceProviders.ts` (provider register) | `test:service-providers` | convex/serviceProviders |
| Logic | `shared/registerDiff.ts` (declarative diff/apply) | `test:register-diff` | future bulk-edit/import-apply |
| Doc gen | `shared/packetRendering.ts` + `shared/societyRenderContext.ts` | `test:packet-grammar` | corporationPacketDocx, legalOperations |

## (A) Persistence — schema + Convex wrappers ✅

- `convex/schema.ts`: `societies` += `agmMonth`/`agmDay`/`waivePrepFinancials`;
  `roleHolders` += `significanceReason`/`taxResidentHomeJurisdiction`; new tables
  `peopleDirectory`, `dividends`, `serviceProviders`, `significantIndividualSteps`.
- Wrappers: `convex/registerHistory.ts`, `convex/corporationSettings.ts`,
  `convex/peopleDirectory.ts`, `convex/dividends.ts`, `convex/serviceProviders.ts`,
  `convex/significantIndividualSteps.ts`. Logic delegated to the tested shared libs.
- Tests: `test:register-history-connection`, `test:persistence-wrappers`.

## (B) UI ✅ (first surface; pattern established)

- `src/pages/PointInTimeRegister.tsx` — "who held each role on date X?" (read-only;
  Directors/Officers/Members as of a chosen date). Route `/app/point-in-time-register`,
  nav entry in the People group, static-mirror handler for offline/demo mode.

## (C) Live document generator ✅

- `shared/corporationPacketDocx.ts` takes an optional `RenderContext`; when present,
  packet prose renders through the template engine ("the sole director … adopts" vs
  "all the directors … adopt"). `convex/legalOperations.ts:createPacketRunArtifacts`
  builds the context from the society + role holders and passes it. Backward-compatible:
  token-free packets are byte-identical (`test:packet-grammar`, plus existing
  `corporation-packets`/`corporation-mvp` stay green).

## Remaining (same proven patterns, not yet built)

These each follow the established shared→convex→page recipe. Write-backed pages
additionally need a static-mirror **write** handler + a `staticConvexParity.ts`
ledger entry (the parity gate enforces this):

- UI: Significant-Individuals register + diligence-steps editor (writes).
- UI: People-directory typeahead / dedup panel (writes).
- UI: Dividends register & service-providers register (writes).
- Settings: surface `agmMonth`/`agmDay`/`waivePrepFinancials` on Organization
  Details, then auto-generate `deadlines` rows via `deriveComplianceDeadlines`.
- `versionedRegister` adoption for true edit-history on a register (larger change).

## Environment caveats (honest verification scope)

- No live Convex backend in this container, and `convex codegen` needs a deployment,
  so Convex modules are **typecheck-verified**, not runtime-executed. All business
  logic is runtime-tested in the pure `shared/` layer.
- The offline `StaticConvexClient` is a hand-written mirror; new frontend writes must
  be added there (and to the parity ledger) — accounted for above.
