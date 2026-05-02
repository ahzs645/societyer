#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-societyer}"
DEPLOYMENT="${K8S_CONVEX_DEPLOYMENT:-societyer-convex}"
CONVEX_URL="${CONVEX_SELF_HOSTED_URL:-http://societyer.k8s.home:3220}"

if [ -z "${KUBECONFIG:-}" ] && [ -f "/Users/ahmadjalil/github/personalprox/kubeconfig.yml" ]; then
  export KUBECONFIG="/Users/ahmadjalil/github/personalprox/kubeconfig.yml"
fi

if ! kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" >/dev/null; then
  echo "Could not find deployment/$DEPLOYMENT in namespace $NAMESPACE." >&2
  echo "Set KUBECONFIG or K8S_NAMESPACE/K8S_CONVEX_DEPLOYMENT and retry." >&2
  exit 1
fi

ADMIN_KEY="$(kubectl -n "$NAMESPACE" exec "deployment/$DEPLOYMENT" -- /convex/generate_admin_key.sh | awk 'NF { last = $0 } END { print last }')"
if [ -z "$ADMIN_KEY" ]; then
  echo "Failed to generate a Convex admin key from deployment/$DEPLOYMENT." >&2
  exit 1
fi

CONVEX_SELF_HOSTED_URL="$CONVEX_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" npx convex dev --once
