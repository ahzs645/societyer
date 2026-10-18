# SharePoint connection setup and lessons

Societyer uses a separate SharePoint site to keep application files in the
Microsoft tenant. Ordinary users receive no site membership; authenticated
Societyer requests enforce workspace and document permissions. Convex retains
metadata and checksums, while file contents persist only in SharePoint.

## Current tenant setup

Observed October 17, 2026:

| Resource | Value |
| --- | --- |
| Tenant | FirstForm |
| Tenant ID | `220c85f6-1cb1-4bb2-a63b-55d9fd163b55` |
| Verified business domain | `ddcnorth.com` |
| Runtime application | Societyer DDC North document storage |
| Application client ID | `86f5b7b2-324b-4cdf-8eea-f712fe423314` |
| Application object ID | `1d9f9723-b8e7-463b-aa4e-c2eb0c3c90a2` |
| Dedicated site | https://1stform.sharepoint.com/sites/societyer-storage |
| Site title | Societyer Application Storage |
| Site collection UUID | `c2524568-a968-455e-b3e8-e0a7b56f2993` |
| Web UUID | `2849bd8c-6758-41e6-9cca-e360bb6f11b3` |
| Documents drive ID | `b!aEVSwmipXkWz6OCntW8pk4y9SShYZ-ZBnMrjYLtvEbOAXi0d82J3SoVMznVGW8QH` |
| Template | Blank communication site, English, without a Microsoft 365 group |
| Human access shown by Site access | Ahmad Jalil: owner; members: none; visitors: none |
| Production Convex deployment | `industrious-cricket-610` |
| Runtime credential expiry | April 15, 2027; rotate before this date |
| Site grant role | `write` for runtime client `86f5b7b2-324b-4cdf-8eea-f712fe423314` |
| Site grant ID | `aTowaS50fG1zLnNwLmV4dHw4NmY1YjdiMi0zMjRiLTRjZGYtOGVlYS1mNzEyZmU0MjMzMTRAMjIwYzg1ZjYtMWNiMS00YmIyLWE2M2ItNTVkOWZkMTYzYjU1` |

The private site, runtime application consent, credential and selected-site
write grant are configured. The runtime app independently verified the exact
tenant/site/library and passed small-file and 5 MiB chunked upload/download checksum probes.
Additional qualification and production enablement are tracked below. Do not
treat mocked checks as proof of a live Microsoft connection.

## Create the private site

The SharePoint admin address repeatedly returned to authentication, although
the normal SharePoint session worked. The working path in this tenant was:

1. Open https://1stform.sharepoint.com/_layouts/15/sharepoint.aspx.
2. Choose **Build → Site → Communication site → Blank → Use template**.
3. Enter **Societyer Application Storage**, address `societyer-storage`, and a
   description explaining that application permissions govern document access.
4. Keep English; wait for both the site name and address availability checks.
5. Choose **Create site**, then **Go to site** once progress reaches 100%.
6. Open **Site access** and expand Owners, Members and Visitors. Confirm the
   intended administrator is the only owner, with no members or visitors.
7. Use the site's dedicated Documents library. Do not invite staff, attach a
   broadly populated Microsoft 365 group, or issue sharing links.

The existing DDC North site has normal group members, so its shared library
would not satisfy the direct-access isolation requirement. A separate empty
site avoids changing existing collaboration permissions.

Site access is an administrative inspection. A normal-user browser denial test
is still required before claiming that direct access has been independently
qualified. Global/SharePoint administrators can appoint site administrators;
this design does not exclude privileged tenant administrators.

## Register and authorize the application

In Entra, choose **App registrations → New registration**. Use the runtime name
above, single-tenant FirstForm only, and no redirect URI: this is a confidential
server application, not an interactive user sign-in application.

Under **API permissions → Add a permission → Microsoft Graph → Application
permissions**, search `Sites.Selected`, expand Sites and select that permission.
Remove the unused default delegated `User.Read` request before granting consent.
The runtime does not need tenant-wide `Sites.ReadWrite.All` or
`Sites.FullControl.All`.

Administrator consent makes the app eligible for selected-site access, but
grants no site access on its own. Use a separate administrative session to
resolve the exact site and drive IDs and create the explicit resource grant:

```http
GET https://graph.microsoft.com/v1.0/sites/1stform.sharepoint.com:/sites/societyer-storage?$select=id,webUrl
GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives?$select=id,name,webUrl
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [{
    "application": {
      "id": "86f5b7b2-324b-4cdf-8eea-f712fe423314",
      "displayName": "Societyer DDC North document storage"
    }
  }]
}
```

The administrative grant endpoint requires `Sites.FullControl.All`. Keep that
privilege in the provisioning session; do not add it to the runtime app.
If Microsoft Graph Explorer is used, review its delegated consent separately
and revoke temporary provisioning grants afterward. Record the resulting site
grant ID, application ID and role; verify no other site was granted.
[Selected permission model](https://learn.microsoft.com/en-us/graph/permissions-selected-overview),
[site permission endpoint](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0).

### Working provisioning path in this tenant

After Graph Explorer authentication failed, the operator approved a separate
single-tenant app, **Societyer one-time SharePoint provisioning - 2026-10-17**.
Its client ID was `df135b61-14de-4b8d-9e30-f7fe60937b6a`, registration object ID
`e9b3bc75-1fd2-4a0f-a87f-a1a93ab12a53`. Remove default delegated `User.Read`, add
Graph **application** `Sites.FullControl.All`, and grant admin consent through
the working Entra session. A custom secret expiry of October 18, 2026 limited
the credential to one day.

The operator script acquired an app-only Graph token without storing it, read
the exact storage site's identity and existing application permissions, and
created the single approved `write` grant only when absent. It checked the
returned app ID and role. It made no grants to other sites and did not add broad
permissions to the runtime app.

Immediately afterward, deleted the temporary client secret, used the API
permissions Graph context menu to **Revoke all admin consents**, and verified
`Sites.FullControl.All` showed **Not granted for FirstForm**. Deleted the temporary
app registration and verified it under **Deleted applications**. Deleted the
local secret staging file; no provisioning token or credential is retained.
Do not restore this temporary app for runtime use.

## Credentials and server configuration

This implementation uses Graph client credentials. Create a dedicated,
time-limited app secret, transfer it directly to the production Convex server
environment, record its expiry, and keep its value out of documentation,
screenshots, terminal output and `VITE_*` variables. Do not use an administrator
password. A certificate/federated credential is a future hardening option.

Configure these **Convex deployment** variables after resolving the approved
site and Documents library. The client ID is not a secret.

```dotenv
SOCIETYER_STORAGE_PROVIDER=sharepoint
SOCIETYER_DISABLE_NATIVE_FILE_STORAGE=1
SHAREPOINT_TENANT_ID=220c85f6-1cb1-4bb2-a63b-55d9fd163b55
SHAREPOINT_CLIENT_ID=86f5b7b2-324b-4cdf-8eea-f712fe423314
SHAREPOINT_CLIENT_SECRET=<server-only secret value>
SHAREPOINT_SITE_ID=1stform.sharepoint.com,c2524568-a968-455e-b3e8-e0a7b56f2993,2849bd8c-6758-41e6-9cca-e360bb6f11b3
SHAREPOINT_DRIVE_ID=b!aEVSwmipXkWz6OCntW8pk4y9SShYZ-ZBnMrjYLtvEbOAXi0d82J3SoVMznVGW8QH
SHAREPOINT_TRANSFER_HOSTS=<exact Microsoft transfer hostnames for this drive>
SHAREPOINT_MAX_FILE_BYTES=8388608
```

Transfer hosts must be exact names observed from Microsoft-issued upload and
download responses for this connection. Do not use a wildcard or silently trust
arbitrary redirect hosts. Uploads larger than 4 MiB use a Microsoft upload
session, which may have a different hostname from small-file downloads.

Keep `SITE_URL=https://societyer-ddcnorth.pages.dev` for the production broker.
For the frontend, select `VITE_DOCUMENT_STORAGE_PROVIDER=sharepoint` and retain
`VITE_DISABLE_NATIVE_FILE_STORAGE=1`. Only document-version upload surfaces are
enabled by that combination; Convex-native logos and meeting-blob uploads stay
disabled. The DDC North build selects this provider after the live transfer
checks described below; email readiness still gates end-user sign-up.

## Application data flow

`documentVersions.beginUpload` allocates an expiring handle bound to actor,
workspace, document, size and MIME metadata. The browser sends its Societyer
JWT and file bytes to `/document-storage/sharepoint/upload` on the exact Convex
HTTP origin. This endpoint checks membership and document-management access,
bounds the body, atomically claims the handle, and uploads a uniquely named item.
It reads the stored bytes back and verifies SHA-256 before marking the handle
verified. The final mutation takes provider/locator/checksum from that handle,
ignoring client-forged values, and atomically records the version.

Downloads resolve a document version through
`/document-storage/sharepoint/download?versionId=…`. Every new request checks the
current document ACL and verifies stored bytes against the recorded checksum.
Responses use `no-store`, attachment delivery and `nosniff`. Microsoft access
tokens and preauthenticated transfer URLs remain server-side. Fresh requests
are denied after membership revocation; an already completed download cannot
be revoked from the recipient's device.

The first broker buffers bounded files in temporary action memory, with an
8 MiB cap. It does not stream files of arbitrary size or persist bytes to Convex
`_storage`, disk or R2. A later streaming Worker could raise that cap, but would
need the same checks and checksum/version guarantees.
[Convex HTTP limits](https://docs.convex.dev/functions/http-actions).

Each application version has a new SharePoint item, so ordinary app uploads
cannot overwrite an earlier version. Out-of-band administrator edits fail
checksum verification. No end-user SharePoint deletion or sharing-link API is
exposed. SharePoint retention, independent backup, recycle-bin recovery and
restoring a prior version need separate organizational validation.

An interrupted transfer can leave a unique orphan item; the handle expires and
cannot be reused. Reconciliation is an operator task, not automatic permanent
deletion. Metadata commits recheck access after the transfer.

## Qualification

Fast tests:

```sh
npm run test:sharepoint-adapter
npm run test:sharepoint-connection
npm run test:document-upload-binding
npm run test:auth-token
npm run convex:typecheck
npx tsc --noEmit
```

For a live operator check, put connection variables in an ignored mode-0600
`.env.sharepoint-ddcnorth.local` file and run:

```sh
node --env-file=.env.sharepoint-ddcnorth.local --import tsx scripts/probe-sharepoint-connection.ts
node --env-file=.env.sharepoint-ddcnorth.local --import tsx scripts/probe-sharepoint-connection.ts --write-probe
node --env-file=.env.sharepoint-ddcnorth.local --import tsx scripts/probe-sharepoint-connection.ts --chunked-write-probe --check-unapproved-site
```

The first command reads tenant/site/library ownership. The second uploads a
uniquely named synthetic text file, downloads it and compares SHA-256. It prints
resource IDs and checksum, never tokens or secret values, and retains the
synthetic file for audit. The chunked option uses a 5 MiB synthetic binary, and
the negative check expects 403 from the unapproved DDC North collaboration site.
It prints transfer hostnames without their bearer URL paths or queries. It does
not edit existing documents or delete files.

Before rolling out to users, also check a normal staff account's direct-site
denial, the app's complete browser upload/download flow, historic-version
exports, credential rotation and recovery. Cross-workspace, actor, revocation,
origin and checksum denials pass against the real Convex handlers with mocked
Graph; this is separate from live Microsoft transfer qualification. Email
verification still needs a sender before a new Societyer account can run the
real browser flow.

### Live qualification results, October 17, 2026

The permanent runtime credential independently resolved the pinned site/drive
binding. A 62-byte text file and a 5,242,880-byte binary both passed upload,
download and SHA-256 comparison. The files are retained in the private Documents
library as synthetic audit artifacts:

| File | SHA-256 |
| --- | --- |
| `societyer-connection-probe-e52eba06-56de-4d8e-8fb9-fac081be219e.txt` | `bf5518b4d29185d774389c9db3e00770c34f28cb7f2e6a05b4c022b2e4ee9ea1` |
| `societyer-connection-probe-5d07ca6d-8dba-4d67-8aa0-db8423e5e192.bin` | `b1ff35b5c369875bcee4fa3dbe405bba756e3338b83706d7bc612a7d6ac746e5` |

The runtime app received **403** when requesting the existing unapproved
`/sites/ddcNorth` collaboration site. Microsoft-issued upload-session and file
download transfers used exactly **`1stform.sharepoint.com`**, now the configured
transfer allowlist. No additional hostnames or wildcards were needed.

The real upload-session response used `nextExpectedRanges: ["327680-5242879"]`,
where the earlier mock used an open end (`327680-`). Updated the adapter to
accept both forms while validating the next starting offset and any bounded
end against the file length. Added regression checks for backwards, shifted,
out-of-bounds and multiple ranges. Failed pre-fix sessions were cancelled;
the two completed synthetic files are the retained evidence.

## Meeting sources up to 500 MB: feasibility assessment

Requested October 17, 2026: attach existing transcripts, audio/video recordings,
and Whisper exports to a Societyer meeting, targeting a 500 MB original-file
limit. This is feasible with SharePoint upload sessions, but is **not implemented
by the current 8 MiB document-version broker**. Raising its environment limit
alone is not a supported upgrade.

### Current meeting behavior found in the code

- `src/pages/MeetingDetail.tsx` uploads audio/video through
  `files.generateUploadUrl` into Convex `_storage`. Its native-storage guard
  blocks that flow on DDC North; it does not use the SharePoint document broker.
- `MeetingTranscriptCard.tsx` imports VTT files or pasted notes. The VTT handler
  reads the entire file into text and sends it to one mutation. There is no
  general TXT/SRT/Whisper-package upload flow in this card.
- `convex/transcripts.ts` reads the complete recording into memory for the
  transcription provider. `transcripts` stores text plus all segments in one
  row, and text imports also copy it into `minutes.draftTranscript`.
- Convex database documents are limited to 1 MiB each. A 500 MB source cannot
  be represented as one transcript row, one mutation argument or one textarea.
- The existing transcription adapter defaults to `whisper-1` at OpenAI's file
  transcription endpoint, or a configured custom endpoint. OpenAI's documented
  input limit is 25 MB. A 500 MB stored recording therefore needs a separate
  compression/splitting pipeline; upload completion alone is not transcription.
- `documents.meetingId` and `meetingMaterials.documentId` already provide
  meeting/document relationships that can be reused for originals and access.

### Recommended design

Use one **Upload meeting source** flow with progress, cancellation and resume.
Define the proposed maximum explicitly as 500,000,000 bytes (500 MB); do not
silently mix it with MiB. Keep the current small-document limit independent.

| Source | Original in private SharePoint | Meeting behavior after upload |
| --- | --- | --- |
| TXT / VTT / SRT / supported JSON | Preserve original and checksum | Parse into bounded transcript pages with timestamps/speakers when provided |
| MP3 / M4A / WAV / MP4 / WebM | Preserve recording and checksum | Show recording attachment; queue real transcription when a provider is configured |
| Whisper export / ZIP | Preserve original archive and checksum | Inspect a supported manifest, extract transcript and optionally retain audio as another source; validate against a real export before claiming compatibility |

Keep Convex as the authorization and metadata service. Add an authenticated
Cloudflare Worker for the byte-transfer path, using the existing private
SharePoint library and selected-site runtime scope. Have the browser send
sequential 5 MiB slices to the broker; it forwards them into a server-held Graph
upload session. A 500 MB file takes 96 chunk requests. Do not buffer the complete
file in Convex, the Worker or the browser, or send a single 500 MB request through
Cloudflare. Stream authenticated downloads and support byte ranges for media.
Keep Microsoft credentials and transfer URLs server-side as in the current
broker. This design is a proposed implementation, not a deployed Worker.

Bind upload state to authenticated actor, society, meeting, original filename,
declared total size and expected next offset. Recheck permissions for each
resume/chunk/commit/download request. Allocate unique item names, reject
out-of-order or oversized chunks, verify the stored size and checksum before
attaching the completed original, and keep incomplete uploads out of the
meeting's ready sources. Preserve immutable source versions and meeting/document
ACLs; staff do not receive direct SharePoint site membership or sharing links.
Use bounded streaming checksum verification with a measured Worker CPU budget;
do not substitute a client-provided checksum for server verification.

Store parsed transcript text in indexed, paginated chunks instead of duplicating
the whole text in `transcripts` and `minutes`. Keep a source/reference, status and
bounded preview on the meeting. Draft minutes from bounded transcript sections,
preserving source offsets, and mark the result for human review.

Audio processing needs a background media processor/custom transcription service
capable of reading the stored original and producing valid provider-sized audio
segments. Arbitrary byte slicing of MP3/MP4 is not a valid media split. Existing
transcripts and Whisper packages containing usable transcripts can skip paid
speech recognition. Do not use the demo transcript fallback for real uploads.

Archive processing needs limits on expanded size, entry count and nesting;
reject path traversal and unsupported/encrypted packages, and stream selected
entries. A 500 MB archive may expand far beyond 500 MB. Do not expand the whole
archive in a Worker or render a huge transcript in one DOM node.

Before enabling this larger limit, qualify all three formats, a complete 500 MB
transfer, interrupted/resumed uploads, expiration, cancellation, size/range
forgery, revoked/cross-meeting access, checksum mismatch, large downloads/media
ranges and the final meeting attachment. Confirm supported Whisper layouts with
an actual export. The production 8 MiB limit stays in place until that work is
implemented and verified.

Sources checked October 17, 2026:
[SharePoint file limit](https://learn.microsoft.com/en-us/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits),
[Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0),
[Cloudflare request/memory limits](https://developers.cloudflare.com/workers/platform/limits/),
[Convex document/runtime limits](https://docs.convex.dev/production/state/limits),
[OpenAI longer audio inputs](https://developers.openai.com/api/docs/guides/speech-to-text#longer-inputs).

## What public examples taught us

The [PnP Graph upload example](https://pnp.github.io/script-samples/graph-upload-file-to-sharepoint/README.html?tabs=azure-cli)
demonstrates service-principal authentication and chunked upload sessions. Its
tenant-wide scope, overwrite behavior and lack of error handling are unsuitable
defaults here. Societyer uses selected-site access, unique items and bounded
error handling. This is a community sample, not a production guarantee.

The [PnP selected-site grant sample](https://pnp.github.io/script-samples/spo-grant-app-site-permission/README.html)
shows why consent and resource grants are separate. Older snippets use
`PnPAzureAD` command names. Current
[`Grant-PnPEntraIDAppSitePermission`](https://pnp.github.io/powershell/cmdlets/Grant-PnPEntraIDAppSitePermission.html)
requires delegated administrative permission and documents that the cmdlet
does not support app-only provisioning. The direct Graph grant endpoint has
different supported authentication modes; do not conflate them.

Graph client-secret authentication and direct SharePoint REST authentication
also differ. This code calls `graph.microsoft.com/v1.0`, where client
credentials support a secret or certificate. SharePoint CSOM/`_api` app-only
authentication requires certificates.
[Graph client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow),
[SharePoint app-only certificate guidance](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly-azuread).

Avoid legacy `appregnew.aspx`/`appinv.aspx` ACS setup instructions. Microsoft's
published SharePoint ACS retirement date was April 2, 2026.
[Retirement guidance](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly).

Ordinary Graph file operations are included with eligible Microsoft 365
licenses within usage limits. Broker compute, requests, read-back verification
and transfer bandwidth still count toward normal hosting usage. Existing
licensed SharePoint capacity is the intended storage pool; no overage service
is required for this setup.
[API cost model](https://learn.microsoft.com/en-us/graph/metered-api-overview).

## Setup record

### Graph Explorer authentication failure and recovery

The Graph Explorer base sign-in and profile consent completed. Incremental
`Sites.FullControl.All` authorization repeatedly stopped at a blank Microsoft
`/common/SAS/ProcessAuth` page after interactive sign-in. Refreshing that POST
page produced `AADSTS90014` (missing request context); restart authorization
from the application instead of refreshing it. This does not establish a bad
password or an invalid runtime credential.

A same-client device-code attempt returned error **530035**, which Microsoft
defines as `BlockedBySecurityDefaults`. The diagnostic correlation ID is
`8ed3505f-a06f-4027-8b4d-aa0be4a909dc`, UTC timestamp
`2026-10-17T20:20:20.031Z`. No provisioning access token or selected-site grant
was issued. Security Defaults were not changed.

Entra's Graph Explorer enterprise-app Permissions page showed no admin consent
and only `openid`, `profile`, `User.Read`, and `offline_access` under user consent;
`Sites.FullControl.All` had not been granted. Removed that temporary consent
through **My Apps → Graph Explorer → Manage your application → Revoke consent**.
The resulting page stated **This app does not have any permissions**.

Microsoft documents that Security Defaults block device-code authentication.
Use an approved interactive administrative authorization method or investigate
the interactive sign-in event in Entra; do not disable the tenant baseline to
make this setup work. A different provisioning client (for example Microsoft
Graph PowerShell with interactive browser authentication) would require its own
reviewed consent. Device authentication is not a suitable fallback here.
[Security Defaults](https://learn.microsoft.com/entra/fundamentals/security-defaults),
[error reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes),
[Graph PowerShell authentication](https://learn.microsoft.com/powershell/microsoftgraph/authentication-commands).

### Completed work and remaining qualification

- Created the blank communication site through the working normal SharePoint UI.
- Inspected its access panel: one administrator owner, no members or visitors.
- Observed the single-tenant runtime app registration in Entra.
- Read site collection/web UUIDs through the signed-in site's read-only REST
  endpoints, and Documents drive/tenant IDs through `/_api/v2.0/drive`.
  This used the operator's normal UI session, not a hidden session-token export.
  The runtime Graph app-only probe independently verified that binding.
- Granted administrator consent for Microsoft Graph application `Sites.Selected`;
  no delegated or tenant-wide runtime permissions remain.
- Created the approved 180-day production app credential and staged it, together
  with the pinned resource IDs, in the production Convex server environment.
  Its value is never included in this record. The local operator staging copy
  was ignored by Git, restricted to mode 0600 and removed after qualification;
  the approved runtime credential remains in production Convex.
- An app-only Graph resource probe authenticated successfully but received 403
  before the selected-site grant. This confirms consent alone does not confer
  access; it is not a successful connection qualification.
- Implemented and tested the authenticated version broker with mocked Graph.
- Deployed the broker to production Convex, initially with SharePoint unselected.
  The live download endpoint returns 401 for an unauthenticated request.
- Created the selected-site write grant with the separately approved one-time
  provisioning app; revoked its consent and credential and deleted its registration.
- Passed the live small-file and chunked transfer/hash probes and unapproved-site denial.
- Revoked the temporary Graph Explorer sign-in/profile consent after the
  provisioning authorization failed. No delegated provisioning token is retained.
- Activated the production SharePoint provider after the verified Graph transfer checks;
  end-user browser qualification still awaits email sender configuration.

### Meeting originals up to 500 MB

The separate meeting-source implementation now supports resumable large originals,
paged transcript extraction and a configurable background Whisper processor. The
8 MiB document-version limit above remains in force for that older broker. See
[meeting-source-storage.md](./meeting-source-storage.md) for the implemented flow,
new deployment flags, processor activation, tests and the current-version Graph
download restriction discovered through a live probe.
