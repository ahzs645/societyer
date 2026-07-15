# Kubernetes deployment and upgrade runbook

This directory is the portable Kubernetes base for Societyer. It runs the
self-hosted Convex backend, API/auth server, static frontend, nginx gateway,
and Traefik ingress.

## Storage and image rules

- Convex uses SQLite in this deployment. Its PVC must use `local-path` (or a
  database/storage backend with reliable file locking), not NFS. NFS advisory
  locking caused the previous production crash loop.
- API runtime data also uses `local-path`. The old NFS PVCs are rollback copies
  and must not be deleted until the upgrade has been accepted.
- Every workload manifest uses a registry digest. Never promote `:latest` or
  `:main`; resolve the tested `sha-<git-sha>` image to its registry digest first.
- Dynamic `local-path` volumes default to the storage class reclaim policy.
  Patch each bound production PV to `Retain` and verify it:

```sh
pv="$(kubectl -n societyer get pvc societyer-convex-data-local -o jsonpath='{.spec.volumeName}')"
kubectl patch pv "$pv" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl get pv "$pv"
```

Node-local storage trades NFS locking failures for node affinity. Backups are
therefore mandatory. For a multi-node production installation, move Convex to
a supported PostgreSQL/MySQL deployment rather than putting its SQLite file on
shared NFS.

## Bootstrap

Create the namespace and application secret first. Do not commit the populated
environment file.

```sh
kubectl create namespace societyer --dry-run=client -o yaml | kubectl apply -f -
kubectl -n societyer create secret generic societyer-app-secret \
  --from-env-file=deploy/kubernetes/secret.example.env
kubectl apply -k deploy/kubernetes
```

For an exact restore, retain the original `CONVEX_INSTANCE_SECRET` and vault
encryption key. The Convex admin key is deliberately not injected into the API;
the deployment script stores it in the separate `societyer-convex-admin`
Secret.

After dynamic PVCs bind, patch their PV reclaim policies to `Retain` before
copying production data into them.

## Back up and restore

Create a consistent Kubernetes backup with both writers stopped briefly:

```sh
KUBECONFIG=/path/to/kubeconfig npm run backup:runtime:k8s
```

The script records the original replica counts, stops API and Convex, mounts
both PVCs read-only, streams their complete contents, writes a manifest and
SHA-256 file, then restores the replica counts and waits for readiness. The
archive includes the Convex instance secret and encrypted application data;
keep it private.

Restore only into verified target PVCs:

```sh
ALLOW_DESTRUCTIVE_RESTORE=yes \
KUBECONFIG=/path/to/kubeconfig \
./scripts/restore-runtime-data-to-k8s.sh \
  tmp/runtime-backups/<backup>.tar.gz societyer
```

The restore verifies the archive and, when `sqlite3` is available, runs
`PRAGMA integrity_check` before stopping workloads. If copying fails after the
target is cleared, deployments stay stopped so partial data is never started.
Override `K8S_CONVEX_PVC` and `K8S_API_PVC` only when intentionally targeting
different claims.

The raw runtime backup is the lossless migration path. It preserves Convex IDs,
file blobs, deployed modules, and encrypted fields. JSON workspace exports are
useful validation evidence, but are not a replacement for the raw runtime.

## Staging rehearsal

`staging-rehearsal.yaml` describes the isolated Convex clone currently exposed
on ports 3320/3321. It is not included by the production Kustomization. Its
egress-deny policy prevents production-derived data from triggering external
mail, connector, or webhook side effects.

Before every production promotion:

1. Populate `societyer-convex-staging-data` from a fresh offline production
   backup and change `credentials/instance_name` in the clone to
   `societyer-staging`.
2. Apply `deploy/kubernetes/staging-rehearsal.yaml` and patch its PV to
   `Retain`.
3. Deploy the candidate schema/functions to staging:

```sh
K8S_CONVEX_DEPLOYMENT=societyer-convex-staging \
K8S_CONVEX_ADMIN_SECRET=societyer-convex-staging-admin \
CONVEX_SELF_HOSTED_URL=http://societyer.k8s.home:3320 \
npm run convex:deploy:k8s
```

4. Validate every exportable table and run the frontend against the clone:

```sh
CONVEX_SELF_HOSTED_URL=http://societyer.k8s.home:3320 \
npm run export:workspace:files -- --society-name "Over the Edge"

VITE_CONVEX_URL=http://societyer.k8s.home:3320 \
VITE_AUTH_MODE=none npm run dev:k8s -- --port 5175 --strictPort
```

The staging clone contains real data. Do not expose it outside the trusted home
network, and delete it after the upgrade acceptance window.

## Build and promote a release

`.github/workflows/build-images.yml` now verifies the application and publishes
API, frontend, and connector images on `main`, `v*` tags, releases, and manual
runs. Each build gets an immutable `sha-<full-git-sha>` tag.

Promotion is intentionally explicit:

1. Record a fresh runtime backup and the currently running workload images.
2. Rehearse the Convex engine, schema/functions, export validation, and UI on the
   isolated clone.
3. Resolve the tested application tags to registry digests and replace the API
   and frontend digests in these manifests.
4. Review `kubectl diff -k deploy/kubernetes`.
5. Deploy production schema/functions explicitly:

```sh
ALLOW_PRODUCTION_CONVEX_DEPLOY=yes \
CONVEX_SELF_HOSTED_URL=http://societyer.k8s.home:3220 \
npm run convex:deploy:k8s
```

6. Apply the reviewed manifests and wait for each rollout:

```sh
kubectl apply -k deploy/kubernetes
kubectl -n societyer rollout status deployment/societyer-convex --timeout=180s
kubectl -n societyer rollout status deployment/societyer-api --timeout=180s
kubectl -n societyer rollout status deployment/societyer-frontend --timeout=180s
curl -fsS http://societyer.k8s.home:3220/version
```

7. Recheck the Over the Edge dashboard, Documents, Meetings, and a full export.
   Keep the prior image digests, old retained PVCs, and backup archive until
   acceptance is complete.

Schema deployment and application rollout are separate operations by design.
Restarting the API must never mutate the Convex schema.

## Rollback

- Application regression: replace API/frontend manifests with the recorded old
  digests and apply them.
- Convex engine regression before data changes: replace its digest with the old
  digest and roll out.
- Data/schema regression: stop API and Convex and restore the verified preflight
  archive to the retained target PVCs. Do not attempt to "downgrade" a mutated
  SQLite directory in place.
- Storage migration regression: scale workloads down and point the deployment
  back to the original retained NFS PVC only as a short-lived recovery step;
  the NFS locking fault remains present.

## GitOps ownership

The audited `personalprox` main branch did not contain Societyer Flux resources,
so this deployment is still manually owned. Copy the reviewed manifests or a
Kustomize reference into that repository and let Flux reconcile them before
claiming GitOps ownership. Do not run both an unmanaged `kubectl apply` process
and Flux against divergent definitions.

## Security boundary

The current home deployment uses `AUTH_MODE=none`, and parts of the application
still rely on client-asserted workspace identity. Treat it as trusted-network
software. Authentication and server-enforced tenant authorization are separate
prerequisites before any public or untrusted multi-tenant exposure.
