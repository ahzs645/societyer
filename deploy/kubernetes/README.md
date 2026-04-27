# Kubernetes deployment

This directory is the portable Kubernetes base for Societyer. It runs:

- self-hosted Convex backend with persistent `/convex/data`
- Societyer API/auth server
- static frontend
- nginx gateway and Traefik ingress

## Deploy

Create the namespace and secret first:

```sh
kubectl create namespace societyer --dry-run=client -o yaml | kubectl apply -f -
kubectl -n societyer create secret generic societyer-app-secret --from-env-file=deploy/kubernetes/secret.example.env
```

Replace the example values before using this in production. For an exact restore
from a previous self-hosted Convex runtime, keep the same `CONVEX_INSTANCE_SECRET`
and the same vault encryption key.

Apply the manifests:

```sh
kubectl apply -k deploy/kubernetes
```

If restoring an existing runtime, create a runtime backup from the source system
and copy it into the target PVCs:

```sh
npm run backup:runtime
KUBECONFIG=/path/to/kubeconfig ./scripts/restore-runtime-data-to-k8s.sh tmp/runtime-backups/<backup>.tar.gz societyer
```

The runtime restore is the lossless migration path. It preserves Convex document
IDs, file storage blobs, deployed modules, and encrypted secret fields. The JSON
workspace export is useful for inspection and portability, but it is not a full
replacement for restoring the Convex runtime when exact references must survive.
