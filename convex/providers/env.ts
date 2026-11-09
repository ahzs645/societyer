// Runtime config for third-party adapters. In demo mode every adapter returns
// deterministic fake data so nothing requires real credentials. Live adapters
// expect env vars and may call their provider APIs from Convex actions.

export type Provider<T extends string> = { id: T; live: boolean };

function env(name: string): string | undefined {
  // Convex functions inherit process.env from the deployment settings.
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

import { sharePointDeploymentConfigured } from "../../shared/storage/sharePointDeployment";
import { emailProviderConfiguration, type EmailProviderId } from "../../shared/emailConfiguration";
import {
  documentVersionStorageAvailable,
  effectiveWorkspaceStorage,
  singleStoragePolicyRow,
  NATIVE_UPLOADS_DISABLED_MESSAGE,
  type EffectiveWorkspaceStorage,
} from "../../shared/workspaceStoragePolicy";
import type { DatabaseReader } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const rustFsConfigured = () => !!env("RUSTFS_ENDPOINT") && !!env("RUSTFS_ACCESS_KEY") && !!env("RUSTFS_SECRET_KEY");
const r2Configured = () => !!(env("R2_ENDPOINT") || env("R2_ACCOUNT_ID")) && !!env("R2_BUCKET") && !!env("R2_ACCESS_KEY_ID") && !!env("R2_SECRET_ACCESS_KEY");

export const providers = {
  storage(): Provider<"rustfs" | "r2" | "sharepoint" | "demo"> {
    const selected = env("SOCIETYER_STORAGE_PROVIDER");
    if (selected && !["rustfs", "r2", "sharepoint", "demo"].includes(selected)) throw new Error("Unsupported deployment storage provider.");
    if (selected === "sharepoint") return { id: "sharepoint", live: sharePointDeploymentConfigured(process.env) };
    if (selected === "r2") return { id: "r2", live: r2Configured() };
    if (selected === "demo") return { id: "demo", live: false };
    const live = rustFsConfigured();
    return { id: selected === "rustfs" || live ? "rustfs" : "demo", live };
  },
  /**
   * Non-SharePoint storage, for a workspace whose policy picks `native` on a
   * deployment that selects SharePoint by default. Otherwise the same as storage().
   */
  nativeStorage(): Provider<"rustfs" | "r2" | "demo"> {
    const deployment = providers.storage();
    if (deployment.id !== "sharepoint") return { id: deployment.id, live: deployment.live };
    if (rustFsConfigured()) return { id: "rustfs", live: true };
    if (r2Configured()) return { id: "r2", live: true };
    return { id: "demo", live: false };
  },
  paperless(): Provider<"paperlessngx" | "demo"> {
    const live = !!env("PAPERLESS_NGX_URL") && !!env("PAPERLESS_NGX_TOKEN");
    return { id: live ? "paperlessngx" : "demo", live };
  },
  transcription(): Provider<"whisper" | "demo"> {
    const live = !!env("OPENAI_API_KEY") || !!env("WHISPER_ENDPOINT");
    return { id: live ? "whisper" : "demo", live };
  },
  llm(): Provider<"anthropic" | "openai" | "demo"> {
    if (env("ANTHROPIC_API_KEY")) return { id: "anthropic", live: true };
    if (env("OPENAI_API_KEY")) return { id: "openai", live: true };
    return { id: "demo", live: false };
  },
  email(): Provider<EmailProviderId> {
    return emailProviderConfiguration(process.env);
  },
  accounting(): Provider<"wave" | "demo"> {
    const live = !!env("WAVE_ACCESS_TOKEN") && !!env("WAVE_BUSINESS_ID");
    return { id: live ? "wave" : "demo", live };
  },
  billing(): Provider<"stripe" | "demo"> {
    const live = !!env("STRIPE_SECRET_KEY");
    return { id: live ? "stripe" : "demo", live };
  },
};

// Used by seeded society to decide whether anything should hit live APIs.
// This project's seeded fictional society is hard-wired to demo.
export function isSocietyDemo(societyDemoMode: boolean | undefined): boolean {
  return societyDemoMode !== false;
}

// ---------------------------------------------------------------------------
// Native file storage switch
// ---------------------------------------------------------------------------
// Some deployments or workspaces must never store files in Convex's native
// object storage — either to run a smaller instance, or because the operator
// needs a hard guarantee that users cannot smuggle a file into Convex. The
// deployment flag SOCIETYER_DISABLE_NATIVE_FILE_STORAGE is the ceiling; a
// workspace storage policy can only narrow it (shared/workspaceStoragePolicy).
// External document connectors (e.g. Paperless) stay available as read-only
// sources. The client also hides upload affordances, but these server guards
// are what make the policy un-bypassable.
export const NATIVE_FILE_STORAGE_DISABLED_MESSAGE = NATIVE_UPLOADS_DISABLED_MESSAGE;

/** Effective storage policy for one workspace, read inside the caller's transaction. */
export async function workspaceStorage(db: DatabaseReader, societyId: Id<"societies">): Promise<EffectiveWorkspaceStorage> {
  const rows = await db.query("workspaceStoragePolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return effectiveWorkspaceStorage(singleStoragePolicyRow(rows), process.env);
}

/** Every native upload path: Convex `_storage` upload URLs, stores, and claims of uploaded blobs. */
export async function assertWorkspaceNativeUploads(db: DatabaseReader, societyId: Id<"societies"> | undefined): Promise<void> {
  // Without a workspace there is no policy to satisfy, so refuse.
  if (!societyId || !(await workspaceStorage(db, societyId)).nativeUploads) throw new Error(NATIVE_FILE_STORAGE_DISABLED_MESSAGE);
}

export function assertDocumentVersionStorageAvailable(policy: EffectiveWorkspaceStorage): EffectiveWorkspaceStorage {
  if (!documentVersionStorageAvailable(policy, process.env)) {
    throw new Error(policy.documentVersionProvider === "sharepoint" ? "SharePoint is not connected on this deployment." : NATIVE_FILE_STORAGE_DISABLED_MESSAGE);
  }
  return policy;
}

/** Document versions: SharePoint when the workspace uses it, otherwise the native-upload rule. */
export async function assertWorkspaceDocumentVersionStorage(db: DatabaseReader, societyId: Id<"societies">): Promise<EffectiveWorkspaceStorage> {
  return assertDocumentVersionStorageAvailable(await workspaceStorage(db, societyId));
}

/** An in-flight upload must still match the workspace's provider; a policy change voids it. */
export async function assertWorkspaceUploadProvider(db: DatabaseReader, societyId: Id<"societies">, provider: string): Promise<void> {
  const policy = await assertWorkspaceDocumentVersionStorage(db, societyId);
  if ((provider === "sharepoint") !== (policy.documentVersionProvider === "sharepoint")) {
    throw new Error("Upload handle uses a different storage provider.");
  }
}

/** Concrete provider for a workspace's new document versions. */
export function documentVersionStorage(policy: EffectiveWorkspaceStorage): Provider<"rustfs" | "r2" | "sharepoint" | "demo"> {
  return policy.documentVersionProvider === "sharepoint"
    ? { id: "sharepoint", live: sharePointDeploymentConfigured(process.env) }
    : providers.nativeStorage();
}
