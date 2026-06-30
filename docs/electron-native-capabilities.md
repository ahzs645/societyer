# Electron-native capabilities: running Wave & n8n offline on desktop

> Status: **design proposal — not yet implemented.** This document describes how
> the connected/server-only operations that currently *can't* run in a fully
> offline workspace (Wave sync, n8n workflow execution, and the rest of the
> "connected" tier) would run **natively in the Electron desktop app**, through
> the capability seam established by the portable-functions migration
> ([`portable-functions-architecture.md`](./portable-functions-architecture.md)).
> The goal here is the *shape* of the work, not the code.

## TL;DR

"Not pure `ctx.db`" never meant "the desktop app can't do it." The portable
migration split every backend operation into:

- **portable** (pure `ctx.db`) — already runs on all three runtimes (773 functions).
- **capability-backed** — needs a side effect (network, storage, AI, a scheduler).
  On hosted Convex these resolve to `convex/providers/*`; on the **browser** they
  throw a structured `CAPABILITY_UNAVAILABLE`; on **Electron** they can resolve to
  a *native* implementation because the Electron main process is a full Node
  runtime with no browser sandbox.

Wave and n8n are capability-backed. The browser genuinely can't do them (CORS +
secret exposure + no engine). **Electron can** — the main process can fetch Wave
directly, hold the token in the OS keychain, and spawn/relay to a local n8n.
What's missing is the wiring, not the possibility.

## The seam this builds on

The contract already carries an injected capability bag (`shared/portable/capabilities.ts`):

```ts
export type CapabilityKey =
  | "email" | "sms" | "storage" | "llm" | "transcription"
  | "accounting" | "billing" | "paperless" | "scheduler" | "http";
```

- `makeCapabilities(provided, reasonFor)` fills any *absent* capability with a stub
  that throws `CAPABILITY_UNAVAILABLE` — never a silent no-op.
- `src/lib/localCapabilities.ts` → `buildLocalCapabilities({ provided })` is the
  single seam where a local runtime injects what it actually has. Today `provided`
  is empty (browser parity). **Electron passes a populated `provided` here.**
- Only `email/sms/storage/llm` have concrete interfaces in `PortableCapabilities`
  so far; `accounting`/`http`/`scheduler` are declared keys awaiting an interface.

### The desktop bridge precedent

Native document files already do exactly this pattern and ship today:

```
renderer (portable handler / adapter)
  → src/lib/documentStorage.ts  requireDesktopBridge()
  → electron/preload.ts         contextBridge.exposeInMainWorld(...) + ipcRenderer.invoke
  → electron/ipc*.ts            ipcMain.handle(channel, validate, run)
  → electron/documents.ts       native fs read/write
```

Wave and n8n are the same shape with a different leaf (network instead of fs).
The relevant building blocks already exist in `electron/`:

| Need | Existing module |
|---|---|
| Secret-at-rest (Wave token, n8n key) | `electron/safeStorage.ts` (OS keychain) |
| Spawn/relay a local process (n8n) | `electron/processManager.ts`, `electron/services.ts`, `electron/serviceProfiles.ts` |
| Typed IPC channel + payload validation | `electron/preload.ts`, `electron/ipc*.ts`, `electron/ipcValidation.ts` |
| Outbound HTTP from a CORS-free context | the main process itself (Node `fetch`) |

## Wave sync (the `accounting` / `http` capability)

### Why it can't run in the browser

`financialHub:sync` is a Convex **action** that does
`fetch("https://gql.waveapps.com/graphql/public", { Authorization: Bearer WAVE_ACCESS_TOKEN })`.
Three blockers, each runtime-specific:

1. **It's an `action`, not `ctx.db`** — actions orchestrate (`ctx.runQuery/runMutation`)
   and don't exist in the portable runtime. The *write* half (`_replaceSyncedData`)
   is already pure `ctx.db`; only the fetch+orchestrate shell isn't.
2. **CORS** — Wave's API is server-to-server and sends no CORS headers, so a
   browser tab cannot call it. (This is exactly why the repo already has a separate
   `importBrowserWaveTransactions` mutation + `isBrowserWaveConnection` flag: the
   browser path imports pre-fetched data rather than calling Wave live.)
3. **The secret** — `WAVE_ACCESS_TOKEN` cannot be shipped to a browser bundle.

The Electron main process has **none** of these constraints: it's Node (no CORS),
and it can store the token in the OS keychain via `safeStorage`.

### Proposed shape

1. **Define the capability interface** in `shared/portable/capabilities.ts`:

   ```ts
   export interface AccountingCapability {
     listAccounts(input: { connectionId: string }): Promise<WaveAccount[]>;
     listTransactions(input: { connectionId: string; since?: string }): Promise<WaveTransaction[]>;
   }
   ```
   Add `accounting: AccountingCapability` to `PortableCapabilities` (stub throws
   `CAPABILITY_UNAVAILABLE("accounting", …)`).

2. **Make `sync` a portable handler.** Split today's action:
   - `financialHub:syncPortable(ctx, { connectionId })` — pure `ctx.db` + the
     capability: `const { accounts, transactions } = await ctx.capabilities.accounting.listTransactions(…)`,
     then the existing `_replaceSyncedData` logic inline over `ctx.db`. This runs
     unchanged on hosted Convex (capability → `convex/providers/accounting.ts`),
     and on Electron (capability → native fetch).
   - The thin Convex `action` stays only where Convex requires an action wrapper
     for the scheduled path; it delegates to the same kernel.

3. **Provide the native implementation on Electron.** In the desktop bootstrap,
   `buildLocalCapabilities({ provided: { accounting: makeElectronAccounting(bridge) } })`
   where the bridge IPC-invokes a new `WAVE_SYNC_CHANNEL` handled in `electron/`:
   the main process reads the token from `safeStorage`, `fetch`es Wave's GraphQL,
   and returns normalized rows. Reuse the existing `redactWaveDiagnostic` and the
   `waveListAccounts/waveListTransactions` GraphQL bodies (move the pure GraphQL
   query strings into a `shared/` module; keep the `fetch`+token in `electron/`).

4. **Secrets.** The Wave token lives in `safeStorage` (OS keychain), entered once
   in desktop settings — never in the renderer, never in `ctx.db`.

### Result per runtime

| | Browser | Electron | Hosted Convex |
|---|---|---|---|
| `financialHub:sync` | `CAPABILITY_UNAVAILABLE` (use browser import path) | **native fetch via keychain token** | provider fetch (today) |

## n8n workflow execution (the `http` capability + an optional managed engine)

### What blocks it

`workflows:run` is an action; for `provider === "n8n"` it `runExternalWorkflow(…)`
which POSTs to an **n8n instance's webhook URL**. The only hard requirement is
*"there must be an n8n to reach."* There are three independent answers:

1. **Internal provider — portable now.** Workflows already ship an `internal`
   provider that runs steps **in-process** (`stepsForRun`, honestly marking
   un-performable steps `manual_required` instead of faking success). That runner
   is mostly pure compute + `ctx.db`; porting it (minus steps that *themselves*
   need email/network) means **internal workflows run fully offline today** with no
   engine at all. This is the recommended first deliverable — it removes n8n from
   the critical path for the common cases.

2. **n8n via the `http` capability (relay).** Keep `provider === "n8n"` but route
   its POST through `ctx.capabilities.http.fetch(...)`. On Electron the http
   capability is a main-process fetch; the target URL is read from desktop config:
   - a **user-run local n8n** (`http://127.0.0.1:5678`), or
   - a **remote/cloud n8n**.
   Either works offline-from-the-cloud as long as the engine is reachable on the
   LAN/localhost.

3. **Desktop-managed local n8n (optional, heaviest).** `electron/processManager.ts`
   + `serviceProfiles.ts` already manage child services; a profile could spawn a
   bundled/sidecar n8n on first use and tear it down on quit, so "offline n8n"
   works with zero user setup. This is a larger packaging investment (ship/locate
   the n8n binary, port allocation, health checks) and should be gated behind a
   desktop feature flag.

### Proposed shape

1. **Port the internal runner** to a portable `workflows:runInternalPortable(ctx, …)`
   over `ctx.db` (step bookkeeping + `manual_required` semantics are already pure).
2. **Add `HttpCapability`** (`fetch(input): Promise<{ status; body }>`) to the
   contract; `workflows:run`'s n8n branch calls it instead of a bare `fetch`.
3. **Electron provides `http`** via an IPC channel that allow-lists localhost +
   the configured n8n origin (no arbitrary SSRF), with the n8n API key from
   `safeStorage`.
4. **(Later)** a `n8n` service profile in `electron/serviceProfiles.ts` to
   spawn/supervise a local engine.

### Result per runtime

| | Browser | Electron | Hosted Convex |
|---|---|---|---|
| internal workflows | **portable (in-process)** | **portable** | portable |
| n8n-provider workflows | `CAPABILITY_UNAVAILABLE` | **relay to local/remote n8n** (opt. managed) | provider POST (today) |

## Security notes (both)

- Secrets (`WAVE_ACCESS_TOKEN`, n8n API key) live only in `electron/safeStorage.ts`
  (OS keychain); they never enter the renderer, the bundle, or `ctx.db`.
- The `http` capability **allow-lists** destinations (Wave's host; localhost + the
  configured n8n origin) — it is not a general fetch proxy, to avoid turning the
  desktop app into an SSRF gadget.
- `CAPABILITY_UNAVAILABLE` stays the contract for "this runtime can't": the browser
  build declines loudly rather than pretending. No silent no-ops.

## Suggested sequencing (each independently shippable)

1. **Interfaces** — add `AccountingCapability` + `HttpCapability` to
   `shared/portable/capabilities.ts` (+ throwing stubs). *No behavior change.*
2. **Wave** — `financialHub:syncPortable` + the Electron `accounting` provider over
   a `WAVE_SYNC_CHANNEL`; keychain token in desktop settings.
3. **Workflows (internal)** — port the in-process runner to `ctx.db` so internal
   workflows run offline everywhere.
4. **Workflows (n8n relay)** — `http` capability + allow-listed Electron fetch.
5. **(Optional)** desktop-managed local n8n via a service profile.

Steps 1–3 are modest and self-contained; 4 is small; 5 is a packaging project.
None require an embedded Convex backend — they extend the same capability seam the
storage/email/AI capabilities already use.
