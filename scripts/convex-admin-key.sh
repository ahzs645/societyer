#!/usr/bin/env bash
# Generate (or print) the admin key for the local self-hosted Convex backend.
# Requires `docker compose up -d` to be running.
set -euo pipefail

CONTAINER="${CONTAINER:-societyer-convex-backend}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "error: ${CONTAINER} is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

# The backend image ships a helper binary to generate an admin key.
# If this path changes in a future image, consult the dashboard at
# http://localhost:6791 — it can also generate/display the key.
docker exec -i "${CONTAINER}" /convex/generate_admin_key.sh 2>/dev/null \
  || docker exec -i "${CONTAINER}" ./generate_admin_key.sh 2>/dev/null \
  || {
    echo "Could not auto-generate. Open the dashboard at http://localhost:6792 to create an admin key." >&2
    exit 1
  }
