#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-"$ROOT_DIR/tmp/runtime-backups"}"
NAMESPACE="${K8S_NAMESPACE:-societyer}"
CONVEX_DEPLOYMENT="${K8S_CONVEX_DEPLOYMENT:-societyer-convex}"
API_DEPLOYMENT="${K8S_API_DEPLOYMENT:-societyer-api}"
CONVEX_PVC="${K8S_CONVEX_PVC:-societyer-convex-data-local}"
API_PVC="${K8S_API_PVC:-societyer-api-data-local}"
BACKUP_POD="societyer-runtime-backup"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
WORK_DIR="$OUT_DIR/societyer-runtime-$STAMP"
ARCHIVE="$WORK_DIR.tar.gz"
RESTORED_REPLICAS=false

replicas_for() {
  kubectl -n "$NAMESPACE" get deployment "$1" -o jsonpath='{.spec.replicas}'
}

CONVEX_REPLICAS="$(replicas_for "$CONVEX_DEPLOYMENT")"
API_REPLICAS="$(replicas_for "$API_DEPLOYMENT")"

restore_replicas() {
  if [ "$RESTORED_REPLICAS" = true ]; then
    return
  fi
  echo "[backup] restoring deployment replica counts"
  kubectl -n "$NAMESPACE" scale deployment "$CONVEX_DEPLOYMENT" --replicas="$CONVEX_REPLICAS"
  kubectl -n "$NAMESPACE" scale deployment "$API_DEPLOYMENT" --replicas="$API_REPLICAS"
  RESTORED_REPLICAS=true
}

cleanup() {
  status=$?
  kubectl -n "$NAMESPACE" delete pod "$BACKUP_POD" --ignore-not-found=true --wait=false >/dev/null 2>&1 || true
  restore_replicas || true
  if [ "$status" -ne 0 ]; then
    echo "[backup] failed; original replica counts were restored" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

for pvc in "$CONVEX_PVC" "$API_PVC"; do
  kubectl -n "$NAMESPACE" get pvc "$pvc" >/dev/null
done

mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

echo "[backup] stopping writers for a consistent runtime snapshot"
kubectl -n "$NAMESPACE" scale deployment "$API_DEPLOYMENT" --replicas=0
kubectl -n "$NAMESPACE" scale deployment "$CONVEX_DEPLOYMENT" --replicas=0

for app in "$API_DEPLOYMENT" "$CONVEX_DEPLOYMENT"; do
  for _ in $(seq 1 60); do
    if [ -z "$(kubectl -n "$NAMESPACE" get pods -l "app=$app" -o name)" ]; then
      break
    fi
    sleep 2
  done
  if [ -n "$(kubectl -n "$NAMESPACE" get pods -l "app=$app" -o name)" ]; then
    echo "Timed out waiting for $app pods to stop." >&2
    exit 1
  fi
done

kubectl -n "$NAMESPACE" delete pod "$BACKUP_POD" --ignore-not-found=true --wait=true >/dev/null
cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $BACKUP_POD
  namespace: $NAMESPACE
spec:
  restartPolicy: Never
  containers:
    - name: backup
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: convex-data
          mountPath: /source/convex-data
          readOnly: true
        - name: api-data
          mountPath: /source/api-data
          readOnly: true
  volumes:
    - name: convex-data
      persistentVolumeClaim:
        claimName: $CONVEX_PVC
        readOnly: true
    - name: api-data
      persistentVolumeClaim:
        claimName: $API_PVC
        readOnly: true
YAML

kubectl -n "$NAMESPACE" wait pod "$BACKUP_POD" --for=condition=Ready --timeout=120s
echo "[backup] streaming PVC contents"
kubectl -n "$NAMESPACE" exec "$BACKUP_POD" -- tar -C /source -cf - convex-data api-data | tar -C "$WORK_DIR" -xf -

CONTEXT="$(kubectl config current-context 2>/dev/null || echo unknown)"
cat > "$WORK_DIR/manifest.json" <<JSON
{
  "kind": "societyer.runtimeBackup",
  "createdAtUTC": "$STAMP",
  "source": "kubernetes",
  "kubernetesContext": "$CONTEXT",
  "namespace": "$NAMESPACE",
  "convexPvc": "$CONVEX_PVC",
  "apiPvc": "$API_PVC",
  "contents": {
    "convexData": "convex-data/",
    "apiData": "api-data/"
  }
}
JSON

tar -C "$OUT_DIR" -czf "$ARCHIVE" "$(basename "$WORK_DIR")"
chmod 600 "$ARCHIVE"
shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256"
chmod 600 "$ARCHIVE.sha256"

restore_replicas
if [ "$CONVEX_REPLICAS" -gt 0 ]; then
  kubectl -n "$NAMESPACE" rollout status deployment/"$CONVEX_DEPLOYMENT" --timeout=180s
fi
if [ "$API_REPLICAS" -gt 0 ]; then
  kubectl -n "$NAMESPACE" rollout status deployment/"$API_DEPLOYMENT" --timeout=180s
fi

du -sh "$ARCHIVE"
echo "$ARCHIVE"
