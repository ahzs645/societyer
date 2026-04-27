#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <runtime-backup.tar.gz> [namespace]" >&2
  exit 2
fi

ARCHIVE="$1"
NAMESPACE="${2:-societyer}"
ROOT="$(mktemp -d)"
RESTORE_POD="societyer-runtime-restore"

cleanup() {
  kubectl -n "$NAMESPACE" delete pod "$RESTORE_POD" --ignore-not-found=true >/dev/null 2>&1 || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

tar -xzf "$ARCHIVE" -C "$ROOT"
BACKUP_DIR="$(find "$ROOT" -maxdepth 1 -type d -name 'societyer-runtime-*' | head -1)"
if [ -z "$BACKUP_DIR" ]; then
  echo "Backup archive did not contain societyer-runtime-* directory." >&2
  exit 1
fi

echo "[restore] scaling Societyer deployments down"
if kubectl -n "$NAMESPACE" get deployment societyer-api >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" scale deployment societyer-api --replicas=0
fi
if kubectl -n "$NAMESPACE" get deployment societyer-convex >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" scale deployment societyer-convex --replicas=0
fi

cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $RESTORE_POD
  namespace: $NAMESPACE
spec:
  restartPolicy: Never
  containers:
    - name: restore
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: convex-data
          mountPath: /restore/convex-data
        - name: api-data
          mountPath: /restore/api-data
  volumes:
    - name: convex-data
      persistentVolumeClaim:
        claimName: societyer-convex-data
    - name: api-data
      persistentVolumeClaim:
        claimName: societyer-api-data
YAML

kubectl -n "$NAMESPACE" wait pod "$RESTORE_POD" --for=condition=Ready --timeout=120s

echo "[restore] clearing target PVC contents"
kubectl -n "$NAMESPACE" exec "$RESTORE_POD" -- sh -c 'rm -rf /restore/convex-data/* /restore/api-data/*'

echo "[restore] copying Convex data"
kubectl -n "$NAMESPACE" cp "$BACKUP_DIR/convex-data/." "$RESTORE_POD:/restore/convex-data"

echo "[restore] copying API generated documents"
kubectl -n "$NAMESPACE" cp "$BACKUP_DIR/api-data/." "$RESTORE_POD:/restore/api-data"

echo "[restore] scaling Societyer deployments up"
kubectl -n "$NAMESPACE" scale deployment societyer-convex --replicas=1
kubectl -n "$NAMESPACE" scale deployment societyer-api --replicas=1
kubectl -n "$NAMESPACE" rollout status deployment/societyer-convex --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/societyer-api --timeout=180s
