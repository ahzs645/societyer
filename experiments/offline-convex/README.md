# Convex offline draft evaluation

A separate lab for PowerSync storage and queued drafts while keeping Convex as
the authoritative backend. Read the [evaluation and rollout plan](../../docs/offline-convex-evaluation.md).

## Run

Install the main application's dependencies first (`npm ci` from the repository
root), then:

```sh
cd experiments/offline-convex
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:4192 and reload once online to warm the development shell.
Save/edit a draft, switch the browser offline, reload, then reconnect and upload.
The account selector chooses synthetic evaluation
identities. Each account/workspace has a separate database. This interface is
an evaluation fixture, not a new production settings page.

```sh
npm run build
npm run lint
npm test
```

`test:convex` executes the draft mutation in `convex-test` with Societyer's real
identity, membership and permission helpers. `test:browser` runs the actual
SQLite and durable queue in Chromium at phone and desktop widths, including
service-worker shell caching and a true network-disconnected reload.

## Boundaries

- No main-app dependency, route, runtime, auth configuration or schema is changed.
- The SDK is installed only in this directory, with its own lockfile.
- The PowerSync service is not connected. Uploads are manually invoked against
  the sandbox fixture. They execute real mutation logic inside `convex-test`,
  not a live Convex deployment. Download replication is not simulated or claimed.
- The lab's service worker is confined to its separate origin and excludes the
  fixture APIs. It is not the production PWA cache policy.
- The fixture database and HTTP role controls are test infrastructure. Do not
  deploy this Vite server or schema into a production environment.
- The exported `convexTransport()` can use the existing authenticated client.
  `DraftConnector.fetchCredentials()` accepts a backend credential provider.
  Neither is enabled automatically or tested against live services here.
- Rejected drafts stay in the durable queue. Manual conflict resolution,
  replicated server confirmation, attachments and a production recovery UI
  remain future work.

The source-backed live setup requirements, preserved protection boundaries and
other Convex offline projects are detailed in the linked evaluation document.

## Expanded meeting pilot

Open `http://127.0.0.1:4192/meeting.html` for the meeting, child minutes,
attachment and recovery workflow. This now exercises the existing portable
business handlers through a selected PowerSync-backed `LocalRowStore`, versioned
server commands, durable ID mappings and a per-principal permission projection.
Downloaded preparation can be edited by a second browser. The fixture transport
remains a sandbox; it is not a live replication result.

`npm run test:pwa` builds the Workbox PWA and verifies new-tab offline startup
from its precached shell. This uses a loopback preview with fixture middleware;
do not publish the synthetic account server. The original development-shell
service worker is used only by `npm run dev`.

The [meeting pilot runbook](../../docs/offline-meeting-pilot.md) records the
implementation, exact boundaries, Zoer target, prepared live adapters/configuration
and remaining deployment checks. It supersedes the original boundaries above
for meeting attachments and recovery export. Manual conflict resolution,
production auth-route integration, live replication and packaged Electron
qualification remain incomplete.
