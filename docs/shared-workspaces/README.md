# Shared workspaces and linked sign-in

Several organizations can share one Convex deployment and stay separate. DDC
North and First Form are the first pair. Each workspace keeps its own members,
roles, sign-in requirement, website, file storage and defaults. One person can
link their logins and switch between their workspaces without signing out.

What it adds:

- **Workspace sign-in policy.** DDC North can require a Microsoft sign-in from
  its directory group while First Form accepts passwords on the same deployment.
  The policy is checked against how the current session signed in, never against
  login methods someone has linked.
- **Linked logins.** A person proves two logins are theirs and then reaches the
  memberships of both. Memberships, roles and history are never moved, merged or
  reactivated. Adding a provider such as Microsoft to your own login is
  disabled; an operator provisions Microsoft logins.
- **Domains.** Each verified frontend origin opens its workspace and shows its
  branding. Links in emails go to the workspace's own domain.
- **AI connector origins.** Each mapped site's `/mcp/<host>` URL completes
  consent on that site's domain. Plain `/mcp` retains the first-origin fallback.
- **Cross-domain handoff.** Switching to a workspace on another mapped domain
  carries the same session across. It never upgrades a password session.
- **Storage policy.** DDC keeps SharePoint with native uploads off; First Form
  uses native storage.
- **Workspace defaults.** The First Form invoice template is installed per
  workspace instead of per deployment.
- **Access requests.** A signed-in non-member on a workspace's own domain can ask
  to join when that workspace turns it on; its Owners and Admins approve or
  decline. Off by default.

## Workspace transfer

`npm run transfer:workspace` moves one workspace from a source deployment's
`npx convex export --include-file-storage` ZIP into a destination that already
holds other workspaces, additively: new IDs, every typed and string-held
reference rewritten, files copied and checksummed, resumable, verified, and
abortable until it is finalized. Logins are not copied; the operator binds each
imported membership to a destination login. The steps (`plan`, `apply`,
`verify`, `finalize`, `bind`, `abort`, `status`), what is copied, disabled and
skipped, and the limits are in
[migration-and-cutover.md](migration-and-cutover.md#workspace-transfer).

## Pages

| Page | For |
| --- | --- |
| [production-setup.md](production-setup.md) | Current deployed domains, backend, policies, accounts, transfer evidence and recovery |
| [lessons-learned.md](lessons-learned.md) | What surprised us, why the configuration works and what remains operator-managed |
| [architecture.md](architecture.md) | The contract: tables, functions, rules |
| [operator-runbook.md](operator-runbook.md) | Deploying, policies, domains, storage, accounts, offboarding, rollback |
| [staging-setup.md](staging-setup.md) | Stage 1: a shared staging deployment, test accounts, preview builds, journeys |
| [user-guide.md](user-guide.md) | Members and workspace admins |
| [migration-and-cutover.md](migration-and-cutover.md) | Stages 3–4: inventory, backups, destination choice, workspace transfer, cutover, rollback |
| [acceptance-tests.md](acceptance-tests.md) | Each acceptance criterion mapped to a test or staging journey, with gaps |
| [Feasibility review](../audits/2026-11-08-shared-workspaces-review.md) | Why, and the staged plan |

## Quick links

- Deploy the new code safely: [runbook step 1](operator-runbook.md#1-deploy-the-new-code-to-each-existing-deployment)
- Set DDC's Microsoft requirement: [runbook step 2](operator-runbook.md#ddc-north)
- Turn off deployment-wide required SSO, in order: [runbook](operator-runbook.md#turning-off-required-sso)
- Map domains and `SITE_URL`: [runbook step 4](operator-runbook.md#4-domains)
- Storage ceilings to remove: [runbook](operator-runbook.md#ceilings-that-must-go-on-a-shared-deployment)
- Link two logins: [user guide](user-guide.md#link-an-existing-account)
- Request access, and approve requests: [user guide](user-guide.md#request-access-to-a-workspace), [admins](user-guide.md#access-requests)
- Move a workspace between deployments: [workspace transfer](migration-and-cutover.md#workspace-transfer)
- What is not implemented: [migration](migration-and-cutover.md#what-this-change-does-and-doesnt-provide), [acceptance gaps](acceptance-tests.md#acceptance-criteria)

Related deployment guides: [DDC North Entra rollout](../ddcnorth-entra-rollout.md),
[DDC North deployment](../ddcnorth-cloud-deployment.md),
[First Form deployment](../firstform-cloud-deployment.md),
[sign-in hosted in Convex](../convex-hosted-auth-setup.md).

## Tests

| Command | Covers |
| --- | --- |
| `npm run test:workspace-sign-in-policy` | Session evidence, policy validation, Microsoft and email-domain rules, linked password versus Microsoft sessions |
| `npm run test:account-links` | Link protocol: freshness, single-use codes, conflicts, merge, unlink |
| `npm run test:operator-identity-tools` | Operator inspect/unlink and retiring a duplicate membership |
| `npm run test:workspace-domains` | Domain mapping, `resolveOrigin`, audit, canonical links, invoice template install |
| `npm run test:session-handoff` | Handoff endpoints on the real Better Auth engine |
| `npm run test:workspace-storage-policy` | Storage policy on every native path, SharePoint versus native, ceiling |
| `npm run test:shared-workspace-ui` | Startup rules, handoff parsing and redemption, switcher routing, link code storage |
| `npm run test:workspace-selection` | Per-tab and per-backend workspace selection |
| `npm run test:access-requests` | Request access: discovery rule, limits, Owner/Admin decisions, exact binding, sign-in policy kept |
| `npm run test:workspace-transfer` | Transfer policy covers every table; plan, apply with resume, verify, finalize, bind and abort against a destination that holds another workspace |

Each runs a single `tsx` (or `node`) script under `scripts/`, so
`./node_modules/.bin/tsx scripts/check-workspace-sign-in-policy.ts` works as
well. What each one asserts, and what still needs a manual check, is in
[acceptance-tests.md](acceptance-tests.md).
