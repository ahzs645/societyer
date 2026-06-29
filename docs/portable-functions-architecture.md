# Portable Functions + `ctx.db` Repository Contract

> Status: **Phase 0 landed** (foundation + first slice). This document is the
> design record and the migration plan. It realizes — and supersedes the
> "keep & expand the static mirror" parts of — [`electron-local-first-plan.md`](./electron-local-first-plan.md).

## Why

Societyer ships a hosted-Convex web app **and** an offline/desktop runtime. Today
the offline runtime is a ~10,900-line hand-written mirror of the backend
(`src/lib/staticConvex.ts` + siblings) that re-implements ~300 functions by hand,
guarded by a name-coverage ledger (`src/lib/staticConvexParity.ts`). That mirror
is the symptom of a missing abstraction: there is no `ctx.db` seam that lets the
**real** Convex handlers run on a non-Convex store, so every handler gets a
second, hand-maintained copy that drifts (76 writes are tracked as not-yet-mirrored).

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
| `ctx.ts` | The bounded `ctx.db` surface: `get / query(table).withIndex().filter().order().collect()/first/unique/take/paginate`, `insert/patch/replace/delete`, and `TransactionalDb.transaction`. Plus `PortableQueryCtx` / `PortableMutationCtx`. |
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

### The sync boundary (why the mirror isn't fully deleted yet)

The live static client's reactive recompute (`watchQuery`) is **synchronous** and
feeds 435 `useQuery` sites; a portable handler on the contract is **async**.
Rewiring the local reactive core to async is **Phase 1** — until then the static
mirror keeps a thin synchronous row-load that calls the shared marshaller, so the
duplicated *logic* is gone even though the async portable handler isn't yet the
live local executor. The Convex side already runs the portable handler in
production.

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
- **Phase 1.** Make the local reactive path async (async executor + synchronous
  last-result cache for React); route the live local runtime through
  `PortableRuntime` over `LocalStoreDb`. Convert `providers/*` call-sites to
  injected `ctx.capabilities`.
- **Phase 2.** Adopt `convex-test` as a third conformance engine in the harness
  (highest-fidelity oracle; runs the registered Convex functions). It is an
  **oracle, not the production engine** (it depends on `node:async_hooks`).
- **Phase 3.** Port handlers domain-by-domain; delete each mirror case as its
  differential test goes green; move ledger entries to capability tiers.
- **Phase 4.** Electron native-filesystem document provider + packaging
  (per `electron-local-first-plan.md`). No embedded Convex backend.

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
npm run test:portable-runtime   # differential conformance (this architecture)
npm run test:voting-power       # the shared kernel (unchanged)
npm run test:static-parity      # the mirror gate (still green during migration)
```
