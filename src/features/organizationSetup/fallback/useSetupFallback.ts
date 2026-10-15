/**
 * TEMPORARY FALLBACK hooks — delete with this folder once workstream A's
 * `organizationSetup` query and mutations are in the tree.
 */
import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { isCorporation } from "../../../../shared/organizationDomain";
import type { OrganizationSetupProgress } from "../../../../shared/organizationSetup/types";
import { deriveFallbackProgress, readFallbackState, subscribeFallbackState, writeFallbackState } from "./setupFallback";
import type { SetupActions } from "../useSetupActions";

export function useFallbackOrganizationSetup(societyId: string | null | undefined, enabled: boolean): OrganizationSetupProgress | undefined {
  const society = useSociety();
  const active = enabled && Boolean(societyId) && society && String(society._id) === String(societyId);
  const { can, loaded } = usePermissions();
  const summary = useQuery(api.dashboard.summary, active ? { societyId } : "skip");
  const roleHolders = useQuery(api.legalOperations.listRoleHolders, active && isCorporation(society) && can("documents:read") ? { societyId } : "skip") as any[] | undefined;
  const store = useSyncExternalStore(subscribeFallbackState, () => (societyId ? readFallbackState(String(societyId)) : undefined));
  return useMemo(() => {
    if (!active || !society || summary === undefined || !loaded || !store) return undefined;
    const readAccess: string[] | undefined = summary?.readAccess;
    return deriveFallbackProgress({ society, summary, roleHolders, canRead: (permission) => Boolean(readAccess?.includes(permission)) || can(permission) }, store);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, society, summary, roleHolders, loaded, store]);
}

export const fallbackSetupActions: SetupActions = {
  decideStep: async ({ societyId, stepKey, decision, reason }) => {
    if (decision === "not_applicable" && !reason?.trim()) throw new Error("Give a reason this step doesn't apply.");
    const state = readFallbackState(societyId);
    const decisions = { ...state.decisions };
    if (decision) decisions[stepKey] = { decision, ...(reason ? { reason } : {}) };
    else delete decisions[stepKey];
    writeFallbackState(societyId, { ...state, decisions });
    return null;
  },
  markSubmitted: async ({ societyId, submittedOn, reference, undo }) => {
    const state = readFallbackState(societyId);
    writeFallbackState(societyId, undo
      ? { ...state, formationStatus: "preparing", submittedOn: undefined, reference: undefined }
      : { ...state, formationStatus: "submitted", submittedOn, reference });
    return null;
  },
  recordIncorporation: async ({ societyId }) => {
    const state = readFallbackState(societyId);
    writeFallbackState(societyId, { ...state, formationStatus: "incorporated" });
    return null;
  },
};
