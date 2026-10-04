# Live workspace authorization qualification

The local qualification exercises the production Convex function exports with actual Better Auth email sessions and broker-issued JWTs verified by an isolated self-hosted Convex backend. It does not replace Societyer roles with authentication-provider roles. Clerk and tenant-restricted Microsoft remain production configuration options; their external-provider login flows need their own credentials and are covered separately by the reconciled policy regression suite.

Run `node experiments/live-qualification/check-roles.mjs` after starting the local qualification backend and broker and creating the ignored `.env.accounts.local` account configuration. The internal fixture helpers in `experiments/live-qualification/convex/roleFixture.ts` require both admin-key invocation and `OFFLINE_LOCAL_QUALIFICATION=1`; they are not part of the production function directory.

The account configuration contains `convexUrl`, `authUrl`, `issuer`, `adminKey`, `fixture: {societyA, societyB, users}`, and `accounts: [{key, email, password}]`. It is a local credential file and must stay ignored. Active actor keys are `owner-a`, `admin-a`, `director-a`, `member-a`, `viewer-a`, and `owner-b`; `disabled-a` and `invited-a` have inactive Admin memberships. Sessions use the same accounts in all calls, so downgrading a role tests current database authority rather than issuing a different role token.

## Fixed roles and additional restrictions

| Role | Declared read policy | Declared write policy | Membership administration |
| --- | --- | --- | --- |
| Owner | All fixed read permissions | All fixed permissions, including settings management | Ordinary changes must preserve an Active Owner |
| Admin | All fixed read permissions | All except `settings:manage` | Director, Member and Viewer authority; cannot manage Owner/Admin authority or remove users |
| Director | All fixed read permissions and export downloads | Meetings, minutes, agendas, documents | Cannot change workspace roles |
| Member | Workspace profile, members, meetings, minutes, agendas, motions, elections, documents, grants, volunteers, communications, tasks | No fixed write grants | Can read own profile and own role policy |
| Viewer | All fixed read permissions | No fixed write grants or export-download grant | Cannot change workspace roles |

Explicit minutes approval, clearing approval and newly carried adoption of another minutes record require `minutes:approve`; Director drafting permission does not confer that authority. Unchanged adoption motions remain editable in a draft.

These are the shared role grants. Active membership, a verified identity binding, operation state, document visibility and individual sharing grants can restrict an operation further. An authenticated foreign-workspace Owner has no authority in the tested workspace. Disabled or invited membership does not become active by keeping a valid login session.

Export APIs currently require `exports:download`, including `exports:listExportableTables`. Viewer has `exports:read` but cannot use that catalog API. The module access UI describes this as partial declared export coverage; it must not be interpreted as proof that every export screen is accessible.

## Module switches

Optional modules are feature configuration, stored separately from role permissions. Disabling a module does not delete records or rewrite a user's fixed role grants. The live qualification verifies all 21 switch values persist, grants stay unchanged, authenticated grant administration remains authorized by role, and disabled public volunteer intake is rejected. Published anonymous intake is tested separately with actual native APIs on a disposable workspace.

Public applications are a specialized intake operation, not a general write grant. Anonymous callers need a published public slug, publication enabled, the corresponding intake flag, and an enabled module. Grant intake additionally requires an explicitly public opportunity. Public applications cannot claim a private member identity, target a non-public grant, or acquire workspace membership. Authenticated active workspace users retain the existing internal application path. Disabled and invited memberships do not bypass their status through an authenticated intake call.

Enablement enforcement is operation-specific: public volunteer/grant intake and selected communication execution actions check the module setting. Existing list APIs and ordinary operator grant updates retain their independent authorization. A hidden navigation link alone is not evidence of server permission denial. If switches are meant to revoke every module API, that is a policy change requiring a complete mapping and migration, not a claim this qualification makes.

## Coverage and evidence

The final native role run passed **84/84 grouped scenarios**, making **722 API attempts: 406 queries and 316 mutations**. Of these, 294 completed and 428 were rejected as expected, including two public-transport attempts to call internal fixture helpers. Ten operator-only fixture calls and 16 Better Auth broker requests are counted separately. The published intake run passed **6/6 grouped scenarios** with **19 API attempts: six queries and 13 mutations**, seven completed and 12 expected rejections; its six operator-only fixture calls are separate. These are measured request counts, not the number of production endpoints or every possible input/state combination.

`artifacts/offline/live-role-results.json` records actual endpoint scenarios, pass/fail results, time and test target. `artifacts/offline/live-public-intake-results.json` records published anonymous applications and direct-API rejection of private, disabled, unpublished and closed-opportunity intake. The cases cover fixed-resource reads, optional-domain reads, real business writes, child records and inferred workspace ownership, foreign row substitutions, forged actor IDs, own-profile access, elevated-role restrictions, last-active-Owner protection, immediate write revocation after role downgrade, tenant-owned and legacy directory isolation, portfolio overview/search resource restrictions, and atomic authorization of cross-workspace packet batches. Proxy creation additionally respects the active bylaw prohibition; permitted workspace roles do not override that legal rule.

Run `node_modules/.bin/tsx scripts/record-authorization-surface.ts` to regenerate `artifacts/offline/authorization-surface.json`. That inventory enumerates every production public authorization wrapper and its declared policy. It is **static source coverage**, not a statement that every input or state transition on every endpoint was tested live. Argument-dependent metadata/read rules and upload-purpose policies are marked; specialized handlers need their own policy. The live checks intentionally test representative real operations rather than inventing a passing runtime count from static classification.

## Confirmed-member election participation

`node experiments/live-qualification/check-eligible-member-election.mjs` creates a separate disposable workspace and a new real Better Auth Member account linked to an Active member with voting rights. Actual Owner APIs create questions and snapshot the legal member electorate. The final run passed **6/6 scenarios with 46 measured API attempts** (12 queries and 34 mutations; 30 completed and 16 expected denials). Its two internal fixture calls and seven broker requests are separate. Existing A roles and memberships are untouched; the temporary fixture Owner membership is removed after preparation.

The qualification verifies successful nominations and one anonymous ballot, duplicate ballot rejection, current-principal actor matching, foreign election/question denial, forbidden Member administration, exact Owner tally, and separation of private eligibility from anonymous ballots. Specialized nomination/ballot handlers now reject a supplied actor ID that differs from the authenticated participant. Ballot completeness and abstention policy are unchanged. Results are in `artifacts/offline/live-eligible-member-election-results.json`.

The dedicated browser command is `node_modules/.bin/playwright test --config=playwright.live-election.config.ts`, outside the main interface suite glob. It uses the private ignored `.env.election-browser.local` fixture and actual login form, with one unvoted election per 320/390/768/1440-pixel viewport. Each run consumes those fixture ballots; prepare a new isolated fixture before repeating.

## Mixed-resource dashboard reads

Dashboard summary and navigation counts apply the current role grants and service scopes to each underlying resource. Member-readable summaries retain members, meetings and tasks while omitting restricted directors, filings, deadlines, conflicts, committees, goals and filing evidence. Evidence chains require all of filings, documents, users and audit read access. Compliance checks only run with their permitted inputs; omitted inputs cannot become a compliance failure or a claim that all checks passed. Viewer retains the declared full read grants.

`npm run test:dashboard-resource-authority` uses the actual production Convex exports and a populated database fixture to check private marker exclusion, authorized compliance checks, counts, Owner/Viewer reads, narrowly scoped service principals and propagation of unexpected database errors. `node experiments/live-qualification/check-dashboard-resources.mjs` separately exercises real broker sessions against the isolated deployed API; its measured results are stored in `artifacts/offline/live-dashboard-resource-results.json` when run.

Frontend subscriptions use the same resource permissions, including Dashboard activity, MeetingDetail directors/users/committees/conflicts/proxies, Timeline secondary domains, minutes-preview directors, workflow reference selectors and shared mention/activity components. A Member-accessible primary route does not confer read authority for its optional settings or audit tabs.

## Structured legal registers and edit history

Legal register projections preserve the dedicated resource boundary: director/officer rows require `directors:read`, controller rows require `settings:read`, and other legal register types keep their existing document/member read policy. Current registers, rights-ledger role-holder projections, historical snapshots and diffs all apply these checks. Direct revision history also checks prior types, so a transition to a readable representative or deletion cannot disclose an earlier protected director/officer record. Authorized Owner/Viewer history remains available after deletion by resolving a uniquely owned surviving revision trail.

`npm run test:role-holder-resource-authority` qualifies these actual production exports with Member, Owner, Viewer and scoped-service contexts. `node experiments/live-qualification/check-role-holder-resources.mjs` uses actual broker sessions and a separate guarded disposable workspace; it removes all added account memberships afterward. Its measured requests and results are recorded in `artifacts/offline/live-role-holder-resource-results.json`. This protects structured registers and history; authorized meeting/document text is governed by its own existing access policy.

The final eligible-Member browser run passed **4/4** positive nomination/ballot flows at **320/390/768/1440 pixels**, with persistence after reload, unavailable administration/duplicate-vote controls, no page errors and no horizontal overflow. `artifacts/offline/live-eligible-member-browser-results.json` records viewport results and screenshots. Fresh browser preparation used 12 actual Owner setup mutations, two internal fixture calls and three broker requests, recorded separately; it did not rerun the unchanged native participant assertions.

The final live Dashboard projection check passed **3/3 groups with eight native queries** (four completed and four expected denied; ten broker requests separate). The structured legal register/history check passed **4/4 groups with 17 native queries** (eight completed and nine expected denied; two internal fixture calls and eight broker requests separate). Both use actual broker sessions; structured fixture memberships were removed afterward. The five-role/native library regression additionally protects documents-only service callers from meeting-object and material projections while preserving authorized library documents and all tested human role outputs.

The library scoped-service proof uses the production handler and real Convex database adapter in the native regression. It is not a live service-token transport test: this disposable lab configures actual Better Auth user JWTs, while scoped service principals enter through separately configured gateway/internal bindings. The final backend-only library change preserves all five human role responses tested by the native regression.
