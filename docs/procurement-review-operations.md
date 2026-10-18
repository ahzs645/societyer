# Operating procurement review

> Hosted architecture update, October 18: catalog records now live in Convex and load in small pages; files remain in SharePoint. See [the metadata publishing and migration runbook](procurement-convex-catalog.md). Snapshot download/plugin-bundle instructions below apply to the legacy snapshot/demo reader.

Use this guide for new operators and future releases. The dated
[setup and verification record](procurement-review-setup.md) contains the DDC
North resource IDs, credential expiry dates, deployed versions and test results.

## What lives in each repository

| Repository | Responsibility | When it needs an update |
| --- | --- | --- |
| [files](https://github.com/ahzs645/files) | BC Bid Monitor interface, Societyer controls, capabilities, self-contained plugin build and shared contract | Plugin UI or behavior changes |
| [zoer](https://github.com/ahzs645/zoer) | Collector and `packages/plugin-site` SharePoint snapshot publisher | Collection or publisher changes |
| [societyer](https://github.com/ahzs645/societyer) | Workspace permissions, SharePoint reader, browser catalog host and pinned plugin artifact | Host changes, or installing a new plugin build |

There are two independent release flows:

- **Update the interface:** build in `files`, copy and pin in Societyer, commit,
  then deploy Societyer to Cloudflare Pages. A Git push alone does not run this
  manual deployment workflow. Updating Zoer's installed plugin does not update
  Societyer's copy automatically.
- **Update the data:** run Zoer's publisher against its existing catalog. It
  writes SharePoint; no frontend build or Convex deployment is needed. Users
  click **Refresh** in Procurement review to load the new manifest.

The current integration is read-only in Societyer. Collection, edits and AI
execution happen in Zoer. No additional collector server or container is needed.

## Prerequisites and clean checkouts

Use Node, npm, Bun, Git, and operator access to the intended Convex project and
Cloudflare account. Tenant setup additionally requires an authorized Microsoft
administrator. Publisher execution needs access to the **existing** Zoer data
directory; a Mac directory named `/data` is not the cluster's mounted `/data`.

Keep the repositories beside each other:

```text
checkout-root/
  files/
  zoer/
  societyer/
```

The plugin build imports shared controls from `zoer/frontend`, so that checkout
and its dependencies are required even when only the plugin UI changed:

```sh
cd /path/to/checkout-root/zoer/frontend
bun install --frozen-lockfile
cd ../../files
npm ci
cd ../societyer
npm ci
```

Start each release from current `origin/main` in a clean checkout or worktree.
Inspect `git status --short` in all three repositories. Preserve unrelated work;
do not build or deploy a shared dirty checkout as a release. The original Mac's
main Societyer directory still contains separate meeting/AI work; the procurement
release was prepared in an isolated worktree. Pushing remote main does not
rewrite that directory's uncommitted files.

## Set up another tenant or deployment

1. Create a private SharePoint communication site for procurement, separate
   from meeting storage. Set external sharing off and do not add app end users
   to its Members or Visitors groups. Tenant administrators retain access.
2. Register two single-tenant Entra apps with no interactive redirect URI:
   a Zoer publisher and a Societyer reader. Remove the unused default
   `User.Read` permission. Add Microsoft Graph **application** `Sites.Selected`
   and grant administrator consent to each. Create credentials with an explicit
   expiry and record their custodian and rotation date privately.
3. Assign resource permissions on the procurement site: publisher `write`,
   reader `read`. Consent and site assignment are separate steps; Microsoft's
   [Selected permissions guide](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
   explains the boundary. Get the site ID and Documents drive ID through Graph:

   ```http
   GET https://graph.microsoft.com/v1.0/sites/{tenant-host}:/sites/{site-name}
   GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives?$select=id,name
   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   Content-Type: application/json

   {
     "roles": ["write"],
     "grantedToIdentities": [{
       "application": { "id": "<publisher-client-id>", "displayName": "Zoer procurement publisher" }
     }]
   }
   ```

   Repeat the POST for the reader client ID with `"roles": ["read"]`.
   Use a separately approved provisioning identity with the permission needed
   to assign site grants. Never add `Sites.FullControl.All` to a runtime app.
   If a temporary provisioning app was used, revoke its consent, delete its
   credential and registration, and verify it cannot obtain a token afterward.
4. Put the reader's six `PROCUREMENT_SHAREPOINT_*` settings from the
   [setup guide](procurement-review-setup.md#storage-and-credentials) on the
   intended Convex deployment. For a protected dotenv file containing those six
   values, use:

   ```sh
   npx convex env set --from-file /secure/procurement-reader.env --deployment "<deployment-name>"
   ```

   Keep that file outside the checkout with mode `0600`; never use `VITE_*`
   variables for credentials. The separate meeting `SHAREPOINT_*` writer
   connection does not enable procurement. Do not overwrite it.
5. Store publisher credentials privately on the machine that runs publishing.
   See [Zoer's publisher guide](https://github.com/ahzs645/zoer/blob/main/packages/plugin-site/README.md#publish-to-sharepoint-societyer-review)
   and its [existing-cluster procedure](https://github.com/ahzs645/zoer/blob/main/docs/societyer-sharepoint-publishing.md).
6. Deploy the host and plugin using the release procedure below. Qualify the
   connections: both runtime apps can read procurement, both are denied meeting
   storage, and the reader is denied writes. An unsigned Societyer blob request
   must return `401`; an unapproved Origin must be denied.

Existing DDC North resources should be reused, not recreated. Runtime credentials
currently expire **April 16, 2027**. Resource IDs are in the setup record; secret
values are not. Publisher configuration is at
`~/.config/zoer/sharepoint-procurement.json` on the original operator's Mac;
the reader secret is in production Convex.

## Add another workspace

1. Create or select the workspace through Societyer and record its actual
   workspace ID. Do not use its display name or invent an ID.
2. An authorized workspace administrator enables **Procurement review** in
   workspace module settings. It defaults off. Deployment-level availability
   requires the separate reader connection to be configured.
3. Open Procurement review and its folder settings. Save
   `Zoer/bc-bid-monitor/<workspace-id>` (or a child folder under that prefix).
   The server refuses another workspace's prefix or an arbitrary tenant folder.
4. Publish the intended catalog to that exact folder. The publisher creates
   missing folders inside the approved library. Each target contains its own
   manifest, catalog parts and document blobs. Publishing the same data to two
   workspace folders duplicates those files across the two targets.
5. Sign in as an active workspace member with `documents:read`; open Home,
   Opportunities and a document. Check that editing and collection controls are
   absent. A different workspace must not read that folder through Societyer.

No new Entra app or site-wide grant is needed for another workspace using the
same approved procurement site and deployment. Folder isolation is enforced by
Societyer, while the runtime Graph grants are scoped to the procurement site.

## Release a new plugin interface to the live site

1. Make the plugin change in `files`. Follow the
   [shared contract](https://github.com/ahzs645/files/blob/main/zoer/docs/societyer-review-contract.md).
   Run the market type check and relevant plugin regressions. Commit and merge
   reviewed source to main before creating the release bundle so `source.json`
   records a clean, identifiable source commit:

   ```sh
   cd /path/to/checkout-root/files
   bun run zoer:typecheck:market
   npx vitest run tests/zoer-host-capabilities.test.ts tests/zoer-review-links.test.ts tests/zoer-review-gating.test.tsx
   # Commit/merge the intended source changes, then:
   bun run societyer:build
   ```

2. In the clean Societyer release checkout, copy the complete build and generate
   its pin together. This is the actual **install/update step**:

   ```sh
   cd /path/to/checkout-root/societyer
   node --import tsx scripts/sync-procurement-review.ts --from ../files/dist/societyer-review
   npm run test:procurement-review
   npm run build:ddcnorth
   ```

   Review and commit all four generated files as one release:

   ```text
   public/plugins/bc-bid-monitor/index.js
   public/plugins/bc-bid-monitor/style.css
   public/plugins/bc-bid-monitor/source.json
   src/features/procurementReview/lib/artifactPin.ts
   ```

   The sync verifies hashes, and the browser checks the deployed files against
   the pin. Do not edit or replace only `index.js`, mix files from two builds,
   or point the live app at an unpinned latest bundle. Hash-versioned URLs avoid
   reusing an older script or stylesheet from cache.
3. Merge/push the Societyer release to main. If it includes backend or shared
   server changes, deploy Convex **before** the frontend. Use an operator env
   file selecting the existing DDC North project and verify the displayed
   destination is `industrious-cricket-610`:

   ```sh
   npx convex deploy --env-file /secure/ddcnorth-convex.env
   ```

   Do not copy self-hosted URLs or admin keys from `.env.local.example` for this
   hosted deployment. A plugin-only UI update needs no Convex redeployment.
4. Authenticate Wrangler to **Ahzs645@gmail.com's Account**, account ID
   `479e77f49d4ac5d7498529ee360f194b`. From the same clean, committed checkout,
   deploy the already tested production build:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b npx wrangler pages deploy dist --project-name societyer-ddcnorth --branch main --commit-dirty=false
   ```

   `.env.ddcnorth` is the tracked public build profile. It selects the production
   Convex URLs and `VITE_APP_ONLY=1`. `npm run deploy:ddcnorth` is an existing
   build-and-deploy shortcut, but it permits dirty builds; prefer the explicit
   command above for a reviewed release. Pushing a branch is not a substitute
   for confirming the Cloudflare deployment completed.
5. Verify live `/plugins/bc-bid-monitor/source.json` records the intended source
   commit and hashes. Sign in, open `/app/procurement-review/home`, navigate
   between views, search/filter, open a PDF, and check read-only controls.
   Reload the page after deployment; an already mounted module keeps its old
   code until reload. Record the Pages deployment ID, source/pin commits and
   signed-in test result. Do not mark browser verification passed just because
   the bundle built or storage tests passed.

Documentation-only commits do not need another plugin build, data publish or
runtime deployment. Deploying Societyer's plugin artifact does not upgrade the
collector's installed Zoer plugin; follow Zoer's normal plugin release flow if
that copy also needs the change.

## Refresh procurement records and documents

Use the existing collector's DATA_DIR and the publisher app's credentials, never
the reader secret. The [Zoer procedure](https://github.com/ahzs645/zoer/blob/main/docs/societyer-sharepoint-publishing.md)
covers local and existing Kubernetes-backed data. Run `--dry-run` first to
validate the source and upload plan; it deliberately makes no API calls and
does **not** qualify credentials. Remove `--dry-run` for the real publish.

Wait for a zero exit code and `wrote manifest.json`. For the hosted site, next
run the [verified metadata export, Convex import and activation](procurement-convex-catalog.md#publishing-a-future-data-update). SharePoint publication alone no longer updates hosted records.
For the snapshot/demo reader, click **Refresh** and check the published time and record counts. The publisher keeps
the current and previous catalog snapshot; content-addressed document blobs are
reused within a target folder. It never changes the live collector catalog.
No schedule was installed in the DDC North rollout.

## Rotate credentials and recover a release

- **Rotation:** create a replacement credential on the same runtime app; keep
  its existing `Sites.Selected` and site grant. Update the protected publisher
  configuration or the reader secret on the correct Convex deployment. Test a
  real Graph read/publish and an authenticated Societyer read, then revoke the
  superseded credential. Record the new expiry. A secret-only rotation needs no
  plugin rebuild or Pages deployment. Never log a secret or paste it into chat.
- **Plugin rollback:** restore the three artifact files **and** `artifactPin.ts`
  from one known-good Societyer commit, commit the rollback, rebuild and redeploy
  Pages. A Pages rollback is also possible when that deployment's backend
  contract remains compatible. Do not roll back unrelated backend features.
- **Data rollback:** use the retained previous catalog snapshot only with its
  matching recorded manifest; do not combine a new manifest with old parts.
  Keep a private copy of the last good manifest when qualifying a new publish.
  Alternatively republish a known-good collector snapshot using the normal
  publisher. There is no one-click data rollback UI in Societyer.
- **Diagnosis:** unavailable module → check dedicated reader settings and module
  enablement; `401` → sign in; `403` → membership, document permission, module or
  site grant; `404`/unpublished → confirm the exact workspace folder and successful
  manifest write; `502` → check the reader credential, host allowlist and Graph
  access; integrity failure → compare all artifact pins or snapshot checksums.
  Retest the failed layer before reporting recovery.

The October 18 rollout qualified storage, permissions, the real catalog engine,
PDF reconstruction and deployed artifact hashes. Its signed-in browser check
remains pending; this guide preserves that distinction.
