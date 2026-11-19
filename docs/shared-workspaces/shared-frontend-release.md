# Shared production frontend

On November 19, 2026, the shared production frontend was published and First
Form's custom-domain attachment and DNS were moved to `societyer-ddcnorth`.
Cloudflare domain, ownership and HTTP certificate-validation statuses are active.
The [deployed setup](production-setup.md#november-19-2026-shared-frontend-release)
records this release separately from the November 8 shared-backend migration.
Hosting does not grant workspace access or merge organization records.

| Layer | Target |
| --- | --- |
| Public domains | `portal.ddcnorth.com`, `portal.1stform.ca` |
| Production Pages project | `societyer-ddcnorth` (Direct Upload) |
| Cloudflare account | `479e77f49d4ac5d7498529ee360f194b` |
| Build profile / output | `.env.shared` / `dist` |
| Shared Convex production | `industrious-cricket-610` |
| Legacy First Form Pages project | `societyer-firstform`, retained for existing alias sessions and rollback |
| Released source | `7dcad5ef620e362c77d204eeafeb0df988fcaa82` |
| Production Pages deployment | `bf8ab44f-d9cb-464f-9197-4029737631af` |

The project name is a hosting identifier. Both custom domains serve the same
assets from it. Domain mapping in Convex supplies the workspace name, logo and
sign-in policy. The DDC compact sign-in symbol and favicon are restricted to
the configured DDC origin. Other domains retain their existing neutral favicon.
Workspace logos inside the app continue to follow the workspace brand.

The shared build includes the existing meeting-transfer broker URL. Its client
is mounted only after the meeting's own authenticated workspace storage policy
resolves to SharePoint. Native workspaces and unresolved policies do not mount
it. The backend remains the authority for storage, membership and access.

## Release

Use a clean checkout with the Tourkit submodule and locked dependencies:

```sh
git submodule update --init --recursive
npm ci
npm run test:shared-frontend
npm run build:shared
npm run deploy:shared
```

Do not install dependencies inside `modules/tourkit`; its own React copy would
break hooks. `build:shared` runs the backend and frontend TypeScript checks and
builds once with `.env.shared`. `deploy:shared` builds and publishes that output
to the production branch of `societyer-ddcnorth`. For an already verified build:

```sh
CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b npx wrangler pages deploy dist --project-name societyer-ddcnorth --branch main
```

On a build machine where TypeScript reaches Node's default heap limit, run the
build with `NODE_OPTIONS=--max-old-space-size=6144` and sufficient available RAM.
Keep the checks enabled; increasing the build process's memory does not change
the application bundle or the deployment's runtime limits.

The former `build:ddcnorth`, `build:firstform`, `deploy:ddcnorth` and
`deploy:firstform` commands are compatibility aliases for the shared commands.
They no longer publish separate application releases. The old `.env.ddcnorth`,
`.env.firstform` and `deploy/firstform/wrangler.jsonc` remain only for deliberate
legacy/rollback operations.

A frontend-only change does not require a Convex deployment. When backend code
also changes, deploy the shared backend first using the explicit shared selector
and `--codegen disable` in the [backend release guide](../firstform-cloud-deployment.md#release).
Never deploy to the old First Form `elated-bee-460` production selector.

The November 19 release required the name-request backend
contract introduced in `686ee2de`. Its `legalOperations:upsertNameSearchItem`
validator accepts the lifecycle, registry, payment and supporting-document
fields sent by the current frontend. The shared backend was deployed from the
released source before the frontend; schema validation passed and the dashboard
confirmed the new name-request fields. For later releases, verify or deploy any
required backend contract first. A successful local build does not establish
the live backend's version.

These are Direct Upload projects: pushing Git or publishing the GitHub Pages
mirror does not release the Cloudflare frontend. Verify Cloudflare's canonical
production deployment and its commit SHA after publishing. No extra hosted CI
runner is required for this release process.

## One-time domain move

The attachment and DNS changes below completed on November 19, with all
Cloudflare domain validation statuses active. Both sign-in presentations and
the shared script were verified in the browser. This procedure is retained for
recovery and future domain moves.

Cloudflare requires both the Pages custom-domain attachment and DNS to name the
shared project. Deploy and verify the shared build before moving First Form.

1. Record both canonical deployment IDs, the existing domain attachment and
   the exact `portal.1stform.ca` DNS record for rollback.
2. Detach only `portal.1stform.ca` from `societyer-firstform` and attach it to
   `societyer-ddcnorth`.
3. Re-read DNS, then update that CNAME to `societyer-ddcnorth.pages.dev` if
   Cloudflare has not already done so. Preserve proxying, TTL and the comment.
4. Wait for the domain, ownership verification and certificate validation to
   become active. Verify both custom domains serve the same release assets.
5. Check the DDC and First Form sign-in presentation and a direct app route.

The API does not provide an atomic domain transfer, so a brief transition is
possible. Neither custom origin changes: existing cookies, browser storage,
trusted origins, workspace mappings and Microsoft callback URLs stay valid.
Do not change Convex settings or import any data for this hosting move.

## Legacy alias and rollback

`societyer-firstform.pages.dev` retains deployment
`72aa7753-dd02-46ac-8b25-086cddbe0f16` from commit
`03f5dcfaecb7c9f2267e9036d6f03d6233f76648`. It is a compatibility and recovery
endpoint, not a second normal production release target. Existing alias users
can use the workspace switcher to move to the canonical custom domain. Do not blanket-redirect its routes:
session handoff uses origin-bound verifier storage and the source origin's
existing session. Retiring the alias requires a separate session-aware plan.

If First Form cannot be made active on the shared project, detach it there,
reattach it to `societyer-firstform`, restore its original CNAME and verify the
retained deployment. No Convex rollback or data restore is needed.

If reverting the shared frontend to a pre-consolidation DDC-specific build,
first move First Form back to its legacy project. Then roll back the DDC Pages
deployment. A hosting rollback must not alter workspace policies or reopen the
retired First Form database.

Keep the newer compatible backend during a frontend rollback. Once new
name-request fields have been saved, an older strict schema can reject those
documents; any backend rollback must preserve a schema compatible with live data.

See Cloudflare's [custom domain requirements](https://developers.cloudflare.com/pages/configuration/custom-domains/)
and [Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/).
