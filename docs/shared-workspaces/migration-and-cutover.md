# Shared workspaces: migration and production cutover (Stages 3–4)

This page adapts Stages 3 and 4 of the
[review](../audits/2026-11-08-shared-workspaces-review.md#6-migration-and-testing-sequence)
to what now exists. Do it only after staging passes
([staging-setup.md](staging-setup.md), [acceptance-tests.md](acceptance-tests.md)).
Operator commands are in the [runbook](operator-runbook.md).

## What this change does and doesn't provide

Provided:

- Per-workspace sign-in policy, domains, storage policy and invoice defaults.
- Linked logins and the cross-domain handoff.
- Operator tools to provision accounts and links on the destination.
- **Workspace transfer** ([below](#workspace-transfer)): copies one
  organization's workspace from a source deployment's export into a destination
  that already holds other workspaces. It inserts rows with new IDs, rewrites
  every typed and string-held reference, copies native files with checksums,
  resumes after an interruption, proves counts, references, files and totals,
  and can be aborted before it is opened. It never replaces or edits the
  destination's other rows.

Not provided:

- Better Auth users, accounts, password hashes and sessions are not carried
  across. Each person gets a login on the destination and the operator binds
  their imported membership to it explicitly ([identity](#5-identity-reconciliation)).
- Vault secrets are not carried across (their ciphertext is sealed with the
  source's `SECRET_VAULT_ENCRYPTION_KEY`). They are copied as records that say
  *Needs review*; re-enter them.
- Files in SharePoint, RustFS or R2 are not copied; their locators are kept.
- No undo after `finalize`. Before it, `abort` removes everything the run wrote.

Starting First Form fresh on the shared deployment remains possible (create the
workspace, re-provision accounts, re-enter what First Form needs), but the
transfer keeps its records, history and files.

## Choose the destination deployment

This is your decision. Make it after the inventory below.

| Option | For | Against |
| --- | --- | --- |
| **DDC production** (`industrious-cricket-610`) | Keeps the Convex site URL that Entra's redirect URI, the meeting-transfer Worker, the staff admin and the SharePoint and mail settings already use. DDC members keep their sessions and logins. | First Form's records, files and logins must move in. Every First Form password must be reset. DDC's deployment-wide flags have to change (required SSO, email domains, native storage ceiling). |
| **First Form production** (`elated-bee-460`) | First Form keeps its logins and data. | DDC moves in: new Entra redirect URI, Entra and SharePoint secrets, mail credentials, Worker and staff admin repointed, all DDC sessions end. More connections change. |
| **A new deployment** | Clean start, both sides rehearsed the same way | Everything moves for both. Most work. |

That keeping DDC production reduces connection changes is a **hypothesis** from
the review. Check it against the inventory: count the clients and secrets that
change under each option.

Whichever you choose, the destination's deployment-wide settings must follow
[runbook step 3](operator-runbook.md#3-deployment-wide-sign-in-settings-on-a-shared-deployment).

## Stage 3: rehearse

### 1. Inventory

For each source deployment, record:

```sh
SRC=elated-bee-460          # then industrious-cricket-610
npx convex data --deployment "$SRC"                          # tables
npx convex data --component betterAuth --deployment "$SRC"   # auth tables
npx convex run --inline-query 'return (await ctx.db.query("societies").collect()).map((s) => ({ id: s._id, name: s.name }))' --deployment "$SRC"
npx convex env list --names-only --deployment "$SRC"
```

Count rows per table and per workspace. For example, for one table:

```sh
npx convex run --inline-query 'const rows = await ctx.db.query("documents").collect(); const counts = {}; for (const r of rows) counts[r.societyId] = (counts[r.societyId] ?? 0) + 1; return counts' --deployment "$SRC"
```

`.collect()` reads a whole table, so on large tables do this in pages or from
the export.

Also list:

- memberships (`users`), external identities and Better Auth users;
- native files (`_storage`) and external file references (SharePoint item IDs,
  RustFS or R2 keys, Paperless IDs);
- provider connections and their secrets;
- scheduled workflows and their grants;
- AI connector grants (`agentGrants`), API clients and tokens (`apiClients`,
  `apiTokens`);
- pending invitations;
- dependent clients: Pages projects, the meeting-transfer Worker
  (`wrangler.meeting-transfer.jsonc`), the DDC staff admin at
  `https://ddcnorth.com/admin`, the Entra redirect URI, mail senders, AI
  connector clients.

### 2. Backups

Take a full export of each source, including file storage, before anything
else, and again at the final cutover:

```sh
mkdir -p ~/societyer-backups
npx convex export --include-file-storage --deployment industrious-cricket-610 --path ~/societyer-backups/ddc-$(date +%Y%m%d%H%M).zip
npx convex export --include-file-storage --deployment elated-bee-460 --path ~/societyer-backups/firstform-$(date +%Y%m%d%H%M).zip
```

Check each ZIP: open it, confirm a folder per table, a `_storage` folder, and
the Better Auth component's tables. If the component data isn't in the ZIP,
export it separately before going further. These files contain password hashes,
sessions and private records. Keep them encrypted and outside the repository.

Files in SharePoint, RustFS or R2 are not in a Convex export. Back those up
with their own tools, or confirm their retention.

### 3. Why `convex import --replace` is not a merge

`npx convex import --replace` deletes every existing row in each table the
snapshot contains, then writes the snapshot's rows. Run against the destination,
it would delete the other organization's rows in every shared table (`societies`,
`users`, `documents`, and so on). `--replace-all` also clears tables missing from
the snapshot. `--append` adds rows but keeps the source IDs. Those IDs can
collide, and nothing rewrites the references between rows.

A full snapshot import is only useful into an **empty** rehearsal deployment, to
get a working copy of one source.

### 4. Rehearsal with the workspace transfer

Use a rehearsal deployment that runs the release commit and holds a copy of the
destination (an export of the destination imported into an **empty** deployment;
see step 3). Run the whole [workspace transfer](#workspace-transfer) from `plan`
to `bind`, sign in as a moved person and as a destination person, and keep the
`plan.json` and `verify.json` reports and the timings. `abort` before `finalize`
and repeat as often as you need; after a `finalize`, recreate the rehearsal
deployment instead.

The transfer itself never copies operational credentials, invitations, AI
connector grants, webhook secrets or workflow schedule grants. Reissue them
after cutover.

### 5. Identity reconciliation

Never match people by email. The transfer doesn't.

- Imported memberships (`users` rows) keep their role, status, profile and every
  record that points at them, but arrive **unbound**: `authIssuer`, `authSubject`,
  `authProvider`, `externalIdentityId`, `emailVerifiedAtISO` and `lastLoginAtISO`
  are removed (the same rule as restoring a workspace archive). Nobody can open
  the workspace through them until the operator binds them.
- Better Auth users on the source deployment are bound to the source's issuer
  (its Convex site URL) and secret, so the destination can't accept them, and
  their password hashes and sessions are credentials, not records. The Better
  Auth component tables are therefore **not** copied. Each person who moves gets
  a login on the destination, and the operator binds their imported membership
  to exactly that login with `bind` ([below](#7-bind-memberships)).
- Bind only with explicit operator evidence of who is who (the `reason` column
  records it in the workspace's activity log).
- A person who will belong to both organizations can have the moved membership
  bound to their existing destination login, or get a second login and link the
  two themselves after cutover ([user guide](user-guide.md#link-an-existing-account)).
- `bind` refuses a second membership in one workspace for the same login or for
  any login linked to it, so overlap can't happen silently.

### 6. Dependent clients to repoint

Only for clients whose backend changes:

| Client | What changes |
| --- | --- |
| First Form Pages build (`.env.firstform`) | `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` |
| DDC Pages build (`.env.ddcnorth`) | `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` if DDC moves. Remove the two storage ceiling lines ([runbook](operator-runbook.md#ceilings-that-must-go-on-a-shared-deployment)). |
| Meeting-transfer Worker | `CONVEX_SITE_URL` and `SITE_ORIGIN` in `wrangler.meeting-transfer.jsonc`, and the `MEETING_SOURCE_BROKER_KEY` secret on both the Worker and the destination. Redeploy with `npm run deploy:meeting-transfer:ddcnorth`. |
| DDC staff admin (`https://ddcnorth.com/admin`) | Its Convex URL and token issuer, if DDC moves |
| Entra registration **Societyer DDC North portal sign-in** | Add `https://<destination>.convex.site/api/auth/callback/microsoft` as a redirect URI if the Convex site URL changes. Remove the old one after cutover. |
| Mail sender, SharePoint, RustFS or R2 | Their server variables on the destination |
| AI connector clients | Reconnect against the destination; old grants don't move |

## Workspace transfer

`npm run transfer:workspace` (`scripts/workspace-transfer.ts`) moves **one**
workspace (one `societies` row and everything that belongs to it) from a source
deployment's export ZIP into a destination that already holds other workspaces.
It only ever inserts the workspace's own rows and files and then patches those
same rows; it never replaces, edits or deletes the destination's other data.

It reads the source only from its export, so it never needs the source's keys.
It writes to the destination only through the internal `workspaceTransfer:*`
functions, called with an admin key the same way `npx convex run` does
(`ConvexHttpClient.setAdminAuth`). None of them is public.

### What is copied, disabled and skipped

The reviewed per-table policy is
[`shared/workspaceTransfer/policy.ts`](../../shared/workspaceTransfer/policy.ts).
Every schema table must be listed (`npm run test:workspace-transfer` fails
otherwise), and `plan` refuses a table that isn't. At the release commit: 289
`copy`, 4 `copy-disabled`, 43 `skip`. Access-request settings are copied (they
only take effect once the operator maps a domain); pending access requests are
skipped because they name the source deployment's login identities.

| Policy | Tables | Why |
| --- | --- | --- |
| `copy` | Every workspace record: members, directors, meetings, minutes, agendas, documents and versions, filings, finance, payroll, invoices, grants, procurement and so on | Copied with new IDs; every reference rewritten |
| `copy`, with changes | `societies` (no `calendarFeedToken`; public slug held back until `finalize`), `users` (login bindings removed), `secretVaultItems` (ciphertext and preview removed, status *NeedsReview*), `aiProviderSettings` (status *needs_validation*), `meetingSources` (upload-session URL and worker lease removed), `billingAutomationRuns` (lease removed) | Bearer secrets and source-bound credentials don't move |
| `copy-disabled` | `workflows` (`scheduleEnabled: false`, schedule grant and next run removed, as in archive restore), `billingAutomationSchedules` (`active: false`), `billingAutomationSettings` (`enabled` and `senderConfirmed` false), `meetingTranscriptionConnections` (`enabled: false`, worker key hash revoked) | Nothing acts on its own until someone re-enables it on the destination |
| `skip` | Logins and links (`externalIdentities`, `personAccounts`, `personIdentityLinks`, `accountLinkRequests`, `accountLinkEvents`, `clerkMfaSessions`), credentials (`apiClients`, `apiTokens`, `agentGrants`, `agentConnectorSettings`, `mcpOAuth*`, `partyPortals`, `webhookSubscriptions`), pending `invitations`, queues and cursors (`webhookDeliveries`, `integrationSyncStates`, `pluginInstallations`, `authEmailOutbox`, `documentUploadHandles`), per-deployment configuration (`workspaceDomains`, `workspaceSignInPolicies`, `workspaceStoragePolicies`), offline projections (`offlineMeetingDownloads`, `offlineMeetingScopes`, `offlineMeetingReceipts`, `powersync_checkpoints`), caches (`aiModelCatalogCache`, `waveCache*`), `storageOwnership` (regenerated), global `jurisdictionMetadata`, `supportLogs`, `authRateLimits`, `developmentAuthEmails`, `procurementMaintenanceLeases`, and the transfer's own tables | Set these up again on the destination with their own commands |

`workspaceMfaPolicies` is copied so an MFA requirement can't silently disappear.
Rows that can't be moved safely while they're running block the plan:
billing-automation runs that are queued, retrying, blocked, working or accepted
but not finalized; filing submissions that are queued or dispatching; procurement
imports and syncs that aren't finished. Finish or cancel them at the source
before the final export.

Which rows belong to the workspace: every row whose `societyId` is the workspace,
then everything they reference by typed ID, and child rows without a `societyId`
that point into it (`meetingSourceText`, `notificationPrefs`,
`procurementSyncBatches`). A row without a workspace in a table that has an
optional `societyId` (for example a legacy `peopleDirectory` row) is *adopted*:
copied with the new workspace's ID. **Blocking**: any reference to a row of
another workspace, a required reference to a skipped or missing row, a child row
also used outside the workspace, a row that doesn't match this release's schema,
a file another workspace claims, or a missing file. **Warnings**: optional
references to skipped or missing rows (dropped), and strings that hold the ID of
a row that isn't moving (left unchanged).

### 1. Before you start

- The source export, this CLI checkout and the destination must be the **same
  release**. `apply` compares a digest of every table validator with the
  destination's and refuses a mismatch; `plan` refuses rows that don't match the
  schema.
- Destination admin key: a deploy key from the destination's dashboard
  (Settings → Deploy keys; a deploy key is an admin key). Put it in an
  environment variable and pass the variable's **name**. The CLI never prints it.
  Delete the key when the transfer is done.
- Run on a machine with enough memory for the workspace's rows (a few times
  their JSON size) and its largest file.

```sh
read -rs DEST_ADMIN_KEY && export DEST_ADMIN_KEY      # paste the key; not echoed
DEST=https://industrious-cricket-610.convex.cloud     # the destination's Convex URL
ZIP=~/societyer-backups/firstform-final.zip
SRC_SOCIETY=<the source societies _id, from the inventory>
RUN=firstform-2026-11                                  # a new label per attempt
```

### 2. Export the source

After the write freeze:

```sh
npx convex export --include-file-storage --deployment elated-bee-460 --path "$ZIP"
```

The ZIP layout the tool reads (the Convex backend builds it; the CLI downloads
it): `<table>/documents.jsonl` (one document per line) and
`<table>/generated_schema.jsonl` for each table, `_storage/documents.jsonl`
(file metadata with a base64 SHA-256) plus `_storage/<id>[.<ext>]` (bytes),
`_components/<component>/…` (Better Auth; reported, not copied) and `README.md`.
Anything else is a blocking finding. ZIP64 archives are supported; entries are
streamed and each one's CRC-32 is checked.

### 3. Plan (offline)

```sh
npm run transfer:workspace -- plan --export "$ZIP" --society "$SRC_SOCIETY" --out plan.json
```

It prints the workspace, row and file counts, insert layers and every finding,
and exits 1 while anything blocks. `plan.json` also has per-table counts
(copied, excluded, adopted), string-held ID rewrites per field, files kept in
external stores, and financial totals (invoices and bills by currency, journal
lines by side, bank transactions). Fix blocking findings at the source and
export again.

### 4. Apply

```sh
npm run transfer:workspace -- apply --export "$ZIP" --society "$SRC_SOCIETY" \
  --url "$DEST" --admin-key-env DEST_ADMIN_KEY --run "$RUN" --source elated-bee-460 --note "First Form cutover"
```

1. Re-plans and stops on blocking findings.
2. Starts (or resumes) run `$RUN`. A label is bound to one export and plan; a
   second live run for the same source workspace is refused.
3. Creates the workspace **quarantined** (`societies.transferQuarantinedAtISO`).
   Nobody can be bound to it, the alert, digest, retention and attestation jobs
   and the workflow scheduler skip it, and its public slug is held back.
4. Uploads each file through an upload URL; the destination checks its own
   SHA-256 and size against the export, claims the file for the workspace and
   records the mapping (a mismatched upload is deleted).
5. Pass 1 inserts rows in dependency order of their required references, with
   optional references left out. Each row's mapping is written in the same
   transaction as the row, so a repeated batch is skipped instead of inserted
   twice.
6. Pass 2 replaces every row with its final document: all typed references
   (required, optional, nested, in arrays and records) and every string-held ID
   of a moved row (also inside longer strings and JSON) point at the new IDs.

Writes go in batches of at most 100 rows and 512 KiB. Every destination write
re-applies the table policy and refuses a row whose `societyId` or any
reference points outside the rows this run wrote.

If it stops for any reason, run the same command again. It reloads the run's ID
map and continues.

### 5. Verify

```sh
npm run transfer:workspace -- verify --export "$ZIP" --society "$SRC_SOCIETY" \
  --url "$DEST" --admin-key-env DEST_ADMIN_KEY --run "$RUN" --out verify.json
```

- On the destination: every row and file the run wrote exists, belongs to the
  workspace, and every typed reference resolves to a row this run wrote; each
  file is claimed by the workspace alone; the workspace is still quarantined.
- In the CLI: every row equals what the export and ID map say it should be
  (field by field); per-table counts equal the plan; each file's SHA-256 and
  size equal the export; no other row on the destination carries the
  workspace's ID (through each table's `societyId` index); financial totals
  equal the export's.

The result is recorded on the run. Any later write to the run clears it.

### 6. Finalize

```sh
npm run transfer:workspace -- finalize --url "$DEST" --admin-key-env DEST_ADMIN_KEY --run "$RUN"
```

Requires a passing verify, clears the quarantine and restores the public slug.
If another workspace already uses the slug, it refuses; add
`--drop-public-slug` and pick a new slug in the workspace settings later.

### 7. Bind memberships

Binding is allowed only after `finalize`, so nobody can open a half-copied
workspace. Each line of the CSV names one imported membership (its **source**
`users` ID, or its email when that is unique in the workspace), and the exact
destination login it belongs to:

```csv
sourceUserId,authIssuer,authSubject,reason
jx7abc…,https://industrious-cricket-610.convex.site,k57def…,Sam confirmed by phone 2026-11-20
sam@firstform.ca,https://industrious-cricket-610.convex.site,k57ghi…,
```

```sh
npm run transfer:workspace -- bind --url "$DEST" --admin-key-env DEST_ADMIN_KEY --run "$RUN" \
  --mapping bind.csv --reason "Confirmed against the First Form roster"
```

`authIssuer` must be the destination's `CONVEX_SITE_URL`; `authSubject` is the
Better Auth user ID. `bind` keeps the membership's role and status (a Disabled
membership stays Disabled), creates or reuses the login's external identity,
and logs the reason in the workspace's activity. It refuses a row that isn't
part of this run or is already bound, and a login that already has a membership
in the workspace directly or through a linked login. One call per person is
`workspaceTransfer:bindMembership({ runId, userId, authIssuer, authSubject, reason })`
with the destination `users` ID.

How each organization gets its logins:

- **First Form (passwords).** For each person, create a login and send the
  private setup link:
  `npx convex run hostedAuth:provisionAccount '{"email":"sam@firstform.ca","name":"Sam","societyId":"<destination workspace id>"}' --deployment industrious-cricket-610`.
  Find the new login's ID with
  `npx convex data user --component betterAuth --format jsonl --limit 10000 --deployment industrious-cricket-610`
  (match the address you just provisioned yourself), then bind. Alternatively,
  bind the Owner, and let them invite the rest from **Users**: an invitation to
  an existing unbound member (`invitations:create` with `targetUserId`) binds
  that row when the person accepts with a verified email.
- **DDC North (Microsoft).** If DDC is the destination, nothing moves. If DDC is
  the workspace being transferred, provision and bind in one step:
  `npx convex run entraProvisioning:registerDirectoryMember '{"societyId":"<destination workspace id>","objectId":"<Entra object ID>","email":"dee@ddcnorth.ca","name":"Dee","transferredMembership":{"runId":"<run id>","userId":"<destination users id>","reason":"…"}}'`.
  It creates (or reuses) the Microsoft login and binds the imported membership
  instead of adding a Viewer. Without `transferredMembership` it refuses a
  quarantined workspace.
- **Someone in both.** Bind the moved membership to the login they already have
  on the destination, or give them a new login and let them link the two.

`status` prints the run, including how many memberships are bound. Unbound
memberships stay as they are; their history is kept and nobody can use them.

### 8. After the transfer

Re-create what was skipped: domains, sign-in and storage policies
([runbook](operator-runbook.md)), API tokens, AI connector grants, webhooks,
integrations and invitations. Re-enter vault secrets. Re-enable workflow
schedules, billing automation (confirm the sender first) and transcription
workers deliberately.

### Abort and rollback

```sh
npm run transfer:workspace -- abort --url "$DEST" --admin-key-env DEST_ADMIN_KEY --run "$RUN"
```

Before `finalize`, this deletes everything the run wrote, found through its ID
map (rows, files and their claims, and the workspace last), in pages, and marks
the run aborted. It never deletes a row of another workspace. Start again with a
new label. After `finalize` it refuses: members may already have written, so
use the [rollback](#rollback) below instead.

### Limits

- One workspace per run, into a fresh quarantined workspace. Merging into an
  existing workspace is not supported.
- `_creationTime` is new on the destination; dates stored in fields are kept.
- The CLI keeps the moved workspace's rows in memory and reads each file whole
  before uploading it. Destination pages are bounded at 100–200 rows and about
  4 MB read per call.
- Values plain JSON can't carry (int64, bytes, special floats) are refused
  rather than guessed (the schema uses none today).
- String-held IDs are rewritten by token: any part of a string equal to the ID
  of a moved row. IDs of rows that don't move stay as they are and are listed in
  the plan.
- Files in SharePoint, RustFS or R2 keep their locators; the destination must
  reach the same store.

## Stage 4: cutover checklist

Before the window:

- [ ] Staging passed every journey in [staging-setup.md](staging-setup.md) from
      the release commit.
- [ ] Rehearsal transfer verified (`verify` passed) and timed.
- [ ] Destination runs the release commit. Both frontend builds come from that
      same clean commit (`--commit-dirty=false`).
- [ ] Destination sign-in policies, domains, storage policies and defaults are set
      and both audits return `"ok": true`.
- [ ] Destination variables match
      [runbook step 3](operator-runbook.md#3-deployment-wide-sign-in-settings-on-a-shared-deployment).
      `SOCIETYER_ENTRA_SSO_REQUIRED` stays on until the DDC policy is in place.
- [ ] Tell members: they must sign in again after cutover, First Form members get
      new reset links, and sessions last at most 8 hours.

During the window:

1. Pause writes on the source(s). The code has no read-only mode, so announce a
   freeze. For a hard stop, publish a holding page on the source's Pages
   project. Changing roles to Viewer would itself be a write you'd have to undo.
2. Take the final exports (step 2).
3. Run the final [workspace transfer](#workspace-transfer): `plan`, `apply`,
   `verify`, `finalize`, then `bind`.
4. Apply the deployment-wide settings in the order in
   [runbook step 3](operator-runbook.md#turning-off-required-sso).
5. Publish both frontends pointing at the destination. Update the Worker, staff
   admin and Entra redirect URI as needed.
6. Provision or reset accounts, send the links privately, and bind the moved
   memberships ([step 7](#7-bind-memberships)).
7. Revoke and reissue AI connector grants and API tokens
   ([runbook](operator-runbook.md#revoke-ai-connector-grants-and-api-tokens-issued-before-the-policy)).
8. Run the production checks below.

After cutover:

- [ ] A DDC member signs in with Microsoft at `portal.ddcnorth.com` and opens DDC.
- [ ] A First Form member signs in with a password at
      `societyer-firstform.pages.dev` and opens First Form.
- [ ] A password session sees DDC as **Needs Microsoft sign-in**.
- [ ] A dual member switches both ways through the handoff.
- [ ] DDC document versions go to SharePoint. First Form uploads work.
- [ ] Meeting-source upload works for DDC.
- [ ] The staff admin works.
- [ ] Counts and representative totals match the rehearsal.
- [ ] Keep the source deployments and their backups unchanged until you sign off.

## Rollback

Before any member writes to the destination, rollback is to republish the
previous frontend builds and restore the source's variables (Worker, Entra
redirect URI, staff admin). The source still holds everything.

After members have written to the destination, repointing the frontends back is
not a data rollback. Those writes exist only on the destination. Decide before
cutover how they will be carried back (re-entry, or a workspace transfer of the
destination's export into a fresh deployment), and keep the window between
cutover and sign-off short. `abort` only applies before `finalize`.

Don't restore a backup over a deployment that holds the other organization:
`--replace` deletes its rows (see above).
