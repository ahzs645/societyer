# Isolated live Societyer qualification

This lab runs the actual Societyer Convex exports and Better Auth broker on a separate loopback-only deployment. It does not change the production auth mode or deploy the test helpers to production.

## Start a fresh lab

From this directory, install the root project dependencies first, then:

1. `npm start` starts the digest-pinned Convex backend on `127.0.0.1:43230` and generates private local credentials.
2. `npm run deploy` deploys wrappers around the actual root functions, plus internal-only qualification fixtures.
3. In another terminal, `npm run auth` starts the production broker on `127.0.0.1:43487`.
4. `npm run seed` signs up eight real local Better Auth accounts, binds production workspace roles, seeds demo records and record-table metadata, and writes private browser/API fixtures. It refuses to overwrite a populated account fixture.
5. `npm run prepare:interface` assembles native detail-route IDs, safe missing-record paths and a separate published public intake fixture for all 136 route patterns. Then `npm run prepare:minute-book-interface` prepares the additional private-document ACL fixture needed by the full browser suite. Wave views use explicitly synthetic cached native records, without an external provider call.
6. In another terminal, `npm run web` serves the actual root application on `127.0.0.1:43477`. Native Convex storage is explicitly selected for hosted image/file qualification. This command disables HMR and file watching for a consistent test snapshot; restart it after changing application source.
7. `npm test` runs live API role, upload, anonymous intake, encrypted vault and mixed-resource projection qualification. From the repository root, `npm run test:live-interface` runs the live browser suites once both preparation commands have completed. After browser qualification, run `npm run cleanup:minute-book-interface` to remove its temporary records and memberships.

The default native demo seeder creates an unbound Owner before its later minutes reconciliation requires membership. This lab's guarded internal fixture binds the selected real Better Auth Owner while the unchanged production seed inserts that row. This is an isolated qualification setup workaround, not a relaxation or qualification of the production maintenance seeding endpoint.

## Isolation and private data

The project has its own Docker volume and instance secret. The broker uses `tmp/live-qualification-auth.sqlite`; the application uses the same-origin frontend issuer and proxies `/api` to the broker. `.env.local`, `.env.accounts.local`, `.env.accountdraft.local` and `tmp/live-interface-fixture.json` contain credentials and must remain ignored with mode 0600. Public evidence artifacts omit these credentials. No Clerk or Microsoft production tenant is used.

`roleFixture.ts` and `projectionFixture.ts` export internal functions only. They require an operator admin-key invocation and `OFFLINE_LOCAL_QUALIFICATION=1`. Identity-seeding operations also require the configured isolated issuer. Wrappers are real generated files under ignored `tmp/live-qualification-functions`, because the Convex CLI does not discover symlink entry files; application code remains the root source.

Run role/module mutation qualification in a separate window from browser role checks: some tests intentionally downgrade roles or disable modules, then restore them. Upload, vault and projection tests use unique rows and do not toggle shared roles. Vault tests remove only the rows they create and can run alongside browser fixtures. Public intake tests create a separate workspace and leave it unpublished.

`npm run test:projections` qualifies the production minute-book and evidence-register projections with all eight real account states plus anonymous access. It uses a fresh disposable workspace because binder previews intentionally limit records. Temporary memberships and fixture records are removed afterward. The native companion, `npx tsx scripts/check-register-projection-authority.ts` from the repository root, also verifies scoped service principals, finance batch authority and legitimate Director document-evidence review. Final live results are in `artifacts/offline/live-register-projection-results.json`; the separate initial result records the populated-workspace preview-limit fixture issue.

`npm run test:document-coverage` independently verifies a private Constitution created through the production Owner document API. Owner retains full core checks; Viewer receives no private document metadata and sees document-dependent checks and supporting bundle gaps as unknown. The new `documentCoverageLimited` flag covers ACL-filtered binder previews and linked spine/evidence/material/signature rows. Coverage is conservatively unknown across document-dependent checks when any supporting preview is filtered. Separate results are in `artifacts/offline/live-document-coverage-results.json`; this affected-case proof supplements the earlier full interface qualification. Fixture records and temporary memberships are removed in cleanup.

Stop the services using their terminal interrupts and `docker compose --env-file .env.local -f docker-compose.yaml stop`. This preserves local data. No command here deploys to Zoer, the user's Mac or a public production service.

`npm run prepare:minute-book-interface` creates an additional empty disposable workspace for the four-width private-core-document browser regression. It binds the real Owner/Viewer accounts, seeds labelled supporting records, and creates a private Constitution through an actual Owner session and production API. Run `tests/live-interface-minute-book-acl.spec.ts` against the frozen live frontend, then `npm run cleanup:minute-book-interface` to remove its rows and temporary memberships. The ignored private fixture contains no session tokens; its synthetic private document title stays out of public evidence.
