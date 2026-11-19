import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { WorkspaceStoragePolicy } from "../../../lib/runtimeMode";

/**
 * A shared frontend may configure the SharePoint broker for several domains,
 * but only the meeting's own workspace policy enables its file controls.
 * Keep the broker client unmounted while that authenticated query is loading
 * or the workspace uses native storage. The server still enforces the policy.
 */
export function WorkspaceMeetingSourceGate({ societyId, children }: { societyId: string; children: ReactNode }) {
  const policy = useQuery(api.workspaceStoragePolicies.forWorkspace, societyId ? { societyId } : "skip") as WorkspaceStoragePolicy | undefined;
  return policy?.documentVersionProvider === "sharepoint" ? children : null;
}
