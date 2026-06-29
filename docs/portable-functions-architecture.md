# Portable Functions + `ctx.db` Repository Contract

> Status: **Phases 0–3 landed** — foundation, the live local async runtime,
> `convex-test` as a conformance oracle, and the domain port:
> **773 functions across ~90 domains** now run as one portable handler on all
> three runtimes (up from the first `votingPower`/`upsertRightsClass` pair),
> including the role-gated write surface (portable `requireRole`), the accounting
> double-entry money path, document/template generation, and full-text search
> (a `withSearchIndex` contract primitive). The remaining un-ported handlers are
> the genuinely capability-backed or server-only tail (`ctx.storage` uploads,
> network/Wave sync, n8n execution, crypto token hashing, AI inference, scheduler/
> cron, seed maintenance) — see
> [`electron-native-capabilities.md`](./electron-native-capabilities.md) for how
> those run natively on the Electron desktop. This document is the design record and
> the migration plan. It realizes — and supersedes the "keep & expand the static
> mirror" parts of — [`electron-local-first-plan.md`](./electron-local-first-plan.md).

## Why

Societyer ships a hosted-Convex web app **and** an offline/desktop runtime. The
offline runtime began as a ~10,900-line hand-written mirror of the backend
(`src/lib/staticConvex.ts` + siblings) that re-implemented ~300 functions by hand,
guarded by a name-coverage ledger (`src/lib/staticConvexParity.ts`). That mirror
was the symptom of a missing abstraction: there was no `ctx.db` seam that let the
**real** Convex handlers run on a non-Convex store, so every handler got a
second, hand-maintained copy that drifted (76 writes were once tracked as
not-yet-mirrored; that ledger is now down to **12**, all genuinely non-portable —
`ctx.storage` logo uploads, an org-history importer, `users:setRole`, and the
multi-event calendar stager).

The fix is one set of **portable functions** running on a bounded `ctx`
contract, with a thin adapter per runtime:

```
                         React UI (api.module.fn — unchanged)
                                      │
              ┌───────────────────────┼────────────────────────┐
        hosted Convex            browser-local              Electron-local
     ConvexReactClient        Dexie row store            Dexie row store
              │                       │                        │
   convex/lib/portable.ts   shared/portable/localRowStore.ts (one adapter)
              └───────────── same portable handler ────────────┘
                       shared/functions/*.ts  +  shared/* kernels
```

Three runtimes collapse to **two backends + a shell**: hosted Convex vs **one**
local adapter (browser and Electron are the same adapter, parameterized by seed
+ capability set), plus an Electron native-filesystem document provider.

## The contract (`shared/portable/`)

This package is **domain-agnostic** — it imports no Convex, no Dexie, no
Societyer domain code — so it is the lift-out-able core of a reusable
multi-project SDK.

| File | Role |
|---|---|
| `ctx.ts` | The bounded `ctx.db` surface: `get / query(table).withIndex().filter().order().collect()/first/unique/take/paginate`, `withSearchIndex(name, q => q.search(field, text))` for full-text, `insert/patch/replace/delete`, and `TransactionalDb.transaction`. Plus `PortableQueryCtx` / `PortableMutationCtx`. |
| `capabilities.ts` | Injected `ctx.capabilities` (email/sms/storage/llm/…). Absent capabilities throw a structured `CAPABILITY_UNAVAILABLE` instead of a silent null. This replaces the parity ledger's NOOP/PENDING buckets. |
| `ids.ts` | Stable application ids (`entityId`, ULID-ish, sortable) + `EntityIdMap` (native `_id` ⇆ portable id). The prerequisite for cross-runtime sync. |
| `memoryDb.ts` | `MemoryDb` — the reference engine / differential-test oracle. Atomic snapshot-rollback transactions. |
| `localRowStore.ts` | `LocalStoreDb` — the **real** browser/Electron `ctx.db`, over a minimal `LocalRowStore` interface that `LocalDexieRowStore` implements. Transactional overlay = read-your-writes + atomic flush. Plus `MemoryRowStore` for tests. |
| `define.ts` | `definePortableQuery` / `definePortableMutation` + `PortableRuntime` (registers functions, runs them locally, wraps mutations in `db.transaction`). |

### Fidelity boundary (read before porting a handler)

- `withIndex` **index names are advisory** on the local adapters: they scan and
  apply the `eq`/range constraints in JS. On Convex they hit the real index.
- `filter` takes a **JS predicate** (engine-agnostic). The Convex adapter
  implements it as collect-then-filter (Convex's native `.filter` uses a
  FilterBuilder). Avoid `filter` on hot paths; prefer `withIndex`.
- `withSearchIndex(name, q => q.search(field, text))` hits the **real** full-text
  index on Convex; on the local adapters it is a **tokenized, prefix-on-last-term
  scan** ranked by token-hit count (then `_creationTime`/`_id`). Membership matches
  Convex; BM25 *ordering* is approximate — assert on membership, not exact rank
  (the differential harness does: prefix, multi-term AND, and the length guard).
- Ordering on the local adapters is by `_creationTime` then `_id`. If a handler
  depends on index-order semantics, assert it in a conformance test.
- Capabilities are **not** part of `db`. Server-only work (AI, email, webhooks,
  scraping) goes through `ctx.capabilities` and fails loudly where unavailable.

## How a handler becomes portable (worked example: `votingPower`)

`legalOperations:votingPower` existed in two hand-written copies (Convex +
static mirror) that both marshalled the same inputs into the shared
`computeVotingPower` kernel.

1. **One source of truth** — `shared/functions/votingPower.ts`:
   - `summarizeVotingPower(...)` — the pure marshaller (the formerly-duplicated body).
   - `votingPowerPortable(ctx, args)` — loads rows via the contract, calls the marshaller.
2. **Convex** (`convex/legalOperations.ts`) delegates: `handler: (ctx, args) =>
   votingPowerPortable(toPortableQueryCtx(ctx), args)`. The real handler now runs
   on the contract.
3. **Static mirror** (`src/lib/staticConvex.ts`) calls the same
   `summarizeVotingPower` — the duplicated marshalling is deleted. (It still loads
   rows synchronously; see *Sync boundary* below.)
4. **Differential test** (`scripts/check-portable-runtime.ts`, `npm run
   test:portable-runtime`) runs `votingPowerPortable` against `MemoryDb` and
   `LocalStoreDb` and asserts identical output, equal to the marshaller and to the
   pinned invariants.

### The sync boundary (resolved in Phase 1)

The live static client's reactive recompute (`watchQuery`) is **synchronous** and
feeds 435 `useQuery` sites; a portable handler on the contract is **async**.
Phase 1 bridges this in `StaticConvexClient`: a registered portable query runs
the **real async handler** against the Dexie-backed `ctx.db` on mount and on every
store change (`watchPortableQuery`), caching its result synchronously so
`useQuery`'s synchronous `localQueryResult()` sees it. Until the first async
result resolves, the existing synchronous mirror path supplies an instant value,
so there is **no loading flash** for ported queries. `query()` and `mutation()`
route registered portable functions through the runtime directly (mutations run
inside `db.transaction` → atomic). The static-mirror case for a ported query is
now just an instant-paint fallback; it is deletable once a loading state is
acceptable for that query.

## Atomic local writes (correctness fix)

`LocalDexieRowStore.transaction()` only deferred notifications; the actual writes
were fire-and-forget `void db.records.put(...)` with no rollback — a real
correctness bug for multi-table mutations. Added `LocalDexieRowStore.commitBatch`:
applies all ops in **one Dexie `rw` transaction** and rolls the in-memory cache
back on failure. The portable mutation path routes through it, so a thrown
mutation never commits partially (verified for the adapter layer in
`check-portable-runtime.ts`; the Dexie-transaction layer is exercised in-browser).

## Capabilities replace the parity ledger

`convex/providers/capabilities.ts` builds the injected bag from the existing
`convex/providers/*` (email/sms/storage wired; others follow the same pattern).
The migration target: lift each entry of `STATIC_OFFLINE_NOOP_WRITES` /
`STATIC_PENDING_WRITES` into an explicit per-runtime **capability tier**:

| Tier | Hosted Convex | Browser-local | Electron-local |
|---|---|---|---|
| `portable` (pure db) | ✓ | ✓ | ✓ |
| `connected` (email, AI, billing…) | ✓ | gateway only → `CAPABILITY_UNAVAILABLE` | gateway only |
| `server-only` (webhooks, scraping, http) | ✓ | ✗ structured error | ✗ |
| `desktop-only` (native FS, background) | optional | ✗ | ✓ |

Only after every frontend write routes through a portable handler or an explicit
capability tier should the lexical parity gate be retired (replaced by the
differential harness).

## Multi-project SDK boundary

Extract (domain-agnostic): `shared/portable/*` — the contract, the adapters
(Convex/Dexie/SQLite), the capability pattern, the id scheme, the
`PortableRuntime`, and the differential harness. **Stays per-app**: the 191
tables, 515 indexes, every `shared/*` domain kernel, RecordTable metadata, and
the concrete providers. Budget the SDK extraction as a separate investment
*after* the seam is proven in Societyer — do not block offline correctness on it.

## Phased plan

- **Phase 0 — landed.** Contract + adapters + capabilities + ids + atomic
  `commitBatch`; `votingPower` ported and de-duplicated; differential harness.
- **Phase 1 — landed.** The live local runtime executes the real async portable
  handler via `PortableRuntime` over `LocalStoreDb` (async executor + synchronous
  last-result cache in `StaticConvexClient.watchPortableQuery`). `query`/
  `mutation`/`watchQuery` route registered portable functions through it.
- **Phase 2 — landed.** `convex-test` adopted as a third conformance engine
  (`scripts/check-portable-convex-oracle.ts`): runs the ported functions on a
  **real** Convex `ctx.db` + schema and diffs against the local engines. It is an
  **oracle, not the production engine** (it depends on `node:async_hooks`).
- **Phase 3 — complete for the portable surface.** **773 functions across ~90
  domains** are ported and live in `shared/functions/registry.ts` — from the seed
  `votingPower`/`upsertRightsClass`/cap-table/`members` work through whole-domain
  ports of accounting (incl. the double-entry money path), assets, inventoryHub,
  grants, elections, volunteers, notifications, financialHub, communications,
  workflows, apiPlatform, paperless, importSessions, transcripts, aiAgents,
  bylawAmendments, legalOperations (role-holders **and** document/template
  generation), and many more. Each Convex handler is now a one-line delegation
  (`handler: (ctx, args) => fnPortable(toPortable{Query,Mutation}Ctx(ctx), args)`).
  - **Full-text search is portable.** `withSearchIndex` is part of the contract
    (tokenized prefix scan locally, real index on Convex); `firm:search` runs on
    it, conformance-tested for cross-engine agreement.
  - **Document generation works offline end-to-end.** `legalOperations:generateDocumentFromCatalog`
    and the `stage*`/`seed*` packet handlers run on `ctx.db` over the render kernels
    already in `shared/` (`templateAssembly`, `packetRendering`, `*DocumentPackets`).
    Generated drafts carry the `"governance"` category on every runtime; it was
    added to `documents:list`'s visible-category set so generated docs surface in
    the list (verified by `test:generate-from-catalog`).
  - **`requireRole` is portable.** It only reads the `users` table, so it moved to
    `shared/functions/access.ts` (`requireRolePortable`, with `ROLES`/`canActAs`);
    the Convex `requireRole` delegates to it. This unlocked the role-gated mutation
    surface across every domain — handlers enforce the same rule live and offline.
  - **Layering preserved.** `shared/` never imports `convex/`. Pure helpers that
    were convex-resident moved to `shared/` with thin re-export shims left behind
    (`shared/accountingCore.ts`, `shared/functions/importSessionHelpers/*`,
    `shared/accountingMappingCandidates.ts`, `shared/orgHubOptions.ts`).
  - **The registry is generated, not hand-typed.**
    `scripts/generate-portable-registry.mjs` derives `definePortable{Query,Mutation}`
    entries from the Convex delegations (parsing `=> fn(toPortable…Ctx(ctx)` plus
    the `../shared/functions/*` imports) and dedupes against the existing registry,
    so adding a domain is mechanical.
  - **What stays on Convex — and why it's not "the desktop can't do it":** the
    remaining handlers are *capability-backed* or *server-only*, not portable-`ctx.db`.
    They fall in three buckets:
    1. **Works offline via a capability, not `ctx.db`** — `ctx.storage` (document
       files already flow through the Electron native-fs provider; logos/blob URLs
       would move from `ctx.storage.*` to `ctx.capabilities.storage.*`), AI (`llm`),
       and `scheduler` (desktop background jobs). Wiring + a local provider, not a wall.
    2. **Genuinely needs a remote server/third party** — Wave sync, OAuth, paperless
       pull, n8n execution, outbound webhooks/email, inbound-API token crypto. Offline
       these surface a loud `CAPABILITY_UNAVAILABLE`; the local-data side still works.
       On **Electron** most of these can run natively (main-process fetch, OS keychain,
       a managed/relayed n8n) — see
       [`electron-native-capabilities.md`](./electron-native-capabilities.md).
    3. **Token-gated maintenance the demo already reflects** — `seed:run/reset`,
       `seedRecordTableMetadata:run/wipe`: their bodies are now in `shared/` (oracle-
       testable) but they keep a Convex-only maintenance-token gate and stay
       unregistered for the offline runtime.
- **CI:** `.github/workflows/portable-conformance.yml` runs the four
  `test:portable-*` suites + the parity gate + domain regressions on every push/PR,
  so a port that breaks cross-runtime agreement fails CI.
- **Phase 4 — partly present.** The Electron native-filesystem document provider
  already exists (`electron/documents.ts` native read/write + `src/lib/documentStorage.ts`
  adapter + preload bridge) and passes `npm run desktop:typecheck`. The local
  capability policy is now a named seam (`src/lib/localCapabilities.ts`,
  `buildLocalCapabilities`) — the hook point where native desktop capabilities
  (keychain, local OCR, background jobs) wire in as the host gains them. Remaining
  and **environment-gated** (not runnable in CI): code signing, notarization, and
  building platform installers via `electron-builder`. No embedded Convex backend.

### Capabilities are now injected end-to-end

- Convex side: handlers obtain providers through `buildConvexCapabilities()`
  (`convex/providers/capabilities.ts`) instead of importing `providers/*` directly
  — converted at `notifications.sendDigest` (email + SMS).
- Local side: `StaticConvexClient` runs portable functions with
  `buildLocalCapabilities()`; absent services raise a structured
  CAPABILITY_UNAVAILABLE naming the runtime, never a silent no-op.

## Decision record

- **Portable functions + `ctx.db` contract**, not an embedded Convex backend
  (greenfield in `electron/`, contradicts the repo's "don't clone the cloud"
  ethos) and not a `convex-test` fork (it's a test harness; keep it as an oracle).
- **One local adapter** for browser + Electron; `DexieWorkspaceClient` adds no
  logic over `StaticConvexClient`.
- **Preserve the `anyApi` string-dispatch contract** (`src/lib/convexApi.ts`) —
  the 957 hook call-sites stay untouched.
- **Stable `entityId` before sync** — the opaque Convex `_id` (656 FKs) cannot be
  the cross-runtime durable identity.

## Run it

```bash
npm run test:portable-runtime         # Phase 0: differential conformance (MemoryDb vs LocalStoreDb)
npm run test:portable-live-runtime    # Phase 1: the real StaticConvexClient runs portable handlers live
npm run test:portable-convex-oracle   # Phase 2: convex-test (real Convex ctx.db) == local engines
npm run test:voting-power             # the shared kernel (unchanged)
npm run test:static-parity            # the mirror gate (still green during migration)
```
