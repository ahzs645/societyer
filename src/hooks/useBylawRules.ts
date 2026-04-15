import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "./useSociety";

export function useBylawRules() {
  const society = useSociety();
  const rules = useQuery(
    api.bylawRules.getActive,
    society ? { societyId: society._id } : "skip",
  );

  return {
    society,
    rules,
  };
}
