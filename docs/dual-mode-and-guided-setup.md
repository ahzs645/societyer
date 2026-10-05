# Desktop modes and guided organization setup

This change starts from reconciled main `28f2e92c703a2f2bb460ccd5565190dccd24c33e`, which includes authentication commit `cc52e24487f42c19f81b2d22385091006bc70b44`. The attached research is supporting evidence, not implementation instructions. React Router and Convex remain the routing and data infrastructure.

## Desktop behavior

The bundled Electron application opens its native local workspace. Users can configure an exact HTTPS Societyer application origin and switch to its hosted application. The hosted window is sandboxed, has no native preload bridge, and uses a persistent session partition scoped to that origin. Additional sign-in origins require an explicit exact-origin configuration; other top-level redirects and popups are blocked. Native IPC independently checks the registered local window and its top frame.

Switching back preserves the local vault and its native files, and closes the hosted renderer and its connections. Save online forms before switching; persistent hosted cookies and saved origin-scoped data remain available when reopened. The two modes keep separate datasets. This does not upload a local vault, synchronize all modules, or allow the hosted application to operate fully offline. PowerSync remains the separately qualified meeting-preparation pilot. Hosted authorization and token verification remain authoritative; local backups cannot establish a hosted identity or role.

Online connection failures return the user to local setup. Local startup does not depend on a hosted account. Real external Clerk/Microsoft SSO and signed macOS/Windows installers still require platform/deployment qualification; the Linux Electron runtime checks use an isolated HTTPS fixture.

## Guided web and local setup

The setup flow asks whether the user has used Societyer before and offers local backup recovery. JSON backup validation precedes destructive confirmation and bounds input size, table/row counts, IDs and attachment references. JSON restores records and references; physical documents require their separate file/native archive backup. Hosted upload/tenant migration remains a separate operation with its own identity and authorization requirements.

Users explicitly choose an existing organization or preparation for incorporation, and select the actual/planned Act from the shared pathway registry. The wizard gathers the legal/proposed name, dates and fiscal year end, registered/mailing address, contact and privacy details, membership/share-class planning, document readiness, people readiness and operating regions.

Existing organizations start as `unverified_existing`; proposed organizations remain `preparing` and `pre_incorporation`. Setup neither manufactures an incorporation certificate nor creates actual securities, appointments or application-access grants from planning notes. Bounded, versioned answers are saved with the organization and its onboarding checklist.

The onboarding page links directly to the profile, locations, documents, appropriate membership/director or corporate role/security registers, workspace access, formation/filing pathway and tasks. These links respect the current user's permissions. Official registry channels and required preparation information remain available, with submission and certificate verification treated as separate actions.

A fresh, verified hosted user can create their own organization and becomes its Owner. Anonymous, disabled, inactive-only and ambiguously bound identities cannot bypass lifecycle checks through this path. Existing roles, cross-workspace isolation, Clerk profiles, restricted Microsoft mode and last-active-Owner protections remain in force.

## Qualification

| Check | Result and scope |
| --- | --- |
| Guided local setup and restore | 16 distinct cases at 320, 390, 768 and 1440px, including real company/address creation, formation handoff, downloaded backup restored on a second device context, and malformed backup preserving existing records |
| Hosted signup and setup | 4 cases at 320 and 1440px, using the signup form, actual Better Auth sessions and Convex JWT verification; new/existing organization, reload, new Owner binding and foreign-workspace read denial |
| Hosted creator authorization | 5 native handler groups: anonymous/actor/issuer denial, lifecycle restrictions, new account binding and returning creator isolation |
| Electron | 12 actual runtime scenarios plus origin, native IPC and asset-path architecture checks; local files, separate hosted session, SSO fixture, restart, failed endpoint and WebSocket termination |
| Authentication/authorization | Reconciled security suite passed, including Clerk, Microsoft restrictions, roles, cross-workspace/document authority and last-active-Owner protection; final policy classification covers 928 hosted and 821 portable functions |
| Integration contracts | Interface contracts, route hrefs, personal-view/metadata/history guards and permissioned mutations passed; export inventory covers 196 business tables and excludes 7 internal auth/sync tables |
| Compilation | Server typecheck, combined Convex/frontend Pages build and Electron native/bundled-renderer build passed. Large deferred feature chunks still produce bundle-size warnings. |

The combined audit has **152 distinct targeted browser cases**: 60 inventory/settings, 12 new public/editor/intake contracts, 4 elections, 12 finance, 16 guided local setup/restore, 4 live hosted setup and 44 operations cases. Repeated API/export/public cases are counted once. Four final sparse-address reruns replace earlier results within the 16 guided cases. Route rendering, demo role/provider contracts, local transactions and live hosted flows are different qualification scopes; this is not certification of every external service or every possible module operation.

See [combined qualification evidence](../artifacts/interface/dual-mode-setup-qualification.json), [hosted setup evidence](../artifacts/interface/hosted-guided-setup.json), [local setup evidence](../artifacts/interface/guided-organization-setup.json) and the [desktop runbook](desktop-dual-mode.md). Final module browser and runtime results are recorded in the [module integration audit](module-integration-audit.md). Historical full-app and PowerSync results retain their original source baselines and are not counted again for this change.
