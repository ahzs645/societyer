#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-"$ROOT_DIR/tmp/runtime-backups"}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
WORK_DIR="$OUT_DIR/societyer-runtime-$STAMP"
ARCHIVE="$WORK_DIR.tar.gz"

mkdir -p "$WORK_DIR/convex-data" "$WORK_DIR/api-data"

CONVEX_CONTAINER="${CONVEX_CONTAINER:-societyer-convex-backend}"
API_DATA_DIR="${API_DATA_DIR:-$ROOT_DIR/data/workflow-generated-documents}"

echo "[backup] copying Convex data from container: $CONVEX_CONTAINER"
docker cp "$CONVEX_CONTAINER:/convex/data/." "$WORK_DIR/convex-data/"

if [ -d "$API_DATA_DIR" ]; then
  echo "[backup] copying generated workflow documents from: $API_DATA_DIR"
  cp -a "$API_DATA_DIR/." "$WORK_DIR/api-data/"
else
  echo "[backup] generated workflow document directory not found; creating empty api-data"
fi

cat > "$WORK_DIR/manifest.json" <<JSON
{
  "kind": "societyer.runtimeBackup",
  "createdAtUTC": "$STAMP",
  "convexContainer": "$CONVEX_CONTAINER",
  "apiDataDirectory": "$API_DATA_DIR",
  "contents": {
    "convexData": "convex-data/",
    "apiData": "api-data/"
  }
}
JSON

tar -C "$OUT_DIR" -czf "$ARCHIVE" "$(basename "$WORK_DIR")"
du -sh "$ARCHIVE"
echo "$ARCHIVE"
