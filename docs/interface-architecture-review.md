# Interface architecture review

Reviewed against the current working tree on 2026-10-04. This is a source audit
and a test inventory, not a production latency benchmark or verification of live
Clerk, Microsoft, registry, storage or connector accounts.

## Recommendation

Keep React Router and the Convex-compatible reactive client for the current
interface. TanStack Router or Query would not fix the concrete routing, cache
privacy and polling problems identified here merely by adding the dependencies.
Address those boundaries directly and validate the entire route matrix first.
Consider TanStack Query for a growing, shared HTTP read layer; consider TanStack
Router when typed route/search contracts justify a coordinated routing migration.
Neither is currently installed in `package.json`.

## Route inventory and deployment boundaries

The AST gate `scripts/check-interface-route-coverage.ts` reads all JSX `Route`
declarations in `src/main.tsx`, including multiline elements and nested relative
paths. The current tree contains 137 path-bearing declarations, two index routes
and one provider-only route: 140 Route elements and 136 unique resolved patterns.
The two conditional root branches and the `/app` index explain the repeated
patterns. There are 26 dynamic patterns and 39 module-gated paths across 21 module
keys. The explicit fixture manifest is `tests/helpers/interfaceRoutes.ts`.

Browser deployments use `BrowserRouter`, with the Vite `BASE_URL` basename;
`/demo` uses `/demo`. Electron uses `HashRouter` and file-relative build assets.
`/setup` sits outside data providers because it chooses the runtime. Public,
invitation and token-portal routes use data providers but have separate access
boundaries; `/portal` requires authentication. `/app` uses SetupGate and AuthGate.
Optional module routes use ModuleGate. These UI guards do not replace action
permissions, document ACLs or legal eligibility checks at backend boundaries.

Page components use `React.lazy` and a shared Suspense loading state. The data
client also loads asynchronously after runtime selection. Vite separates React,
router, Convex and icon vendor chunks. These mechanisms already provide route
code splitting; no measured startup gain from switching routers is asserted.

The matrix exercises desktop, tablet, phone and narrow-phone widths. A dynamic
route with `missing-record` or `invalid-token` coverage verifies its unavailable
state, not a successful record workflow. A passing `/demo/login` or public page
also does not verify a hosted authentication deployment. The manifest lists that
scope per route; the full literal inventory appears below.

## Navigation findings

Internal navigation should use React Router Link/useNavigate so basename and hash
routing remain consistent. The audit found raw SignaturePanel links to
`/directors` and `/members`, an unprefixed CustomFieldsPanel link, and a raw meeting
preview window.open URL. Raw public-share URL construction also assumed a web
origin, which becomes `null` under file URLs.

The shared `src/lib/appRouteHref.ts` helpers now distinguish these cases:
`appRouteHref(routerPath)` supplies an href for a new window and
`appRouteAbsoluteHref(routerPath)` supplies an absolute URL for copying. They
preserve `/demo`, a custom browser basename and Electron's current document plus
hash route. File URLs remain local previews and cannot establish a publicly hosted
page. `scripts/check-app-route-hrefs.ts` checks those boundaries and rejects
nonlocal route inputs. Meeting preview and transparency sharing now use these helpers; SignaturePanel
and CustomFieldsPanel use router-aware links.

React Router handles back/forward and declarative redirects. Migrating to a new
router would need to preserve the conditional root, setup-before-provider order,
invitation redirects, public tokens, module gates, desktop hashes and custom
basenames. Typed route parameters and validated search parameters are plausible
TanStack Router benefits, but a migration should be its own change with this
matrix as a baseline. Replacing raw anchors and checking route drift address the
observed failures without that migration.

## Server state, authorization and persistence

Hosted domain records use `convex/react` queries and mutations. Convex is already
the subscription and server-state cache owner. Local/browser/Electron runtimes
implement that same protocol through StaticConvexClient and PortableQueryCache,
with real portable handlers running against the local row store. Local database
binding separates real workspaces from the seeded demo, and hydration completes
before portable authority is resolved. Snapshot export/import is a separate
persisted-data boundary rather than a query-cache feature.

PortableQueryCache keeps results by query arguments, shares watched results,
reruns active queries after store changes and discards stale asynchronous results
using execution tokens. Principal changes clear old results before replay.
Unauthorized query errors clear results and do not substitute fixture data.
Non-paginated results can survive an unsubscribe for warm reuse, while active
watch specifications are removed. Paginated cache values are removed when their
last subscriber detaches.

The audit found duplicate paginated invalidation: both the client-wide store
listener and every paginated subscriber replayed loaded pages. The per-subscriber
store listener was removed. `scripts/check-portable-query-cache.ts` checks one
refresh per loaded page per active key, multiple subscribers, loadMore,
unsubscribe, immediate principal clearing and late-result cancellation. The
actual portable live-runtime and principal-conformance checks also pass.

A second metadata cache in useHydratedView persisted full table setups in
localStorage by society/object/view, then painted them before current query
authorization. Those setups contain personal saved-view names, filters and search
terms. Actor-specific keys alone would not establish a current view ACL. The
redundant persisted fallback was removed; the hook now accepts only the current
Convex/portable result and purges the legacy namespace. A changed actor no longer
inherits a prior actor's selected view pin. RecordTableScope also scopes its
store, saved draft, cells, selection and side-panel record by actor and object;
newly scoped stores hydrate only from the current authorized snapshot.

The fresh metadata backend additionally needed creator-only personal-view access;
workspace membership by itself did not restrict personal view configuration.
The view/read/field-write handlers now enforce those guards. Shared and system
views retain their membership boundary. Browser regression coverage in
`tests/interface-metadata-cache.spec.ts` uses an actual personal view and actor
switch, an injected legacy setup, and a deliberately pending current metadata
query to check that the old view does not paint.

Scoped metadata queries now derive their read permission from the owned persisted
object's `namePlural`, using the same resource groups as domain actions and an
explicit trusted alias list for built-in table names that differ from function
domains (for example, `outboxMessages` and `workflowRuns`). Unknown names retain
the settings fallback. A Member can load members, meetings and tasks table
layouts without gaining settings access. The catalog, unknown objects and all metadata writes retain their settings
policy; financial objects retain their financial read permission. Native tests in
`scripts/check-record-metadata-permissions.ts` check those boundaries, foreign
references and personal saved-view denial. `usePersistView` checks current actor,
store and settings write permission before every save mutation and before marking
local state saved, so stale callbacks cannot continue a save after an actor change.
Sorting and filtering remain available as local interactions for read-only actors.

Sensitive historical selectors now use the requested register's permission:
director/officer histories require director read access, controller histories and
the significant-individual endpoint require settings read access, and unknown
historical role types are rejected. Mixed org-chart assignments require settings
read/write access. The live legal role register and rights ledger withhold full
controller rows when current settings read access is denied; ordinary role rows
remain readable. Controller revision timelines require that same permission, and
as-of edit-history snapshots exclude controller rows for a restricted actor.
`scripts/check-sensitive-history-permissions.ts` verifies Member denials and
controller DOB withholding, Owner/Viewer positive reads, known ordinary roles,
unknown-role rejection and foreign workspace denial. These checks cover the
identified register endpoints; they do not assert a new global document-redaction
policy.

Remaining performance considerations are evidence from control flow, not timings:
store changes still replay every active local query, paginated refreshes replay
all loaded pages, comparisons serialize complete results, and retained
non-paginated cache entries have no size-based eviction. Measure query counts,
rows and memory under a representative large workspace before replacing these
with dependency-aware invalidation, bounded eviction or server pagination. A
second TanStack cache around Convex queries would add another invalidation and
principal-lifecycle contract without removing these responsibilities.

## HTTP reads, uploads and streaming

BrowserConnectors has an HTTP polling surface outside Convex. The original
five-second interval could overlap the ten-second API timeout and let a late
former-workspace response replace current state. Its refresh lifecycle now aborts
superseded requests, tracks the current workspace/request, and accepts results
only from that current request. This fixes the observed boundary directly without
adding a second data cache.

The shared authenticatedFetch obtains the current broker token for HTTP paths.
Document upload/download and presigned URL flows, maintenance mutations and AI
SSE streams have different retry and lifetime requirements from cacheable GETs.
An upload or registry handoff must not be retried merely because a query library
has automatic retry defaults. Signed URLs, confidential exports, token-bearing
responses and streaming buffers should not be persisted in a generic query
cache. Gateway reads introduced in future should include actor/workspace in their
keys and discard prior-session data on logout or privilege changes.

A TanStack Query pilot is justified if several components need the same HTTP
resource, background freshness, cancellation, deduplication and explicit error
states. Restrict a pilot to those gateway reads; leave Convex subscriptions,
local database persistence and protected file issuance with their current owners.
No dependency migration is justified by a single overlapping polling effect.

## Record-engine modes and validation scope

The actual RecordTable renders table, kanban and calendar modes. `board` is a
legacy alias for the kanban renderer. Table rows virtualize above 40 filtered
rows; filtering and sorting still process the in-memory dataset. Kanban grouping
uses a select, multi-select, boolean or relation field, with an editable drag move
when the field/action allow it. Calendar selects a date/date-time field and
renders CalendarView's month grid.

The View schema declares calendar layouts `month`, `week` and `list`, but the
current store, persistence hook and CalendarView do not implement week/list
rendering. There is no visible week/list selector to audit as working behavior.
The side-panel Timeline tab and separate `/app/timeline` route are not additional
record-engine view modes. Coverage must test table, kanban/board and month
calendar interactions, shared/personal view saving, keyboard editing, filters,
columns, drawer/page opening and mobile containment; route rendering alone does
not prove those interactions.

## Verification commands and limits

- `npx tsx scripts/check-interface-route-coverage.ts` checks route-manifest drift
  and that fixture URLs actually match the declared route patterns.
- `npx tsx scripts/check-app-route-hrefs.ts` checks root/demo/custom-base/hash hrefs.
- `npx tsx scripts/check-portable-query-cache.ts` checks refresh counts and cached
  authorization boundaries with controlled asynchronous execution.
- `npm run test:portable-live-runtime` and
  `npx tsx scripts/check-portable-principal.ts` exercise actual portable handlers,
  actor binding, reactive updates and denied-result clearing.
- `npx playwright test -c playwright.interface.config.ts` runs the route/layout
  matrix and targeted interface regressions. Its result report is the authority
  for passed/failed/browser-specific coverage, not this source inventory.

No network latency, first-paint time, frame-rate, production bundle improvement
or live provider acceptance is claimed by this review.

## Complete route fixture inventory

Patterns resolve relative application paths under `/app`; browser test paths
explicitly include `/demo` where the seeded runtime is required.

| Route pattern | Coverage kind | Fixture |
| --- | --- | --- |
| `/` | public | route |
| `/setup` | public | route |
| `/login` | public | route |
| `/invite/:token` | public | invalid-token |
| `/public` | public | route |
| `/public/:slug` | public | seeded |
| `/portal/:token` | public | invalid-token |
| `/public/:slug/volunteer-apply` | public | seeded |
| `/public/:slug/grant-apply` | public | seeded |
| `/portal` | public | route |
| `/app/society/new` | app | route |
| `/app` | app | route |
| `/app/setup` | app | route |
| `/app/society` | app | route |
| `/app/organization-details` | app | route |
| `/app/role-holders` | app | route |
| `/app/point-in-time-register` | app | route |
| `/app/significant-individuals` | app | route |
| `/app/people-directory` | app | route |
| `/app/dividends` | app | route |
| `/app/service-providers` | app | route |
| `/app/compliance-settings` | app | route |
| `/app/corporate-history` | app | route |
| `/app/annual-filings` | app | route |
| `/app/certificate-register` | app | route |
| `/app/portfolio` | app | route |
| `/app/rights-ledger` | app | route |
| `/app/template-engine` | app | route |
| `/app/formation-maintenance` | app | route |
| `/app/org-history` | app | route |
| `/app/org-history/budgets/:budgetId` | app | missing-record |
| `/app/governance-registers` | app | route |
| `/app/meeting-evidence` | app | route |
| `/app/finance-imports` | app | route |
| `/app/records-archive` | app | route |
| `/app/imports` | app | route |
| `/app/members` | app | route |
| `/app/members/:id` | app | seeded |
| `/app/directors` | app | route |
| `/app/org-chart` | app | route |
| `/app/meetings` | app | route |
| `/app/meeting-templates` | app | route |
| `/app/meeting-templates/new` | app | route |
| `/app/meeting-templates/:templateId` | app | seeded |
| `/app/meetings/:id` | app | seeded |
| `/app/meetings/:id/preview` | app | seeded |
| `/app/minutes` | app | route |
| `/app/filings` | app | route |
| `/app/compliance-obligations` | app | route |
| `/app/research-library` | app | route |
| `/app/deadlines` | app | route |
| `/app/annual-cycle` | app | route |
| `/app/documents` | app | route |
| `/app/documents/:id` | app | seeded |
| `/app/document-catalog` | app | route |
| `/app/post-incorporation` | app | route |
| `/app/library` | app | route |
| `/app/minute-book` | app | route |
| `/app/conflicts` | app | route |
| `/app/financials` | app | route |
| `/app/financials/accounting` | app | route |
| `/app/financials/year-end` | app | route |
| `/app/financials/fy/:fiscalYear` | app | seeded |
| `/app/financials/wave/account/:resourceId` | app | seeded |
| `/app/financials/wave/:resourceType/:resourceId` | app | seeded |
| `/app/financials/wave/:resourceType` | app | seeded |
| `/app/grants` | app | route |
| `/app/grants/sources` | app | route |
| `/app/grants/sources/:libraryKey` | app | seeded |
| `/app/grants/:id` | app | seeded |
| `/app/grants/:id/edit` | app | seeded |
| `/app/privacy` | app | route |
| `/app/policies` | app | route |
| `/app/communications` | app | route |
| `/app/committees` | app | route |
| `/app/committees/:id` | app | seeded |
| `/app/volunteers` | app | route |
| `/app/goals` | app | route |
| `/app/goals/:id` | app | seeded |
| `/app/tasks` | app | route |
| `/app/commitments` | app | route |
| `/app/timeline` | app | route |
| `/app/notifications` | app | route |
| `/app/users` | app | route |
| `/app/audit` | app | route |
| `/app/exports` | app | route |
| `/app/agendas` | app | route |
| `/app/motions` | app | route |
| `/app/motion-backlog` | app | route → /demo/app/motions?tab=tabled |
| `/app/motion-library` | app | route → /demo/app/motions?tab=templates |
| `/app/treasurer` | app | route |
| `/app/assets` | app | route |
| `/app/inventory` | app | route |
| `/app/assets/verification/:runId` | app | missing-record |
| `/app/assets/:id` | app | seeded |
| `/app/membership` | app | route |
| `/app/inspections` | app | route |
| `/app/attestations` | app | route |
| `/app/retention` | app | route |
| `/app/insurance` | app | route |
| `/app/insurance/:id` | app | seeded |
| `/app/access-custody` | app | route |
| `/app/secrets` | app | route → /demo/app/access-custody |
| `/app/pipa-training` | app | route |
| `/app/proxies` | app | route |
| `/app/auditors` | app | route |
| `/app/proposals` | app | route |
| `/app/receipts` | app | route |
| `/app/employees` | app | route |
| `/app/court-orders` | app | route |
| `/app/written-resolutions` | app | route |
| `/app/meetings/:id/agm` | app | seeded |
| `/app/filings/prefill` | app | route |
| `/app/bylaw-diff` | app | route |
| `/app/bylaw-rules` | app | route |
| `/app/bylaws-history` | app | route |
| `/app/elections` | app | route |
| `/app/elections/:id` | app | seeded |
| `/app/reconciliation` | app | route |
| `/app/transparency` | app | route |
| `/app/paperless` | app | route |
| `/app/browser-connectors` | app | route |
| `/app/integrations` | app | route |
| `/app/ai-agents` | app | route |
| `/app/workflows` | app | route |
| `/app/workflows/:id` | app | seeded |
| `/app/workflow-runs` | app | route |
| `/app/workflow-packages` | app | route |
| `/app/calendar-sync` | app | route |
| `/app/outbox` | app | route |
| `/app/custom-fields` | app | route |
| `/app/table-field-lab` | app | route |
| `/app/settings` | app | route |
| `/app/settings/api-keys` | app | route |
| `/app/webhooks` | app | route |
| `*` | fallback | route → /demo |
