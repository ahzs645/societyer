/**
 * Per-workspace storage policy (table `workspaceStoragePolicies`) resolved
 * inside the deployment's limits. See docs/shared-workspaces/architecture.md.
 *
 * The deployment stays the ceiling: SOCIETYER_DISABLE_NATIVE_FILE_STORAGE turns
 * native uploads off for every workspace, and SharePoint is only reachable
 * through the one deployment connection. A row can only narrow those limits or
 * pick between providers the deployment already has.
 */
import type { PortableDbReader, PortableDoc } from "./portable/ctx";
import { sharePointDeploymentConfigured } from "./storage/sharePointDeployment";

type Environment = Record<string, string | undefined>;

export type WorkspaceStoragePolicyRow = {
  nativeUploads: "allowed" | "disabled";
  documentVersionProvider: "deployment-default" | "native" | "sharepoint";
};

export type EffectiveWorkspaceStorage = {
  /** Convex `_storage` and native object-storage uploads (files, images, pulled sources, native versions). */
  nativeUploads: boolean;
  /** Where new document versions go. `native` means the deployment's non-SharePoint storage. */
  documentVersionProvider: "native" | "sharepoint";
};

export const NATIVE_UPLOADS_DISABLED_MESSAGE =
  "Native file storage is disabled for this workspace. Use a document connector (e.g. Paperless) as the source instead of uploading.";

export function deploymentNativeUploadsDisabled(env: Environment): boolean {
  const flag = (env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

/** Today's deployment-wide choice: SharePoint when SOCIETYER_STORAGE_PROVIDER selects it. */
export function deploymentDocumentVersionProvider(env: Environment): "native" | "sharepoint" {
  return env.SOCIETYER_STORAGE_PROVIDER === "sharepoint" ? "sharepoint" : "native";
}

/**
 * Effective policy for one workspace. No row keeps the deployment behaviour
 * exactly. An explicit SharePoint row also turns native uploads off, so that
 * workspace never writes Convex storage. SharePoint without a configured
 * connection stays SharePoint (and fails at upload) rather than falling back
 * to native storage.
 */
export function effectiveWorkspaceStorage(row: WorkspaceStoragePolicyRow | null | undefined, env: Environment): EffectiveWorkspaceStorage {
  const requested = row?.documentVersionProvider ?? "deployment-default";
  const documentVersionProvider = requested === "deployment-default" ? deploymentDocumentVersionProvider(env) : requested;
  const nativeUploads = !deploymentNativeUploadsDisabled(env)
    && row?.nativeUploads !== "disabled"
    && requested !== "sharepoint";
  return { nativeUploads, documentVersionProvider };
}

/** Whether new document versions may be stored for this workspace at all. */
export function documentVersionStorageAvailable(policy: EffectiveWorkspaceStorage, env: Environment): boolean {
  return policy.documentVersionProvider === "sharepoint" ? sharePointDeploymentConfigured(env) : policy.nativeUploads;
}

/** Two rows for one workspace is an operator error: refuse rather than guess. */
export function singleStoragePolicyRow<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new Error("This workspace has more than one storage policy. Ask the deployment operator to resolve it.");
  return rows[0] ?? null;
}

export async function workspaceStoragePolicy(db: PortableDbReader, societyId: string, env: Environment): Promise<EffectiveWorkspaceStorage> {
  const rows = await db.query<PortableDoc & WorkspaceStoragePolicyRow>("workspaceStoragePolicies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return effectiveWorkspaceStorage(singleStoragePolicyRow(rows), env);
}
