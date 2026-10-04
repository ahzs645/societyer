The local pilot keeps the Convex backend, PowerSync service and sync storage separate from Societyer's production deployments. All client ports bind to loopback.

Run from `experiments/offline-convex` after installing the root and pilot dependencies:

```sh
node local/start.mjs
npm run local:jwks
# In another terminal, while the public JWKS server remains running:
npm run local:deploy
node local/start.mjs --powersync
node local/check-replication.mjs
```

The endpoints are Convex `http://127.0.0.1:43210`, public test JWKS `http://127.0.0.1:43212/jwks.json`, and PowerSync `http://127.0.0.1:43220`. The PowerSync JWT audience is exactly that last origin. The local signer is confined to this test deployment; production credentials still come from the configured authentication broker.

The start script writes private credentials to ignored `.env.local` with mode `0600`, then generates the backend key before starting the optional PowerSync profile. The signing key is separately stored in ignored `.env.signer.local`. Do not expose these files or the test identity bridge publicly.

PowerSync 1.26.1 and PostgreSQL 17.6 are pinned by digest. The sync database has no published host port. A generated, ignored configuration explicitly uses plaintext PostgreSQL only on this isolated Docker network because that local database has no TLS listener. The deployment template keeps verified TLS as its default. When the managed runtime supplies a proxy CA, a generated Compose override mounts that public certificate read-only and extends Node trust.

The protocol check runs against real Convex exports and the actual PowerSync service. It verifies scoped Owner and Viewer projections, a replicated child update, foreign workspace and request parameter isolation, rejected invalid credentials, and automatic projection changes after role changes, membership suspension/reactivation, security disabling and removal. The pilot's exported user mutations preserve the production validators and authorized handlers, then refresh projections in the same transaction. This covers those four pilot paths; document/material ACL updates, external identity changes and expiry still require release support. Browser tests separately qualify the SDK's SQLite storage, command queue and interface.

Results are written to `artifacts/offline/live-powersync-replication.json` at the repository root.

Stop all pilot services without deleting their data:

```sh
docker compose --env-file .env.local -f local/docker-compose.yaml --profile powersync stop
```

On the managed cloud runtime, the start script selects `/var/run/docker.sock` explicitly. These loopback endpoints are on that workspace machine, not on the user's Mac.

For the actual SDK browser tests, start the services above and run:

```sh
npm run test:powersync:browser
```

This builds the Workbox PWA and starts a loopback preview on port 4195. The tests use genuine signed Convex sessions, native Convex commands and file storage, and PowerSync replication into each browser's separate SQLite database. Widths are 320, 390 and 1440 pixels. The local session bridge is enabled only with `SOCIETYER_LOCAL_LIVE_PILOT=1`; it rejects remote sockets, untrusted Host headers and cross-origin requests. It never sends an admin key or signing key to the browser, and authentication tokens are excluded from shell caches and persisted session bindings.

For manual inspection after building, run `npm run preview:live` and open `http://127.0.0.1:4195/meeting.html?live=1&run=manual-live`. The account selector belongs only to this isolated test deployment. The separate production application continues to use its configured authentication provider.

PowerSync can postpone applying a replication checkpoint while rejected local CRUD remains in its queue. Therefore pending work can delay the checkpoint containing a permission deletion. The pilot observes the authenticated native identity query, handles server authorization denials from the credential broker and command transport, and immediately clears downloaded attachment bytes and the mirrored read view on such a denial. Authored drafts and the SDK queue remain available for recovery. A network failure alone keeps offline preparation usable. Downloaded bytes are checked against the complete authorized file list before pending or unsaved drafts are preserved, and a completed download rechecks its scope, authorization generation and replicated file row inside its SQLite cache-write transaction.

These safeguards qualify the selected meeting pilot. Full production replication still needs every document/material ACL, external identity and expiry change to refresh the projection, together with the production credential endpoint and a policy for pending commands that permanently lose permission. The experiment does not add offline behavior to every Societyer module.
