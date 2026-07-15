#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-societyer}"
DEPLOYMENT="${K8S_CONVEX_DEPLOYMENT:-societyer-convex}"
CONVEX_URL="${CONVEX_SELF_HOSTED_URL:-http://societyer.k8s.home:3220}"
ADMIN_SECRET="${K8S_CONVEX_ADMIN_SECRET:-societyer-convex-admin}"
ADMIN_SECRET_KEY="CONVEX_SELF_HOSTED_ADMIN_KEY"

if [ -z "${KUBECONFIG:-}" ] && [ -f "/Users/ahmadjalil/github/personalprox/kubeconfig.yml" ]; then
  export KUBECONFIG="/Users/ahmadjalil/github/personalprox/kubeconfig.yml"
fi

if ! kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" >/dev/null; then
  echo "Could not find deployment/$DEPLOYMENT in namespace $NAMESPACE." >&2
  echo "Set KUBECONFIG or K8S_NAMESPACE/K8S_CONVEX_DEPLOYMENT and retry." >&2
  exit 1
fi

if [ "$DEPLOYMENT" = "societyer-convex" ] && [ "${ALLOW_PRODUCTION_CONVEX_DEPLOY:-}" != "yes" ]; then
  echo "Production function/schema deployment requires ALLOW_PRODUCTION_CONVEX_DEPLOY=yes." >&2
  echo "Rehearse first with K8S_CONVEX_DEPLOYMENT=societyer-convex-staging and port 3320." >&2
  exit 2
fi

if [ -n "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]; then
  ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY"
elif kubectl -n "$NAMESPACE" get secret "$ADMIN_SECRET" >/dev/null 2>&1; then
  ADMIN_KEY="$(kubectl -n "$NAMESPACE" get secret "$ADMIN_SECRET" -o go-template="{{index .data \"$ADMIN_SECRET_KEY\" | base64decode}}")"
else
  echo "[convex] generating and storing an admin key in secret/$ADMIN_SECRET"
  ADMIN_KEY="$(kubectl -n "$NAMESPACE" exec "deployment/$DEPLOYMENT" -- /convex/generate_admin_key.sh | awk 'NF { last = $0 } END { print last }')"
  kubectl -n "$NAMESPACE" create secret generic "$ADMIN_SECRET" \
    --from-literal="$ADMIN_SECRET_KEY=$ADMIN_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

if [ -z "$ADMIN_KEY" ]; then
  echo "Could not obtain a Convex admin key." >&2
  exit 1
fi

echo "[convex] validating schema and export coverage"
npm run convex:typecheck
npm run test:exports

echo "[convex] deploying functions to $DEPLOYMENT at $CONVEX_URL"
CONVEX_SELF_HOSTED_URL="$CONVEX_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" npx convex dev --once
