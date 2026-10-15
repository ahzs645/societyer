/**
 * STAND-IN (workstream C). Workstream B owns this file; its version replaces
 * this one at merge. Same export and contract: progress through organization
 * setup for one organization, from `organizationSetup:progress`. Pass `null`
 * to skip the query (e.g. while a reminder is hidden).
 */
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { OrganizationSetupProgress } from "../../../shared/organizationSetup/types";

export function useOrganizationSetup(societyId: string | null | undefined): OrganizationSetupProgress | undefined {
  const progress = useQuery(api.organizationSetup.progress, societyId ? { societyId } : "skip") as
    | OrganizationSetupProgress
    | null
    | undefined;
  return progress ?? undefined;
}
