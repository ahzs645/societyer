# DDC North hosted instance

Configured October 17, 2026.

## Deployment

- Frontend: https://societyer-ddcnorth.pages.dev
- Cloudflare Pages project: `societyer-ddcnorth`, account `479e77f49d4ac5d7498529ee360f194b` (Ahzs645@gmail.com).
- Convex project: https://dashboard.convex.dev/t/ahmad-jalil/societyer-ddcnorth
- Production: `industrious-cricket-610`, https://industrious-cricket-610.convex.cloud
- Development: `gallant-anteater-27`, https://gallant-anteater-27.convex.cloud

Convex Cloud runs the backend and Better Auth component. Cloudflare Pages serves
the frontend. This does not run a self-hosted Convex server inside Cloudflare.
The new instance has an empty database; existing local records were not copied.

Public production build settings are in `.env.ddcnorth`:

`VITE_APP_ONLY=1` makes the root URL enter `/app`: visitors without a session
reach login, and signed-in users reach their workspace. It is also enabled in
the DDC North development profile. Builds without this flag keep the public
landing page at `/`.

```sh
npm run build:ddcnorth
npm run deploy:ddcnorth
```

The deploy command publishes the current checkout to the Pages production
branch. Backend deployment is separate: `npx convex deploy` targets this
project's default production deployment. Development uses `npx convex dev`.

Procurement has a separate reader connection and pinned plugin artifact. Use
the [procurement operations guide](procurement-review-operations.md) for its
setup and release commands. A plugin UI release requires a new Pages deployment;
a data refresh only requires publishing the existing Zoer catalog to SharePoint.

## Access and email readiness

Both Convex deployments have:

```dotenv
AUTH_MODE=convex
SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS=ddcnorth.com
SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT=1
SOCIETYER_DISABLE_NATIVE_FILE_STORAGE=1
```

Each has its own random `BETTER_AUTH_SECRET` and trusted frontend origin(s).
Ignored `.env.convex-ddcnorth-*.local` files retain the initial configuration;
never commit them. No secrets are in the public build profile.

`SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS` is an exact, case-insensitive domain list.
Subdomains and suffix lookalikes are rejected. The Convex-hosted broker guards
account creation and email changes. The backend also rejects unverified or
external-domain identities, including existing memberships and invitations.
Unset the variable to restore the existing unrestricted instance policy.
This flag currently applies to `AUTH_MODE=convex` only.

Sign-up requires a configured delivery provider and verified email on the
Convex deployment. Microsoft 365 was connected to production on October 17,
2026. Verification cannot be replaced by merely typing an address ending in
the allowed domain. Ahmad's live browser signup and verification are tracked
separately below; sender qualification alone does not create an account.

Resend and Microsoft 365 are implemented for verification and password-reset
messages. The owner selected Microsoft 365 first on October 17 and chose
`societyer@ddcnorth.com` as a dedicated shared sender mailbox. The mailbox was
created successfully in the FirstForm tenant and appears as `SharedMailbox`
with display name **Societyer DDC North**. No human mailbox members were added.
The signed-in administrative Chrome profile is **Company Setup**. Following the
owner's approval to complete the prepared live connection, Entra registration
**Societyer DDC North email delivery** was created, single tenant with no redirect
URI. Client ID: `1fcf36db-033f-4362-9550-f0297ad4aa31`; app-registration Object ID:
`7db3f211-9602-49a8-a7ec-abf57675fc84`; enterprise service-principal Object ID:
`5142583a-a2bb-49af-bc8c-cfb53a509e11`. These IDs are not interchangeable.
The Exchange `Application Mail.Send` role was provisioned on October 17 using
`scripts/connect-and-provision-ddcnorth-email.ps1` and
`scripts/provision-ddcnorth-email.ps1`. The runner enabled Microsoft's required
one-time organization customization and verified exactly one sender mailbox in
scope, with Ahmad's mailbox outside the app's send scope. The enterprise app
showed no admin-consented Graph grants. A replacement six-month app credential
expires April 15, 2027 and was installed only on production
`industrious-cricket-610`, along with the explicit Microsoft 365 provider selector.
The initial unused credential was revoked after it appeared in a tool result;
it was never connected to production. Set
`SOCIETYER_EMAIL_PROVIDER=microsoft365` with the dedicated `MICROSOFT_MAIL_*`
server settings only after the mail app's single-mailbox Exchange permission is
qualified. Both providers can be configured, but only one is selected; a failed
send does not silently switch providers. These tenant resources are provisioned
separately from deploying the provider code.

For later Resend activation:
Use an authenticated sending domain, preferably a dedicated subdomain. Keep
Microsoft 365 mail routing intact; add the sender's verification records rather
than replacing the organization's mail records. Then set the Resend variables
on both intended environments and verify real delivery and the full link flow.
See [the hosted-auth guide](convex-hosted-auth-setup.md), which also includes the
Microsoft provisioning and live-delivery checks.

As checked October 17, 2026, [Resend](https://resend.com/pricing) offers 3,000
transactional messages/month free, capped at 100/day; its entry paid tier is
US$20/month for 50,000 messages. Microsoft Graph mail is an alternative requiring
a dedicated Exchange mailbox, server app authentication, and Exchange
Application RBAC scoped `Application Mail.Send`. Do not combine this with a
broad Entra `Mail.Send` application grant: permissions are additive.
[Microsoft mail API](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0),
[Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

## Microsoft document storage

Read-only inspection confirmed the FirstForm tenant
`220c85f6-1cb1-4bb2-a63b-55d9fd163b55`, verified `ddcnorth.com`, and a working
[DDC North SharePoint site](https://1stform.sharepoint.com/sites/ddcNorth).
Its storage metrics showed Documents at 39.3 MB and roughly 40.8 MB overall.
The tenant's purchased/free pooled capacity has not been verified: the admin
center required password re-entry. The displayed 25 TB per-site ceiling is
not evidence of purchased tenant capacity.

Protected application storage uses a **separate private site** with
only the administrator and application identity able to access it. The existing
DDC North site's group members can edit its Documents library directly, so it
does not meet the application's isolation requirement as currently configured.

The configured data flow is:

1. Register a single-tenant server application with Microsoft Graph application
   `Sites.Selected`; grant tenant consent and a `write` resource grant only on
   the dedicated site. Keep provisioning privileges separate from runtime
   credentials. Consent alone grants no site access.
2. Configure the approved tenant/site/drive IDs and server-side app credentials
   in the authenticated broker. Do not use an administrator password at runtime.
3. Authenticate each request and check Societyer workspace/document permissions.
   Transfer uploads/downloads between the browser and Microsoft through the
   broker, buffering files up to 8 MiB; keep Graph tokens and preauthenticated URLs on the server. Issue no
   SharePoint sharing links and do not grant users direct site membership.
4. Store only document locators, metadata, checksums and app permissions in
   Convex. File bytes remain in SharePoint, with no Convex `_storage` or R2 copy.
5. Verify allowed/denied roles, forged and cross-workspace locators, overwrite
   protections, version history, recycle-bin behavior, throttling/retries and
   token expiry during rollout qualification.

Tenant and site administrators retain administrative access. Users who are
allowed to download a document can retain their own copy. App permissions should
separately control edits/deletion through Societyer.

The dedicated private site is now created, and the authenticated SharePoint
document-version broker and application-token wiring are implemented and tested
with mocked Graph and deployed to production. Runtime `Sites.Selected` consent,
the approved six-month credential and the dedicated-site `write` grant are
configured. Live small-file and 5 MiB chunked upload/download checksum checks
passed, and the runtime app received 403 from the unapproved DDC North site.
The temporary provisioning app's credential and consent were revoked and its
registration deleted. Native file uploads remain
disabled on this instance; this also affects native
logo/attachment uploads. The [SharePoint runbook](sharepoint-connection-runbook.md)
records the exact resources, setup path, implementation and external examples.
The SharePoint version provider is selected for production after live Microsoft
transfer qualification. Real Microsoft email delivery, account verification,
workspace onboarding, and meeting-source transfers were subsequently qualified
below. Ordinary staff direct-site-access denial and restore/recovery tests remain
rollout checks. The first document-version broker limits files to 8 MiB.

[Microsoft selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview),
[Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).

## Costs within existing capacity

With an eligible existing subscription and enough available pooled capacity,
the additional Microsoft storage subscription cost can be **$0**. Ordinary
SharePoint upload, download, listing and metadata APIs are standard Graph APIs:
they have no additional per-call fee within the licensed usage thresholds.
Throttling still applies. App hosting and broker compute remain separate usage.
This setup does not require the metered sensitivity-label API or a new paid
Azure metered-API subscription.

If a new subscription were needed, Microsoft's Canada Business Basic page
lists CAD$9.50/user/month paid yearly, or CAD$7.30 without Teams, before tax.
Do not buy licenses solely for this integration until existing entitlement is
confirmed. Eligible plans generally include a 1 TB SharePoint pool plus 10 GB
per eligible license, separate from each user's OneDrive allowance.

[Standard Graph API pricing](https://learn.microsoft.com/en-us/graph/metered-api-overview),
[metered APIs](https://learn.microsoft.com/en-us/graph/metered-api-list),
[Canadian license pricing](https://www.microsoft.com/en-ca/microsoft-365/business/microsoft-365-business-basic/),
[SharePoint storage entitlement](https://learn.microsoft.com/en-us/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits).

## Validation

- TypeScript frontend and Convex checks, production frontend build.
- `npm run test:auth-email-policy`.
- `npm run test:multi-user-pipeline`, including domain/verification enforcement
  against existing memberships.
- Successful schema/function/component push to development and production.
- Live production capability query reports only `ddcnorth.com`, no sender,
  and `signUpEnabled: false`; anonymous membership query has no memberships.
- Live external-domain sign-up receives 403; an allowed-domain attempt receives
  403 while email is unconfigured. Neither attempt created an account.
- Successful Pages production deployment; `/login`, `/reset-password`, and
  `/app` return 200 with SPA routing. The live browser shows the allowed-domain
  message, mail-configuration notice and disabled sign-up control.
- Requests from an untrusted frontend origin receive 403. Changed-file lint
  has no errors (existing size/configuration warnings remain); lockfile dry-run
  install and `git diff --check` pass.
- SharePoint runtime binding, small-file and 5 MiB chunked upload/download SHA-256
  checks passed. The unapproved collaboration site returned 403.
- The permanent runtime retains `Sites.Selected` and one selected-site `write`
  grant. Temporary provisioning consent and credential were revoked, and its
  app registration is under Deleted applications.
- SharePoint is selected on production Convex and in the public build profile;
  native Convex uploads remain disabled. Published Pages deployment:
  https://a60144b3.societyer-ddcnorth.pages.dev.
- After activation, anonymous upload/download routes return 401; approved-origin
  preflight returns 204; an untrusted origin returns 403. Sign-up stays closed
  with only `ddcnorth.com` allowed until email delivery is configured.
- Both-provider adapter and domain-policy regression checks pass, including
  Microsoft Graph `202` acceptance, rejected authorization, malformed credentials,
  incomplete selected-provider configuration, and no automatic provider failover.
  These use mocked providers and do not establish live mailbox delivery.
# Meeting-source uploads

The DDC North profile now includes a separate authenticated Cloudflare transfer
Worker for meeting originals up to 500 MB. It uses the same private SharePoint
site; the normal document-version broker still has its 8 MiB cap. See
[meeting-source-storage.md](./meeting-source-storage.md) for deployment settings,
Whisper processor activation, costs and qualification boundaries. Existing text
imports do not require a speech provider. Audio/video transcription is enabled
only when its private service and provider key are configured.


The deployed upload app remains serverless: Pages, Convex, a transfer Worker and
SharePoint. The optional Cloudflare Container speech processor was removed on
October 17 after the owner clarified the architecture. Its Worker, image and
production speech key were removed too; automatic transcription is deferred.
Workers Paid remains active at the account level ($5 USD/month base); removing
the processor does not cancel that subscription. See the meeting-source runbook
for the cleanup record and the separate provider file-size limit.

## Live signup walkthrough, October 17, 2026

The owner requested a real account test for `Ahmad@ddcnorth.com`. The production
browser showed the allowed-domain notice and disabled **Need an account? Sign up**
control, with the message that email verification is still being configured.
The production `http:authCapabilities` query independently returned
`allowedEmailDomains: ["ddcnorth.com"]`, `emailDelivery: false`, and
`signUpEnabled: false`. The email-policy regression check also passed.

That initial blocked walkthrough created no account and sent no verification
email. After the Microsoft connection was completed, both a direct Graph send
and production `emailQualification:sendTest` returned acceptance. The second
test reported `provider: microsoft365` and `accepted: true`. Both messages were
subsequently observed in Ahmad's Microsoft 365 Inbox. Production capabilities now return
`emailDelivery: true` and `signUpEnabled: true`, with only `ddcnorth.com` allowed.
A fresh real HTTP signup request for `example.org` was rejected with HTTP 403.

The owner subsequently authorized completing the live test with a generated
test password. Signup for `Ahmad@ddcnorth.com` succeeded through the normal public
auth API and returned no session; sign-in before verification returned HTTP 403
(`Email not verified`). The real verification messages arrived in Microsoft 365,
and following one in the browser displayed successful verification. Normal API
and browser sign-in then succeeded. Credentials and session state remain in an
ignored local file with mode 0600 and are never included in this runbook.

The live browser completed all five onboarding steps, created **DDC North — live
test workspace**, showed the account as Owner, and created **Live upload
verification — synthetic test**. Meeting URL:
https://societyer-ddcnorth.pages.dev/app/meetings/kx7vqhppzg6x473sv53mhb35xx8ggxg2
The browser uploaded `live-transcript.txt`, displayed the imported synthetic
transcript, and retained the original privately in SharePoint. The Mac later
locked, so subsequent transfer and minutes checks used the same verified user's
ordinary authenticated production APIs rather than an operator identity.

Those live checks also uploaded VTT, SRT, Whisper JSON, and Whisper ZIP originals,
downloaded matching bytes, read the extracted text, and applied each reviewed
transcript to the working minutes. The original TXT was restored as the working
transcript afterwards. Automatic speech processing remains disabled. Keep domain
and verified-email enforcement enabled during testing.

The first authenticated browser run exposed a Worker runtime incompatibility:
Cloudflare rejected `redirect: "error"` before sending the control request.
Manual redirect handling now rejects 3xx responses explicitly, preserving the
user token and broker credential. The corrected Worker version is
`9b10da02-bd82-4af3-8c6e-8aebb88c555e`. The source regression suite now emulates
that runtime limitation and checks that control redirects fail closed.

A separate fresh session resolved the same Owner membership. A wrong password
returned HTTP 401, anonymous meeting reads were rejected, and signing out removed
that session's ability to obtain a Convex token.

The authenticated **500,000,000-byte WAV recording** test also passed against the
actual production Worker, Convex, and SharePoint. It resumed at the acknowledged
5 MiB offset, uploaded the full original, verified every stored range, downloaded
all 500 MB, and compared the entire file's SHA-256:
`d8dc6ff7a5bcd26492db4c566f6ac4daebf075fc5d55dee3024a206965306ac2`.
Source ID: `h58142kerdbvscxyfmafs5t2ss8ggdyj`. Anonymous transfer access returned
HTTP 401 and a 500,000,001-byte declaration returned HTTP 400. The sequential
upload/verification/download run took 1,037 seconds on this connection; this is
an observed test duration, not a throughput guarantee. The original and other
synthetic fixtures remain attached for review. Large-file qualification used
ordinary authenticated production APIs; the browser-file-picker test used TXT.

The account's password was generated for the automated test. Use **Forgot your
password?** on the live sign-in page to choose a personal password afterwards.

In the subsequent browser recheck, the owner completed a fresh sign-in and the
meeting displayed all six retained originals as **ready**, including the
**500.0 MB** recording. The TXT transcript preview was opened from its file row.
The subsequent UI release replaced all three remaining native confirmations
(use transcript, paid transcription, and delete chat) with the app's existing
`ConfirmProvider` modal. The live **Use for minutes** flow was verified with the
synthetic TXT: Cancel and Escape close the dialog, and **Use transcript** returns
“Working transcript updated.” The compact sidebar footer also shows the full
account name and role above sign-out and theme controls. All 910 frontend source
files passed the native-dialog lint audit; TypeScript passed. The changed files
have only the AI assistant's existing size/dependency lint warnings.

### Isolated UI release, October 17, 2026

Production Pages deployment: `179b5d0d` (`main`). The working tree also contains
unrelated changes in progress, so this release was prepared from the existing
`dist` snapshot after confirming its entry assets matched live production bytes.
It adds the footer stylesheet and changes only the three confirmation calls in
the deployed MeetingDetail and GlobalAiAssistant chunks to await the existing
exported `useConfirm` hook. Updated chunks and their importer graph have new
asset names; old assets are retained for already-open clients. Source components
and the stylesheet import contain the equivalent changes for future normal
builds. No backend deployment was needed.

Local release evidence is in ignored `work/sidebar-footer/`: the preparation
script, `dialog-hotfix-manifest.json`, and the staged `deploy/` directory. The
script asserts the expected three calls, async handlers, exported hook, valid
JavaScript syntax, and complete dependency references. Live entry assets were
compared byte-for-byte with the staged release after deployment. Screenshots
are in `work/signup-test/live-styled-transcript-dialog.png` and
`work/signup-test/live-footer-fixed.png`.

### Full production release, October 18, 2026

The complete source release `0074bf0e` is now deployed to production Convex
`industrious-cricket-610` and Cloudflare Pages deployment `4e4cad95` (`main`).
This normal build supersedes the isolated October 17 UI patch. The meeting
transfer Worker was also redeployed as version
`41b2adff-6414-41b7-ab42-fd78ee9cca78`. No containers are required or deployed.

The Convex deployment passed schema validation and added the connector/OAuth
indexes without deleting existing indexes. Source endpoints now use the shared
authorization wrappers with `meetings:write`, retaining uploader and minutes
permission checks inside the handlers. Production authentication still reports
Microsoft email delivery enabled, signup enabled, and only `ddcnorth.com` allowed;
development mail remains unavailable on production. Anonymous MCP POSTs and
anonymous file-transfer requests return HTTP 401. OAuth discovery is available,
while each workspace still controls its connector opt-in.

Validation before deployment included the production build, backend lint,
desktop typecheck, 23 targeted regression scripts, and the portable-manifest
check with six parser tests. Live frontend entry assets were compared with the
release build. Deployment output is retained locally under the ignored
`work/release-checks/` directory. Future full releases deploy the backend first,
then the transfer Worker and frontend:

```sh
npm run build:ddcnorth
npx convex deploy --yes --typecheck enable
npm run deploy:meeting-transfer:ddcnorth
CLOUDFLARE_ACCOUNT_ID=479e77f49d4ac5d7498529ee360f194b npx wrangler pages deploy dist --project-name societyer-ddcnorth --branch main
```
