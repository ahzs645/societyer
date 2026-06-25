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

## (B) UI ✅ (6 surfaces — full set)

All routed, nav-registered, and static-mirror-backed (offline-capable):

- `src/pages/PointInTimeRegister.tsx` — "who held each role on date X?" (read-only).
- `src/pages/SignificantIndividuals.tsx` — BC transparency register (as-of) +
  diligence-steps sub-register with a reviews-due banner.
- `src/pages/PeopleDirectory.tsx` — global directory: prefix typeahead, dedup
  groups, upsert.
- `src/pages/Dividends.tsx` — declarations register (list / summary / create / remove).
- `src/pages/ServiceProviders.tsx` — provider register with function catalog +
  active-today filter.
- `src/pages/ComplianceSettings.tsx` — AGM date + fiscal year-end → derives and
  inserts AGM/fiscal/annual-report deadlines via the existing `deadlines.create`.

Write parity: all mutations either use generic-CRUD verbs (`create/upsert/remove`)
or have an explicit mirror handler (`society:updateComplianceSettings`), so the
parity gate stays green (416 frontend writes accounted for). Derived fields
(`searchName`, `totalCents`) are injected in the mirror so offline persists
correctly.

## (C) Live document generator ✅

- `shared/corporationPacketDocx.ts` takes an optional `RenderContext`; when present,
  packet prose renders through the template engine ("the sole director … adopts" vs
  "all the directors … adopt"). `convex/legalOperations.ts:createPacketRunArtifacts`
  builds the context from the society + role holders and passes it. Backward-compatible:
  token-free packets are byte-identical (`test:packet-grammar`, plus existing
  `corporation-packets`/`corporation-mvp` stay green).

## Remaining (optional follow-ups)

The A/B/C scope is complete. Sensible next steps if desired:

- `versionedRegister` adoption for true supersede-based edit-history on a live
  register (e.g. directors) — a larger migration than the interval model used so far.
- Wire `significanceReason` / `taxResidentHomeJurisdiction` editing into the
  Significant-Individuals page (fields exist on `roleHolders`; currently read-only).
- Playwright smoke coverage for the new pages (needs a running app + backend).
- Promote grammar tokens into the seeded packet bodies so generated documents use
  the NLG layer by default (capability is wired; default content is still static).

## Environment caveats (honest verification scope)

- No live Convex backend in this container, and `convex codegen` needs a deployment,
  so Convex modules are **typecheck-verified**, not runtime-executed. All business
  logic is runtime-tested in the pure `shared/` layer.
- The offline `StaticConvexClient` is a hand-written mirror; new frontend writes must
  be added there (and to the parity ledger) — accounted for above.

---

# Society / Corporation / Multi-entity architecture + modularization

## Three views
- **Society view** — BC Societies Act entity. Sees universal registers + the new
  society document packet catalog (`shared/societyDocumentPackets.ts`: AGM,
  directors' resolution, special resolution of the members, director appointment,
  registered-office change), which render society prose ("members", "Societies
  Act") through the same grammar engine.
- **Corporation view** — BC Business Corporations Act entity. Additionally sees
  the share-capital features (Certificate Register, Dividends) and the BC
  transparency register (Significant Individuals), plus the corporation packets.
- **Multi-entity (portfolio) view** — `src/pages/Portfolio.tsx` lists every
  society AND corporation grouped by kind with one-click switching (the YCN
  entity-index premise). The people directory is already cross-entity.

## Entity-kind gating
`RouteIdentity.entityKinds` + `routeAllowedForEntityKind`, propagated through
`NavItem` and applied in the sidebar/command filters via `organizationKind(society)`.
Corporation-only routes (Dividends, Certificate Register, Significant Individuals)
are gated to `["corporation"]`; universal registers show for both; unknown kind
shows everything. (Fix: all the new register pages were also added to the
hand-listed `NAV_GROUPS` so they actually appear in the sidebar.)

## Schema modularization (in progress)
`convex/schema.ts` (186 tables / 4,545 lines) is being split into domain modules
that spread back into `defineSchema({...})` — generated types/runtime are
byte-identical (verified by `convex:typecheck`). First module:
`convex/tables/ycnRegisters.ts` (`sharedRegisterTables` + `corporationRegisterTables`,
grouped by entity applicability). schema.ts is now 4,416 lines; remaining domains
follow the same pattern.

## Static-mirror modularization
`src/lib/staticConvex.ts` (5,800 lines) split: all YCN-register handlers moved to
`src/lib/staticConvexYcn.ts` (`ycnQueryResult` / `ycnMutationResult` /
`applyYcnDerivedFields`); staticConvex delegates and falls through on
`YCN_NOT_HANDLED`. The parity-gate scanner now reads the sibling module too.

## Verification
26 YCN test suites green; `convex:typecheck` + app `tsc` + `static-parity`
(427 frontend writes) clean.
