#!/usr/bin/env bash
set -euo pipefail

if [ "${PR_CRITICAL_ROUTES:-false}" = true ]; then
  export ENTITY_SWEEP_ROUTES='/app,/app/documents,/app/tasks,/app/meetings,/app/calendar'
else
  # Empty strings select an empty route array in Playwright; full means absent.
  unset ENTITY_SWEEP_ROUTES
fi

exec npm run test:entity-sweep
