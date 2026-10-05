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
The experimental `users` functions retain the actual production validators,
authorization wrappers and membership handlers, then rebuild meeting download
projections in the same transaction after the four supported role/status/removal mutations; `files:getUrl` reuses the actual file ACL path.
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
UI or PowerSync to this backend. The explicit live mode and optional PowerSync
service are described in [the runtime instructions](../experiments/offline-convex/local/README.md).

## Initial backend qualification and baseline

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

The production upload integration has now been corrected and separately tested
against the isolated full application backend at `http://127.0.0.1:43230`.
`files:generateUploadUrl` requires an explicit workspace and checks the permission
for its declared document, meeting, asset or inventory purpose. Branding uploads
require the same Owner/Admin permission as their society branding sinks. Browser
callers and import scripts now send that workspace scope. Native blob identifiers
are excluded from ordinary row lookups; attachment handlers still enforce their
workspace claim and document ACL. New asset/item image bindings also enforce the
native-storage switch, while existing-image metadata edits remain available.

All eight live upload groups passed with actual Better Auth email sessions,
broker-issued JWTs verified by Convex, native HTTP byte uploads, authoritative
file metadata, byte-for-byte downloads, role and inactive-membership denial,
foreign-workspace rejection, duplicate attachment handling and asset/inventory
photo persistence. Run `node experiments/live-qualification/check-uploads.mjs`
after preparing that isolated fixture; its credential files remain local. Results
are recorded in [live-upload-results.json](../artifacts/offline/live-upload-results.json).
The native oracle additionally covers Clerk identity binding, the disabled-storage
branding exception, local capability behavior and RustFS/R2 hash verification.
Phone/desktop UI coverage is recorded by the separate interface browser suites.

Encrypted vault qualification also passed nine live groups using the same real
Better Auth sessions. Update and reveal now derive their workspace from the
authorized vault row, rather than expecting a default workspace in the JWT.
The review found an Admin could change an Owner-only record's reveal policy and
then reveal its value. Existing Owner-only access-policy or stored-value changes
now require the authenticated Owner; ordinary Admin metadata edits remain
available. The final checks cover encrypted create/rotation/reveal, public
metadata redaction, default Admin grants, Owner-only restrictions, unchanged
value/access policy after denied changes, forged actors, foreign workspaces and
lower or inactive principals. Run `npm run test:live-vault` against the prepared
isolated lab. [Initial findings](../artifacts/offline/live-vault-initial-findings.json)
and [final results](../artifacts/offline/live-vault-results.json) remain separate.
Only synthetic values were used; keys, ciphertext and plaintext values are not
exported to these artifacts. Browser viewport qualification is a separate suite.

## Live PowerSync follow-up

The optional digest-pinned PowerSync service now runs on loopback port 43220 with
private PostgreSQL sync storage. Eleven actual protocol scenarios pass against
that service: signed credentials, exact Owner/Viewer read projections, replicated
child updates, workspace and token isolation, and automatic updates/deletion after
all four exported user lifecycle mutations. No manual rebuild is required for
those supported pilot paths. The real SDK browser suite separately tests SQLite,
durable offline commands, native attachment transfers, conflicts and reconnects;
see the consolidated qualification report for its final results.

This records the earlier meeting-preparation pilot. The subsequent [production
rollout](powersync-production-rollout.md) adds document/material ACL, external
identity and temporal invalidation, native credential delivery and permanent
command recovery. See its [qualification](powersync-production-qualification.md)
for the current root application evidence and deployment prerequisites. Offline clients cannot receive revocation while
unreachable. Pending SDK CRUD can hold a replication checkpoint, so native
authorization denial must also clear downloaded cache while retaining authored
recovery work. Packaged Electron and external provider sign-ins remain unqualified.
