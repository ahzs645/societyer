# Procurement catalog service

Derived read-only serving files, explicitly provisioned per workspace. This is
not a Zoer project database. It does not change the collector, SharePoint archive,
workspace memberships, decisions, tasks, or document broker.

Build from the repository root with `npm ci && npm run catalog:build`. The output
contains plain Node ESM and four worker entry points. Node **26.7.0** was tested
with SQLite **3.53.4**, including FTS5 unicode61 and trigram. The Dockerfile is an
alternative to the supplied systemd units; never put private exports/config in an
image. Mount the data and configuration explicitly and use a read-only root FS.
The Ubuntu host bootstrap installs `libatomic1`, required by the official Node
26 Linux binary, in addition to curl, Python and xz utilities.

`CATALOG_CONFIG_FILE` names a private JSON file:

```json
{
  "root": "/srv/procurement-catalog",
  "issuer": "https://YOUR-DEPLOYMENT.convex.site",
  "publicKeys": { "KEY_ID": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" },
  "workspaces": [{ "societyId": "WORKSPACE_ID", "folder": "Zoer/bc-bid-monitor/WORKSPACE_ID" }],
  "origins": ["https://portal.ddcnorth.com"],
  "adminSecret": "A_SEPARATE_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
}
```

The private ES256 key stays in Convex. The VPS has only public verification keys.
Multiple public key IDs allow overlapping rotation; wait out all 10-minute grants
before removing an old public key. The operator secret is separate from reader
credentials. Never log HTTP headers or run cloudflared with debug logging.

The public listener defaults to `127.0.0.1:8788`. `/healthz` reports only health
and a count. All `/v1/WORKSPACE/...` routes require a signed 10-minute grant with
the exact issuer, audience, workspace and folder. CORS uses exact configured
origins. Operator routes are unavailable on this listener even with the secret.

The separate operator listener binds **only** to `127.0.0.1:8789`; it requires the
operator secret. `/admin/activate` verifies the exact source inventory, snapshots
SQLite, builds thin gzip lists and warms analytics before switching `current`.
Preparation and analytics run in separate workers. Failed activation leaves the
serving release alone. Only activated current/previous releases can be read;
prepared candidates are never published just because their directory exists.
Older loaded releases are closed after in-flight readers finish. The current and
previous derived releases are retained; abandoned preparation directories should
be inspected and removed during operator maintenance, never mistaken for a
publication. Convex fallback retention is a separate 14-day rollout policy.

Install `catalog-ssh-gateway.py` root-owned. Its dedicated key must have
`restrict,command="... --config ... --workspace WORKSPACE_ID"`, with a root-owned
authorized-keys file and no publisher-controlled parent directories. The gateway
accepts only probe, checksummed full-copy, the pinned sqlite3_rsync receiver for
one staging file, status, activate, and qualify. It never evaluates a shell
command. Do not grant an unrestricted shell, forwarding, sudo, or an operator
SSH key to the publisher. Keep `/usr/local/libexec/sqlite3_rsync-3.54.1` root-owned.

Use `scripts/procurement/install-sqlite-rsync.ts` to install pinned **3.54.1** from
official checksummed archives on macOS arm64 or Linux x64. The origin and replica
must use the same pinned version. The first transfer copies a clean `VACUUM INTO`
snapshot with SHA-256 verification; subsequent transfers use SQLite's replication
protocol, never ordinary rsync on a live database. Replica headers may differ,
so activation checks original table inventories rather than whole-file equality.

Publisher configuration is a private, explicit JSON file:

```json
{
  "societyId": "WORKSPACE_ID",
  "folder": "Zoer/bc-bid-monitor/WORKSPACE_ID",
  "sshHost": "catalog-publisher@YOUR_HOST",
  "keyFile": "/absolute/path/to/restricted-private-key",
  "knownHostsFile": "/absolute/path/to/verified-known-hosts",
  "sqliteRsync": "/absolute/path/to/pinned/sqlite3_rsync",
  "originFile": "/absolute/private/workdir/catalog-origin.sqlite"
}
```

Run `publish-catalog-service.ts --input EXPORT --config CONFIG --deployment NAME`.
`--dry-run` validates locally with no network request or origin update. A first
copy is automatic; `--full-copy` provides a clean-snapshot fallback. Private keys
and SSH host keys must already be configured; unknown hosts are rejected. A
per-origin lock rejects concurrent publishers. After an interrupted process,
inspect its lock and PID before removing the stale lock directory. A first build
interrupted before its initial transaction commits must rebuild to a new origin
file; it cannot be silently rebound to a different publication/workspace.

`qualify-catalog-service.ts` compares every active row in all five tables, both
thin lists and all ten default analytics views at one clock. Convex reads are
bounded and must still refer to the current serving generation. It saves a
checksummed report and marks only that real publication qualified. Three distinct
consecutive publications are required before `procurementCatalog:setSource` can
select the service. Keep Zoer in `parallel` mode for **at least 14 days after
cutover**. `--service-only` is refused until that period has elapsed. No catalog
deletion is automatic. Backups and a separate bounded cleanup review remain
required before removing the Convex fallback.

Verification: `npm run catalog:typecheck`, `npm run test:procurement-catalog`,
`npm run catalog:build`; browser fixtures run through
`npx playwright test -c playwright.procurement.config.ts tests/procurement-service.spec.ts`.
The phone fixture uses a constrained page scroller like the application shell;
an unconstrained fixture makes a virtual list try to fill the entire document.
Synthetic browser timings are not live network or physical-device measurements.

References: [SQLite replication](https://sqlite.org/rsync.html),
[official SQLite archives and hashes](https://sqlite.org/download.html),
[Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/),
[Tunnel parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/).
