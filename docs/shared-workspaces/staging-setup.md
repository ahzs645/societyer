# Shared workspaces: staging setup (Stage 1)

Stage 1 of the [review](../audits/2026-11-08-shared-workspaces-review.md#stage-1--shared-test-environment):
one non-production Convex deployment with two synthetic organizations, test
accounts for every case, and two Pages preview builds pointing at it. No
production records are copied. Command conventions are in the
[operator runbook](operator-runbook.md#command-conventions).

## 1. Choose the deployment

Check what each candidate is used for before taking it over:

| Candidate | Current use | Verdict |
| --- | --- | --- |
| `gallant-anteater-27` | DDC North development. `.env.local` points `npx convex dev` at it. | Avoid. Your dev loop would overwrite staging code. |
| `reminiscent-marlin-243` | First Form development and qualification | Avoid. It holds qualification evidence. |
| A new deployment | none | **Recommended** |

Create a named deployment in the project that will most likely host production.
This guide uses the DDC project, because DDC production is the leading candidate
(a hypothesis; see [migration-and-cutover.md](migration-and-cutover.md#choose-the-destination-deployment)):

```sh
npx convex deployment create ahmad-jalil:societyer-ddcnorth:shared-staging --type prod
```

Don't pass `--default` or `--select`. Note the generated deployment name, for
example `happy-otter-123`. Below it is `$STAGING`.

`convex deploy` with a `CONVEX_DEPLOYMENT` selector always targets the
project's **default** production deployment, which is DDC production. So deploy
to staging with a deploy key instead:

```sh
STAGING=<generated name>
npx convex deployment token create shared-staging-deploy \
  --deployment ahmad-jalil:societyer-ddcnorth:shared-staging \
  --save-env .env.convex-staging-shared.local

./node_modules/.bin/convex deploy --env-file .env.convex-staging-shared.local --typecheck disable -y --dry-run
```

The dry run must name `$STAGING`. Stop if it names `industrious-cricket-610`.
Deploy once the variables below are set.

## 2. Microsoft sign-in for staging

Staging needs its own Entra settings. Both choices change the directory, so get
approval first:

- **A separate staging registration and group (recommended).** A single-tenant
  app registration with redirect URI
  `https://$STAGING.convex.site/api/auth/callback/microsoft`, the same optional
  claims as production (`email`, `acct`, `auth_time`, group object IDs), its own
  certificate, and a dedicated test group holding two test member accounts.
- **Reuse the production registration.** Add the staging redirect URI to
  **Societyer DDC North portal sign-in** and put test accounts in the real DDC
  group `815b3b71-…`. This touches production access. Avoid it.

Test accounts must be member accounts (`acct=0`). Guests are refused. Follow
[ddcnorth-entra-rollout.md](../ddcnorth-entra-rollout.md) for the registration
details.

## 3. Environment variables

```sh
npx convex env set AUTH_MODE convex --deployment "$STAGING"
npx convex env set SITE_URL 'https://shared-staging.societyer-ddcnorth.pages.dev,https://shared-staging.societyer-firstform.pages.dev' --deployment "$STAGING"
openssl rand -base64 36 | npx convex env set BETTER_AUTH_SECRET --deployment "$STAGING"
npx convex env set SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT 1 --deployment "$STAGING"
npx convex env set SOCIETYER_AUTH_MANUAL_PROVISIONING 1 --deployment "$STAGING"

npx convex env set SOCIETYER_ENTRA_LOGIN 1 --deployment "$STAGING"
npx convex env set MICROSOFT_LOGIN_TENANT_ID 220c85f6-1cb1-4bb2-a63b-55d9fd163b55 --deployment "$STAGING"
npx convex env set MICROSOFT_LOGIN_CLIENT_ID <staging client ID> --deployment "$STAGING"
npx convex env set MICROSOFT_LOGIN_GROUP_IDS <staging test group ID> --deployment "$STAGING"
npx convex env set MICROSOFT_LOGIN_PRIVATE_KEY --deployment "$STAGING" < staging-login-key.pem
npx convex env set MICROSOFT_LOGIN_CERT_SHA256 <base64url SHA-256 thumbprint> --deployment "$STAGING"
```

The SITE_URL entries are the Pages branch aliases created in step 6. Add
`http://127.0.0.1:5173` only if you also want to run a local build against
staging. Delete the private key file after setting it.

Leave these **unset** on staging, as on the intended shared production
deployment:

- `SOCIETYER_ENTRA_SSO_REQUIRED`
- `SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS`
- `SOCIETYER_DISABLE_NATIVE_FILE_STORAGE`
- `SOCIETYER_INITIAL_INVOICE_TEMPLATE`
- `SOCIETYER_AUTH_INSTANCE_NAME`, `SOCIETYER_AUTH_SUPPORT_EMAIL`

Storage:

- For native document versions in the First Form workspace, set `RUSTFS_*` or
  `R2_*` to a **test** bucket. Without them, version uploads fail with "Live
  upload storage is not configured." Attachments and images still work through
  Convex storage.
- SharePoint is optional. Never point staging at DDC's production site. With a
  separate test site, set `SOCIETYER_STORAGE_PROVIDER=sharepoint` and the
  `SHAREPOINT_*` variables for it. Without one, give the DDC workspace
  `nativeUploads: "disabled"` and `documentVersionProvider: "deployment-default"`
  in step 5 and skip the SharePoint journey. `npm run
  test:workspace-storage-policy` covers the SharePoint path against a stubbed
  Microsoft Graph.

Mail is optional. Without it, provisioning and reset links are returned to you,
and invitations work as **Anyone with the link** share links.

Then deploy the code:

```sh
./node_modules/.bin/convex deploy --env-file .env.convex-staging-shared.local --typecheck disable -y
```

## 4. Test accounts and workspaces

| Who | Logins | Memberships |
| --- | --- | --- |
| **D** – DDC only | Microsoft (test account 1) | DDC North (staging), Owner |
| **F** – First Form only | password | First Form (staging), Owner |
| **P** – both | password `P-pw` and Microsoft `P-ms` (test account 2), linked | First Form Director (through `P-pw`), DDC Viewer (through `P-ms`) |
| **U** – uninvited | password | none |

Microsoft sign-in can't create a login, and `registerDirectoryMember` needs an
existing workspace. So D creates the DDC workspace through a password login that
then gets Microsoft attached.

1. **F** and the First Form workspace:

   ```sh
   npx convex run hostedAuth:provisionAccount '{"name":"Staging F","email":"f@<test domain>"}' --deployment "$STAGING"
   ```

   Open the returned link on `https://shared-staging.societyer-firstform.pages.dev`,
   choose a password, sign in, and create **First Form (staging)**. F is Owner.

2. **D** and the DDC workspace. Provision a password login with test account 1's
   email, sign in on `https://shared-staging.societyer-ddcnorth.pages.dev`, and
   create **DDC North (staging)**. Find D's `authSubject` with the membership
   inventory query in the
   [runbook](operator-runbook.md#find-workspace-and-membership-ids), then attach
   Microsoft:

   ```sh
   npx convex run entraProvisioning:registerDirectoryMember '{"societyId":"<DDC staging ID>","objectId":"<test account 1 object ID>","email":"<D email>","name":"Staging D","existingAuthUserId":"<D authSubject>"}' --deployment "$STAGING"
   ```

   D now has a password and Microsoft on one login. That's realistic: DDC
   production has such an account. The password half is what the "password
   session is locked out of DDC" journey uses.

3. **P**:

   ```sh
   npx convex run hostedAuth:provisionAccount '{"name":"Staging P","email":"p@<test domain>","societyId":"<FF staging ID>"}' --deployment "$STAGING"
   npx convex run entraProvisioning:registerDirectoryMember '{"societyId":"<DDC staging ID>","objectId":"<test account 2 object ID>","email":"<test account 2 email>","name":"Staging P"}' --deployment "$STAGING"
   ```

   The emails must differ, or the second command refuses. F invites `P-pw` to
   First Form as **Director** with an **Anyone with the link** invitation. P
   opens it while signed in as `P-pw`. The second command already made `P-ms` a
   DDC Viewer. Don't link P yet; linking is a journey.

4. **U**: `hostedAuth:provisionAccount` with no workspace, and no invitation.

5. Workspace IDs: run the `societies` inventory query from the
   [runbook](operator-runbook.md#find-workspace-and-membership-ids).

## 5. Policies

Use the runbook commands with `TARGET=$STAGING`:

- [DDC sign-in policy](operator-runbook.md#ddc-north) with the staging tenant
  and test group.
- [First Form sign-in policy](operator-runbook.md#first-form) with a test
  support address.
- [Domains](operator-runbook.md#map-the-origins):
  `https://shared-staging.societyer-ddcnorth.pages.dev` → DDC (primary) and
  `https://shared-staging.societyer-firstform.pages.dev` → First Form (primary).
  Then `workspaceDomains:audit` must return `"ok": true`.
- [Storage](operator-runbook.md#5-storage-policies): DDC `disabled` /
  `sharepoint` (or `deployment-default` without SharePoint), First Form
  `allowed` / `native`. Then `workspaceStoragePolicies:audit` must return
  `"ok": true`.
- [Invoice template](operator-runbook.md#6-workspace-defaults) for First Form.

## 6. Two preview builds

Each build reads its Vite mode file. A shell variable or mode file overrides
`.env.local`, which points at DDC development. Create two git-ignored mode files
from the production profiles:

```sh
STAGING=<generated name>

{ grep -v -E '^(VITE_CONVEX_URL|VITE_CONVEX_SITE_URL|VITE_MEETING_SOURCE_BROKER_URL|VITE_DISABLE_NATIVE_FILE_STORAGE|VITE_DOCUMENT_STORAGE_PROVIDER)=' .env.ddcnorth
  printf 'VITE_CONVEX_URL=https://%s.convex.cloud\nVITE_CONVEX_SITE_URL=https://%s.convex.site\nVITE_MEETING_SOURCE_BROKER_URL=\n' "$STAGING" "$STAGING"
} > .env.staging-ddc.local

{ grep -v -E '^(VITE_CONVEX_URL|VITE_CONVEX_SITE_URL)=' .env.firstform
  printf 'VITE_CONVEX_URL=https://%s.convex.cloud\nVITE_CONVEX_SITE_URL=https://%s.convex.site\n' "$STAGING" "$STAGING"
} > .env.staging-firstform.local
```

The DDC staging build drops the two storage ceilings, as recommended for a
shared deployment ([runbook](operator-runbook.md#ceilings-that-must-go-on-a-shared-deployment)),
and the production meeting-transfer Worker. Don't send staging identities to the
production Worker.

Build and publish to a preview branch of each Pages project:

```sh
./node_modules/.bin/vite build --mode staging-ddc
CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b ./node_modules/.bin/wrangler pages deploy dist \
  --project-name societyer-ddcnorth --branch shared-staging --commit-dirty=false

./node_modules/.bin/vite build --mode staging-firstform --outDir tmp/firstform-dist
CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b ./node_modules/.bin/wrangler pages deploy \
  --cwd deploy/firstform --project-name societyer-firstform --branch shared-staging
```

The First Form deploy runs from `deploy/firstform`, whose `wrangler.jsonc`
publishes `tmp/firstform-dist`. The repository root `wrangler.jsonc` is the DDC
project's.

A branch other than `main` is a preview. Use the stable branch aliases:

- `https://shared-staging.societyer-ddcnorth.pages.dev`
- `https://shared-staging.societyer-firstform.pages.dev`

The per-deploy hash URLs aren't in `SITE_URL`, so sign-in from them is refused.
Rebuild both previews from the same commit whenever you redeploy staging.

## 7. Journeys

Use a fresh browser profile per person. Record pass or fail with the commit.

| # | Journey | Expected |
| --- | --- | --- |
| 1 | U opens the DDC preview | Sign-in page shows the DDC staging name and only **Continue with Microsoft**. |
| 2 | U opens the First Form preview and signs in | Title "Sign in to First Form (staging)", password form. After sign-in: invitation or workspace-creation screen. No workspace data. |
| 3 | D signs in with Microsoft on the DDC preview | DDC opens with D's role. **My workspaces** lists only DDC. |
| 4 | D signs in with the password on the First Form preview | "No access to First Form (staging)" with DDC listed as **Needs Microsoft sign-in**. Opening DDC shows "Sign in with Microsoft", "DDC North (staging) needs you to sign in with your Microsoft work account." |
| 5 | Same session, **Continue with Microsoft for DDC North (staging)** | Microsoft round trip, then DDC opens. |
| 6 | F signs in on the First Form preview | First Form opens. F can upload an attachment and a document version. |
| 7 | F opens the DDC preview | Microsoft only. F can't sign in there. |
| 8 | P links: signed in as `P-pw` on the **First Form** preview, **Link an existing account → Continue**, then **Continue with Microsoft** as `P-ms`, check both cards, **Link logins** | "Logins linked". **My workspaces** shows First Form (Director) and DDC (Viewer, "via linked account"). |
| 9 | P signs in as `P-pw` only | First Form opens. DDC shows **Needs Microsoft sign-in**. The linked Microsoft login does not count for this session. |
| 10 | P in DDC (Microsoft session) uses the switcher to open First Form | Handoff to the First Form preview, First Form opens without a new sign-in, role Director. Switching back works. |
| 11 | P signs out on one preview | Reloading the other preview shows signed out (the same session ended). |
| 12 | P replays a used `/handoff#code=…` URL, or opens one in another browser | "Sign in to continue". No session. |
| 13 | Start a link, wait 11 minutes, sign in to the other login | "Link expired" or "No link in progress". |
| 14 | P unlinks under **Sign-in methods → Linked logins** | Each login sees only its own workspaces again. |
| 15 | Conflict: F invites `P-ms` to First Form and `P-ms` accepts (now two First Form memberships), then P tries to link `P-pw` and `P-ms` again | "Can't link these logins", naming First Form. An `accountLinkEvents` row with `refused` / `conflict`. Roles unchanged. Remove `P-ms`'s First Form membership afterwards. |
| 16 | F disables P's First Form membership | P loses First Form, keeps DDC. Relinking doesn't reactivate it. |
| 17 | DDC workspace in the DDC preview | SharePoint version upload offered (with SharePoint) and no native upload controls. A direct `files:generateUploadUrl` for DDC fails: "Native file storage is disabled for this workspace…". |
| 18 | First Form workspace opened in place in the DDC preview (temporarily disable the First Form domain mapping) | Native upload controls shown. Restore the mapping afterwards. |
| 19 | Provisioning and reset links with `societyId` of First Form | Links start with `https://shared-staging.societyer-firstform.pages.dev`. |
| 20 | Forged IDs: in P's First Form session, call a DDC query with a DDC record ID from the browser console | Refused. |

Journeys 12, 14 and 20 also have automated coverage; see
[acceptance-tests.md](acceptance-tests.md).

## 8. Tear down

Disable the domain mappings, delete the preview deployments in Cloudflare, and
revoke the staging deploy key:

```sh
npx convex deployment token delete shared-staging-deploy --deployment ahmad-jalil:societyer-ddcnorth:shared-staging
```

Remove the staging redirect URI or registration from Entra if you created one.
Delete `.env.convex-staging-shared.local`, `.env.staging-ddc.local` and
`.env.staging-firstform.local`.
