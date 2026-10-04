import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "./usePermissions";
import { useSociety } from "./useSociety";

export function useBylawRules(enabled = true) {
  const society = useSociety();
  const { can } = usePermissions();
  const rules = useQuery(
    api.bylawRules.getActive,
    enabled && society && can("documents:read") ? { societyId: society._id } : "skip",
  );

  return {
    society,
    rules,
  };
}
