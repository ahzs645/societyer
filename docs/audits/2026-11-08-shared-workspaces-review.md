# Societyer: shared workspaces, custom domains, and linked sign-in

**Review date:** November 8, 2026 (America/Vancouver)  
**Repository:** [ahzs645/societyer](https://github.com/ahzs645/societyer)  
**Reviewed source:** `feaf1c8d494c8af8aff98d99b52698fcd3d74754`  
**Status:** Feasibility review and implementation plan. No production configuration, source code, account access, DNS, or organization records were changed.

## Decision

Yes. DDC North and First Form can use one Convex deployment while remaining separate organizations, with their own website domains, members, roles, branding, financial records, and document providers. A person can have one Societyer account with access to both workspaces.

The existing data and authorization model already supports one login identity with multiple organization memberships. The remaining work is substantial enough that changing the frontend backend URL alone is not a safe consolidation. Current authentication and storage policies contain deployment-wide assumptions. DDC North also now requires Microsoft sign-in, while First Form uses manually provisioned password accounts.

Recommended target: **one shared Convex deployment per environment; independent organizations inside it; a personal workspace picker; explicit linking of existing accounts; and verified custom-domain routing.** Start with a shared staging deployment containing two synthetic organizations, then rehearse production migration if consolidation of current records is wanted.

## 1. Evidence and current state

This review used the current GitHub main branch, Cloudflare project/domain/DNS/deployment records, the two live sign-in pages, and official Convex, Better Auth, and Cloudflare documentation. It did not inspect private organization records or rerun the repository's test suites. Existing checks are identified below as available tests, not as new passing results.

| Area | DDC North | First Form |
| --- | --- | --- |
| Public entry | [portal.ddcnorth.com](https://portal.ddcnorth.com/) | [societyer-firstform.pages.dev/app](https://societyer-firstform.pages.dev/app) |
| Pages project | `societyer-ddcnorth` | `societyer-firstform` |
| Custom domain | `portal.ddcnorth.com` is active; DNS is a proxied CNAME to `societyer-ddcnorth.pages.dev` | No custom domain is attached to this Pages project |
| Production backend in checked-in public build profile | `industrious-cricket-610.convex.cloud` | `elated-bee-460.convex.cloud` |
| Development backend documented in repository | `gallant-anteater-27` | `reminiscent-marlin-243` |
| Observed live login | DDC North branding; Microsoft sign-in button | First Form branding; email/password; public registration closed |
| Current documented authentication policy | Required Microsoft Entra sign-in, exact tenant/group checks, explicitly provisioned people | Manually provisioned accounts |
| File profile | SharePoint; native Convex uploads disabled | Native Convex uploads enabled |
| Last successful Pages deployment observed | November 8, 4:21 p.m. PST; commit metadata `a5712f3`, clean | November 6, 3:22 p.m. PST; commit metadata `11d2257`, marked dirty |

Cloudflare confirms separate projects and successful releases. The backend names above come from the public build profiles and deployment guides, rather than a new authenticated inventory of the two Convex databases. A dirty deployment marker means the recorded commit does not identify all uploaded source changes. The two frontends should be tested from the same reviewed revision during consolidation.

The older DDC deployment guide describes domain-restricted email registration. The newer [DDC Entra rollout](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/docs/ddcnorth-entra-rollout.md) supersedes that description: required Microsoft sign-in was activated on November 8. The observed live login agrees with the newer document.

## 2. The user experience to build

### One person, several workspaces

After signing in, the person opens **My workspaces**. Each entry shows the organization name, logo, their own role, and any additional sign-in requirement. Selecting an entry opens that organization's workspace. The user's role can differ between organizations.

The account menu should expose three separate tasks:

- **My workspaces:** open an organization already joined, accept an invitation, or request access where that organization permits it.
- **Sign-in methods:** view and explicitly connect login identities the person controls.
- **Sessions and recovery:** manage their own sessions and recovery options.

Keep organization settings under the organization. A First Form administrator should control First Form membership, not the person's global account or DDC North access. A person's list of other workspaces should not automatically become visible to every organization administrator.

### Linking an existing second account

For users who already have separate accounts, provide an explicit **Link an existing account** flow:

1. Start from a recently authenticated account and identify the second account or approved workspace entry.
2. Authenticate to the second account using its own permitted method. Merely entering its email address is insufficient.
3. Confirm both proven identities and the memberships that will appear under the personal account. Preserve each organization's role and membership status.
4. Record the link through a narrowly scoped server operation with an audit record. Refuse ambiguous or conflicting bindings instead of choosing a higher role.
5. Re-establish the resulting session and show the separate workspaces. Preserve historical membership/actor IDs so past records retain their authorship.

The operation must not grant membership to a workspace the person has not joined, restore a disabled membership, or automatically combine accounts because email text matches. Different work email addresses can represent the same person after both identities are verified. The organization-specific contact address can remain on its membership record.

### DDC North's Microsoft requirement remains meaningful

A linked password account can be permitted in First Form while DDC North still requires a current, valid Microsoft-authenticated session meeting DDC's tenant/group rules. Entering DDC from a password session should prompt for Microsoft verification. A session already satisfying DDC's policy can proceed without an unnecessary additional prompt until its applicable expiry or reauthentication requirement.

**Having Microsoft listed as a linked login method is not proof that the current session authenticated through Microsoft.** Account linking and session assurance must remain distinct. Signing into Microsoft for DDC can then be useful for the same person's other authorized workspace, subject to its policy.

## 3. What the existing code already provides

The schema uses `societies` as its organization/workspace table. It holds independent legal details, module choices, branding, and settings. Business records generally carry `societyId`.

In [convex/tables/platform.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/tables/platform.ts), `externalIdentities` holds an exact issuer/subject identity, while each `users` row is an organization membership with its own `societyId`, role, status, and identity binding. Multiple membership rows can bind to the same verified identity.

[shared/functions/access.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/functions/access.ts) resolves active memberships and checks record and parent ownership. [convex/lib/authorizedServer.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/lib/authorizedServer.ts) applies the action policy around public handlers. Membership enumeration checks the verified issuer/subject; an arbitrary workspace ID from browser storage does not establish authority.

Storage ownership, API-client scope, and scheduled-workflow authorization also have organization checks. These are a useful foundation, not a certification that every path has been qualified on a consolidated deployment.

The existing frontend has a membership-aware workspace selector. Its remembered selection is scoped to the browser origin, and individual tabs hold their active selection. The missing pieces are domain-aware startup and self-service linking of existing distinct login accounts.

## 4. Changes required before sharing the current live backend

### A. Move organization access policy out of global authentication

The current global settings include allowed email domains, manual provisioning, Microsoft login enablement, required SSO, one Microsoft tenant/group configuration, instance branding, and some session behavior.

The effect is concrete: pointing First Form at DDC's backend would put its password users under DDC's global SSO requirement. Disabling that requirement globally would remove a protection DDC deliberately enabled.

Separate two decisions:

1. **Who is this person, and how was this session authenticated?** Resolve through Better Auth and validated provider evidence.
2. **Can this session use this workspace?** Require an active membership, the workspace's required authentication evidence, and permission for the requested operation.

Extend the existing workspace-level policy approach already used for MFA. DDC's policy should retain its exact Microsoft tenant/group requirement. First Form can retain its permitted password policy. Future customer identity providers should be explicit organization connections with server-owned configuration.

There is a specific code prerequisite: [convex/lib/authIdentity.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/lib/authIdentity.ts) validates Entra evidence globally but does not carry that evidence into its returned portable principal. [shared/portable/ctx.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/portable/ctx.ts) needs a validated session-assurance representation, and membership resolution must enforce the organization policy using it. Preserve expiry and subject/session binding; never trust a client-supplied provider label.

### B. Add controlled account linking

[convex/hostedAuth.ts](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/hostedAuth.ts) explicitly sets `accountLinking.enabled` to false and `disableImplicitLinking` to true. Existing application identity comparisons are exact issuer/subject comparisons, and ordinary profile editing is not a way to rebind identities.

Use Better Auth's supported explicit provider-linking mechanisms where applicable, retaining disabled implicit linking. Adding an unused provider method to one account differs from reconciling two already-existing accounts and memberships. The latter requires an application migration/link process with proof of both accounts, preserved history, and duplicate-membership handling.

For the existing two-account case, prefer an additive personal-account association above the immutable external identities as the first implementation. Keep each external issuer/subject and organization membership ID intact. Central membership resolution can follow only the person's active, proven associations, then require exactly one eligible membership in the requested organization. A deliberate later migration to one canonical Better Auth user is another option; it needs its own reference and session reconciliation. Better Auth's normal provider-link flow rejects a provider identity already attached to another user, so it is not a substitute for this reconciliation.

An existing login can already join a second organization through the invitation path. Reuse that path for new memberships: it checks the intended mailbox where applicable and the inviter's continuing authority. Use the separate account-link flow when the second membership is already bound to another identity. Linked account convenience must not automatically broaden API-token or background-workflow grants.

Keep Better Auth responsible for sessions and credentials. Do not introduce a second homegrown password/session store. Unlinking should preserve a viable recovery/sign-in method and explain any workspace that will require a replacement method. Organization offboarding should revoke that organization's membership without silently deleting a person's unrelated workspace access.

### C. Map each verified domain to its organization

Today `AuthProvider` chooses the remembered authorized workspace or the first membership; `useSociety` can fall back to the first sorted organization. The hostname does not determine the organization in this path. A legitimate member of both organizations can therefore arrive at the wrong organization's screen from a branded domain.

Add a server-managed mapping from normalized, verified hostname to workspace and canonical origin. For the current two sites:

| Hostname | Intended initial workspace |
| --- | --- |
| `portal.ddcnorth.com` | DDC North |
| `societyer-firstform.pages.dev` | First Form |
| Future approved First Form custom hostname | First Form |

The mapping chooses public login presentation and default destination. Backend membership and workspace policy remain the access boundary. Unknown hosts should fail closed or use an intentionally designated neutral entry point. Do not silently select a different organization when the person lacks access to the domain's organization.

Use the existing workspace switcher for intentional switching. On branded domains, opening another organization should navigate to its canonical entry with clear organization identity. A neutral personal workspace page can list all of the person's memberships.

### D. Make sign-in and links work across the domains

`SITE_URL` already accepts multiple exact frontend origins. Those become Better Auth's `trustedOrigins`. However, several flows still use its first origin: the cross-domain plugin's configured site URL, provisioning links, fallback verification/reset destinations, and some consent/approval links.

The existing browser auth client stores cross-domain session state in the frontend origin's localStorage. Two different frontend domains therefore do not automatically share that state just because they use the same Convex backend.

Recommended progression:

1. Make both sites accept the shared account and return login/reset/invitation flows to the correct approved origin.
2. Offer an immediately useful workspace picker within an established session.
3. Add a shared sign-in entry and controlled domain-to-domain handoff for the seamless experience. Use a short-lived, single-use exchange bound to the intended destination, with normal state/replay protections. Reuse supported authentication transport; do not copy persistent session tokens into URLs or attempt to share browser storage between unrelated domains.

The handoff must preserve actual session assurance and recheck workspace access. It cannot turn a password session into a Microsoft-qualified session. Current Convex + Better Auth documentation lists the separate Better Auth SSO and OAuth Provider plugins as incompatible with this integration; enabling one of those is not an assumed shortcut. The repository's existing Microsoft social-provider integration is a different mechanism.

### E. Make file providers and defaults organization-specific

DDC uses SharePoint and disables native Convex storage; First Form enables native storage. The native-storage guard and primary document-version provider are global, and the SharePoint broker reads one approved tenant/site/drive connection from environment settings.

Resolve provider selection and upload policy from the authorized workspace. Preserve DDC's selected-site SharePoint restrictions and external file references while allowing First Form's chosen provider. Store server credentials securely and refer to a connection from workspace configuration; do not send them to frontend build variables.

The newer optional `documentSources` feature is already organization-scoped. That does not yet remove the global policy in the main document-version/storage adapter. Reuse the existing scoped patterns where appropriate.

Move initial invoice-template selection, login support details, and other organization defaults out of deployment-wide assumptions. In particular, `SOCIETYER_INITIAL_INVOICE_TEMPLATE=firstform` currently selects the initial template for any newly created workspace on that deployment.

If the backend origin changes, update the DDC meeting-transfer Worker and any other consumers still pointing to the old backend, including the separate DDC staff admin integration documented in the Entra rollout. The two Societyer Pages builds are not the only possible clients.

## 5. Cloudflare and Convex arrangement

Keep the two existing Cloudflare Pages projects for the first transition. Build them from the same reviewed release and point both public `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` settings at the shared environment. This is sufficient to share a backend; combining Pages projects is optional later.

A customer can bring a custom subdomain. Attach it to the relevant Pages project, verify it, and configure the appropriate CNAME at the customer's DNS provider. External DNS can remain in use for subdomains. Pages has additional same-account Cloudflare zone requirements for an apex domain. Record the domain in Societyer's verified mapping and exact trusted-origin configuration.

No separate custom domain on the Convex API is needed simply because the frontend has a custom domain. The generated Convex endpoints can remain in use. DDC's existing domain already has the required Pages association; its DNS need not change merely to choose a different backend in the frontend build.

One shared production environment means both organizations use the same deployed backend code and share its resource constraints. It simplifies releases and comparison testing, but an incompatible backend release can affect both. Actual savings require measured usage; consolidation does not automatically halve billing, and some Convex limits are applied at team level.

## 6. Migration and testing sequence

### Stage 1 — Shared test environment

Create or designate a shared non-production deployment after checking its intended use. Seed two synthetic organizations and test accounts: DDC-only, First Form-only, a person belonging to both with different roles, and an uninvited person. Use organization policies representative of the intended production configuration. Two frontend preview builds should target this backend.

This meets the immediate goal of testing multiple organizations together without making production data merging the first tenancy test. Keep production and experimental test records in separate environments.

### Stage 2 — Workspace policies and personal account experience

Implement per-workspace authentication/storage policy and domain resolution first. Add explicit linking and the personal workspace picker, then qualify cross-domain session handoff. Test a linked user whose password session can enter First Form but must complete Microsoft verification for DDC.

### Stage 3 — Rehearse migration, if current records will be consolidated

The current workspace archive UI restores local records; it is not a completed cloud-to-cloud organization merge. The local-to-Convex promotion document is explicitly a proposal. Existing archive logic strips imported auth bindings and disables restored workflow schedules because a backup is not proof of current authority.

Take recoverable backups of both source deployments, including relevant auth-component and native-file data. Inventory record counts, identities, memberships, files, external storage references, provider connections, scheduled work, API clients, and dependent applications. Reconcile identities deliberately rather than by matching emails.

Use a staged, additive import with durable ID mappings and resumable progress. Preserve organization separation and historic actor references. Verify typed and string-held references, attachment checksums, representative invoice totals, memberships, and provider access before exposing imported records. Preserve SharePoint locators when their provider connection remains valid; copy native file bytes with a verified storage-ID mapping where needed.

Reissue or explicitly reauthorize operational credentials, invitations and scheduled-work grants as appropriate. Existing sessions from the old issuer should not be assumed to survive. A source deployment's full backup restore is useful in an empty rehearsal target; `--replace` over the other active organization is not an additive merge.

### Stage 4 — Controlled production cutover

Choose the shared production destination after the inventory and rehearsal. Existing DDC production has Microsoft sign-in, mail, SharePoint and other clients, so retaining that origin may reduce connection changes; this is a hypothesis to evaluate, not a completed target choice.

Pause source writes for the final migration window, reconcile the final transfer, release the reviewed frontend builds, and update dependent workers/callbacks. Keep the source deployments recoverable until validation is complete. A rollback after new writes reach the shared destination must account for those writes; changing a frontend URL alone is not a complete data rollback.

## 7. Acceptance criteria

| Check | Required result |
| --- | --- |
| DDC-only identity | DDC access succeeds with required Microsoft evidence; First Form data is denied |
| First Form-only identity | Permitted First Form login works; DDC data is denied |
| Dual membership | Both appear in the person's picker; each preserves its own role |
| Password session switching to DDC | Requires Microsoft verification; a linked provider alone does not satisfy the policy |
| Identity linking | Both accounts proved; replay/expired/cross-person attempts rejected; disabled memberships remain disabled |
| Duplicate membership conflict | Explicit reconciliation; no automatic role escalation or authorship loss |
| Direct backend calls | Forged workspace/record/file IDs denied independently of domain or UI |
| Branded domains | Correct initial organization, login presentation, and support/contact information |
| Cross-domain session handoff | Exact approved destination; single-use exchange; no credential leakage; correct assurance |
| Invitations, reset, MFA and OAuth | Correct organization destination; unapproved redirects rejected |
| Storage | DDC keeps SharePoint policy; First Form's selected provider works; cross-workspace locators denied |
| Offboarding | Removing one organization membership blocks it without granting or removing unrelated memberships |
| Background operations | Jobs and API tokens remain scoped and recheck their grants |
| Old browser state | Backend change cannot combine an old API endpoint with a new auth endpoint; sensitive caches are scoped |
| Migration | Counts, foreign references, files and representative financial totals reconcile |
| Release comparison | Both frontends and backend use a known compatible source revision |

Existing relevant suites include workspace access, authorization policy, hosted identity, identity binding, stage-two tenancy, document security/upload binding, connector tenancy, hosted Entra, and workflow-schedule authorization. Reuse and extend them around the concrete scenarios above. The stage-two harness has blocked/error/not-applicable outcomes; harness errors must not be reported as successful isolation checks.

## 8. Suggested implementation packages

1. **Workspace authentication policy and session evidence:** separate verified identity from organization access; preserve DDC's required Microsoft proof.
2. **Domains and workspace entry:** verified host mapping, correct branding/default workspace, links and callbacks, selected-workspace capabilities.
3. **Personal account and linking:** My workspaces, explicit second-identity proof, conflict handling, unlink/recovery rules, cross-domain handoff.
4. **Per-workspace providers and shared staging:** file policy/defaults, dependent workers, matched frontend versions, representative two-organization tests.
5. **Migration and cutover:** inventories, backups, additive import, reconciliation, rollback and production switching.

The desired result is feasible and consistent with the existing membership model. The first concrete delivery should prove both organization policies and the linked-user journey on shared staging, before repointing either live site.

## Source index

### Pinned repository evidence

All repository links below refer to reviewed commit `feaf1c8d494c8af8aff98d99b52698fcd3d74754`.

- [DDC public build profile](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/.env.ddcnorth) and [First Form profile](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/.env.firstform).
- [First Form deployment/access](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/docs/firstform-cloud-deployment.md) and [DDC Entra rollout](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/docs/ddcnorth-entra-rollout.md).
- [Organization schema](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/schema.ts), [identity/membership tables](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/tables/platform.ts), [exact identity matching](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/functions/identity.ts).
- [Hosted auth](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/hostedAuth.ts), [auth-origin configuration](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/authConfiguration.ts), [browser auth client](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/src/lib/convexAuthClient.ts).
- [Membership startup selection](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/src/auth/AuthProvider.tsx), [workspace selection](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/src/hooks/useSociety.ts), [runtime URL precedence](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/src/lib/appRuntime.ts).
- [Deployment-wide storage guard](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/providers/env.ts), [SharePoint connection](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/storage/sharePointDeployment.ts), [scoped external document sources](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/tables/documentSources.ts).
- [Initial invoice template](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/convex/lib/initialInvoiceTemplate.ts), [meeting-transfer Worker configuration](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/wrangler.meeting-transfer.jsonc).
- [Workspace archives](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/src/lib/workspaceArchive.ts), [imported identity stripping](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/shared/workspaceIdentity.ts), [proposed promotion design](https://github.com/ahzs645/societyer/blob/feaf1c8d494c8af8aff98d99b52698fcd3d74754/docs/local-to-convex-promotion.md).

### Current primary platform references

- [Convex authorization](https://docs.convex.dev/auth/overview): public backend functions enforce application access rules.
- [Convex frontend hosting](https://docs.convex.dev/production/hosting/custom): frontend host and backend deployment are separately configured.
- [Convex multiple deployments](https://docs.convex.dev/production/multiple-deployments): a project can include staging and other environments.
- [Convex data import](https://docs.convex.dev/database/import-export/import): backup restore preserves IDs; replace operations replace existing table data.
- [Convex limits](https://docs.convex.dev/production/state/limits): team and deployment resource limits must be considered together.
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/): attach hostnames, configure DNS, and observe apex/subdomain differences.
- [Better Auth accounts and linking](https://better-auth.com/docs/concepts/users-accounts): explicit authenticated provider linking, disabled implicit linking, and unlink constraints.
- [Better Auth already-linked account error](https://better-auth.com/docs/reference/errors/account_already_linked_to_different_user): linking a provider already owned by another user requires separate reconciliation.
- [Convex Better Auth Vite integration](https://labs.convex.dev/better-auth/framework-guides/react): trusted origins and cross-domain integration.
- [Convex Better Auth supported plugins](https://labs.convex.dev/better-auth/supported-plugins): compatibility limits for additional plugins.

Cloudflare project/domain/deployment and live-browser observations are session observations as of this review. No credentials, private tokens, or private organization records are included in this report.
