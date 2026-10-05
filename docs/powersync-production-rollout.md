The production path keeps Societyer's current Clerk or Better Auth sign-in. The root application exposes `/app/meetings/offline` for meeting preparation only; other modules continue to use Convex directly. PowerSync synchronizes the authorized `offlineMeetingDownloads` projection, while drafts and uploads use the native Convex commands and production storage adapter.

The server now delivers credentials at `POST /api/v1/offline/meeting-preparation/credentials`. The browser sends `{ "societyId": "selected-workspace-id" }` through its existing authenticated fetch. The route requires the exact application Origin and a hosted user session, rechecks `offlineMeetings.syncIdentity` with that session's native Convex token, and signs an ES256 token using the existing machine broker. The token's subject and workspace come from Convex; its audience is the configured PowerSync origin and its lifetime is at most five minutes. API keys, local actors, client identity claims, endpoint overrides and cross-origin calls cannot mint credentials. Responses disable caching. The process caps credential requests at 20 per actor/workspace per minute; a production edge limiter should additionally enforce aggregate limits across replicas.

The PowerSync server can use the same public `/api/auth/jwks` endpoint in either auth mode. In Clerk mode this remains a machine-token signer; Clerk retains all human authentication. Preserve the existing persistent auth database and its encryption secret so key rotation and published JWKS remain consistent across restarts. Keep the API at one replica while its Better Auth database is SQLite. Microsoft stays tenant-restricted and account linking stays disabled.

Deployment configuration is in [deploy/powersync](../deploy/powersync). The service is pinned to the qualified 1.26.1 image digest, uses an allowlisted single projection stream, and explicitly verifies PostgreSQL TLS. Neither the Compose service nor Kubernetes service publishes plaintext sync publicly. The operator supplies an HTTPS reverse proxy/Ingress with WebSocket support and a certificate trusted by browsers, Convex and the PowerSync service. Do not mount the local pilot signer or use its JWKS endpoint.

Required settings are delivered through the deployment's secret manager:

| Setting | Destination | Requirement |
| --- | --- | --- |
| `AUTH_MODE` | existing API and Convex auth configuration | Preserve `clerk` or `better-auth`; offline mode cannot use `none`. |
| `BETTER_AUTH_SECRET`, `AUTH_DB_PATH` | existing API | Preserve production secret and persistent database; a strong secret is needed for the machine signer even with Clerk. |
| `BETTER_AUTH_BASE_URL` | existing API/Convex/frontend | Existing public HTTPS app origin; must match the frontend request Origin. |
| `SOCIETYER_POWERSYNC_ENABLED=1` | API | Registers the credential broker; absent/0 leaves it disabled. |
| `PS_PUBLIC_ORIGIN` | API and PowerSync | Identical public HTTPS origin; no paths/query/credentials. |
| `PS_JWKS_URL` | PowerSync | Existing public app origin plus `/api/auth/jwks`. |
| `PS_CONVEX_DEPLOYMENT_URL` | PowerSync | Root Convex deployment HTTPS endpoint, not the disposable experiment backend. |
| `PS_CONVEX_DEPLOY_KEY` | PowerSync only | Dedicated deployment export credential with the minimum available export access. Never a frontend variable. |
| `PS_STORAGE_URI` | PowerSync only | External PostgreSQL storage URI; the supplied service enforces `sslmode: verify-full`. |
| `OFFLINE_MEETING_PREPARATION_ENABLED=1` | Convex **function deployment environment** | Enables native offline exports and authorization projection maintenance. Container environment alone does not set Convex function environment. |
| `VITE_POWERSYNC_MEETING_PREPARATION=1` | frontend build | Enables the authenticated route; rebuild the frontend. |

Set matching backend feature configuration and deploy the reconciled root Convex functions before enabling the API/frontend flags. Existing role/module/Owner protections apply. Enabling a client flag alone grants no access.

Validate the assembled environment without displaying secret values:

```sh
node --env-file=/secure/path/production.env --import tsx scripts/check-powersync-production-config.ts
```

The validator is read-only. A successful configuration check does not prove TLS reachability, export permissions or storage connectivity. Before promotion, run the native authorization/replication suite against the intended non-production deployment, then run two authenticated clients through online replication, offline draft/reload, reconnect/upload, membership/document revocation, expiry, failed command recovery and Viewer read-only behavior. Verify PowerSync readiness and root native storage. Retain sanitized results; do not publish tokens, database URIs, traces containing credentials or deploy keys.

For Compose, the HTTPS reverse proxy must run on the same host as `deploy/powersync/compose.yaml`, because the sync port binds to loopback. Supply runtime secrets and run the provided service file. For Kubernetes, create `societyer-powersync-secret` with the five `PS_*` settings and `societyer-powersync-config` from the two config files, then use the optional deployment/service. Apply `api-patch.yaml` as a strategic merge patch through the deployment's existing Kustomize overlay. The patch reads the **existing** auth mode/issuer from `societyer-app-secret`; populate those entries before applying. Build and promote new API/frontend image digests rather than using the old checked-in Kubernetes digests. Supply the HTTPS ingress in the existing cluster's gateway setup.

Rollback hides the frontend route and disables the API credential broker, then pauses the sync service. Keep the native backend authorization gate and projection invalidation enabled until issued credentials have expired and access is closed. Do not delete projection invalidation first while leaving a sync connection alive. Existing offline clients cannot receive a revocation while unreachable; authored recovery work can remain local while mirrored data is purged after authority is known to be lost. This rollout does not add other offline modules or a packaged Electron release.

No production secrets, database, public deployment or ingress are provisioned by these source changes. The final operator-owned inputs are the real public PowerSync origin/TLS routing, root export credential and verified-TLS PostgreSQL storage. Those credentials belong in the environment's secret manager, not chat or the repository.
