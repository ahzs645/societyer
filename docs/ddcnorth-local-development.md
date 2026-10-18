# Local DDC North site with cloud development Convex

Configured and tested October 17, 2026. No Docker container is used.

| Part | Address |
| --- | --- |
| Local React/Vite site | http://127.0.0.1:5173 |
| Local development inbox | http://127.0.0.1:4599 |
| Cloud development backend | `gallant-anteater-27` |
| Production backend (unchanged) | `industrious-cricket-610` |

Start the local processes in separate terminals:

```sh
npm run dev:ddcnorth
npm run dev:mail
```

Push backend changes to development with `npx convex dev --once --typecheck enable`.
Do not run `convex deploy` for this workflow. The public frontend profile is
`.env.ddcnorth-development`; it explicitly selects the dev backend and leaves
the production transfer Worker URL empty.

## Fake email pipeline

Only the development deployment has:

```dotenv
SOCIETYER_AUTH_DEVELOPMENT_MAIL=1
SITE_URL=http://127.0.0.1:5173,http://localhost:5173
```

The capture mode is hard-pinned to
`https://gallant-anteater-27.convex.site` and localhost origins on port 5173.
Copying the flag to production does not enable it there. Domain restrictions
and the requirement to verify remain active. This is a development simulation
of mailbox ownership, not real delivery or proof that someone owns a DDC mailbox.
Development identities have a separate issuer and do not grant production access.

Better Auth captures verification/reset messages through an internal mutation.
The development-only table has no public read/write function. Messages expire
after one hour and have scheduled deletion. The local inbox reads the latest
30 through the operator's existing Convex CLI access, always pinned to the
development deployment. It binds to `127.0.0.1` and rejects foreign origins,
cross-site requests and forged Host headers. It exposes no CORS API, serves no
untrusted email HTML and does not log message bodies or links.

Convex Cloud cannot deliver to a mail catcher's laptop localhost. Capturing in
the dev deployment and reading with the local operator CLI avoids a public tunnel,
third-party email service or container. Signup, password reset and verification
still use Better Auth's actual routes and tokens.

## Observed flow

The account `Ahmad@ddcnorth.com` was created through the development auth API with
a random test-only password stored in an ignored local file with mode `0600`.
An unverified sign-in was denied. The verification message appeared in the local
inbox; its link was opened in the browser and returned to the local sign-in page.
Browser sign-in succeeded and presented **Set up your workspace**.

The browser onboarding created **DDC North — development test** with the account
as Owner. A synthetic **Development verification flow — test meeting** was then
scheduled through the meeting UI. No registry filing, calendar invitation or
real email was sent. A 239-character synthetic transcript was saved in the
meeting's Sources section. A real development password-reset request was also
captured in the test inbox; no password change was performed. To choose your own development password, use **Forgot your
password?**, open its link in the local inbox, and enter the new password yourself.

Production still reports `emailDelivery: false` and `signUpEnabled: false` with
only `ddcnorth.com` allowed. Production environment variables and deployment were
not changed by this workflow.

## Storage boundary

Development has no Microsoft storage credentials or transfer Worker configured.
The frontend does not use the production transfer Worker; native blob uploads
remain disabled. The new 500 MB source-upload card is hidden until a development
transfer broker is configured. Production secrets were not copied into a fake
verification environment. The live development browser test therefore establishes
authentication, workspace and meeting behavior, not 500 MB SharePoint transfer.
The existing synthetic 500 MB checks are documented separately in
[meeting-source-storage.md](meeting-source-storage.md).

Checks: frontend and backend TypeScript, `npm run test:development-mail`,
`npm run test:auth-email-policy`, successful dev push, actual browser verification
and sign-in, internal inbox public-access denial, and local inbox Host/Origin
denials. See [Microsoft meeting integration references](microsoft-365-meeting-integration.md)
for the separately researched calendar/Teams patterns.
