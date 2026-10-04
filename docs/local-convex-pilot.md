# Local Convex pilot

The isolated self-hosted Convex instance runs at `http://127.0.0.1:43210`
(HTTP actions: `http://127.0.0.1:43211`). It has its own Docker Compose project,
data volume and random instance secret. The root application's deployment,
Zoer and production data are not used.

This instance was started in the Codex cloud workspace on 2026-10-04. These
loopback URLs belong to that workspace, not to your Mac. Use the commands below
to run the same setup on your machine; no external credentials are required.

## Start and test

Requires Docker Compose, Node 22.15+ (or Node 24), and the repository's root
dependencies (`npm ci` at the root). From the repository root:

```sh
cd experiments/offline-convex
npm ci --ignore-scripts
npm run local:start
npm run local:jwks
```

Leave the public-key server running. In another terminal, in the same directory:

```sh
npm run local:deploy
npm run test:live
```

`local:deploy` refuses any URL or instance key other than this isolated pilot.
It deploys only `experiments/offline-convex/convex`, using the existing root
schema and shared domain handlers. It does not deploy all production functions.
The experimental `users` functions re-export the actual production authorization
wrappers and membership handlers; `files:getUrl` reuses the actual file ACL path.
The pilot upload endpoint explicitly takes a workspace and checks current
meeting/document write permissions and the native-storage switch.

Credentials are stored privately in ignored `.env.local` and `.env.signer.local`
files, with mode 0600. The signer publishes **only public JWKS**, on port 43212;
only the local test process reads the private key and signs tokens. The backend
fetches that public key through Docker's host gateway. Backend API ports bind
only to loopback. This is disposable test authentication, not an additional
production login provider. Do not publish this test signer or admin fixtures.

The backend image is pinned to
`ghcr.io/get-convex/convex-backend@sha256:d715e9ec088784407ca4ba2d3db592702cd328d02c76cdca3852c0018f2a76b4`.
Each live test run creates fresh workspaces and issuer/subject-bound memberships
through an internal, admin-only fixture. Existing data is not reset.

Stop the backend without removing its data:

```sh
npm run local:stop
```

Stop `local:jwks` with Ctrl+C. Keep the private environment files with the data
volume when restarting. The existing Vite meeting lab on port 4192 still uses
its synthetic fixture; running local Convex does not automatically connect that
UI or PowerSync to this backend.

## Verified results and baseline

Baseline: branch `work`, commit `ef5f8d9`, following interface baseline
`bb513c4` and reconciled main `4b15fd2`. Commit
`cc52e24487f42c19f81b2d22385091006bc70b44` remains an ancestor. This local setup
does not merge or push to main.

The first real deployment exposed a shared runtime bug: an unset Node/Convex
environment variable fell through to Vite's `import.meta.env`, which Convex
does not support. `shared/portable/define.ts` now uses the server environment
whenever it exists and retains the Vite environment path for browsers. This is
the only production source change in the local-instance work. Sign-in, profile,
workspace role and Microsoft tenant configuration are unchanged.

The [live results](../artifacts/offline/local-convex-results.json) record 16
passing checks against the actual backend, including real ES256 verification,
invalid/expired/foreign tokens, anonymous denial, cross-workspace isolation,
Viewer restrictions, idempotent receipts, stale revisions, atomic graph creation,
native attachment hash verification/download ACLs, two authenticated WebSocket
clients, role revocation and last-active-Owner protections.

The reconciled security suite (including Clerk, Better Auth Microsoft tenant
restrictions, identity binding, workspace/module authorization and Owner
protections) and combined web/backend build passed after the runtime fix.
These broker checks are automated tests; this pilot does not perform a live
Clerk or Microsoft provider login.

Additional validation passed: 27 native fixture checks, 34 phone/desktop browser
cases, 2 built-PWA offline-start cases, pilot typecheck/lint/build and desktop
typecheck. The browser/PWA checks continue to use the native fixture transport;
the 16 live checks are a separate HTTP/WebSocket suite.

The existing production `files:generateUploadUrl` endpoint takes no workspace
argument. The live pilot found that its shared action wrapper rejects a hosted
principal without workspace context before reaching the membership helper.
The pilot uses its explicitly scoped upload endpoint; the production endpoint
and its callers still need that integration fix. This run does not qualify the
production upload UI.

PowerSync service authentication and download replication still need a live
service test. These two clients test Convex subscriptions, not PowerSync
replication. ACL/membership changes still require an explicit projection rebuild
in this experimental backend. The local test verifies that rebuild, rather than
claiming automatic production invalidation. Packaged Electron remains unqualified.
