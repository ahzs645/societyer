import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "./useSociety";
import { useCurrentUserId } from "./useCurrentUser";

/**
 * Surfaces the current user's role + permission set (from permissions.myPermissions)
 * and a `can(permission)` helper for gating UI. Controls wait for the current
 * actor's authorized permission result, including after an account/workspace
 * switch. The server still independently enforces every write.
 */
export function usePermissions() {
  const society = useSociety();
  const userId = useCurrentUserId();
  const data = useQuery(
    api.permissions.myPermissions,
    society && userId ? { societyId: society._id, userId } : "skip",
  );
  const permissions = data?.permissions as string[] | undefined;
  return {
    role: (data?.role as string | null) ?? null,
    permissions: permissions ?? [],
    loaded: data !== undefined,
    can: (permission: string) => permissions?.includes(permission) ?? false,
  };
}
