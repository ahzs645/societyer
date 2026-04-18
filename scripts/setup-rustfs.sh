#!/usr/bin/env bash
set -euo pipefail

ALIAS="${RUSTFS_MC_ALIAS:-societyer}"
ENDPOINT="${RUSTFS_ENDPOINT:-http://rustfs.societyer.orb.local:9000}"
BUCKET="${RUSTFS_BUCKET:-societyer}"
REGION="${RUSTFS_REGION:-us-east-1}"
ACCESS_KEY="${RUSTFS_ACCESS_KEY:-${RUSTFS_ROOT_USER:-societyer}}"
SECRET_KEY="${RUSTFS_SECRET_KEY:-${RUSTFS_ROOT_PASSWORD:-societyer-dev-secret}}"

if ! command -v mc >/dev/null 2>&1; then
  echo "error: MinIO client 'mc' is required. Install it with: brew install minio/stable/mc" >&2
  exit 1
fi

export MC_CONFIG_DIR="${MC_CONFIG_DIR:-${TMPDIR:-/tmp}/societyer-mc}"

mc alias set "${ALIAS}" "${ENDPOINT}" "${ACCESS_KEY}" "${SECRET_KEY}" >/dev/null
mc mb --ignore-existing "${ALIAS}/${BUCKET}" >/dev/null

if command -v npx >/dev/null 2>&1; then
  npx convex env set RUSTFS_ENDPOINT "${ENDPOINT}" >/dev/null
  npx convex env set RUSTFS_BUCKET "${BUCKET}" >/dev/null
  npx convex env set RUSTFS_REGION "${REGION}" >/dev/null
  npx convex env set RUSTFS_ACCESS_KEY "${ACCESS_KEY}" >/dev/null
  npx convex env set RUSTFS_SECRET_KEY "${SECRET_KEY}" >/dev/null
else
  echo "warning: npx not found; bucket was created, but Convex env was not updated." >&2
fi

echo "RustFS ready: ${ENDPOINT}/${BUCKET}"
