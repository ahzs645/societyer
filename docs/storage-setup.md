# Document storage deployment

Existing RustFS configuration continues to select RustFS. A workspace's storage
preference records its intended policy; it does not change deployment credentials,
move existing objects or establish a provider connection.

For Cloudflare R2, configure these **Convex function deployment environment** keys:

| Key | Value |
| --- | --- |
| `SOCIETYER_STORAGE_PROVIDER` | `r2` |
| `R2_ACCOUNT_ID` or `R2_ENDPOINT` | Account ID or the account's HTTPS S3 endpoint |
| `R2_BUCKET` | Approved document bucket |
| `R2_ACCESS_KEY_ID` | Bucket-scoped S3 access key |
| `R2_SECRET_ACCESS_KEY` | Bucket-scoped S3 secret |

Use Convex deployment settings or `convex env` against the intended deployment.
The Docker and Kubernetes examples also pass optional storage configuration to
the backend container. Container environment values alone are not proof that
the function deployment has those values. Check the authenticated storage
capabilities query and perform the approved synthetic upload/download probe.

The frontend may be built with `VITE_DOCUMENT_STORAGE_PROVIDER=r2`; Docker's
frontend build accepts that argument. Credentials belong only in the server
deployment environment. Keep credentials out of `VITE_*`, committed files,
screenshots and provider URLs logged by application diagnostics.

R2 uses the S3-compatible signer with region `auto`. Configure browser PUT CORS
for the application's actual origins and use scoped credentials with the object
read/write operations required for verification. The application does not change
bucket lock policies, retention configuration or resource grants.

Hosted uploads currently support files up to 32 MiB. A server-issued handle binds
the actor, workspace, document, staging object, file size, MIME type and expiry.
After browser upload, the server checks the actual bytes and SHA-256, then stores
them under a separate unique key. Clients never receive a PUT URL for that
committed key. Version numbers and the single current version are committed
atomically. Existing versions retain their provider and locator when a
deployment's preferred provider changes.

These are application-managed versions, not an implementation of S3 historical
object versions or Object Lock. Administrative provider credentials can still
alter objects. Legal holds, deletion protection, independent backup and tested
restore require provider and organizational controls. Interrupted uploads leave
an expiring, unusable handle; orphan reconciliation is separate from finalization.

Document metadata, version delivery, export and API-local generated files use
the current authenticated document ACL. New requests stop after membership or
grant revocation. Already issued S3 bearer download URLs can remain usable until
their 15-minute expiry; do not describe them as immediately revoked.

Before marking a provider connection verified, record successful synthetic
upload/download, checksum comparison, cross-workspace denial, historical-version
export, credential revocation and independent restore results. No live provider
probe was performed as part of this implementation.

SharePoint currently has tested, injectable server-side Graph primitives. It is
not an active deployment adapter. Token custody, administrator consent, explicit
selected-resource grants, approved tenant/site/library IDs, retention and an
authorized proof of concept are required before deployment wiring is enabled.
