#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: ALLOW_DESTRUCTIVE_RESTORE=yes $0 <runtime-backup.tar.gz> [namespace]" >&2
  exit 2
fi
if [ "${ALLOW_DESTRUCTIVE_RESTORE:-}" != "yes" ]; then
  echo "Restore replaces both target PVCs. Set ALLOW_DESTRUCTIVE_RESTORE=yes after verifying the target." >&2
  exit 2
fi

ARCHIVE="$1"
NAMESPACE="${2:-societyer}"
CONVEX_DEPLOYMENT="${K8S_CONVEX_DEPLOYMENT:-societyer-convex}"
API_DEPLOYMENT="${K8S_API_DEPLOYMENT:-societyer-api}"
CONVEX_PVC="${K8S_CONVEX_PVC:-societyer-convex-data-local}"
API_PVC="${K8S_API_PVC:-societyer-api-data-local}"
ROOT="$(mktemp -d)"
RESTORE_POD="societyer-runtime-restore"
PHASE=preflight
REPLICAS_RESTORED=false

if [ ! -f "$ARCHIVE" ]; then
  echo "Backup archive not found: $ARCHIVE" >&2
  exit 1
fi

if [ -f "$ARCHIVE.sha256" ]; then
  expected="$(awk 'NR == 1 { print $1 }' "$ARCHIVE.sha256")"
  actual="$(shasum -a 256 "$ARCHIVE" | awk '{ print $1 }')"
  if [ "$actual" != "$expected" ]; then
    echo "Backup checksum does not match $ARCHIVE.sha256." >&2
    exit 1
  fi
fi
tar -tzf "$ARCHIVE" >/dev/null
tar -xzf "$ARCHIVE" -C "$ROOT"
BACKUP_DIR="$(find "$ROOT" -maxdepth 1 -type d -name 'societyer-runtime-*' -print -quit)"
if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR/convex-data" ] || [ ! -d "$BACKUP_DIR/api-data" ]; then
  echo "Backup archive must contain one societyer-runtime-* directory with convex-data and api-data." >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1 && [ -s "$BACKUP_DIR/convex-data/db.sqlite3" ]; then
  integrity="$(sqlite3 "$BACKUP_DIR/convex-data/db.sqlite3" 'PRAGMA integrity_check;')"
  if [ "$integrity" != "ok" ]; then
    echo "Convex SQLite integrity check failed: $integrity" >&2
    exit 1
  fi
fi

for pvc in "$CONVEX_PVC" "$API_PVC"; do
  kubectl -n "$NAMESPACE" get pvc "$pvc" >/dev/null
done

CONVEX_REPLICAS="$(kubectl -n "$NAMESPACE" get deployment "$CONVEX_DEPLOYMENT" -o jsonpath='{.spec.replicas}')"
API_REPLICAS="$(kubectl -n "$NAMESPACE" get deployment "$API_DEPLOYMENT" -o jsonpath='{.spec.replicas}')"

restore_replicas() {
  if [ "$REPLICAS_RESTORED" = true ]; then
    return
  fi
  kubectl -n "$NAMESPACE" scale deployment "$CONVEX_DEPLOYMENT" --replicas="$CONVEX_REPLICAS"
  kubectl -n "$NAMESPACE" scale deployment "$API_DEPLOYMENT" --replicas="$API_REPLICAS"
  REPLICAS_RESTORED=true
}

cleanup() {
  status=$?
  kubectl -n "$NAMESPACE" delete pod "$RESTORE_POD" --ignore-not-found=true --wait=false >/dev/null 2>&1 || true
  rm -rf "$ROOT"
  if [ "$status" -ne 0 ]; then
    if [ "$PHASE" = preflight ] || [ "$PHASE" = stopped ]; then
      restore_replicas || true
      echo "[restore] failed before target data changed; original replica counts were restored" >&2
    elif [ "$REPLICAS_RESTORED" != true ]; then
      echo "[restore] failed after target data changed; deployments remain stopped for inspection" >&2
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

echo "[restore] stopping writers"
kubectl -n "$NAMESPACE" scale deployment "$API_DEPLOYMENT" --replicas=0
kubectl -n "$NAMESPACE" scale deployment "$CONVEX_DEPLOYMENT" --replicas=0
PHASE=stopped

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

kubectl -n "$NAMESPACE" delete pod "$RESTORE_POD" --ignore-not-found=true --wait=true >/dev/null
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
        claimName: $CONVEX_PVC
    - name: api-data
      persistentVolumeClaim:
        claimName: $API_PVC
YAML

kubectl -n "$NAMESPACE" wait pod "$RESTORE_POD" --for=condition=Ready --timeout=120s
PHASE=write_started
echo "[restore] replacing target PVC contents"
kubectl -n "$NAMESPACE" exec "$RESTORE_POD" -- sh -c \
  'find /restore/convex-data /restore/api-data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
(cd "$BACKUP_DIR" && tar -cf - convex-data api-data) | \
  kubectl -n "$NAMESPACE" exec -i "$RESTORE_POD" -- tar -C /restore -xf -

kubectl -n "$NAMESPACE" delete pod "$RESTORE_POD" --wait=true
echo "[restore] restoring original replica counts"
restore_replicas
PHASE=complete

if [ "$CONVEX_REPLICAS" -gt 0 ]; then
  kubectl -n "$NAMESPACE" rollout status deployment/"$CONVEX_DEPLOYMENT" --timeout=180s
fi
if [ "$API_REPLICAS" -gt 0 ]; then
  kubectl -n "$NAMESPACE" rollout status deployment/"$API_DEPLOYMENT" --timeout=180s
fi

echo "[restore] complete"
