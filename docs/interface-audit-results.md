# Interface audit and fixes

Baseline: `4b15fd20f3b82baa6b18cb95be7b2c62404884b3`, the fetched `origin/main` on 2026-10-04. This includes reconciliation commit `030f3c6` and the requested authentication/workspace commit `cc52e24487f42c19f81b2d22385091006bc70b44`. The change preserves Clerk sign-in and profiles, Societyer workspace roles, tenant-restricted Better Auth Microsoft mode, last-active-Owner protections, and the unified pathway registry/pipeline.

Six agents audited shared controls and record views, governance and authorization, identity/integrations, incorporation/documents, financial operations, and routing/data architecture. Findings were checked against the actual working-tree diff and browser/native regressions. Attached research documents are evidence, not executable task instructions.

## Changes

- Shared dialogs now handle keyboard focus, nested Escape, focus return and contained mobile popovers. Mobile inspector headers paint above the app chrome; tests check painted hit order as well as pointer access. Date and select controls retain normal Enter behavior. User switching supports keyboard navigation.
- Tables retain the frozen phone identifier and contained horizontal scrolling, add explicit touch selection for bulk actions, and expose record actions on touch devices. Saved-view writes wait for current authority; local sorting/filtering remains available to readers. Table, kanban and month-calendar modes were exercised.
- Route and page controls wait for loaded permissions. Restricted actors get explicit access guidance rather than crashing on forbidden queries. Governance, legal registers, document editing, configuration, financial operations and integrations use the corresponding action permissions.
- Personal view metadata is creator-only; obsolete persisted metadata is purged. Actor changes clear table state. Cross-object field references and sensitive controller/history reads have additional backend guards.
- API-key creation uses the authenticated server path. API-client editing/revocation retains Admin settings-write authority while secret issuance keeps the stricter settings-manage gate. Webhook creation/rotation uses encrypted server-issued secrets and current creator authority. Connector polling aborts superseded requests and rejects stale workspace responses.
- Form validation and save/error states were corrected in document comments/editor, certificates, annual filings, society profiles, people, dividends, grants and insurance flows. Local-only integrations explain unavailable hosted capabilities instead of reporting false success.
- Disconnecting a financial connection updates its status while retaining cached records. Demo reconnect is restricted to an actual demo workspace and cannot relabel a live connection.
- Mobile/tablet containment, narrow profile dates, internal links, finance panels and import/export views were corrected. Asset scanning has an explicit manual fallback and safe camera cleanup.

## Verification

The final interface suite passed **736/736 cases**: **544 route/viewport checks**, **188 action scenarios**, and **4 actor/cache-isolation cases**. All **56 existing browser regressions** and both dedicated incorporation/pathway browser flows passed. There were no failures, skips or retries in the final interface run. The machine-readable results and source fingerprint are in [interface-audit-results.json](../artifacts/interface/interface-audit-results.json). The route manifest covers 136 unique route patterns, including 26 dynamic patterns and 39 module-gated paths. Viewports are 320×740 and 390×844 with mobile/touch emulation, 768×1024 with touch, and 1440×900 desktop, using Chromium.

The route checks cover runtime failures, hydrated/unavailable route state, redirects and document/page horizontal containment. Action regressions cover saves, validation, readonly roles, record modes, keyboard focus, touch selection, documents, finance, governance and integration behavior. A seeded route check is distinct from a complete transaction test; missing-record and invalid-token fixtures explicitly verify unavailable states.

The combined `build:pages` and server/desktop type checks passed. The last CSS-only inspector correction was rebuilt with the same Vite asset settings and Pages preparation; TypeScript source stayed unchanged. Changed production TypeScript lint finished with zero errors and 187 style/complexity warnings. Vite still reports large bundle chunks.

Native verification includes reconciled authentication/identity/authorization and owner protections, tenant enforcement, private metadata, API keys and webhook secrets, financial connection state, routing/cache checks, portable-runtime parity, pathway registry/pipeline/submission checks, and combined frontend/Convex/server/desktop type checks. The stage-2 tenancy audit records 3,262 blocked probes, no leaked reads or writes and no new leaks; its single error is a closed-election synthetic ballot precondition. Its 1,004 not-applicable probes are not successful isolation assertions.

Use `npm run test:interface` for native interface checks plus the dedicated browser suite. Production preview runs set `INTERFACE_AUDIT_URL`; the metadata pending-query regression imports the development harness and runs against the development server. `npm run test:reconciled-security`, `npm run test:pathway-framework`, `npm run server:typecheck`, and `npm run build:pages` provide the existing regression/build gates.

## TanStack and remaining limits

Keep React Router and the Convex-compatible reactive client. Neither TanStack Query nor Router was added. Existing subscriptions, local persistence, authentication boundaries, browser basenames and Electron hash routing already have established owners. The concrete cache/privacy, polling and navigation defects were repaired there. See [the architecture review](interface-architecture-review.md) for the route inventory and criteria for a selective TanStack Query HTTP-read pilot or a typed-router migration.

This audit is not a production performance benchmark or certification of every workflow/provider. Live Clerk/Microsoft deployments, external registry submissions, provider accounts, physical cameras and native Electron execution were not exercised. Browser automation uses Chromium emulation, not physical iOS/Android devices or Safari/Firefox. The existing record engine exposes table, kanban and month calendar; schema-only week/list calendar layouts remain unimplemented and have no UI selector. Large datasets, cache eviction, large bundle chunks and general accessibility require separate measurement; passing viewport checks do not establish those properties.
