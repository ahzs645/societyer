# Procurement review: Zoer → SharePoint → Societyer

This module reads published BC Bid Monitor snapshots. Collection, AI calls,
starring, pursuit edits and other writes remain in Zoer. Societyer provides
read-only views using the plugin's own bundled React 19 and Societyer-styled
controls; Societyer's React 18 is kept separate.

## Storage and credentials

Use a separate private SharePoint site for procurement. Do not give the Zoer
publisher access to the site containing meeting recordings and documents.

Register two single-tenant Entra applications with Microsoft Graph application
`Sites.Selected`, tenant consent, and an explicit resource grant on the
procurement site:

- **Zoer DDC North procurement publisher**: `write` on that site.
- **Societyer DDC North procurement reader**: `read` on that site.

Selected permission consent alone grants no site access. An administrator must
create the site grant separately. Microsoft's
[selected-permission guide](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
describes these two steps and the administrative permission needed to grant
access. Keep any temporary provisioning privilege separate from runtime apps.
Keep client secrets in protected operator configuration and production Convex;
never put them in a snapshot, source control, browser code or VITE variables.

Production Convex uses this dedicated reader configuration, independent of the
meeting-file `SHAREPOINT_*` writer:

```dotenv
PROCUREMENT_SHAREPOINT_TENANT_ID=<tenant UUID>
PROCUREMENT_SHAREPOINT_CLIENT_ID=<reader application UUID>
PROCUREMENT_SHAREPOINT_CLIENT_SECRET=<server secret>
PROCUREMENT_SHAREPOINT_SITE_ID=<approved procurement site ID>
PROCUREMENT_SHAREPOINT_DRIVE_ID=<approved library drive ID>
PROCUREMENT_SHAREPOINT_TRANSFER_HOSTS=1stform.sharepoint.com
```

All six settings are required before the deployment offers the module. Each
workspace must then enable **Procurement review** in module settings.

## Workspace isolation

Every workspace owns `Zoer/bc-bid-monitor/<workspace ID>`. Its settings editor
can select that folder or a folder inside it, and cannot claim an arbitrary
existing folder in the tenant. The server checks the binding again on reads.
General integration-settings updates cannot replace the procurement folder.

For **DDC North — live test workspace**, the publishing target is:

```text
Zoer/bc-bid-monitor/xd7g6bpdvp4p2bz1dr9h3mh3918ggdzf
```

Only active members with `documents:read` can read a snapshot, while the module
is enabled. The server exposes only the manifest, named catalog parts and
content-addressed document blobs. Paths cannot escape the workspace root.
Responses are private/no-store; the browser separately caches verified catalog
bytes by workspace and snapshot ID in IndexedDB.

## Build and install

```sh
# /Users/ahmadjalil/github/files
bun run societyer:build
# Societyer checkout
node --import tsx scripts/sync-procurement-review.ts --from /Users/ahmadjalil/github/files/dist/societyer-review
node --import tsx scripts/sync-procurement-review.ts --check
npm run build:ddcnorth
```

The sync pins bundle hashes. Build artifacts contain no procurement records.
The optional public demo snapshot is synthetic and is never used by hosted
workspaces.

## Publish the existing catalog

The selected source is the existing `bc-bid-monitor` catalog at
`https://zoer.k8s.overtheedgepaper.ca/#/plugins/bc-bid-monitor/home`.
The running Zoer backend stores it under:

```text
/data/plugin-catalogs/901fec2e4a5da081aa6b44ec6d3c300293e8886ccf61e4263f888aef05fdd9f8/
```

Run the publisher where that existing data directory is accessible. It makes
a consistent temporary SQLite copy; it does not stop or modify the live catalog.
Use the publisher's own `ZOER_SHAREPOINT_*` credentials, never the reader's.
The protected publisher configuration on this operator's Mac is
`~/.config/zoer/sharepoint-procurement.json` (mode `0600`). Keep it outside Git.
The first publish runs in the existing Zoer backend pod against `/data`; only
the publisher code is copied into its temporary directory, and credentials
are passed over standard input to that process. No new service is installed.

```sh
bun packages/plugin-site/bin/publish-sharepoint.ts \
  --data-dir /data --plugin-id bc-bid-monitor --plugin-version 0.35.3 \
  --folder Zoer/bc-bid-monitor/xd7g6bpdvp4p2bz1dr9h3mh3918ggdzf --dry-run
# Remove --dry-run only after the separate site, grants and credentials are ready.
```

Catalog and document parts are 7 MiB. The manifest is written last, after
verification; the previous snapshot stays readable if publishing fails.
The reader verifies each part and the assembled file before opening it.
The first pass accepts uncompressed catalogs up to 1 GiB and downloads
documents on demand; it does not promise unlimited browser memory or storage.
Publishing is an explicit command. This rollout does not schedule automatic
collection or publishing; rerun the publisher to expose a newer Zoer snapshot.

## Verification record, October 18, 2026

- Existing source inventory: 3,752 opportunities, 21,877 awards, 2,374 document
  records and 1,806 stored blobs (2,689,171,289 bytes), plus taxonomy/reference data.
- A dry run against that live catalog completed without uploading anything.
- The publisher's 17 tests and the plugin's 35 selected regression tests pass.
- Societyer checks cover folder ownership, denied cross-workspace/unclaimed
  folders, read-only SQL/bridge, corrupt parts, deployment/module gates and the
  authenticated blob route. The production build passes.
- The local synthetic demo exercises browser mounting and navigation. It is
  UI verification, not proof of a production SharePoint publish.

### Microsoft tenant configuration completed

- Private site: `https://1stform.sharepoint.com/sites/societyer-procurement`.
  External sharing is off; site members and visitors are empty. Ahmad is the
  administrator. Societyer membership does not grant direct SharePoint editing.
- Site ID: `1stform.sharepoint.com,7f49cb1f-65d6-4410-a2ee-5b10467fce21,2849bd8c-6758-41e6-9cca-e360bb6f11b3`.
- Library drive ID: `b!H8tJf9ZlEESi7lsQRn_OIYy9SShYZ-ZBnMrjYLtvEbOAXi0d82J3SoVMznVGW8QH`.
- Publisher client ID: `721a9a7d-0664-40c8-a295-bbeb8f429561`; reader client ID:
  `fce66fd5-24d1-4939-bf2b-0388f49b79e3`. Each has only Graph application
  `Sites.Selected`, with the respective write/read grant on this site.
- Both runtime credentials expire April 16, 2027. Rotate them before expiry.
  The initial unused publisher credential was revoked and replaced before use.
- Live credential checks: both runtime apps read procurement (`200`), both are
  denied the meeting-storage site (`403`), and the reader cannot create a folder
  (`403`). No test folder was created.
- The approved one-time provisioning app's tenant consent was revoked, its
  one-day credential deleted, and the app deleted after the two site grants.
- Plugin bundle provenance: clean commit `940f0e37155ceba807e8310ac41647c47c19cc38`.
  The market type check and 15 additional link/gating/deadline tests pass.

### Production deployment completed

- Societyer release commit: `ec0314cb`, on `codex/procurement-review`.
- Cloudflare Pages production deployment: `74b4977c` at
  `https://societyer-ddcnorth.pages.dev`; the root still leads to sign-in.
- Convex functions deployed to `industrious-cricket-610` with the six dedicated
  procurement reader settings. The meeting writer connection is separate.
- Procurement review is enabled only for the existing DDC North live test
  workspace and points to its own ID-derived folder. Existing module choices
  were preserved. The authorized folder query returns that exact path.
- Production endpoint checks: unsigned GET `401`, approved-origin OPTIONS
  `204`, unapproved-origin OPTIONS `403`.
- The deleted provisioner can no longer obtain a token (`unauthorized_client`).

### First real publish and readback completed

- Snapshot: `20261018T170258Z-1138c2082de4`, published from the existing live
  catalog without changing it. All 1,806 document blobs and 11 catalog parts
  uploaded; the manifest was written last.
- Catalog: 76,304,856 compressed bytes; 481,095,680 uncompressed bytes. The
  dedicated reader downloaded every catalog part, verified all part hashes and
  the complete catalog checksum, and recovered the expected record counts.
- The app's wa-sqlite reader opened this real published catalog under Node,
  returned an opportunity and the expected counts, and rejected a write query.
  This verifies the engine with real data; the local browser demo separately
  verifies the compiled plugin's mounting and navigation.
- The reader reconstructed and verified the 7,388,514-byte PDF
  `Park Management Plan - Ta chila Boya Lake Management Plan.pdf` from multiple
  SharePoint parts, including its final checksum and PDF header.
- Live transfer testing found that a valid 7 MiB part took 26.7 seconds. The
  previous 15-second transfer deadline aborted it; content downloads now allow
  120 seconds while retaining the 8 MiB byte cap and approved-host checks.
  The same server adapter then downloaded the part and verified its checksum.
  Graph metadata requests retain their shorter timeout.
- The production plugin JavaScript and CSS were downloaded and their hashes
  matched the clean pinned release artifact.
- No publisher service or container was added. Temporary publisher code in the
  existing Zoer pod was removed after the successful publish.

**Remaining manual check:** the live browser session is signed out. Sign in as
`Ahmad@ddcnorth.com`, open `/app/procurement-review/home`, and verify the loaded
catalog and a document in that authenticated session. The authenticated browser
flow has not yet been certified by this rollout; server, storage, engine and
artifact checks above are complete.
