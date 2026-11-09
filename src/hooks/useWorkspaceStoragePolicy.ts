import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "./useSociety";
import { isNoAuthMode } from "../lib/authMode";
import { workspaceStorageAffordances, type WorkspaceStorageAffordances, type WorkspaceStoragePolicy } from "../lib/runtimeMode";

/**
 * What the selected workspace may upload: the build flags (a ceiling) narrowed
 * by the workspace's server-side storage policy. Display only; the server
 * guards enforce the same policy. Local, demo and auth-less runtimes have no
 * workspace policy and keep the build flags.
 */
export function useWorkspaceStoragePolicy(): WorkspaceStorageAffordances {
  const society = useSociety();
  const applies = !isNoAuthMode();
  const policy = useQuery(api.workspaceStoragePolicies.forWorkspace, applies && society ? { societyId: society._id } : "skip") as WorkspaceStoragePolicy | undefined;
  return workspaceStorageAffordances(applies ? policy : null);
}
