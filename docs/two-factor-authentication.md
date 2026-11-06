# Two-factor authentication

Each deployment uses its configured sign-in provider. Account security is
independent of workspace invitations and membership roles.

| Sign-in mode | Two-factor setup |
| --- | --- |
| `convex` | Better Auth runs in Convex. Set `SOCIETYER_AUTH_TOTP_ENROLLMENT=1` on that Convex deployment. |
| `better-auth` | Set `SOCIETYER_AUTH_TOTP_ENROLLMENT=1` on the Node gateway. The gateway runs its auth database migrations at startup. |
| `clerk` | Enable MFA strategies in that Clerk application's dashboard. Its sign-in and account screens handle setup and challenges. |
| `none` | Local and demo workspaces have no hosted sign-in. |

For Better Auth password accounts, open **Account security**, confirm your
password, and scan the QR code in an authenticator app. Verify the first code
and store the one-time backup codes privately. From then on, a fresh sign-in
asks for an authenticator code or a backup code before issuing workspace access.
Microsoft single sign-on follows the Entra tenant's MFA policy.

Enrollment is voluntary. Closing enrollment on a Better Auth deployment
prevents new setups while enrolled accounts continue to receive challenges.
An enrolled user can regenerate backup codes or turn off their authenticator
from **Account security**. A password reset still requires the enrolled second
factor at the next sign-in.

## Rollout

Upgrade the backend and frontend together before offering enrollment. A
frontend published before the upgraded backend continues to support ordinary
password sign-in. Enable enrollment after both versions are serving traffic
so users have the verification screen available on their next sign-in.

The Better Auth 1.7 upgrade preserves Societyer's existing Microsoft account
bindings using the verified Entra subject. Existing Clerk settings remain
managed in the Clerk dashboard.

## Local qualification

Run the browser check against an isolated loopback Vite app and backend. For
Convex-hosted auth, configure manual account provisioning and authenticator
enrollment on the test deployment. Supply its local Convex selector file so the
check can create a synthetic account and exercise the password setup link.

```sh
AUTHENTICATOR_TEST_APP=http://127.0.0.1:45382 \
AUTHENTICATOR_TEST_ENV_FILE=tmp/authenticator-local/convex.env \
npm run test:authenticator-browser
```

For the gateway, run a separate loopback app with `AUTH_MODE=better-auth` and
authenticator enrollment enabled. The test uses the gateway's ordinary sign-up.

```sh
AUTHENTICATOR_TEST_BROKER=better-auth \
AUTHENTICATOR_TEST_APP=http://127.0.0.1:45386 \
npm run test:authenticator-browser
```
