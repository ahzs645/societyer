# Shared-workspace lessons learned

Recorded from the November 8, 2026 rollout. The [production setup](production-setup.md)
is the deployed configuration; the [architecture](architecture.md) defines the contract.

## Domains, workspaces and accounts are different

A different frontend domain does not need another Convex deployment. Cloudflare
serves the approved build on the custom host, and a database mapping selects its
workspace and branding. Membership and policy remain the access boundary. DNS
does not grant access; matching email does not prove two logins are one person.

Different origins do not share browser storage automatically. **My workspaces
→ Open** and the workspace switcher use a destination-held verifier/challenge
handoff to carry the existing session, then remove the code from the URL. A
bare visit to a new domain may legitimately ask for sign-in. The real Owner's
Pages-alias → `portal.1stform.ca` handoff and reload passed.

Current domain setup is operator-managed. There is no self-service customer
domain onboarding screen. Give every new customer explicit sign-in/storage
policies before opening their domain and membership.

## Replace global assumptions in the right order

`SOCIETYER_ENTRA_LOGIN` enables Microsoft; `SOCIETYER_ENTRA_SSO_REQUIRED` requires
it for every session. Keep the provider and directory/group checks, install DDC
policies on every DDC workspace, close sign-up and map the domains before
removing the global requirement. A linked Microsoft account is not Microsoft
evidence on a password session. Evaluate the actual session.

Email restrictions need verified email. Microsoft-only provisioned accounts can
legitimately have unverified email, so DDC uses tenant/group evidence instead.

Native-upload ceilings in the backend and frontend profiles can override
workspace policy. Install DDC's SharePoint rows before removing them. An
`allowed/native` row does not create the RustFS/R2 adapter for document versions.
The shared deployment still defaults to DDC SharePoint, so a new customer must
not be left on that default accidentally.

## Verify claims in each consumer's actual shape

Convex custom-JWT identities flatten nested claims into dotted keys. Backend
code reads verified `societyer_entra.userId`, `.tenantId`, `.groupIds` and the
other fields, validates the proof and binds it to the JWT subject. The separate
Cloudflare staff Worker verifies the raw JWT, where `societyer_entra` remains a
nested object. A nested-only mock would miss this and recreate the earlier loop.

This tenant issued immediately expired ID tokens with `max_age=0`. The deployed
flow uses `prompt=login`, checks recent `auth_time` and strict expiry, and omits
`max_age=0`. Token expiry was not disabled. Login certificate, mail app and
SharePoint credentials are separate integrations.

## Transfer records, then bind proven identities

Whole-snapshot import preserves IDs but replaces tables; it cannot merge two
populated organizations safely. Use the reviewed transfer table policy, new-ID
map, required-reference ordering, two passes, file checksums, quarantine and
verification. A schema mismatch blocks the transfer. Classify new tables first.

The real rehearsal proved repeat apply inserted nothing, both role bindings
worked and every original destination row was unchanged. Production's single
different original row contained only a normal worker heartbeat; checking its
changed fields distinguished runtime activity from business-data loss.

Credential/session tables do not move with memberships. The user chose separate
First Form password logins; provision those identities and bind exact IDs,
keeping roles. Do not attach them to DDC identities by guessing from names or
email. Setup links last one hour and must remain private. A successful password
change still needs a sign-in. Verify the actual tab's URL, workspace, identity,
role and reload rather than a success message or a still-open old tab.

## Use the installed CLI and explicit target

Convex `run`, `env`, `export` and `import` use `--deployment`; `deploy` accepts
a selector `--env-file`. An old First Form production selector still names the
retired source. `CONVEX_DEPLOYMENT` selects the project's default production for
deploy, so the named rehearsal used its own temporary deploy key.

Release code generation can replace the tracked generated TypeScript files
with another output layout. Keep `--codegen disable` when releasing the checked-in
generated files, and run actual TypeScript checks. Backend deployment precedes
frontends that call new domain/request functions.

Cloudflare needs both the Pages domain attachment and DNS record. A CNAME alone
is insufficient. This same-account zone used HTTP validation and requested no
TXT record. Wait for active ownership/HTTPS, trust the exact origin, then
promote its workspace mapping. A frontend-host change did not require changing
the Microsoft backend redirect URI.

Hosted runtime checks also matter for branding: a dynamic validator import that
worked locally failed in hosted Convex and was replaced with a static import.
A green frontend build did not prove workspace-brand saves worked remotely.
Persisted branding is a kit snapshot, so a new design-system release and a saved
workspace update are separate operations.

GitHub CI, the GitHub Pages mirror, Cloudflare Pages and hosted Convex are
separate release outcomes. Record the actual backend target, public build
profile and Cloudflare deployment/commit rather than treating a push as proof
that all of them are live.

## Keep observations and gaps explicit

The startup optimization's single cached-reload observation was approximately
2.04 seconds before versus 1.69 after, with two initial token requests and
Authenticate messages reduced to one each. That is not a controlled benchmark
or total fresh Microsoft sign-in timing. The handoff token is single-use,
session-bound and limited to 60 seconds; `initialAuthTokenReuse` remains an
experimental Convex option.

Two existing local check failures were not migration verifier failures and
were not silently marked green. Live access-request/approver mail, linked
DDC-to-First-Form journeys, a new native document-version upload and real
claude.ai/ChatGPT/Codex connector authorization remain unqualified. MCP metadata
passing does not prove every client supplies the resource URL; omission can
still select DDC's fallback consent domain.

The default Python `urllib` user agent received Cloudflare error 1010 before
application authentication. Cloudflare documents this case and recommends a
descriptive application user agent, not a browser impersonation. Repeating the
read-only check with `Societyer-Cutover-Verification/1.0` accepted the real
Microsoft Owner token (200) and denied the real First Form password token (401).
No edge setting was changed. Distinguish edge policy from app authorization.

## References

- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Convex snapshot import](https://docs.convex.dev/database/import-export/import)
- [Convex custom JWT claims](https://docs.convex.dev/auth/advanced/custom-jwt#custom-claims)
- [Cloudflare error 1010 and application user agents](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)
- [Operator runbook](operator-runbook.md), [transfer procedure](migration-and-cutover.md), [acceptance matrix](acceptance-tests.md)

