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

**Not provided:** an organization-aware, cloud-to-cloud import. Nothing in this
change copies one organization's records from one Convex deployment into another
that already holds a different organization. Specifically, there is no tool that:

- inserts one deployment's rows into another with new IDs and rewrites every
  typed and string-held reference;
- copies native file bytes and maps old `_storage` IDs to new ones;
- carries Better Auth users, accounts and credentials across deployments;
- resumes a partial transfer or proves the counts reconcile.

[local-to-convex-promotion.md](../local-to-convex-promotion.md) is a design for a
related problem (local workspace into a hosted one), not an implementation. The
workspace archive restores local records and strips auth bindings.

So there are two ways forward:

1. **Start First Form fresh on the shared deployment.** Create the workspace,
   re-provision accounts, and re-enter or re-upload what First Form needs. Keep
   the old deployment read-only for reference. This needs no import tool.
2. **Build the import tool first.** Then rehearse it as below. Budget it as its
   own project.

The rest of this page assumes option 2 for the rehearsal steps and applies to
both for the cutover.

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

### 4. Rehearsal with the import tool

Into a rehearsal deployment that already holds a copy of the destination:

1. Import one organization additively, with durable old-to-new ID mappings and
   resumable progress.
2. Keep historical actor references (`users` IDs on records) pointing at the
   new membership rows.
3. Copy native file bytes and verify each SHA-256 against the source. Keep
   SharePoint locators where the connection stays the same.
4. Verify typed and string-held references, counts per table and workspace,
   attachment checksums, and representative invoice and financial totals.
5. Reissue operational credentials, invitations, AI connector grants and
   workflow schedule grants. Don't copy them.

### 5. Identity reconciliation

Never match people by email.

- Better Auth users on the source deployment are bound to the source's issuer
  (its Convex site URL). The destination doesn't accept them. Every person who
  moves gets a new login on the destination: `hostedAuth:provisionAccount` for
  passwords, `entraProvisioning:registerDirectoryMember` for Microsoft. Each
  person sets a new password from the link.
- Rebind each moved membership to the person's new login only with explicit
  operator evidence (who confirmed which person is which), never automatically.
- A person who will belong to both organizations either gets one login with both
  methods (`registerDirectoryMember` with `existingAuthUserId`) or links two
  logins themselves after cutover ([user guide](user-guide.md#link-an-existing-account)).
- Check for overlap before import: a person must not end up with two memberships
  in one workspace. Linking refuses that case, and the resolver denies access to
  that workspace.

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

## Stage 4: cutover checklist

Before the window:

- [ ] Staging passed every journey in [staging-setup.md](staging-setup.md) from
      the release commit.
- [ ] Rehearsal reconciled (if importing).
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
3. Run the final transfer and reconcile it (if importing).
4. Apply the deployment-wide settings in the order in
   [runbook step 3](operator-runbook.md#turning-off-required-sso).
5. Publish both frontends pointing at the destination. Update the Worker, staff
   admin and Entra redirect URI as needed.
6. Provision or reset accounts and send the links privately.
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
cutover how they will be carried back (re-entry, or the same import tool in the
other direction), and keep the window between cutover and sign-off short.

Don't restore a backup over a deployment that holds the other organization:
`--replace` deletes its rows (see above).
