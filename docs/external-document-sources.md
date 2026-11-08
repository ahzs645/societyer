# Optional external document sources

## Purpose and delivery boundary

Societyer can keep a reference to a document whose original remains in an approved external library. This is a separate subsystem from document upload storage. Selecting local filesystem, Convex storage, RustFS, R2, or the existing private SharePoint upload backend does not enable, disable, or retarget external references.

The first implementation provides Microsoft SharePoint browsing and linking in an **authenticated, online hosted workspace**. It is off by default. Local and demo workspaces can retain source configuration and linked-record metadata, but live connector operations report unavailable. No production tenant is configured by installing this change.

This is a current-file reference. It does not retain a binary, create an uploaded document version, pin a source version, copy a checksum, or provide an immutable evidentiary record. Where a signed or approved original must be retained, use the existing upload/version workflow for that separately identified record.

## Independent choices

| Choice | Responsibility | Initial state |
| --- | --- | --- |
| Upload storage | Where Societyer-managed file bytes are written | Existing deployment setting |
| External documents module | Whether this workspace permits live source operations | Off |
| Each document source | An approved external tenant, site and library | Disabled when created |
| Microsoft connection | The current person's delegated Microsoft access | Explicit sign-in; memory cache in this tab |

The module uses the existing default-off module convention (`+externalDocuments` in the workspace's module overrides). Both the backend and the UI enforce it. A source must also be enabled. Settings administrators can prepare sources before enabling the module.

## Data model and provider boundary

- `documentSources` contains workspace ownership, a label, provider identity, enabled state, public resource configuration and configuration revision. It contains no client secret or OAuth token.
- `externalDocumentReferences` contains the stable source locator and its link to a Societyer document. The Microsoft locator is tenant ID, site ID, drive ID and item ID.
- `documents.externalReference` is an optional marker identifying the source/reference and `mode: "latest"`. Existing documents need no migration.
- The document's title is a **Societyer record label** entered by the editor. It is visible according to Societyer's document permissions. Graph filenames, browser URLs and other live metadata are not copied into ordinary document rows.
- `shared/documentSources/types.ts` defines provider-neutral source, adapter, capability, item and reference envelopes. Each provider owns its configuration and locator validation. The initial registry contains only the implemented Microsoft provider.

The existing `documentVersions.storageProvider`, checksum verification, download broker, file limits and SharePoint application credentials remain upload-storage concerns. An external provider must not be added to that enum merely to make a source selectable.

To add another source provider, implement its browse/resolve adapter and resource policy, add its validated configuration and reference variants, register its real capabilities, and supply its own user-authentication flow. No automatic data migration or reinterpretation of existing references occurs when adding or changing a provider.

## Access and metadata flow

1. A signed-in person asks to browse or open an approved source.
2. Societyer checks workspace membership, document permissions and module/source state. Opening an existing linked document also checks its document-specific access restrictions.
3. The browser acquires a delegated Microsoft Graph token using the configured resource tenant and application ID. The Microsoft SDK is loaded on demand. The normal Societyer identity token and existing `SHAREPOINT_*` storage credentials are not used.
4. The hosted action passes the short-lived token only to the Graph adapter. The action's authorization query receives resource arguments with the token removed.
5. The adapter requires a supported delegated token bound to the configured tenant and client, validates it through Graph `/me`, and verifies the approved site's document library.
6. Browse and resolve use metadata-only `GET` requests. Before returning a result or committing a link, Societyer checks that the app actor and source configuration have not changed.
7. Linking persists only the verified locator and application-owned label. Opening returns the current validated source `webUrl` after a fresh lookup by ID.

The effective access rule is Societyer record permission **and** enabled approved source **and** current Microsoft user access. A successful check for one person is not cached as another person's authorization. There is no application-token fallback.

The connector does not request `/content`, preview capabilities, sharing links, uploads, moves or deletion. It does not create an external full-text index. Ordinary document preview/download controls must not treat an external browser URL as file bytes.

### Supported token shape

The transient-token implementation accepts compact JWT Graph tokens with tenant, client, subject and delegated-scope binding fields. Parsing those fields is **not** signature validation: the same bearer must subsequently succeed against Graph `/me`, with the returned user matching the binding, before resource metadata can be read. Opaque/encrypted tokens, application tokens, a different tenant/client, or broader Graph data scopes are rejected. The requested Graph scopes are `User.Read` and `Sites.Selected`.

Microsoft owns its access-token format. A tenant that receives opaque/encrypted Graph tokens cannot use this first adapter; it fails closed. A future confidential OAuth broker or on-behalf-of integration should replace this token transport if broader token-format compatibility, background operations or central session custody is needed. Do not weaken the binding checks or substitute the existing app-only upload token.

## Source policy and file movement

The configured site and library are explicit identifiers, not a tenant-wide discovery query. Every operation verifies the source resource and requires `driveType: "documentLibrary"`. Consumer OneDrive (`personal`), employee OneDrive for Business (`business`), and remote-item shortcuts are rejected. Continuation links are constrained to the same Graph origin and approved library/folder endpoint.

| Source change | Expected behavior |
| --- | --- |
| File renamed in the same library | Resolve the same item ID and show its current name/URL |
| File moved between folders in the same library | Resolve by drive/item ID; the old folder path is not the identity |
| File moved or copied to another library/site/tenant | Do not guess by filename; create a new approved reference after review |
| Approved SharePoint site address changed | Resource/URL policy fails closed; review and configure the new source address |
| File deleted or user access revoked | Show unavailable/denied; do not open a previously cached URL |
| Source or workspace module disabled | Retain records; stop live source operations |
| Upload storage provider changed | External references retain their original source identity |
| Reference unlinked | Change Societyer metadata only; never delete the remote file |

A source's resource configuration is immutable. To change tenant, client, site, site address or library, create a new source and new approved references. The current picker creates linked records; an in-place repair/relink workflow that transfers an existing record to a different source is a follow-up. Review the old record's meeting associations before replacing it. Disabling an old source is reversible. No background delta worker or automatic cross-library reconciliation is included in this release.

## Interface

Enable **External documents** in the workspace's module settings. Configure sources in the runtime settings card, separately from upload storage. An administrator supplies a source label and the tenant ID, application ID, Graph site ID, site URL and document-library drive ID; no secret is requested.

In Documents, **Link existing document** opens the source picker. Choose a source, sign in to Microsoft, browse folders, load additional pages as needed, and select a file. **Filter loaded items** applies to the folder entries already fetched; it is not a recursive library search or content search. Enter the Societyer title and category, review the current-file behavior, then link.

The document workbench provides source opening and a fresh link check. A successful opening resolves the current Microsoft URL each time. A linked file does not enter the upload preview/version interface. Users can disconnect the tab's Microsoft accounts, and Societyer sign-out or account/session changes clear the connector cache.

## Microsoft tenant setup

This setup belongs to the tenant holding the originals, which may differ from Societyer's sign-in or hosting tenant.

1. Register a dedicated Microsoft Entra application for this connector. A single-tenant registration in the source tenant is sufficient for a deployment using that tenant. A centrally operated multi-tenant registration needs customer consent and source grants for each target tenant.
2. Add the Societyer callback as a **Single-page application** redirect URI. For an app hosted at `https://app.example.org/`, register `https://app.example.org/document-source-auth.html`. Include the deployment's base path if it has one. URI scheme, host, port and path must match.
3. Configure delegated Microsoft Graph `User.Read` and `Sites.Selected`, with tenant consent as required by that organization's policy. Grant the application's selected site **read** access using an authorized administrator/provisioning process. Scope consent and the site grant are separate steps; the application starts with no selected-site access.
4. Confirm that the people using Societyer also have permission to the source files. External users may need guest membership and the tenant's cross-tenant/Conditional Access policies to permit access. A Societyer account alone does not confer Microsoft access.
5. Obtain and record the resource tenant UUID, application UUID, composite Graph site ID (`hostname,siteCollectionGuid,webGuid`), site URL and document-library drive ID. Avoid personal drive URLs and arbitrary pasted sharing links.
6. Save the source in Societyer, enable it and the workspace module, and qualify browsing/opening with a permitted user and a user who lacks access.

The callback is a separate Vite entry implementing the MSAL v5 redirect bridge. It must bypass app-router redirects, authentication guards and service-worker app-shell fallback. Do not apply a `Cross-Origin-Opener-Policy` header to the callback page. The build includes it without enabling a source. Popups must be permitted by the browser; mobile browsers and Conditional Access combinations require qualification in the target environment.

No deployment secret, storage bucket or content-copy job is required for this first connector. Existing Microsoft 365 licensing and source capacity still apply. Societyer adds small metadata rows and on-demand authentication/Graph requests; full-text indexing, OCR, retained content and background synchronization would have separate infrastructure and cost implications.

## Verification and rollout

Automated checks cover source opt-in, role/workspace isolation, private reference commits, revocation between verification and commit, stable-ID resolution, allowed library types, foreign resources, token binding, metadata-only calls, unsafe pagination and secret-safe errors. Existing upload/security tests remain regression gates.

Before enabling a real source, qualify these cases in a non-production library:

- permitted and denied users, including the intended guest-user arrangement;
- rename and folder move within the same library;
- cross-library move, deletion and permission removal;
- module/source disable while a browse or link operation is in flight;
- sign-out/account switch, token expiry and Conditional Access;
- callback loading under the deployed base path, hosting headers and service worker;
- a large or paginated folder, and a remote-item shortcut that must be rejected;
- existing upload/open/version behavior with external sources still disabled.

Repository tests use controlled Graph responses. They do not establish that a particular Microsoft tenant, consent grant, browser or deployment has been qualified. The implementation can be reviewed and merged with the module remaining off; production tenant consent and activation are separate operational steps.

## Primary references

- [Microsoft selected-permission model](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [Graph drive resource and drive types](https://learn.microsoft.com/en-us/graph/api/resources/drive?view=graph-rest-1.0)
- [ID-based and path-based addressing](https://learn.microsoft.com/en-us/graph/onedrive-addressing-driveitems)
- [MSAL browser cache behavior](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/caching)
- [MSAL v5 redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge)
- [Multi-tenant application onboarding](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant)
