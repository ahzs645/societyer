# Frontend loading and transfer budgets

The shared shell now loads task, asset, meeting and commitment forms only after
an authorized user opens them. The command palette and AI assistant preserve the
first opening event while their renderer downloads. Their existing keyboard,
focus and permission behavior remains in the original components. Public routes
load the workspace layout on demand, and Clerk/Better Auth adapters no longer
enter the React vendor chunk through an overly broad package-name matcher.

The local portable runtime loads its legacy compatibility dispatcher only after
an authorized fallback call. It retains the same portable handler registry,
principal binding and asynchronous authorized-query cache. Local snapshot,
workspace-binding, query-cache and static-parity checks pass.

## Measured transfer

`artifacts/offline/frontend-bundle-size.json` compares the existing `990b3ba`
baseline build with the optimized build. These are deduplicated transitive static
JavaScript and CSS imports, compressed separately per asset with gzip level 9.
Dashboard totals include the workspace layout, data client and selected auth
adapter. They do not claim browser timing, Lighthouse scores or whole-app
download reductions.

| Surface | Before gzip bytes | After gzip bytes | Reduction |
| --- | ---: | ---: | ---: |
| Bootstrap | 860,231 | 196,841 | 77.12% |
| Public landing | 866,243 | 203,130 | 76.55% |
| Better Auth dashboard | 914,123 | 314,054 | 65.64% |
| Clerk dashboard entry | 914,153 | 313,474 | 65.71% |
| Local dashboard | 1,277,559 | 655,351 | 48.70% |

The measurements exclude HTML, fonts, WASM, externally hosted provider scripts
and unopened feature chunks. No live Clerk publishable key was configured in
this measurement environment; the Clerk entry measurement is not a live Clerk
login qualification. PowerSync's worker and SQLite WASM assets are emitted by
the build and remain dependencies of the offline meeting feature, rather than
the dashboard startup path.

Heavy editors, barcode rendering, PDF tooling and the complete local handler
registry still have substantial feature-specific download costs. Deferring a
feature reduces its initial cost; it does not eliminate bytes when that feature
is later used. Lazy routes and forms must be loaded/cached before disconnected
use. The meeting-preparation readiness flow covers its own selected scope;
these changes do not promise every Societyer module is available offline.

## Regression checks

Vite emits `dist/.vite/manifest.json`. After building, run:

```sh
node scripts/check-frontend-bundle-budget.mjs
```

This fails when the complete scenario closure exceeds its gzip budget. To
record an exact comparison against another built directory:

```sh
node scripts/check-frontend-bundle-budget.mjs --baseline /path/to/baseline/dist --output /path/to/report.json
```

The built-preview `tests/interface-lazy-loading.spec.ts` suite passed **12/12**
cases at 320 and 1440 pixels. It checks cold opening and reopening of all four
global forms, first-use palette shortcuts/focus, and first-use AI events. The
cold dashboard does not request the Markdown editor chunk. Another **4/4**
built shared focus/meeting-layout checks passed. These use the actual local
portable/Dexie demo runtime; live authentication and production HTTPS checks
are separate qualification evidence.

The browser checks caught and resolved an intermediate Rollup scheduler
initialization cycle. The final configuration retains compatible dependency
grouping and explicit package boundaries, without the unsafe
`onlyExplicitManualChunks` experiment.
