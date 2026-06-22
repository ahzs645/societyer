import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "./useSociety";
import { useCurrentUserId } from "./useCurrentUser";

/**
 * Surfaces the current user's role + permission set (from permissions.myPermissions)
 * and a `can(permission)` helper for gating UI. Deliberately PERMISSIVE while the
 * query is loading or unavailable (`can` returns true) so we never hide controls
 * on a slow/absent query — the server still enforces every write via
 * requirePermission, so UI gating is a convenience, not the security boundary.
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
    can: (permission: string) => (permissions === undefined ? true : permissions.includes(permission)),
  };
}
