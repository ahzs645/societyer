# Verification of the entity-aware legal implementation

**Verified 11 October 2026.** The final production build, all **38 legal/evidence regression scripts**, the **21-suite run with access enforcement enabled**, and the strict **22-test browser sweep** passed. The browser visited **540 routes** across five independently created workspace types, with no uncaught page errors or unallowlisted entity-copy leaks.

**Correction (same day).** That verification ran the browser sweep locally only. It did not run the corporation browser suite (`playwright.corporation.config.ts`), the legal record-form and task interface specs, or `scripts/check-platform-polish.ts`, and CI ran none of them. On the published revision (`aa79237`) all three failed: the corporation suite passed 0 of 4 tests, the record-form spec failed at every width, and the polish check failed. Most failures were tests that still expected copy the PR had intentionally changed. One was a real defect: the sidebar built its navigation items without the privacy label mode, so it showed the neutral "Privacy" label for every workspace. The [follow-up corrections](#follow-up-browser-coverage-in-ci-and-the-bc-privacy-default) fix these, restore the BC privacy default, and add a browser job to CI.

The [machine-readable results](verification-results.json) retain the individual gate names and durations, browser route inventory, environment, source-coverage count and runtime-parity results. The [coverage manifest](coverage.json) independently maps all 102 brief questions to their answers, official authorities, available runtime source IDs and implementation boundaries.

## Executed checks

| Check | Result | What the result establishes |
| --- | --- | --- |
| `npm run research:coverage` and coverage gate | 102/102 questions in 9 groups | Unique brief IDs, original-brief hash, substantive anchored answers, primary-source URLs, valid runtime-source bindings and existing implementation paths |
| `npm run test:legal` | 38/38 scripts passed | Profile isolation, date arithmetic and calendar review, evidence, consent/election authority, records, privacy, preparation documents, tenancy and integration regressions |
| `npm run test:portable-manifest` | Passed; 5 scanner tests passed | Hosted delegation and portable registry remain in sync |
| `node --import tsx scripts/check-static-convex-parity.ts` | Passed | 347 frontend writes: 329 handled, 18 intentional offline no-ops, zero pending/unimplemented |
| `node --import tsx scripts/check-record-validation.ts` | Passed | Native/local record validation for the exercised documents, people, grants, financial and custody records |
| `node --import tsx scripts/check-stage2-enforced.ts` | 21/21 suites passed; exit 0 in 19.246 seconds | Access enforcement, identity binding, snapshot roundtrip, tenancy, accounting, equity, meetings, documents, connectors and integrated organization flows |
| Voting-power and static corporation people-register checks | Passed | The downstream domain checks skipped by the initial failed CI run also pass; the equity-ledger check passes inside the enforced runner |
| Portable conformance matrix in GitHub Actions | 987 registered functions; 0 divergent results | 441 exercised query/mutation cases and 546 consistent rejection cases agree across the compared runtimes |
| `npm run build` | Passed | Convex TypeScript, project TypeScript and Vite production build; Vite completed in 39.85 seconds |
| `npm run test:entity-sweep` with the available Chromium executable | 22/22 tests passed (local run only; not run in CI at the time) | Guided setup, complete route inventory, entity-copy assertions, privacy conditional-state assertions and uncaught-error checks |
| `git diff --check` | Passed | No patch whitespace errors |

The production build emitted Vite's warning about chunks larger than 1000 kB after minification. This was a warning, not a failed build; this change does not establish a performance budget or redesign the application's large editor/dependency bundles.

## Final portability corrections and CI

The first published implementation commit (`d6b2b35acb1ff164683fa36d40c460674bd94765`) passed the complete [legal-governance workflow](https://github.com/ahzs645/societyer/actions/runs/38170071802), including the production build. Its [portable workflow](https://github.com/ahzs645/societyer/actions/runs/38170071815) passed the conformance matrix, authorization and earlier checks, then found an outdated snapshot fixture expecting the former annual-packet name. Once that fixture was corrected, the local full enforced runner also exposed the stale generated Stage 2 function inventory.

The follow-up changes only the fixture, derived inventory and documentation. The roundtrip test now verifies that the same annual preparation precedent preserves its preparation disclaimer, template links and source provenance through export/import. Regenerating the 2,130-entry inventory adds or updates ten entries for actual authenticated endpoints and ID arguments. No access classification, leak baseline or suppression changed.

The final local enforced run exited 0 after all 21 suites. Its tenancy check recorded 3,719 blocked attempts, zero leaked reads, zero leaked writes and zero new leaks. The existing harness also reports 11 error and 1,217 not-applicable cases; these are not counted as successfully exercised authorization cases. The live [PR checks](https://github.com/ahzs645/societyer/pull/60/checks) show both workflows for the latest published revision. The machine-readable record below distinguishes the initial CI observations from the corrected local run instead of describing the initially failed portability workflow as a pass.

## Evidence and authorization coverage

### Annual business and filings

The annual tests distinguish a planned meeting, an actual held meeting, a year without an actual meeting date, and an independently reviewed written annual-business completion. They check first/subsequent annual deadlines, BC society calendar attribution, registrar extensions, anniversary filing periods, Ontario actual taxation periods, leap days and the difference between ordinary calendar-month and fiscal month-end arithmetic.

Filings identify their own reporting year or exact period. Native-schema tests reject invalid dates, fractional years, inconsistent year/period inputs, future filed dates and unauthorized or foreign-workspace mutations. Home annual cycles exclude branch and extra-provincial filings and contradictory explicit jurisdictions. A later receipt does not discharge an earlier draft or missing cycle, including when a convenience “last filed” field is present.

The calendar regression includes the nominal BC society January 31, 2027 deadline falling on Sunday. Raw arithmetic cannot label a February 1 filing legally late. A reviewed calendar input must match the exact Act profile, obligation, cycle and nominal boundary. Missing, future, contradictory or unrelated review evidence cannot produce a verified overdue/late outcome. Actual completion remains recorded separately from its assessed timeliness. Notice calculations do not apply a guessed next-Monday adjustment.

### Written resolutions, elections and notice

`check-written-resolution-evidence.ts` exercises the actual handlers using the native Convex test harness with the real schema, `MemoryDb`, and `LocalStoreDb`. It covers the required majority/unanimity branches, Ontario entitled-share counting, frozen weights, actual consent time versus audit-recording time, circulation chronology, duplicate/foreign identities, legacy authority gaps and Ontario non-signer notice evidence.

Shareholder-election tests exercise legal-holder identity, explicit account authority, reviewed record dates/class rights, historical-ledger reconciliation, immutable opening weights and cumulative allocations. Notice tests distinguish all-member society notice from corporate shareholder/director/auditor recipients and count actual unique recipient coverage. Nominal notice-window results remain under calendar review; a matching date does not become a green legal-validity assertion.

### Annual preparation and historical documents

Native and local tests generate the scoped Ontario annual preparation packet while rejecting Ontario incorporation and other unreviewed pathways. Modern and legacy annual preparation records remain under review. Ordinary generated-document updates cannot supply a presumed signer roster or finalize the draft; the separate document review-status endpoint also cannot mark a preparation packet signing-ready or approved.

The regression retains historical unexecuted text and adds a review projection/annotation. For executed originals, it checks preservation of the stored document, execution status, signer evidence, source snapshot, source inputs, links and retention settings. Metadata edits cannot replace that historical evidence with a newly generated template.

### Privacy and source-guided screens

Privacy tests exercise authenticated schema persistence, the BC-home presumption of BC PIPA and its displacement by recorded federal-work or non-BC facts, activity-based multi-law assessment, missing/contradictory facts, nonprofit exceptions, source selection, access-day bases, incident-record periods, exclusion of proposed laws, shared policy output, preservation of authored drafts and idempotent draft/task creation.

Rendered guidance tests cover the four reviewed governance profiles and unsupported nonprofit/cooperative entities. They check entity-specific sources, optional society audit, distinct director/senior-manager conflict rules, Ontario's repealed auditor exemption, member-funded director requirements and the separation of privacy applicability from incorporation outside BC. Explicit unknown jurisdictions and Acts cannot clear the review guard through stored bylaw rules or lower-priority legacy identity fields.

## Strict browser sweep

The final run completed in approximately **2.2 minutes**: five guided workspace setups, one route-coverage guard, fifteen route shards and one final verdict. Each workspace was created through the real setup flow and then visited the same 108-route inventory.

| Workspace | Route visits | Uncaught page errors | Unallowlisted copy leaks |
| --- | ---: | ---: | ---: |
| BC business corporation | 108 | 0 | 0 |
| Federal CBCA corporation | 108 | 0 | 0 |
| Ontario OBCA corporation | 108 | 0 | 0 |
| Custom Québec entity | 108 | 0 | 0 |
| BC society control | 108 | 0 | 0 |
| **Total** | **540** | **0** | **0** |

The known-leak baseline is empty. There were no new or stale baseline entries. Narrow allowances cover reviewed contextual wording, such as closed conditional privacy-law summaries and external catalogue/tag identifiers; the tests assert the surrounding privacy applicability explanation and absence of an “assessed as applicable” claim. They do not globally suppress PIPA or society wording.

The representative Privacy screenshot (the CBCA workspace) was visually inspected. The full applicability questions wrap and remain readable, the workspace has no inferred operating province, and possible laws remain visibly conditional. After the follow-up, the two BC workspaces show BC PIPA as "Presumed: confirm facts" instead; see below. The final evidence timestamp is **2026-10-11T19:47:59.595Z**.

The normal Playwright browser download failed in this environment. The successful run used Chromium **147.0.7727.0** from an isolated `@sparticuz/chromium` installation and the repository's existing configurable executable path. No browser dependency was added to the application. The final build and legal checks include the two subsequent TypeScript-only narrowing/array annotations; those did not change browser behaviour.

Earlier discovery runs found an inspection-copy leak, a sidebar readiness race in the test, unreadable form labels and concurrent-edit React errors. The implementation/test corrections were made before the final strict run. Those discovery failures are not counted as successful verification.

## Follow-up: browser coverage in CI and the BC privacy default

### What CI runs

The `Legal governance and evidence` workflow (`.github/workflows/legal-governance.yml`) runs on every pull request and every push to `main`. It has two jobs.

| Job | Steps |
| --- | --- |
| `legal-governance` | `npm run test:legal` (38 scripts), `npx tsx scripts/check-platform-polish.ts`, `npm run test:portable-manifest`, `npm run build` |
| `legal-governance-browser` | Installs Playwright Chromium (`npx playwright install --with-deps chromium`), then runs: the strict entity sweep (`ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep`, 20-minute step limit); the corporation browser suite (`playwright.corporation.config.ts`); and `tests/interface-records.spec.ts` with `tests/interface-tasks.spec.ts` on the desktop project of `playwright.interface.config.ts`. Each later suite still runs if an earlier one fails. Failure artifacts are uploaded. The job limit is 50 minutes. |

The portable conformance workflow is unchanged. CI still does not run the other interface projects (narrow phone, phone, tablet), the other Playwright configs, or the enforced Stage 2 runner (`scripts/check-stage2-enforced.ts`). The enforced runner result above is a local result.

### Test expectations updated to the PR's intended copy

Each change below was checked against the PR diff. Each test now asserts the new behaviour.

- **Director attestations** (`src/pages/Attestations.tsx`). Corporate statutes impose no annual director attestation, so the statutory warning ("have not yet attested") became an informational note: "have no optional annual attestation recorded for {year}". The test asserts the new note and that the old wording is gone.
- **Written resolutions** (`src/pages/WrittenResolutions.tsx`). The free-typed signature count, with its "Shareholders holding voting shares on the share register: 1" hint, was replaced by a server-computed electorate preview. The count is still shown, so this is not a regression. For the CBCA fixture the drawer shows "1 eligible people · 1 people. Required: 1 people." (CBCA s. 142 needs every voting shareholder) and the decision body "Shareholders". The test asserts both. The elections page still shows the share-register voter source.
- **Elections subtitle**: now "Shareholder elections with verified representation and share-weighted ballots."
- **Conflicts subtitle**: now the entity-neutral "Directors’ disclosed interests and the recorded handling of each matter." The test still asserts that "(s.56)" never appears.
- **Annual packet**: "Annual resolutions and return packet" became the preparation-only "Annual business and return preparation". The test asserts the new name and that the old one is gone.
- **Auditors dialog**: the field "Firm name" became "Auditor or firm name", because an auditor can be an individual. The other 27 dialog fields in `interface-records.spec.ts` were checked against the current labels and pass at all four widths. That test's time limit rose from 120 to 300 seconds: it opens 28 dialogs per width, and on a loaded runner the full sequence can take longer than two minutes.
- **Loading label**: while a workspace loads, the privacy navigation label is the neutral "Privacy". The PR made this change on purpose; the polish check now expects it.

### BC privacy default

The PR derived privacy labels and checks only from recorded privacy facts. Every existing BC society and BC company without those facts therefore lost the "Privacy (PIPA)" label and its PIPA dashboard checks. That outcome was legally too narrow. BC PIPA s. 1 defines "organization" to include "a not for profit organization". Section 3(1) applies the Act to every organization, except where the federal Act (PIPEDA) applies to a federal work, undertaking or business, or to interprovincial or international commercial transfers (s. 3(2)).

`shared/privacyRuleProfiles.ts` now presumes BC PIPA for a BC-home workspace (the same BC-home test the rest of the app uses) unless recorded facts displace it:

- federal-work status is recorded as "yes";
- a health or public-sector regime is recorded; or
- the recorded operating locations exclude BC.

A presumed law is applicable for labels and checks, carries `basis: "presumed"`, and appears in the assessment UI as "Presumed: confirm facts". The page title reads "Privacy (BC PIPA — presumed: confirm facts)". The open facts stay listed, and the dashboard still asks for the assessment. The navigation shows "Privacy (PIPA)" and "PIPA training" again, and the BC PIPA dashboard checks, guides and setup motions are restored.

Outside BC, nothing is presumed: those workspaces still use the activity-based assessment. A complete BC assessment ("BC operations, not a federal work, general private-sector records") replaces the presumption with a recorded result. `check-privacy-profiles.ts`, `check-entity-rule-scope.ts`, `check-organization-vocabulary.ts`, `check-dashboard-resource-authority.ts`, `check-jurisdiction-guide-tracks.ts` and `check-platform-polish.ts` each assert the BC default and an explicit federal-work override. The entity sweep asserts the presumed state for the two BC workspaces and the conditional state for the other three. The corporation suite asserts the sidebar labels and the presumption badge for a BC company.

### Defect found by the new coverage

`src/components/Layout.internal.tsx` built sidebar items without the route's `privacyMode`. As a result, the sidebar never resolved privacy labels, even for a workspace with recorded BC facts. The item now carries `privacyMode`, and `check-platform-polish.ts` guards against regression.

### Local results for the follow-up

These runs used Chromium from `SOCIETYER_CHROMIUM_PATH`, on a heavily loaded 4-core machine:

| Check | Result |
| --- | --- |
| `npx playwright test -c playwright.corporation.config.ts` | 4/4 passed |
| Interface records and tasks, desktop project | 9/9 passed |
| `ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep` | 22/22 passed in about 5 minutes; 540 routes, 0 page errors, 0 leaks, empty baseline |
| `npm run test:legal` | 38/38 passed |
| `check-platform-polish.ts`, `check-privacy-profiles.ts`, `check-entity-rule-scope.ts` | Passed |
| `npx tsc -b` | Passed |

The CI results for these jobs appear on the PR checks once the revision is pushed. This document does not claim a CI pass for them.

## Review fixes: combined verification

An independent review of `aa79237` reproduced the CI-covered results but found defects the existing checks did not exercise: deadlines walking back to the incorporation year, guide rules disappearing for past dates, directors' written resolutions ignoring role-holder directors, a UTC-date rule that blocked evening circulations in BC, unbounded record dates, a stale BC company reference date, evidence fields with no writer, and a director-contact leak through AGM notice reads. A legal spot-check of 21 answers against the official consolidations found the core law correct. The fixes, the regression checks added for each, and the documentation changes are described in the [research index](README.md#review-fixes) and the extension guide.

All gates below were run locally on the combined fix branch (on top of `aa79237`), in one sequence, on the same commit:

| Gate | Result |
| --- | --- |
| `npm run test:legal` | 44/44 scripts passed (adds guide-rule continuity, annual-deadline review fixes, written-resolution routes, meeting-notice authority, deadline source keys and clone isolation) |
| `npm run test:stage2-enforced` | 21/21 suites with enforcement on |
| `npm run test:stage2-tenancy` | 3,732 blocked attempts; 0 leaked reads; 0 leaked writes; 0 new leaks |
| `npm run test:static-parity` | 350 frontend writes; 332 handled; 18 intentional offline no-ops; 0 pending |
| `npm run test:portable-manifest` / `test:portable-conformance-matrix` | passed; MemoryDb and LocalStoreDb agree across the portable surface |
| `check-platform-polish`, `check-entity-rule-scope`, `check-seeded-record-views`, `check-deadline-source-key` | passed |
| `npm run build` | Convex TypeScript, project TypeScript and Vite passed |
| Strict entity sweep (`ENTITY_SWEEP_STRICT=1`) | 22/22; five workspaces; 0 page errors; 0 unallowlisted leaks; empty baseline |
| `playwright.corporation.config.ts` | 4/4 |
| Interface suites (dashboard, tasks, governance, records, calendar views, shared) on desktop and phone | 64/64 |
| Guided setup (four viewports) | 16/16 |
| Meetings editing | 3/3 |

The new `legal-governance-browser` CI job runs the strict sweep, the corporation configuration and the records and tasks interface suites; its first CI result is reported on the pull request, not claimed here.

## Reproduction and practical limits

Use Node 24 and the repository lockfile:

```sh
npm ci
npm run research:coverage
npm run test:legal
npm run test:portable-manifest
node --import tsx scripts/check-static-convex-parity.ts
node --import tsx scripts/check-record-validation.ts
node --import tsx scripts/check-stage2-enforced.ts
node --import tsx scripts/check-voting-power.ts
node --import tsx scripts/check-static-corporation-people-register.ts
npm run build
npm run test:entity-sweep
```

Browser suites (also run in CI; see below):

```sh
ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep
npx playwright test -c playwright.corporation.config.ts
npx playwright test -c playwright.interface.config.ts tests/interface-records.spec.ts tests/interface-tasks.spec.ts --project=desktop
npx tsx scripts/check-platform-polish.ts
```

If Chromium is installed outside Playwright's default location, set `SOCIETYER_CHROMIUM_PATH` to the executable. The configs use it only when set. A custom font installation can require `FONTCONFIG_PATH`. To run several checkouts on one machine, set `ENTITY_SWEEP_PORT`, `CORPORATION_FLOW_PORT` or `INTERFACE_AUDIT_PORT` to free ports. The legal runner uses `node --import tsx`, avoiding the separate `tsx` CLI's IPC requirement.

These are synthetic evidence/authorization fixtures and browser workflows, not a production registry acceptance test or a legal opinion on an organization's facts. Articles, bylaws, unanimous shareholder agreements, actual execution, historical law, office calendars and special subtypes remain factual review inputs. The reviewed-calendar contract has no broad capture UI in this change, and annual preparation packets require a separately reviewed execution instrument. Ontario and Alberta source-retrieval limits are stated in the detailed research. A passing suite verifies the encoded behaviour and provenance; it cannot establish future legislative currency.
