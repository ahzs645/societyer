# Meeting offline pilot and Zoer test target

Status: this is the historical fixture/Zoer baseline. Actual local PowerSync and
full-app qualification subsequently passed; production meeting-preparation code,
credential delivery and invalidation are now implemented. See the current
[production rollout runbook](powersync-production-rollout.md) and
[qualification report](powersync-production-qualification.md). Public production
activation still requires configured deployment credentials and HTTPS routing.

The record below describes the original fixture baseline at `ef5f8d9`, before
that local backend follow-up. Its source fingerprints and unchanged-source
claims apply to that historical baseline.

Prepared on 2026-10-04. Reconciled main is
`4b15fd20f3b82baa6b18cb95be7b2c62404884b3`; interface fixes are the existing
local commit `bb513c4`. `cc52e24487f42c19f81b2d22385091006bc70b44` remains
an ancestor. Main was fetched and its actual diff checked before this expansion.
Application source, authentication, root dependencies and the production Convex
schema remain unchanged. The prior research prototype was present locally but
uncommitted; this deliverable includes it so another checkout can reproduce it.

## Reproduce

From the Societyer root, install the root dependencies with `npm ci`, then:

```sh
npm --prefix experiments/offline-convex ci --ignore-scripts
npm --prefix experiments/offline-convex run dev
```

Open `http://127.0.0.1:4192/meeting.html`. Save a meeting and a small attachment,
edit the minutes discussion, disconnect and reload, then reconnect. Upload
commands, refresh the authorized fixture view, and transfer attachment bytes
separately. The account selector is synthetic fixture infrastructure.

```sh
npm --prefix experiments/offline-convex run lint
npm --prefix experiments/offline-convex run typecheck
npm --prefix experiments/offline-convex run test
npm --prefix experiments/offline-convex run test:pwa
```

Playwright uses Chromium at 320 × 740 and 1440 × 900. The PWA command builds the
actual Workbox app and starts a separate loopback preview on 4193. It closes the
page and opens a new tab offline after the initial online installation. This
proves built-shell offline startup; it does not prove OS installation, physical
mobile browsers, full browser-process termination or packaged Electron.

## What is implemented

- PowerSync 2.4.2 owns SQLite persistence and the durable upload queue. A narrowly
  scoped `LocalRowStore` adapter runs Societyer's unchanged meeting, minutes,
  document and meeting-material handlers. No generic custom replication protocol
  or second outbox is added.
- One versioned `create-meeting` command creates a meeting, agenda, agenda item,
  minutes, and optional attachment metadata. Local rows, command metadata,
  recovery history and file bytes commit in one real SQLite transaction.
- Server upload invokes the same domain handlers, checks current verified
  identity and permissions, applies revision preconditions, then commits graph,
  stable/native mappings, receipt and download projections atomically.
- Child minutes edits depend on the accepted parent mapping. A rejected parent
  holds child commands and file transfers, with all work preserved through restart.
- Stable UUIDs are separate from Convex `_id`. Mapping persists both on the
  server and in local acceptance history. Existing `entityId` fields are not
  rewritten or assumed to have a universal meaning.
- Device databases are keyed by a hash of deployment, issuer, subject and
  workspace. Both generic-draft and meeting experiments use distinct scopes.
  Session changes clear the old interface and prevent acknowledging another
  actor's queue after an in-flight upload.
- Narrow, per-principal download projections invoke the actual meeting and
  material/document readers. They omit credentials, raw user rows, native file
  storage IDs, signed URLs, meeting passcodes and unrelated registers.
- Downloaded preparation can be edited through the same local minutes handler
  by a second browser. Revisions protect against overwriting another client's
  work. Pending and currently edited drafts survive refreshed server views.
- The fixture interface shows local saves, waiting commands, server acceptance,
  needs-review work, an independent server view and file-transfer availability.
  Recovery export includes the durable command context and attachment bytes.
- Files have independent availability, a 1 MB pilot bound, persisted bytes,
  SHA-256 verification, current server permissions and workspace storage claims.
  Metadata acceptance alone never claims that another device has the file.
- Built PWA caching uses `vite-plugin-pwa` 2.0.0 / Workbox. Fixture APIs are excluded.
  The development cache is retained only for the old lab. The built pilot
  precaches about 7.6 MiB, including SDK worker/WASM variants; this is not a
  measured production performance budget.

Local preparation has a bounded reference context. Server quorum and governance
checks run against current authoritative records. A local preparation result is
not a server approval or a promise that its quorum calculation will be accepted.
Approvals, adoption, role changes, financial operations and filings are excluded
from the command allowlist. Adopted minutes cannot be changed by these commands.

## Download policy comparison

Native tests independently compare materialized download payloads with
Societyer's meeting and meeting-material readers, and check every included
attachment with the document reader. Cases cover Owner, Viewer, a foreign
workspace, explicit restricted grants, withdrawal, expiry, removed grants,
changed role, disabled membership and disabled external identity.

The materializer is intentionally bounded to 100 pilot meetings and 50
memberships per workspace. It rejects oversized datasets rather than publishing
a partial view. Tests force a failure after domain writes and prove rollback
of the new records and receipt.

**Projection maintenance is not wired into all production mutation paths.**
The fixture rebuilds after commands, file completion and role controls. ACL tests
explicitly rebuild after their changes. A live operator must rebuild after all
membership, identity and visibility changes, including time-based expiry.
Production rollout needs transactional invalidation or a reliable scheduled
materializer and measured revocation latency. Matching native query results
is not proof that a deployed PowerSync service delivers the same rows.

Downloaded preparation rows removed from a complete fixture view are pruned
when they have no pending or currently edited work. Authored local drafts and
recovery copies remain separate. The pilot does not implement encrypted caches,
logout wiping or immediate remote erasure of disconnected devices.

## Live adapters and configuration

The experiment includes a compiled `connectMeetingPilot()` adapter that uses
the existing authenticated Convex client, rechecks the server-derived scope,
connects the real SDK, and converts its replicated projection rows into the
selected portable preparation rows. A server-only `issueMeetingSyncCredential()`
adapter uses the existing Better Auth machine signer, including Clerk mode,
with a five-minute token, instance audience and server-derived workspace.
It is not mounted as a public route in Societyer. Its policy and claim shape are
tested; signing through a real broker and PowerSync token verification remain
live checks. No additional human sign-in system is introduced.

`experiments/offline-convex/powersync/` contains the Sync Streams, service
configuration and isolated Kubernetes workload template. PowerSync service is
pinned to `journeyapps/powersync-service:1.26.1`; the Convex source connector is
still experimental. Templates have not been applied or runtime-qualified.
The required checkpoint schema/mutation and existing auth configuration are
included in the isolated Convex function directory.

The Sync Stream selects only `offlineMeetingDownloads`, using the signed JWT's
exact issuer-qualified actor key and workspace. Do not adopt the todo example's
subject-prefix extraction or broad membership-only document replication.

## Zoer target and access boundary

The user selected `https://zoer.k8s.overtheedgepaper.ca/` for testing and authorized
updates/redeployment of `/Users/ahmadjalil/github/zoer` if needed.
The available cloud checkout is `/workspace/zoer`, cloned from
`ahzs645/zoer` at `2fde629743494b9314a996309f2c121d106fd3a3`.
The Mac checkout is not mounted here. Zoer's `AGENTS.md`, development runbook,
server-dev guide and repository-deployment guide were inspected.

A normal HTTPS request to the selected host was rejected by the runtime proxy:
`Tunnel connection failed: 403 Forbidden`. Runtime observations report no VPN,
cluster credentials or outbound identity. There is no `kubectl` installation or
configured cluster access. No attempt was made to bypass that network denial.
No Zoer code was changed, no shared services or volumes were replaced, and
nothing was deployed or pushed to its main branch.

Zoer's existing static dev/live builds can host the eventual authenticated PWA
shell; long-running PowerSync and its storage are separate services. Existing
Zoer project SQLite databases are not substitutes for Convex or PowerSync's
replication storage. A Zoer app redeploy has not been shown to be necessary.
Do not publish the synthetic-account fixture server on a public route.

After the local checkout or an authorized cluster environment is attached:

1. Read current live Deployment/Ingress/service inventory and Zoer's private
   deployment memory if available. Verify host reachability and cluster context.
   Preserve its authentication mode, computers and existing Convex/fallback state.
2. Establish a disposable **Societyer** Convex deployment and genuine test
   identities using the current broker. Never deploy this schema over Zoer's
   own backend or Societyer's production database. Provision canonical users
   through reviewed operator setup; the fixture seed is not a deployable auth API.
3. Supply the pilot Secret keys `POSTGRES_PASSWORD`, `PS_STORAGE_URI`,
   `PS_CONVEX_DEPLOYMENT_URL`, `PS_CONVEX_DEPLOY_KEY`, `PS_JWKS_URL`, and
   `PS_PUBLIC_ORIGIN` through the environment/cluster's secret workflow.
   The export key needs `deployment:data:view`; keep it off clients.
4. Validate the pinned service configuration and restricted stream. Create the
   reviewed ConfigMap from the two YAML files and deploy only the separate
   `societyer-offline-pilot` workloads. Configure TLS routing and CORS for the
   actual approved client origin. The template publishes no public ingress.
5. Mount the sync-credential adapter behind the existing authenticated session
   resolver and connect the selected feature through `connectMeetingPilot()`.
   Add deployment-specific attachment transport using the existing storage
   ownership rules. Keep fixture middleware out of this build.
6. Verify the download materializer's invalidation paths, then exercise two
   authenticated clients, initial-snapshot interruption, deletes, lost acks,
   conflicts, revocation, expiry and long-disconnected catch-up. Compare the
   **actual replicated SQLite rows** with the authorized Convex reader.
7. Qualify PWA updates with queued work and the packaged Electron worker/protocol
   paths. Only then enable an opt-in synced-workspace choice in Societyer.

Zoer updates, if inspection demonstrates they are needed, use its existing
`server:dev` helper with authorized kubeconfig/SSH access. A GitHub push alone
is not a verified Zoer container rollout; its inspected CI is lint/typecheck/test.

## Evidence and remaining work

Exact results and source fingerprints are in
[`artifacts/offline/meeting-pilot-results.json`](../artifacts/offline/meeting-pilot-results.json).
The prior `evaluation-results.json` is historical evidence for the earlier
19-file prototype, not the source fingerprint of this expanded pilot.
The older reported aggregate hash could not be reproduced with its stated
algorithm. The current record includes a fresh fingerprint and a byte comparison
against all 993 source files at `bb513c4`; every file matches that Git baseline.

The browser clients talk to real Convex mutation logic in `convex-test`, not a
live deployment. Fixture downloads use authorized HTTP queries, not PowerSync
replication. The prototype preserves a blocked FIFO queue and offers export;
it does not yet provide conflict merge/rebase or discard/retry controls for
unrelated blocked commands. Unknown command versions require recovery rather
than an automatic migration. Real providers, deployed read ACLs, storage
eviction, sustained scale, actual Electron packaging and live Zoer deployment
remain unverified.
